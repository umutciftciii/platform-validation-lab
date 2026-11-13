/**
 * Upload proxies of the admin app. The general proxy (api-proxy.ts) keeps its 16 KB JSON limit;
 * these two routes forward one raw body, streamed (never buffered whole):
 *  - PM-2 images: JPEG/PNG/WebP, at most 10 MB, to `PUT .../catalog/products/:id/images`;
 *  - PM-5 documents: PDF, at most 20 MB, to `PUT .../catalog/documents/:id/revisions`, with the
 *    optional change note header.
 *
 * Same trust rules as the general proxy: the API decides everything (authorization, real file
 * type, dimensions); this function forwards, strips and identifies. Only the admin cookies,
 * Origin/Sec-Fetch-Site (for the API's CSRF check), the content type, the length and the file
 * name header go upstream, plus the proxy key, a request id and the client IP.
 */
import { randomUUID } from "node:crypto";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIME_TYPE,
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  REVISION_NOTE_HEADER,
  UPLOAD_FILENAME_HEADER,
} from "@dream/contracts";
import {
  allowedSetCookies,
  clientIpFrom,
  errorResponse,
  filterCookieHeader,
  type ProxyConfig,
  type ProxyDeps,
} from "./api-proxy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const UPLOAD_TIMEOUT_MS = 60_000;
const FILENAME = /^[A-Za-z0-9%._~!*'()-]{1,1024}$/;
/** Percent-encoded change note: encodeURIComponent output of at most 1000 characters. */
const NOTE = /^[A-Za-z0-9%._~!*'()-]{1,12000}$/;

interface RawUpload {
  id: string;
  types: readonly string[];
  maxBytes: number;
  /** API path after the origin, built from the validated (lower-cased) id. */
  upstreamPath: (id: string) => string;
  /** Optional headers forwarded when they match their pattern. */
  passHeaders: ReadonlyArray<readonly [string, RegExp]>;
}

export function proxyImageUpload(
  request: Request,
  productId: string,
  config: ProxyConfig,
  deps: ProxyDeps,
): Promise<Response> {
  return proxyRawUpload(request, config, deps, {
    id: productId,
    types: IMAGE_MIME_TYPES,
    maxBytes: IMAGE_MAX_BYTES,
    upstreamPath: (id) => `/api/v1/admin/catalog/products/${id}/images`,
    passHeaders: [[UPLOAD_FILENAME_HEADER, FILENAME]],
  });
}

/** PM-5: one PDF revision of a technical document. */
export function proxyDocumentUpload(
  request: Request,
  documentId: string,
  config: ProxyConfig,
  deps: ProxyDeps,
): Promise<Response> {
  return proxyRawUpload(request, config, deps, {
    id: documentId,
    types: [DOCUMENT_MIME_TYPE],
    maxBytes: DOCUMENT_MAX_BYTES,
    upstreamPath: (id) => `/api/v1/admin/catalog/documents/${id}/revisions`,
    passHeaders: [
      [UPLOAD_FILENAME_HEADER, FILENAME],
      [REVISION_NOTE_HEADER, NOTE],
    ],
  });
}

async function proxyRawUpload(
  request: Request,
  config: ProxyConfig,
  deps: ProxyDeps,
  spec: RawUpload,
): Promise<Response> {
  const requestId = randomUUID();
  if (request.method.toUpperCase() !== "POST" || !UUID.test(spec.id)) {
    return errorResponse("NOT_FOUND", requestId);
  }
  const type =
    (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!spec.types.includes(type)) {
    return errorResponse("UNSUPPORTED_MEDIA_TYPE", requestId);
  }
  const declared = Number(request.headers.get("content-length") ?? "NaN");
  if (!Number.isFinite(declared) || declared <= 0)
    return errorResponse("VALIDATION_FAILED", requestId);
  if (declared > spec.maxBytes) return errorResponse("PAYLOAD_TOO_LARGE", requestId);
  if (!request.body) return errorResponse("VALIDATION_FAILED", requestId);

  // Counts while streaming: a body longer than its declared length (or the cap) is cut off.
  let seen = 0;
  const limit = Math.min(declared, spec.maxBytes);
  const counted = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > limit) controller.error(new Error("too_large"));
        else controller.enqueue(chunk);
      },
    }),
  );

  const headers = new Headers({ "content-type": type, "content-length": String(declared) });
  for (const name of ["origin", "sec-fetch-site", "accept", "user-agent"]) {
    const v = request.headers.get(name);
    if (v !== null) headers.set(name, v);
  }
  for (const [name, pattern] of spec.passHeaders) {
    const value = request.headers.get(name);
    if (value && pattern.test(value)) headers.set(name, value);
  }
  const cookie = filterCookieHeader(request.headers.get("cookie"));
  if (cookie) headers.set("cookie", cookie);
  headers.set("x-dp-proxy-key", config.proxyKey);
  headers.set("x-dp-request-id", requestId);
  const ip = clientIpFrom(request.headers.get("x-forwarded-for"), config.trustedHops);
  if (ip) headers.set("x-dp-client-ip", ip);

  let upstream: Response;
  try {
    upstream = await deps.fetch(`${config.apiUrl}${spec.upstreamPath(spec.id.toLowerCase())}`, {
      method: "PUT",
      headers,
      body: counted,
      // Node's fetch needs half-duplex to send a stream.
      duplex: "half",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    } as RequestInit & { duplex: "half" });
  } catch {
    if (seen > limit) return errorResponse("PAYLOAD_TOO_LARGE", requestId);
    deps.log(`upload proxy: upstream unavailable (request ${requestId})`);
    return errorResponse("BAD_GATEWAY", requestId);
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    deps.log(`upload proxy: unexpected upstream redirect (request ${requestId})`);
    return errorResponse("BAD_GATEWAY", requestId);
  }
  const out = new Headers({ "Cache-Control": "no-store" });
  const ct = upstream.headers.get("content-type");
  if (ct) out.set("content-type", ct);
  for (const c of allowedSetCookies(upstream.headers.getSetCookie())) out.append("set-cookie", c);
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: out });
}
