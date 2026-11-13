/**
 * AES-256-GCM encryption of TOTP secrets with a versioned keyring (F1-002, design 2.9, 4.1).
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
 * Parses IAM_MFA_ENC_KEYS: comma-separated `<version>:<base64url 32-byte key>` entries, e.g.
 * `1:…,2:…`. Versions are positive integers; keys must be 32 bytes and distinct.
 */
export function parseKeyring(value: string | undefined): Keyring {
  if (!value?.trim()) throw new SecretBoxError("IAM_MFA_ENC_KEYS is not set");
  const keys = new Map<number, Buffer>();
  const seen = new Set<string>();
  for (const entry of value.split(",")) {
    const m = /^\s*(\d+):([A-Za-z0-9_-]+)\s*$/.exec(entry);
    if (!m)
      throw new SecretBoxError("IAM_MFA_ENC_KEYS: each entry must be <version>:<base64url key>");
    const version = Number(m[1]);
    const key = Buffer.from(m[2] as string, "base64url");
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new SecretBoxError("IAM_MFA_ENC_KEYS: versions are positive integers");
    }
    if (key.length !== KEY_BYTES)
      throw new SecretBoxError("IAM_MFA_ENC_KEYS: keys must be 32 bytes");
    if (keys.has(version)) throw new SecretBoxError("IAM_MFA_ENC_KEYS: duplicate version");
    const hex = key.toString("hex");
    if (seen.has(hex)) throw new SecretBoxError("IAM_MFA_ENC_KEYS: keys must be distinct");
    seen.add(hex);
    keys.set(version, key);
  }
  return { current: Math.max(...keys.keys()), keys };
}

export function mfaAad(userId: string, factorId: string): string {
  return `${userId}|${factorId}`;
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
