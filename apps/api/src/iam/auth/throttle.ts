/**
 * Progressive login delay in PostgreSQL (F1-002; ADR-013 D6, design 3.2, owner decision A9).
 *
 * No hard lockout. Each failed attempt updates up to three buckets and moves the next allowed
 * attempt (`notBefore`) out:
 *
 * | Bucket     | Key                                | Free | Delay                 | Cap            | Reset                       |
 * | ---------- | ---------------------------------- | ---- | --------------------- | -------------- | --------------------------- |
 * | ACCOUNT_IP | HMAC(e-mail) prefix + HMAC(e-mail, IP prefix) | 3 | 2^(n-3) s | 15 min | success / 24 h without failure |
 * | ACCOUNT    | HMAC(e-mail)                       | 5    | 2^(n-5) s             | staff 60 s, customer 30 s | success / 24 h without failure |
 * | IP         | HMAC(IP prefix)                    | 30 per 10 min | 10 min block | –          | window                      |
 *
 * - The server never waits: a request before `notBefore` gets 429 + Retry-After without the
 *   password being evaluated and without counting (`throttledVerify`).
 * - Keys are e-mail digests, so unknown e-mails see exactly the same 429 sequence (T3), and the
 *   table holds no personal data.
 * - The policy (caps) comes from the app the request came through, never from the account, so the
 *   cap does not reveal whether an account exists or is staff.
 * - `User.failedLoginCount`/`lockedUntil` are not used (Ö4); this table is the only source.
 * - Concurrency: buckets are created with INSERT … ON CONFLICT DO NOTHING and updated under a row
 *   lock (SELECT … FOR UPDATE) in key order, so parallel failures never lose a count.
 */
import type { PrismaClient } from "../../generated/prisma/client.js";
import {
  ATTACK_SUSPECTED_THRESHOLDS,
  IP_THROTTLE,
  THROTTLE_RESET_HOURS,
  type ThrottlePolicy,
} from "../session-policy.js";
import type { Db } from "../db.js";
import { hmacHex } from "./hmac.js";

export type ThrottleKind = "ACCOUNT" | "ACCOUNT_IP" | "IP";

export interface ThrottleKeys {
  account: string;
  accountIp: string;
  ip: string;
}

/**
 * Bucket keys for an e-mail and IP prefix. The account+IP key starts with the first half of the
 * account digest, so `unlock` can remove every account+IP bucket of an account without knowing
 * the IPs (128-bit prefix and 128-bit suffix).
 */
export function throttleKeys(
  hmacKey: Buffer,
  emailNormalized: string,
  ipPrefix: string,
): ThrottleKeys {
  const account = hmacHex(hmacKey, "throttle_account", emailNormalized);
  return {
    account,
    accountIp:
      accountIpPrefix(account) +
      hmacHex(hmacKey, "throttle_account_ip", `${emailNormalized}|${ipPrefix}`).slice(0, 32),
    ip: hmacHex(hmacKey, "throttle_ip", ipPrefix),
  };
}

function accountIpPrefix(accountKey: string): string {
  return accountKey.slice(0, 32);
}

export interface BucketRule {
  kind: ThrottleKind;
  free: number;
  mode: "exponential" | "block";
  /** exponential: ceiling of 2^(n - free) seconds. */
  maxDelaySec: number;
  /** block: fixed delay once more than `free` failures fall in one window. */
  blockSec: number;
  /** silence: reset after this long without failure; window: fixed window from its start. */
  reset: "silence" | "window";
  resetAfterSec: number;
}

export function bucketRules(policy: ThrottlePolicy): Record<ThrottleKind, BucketRule> {
  const day = THROTTLE_RESET_HOURS * 3600;
  return {
    ACCOUNT: {
      kind: "ACCOUNT",
      free: policy.accountFree,
      mode: "exponential",
      maxDelaySec: policy.accountMaxDelaySec,
      blockSec: 0,
      reset: "silence",
      resetAfterSec: day,
    },
    ACCOUNT_IP: {
      kind: "ACCOUNT_IP",
      free: policy.accountIpFree,
      mode: "exponential",
      maxDelaySec: policy.accountIpMaxDelaySec,
      blockSec: 0,
      reset: "silence",
      resetAfterSec: day,
    },
    IP: {
      kind: "IP",
      free: IP_THROTTLE.free,
      mode: "block",
      maxDelaySec: 0,
      blockSec: IP_THROTTLE.blockMinutes * 60,
      reset: "window",
      resetAfterSec: IP_THROTTLE.windowMinutes * 60,
    },
  };
}

/**
 * Step-up and own-password-change failures of a signed-in user (F1-002 Group 2): a stolen
 * session cannot brute-force the TOTP code. Five free failures, then 2^(n-5) s up to 15 minutes;
 * a success clears the bucket.
 */
export const STEP_UP_RULE: BucketRule = {
  kind: "ACCOUNT",
  free: 5,
  mode: "exponential",
  maxDelaySec: 15 * 60,
  blockSec: 0,
  reset: "silence",
  resetAfterSec: THROTTLE_RESET_HOURS * 3600,
};

export function stepUpThrottleKey(hmacKey: Buffer, userId: string): string {
  return hmacHex(hmacKey, "throttle_step_up", userId);
}

export interface BucketState {
  failures: number;
  windowStartedAt: Date;
  lastFailureAt: Date;
  notBefore: Date | null;
}

/** Delay after the n-th failure in seconds (0 = none). */
export function delayAfter(rule: BucketRule, failures: number): number {
  if (failures <= rule.free) return 0;
  if (rule.mode === "block") return rule.blockSec;
  return Math.min(2 ** (failures - rule.free), rule.maxDelaySec);
}

/** The bucket after one more failure at `now`. Pure; the database path uses it under a lock. */
export function nextBucketState(
  prev: BucketState | null,
  rule: BucketRule,
  now: Date,
): BucketState {
  const since = (d: Date) => (now.getTime() - d.getTime()) / 1000;
  const expired =
    !prev ||
    (rule.reset === "silence"
      ? since(prev.lastFailureAt) >= rule.resetAfterSec
      : since(prev.windowStartedAt) >= rule.resetAfterSec);
  const failures = expired ? 1 : prev.failures + 1;
  const delay = delayAfter(rule, failures);
  return {
    failures,
    windowStartedAt: expired ? now : prev.windowStartedAt,
    lastFailureAt: now,
    notBefore: delay > 0 ? new Date(now.getTime() + delay * 1000) : null,
  };
}

export type ThrottleCheck = { allowed: true } | { allowed: false; retryAfterSec: number };

/** Earliest allowed attempt over all buckets; `retryAfterSec` is rounded up. */
export function evaluateBuckets(
  states: readonly Pick<BucketState, "notBefore">[],
  now: Date,
): ThrottleCheck {
  let latest = 0;
  for (const s of states) {
    if (s.notBefore && s.notBefore.getTime() > latest) latest = s.notBefore.getTime();
  }
  if (latest <= now.getTime()) return { allowed: true };
  return { allowed: false, retryAfterSec: Math.ceil((latest - now.getTime()) / 1000) };
}

export interface FailureResult {
  buckets: Record<ThrottleKind, BucketState>;
  /** The account bucket just reached an attack threshold (10, 50): audit + notify (DP-E). */
  attackSuspected: boolean;
}

/** What the login flow needs; `AuthThrottleService` implements it on PostgreSQL. */
export interface ThrottleStore {
  check(keys: ThrottleKeys, now: Date): Promise<ThrottleCheck>;
  recordFailure(keys: ThrottleKeys, policy: ThrottlePolicy, now: Date): Promise<FailureResult>;
  recordSuccess(keys: ThrottleKeys): Promise<void>;
}

export type ThrottledVerifyResult =
  | { outcome: "throttled"; retryAfterSec: number }
  | { outcome: "failed"; attackSuspected: boolean }
  | { outcome: "succeeded" };

/**
 * The order the login must follow (NT-T1): check the buckets first; a throttled request returns
 * without calling `verify` (no password evaluation, no Argon2 work, no count). Otherwise verify,
 * then count a failure or reset the account buckets on success.
 */
export async function throttledVerify(
  store: ThrottleStore,
  keys: ThrottleKeys,
  policy: ThrottlePolicy,
  now: Date,
  verify: () => Promise<boolean>,
): Promise<ThrottledVerifyResult> {
  const check = await store.check(keys, now);
  if (!check.allowed) return { outcome: "throttled", retryAfterSec: check.retryAfterSec };
  if (await verify()) {
    await store.recordSuccess(keys);
    return { outcome: "succeeded" };
  }
  const { attackSuspected } = await store.recordFailure(keys, policy, now);
  return { outcome: "failed", attackSuspected };
}

interface Row {
  key: string;
  failures: number;
  windowStartedAt: Date;
  lastFailureAt: Date;
  notBefore: Date | null;
}

export class AuthThrottleService implements ThrottleStore {
  constructor(private readonly prisma: PrismaClient) {}

  async check(keys: ThrottleKeys, now: Date): Promise<ThrottleCheck> {
    const rows = await this.prisma.authThrottle.findMany({
      where: { key: { in: [keys.account, keys.accountIp, keys.ip] } },
      select: { notBefore: true },
    });
    return evaluateBuckets(rows, now);
  }

  async recordFailure(
    keys: ThrottleKeys,
    policy: ThrottlePolicy,
    now: Date,
  ): Promise<FailureResult> {
    const rules = bucketRules(policy);
    const byKey = new Map<string, ThrottleKind>([
      [keys.account, "ACCOUNT"],
      [keys.accountIp, "ACCOUNT_IP"],
      [keys.ip, "IP"],
    ]);
    // Fixed lock order (sorted keys) so two concurrent failures cannot deadlock.
    const ordered = [...byKey.keys()].sort();
    const buckets = await this.prisma.$transaction(async (tx) => {
      const result = {} as Record<ThrottleKind, BucketState>;
      for (const key of ordered) {
        const kind = byKey.get(key) as ThrottleKind;
        result[kind] = await this.failOne(tx, key, rules[kind], now);
      }
      return result;
    });
    return {
      buckets,
      attackSuspected: ATTACK_SUSPECTED_THRESHOLDS.includes(buckets.ACCOUNT.failures),
    };
  }

  private async failOne(tx: Db, key: string, rule: BucketRule, now: Date): Promise<BucketState> {
    await tx.$executeRaw`
      INSERT INTO "AuthThrottle" ("key", "kind", "failures", "windowStartedAt", "lastFailureAt", "notBefore", "updatedAt")
      VALUES (${key}, ${rule.kind}::"AuthThrottleKind", 0, ${now}, ${now}, NULL, ${now})
      ON CONFLICT ("key") DO NOTHING`;
    const rows = await tx.$queryRaw<Row[]>`
      SELECT "key", "failures", "windowStartedAt", "lastFailureAt", "notBefore"
      FROM "AuthThrottle" WHERE "key" = ${key} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new Error("throttle bucket vanished");
    // A freshly inserted bucket (failures = 0) starts like a missing one.
    const prev: BucketState | null = row.failures === 0 ? null : row;
    const next = nextBucketState(prev, rule, now);
    await tx.authThrottle.update({
      where: { key },
      data: { ...next, kind: rule.kind, updatedAt: now },
    });
    return next;
  }

  /**
   * One bucket outside the login triple (F1-002 Group 2): the step-up and password-change bucket
   * of a signed-in user (`stepUpThrottleKey`). Same locking as `recordFailure`.
   */
  async recordSingleFailure(key: string, rule: BucketRule, now: Date): Promise<BucketState> {
    return this.prisma.$transaction((tx) => this.failOne(tx, key, rule, now));
  }

  async checkKeys(keys: readonly string[], now: Date): Promise<ThrottleCheck> {
    const rows = await this.prisma.authThrottle.findMany({
      where: { key: { in: [...keys] } },
      select: { notBefore: true },
    });
    return evaluateBuckets(rows, now);
  }

  async clear(keys: readonly string[]): Promise<void> {
    await this.prisma.authThrottle.deleteMany({ where: { key: { in: [...keys] } } });
  }

  /** Successful login: the account and account+IP buckets start over; the IP bucket stays. */
  async recordSuccess(keys: ThrottleKeys): Promise<void> {
    await this.prisma.authThrottle.deleteMany({
      where: { key: { in: [keys.account, keys.accountIp] } },
    });
  }

  /** `user:unlock`: removes the account bucket and every account+IP bucket of the account. */
  async unlock(accountKey: string): Promise<number> {
    const { count } = await this.prisma.authThrottle.deleteMany({
      where: {
        OR: [
          { key: accountKey, kind: "ACCOUNT" },
          { kind: "ACCOUNT_IP", key: { startsWith: accountIpPrefix(accountKey) } },
        ],
      },
    });
    return count;
  }
}
