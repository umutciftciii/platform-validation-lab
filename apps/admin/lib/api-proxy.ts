/**
 * Server-side proxy from the admin app to the API (F1-002 Group 2; ADR-013 D2, design 2.4).
 * Zone Z1: it forwards, strips and identifies; it makes no security decision (the API decides).
 *
 * Contract (AC-PX-6):
 * - Paths: only `/api/v1/auth/staff/*` and `/api/v1/admin/*`; anything else 404 here.
 * - Request headers: client `X-DP-*`, `X-Forwarded-*`, `Forwarded`, `X-Real-IP`, `Via` and all
 *   others are dropped. Forwarded: Origin, Sec-Fetch-Site, Content-Type, Accept, User-Agent,
 *   Accept-Language. Added: X-DP-Proxy-Key, X-DP-Client-IP, X-DP-Request-Id.
 * - Cookies: only `__Host-dp_admin_session` and `__Host-dp_admin_challenge`, both ways.
 * - Body: at most 16 KB (larger on the routes named below), POST only as `application/json`
 *   (413 / 415).
 * - Client IP: from the hosting edge's `X-Forwarded-For`, counted DP_TRUSTED_PROXY_HOPS from the
 *   right; with 0 hops (local development) none is sent.
 * - `Cache-Control: no-store`; 10 s timeout (longer on the routes named below); an unreachable or
 *   too slow API gives a generic 502.
 * - DP-227: the lead CSV export (`LEAD_EXPORT_PATH`) streams through unbuffered (bounded memory
 *   for large files) and may take up to 120 s; every other response is read whole, as before.
 * - ML-13b (DP-244): the translation package dry run and import accept a JSON body of up to 4 MB
 *   (`TRANSLATION_PACKAGE_BODY_PATH`, the API's own limit of these two routes); the import may
 *   take up to 90 s (its API transaction allows 60 s plus 10 s waiting for a connection), the
 *   export and the dry run up to 60 s. Every other route keeps 16 KB and 10 s.
 * - Logs: never a body, cookie or key; only the request id on upstream failure.
 *
 * The key is read from the server environment at request time (DP_PROXY_KEY_ADMIN, never a
 * NEXT_PUBLIC_ variable), so it cannot end up in the client bundle (NT-P11).
 */
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import {
  ADMIN_CHALLENGE_COOKIE,
  ADMIN_SESSION_COOKIE,
  errorBody,
  type ErrorCode,
  ERROR_STATUS,
  LEAD_EXPORT_PATH,
  SEO_REDIRECT_IMPORT_MAX_BODY_BYTES,
  SEO_REDIRECT_IMPORT_PATH,
  TRANSLATION_PACKAGE_API,
  LEGAL_TEXT_BODY_PATH,
  LEGAL_TEXT_MAX_BODY_BYTES,
  TRANSLATION_PACKAGE_BODY_PATH,
  TRANSLATION_PACKAGE_MAX_BODY_BYTES,
} from "@dream/contracts";

export const MAX_BODY_BYTES = 16 * 1024;

/**
 * DP-212: the body limit of a POST: 16 KB, except the redirect CSV import (320 KB) and, ML-13b,
 * the translation package dry run and import (4 MB) — the same limits the API applies to those
 * routes.
 */
export function bodyLimit(pathname: string): number {
  if (SEO_REDIRECT_IMPORT_PATH.test(pathname)) return SEO_REDIRECT_IMPORT_MAX_BODY_BYTES;
  if (TRANSLATION_PACKAGE_BODY_PATH.test(pathname)) return TRANSLATION_PACKAGE_MAX_BODY_BYTES;
  // DP-298: legal-text drafts (the privacy policy may be up to 60 000 characters).
  if (LEGAL_TEXT_BODY_PATH.test(pathname)) return LEGAL_TEXT_MAX_BODY_BYTES;
  return MAX_BODY_BYTES;
}
export const UPSTREAM_TIMEOUT_MS = 10_000;
/** DP-227: the lead CSV export streams a larger body. */
export const EXPORT_TIMEOUT_MS = 120_000;
/** ML-13b: the translation package export and dry run (whole-site reads, up to 20 000 units). */
export const TRANSLATION_PACKAGE_TIMEOUT_MS = 60_000;
/**
 * ML-13b: the translation package import — one API transaction of at most 60 s that may wait
 * 10 s for a connection, plus a margin, so the proxy does not give up before the API answers.
 */
export const TRANSLATION_IMPORT_TIMEOUT_MS = 90_000;

/** How long the proxy waits for the API on this path. */
export function upstreamTimeout(pathname: string): number {
  if (isStreamedPath(pathname)) return EXPORT_TIMEOUT_MS;
  if (pathname === `${TRANSLATION_PACKAGE_API}/import`) return TRANSLATION_IMPORT_TIMEOUT_MS;
  if (
    pathname === `${TRANSLATION_PACKAGE_API}/export` ||
    pathname === `${TRANSLATION_PACKAGE_API}/dry-run`
  ) {
    return TRANSLATION_PACKAGE_TIMEOUT_MS;
  }
  return UPSTREAM_TIMEOUT_MS;
}

/** DP-227: the one path whose response streams through unbuffered. */
export function isStreamedPath(pathname: string): boolean {
  return pathname === LEAD_EXPORT_PATH;
}
export const ALLOWED_COOKIES: readonly string[] = [ADMIN_SESSION_COOKIE, ADMIN_CHALLENGE_COOKIE];
const FORWARDED_HEADERS = [
  "origin",
  "sec-fetch-site",
  "content-type",
  "accept",
  "user-agent",
  "accept-language",
] as const;
const PATH = /^\/api\/v1\/(?:auth\/staff|admin)\/[A-Za-z0-9._~/-]+$/;
const METHODS = new Set(["GET", "POST", "DELETE"]);
const KEY = /^[A-Za-z0-9_-]{43,}$/;

export interface ProxyConfig {
  apiUrl: string;
  proxyKey: string;
  trustedHops: number;
}

export class ProxyConfigError extends Error {
  override name = "ProxyConfigError";
}

/** Reads and checks the proxy's environment; errors name variables, never values. */
export function loadProxyConfig(env: Record<string, string | undefined>): ProxyConfig {
  const apiUrl = env["DP_API_URL"]?.trim();
  if (!apiUrl) throw new ProxyConfigError("DP_API_URL is not set");
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new ProxyConfigError("DP_API_URL is not a URL");
  }
  const deployEnv = env["DP_DEPLOY_ENV"]?.trim() || "local";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && deployEnv === "local")) {
    // Ö2: TLS between proxy and API outside local development; certificates are verified
    // (Node's default; a private CA comes in through NODE_EXTRA_CA_CERTS).
    throw new ProxyConfigError("DP_API_URL must use https outside local development");
  }
  const proxyKey = env["DP_PROXY_KEY_ADMIN"]?.trim() ?? "";
  if (!KEY.test(proxyKey)) {
    throw new ProxyConfigError(
      "DP_PROXY_KEY_ADMIN is missing or shorter than 43 base64url characters",
    );
  }
  const hopsRaw = env["DP_TRUSTED_PROXY_HOPS"]?.trim() || "0";
  const trustedHops = Number(hopsRaw);
  if (!Number.isInteger(trustedHops) || trustedHops < 0 || trustedHops > 5) {
    throw new ProxyConfigError("DP_TRUSTED_PROXY_HOPS must be an integer from 0 to 5");
  }
  return { apiUrl: url.origin, proxyKey, trustedHops };
}

export function errorResponse(code: ErrorCode, requestId: string): Response {
  return new Response(JSON.stringify(errorBody(code, requestId)), {
    status: ERROR_STATUS[code],
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** The client address the edge appended, `hops` entries from the right of X-Forwarded-For. */
export function clientIpFrom(forwardedFor: string | null, hops: number): string | null {
  if (hops < 1 || !forwardedFor) return null;
  const list = forwardedFor
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const candidate = list[list.length - hops];
  return candidate && isIP(candidate) ? candidate : null;
}

export function filterCookieHeader(header: string | null): string | null {
  if (!header) return null;
  const kept = header
    .split(";")
    .map((p) => p.trim())
    .filter((p) => ALLOWED_COOKIES.includes(p.slice(0, p.indexOf("=")).trim()));
  return kept.length ? kept.join("; ") : null;
}

export function allowedSetCookies(values: readonly string[]): string[] {
  return values.filter((v) => ALLOWED_COOKIES.includes(v.slice(0, v.indexOf("=")).trim()));
}

async function readBody(request: Request, maxBytes: number): Promise<Uint8Array | "too_large"> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return "too_large";
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export interface ProxyDeps {
  fetch: typeof fetch;
  log: (line: string) => void;
  /** The wait per path; `upstreamTimeout` unless a test shortens it. */
  timeout?: (pathname: string) => number;
}

export async function proxyRequest(
  request: Request,
  config: ProxyConfig,
  deps: ProxyDeps,
): Promise<Response> {
  const requestId = randomUUID();
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (!PATH.test(url.pathname) || url.pathname.includes("..") || !METHODS.has(method)) {
    return errorResponse("NOT_FOUND", requestId);
  }

  let body: Uint8Array | undefined;
  if (method === "POST") {
    const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") return errorResponse("UNSUPPORTED_MEDIA_TYPE", requestId);
    const read = await readBody(request, bodyLimit(url.pathname));
    if (read === "too_large") return errorResponse("PAYLOAD_TOO_LARGE", requestId);
    body = read;
  } else if (
    request.headers.get("content-length") &&
    Number(request.headers.get("content-length")) > 0
  ) {
    return errorResponse("PAYLOAD_TOO_LARGE", requestId);
  }

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const v = request.headers.get(name);
    if (v !== null) headers.set(name, v);
  }
  const cookie = filterCookieHeader(request.headers.get("cookie"));
  if (cookie) headers.set("cookie", cookie);
  headers.set("x-dp-proxy-key", config.proxyKey);
  headers.set("x-dp-request-id", requestId);
  const ip = clientIpFrom(request.headers.get("x-forwarded-for"), config.trustedHops);
  if (ip) headers.set("x-dp-client-ip", ip);

  let upstream: Response;
  try {
    upstream = await deps.fetch(`${config.apiUrl}${url.pathname}${url.search}`, {
      method,
      headers,
      ...(body ? { body: body as BodyInit } : {}),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout((deps.timeout ?? upstreamTimeout)(url.pathname)),
    });
  } catch {
    deps.log(`api proxy: upstream unavailable (request ${requestId})`);
    return errorResponse("BAD_GATEWAY", requestId);
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    deps.log(`api proxy: unexpected upstream redirect (request ${requestId})`);
    return errorResponse("BAD_GATEWAY", requestId);
  }

  const out = new Headers({ "Cache-Control": "no-store" });
  // PM-2: image responses keep their nosniff and inline-disposition headers.
  for (const name of [
    "content-type",
    "retry-after",
    "x-content-type-options",
    "content-disposition",
    "x-dp-export-rows",
  ]) {
    const v = upstream.headers.get(name);
    if (v !== null) out.set(name, v);
  }
  for (const c of allowedSetCookies(upstream.headers.getSetCookie())) out.append("set-cookie", c);
  if (isStreamedPath(url.pathname) && upstream.ok && upstream.body) {
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }
  const payload = upstream.status === 204 ? null : await upstream.arrayBuffer();
  return new Response(payload, { status: upstream.status, headers: out });
}
