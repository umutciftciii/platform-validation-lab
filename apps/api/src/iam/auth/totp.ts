/**
 * TOTP (RFC 6238 over RFC 4226 HOTP) with node:crypto only (F1-002, design 4.1).
 *
 * SHA-1, 6 digits, 30-second steps, ±1 step of clock skew, 160-bit secrets. `verifyTotp` returns
 * the matched time step; the caller stores it with a conditional
 * `UPDATE … SET lastUsedStep = :step WHERE lastUsedStep IS NULL OR lastUsedStep < :step`, so the
 * same code (also in parallel) is accepted once (T16). The database refuses a step that goes
 * back (MfaFactor_immutable).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_SKEW_STEPS = 1;
export const TOTP_SECRET_BYTES = 20;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 without padding (what authenticator apps expect). */
export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

/** RFC 4226 HOTP. `algorithm` is exposed for the RFC 6238 test vectors only. */
export function hotp(
  key: Buffer,
  counter: bigint,
  digits = TOTP_DIGITS,
  algorithm: "sha1" | "sha256" | "sha512" = "sha1",
): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const mac = createHmac(algorithm, key).update(msg).digest();
  const offset = (mac[mac.length - 1] as number) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpStep(now: Date): bigint {
  return BigInt(Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS));
}

export function totpCode(key: Buffer, now: Date): string {
  return hotp(key, totpStep(now));
}

/**
 * Checks a code against the steps now-1, now, now+1 and returns the matched step, or null.
 * Steps at or below `lastUsedStep` are never accepted (replay). Every candidate is compared in
 * constant time.
 */
export function verifyTotp(
  key: Buffer,
  code: string,
  now: Date,
  lastUsedStep: bigint | null = null,
): bigint | null {
  if (!/^\d{6}$/.test(code)) return null;
  const given = Buffer.from(code, "utf8");
  const current = totpStep(now);
  let matched: bigint | null = null;
  for (let d = -TOTP_SKEW_STEPS; d <= TOTP_SKEW_STEPS; d++) {
    const step = current + BigInt(d);
    if (step < 0n) continue;
    const expected = Buffer.from(hotp(key, step), "utf8");
    const equal = timingSafeEqual(expected, given);
    if (equal && (lastUsedStep === null || step > lastUsedStep) && matched === null) {
      matched = step;
    }
  }
  return matched;
}

/**
 * otpauth:// URI for the enrolment QR code. The QR is rendered in the browser, so the secret is
 * never sent to a third party.
 */
export function otpauthUri(
  secret: Buffer,
  accountName: string,
  issuer = "Dream Petroleum",
): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
