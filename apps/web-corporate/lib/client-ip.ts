/**
 * COM-4: the client IP the hosting edge appended (`DP_TRUSTED_PROXY_HOPS` entries from the right
 * of X-Forwarded-For), passed to the API's rate limit; nothing else of the request is trusted
 * (web-bv lib/lead-api.ts). Server only (node:net); pure, so `node --test` runs it as is.
 */
import { isIP } from "node:net";

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
