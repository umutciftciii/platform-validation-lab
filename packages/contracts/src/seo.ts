/**
 * DP-207: the technical SEO base of the public sites (BV first).
 *
 *  - `GET /api/v1/public/seo/resolve?path=` answers whether a public address has live content on
 *    the site of the proxy key (200 `{ path, kind }`, otherwise 404; a CMS page or article that was
 *    live there and was taken off carries the detail `unpublished`). The site server asks it
 *    BEFORE rendering, so an unknown address answers a real HTTP 404 instead of a streamed
 *    not-found page with status 200 ("soft 404"; DP-050 finding).
 *  - `GET /api/v1/public/seo/sitemap` lists the indexable live addresses of the site: published
 *    CMS pages and articles without noindex, the live products, and the fixed list pages. Drafts,
 *    unpublished, hidden or archived content never appears.
 *  - Indexing policy: a site is indexable only in production, with an explicit switch and a
 *    valid public origin (fail closed). Locally (DEV) and on staging everything stays noindex.
 */
import { z } from "zod";

export const PUBLIC_SEO_API = "/api/v1/public/seo";

const IsoDate = z.iso.datetime({ offset: true });

export const SEO_PATH_KINDS = ["home", "page", "article", "product", "products", "news"] as const;
export type SeoPathKind = (typeof SEO_PATH_KINDS)[number];

const SEGMENT = "[a-z0-9]+(?:-[a-z0-9]+)*";
/** Addresses the resolve endpoint answers: "/", "/<slug>", "/news/<slug>", "/products/<slug>". */
export const SEO_RESOLVABLE_PATH = new RegExp(
  `^/(?:(?:news|products)/${SEGMENT}|(?:${SEGMENT})?)$`,
);

export const PublicSeoResolveResponseSchema = z.strictObject({
  path: z.string(),
  kind: z.enum(SEO_PATH_KINDS),
});
export type PublicSeoResolveResponse = z.infer<typeof PublicSeoResolveResponseSchema>;

export const PublicSitemapEntrySchema = z.strictObject({
  path: z.string().startsWith("/"),
  kind: z.enum(SEO_PATH_KINDS),
  lastModified: IsoDate.nullable(),
});
export type PublicSitemapEntry = z.infer<typeof PublicSitemapEntrySchema>;

export const PublicSitemapResponseSchema = z.strictObject({
  entries: z.array(PublicSitemapEntrySchema).max(5000),
});
export type PublicSitemapResponse = z.infer<typeof PublicSitemapResponseSchema>;

// --- indexing policy ----------------------------------------------------------------------------

export type SeoDeployEnv = "local" | "staging" | "production";

/** Reads DP_DEPLOY_ENV like the API does; anything unknown counts as production (fail closed). */
export function seoDeployEnv(raw: string | undefined): SeoDeployEnv {
  const v = (raw ?? "local").trim() || "local";
  return v === "local" || v === "staging" ? v : "production";
}

/** Local default origin of the BV site (the DEV port), used for canonical URLs in development. */
export const BV_LOCAL_ORIGIN = "http://localhost:3110";

/**
 * The public origin of a site (scheme + host, no path) from its environment value. https only
 * outside local development; locally an unset value falls back to the local origin. null: no
 * usable origin (no canonical URLs, no indexing).
 */
export function seoPublicOrigin(
  raw: string | undefined,
  deployEnv: SeoDeployEnv,
  localDefault: string = BV_LOCAL_ORIGIN,
): string | null {
  const value = raw?.trim() || (deployEnv === "local" ? localDefault : "");
  // scheme://host[:port] with an optional trailing slash; no user info, path, query or fragment.
  const m =
    /^(https?):\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(:\d{1,5})?\/?$/i.exec(
      value,
    );
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  if (scheme !== "https" && !(scheme === "http" && deployEnv === "local")) return null;
  const port = m[3] && !(scheme === "https" ? m[3] === ":443" : m[3] === ":80") ? m[3] : "";
  return `${scheme}://${m[2]!.toLowerCase()}${port}`;
}

export interface SeoPolicy {
  deployEnv: SeoDeployEnv;
  origin: string | null;
  /** Whether search engines may index the site (robots.txt allows, pages carry no noindex). */
  indexable: boolean;
}

/**
 * The SEO policy of a site from its environment: `DP_DEPLOY_ENV`, the public origin variable and
 * `DP_SEO_INDEXING`. Indexable only when all hold: production, `DP_SEO_INDEXING=on` and a valid
 * https origin. Everything else (local/DEV, staging, a missing or wrong value) is noindex.
 */
export function seoPolicy(env: {
  deployEnv: string | undefined;
  origin: string | undefined;
  indexing: string | undefined;
}): SeoPolicy {
  const deployEnv = seoDeployEnv(env.deployEnv);
  const origin = seoPublicOrigin(env.origin, deployEnv);
  const indexable = deployEnv === "production" && env.indexing?.trim() === "on" && origin !== null;
  return { deployEnv, origin, indexable };
}

/** The canonical absolute URL of a site path ("/products/x"); query and fragment are dropped. */
export function canonicalUrl(origin: string, path: string): string {
  const clean = path.split(/[?#]/, 1)[0] || "/";
  return `${origin.replace(/\/+$/, "")}${clean.startsWith("/") ? clean : `/${clean}`}`;
}

// --- structured data (schema.org JSON-LD) -------------------------------------------------------

export interface OrganizationLd {
  name: string;
  origin: string;
  logoPath: string;
  email?: string | null;
  telephone?: string | null;
}

export function organizationJsonLd(o: OrganizationLd): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: o.name,
    url: canonicalUrl(o.origin, "/"),
    logo: canonicalUrl(o.origin, o.logoPath),
    ...(o.email ? { email: o.email } : {}),
    ...(o.telephone ? { telephone: o.telephone } : {}),
  };
}

export interface ProductLd {
  origin: string;
  path: string;
  name: string;
  code: string;
  description: string | null;
  category: string | null;
  imagePaths: readonly string[];
}

/**
 * A Product without offers: the site publishes no prices (B2B, quote on request), and no rating,
 * review or brand is invented (the snapshot names no manufacturer). Only fields of the published
 * snapshot are used.
 */
export function productJsonLd(p: ProductLd): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    sku: p.code,
    url: canonicalUrl(p.origin, p.path),
    ...(p.description ? { description: p.description } : {}),
    ...(p.category ? { category: p.category } : {}),
    ...(p.imagePaths.length ? { image: p.imagePaths.map((i) => canonicalUrl(p.origin, i)) } : {}),
  };
}

/**
 * JSON-LD as the text of a `<script type="application/ld+json">`: `<` is escaped so content can
 * never close the script element.
 */
export function jsonLdText(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
