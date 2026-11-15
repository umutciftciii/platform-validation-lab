/**
 * DP-173 (ADR-022 D5): signed links of the company catalogue preview.
 *
 *   v1.<session id>.<user id>.<site>.<expiry ms>.<HMAC-SHA256 hex>
 *
 * The link names the staff session that issued it and its user, never the session token. It is
 * bound to one site and lives at most CATALOG_PREVIEW_TTL_MS. A valid signature is necessary but
 * not sufficient: every preview request also asks the database whether that session is still
 * live and its user still holds `product_proposal:review` on the site (preview.service.ts).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { CATALOG_PREVIEW_TTL_MS } from "@dream/contracts";

const TOKEN =
  /^v1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(BV|CORPORATE)\.(\d{10,13})\.([0-9a-f]{64})$/;

export interface PreviewClaims {
  sessionId: string;
  userId: string;
  siteKey: "BV" | "CORPORATE";
  expiresAt: Date;
}

function mac(key: Buffer, sessionId: string, userId: string, siteKey: string, exp: number): string {
  return createHmac("sha256", key)
    .update("dp:catalog_preview\0")
    .update(`${sessionId}\0${userId}\0${siteKey}\0${exp}`, "utf8")
    .digest("hex");
}

export function issueCatalogPreviewToken(
  key: Buffer,
  claims: { sessionId: string; userId: string; siteKey: "BV" | "CORPORATE" },
  now: Date,
  ttlMs: number = CATALOG_PREVIEW_TTL_MS,
): { token: string; expiresAt: Date } {
  const exp = now.getTime() + Math.min(ttlMs, CATALOG_PREVIEW_TTL_MS);
  const sid = claims.sessionId.toLowerCase();
  const uid = claims.userId.toLowerCase();
  return {
    token: `v1.${sid}.${uid}.${claims.siteKey}.${exp}.${mac(key, sid, uid, claims.siteKey, exp)}`,
    expiresAt: new Date(exp),
  };
}

/** The claims of a well-signed, unexpired token for this site; null for anything else. */
export function verifyCatalogPreviewToken(
  key: Buffer,
  token: string,
  siteKey: string,
  now: Date,
): PreviewClaims | null {
  const m = TOKEN.exec(token);
  if (!m) return null;
  const [, sessionId, userId, site, expRaw, given] = m as unknown as [
    string,
    string,
    string,
    "BV" | "CORPORATE",
    string,
    string,
  ];
  const exp = Number(expRaw);
  const expected = Buffer.from(mac(key, sessionId, userId, site, exp), "hex");
  const presented = Buffer.from(given, "hex");
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null;
  if (site !== siteKey) return null;
  if (exp <= now.getTime() || exp > now.getTime() + CATALOG_PREVIEW_TTL_MS) return null;
  return { sessionId, userId, siteKey: site, expiresAt: new Date(exp) };
}
