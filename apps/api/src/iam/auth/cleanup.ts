/**
 * Retention clean-up of authentication data (F1-002; design 8.6, owner decision A8).
 *
 * Defaults pending legal approval (A8; a DP-039 go-live gate, not a staff blocker). They live in
 * this one object so the approved values change in one place:
 *
 * | Data                    | Removed                                              |
 * | ----------------------- | ---------------------------------------------------- |
 * | Session                 | 30 days after revocation or (idle) expiry            |
 * | UserCredentialToken     | 7 days after consumption, invalidation or expiry     |
 * | unconfirmed MfaFactor   | 15 minutes after creation                            |
 * | AuthThrottle            | 24 hours after the last update, once not blocking     |
 *
 * Recovery codes are replaced on regeneration (Group 2), AuditEvent is append-only (ADR-003).
 * Several API instances may run the job: a transaction-scoped advisory lock lets one of them work
 * and the others skip that round.
 */
import type { PrismaClient } from "../../generated/prisma/client.js";

export const AUTH_RETENTION = {
  sessionDays: 30,
  tokenDays: 7,
  unconfirmedFactorMinutes: 15,
  throttleHours: 24,
} as const;
export type AuthRetention = { [K in keyof typeof AUTH_RETENTION]: number };

/** pg_advisory_xact_lock key: "IAMCLEAN" in ASCII. */
export const CLEANUP_LOCK_KEY = 5278585189692686670n;

export interface CleanupResult {
  sessions: number;
  tokens: number;
  unconfirmedFactors: number;
  throttleBuckets: number;
}

const minutes = (n: number) => n * 60_000;

/** One clean-up round; returns null when another instance holds the lock. */
export async function runAuthCleanup(
  prisma: PrismaClient,
  now: Date = new Date(),
  retention: AuthRetention = AUTH_RETENTION,
): Promise<CleanupResult | null> {
  const before = (ms: number) => new Date(now.getTime() - ms);
  const sessionCutoff = before(minutes(retention.sessionDays * 24 * 60));
  const tokenCutoff = before(minutes(retention.tokenDays * 24 * 60));
  const factorCutoff = before(minutes(retention.unconfirmedFactorMinutes));
  const throttleCutoff = before(minutes(retention.throttleHours * 60));

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(${CLEANUP_LOCK_KEY}) AS locked`;
    if (!rows[0]?.locked) return null;
    const sessions = await tx.session.deleteMany({
      where: {
        OR: [{ revokedAt: { lt: sessionCutoff } }, { idleExpiresAt: { lt: sessionCutoff } }],
      },
    });
    const tokens = await tx.userCredentialToken.deleteMany({
      where: {
        OR: [
          { consumedAt: { lt: tokenCutoff } },
          { invalidatedAt: { lt: tokenCutoff } },
          { expiresAt: { lt: tokenCutoff } },
        ],
      },
    });
    const factors = await tx.mfaFactor.deleteMany({
      where: { confirmedAt: null, createdAt: { lt: factorCutoff } },
    });
    const buckets = await tx.authThrottle.deleteMany({
      where: {
        updatedAt: { lt: throttleCutoff },
        OR: [{ notBefore: null }, { notBefore: { lt: now } }],
      },
    });
    return {
      sessions: sessions.count,
      tokens: tokens.count,
      unconfirmedFactors: factors.count,
      throttleBuckets: buckets.count,
    };
  });
}
