/**
 * The address forms `proxy.ts` tells apart before a page renders (DP-207, DP-212, DP-220).
 *
 * Pure functions (no Next.js, no fetch) so the routing decision is unit-tested on its own:
 *  - `content`: `/<slug>`, `/news/<slug>`, `/products/<slug>`: asked to the SEO resolve API;
 *  - `document-request` (DP-220): `/products/<slug>/documents/<uuid>`, the lead form of a
 *    lead-gated document (DP-042). It is one of the site's own address forms, never an old-site
 *    address: before DP-220 it fell through to the DP-212 legacy lookup and was always a 404;
 *  - `legacy`: any other address the old site may have used (redirect only);
 *  - `next`: the app's own top-level pages, files and internals; `privacy`; `not-found`.
 */
import { SEO_INTERNAL_SEGMENTS, seoLegacyPath, type PublicDocument } from "@dream/contracts";

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A document id as the API writes it (lower-case UUID); anything else is no document. */
const DOCUMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** As the catalogue API (`getProductDocuments`) accepts a product slug. */
const PRODUCT_SLUG_MAX = 120;
/** First segments the app serves itself; never a CMS page (the CMS refuses these slugs). */
export const APP_ROUTES: ReadonlySet<string> = new Set([
  "api",
  "lead-form",
  "news",
  "preview",
  "privacy",
  "product-documents",
  "product-images",
  "products",
]);
/** DP-212: file names an old page address may end with (other extensions are files, not pages). */
const LEGACY_PAGE_FILE = /\.(?:html?|php|aspx?|pdf)$/i;

export type ProxyRoute =
  | { kind: "next" }
  | { kind: "privacy" }
  | { kind: "content" }
  | { kind: "document-request"; slug: string; id: string }
  | { kind: "legacy" }
  | { kind: "not-found" };

export function classifyPath(pathname: string): ProxyRoute {
  const parts = pathname.split("/").slice(1);

  if (parts.length === 1) {
    const [slug = ""] = parts;
    if (slug === "privacy") return { kind: "privacy" };
    // The app's own pages, and files (favicon.ico, robots.txt, sitemap.xml) unless they look like
    // an old page address (`/index.html`).
    if (APP_ROUTES.has(slug)) return { kind: "next" };
    if (slug.includes(".") && !LEGACY_PAGE_FILE.test(slug)) return { kind: "next" };
    if (SEGMENT.test(slug)) return { kind: "content" };
  } else if (parts.length === 2) {
    const [section = "", slug = ""] = parts;
    if ((section === "news" || section === "products") && SEGMENT.test(slug)) {
      return { kind: "content" };
    }
  } else if (parts.length === 4 && parts[0] === "products" && parts[2] === "documents") {
    // DP-220: only the exact form; a malformed slug or id is no document of this site (a 404,
    // never an old-site lookup).
    const [, slug = "", , id = ""] = parts;
    if (SEGMENT.test(slug) && slug.length <= PRODUCT_SLUG_MAX && DOCUMENT_ID.test(id)) {
      return { kind: "document-request", slug, id };
    }
    return { kind: "not-found" };
  }
  // DP-212: not one of the site's own address forms. An old-site address is looked up (redirect
  // only); anything else, and internals the matcher let through, is left alone or a 404.
  if (SEO_INTERNAL_SEGMENTS.includes(parts[0] ?? "")) return { kind: "next" };
  return seoLegacyPath(pathname) ? { kind: "legacy" } : { kind: "not-found" };
}

/** The catalogue read of a product's documents, as `getProductDocuments` returns it. */
export type DocumentsRead =
  | { ok: true; data: Pick<PublicDocument, "id" | "requestable">[] }
  | { ok: false; reason: "not_found" | "unavailable" };

/**
 * DP-220: the request form exists only for a document the product page lists as `requestable`
 * (the same rule the page applies, so the status matches what it renders). An unknown or
 * unpublished product, an unknown document and one without a form (public, members-only) are a
 * real 404. While the API cannot answer, the page renders and does its own checks (fail open, as
 * DP-207). No document access changes here: the form, the grant and the file stay as DP-042.
 */
export function documentRequestStatus(docs: DocumentsRead, id: string): "page" | "not_found" {
  if (!docs.ok) return docs.reason === "not_found" ? "not_found" : "page";
  return docs.data.some((d) => d.id === id && d.requestable) ? "page" : "not_found";
}
