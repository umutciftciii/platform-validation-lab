/**
 * DP-173 (ADR-022 D5): server-side reads of the company catalogue preview. Same contract as the
 * public catalogue (lib/catalog-api.ts): this site's proxy key, server only, responses validated
 * against @dream/contracts, 5 s timeout. The preview token travels in the path; the API checks
 * its signature, expiry and the issuing staff session on every request. A failed check is a 404,
 * so an expired, revoked or forged link looks like an unknown one.
 */
import {
  CATALOG_PREVIEW_API,
  CATALOG_PREVIEW_PATH,
  CatalogPreviewListResponseSchema,
  CatalogPreviewProductResponseSchema,
  CatalogPreviewTokenSchema,
  type CatalogPreviewListResponse,
  type CatalogPreviewProductResponse,
} from "@dream/contracts";
import { catalogConfig, type Read } from "./catalog-api";

const TIMEOUT_MS = 5_000;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isPreviewToken = (token: string) => CatalogPreviewTokenSchema.safeParse(token).success;

async function get(path: string, config = catalogConfig()): Promise<Response | null> {
  if (!config) return null;
  try {
    return await fetch(`${config.apiUrl}${CATALOG_PREVIEW_API}${path}`, {
      headers: { "X-DP-Proxy-Key": config.proxyKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    console.error("catalogue preview: request failed (network)");
    return null;
  }
}

export async function previewList(token: string): Promise<Read<CatalogPreviewListResponse>> {
  if (!isPreviewToken(token)) return { ok: false, reason: "not_found" };
  const res = await get(`/${token}/products`);
  if (res?.status === 404) return { ok: false, reason: "not_found" };
  if (!res || !res.ok) return { ok: false, reason: "unavailable" };
  const parsed = CatalogPreviewListResponseSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, reason: "unavailable" };
}

export async function previewProduct(
  token: string,
  slug: string,
): Promise<Read<CatalogPreviewProductResponse>> {
  if (!isPreviewToken(token) || !SLUG.test(slug) || slug.length > 120) {
    return { ok: false, reason: "not_found" };
  }
  const res = await get(`/${token}/products/${slug}`);
  if (res?.status === 404) return { ok: false, reason: "not_found" };
  if (!res || !res.ok) return { ok: false, reason: "unavailable" };
  const parsed = CatalogPreviewProductResponseSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, reason: "unavailable" };
}

/** A preview image variant, streamed through this site; never cached. */
export async function previewImageResponse(token: string, id: string, variant: string): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" };
  if (!isPreviewToken(token) || !UUID.test(id) || (variant !== "display" && variant !== "thumb")) {
    return new Response("Not found", { status: 404, headers });
  }
  const res = await get(`/${token}/images/${id}/${variant}`);
  if (!res || res.status !== 200 || res.headers.get("content-type") !== "image/webp") {
    await res?.arrayBuffer().catch(() => undefined);
    return new Response("Not found", { status: res && res.status !== 404 && res.status !== 200 ? 502 : 404, headers });
  }
  return new Response(res.body, {
    status: 200,
    headers: { ...headers, "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff" },
  });
}

/** The preview's URLs for the shared catalogue views. */
export function previewBase(token: string): string {
  return `${CATALOG_PREVIEW_PATH}/${token}`;
}
