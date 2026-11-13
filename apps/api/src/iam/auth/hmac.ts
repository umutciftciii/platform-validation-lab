/**
 * Keyed digests with IAM_HMAC_KEY (F1-002, design 2.9, 3.2, 4.2): recovery-code hashes and the
 * AuthThrottle bucket keys. Every use has its own domain label, so a digest of one kind can never
 * be replayed as another. Output: 64 lowercase hex characters.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type HmacDomain =
  | "recovery_code"
  | "throttle_account"
  | "throttle_account_ip"
  | "throttle_ip"
  | "throttle_step_up"
  // DP-042 (ADR-016 D3, D7): public rate-limit buckets and the IP prefix stored with a lead request.
  | "public_rate"
  | "lead_ip_prefix";

export function hmacHex(key: Buffer, domain: HmacDomain, value: string): string {
  return createHmac("sha256", key).update(`dp:${domain}\0`).update(value, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
export function digestEquals(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
