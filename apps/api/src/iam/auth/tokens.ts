/**
 * Opaque tokens and recovery codes (F1-002, design 4.2, 5.2, 6; T15).
 *
 * - Session ids and single-use tokens: 32 random bytes (256 bits), base64url; only their SHA-256
 *   is stored. A token is accepted only from a request body or cookie, never from a URL path or
 *   query (enforced by the Group 2 endpoints; NT-K4).
 * - Recovery codes: 10 Crockford base32 characters (50 bits), stored as HMAC-SHA-256 with
 *   IAM_HMAC_KEY, so a database dump does not allow an offline guess without the key.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { hmacHex } from "./hmac.js";

export const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/** SHA-256 hex of a token: what UserCredentialToken.tokenHash and Session.tokenHash store. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Crockford base32 alphabet: no I, L, O, U. */
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECOVERY_CODE_LENGTH = 10;
export const RECOVERY_CODE_COUNT = 10;

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let code = "";
    for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) code += CROCKFORD[randomInt(CROCKFORD.length)];
    codes.add(code);
  }
  return [...codes];
}

/** Display form: `ABCDE-FGHJK`. */
export function formatRecoveryCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * Canonical form of user input: upper case, separators removed, Crockford aliases folded
 * (I, L -> 1; O -> 0). Returns null if it cannot be a recovery code.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (code.length !== RECOVERY_CODE_LENGTH) return null;
  for (const ch of code) if (!CROCKFORD.includes(ch)) return null;
  return code;
}

export function hashRecoveryCode(hmacKey: Buffer, code: string): string {
  return hmacHex(hmacKey, "recovery_code", code);
}
