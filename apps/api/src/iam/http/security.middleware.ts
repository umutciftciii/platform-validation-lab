/**
 * The API side of the trust boundary (F1-002 Group 2; ADR-013 D2, D4; design 2.2, 2.5, 5.2).
 * Runs before routing, on every request, in this order:
 *
 *  1. `/health*` is served without a key (liveness, readiness, key-slot metrics).
 *  2. Everything else must be `/api/v1/*` with a known `X-DP-Proxy-Key`; otherwise 404, so the
 *     surface is not revealed (AC-PX-1). The app comes from the key only (AC-PX-2).
 *  3. Each app reaches only its own paths: admin `/api/v1/auth/staff/*` and `/api/v1/admin/*`,
 *     the sites `/api/v1/auth/member/*` and (PM-3) the public content `/api/v1/public/*`, whose
 *     site is the one of the key; anything else 404 (NT-P2).
 *  4. CSRF for state-changing methods: an `Origin` allowed for that app, or no `Origin` with
 *     `Sec-Fetch-Site: same-origin`; POST bodies must be `application/json` (403
 *     AUTH_CSRF_REJECTED; NT-C1..3, NT-P8). No query string on state-changing requests (NT-K4).
 *  5. Body: at most 16 KB of JSON (413, 400). Nest's own body parser is off.
 *     Two exceptions, both from the admin app and streamed by their controllers: (PM-2)
 *     `PUT /api/v1/admin/catalog/products/:id/images` takes a raw JPEG/PNG/WebP body of at most
 *     10 MB; (PM-5) `PUT /api/v1/admin/catalog/documents/:id/revisions` a raw PDF of at most
 *     20 MB. The same Origin check applies, only the content type differs, and the body is not
 *     read here.
 *  6. Only this app's cookies are kept; the client IP comes only from `X-DP-Client-IP`. `Host`,
 *     `X-Forwarded-*` and `Forwarded` are never read (AC-PX-5; Express `trust proxy` is off).
 *
 * Nothing here logs a header value; key failures only increment a counter (NT-P12).
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";
import { ipPrefix } from "../auth/ip-prefix.js";
import type { ApiConfig } from "./api-config.js";
import { writeError } from "./api-error.js";
import { APP_COOKIES, readCookies } from "./cookies.js";
import { matchProxyKey, type AuthAppValue, type ProxyKeyMetrics } from "./proxy-keys.js";
import type { RequestWithContext } from "./request-context.js";

export const MAX_BODY_BYTES = 16 * 1024;

const APP_PATHS: Readonly<Record<AuthAppValue, readonly string[]>> = {
  ADMIN: ["/api/v1/auth/staff/", "/api/v1/admin/"],
  WEB_BV: ["/api/v1/auth/member/", "/api/v1/public/"],
  WEB_CORPORATE: ["/api/v1/auth/member/", "/api/v1/public/"],
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const REQUEST_ID = /^[A-Za-z0-9._-]{8,100}$/;

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** PM-2: the admin image upload, one of the two routes with a non-JSON body. */
export const IMAGE_UPLOAD_PATH = /^\/api\/v1\/admin\/catalog\/products\/[^/]+\/images$/;
export const IMAGE_UPLOAD_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** Whether this request is the admin image upload (method, path and app all match). */
export function isImageUpload(app: AuthAppValue, method: string, pathname: string): boolean {
  return app === "ADMIN" && method === "PUT" && IMAGE_UPLOAD_PATH.test(pathname);
}

/** PM-5: the admin upload of a technical document revision (raw PDF). */
export const DOCUMENT_UPLOAD_PATH = /^\/api\/v1\/admin\/catalog\/documents\/[^/]+\/revisions$/;
export const DOCUMENT_UPLOAD_TYPES: ReadonlySet<string> = new Set(["application/pdf"]);
export const DOCUMENT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

export function isDocumentUpload(app: AuthAppValue, method: string, pathname: string): boolean {
  return app === "ADMIN" && method === "PUT" && DOCUMENT_UPLOAD_PATH.test(pathname);
}

/** The raw-body upload this request is, with its accepted types and size, or null. */
export function rawUpload(
  app: AuthAppValue,
  method: string,
  pathname: string,
): { types: ReadonlySet<string>; maxBytes: number } | null {
  if (isImageUpload(app, method, pathname)) {
    return { types: IMAGE_UPLOAD_TYPES, maxBytes: IMAGE_UPLOAD_MAX_BYTES };
  }
  if (isDocumentUpload(app, method, pathname)) {
    return { types: DOCUMENT_UPLOAD_TYPES, maxBytes: DOCUMENT_UPLOAD_MAX_BYTES };
  }
  return null;
}

export function isHealthPath(pathname: string): boolean {
  return pathname === "/health" || pathname.startsWith("/health/");
}

/** The CSRF decision of design 2.5 point 2, for one app. */
export function csrfAllows(
  method: string,
  origin: string | undefined,
  secFetchSite: string | undefined,
  contentType: string | undefined,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (SAFE_METHODS.has(method)) return true;
  if (origin !== undefined) {
    if (!allowedOrigins.has(origin)) return false;
  } else if (secFetchSite !== "same-origin") {
    return false;
  }
  if (BODY_METHODS.has(method)) {
    const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") return false;
  }
  return true;
}

type Next = (error?: unknown) => void;

async function readJsonBody(
  req: IncomingMessage,
): Promise<
  { ok: true; body: unknown } | { ok: false; code: "PAYLOAD_TOO_LARGE" | "VALIDATION_FAILED" }
> {
  const declared = Number(header(req, "content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    req.resume();
    return { ok: false, code: "PAYLOAD_TOO_LARGE" };
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      req.resume();
      return { ok: false, code: "PAYLOAD_TOO_LARGE" };
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, code: "VALIDATION_FAILED" };
  }
}

export function createSecurityMiddleware(config: ApiConfig, metrics: ProxyKeyMetrics) {
  return (req: IncomingMessage & RequestWithContext, res: ServerResponse, next: Next): void => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://api.invalid");
      const pathname = url.pathname;
      if (isHealthPath(pathname)) {
        next();
        return;
      }
      const method = (req.method ?? "GET").toUpperCase();
      const generatedId = randomUUID();

      const match = pathname.startsWith("/api/v1/")
        ? matchProxyKey(config.proxyKeys, header(req, "x-dp-proxy-key"))
        : null;
      if (!match) {
        if (pathname.startsWith("/api/v1/")) metrics.rejected++;
        writeError(res, "NOT_FOUND", generatedId);
        return;
      }
      metrics.accepted[match.app][match.slot]++;
      const proxiedId = header(req, "x-dp-request-id");
      const requestId = proxiedId && REQUEST_ID.test(proxiedId) ? proxiedId : generatedId;

      if (!APP_PATHS[match.app].some((p) => pathname.startsWith(p))) {
        writeError(res, "NOT_FOUND", requestId);
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      const upload = rawUpload(match.app, method, pathname);
      const contentType = header(req, "content-type");
      const uploadType = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

      if (
        !csrfAllows(
          method,
          header(req, "origin"),
          header(req, "sec-fetch-site"),
          // The upload route checks its own content type below; CSRF still needs the Origin.
          upload ? "application/json" : contentType,
          config.allowedOrigins[match.app],
        )
      ) {
        writeError(res, "AUTH_CSRF_REJECTED", requestId);
        return;
      }
      if (!SAFE_METHODS.has(method) && url.search !== "") {
        writeError(res, "VALIDATION_FAILED", requestId, [{ path: "(query)", rule: "not_allowed" }]);
        return;
      }

      let body: unknown = {};
      if (upload) {
        // The controller streams the body with the same limit; nothing is buffered here.
        if (!upload.types.has(uploadType)) {
          req.resume();
          writeError(res, "UNSUPPORTED_MEDIA_TYPE", requestId);
          return;
        }
        const declared = Number(header(req, "content-length") ?? "0");
        if (Number.isFinite(declared) && declared > upload.maxBytes) {
          req.resume();
          writeError(res, "PAYLOAD_TOO_LARGE", requestId);
          return;
        }
        body = undefined;
      } else if (BODY_METHODS.has(method)) {
        const read = await readJsonBody(req);
        if (!read.ok) {
          const details =
            read.code === "VALIDATION_FAILED" ? [{ path: "(root)", rule: "invalid_json" }] : [];
          writeError(res, read.code, requestId, details);
          return;
        }
        body = read.body;
      }

      const rawIp = header(req, "x-dp-client-ip")?.trim();
      const clientIp = rawIp && isIP(rawIp) ? rawIp : null;
      const ua = header(req, "user-agent");
      req.body = body;
      req.dp = {
        app: match.app,
        slot: match.slot,
        requestId,
        clientIp,
        ipPrefix: clientIp ? ipPrefix(clientIp) : null,
        userAgent: ua ? ua.slice(0, 256) : null,
        cookies: readCookies(header(req, "cookie"), APP_COOKIES[match.app]),
      };
      next();
    })().catch((error: unknown) => next(error));
  };
}
