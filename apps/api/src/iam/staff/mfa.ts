/**
 * Second-factor checks against the database (F1-002 Group 2; design 4.1, 4.2; T16).
 *
 * - TOTP: the confirmed factor's secret is decrypted with the versioned keyring and checked for
 *   the steps now-1..now+1. The matched step is stored with a conditional update
 *   (`lastUsedStep < step`), so a code, also in parallel, is accepted once (NT-M2).
 * - Recovery codes: HMAC lookup and a conditional `usedAt` update, so each code works once
 *   (NT-M4). Accepted only at the login MFA step and in the staff password reset.
 */
import type { Keyring } from "../auth/secret-box.js";
import { decryptSecret, mfaAad } from "../auth/secret-box.js";
import { hashRecoveryCode, normalizeRecoveryCode } from "../auth/tokens.js";
import { verifyTotp } from "../auth/totp.js";
import type { Db } from "../db.js";

export async function verifyUserTotp(
  db: Db,
  keyring: Keyring,
  userId: string,
  code: string,
  now: Date,
): Promise<boolean> {
  const factor = await db.mfaFactor.findFirst({
    where: { userId, type: "TOTP", confirmedAt: { not: null } },
    select: { id: true, secretCiphertext: true, lastUsedStep: true },
  });
  if (!factor) return false;
  let secret: Buffer;
  try {
    secret = decryptSecret(keyring, factor.secretCiphertext, mfaAad(userId, factor.id));
  } catch {
    return false;
  }
  const step = verifyTotp(secret, code, now, factor.lastUsedStep);
  secret.fill(0);
  if (step === null) return false;
  const { count } = await db.mfaFactor.updateMany({
    where: { id: factor.id, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
    data: { lastUsedStep: step, lastUsedAt: now },
  });
  return count === 1;
}

export async function useRecoveryCode(
  db: Db,
  hmacKey: Buffer,
  userId: string,
  input: string,
  now: Date,
): Promise<{ ok: boolean; remaining: number }> {
  const code = normalizeRecoveryCode(input);
  let ok = false;
  if (code) {
    const { count } = await db.mfaRecoveryCode.updateMany({
      where: { userId, codeHash: hashRecoveryCode(hmacKey, code), usedAt: null },
      data: { usedAt: now },
    });
    ok = count === 1;
  }
  const remaining = await db.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
  return { ok, remaining };
}
