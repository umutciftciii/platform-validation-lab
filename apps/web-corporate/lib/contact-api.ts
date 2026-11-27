/**
 * COM-4 (DP-030): server side of the dreampetroleum.com contact form — web-bv's (DP-151, DP-221,
 * apps/web-bv/lib/contact-api.ts) with this site's own key. The browser posts the form to this
 * site (`/lead-form/contact`); this server forwards it to
 * `POST /api/v1/public/leads/contact-messages` with `DP_PROXY_KEY_WEB_CORPORATE` (the API derives
 * the site from the key, so the lead is a CORPORATE lead with the CONTACT_FORM source), the
 * browser's Origin / Sec-Fetch-Site (the API's CSRF check) and the client IP the hosting edge
 * appended (the API's rate limit). The API validates the fields, the honeypot, the notice
 * version and its language; nothing about the stored message comes back, there is no cookie.
 *
 * Production gate (DP-095 D-T5, DP-298): while the privacy texts may not be published in this
 * environment the route is a 404, like the page shows no working form.
 */
import {
  ErrorBodySchema,
  LEAD_TEXT_FIELDS,
  LEAD_TEXT_LOCALE_MISMATCH,
  LEAD_TEXT_LOCALE_MISMATCH_CODE,
  LEAD_TEXT_OUTDATED,
  LeadContactMessageResponseSchema,
  PUBLIC_LEADS_API,
} from "@dream/contracts";

import { apiConfig } from "@/lib/api";
import { clientIpFrom, trustedHops } from "@/lib/client-ip";
import { MAX_CONTACT_BYTES } from "@/lib/contact-form";
import { legalTextsSnapshot } from "@/lib/legal-texts-api";
import { sitePrivacy } from "@/lib/privacy";

const TIMEOUT_MS = 10_000;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

/** POST handler body: validates the envelope, forwards the form, answers only what happened. */
export async function handleContactMessage(request: Request): Promise<Response> {
  // Same production gate as the page that shows the form.
  if (!(await sitePrivacy()).gate.publish) return json(404, { code: "NOT_FOUND", fields: [] });
  const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return json(415, { code: "UNSUPPORTED_MEDIA_TYPE", fields: [] });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_CONTACT_BYTES) {
    return json(413, { code: "PAYLOAD_TOO_LARGE", fields: [] });
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_CONTACT_BYTES) {
    return json(413, { code: "PAYLOAD_TOO_LARGE", fields: [] });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { code: "VALIDATION_FAILED", fields: [] });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return json(400, { code: "VALIDATION_FAILED", fields: [] });
  }

  const config = apiConfig();
  if (!config) return json(503, { code: "BAD_GATEWAY", fields: [] });
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
    res = await fetch(`${config.apiUrl}${PUBLIC_LEADS_API}/contact-messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    console.error("contact message: POST failed (network)");
    return json(502, { code: "BAD_GATEWAY", fields: [] });
  }
  const payload: unknown = await res.json().catch(() => null);
  if (res.status === 201) {
    // DP-221: 201 means the message is stored as a CRM lead; nothing else decides the answer.
    return LeadContactMessageResponseSchema.safeParse(payload).success
      ? json(201, { received: true })
      : json(502, { code: "BAD_GATEWAY", fields: [] });
  }
  const err = ErrorBodySchema.safeParse(payload);
  if (!err.success) return json(502, { code: "BAD_GATEWAY", fields: [] });
  const details = err.data.error.details.flatMap((d) => (typeof d === "object" ? [d] : []));
  // DP-095 D-T7: the notice changed since the page was loaded; the visitor reloads and sends again.
  const outdated = details.filter(
    (d) => d.rule === "outdated" && (LEAD_TEXT_FIELDS as readonly string[]).includes(d.path),
  );
  if (res.status === 400 && outdated.length > 0) {
    // DP-298: a newer version was published; read past the cache so the reloaded page shows it.
    await legalTextsSnapshot(Date.now(), { fresh: true });
    return json(409, { code: LEAD_TEXT_OUTDATED, fields: outdated.map((d) => d.path) });
  }
  // ML-10: a notice of another language than the form's: refused, nothing stored (fail closed).
  if (res.status === 400 && details.some((d) => d.rule === LEAD_TEXT_LOCALE_MISMATCH)) {
    return json(400, { code: LEAD_TEXT_LOCALE_MISMATCH_CODE, fields: [] });
  }
  const status = [400, 403, 404, 413, 429].includes(res.status) ? res.status : 502;
  const retryAfter = res.headers.get("retry-after");
  return json(
    status,
    {
      code: status === 502 ? "BAD_GATEWAY" : err.data.error.code,
      fields: details.map((d) => d.path),
    },
    retryAfter ? { "Retry-After": retryAfter } : {},
  );
}
