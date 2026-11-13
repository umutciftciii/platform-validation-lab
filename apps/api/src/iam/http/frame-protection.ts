/**
 * Clickjacking protection for every API response (DP-014). The API only serves JSON, so no
 * response may be framed or load anything: `frame-ancestors 'none'` for current browsers,
 * `X-Frame-Options: DENY` for older ones. Registered before the security middleware so 404s,
 * CSRF refusals and health responses carry the headers too.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export const API_FRAME_PROTECTION_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};

export function frameProtection(_req: IncomingMessage, res: ServerResponse, next: () => void) {
  for (const [name, value] of Object.entries(API_FRAME_PROTECTION_HEADERS)) {
    res.setHeader(name, value);
  }
  next();
}
