/**
 * AES-256-GCM encryption of TOTP secrets (F1-002, design 2.9, 4.1) and, since DP-288, of AI provider
 * API keys (ADR-030 D5, separate keyring DP_AI_ENC_KEYS) with a versioned keyring.
 *
 * Stored form: `v<version>:<iv>:<ciphertext>:<tag>` (base64url parts; 96-bit random IV, 128-bit
 * tag). The additional authenticated data binds a ciphertext to its row (`userId|factorId`), so a
 * secret copied to another user's factor does not decrypt. New secrets use the highest key
 * version; older versions still decrypt, and `needsReencryption` tells the rotation job which
 * rows to rewrite.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class SecretBoxError extends Error {
  override name = "SecretBoxError";
}

export interface Keyring {
  current: number;
  keys: ReadonlyMap<number, Buffer>;
}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT = /^v(\d+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/;

/**
 * Parses a keyring variable: comma-separated `<version>:<base64url 32-byte key>` entries, e.g.
 * `1:…,2:…`. Versions are positive integers; keys must be 32 bytes and distinct. IAM_MFA_ENC_KEYS
 * (TOTP secrets) and, since DP-288, DP_AI_ENC_KEYS (AI provider keys) use the same format; errors
 * name the variable, never a value.
 */
export function parseKeyring(value: string | undefined, variable = "IAM_MFA_ENC_KEYS"): Keyring {
  if (!value?.trim()) throw new SecretBoxError(`${variable} is not set`);
  const keys = new Map<number, Buffer>();
  const seen = new Set<string>();
  for (const entry of value.split(",")) {
    const m = /^\s*(\d+):([A-Za-z0-9_-]+)\s*$/.exec(entry);
    if (!m) throw new SecretBoxError(`${variable}: each entry must be <version>:<base64url key>`);
    const version = Number(m[1]);
    const key = Buffer.from(m[2] as string, "base64url");
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new SecretBoxError(`${variable}: versions are positive integers`);
    }
    if (key.length !== KEY_BYTES) throw new SecretBoxError(`${variable}: keys must be 32 bytes`);
    if (keys.has(version)) throw new SecretBoxError(`${variable}: duplicate version`);
    const hex = key.toString("hex");
    if (seen.has(hex)) throw new SecretBoxError(`${variable}: keys must be distinct`);
    seen.add(hex);
    keys.set(version, key);
  }
  return { current: Math.max(...keys.keys()), keys };
}

export function mfaAad(userId: string, factorId: string): string {
  return `${userId}|${factorId}`;
}

/** DP-288 (ADR-030 D5): binds an AI provider key's ciphertext to its row and provider. */
export function aiCredentialAad(credentialId: string, provider: string): string {
  return `ai-credential|${credentialId}|${provider}`;
}

export function encryptSecret(keyring: Keyring, plaintext: Buffer, aad: string): string {
  const key = keyring.keys.get(keyring.current);
  if (!key) throw new SecretBoxError("current key missing");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${keyring.current}:${iv.toString("base64url")}:${ct.toString("base64url")}:${tag.toString("base64url")}`;
}

export function decryptSecret(keyring: Keyring, stored: string, aad: string): Buffer {
  const m = FORMAT.exec(stored);
  if (!m) throw new SecretBoxError("malformed ciphertext");
  const key = keyring.keys.get(Number(m[1]));
  if (!key) throw new SecretBoxError("unknown key version");
  const iv = Buffer.from(m[2] as string, "base64url");
  const tag = Buffer.from(m[4] as string, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES)
    throw new SecretBoxError("malformed ciphertext");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(m[3] as string, "base64url")),
      decipher.final(),
    ]);
  } catch {
    throw new SecretBoxError("decryption failed");
  }
}

export function needsReencryption(keyring: Keyring, stored: string): boolean {
  const m = FORMAT.exec(stored);
  return !m || Number(m[1]) !== keyring.current;
}
