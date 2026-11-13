/**
 * Authentication secrets from the environment (F1-002, design 2.9, A7). Missing or weak secrets
 * are an error: Group 2 calls `loadAuthSecrets` at API start-up so the API does not start without
 * them (NT-L4). In Group 1 nothing calls it at start-up yet, so the running stacks need no new
 * environment variables.
 *
 * - IAM_MFA_ENC_KEYS: versioned AES-256-GCM keyring for TOTP secrets (secret-box.ts).
 * - IAM_HMAC_KEY: base64url, at least 32 bytes; recovery-code hashes and throttle keys.
 * Values are never logged; errors name the variable only.
 */
import { parseKeyring, type Keyring } from "./secret-box.js";

export class AuthSecretsError extends Error {
  override name = "AuthSecretsError";
}

export interface AuthSecrets {
  mfaKeyring: Keyring;
  hmacKey: Buffer;
}

export const MIN_HMAC_KEY_BYTES = 32;

export function parseHmacKey(value: string | undefined): Buffer {
  if (!value?.trim()) throw new AuthSecretsError("IAM_HMAC_KEY is not set");
  if (!/^[A-Za-z0-9_-]+$/.test(value.trim())) {
    throw new AuthSecretsError("IAM_HMAC_KEY must be base64url");
  }
  const key = Buffer.from(value.trim(), "base64url");
  if (key.length < MIN_HMAC_KEY_BYTES) {
    throw new AuthSecretsError(`IAM_HMAC_KEY must be at least ${MIN_HMAC_KEY_BYTES} bytes`);
  }
  return key;
}

export function loadAuthSecrets(env: NodeJS.ProcessEnv = process.env): AuthSecrets {
  let mfaKeyring: Keyring;
  try {
    mfaKeyring = parseKeyring(env["IAM_MFA_ENC_KEYS"]);
  } catch (error) {
    throw new AuthSecretsError((error as Error).message);
  }
  const hmacKey = parseHmacKey(env["IAM_HMAC_KEY"]);
  for (const key of mfaKeyring.keys.values()) {
    if (key.equals(hmacKey)) {
      throw new AuthSecretsError("IAM_HMAC_KEY must differ from every IAM_MFA_ENC_KEYS key");
    }
  }
  return { mfaKeyring, hmacKey };
}
