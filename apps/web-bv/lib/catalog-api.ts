/**
 * Server-side reads of the public product content (PM-3) for dreampetroleumbv.com.
 *
 * Contract (docs/catalog/public-content-contract.md):
 *  - Only `GET /api/v1/public/catalog/*` of the platform API, with this site's proxy key
 *    (DP_PROXY_KEY_WEB_BV). The API derives the site from the key: this server can only ever
 *    read BV content, whatever the path says. Corporate has its own key and site.
 *  - The key is read from the server environment at request time and sent from the server
 *    only; it is never a NEXT_PUBLIC_ variable and never reaches the browser.
 *  - Only published products whose BV listing is visible come back, as the approved snapshot.
 *    Drafts, private originals and staff data never leave the API.
 *  - Responses are validated against @dream/contracts before rendering; anything else is
 *    treated as unavailable. 5 s timeout; failures are logged without the key.
 */
import {
  PUBLIC_CATALOG_API,
  PublicCrossReferenceListResponseSchema,
  PublicDocumentListResponseSchema,
  PublicProductListResponseSchema,
  PublicProductResponseSchema,
  type PublicCrossReference,
  type PublicDocument,
  type PublicProduct,
  type PublicProductSummary,
} from "@dream/contracts";

const KEY = /^[A-Za-z0-9_-]{43,}$/;
const TIMEOUT_MS = 5_000;

interface Config {
  apiUrl: string;
  proxyKey: string;
}

/** The API origin and this site's key; null when the site is not connected (no products). */
export function catalogConfig(env: Record<string, string | undefined> = process.env): Config | null {
  const apiUrl = env["DP_API_URL"]?.trim();
  const proxyKey = env["DP_PROXY_KEY_WEB_BV"]?.trim() ?? "";
  if (!apiUrl || !KEY.test(proxyKey)) return null;
  try {
    const url = new URL(apiUrl);
    const local = (env["DP_DEPLOY_ENV"]?.trim() || "local") === "local";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return { apiUrl: url.origin, proxyKey };
  } catch {
    return null;
  }
}

export type Read<T> = { ok: true; data: T } | { ok: false; reason: "not_found" | "unavailable" };

async function get(
  path: string,
  config: Config | null,
  extraHeaders: Record<string, string> = {},
): Promise<Response | null> {
  if (!config) return null;
  try {
    return await fetch(`${config.apiUrl}${PUBLIC_CATALOG_API}${path}`, {
      headers: { ...extraHeaders, "X-DP-Proxy-Key": config.proxyKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    console.error(`public catalogue: GET ${path.split("/")[1] ?? ""} failed (network)`);
    return null;
  }
}

export async function listProducts(config = catalogConfig()): Promise<Read<PublicProductSummary[]>> {
  const res = await get("/products", config);
  // 404: the platform has no catalogue for this site yet (sites not set up), so nothing is
  // published; every other failure is "unavailable".
  if (res?.status === 404) return { ok: true, data: [] };
  if (!res || !res.ok) return { ok: false, reason: "unavailable" };
  const parsed = PublicProductListResponseSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? { ok: true, data: parsed.data.items } : { ok: false, reason: "unavailable" };
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function getProduct(slug: string, config = catalogConfig()): Promise<Read<PublicProduct>> {
  if (!SLUG.test(slug) || slug.length > 120) return { ok: false, reason: "not_found" };
  const res = await get(`/products/${slug}`, config);
  if (res?.status === 404) return { ok: false, reason: "not_found" };
  if (!res || !res.ok) return { ok: false, reason: "unavailable" };
  const parsed = PublicProductResponseSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? { ok: true, data: parsed.data.product } : { ok: false, reason: "unavailable" };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The bytes of a published image variant (display or thumb), streamed through this site. */
export async function imageResponse(
  id: string,
  variant: string,
  config = catalogConfig(),
): Promise<Response> {
  if (!UUID.test(id) || (variant !== "display" && variant !== "thumb")) {
    return new Response("Not found", { status: 404 });
  }
  const res = await get(`/images/${id}/${variant}`, config);
  if (!res || res.status !== 200 || res.headers.get("content-type") !== "image/webp") {
    await res?.arrayBuffer().catch(() => undefined);
    return new Response("Not found", {
      status: res && res.status !== 404 && res.status !== 200 ? 502 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Image URL on this site (the browser never talks to the API). */
export const imageSrc = (id: string, variant: "display" | "thumb") =>
  `/product-images/${id}/${variant}`;

/**
 * PM-5: technical documents a published product shows on BV (metadata only). Downloads go
 * through `/product-documents/<id>`: PUBLIC directly, LEAD_REQUIRED (`requestable`) after the
 * short form with a grant cookie (DP-042, DP-043); members-only documents are listed, closed.
 */
export async function getProductDocuments(
  slug: string,
  config = catalogConfig(),
): Promise<Read<PublicDocument[]>> {
  if (!SLUG.test(slug) || slug.length > 120) return { ok: false, reason: "not_found" };
  const res = await get(`/products/${slug}/documents`, config);
  if (res?.status === 404) return { ok: false, reason: "not_found" };
  if (!res || !res.ok) return { ok: false, reason: "unavailable" };
  const parsed = PublicDocumentListResponseSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? { ok: true, data: parsed.data.items } : { ok: false, reason: "unavailable" };
}

/**
 * PM-6: cross-references a published product shows on BV: brand, manufacturer, product, grade and
 * the relation level only. The wording on the page is fixed by this site; nothing from the API is
 * rendered as a claim.
 */
export async function getProductCrossReferences(
  slug: string,
  config = catalogConfig(),
): Promise<Read<PublicCrossReference[]>> {
  if (!SLUG.test(slug) || slug.length > 120) return { ok: false, reason: "not_found" };
  const res = await get(`/products/${slug}/cross-references`, config);
  if (res?.status === 404) return { ok: false, reason: "not_found" };
  if (!res || !res.ok) return { ok: false, reason: "unavailable" };
  const parsed = PublicCrossReferenceListResponseSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? { ok: true, data: parsed.data.items } : { ok: false, reason: "unavailable" };
}

/**
 * The PDF of a downloadable document, streamed through this site as an attachment. DP-043: a
 * lead-gated document needs the grant (`extraHeaders`, from the request's cookie) and comes back
 * stamped for its recipient; 429 from the API is passed on with its Retry-After.
 */
export async function documentResponse(
  id: string,
  config = catalogConfig(),
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const res = await get(`/documents/${id}/file`, config, extraHeaders);
  if (res?.status === 429) {
    await res.arrayBuffer().catch(() => undefined);
    return new Response("Too many downloads. Please try again later.", {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": res.headers.get("retry-after") ?? "60" },
    });
  }
  if (!res || res.status !== 200 || res.headers.get("content-type") !== "application/pdf") {
    await res?.arrayBuffer().catch(() => undefined);
    return new Response("Not found", {
      status: res && res.status !== 404 && res.status !== 200 ? 502 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const safe = /^attachment; filename="[a-z0-9-]+\.pdf"$/.test(disposition)
    ? disposition
    : 'attachment; filename="document.pdf"';
  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": safe,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Download URL on this site (the browser never talks to the API). */
export const documentHref = (id: string) => `/product-documents/${id}`;
