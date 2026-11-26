/**
 * DP-289 (ADR-030 D5): the only reader of a provider key's ciphertext. dp_app has no SELECT on
 * "AiProviderCredential"."ciphertext" (migration dp_288); `ai_credential_ciphertext` hands out the
 * still-encrypted value while AI is on (migration dp_289: ACTIVE, PENDING_TEST or DISABLED). It
 * runs in the caller's staff transaction; decryption happens here, in the API, with
 * DP_AI_ENC_KEYS. The plaintext is returned to the caller for one provider call and never stored,
 * logged or audited.
 */
import type { Db } from "../iam/db.js";
import { aiCredentialAad, decryptSecret, type Keyring } from "../iam/auth/secret-box.js";

export async function readCredentialKey(
  tx: Db,
  keyring: Keyring,
  credentialId: string,
  provider: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ c: string | null }[]>`
    SELECT ai_credential_ciphertext(${credentialId}::uuid) AS "c"`;
  const stored = rows[0]?.c ?? null;
  if (stored === null) return null;
  return decryptSecret(keyring, stored, aiCredentialAad(credentialId, provider)).toString("utf8");
}
