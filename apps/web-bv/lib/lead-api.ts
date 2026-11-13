/**
 * Server side of the lead-gated document flow on dreampetroleumbv.com (DP-042, DP-043; ADR-016).
 *
 *  - The browser posts the short form to this site (`/product-documents/<id>/request`); this
 *    server forwards it to `POST /api/v1/public/leads/document-requests` with the site's proxy key,
 *    the browser's Origin / Sec-Fetch-Site (the API's CSRF check) and the client IP the hosting
 *    edge appended (`X-DP-Client-IP`, DP_TRUSTED_PROXY_HOPS, as on the admin; DP-100).
 *  - The API answers a download grant token. It is kept in an HttpOnly, SameSite=Strict cookie
 *    scoped to that document's download path and never reaches a page, a URL or a log; the
 *    browser only learns the reference, the expiry and the download URL.
 *  - The download route sends the cookie's token to the API in `X-DP-Download-Grant`.
 */
import { isIP } from "node:net";
import {
  DOWNLOAD_GRANT_HEADER,
  ErrorBodySchema,
  LEAD_TEXT_FIELDS,
  LEAD_TEXT_OUTDATED,
  LeadDocumentRequestResponseSchema,
  PUBLIC_LEADS_API,
  type SiteLeadRequestResult,
} from "@dream/contracts";
import { catalogConfig, documentHref } from "./catalog-api";

const TIMEOUT_MS = 10_000;
export const MAX_FORM_BYTES = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Hops of trusted proxies in front of this site (0 locally: no client IP is forwarded). */
export function trustedHops(env: Record<string, string | undefined> = process.env): number {
  const raw = env["DP_TRUSTED_PROXY_HOPS"]?.trim() || "0";
  const hops = Number(raw);
  return Number.isInteger(hops) && hops >= 0 && hops <= 5 ? hops : 0;
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

/** Cookie holding the grant of one document; `__Secure-` on https. */
export function grantCookieName(id: string, secure: boolean): string {
  return `${secure ? "__Secure-" : ""}dp_dlg_${id}`;
}

export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

export function grantCookie(id: string, token: string, maxAgeSec: number, secure: boolean): string {
  const parts = [
    `${grantCookieName(id, secure)}=${token}`,
    `Path=${documentHref(id)}`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readGrant(request: Request, id: string): string | undefined {
  const name = grantCookieName(id, isSecureRequest(request));
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      return TOKEN.test(value) ? value : undefined;
    }
  }
  return undefined;
}

export type LeadSubmitResult =
  | { ok: true; result: SiteLeadRequestResult; cookie: string }
  | {
      ok: false;
      status: number;
      code: string;
      fields: string[];
      retryAfter: string | null;
    };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

/** POST handler body: validates the envelope, forwards the form, sets the grant cookie. */
export async function handleLeadRequest(request: Request, id: string): Promise<Response> {
  if (!UUID.test(id)) return json(404, { code: "NOT_FOUND", fields: [] });
  const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return json(415, { code: "UNSUPPORTED_MEDIA_TYPE", fields: [] });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_FORM_BYTES) {
    return json(413, { code: "PAYLOAD_TOO_LARGE", fields: [] });
  }
  const text = await request.text();
  if (text.length > MAX_FORM_BYTES) return json(413, { code: "PAYLOAD_TOO_LARGE", fields: [] });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { code: "VALIDATION_FAILED", fields: [] });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return json(400, { code: "VALIDATION_FAILED", fields: [] });
  }
  const result = await submitLead(request, { ...(body as Record<string, unknown>), documentId: id });
  if (!result.ok) {
    return json(
      result.status,
      { code: result.code, fields: result.fields },
      result.retryAfter ? { "Retry-After": result.retryAfter } : {},
    );
  }
  return json(201, result.result, { "Set-Cookie": result.cookie });
}

async function submitLead(request: Request, form: Record<string, unknown>): Promise<LeadSubmitResult> {
  const config = catalogConfig();
  const fail = (status: number, code: string): LeadSubmitResult => ({
    ok: false,
    status,
    code,
    fields: [],
    retryAfter: null,
  });
  if (!config) return fail(503, "BAD_GATEWAY");
  const headers: Record<string, string> = {
    "X-DP-Proxy-Key": config.proxyKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin) headers["Origin"] = origin;
  if (fetchSite) headers["Sec-Fetch-Site"] = fetchSite;
  const ip = clientIpFrom(request.headers.get("x-forwarded-for"), trustedHops());
  if (ip) headers["X-DP-Client-IP"] = ip;
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${PUBLIC_LEADS_API}/document-requests`, {
      method: "POST",
      headers,
      body: JSON.stringify(form),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    console.error("lead request: POST failed (network)");
    return fail(502, "BAD_GATEWAY");
  }
  const payload: unknown = await res.json().catch(() => null);
  if (res.status !== 201) {
    const err = ErrorBodySchema.safeParse(payload);
    if (!err.success) return fail(502, "BAD_GATEWAY");
    const details = err.data.error.details.flatMap((d) => (typeof d === "object" ? [d] : []));
    const fields = details.map((d) => d.path);
    // DP-095 D-T7: a text changed since the page was loaded. Not a raw 400: the form fetches the
    // current texts and asks the visitor to read and confirm them again.
    const outdated = details.filter(
      (d) => d.rule === "outdated" && (LEAD_TEXT_FIELDS as readonly string[]).includes(d.path),
    );
    if (res.status === 400 && outdated.length > 0) {
      return { ok: false, status: 409, code: LEAD_TEXT_OUTDATED, fields: outdated.map((d) => d.path), retryAfter: null };
    }
    const status = [400, 403, 404, 413, 429].includes(res.status) ? res.status : 502;
    return {
      ok: false,
      status,
      code: status === 502 ? "BAD_GATEWAY" : err.data.error.code,
      fields,
      retryAfter: res.headers.get("retry-after"),
    };
  }
  const parsed = LeadDocumentRequestResponseSchema.safeParse(payload);
  if (!parsed.success) return fail(502, "BAD_GATEWAY");
  const { reference, grant } = parsed.data;
  const id = String(form["documentId"]);
  const maxAge = (new Date(grant.expiresAt).getTime() - Date.now()) / 1000;
  return {
    ok: true,
    result: {
      reference,
      expiresAt: grant.expiresAt,
      maxDownloads: grant.maxDownloads,
      downloadUrl: documentHref(id),
    },
    cookie: grantCookie(id, grant.token, maxAge, isSecureRequest(request)),
  };
}

/** Header the download route adds for a lead-gated document (only when a grant cookie exists). */
export function grantHeaders(request: Request, id: string): Record<string, string> {
  const token = readGrant(request, id);
  const headers: Record<string, string> = {};
  if (token) headers[DOWNLOAD_GRANT_HEADER] = token;
  const ip = clientIpFrom(request.headers.get("x-forwarded-for"), trustedHops());
  if (ip) headers["X-DP-Client-IP"] = ip;
  return headers;
}
