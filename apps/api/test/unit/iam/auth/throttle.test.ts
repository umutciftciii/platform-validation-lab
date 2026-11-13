// AC-TH-1 (unit), NT-T1, NT-T2, NT-T5 (unit level): progressive delay without hard lockout.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SESSION_POLICIES } from "../../../../src/iam/session-policy.js";
import {
  bucketRules,
  delayAfter,
  evaluateBuckets,
  nextBucketState,
  throttleKeys,
  throttledVerify,
  type BucketState,
  type FailureResult,
  type ThrottleKeys,
  type ThrottleKind,
  type ThrottleStore,
} from "../../../../src/iam/auth/throttle.js";
import type { ThrottlePolicy } from "../../../../src/iam/session-policy.js";

const STAFF = SESSION_POLICIES.STAFF.throttle;
const CUSTOMER = SESSION_POLICIES.CUSTOMER.throttle;
const T0 = new Date("2026-11-11T09:00:00Z");
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

/** The same algorithm as AuthThrottleService, on a Map (the integration suite runs the real one). */
class MemoryStore implements ThrottleStore {
  readonly rows = new Map<string, BucketState>();
  checks = 0;
  async check(keys: ThrottleKeys, now: Date) {
    this.checks++;
    return evaluateBuckets(
      [keys.account, keys.accountIp, keys.ip].flatMap((k) =>
        this.rows.has(k) ? [this.rows.get(k)!] : [],
      ),
      now,
    );
  }
  async recordFailure(
    keys: ThrottleKeys,
    policy: ThrottlePolicy,
    now: Date,
  ): Promise<FailureResult> {
    const rules = bucketRules(policy);
    const buckets = {} as Record<ThrottleKind, BucketState>;
    for (const [kind, key] of [
      ["ACCOUNT", keys.account],
      ["ACCOUNT_IP", keys.accountIp],
      ["IP", keys.ip],
    ] as const) {
      const next = nextBucketState(this.rows.get(key) ?? null, rules[kind], now);
      this.rows.set(key, next);
      buckets[kind] = next;
    }
    return { buckets, attackSuspected: [10, 50].includes(buckets.ACCOUNT.failures) };
  }
  async recordSuccess(keys: ThrottleKeys) {
    this.rows.delete(keys.account);
    this.rows.delete(keys.accountIp);
  }
}

const hmacKey = randomBytes(32);

describe("bucket rules (design 3.2)", () => {
  it("has the agreed free attempts, exponents and caps", () => {
    const s = bucketRules(STAFF);
    expect(Array.from({ length: 10 }, (_, i) => delayAfter(s.ACCOUNT_IP, i + 1))).toEqual([
      0, 0, 0, 2, 4, 8, 16, 32, 64, 128,
    ]);
    expect(delayAfter(s.ACCOUNT_IP, 30)).toBe(15 * 60);
    expect(Array.from({ length: 9 }, (_, i) => delayAfter(s.ACCOUNT, i + 1))).toEqual([
      0, 0, 0, 0, 0, 2, 4, 8, 16,
    ]);
    expect(delayAfter(s.ACCOUNT, 1000)).toBe(60); // staff cap
    expect(delayAfter(bucketRules(CUSTOMER).ACCOUNT, 1000)).toBe(30); // customer cap
    expect(delayAfter(s.IP, 30)).toBe(0);
    expect(delayAfter(s.IP, 31)).toBe(600);
  });

  it("resets account buckets after 24 h of silence and the IP bucket per 10-minute window", () => {
    const r = bucketRules(STAFF);
    let st = nextBucketState(null, r.ACCOUNT, T0);
    st = nextBucketState(st, r.ACCOUNT, at(3600));
    expect(st.failures).toBe(2);
    expect(nextBucketState(st, r.ACCOUNT, at(3600 + 24 * 3600)).failures).toBe(1);
    let ip = nextBucketState(null, r.IP, T0);
    ip = nextBucketState(ip, r.IP, at(599));
    expect(ip.failures).toBe(2);
    const fresh = nextBucketState(ip, r.IP, at(600));
    expect(fresh).toMatchObject({ failures: 1, windowStartedAt: at(600) });
  });
});

describe("throttled login order", () => {
  const keys = throttleKeys(hmacKey, "target@example.com", "203.0.113.0/24");

  it("NT-T1: from the 4th failure on, an early request is 429 without evaluating the password or counting", async () => {
    const store = new MemoryStore();
    let verifications = 0;
    const wrong = async () => {
      verifications++;
      return false;
    };
    for (let i = 0; i < 3; i++) {
      expect(await throttledVerify(store, keys, STAFF, at(i), wrong)).toEqual({
        outcome: "failed",
        attackSuspected: false,
      });
    }
    // 4th failure: account+IP bucket now asks for 2 s.
    expect((await throttledVerify(store, keys, STAFF, at(3), wrong)).outcome).toBe("failed");
    const before = store.rows.get(keys.accountIp)!.failures;
    const early = await throttledVerify(store, keys, STAFF, at(4), wrong);
    expect(early).toEqual({ outcome: "throttled", retryAfterSec: 1 });
    expect(verifications).toBe(4);
    expect(store.rows.get(keys.accountIp)!.failures).toBe(before);
    // After the delay the next attempt is evaluated again, and the delay doubles.
    expect((await throttledVerify(store, keys, STAFF, at(5), wrong)).outcome).toBe("failed");
    expect(verifications).toBe(5);
    expect(await throttledVerify(store, keys, STAFF, at(6), wrong)).toEqual({
      outcome: "throttled",
      retryAfterSec: 3,
    });
  });

  it("NT-T2: an existing and an unknown e-mail see the same 429 sequence", async () => {
    const run = async (email: string) => {
      const store = new MemoryStore();
      const k = throttleKeys(hmacKey, email, "198.51.100.0/24");
      const seq: string[] = [];
      for (let s = 0; s < 40; s++) {
        const r = await throttledVerify(store, k, STAFF, at(s), async () => false);
        seq.push(r.outcome === "throttled" ? `429:${r.retryAfterSec}` : r.outcome);
      }
      return seq;
    };
    // Keys depend only on the e-mail digest, never on whether the account exists.
    expect(await run("exists@example.com")).toEqual(await run("nobody@example.com"));
  });

  it("NT-T4 (unit): a distributed attack never delays the account more than the 60 s cap", async () => {
    const store = new MemoryStore();
    let t = 0;
    for (let i = 0; i < 1000; i++) {
      const k = throttleKeys(hmacKey, "admin@example.com", `10.${i >> 8}.${i & 255}.0/24`);
      const c = await store.check(k, at(t));
      if (!c.allowed) t += c.retryAfterSec;
      await store.recordFailure(k, STAFF, at(t));
    }
    const fresh = throttleKeys(hmacKey, "admin@example.com", "192.0.2.0/24");
    const c = await store.check(fresh, at(t));
    expect(c.allowed || c.retryAfterSec <= 60).toBe(true);
    expect((await store.check(fresh, at(t + 60))).allowed).toBe(true);
  });

  it("NT-T5: a successful login resets the account buckets, not the IP bucket", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 6; i++) await store.recordFailure(keys, STAFF, at(i));
    const r = await throttledVerify(store, keys, STAFF, at(1000), async () => true);
    expect(r).toEqual({ outcome: "succeeded" });
    expect(store.rows.has(keys.account)).toBe(false);
    expect(store.rows.has(keys.accountIp)).toBe(false);
    expect(store.rows.get(keys.ip)?.failures).toBe(6);
  });

  it("flags the 10th and 50th account failure as a suspected attack", async () => {
    const store = new MemoryStore();
    const flagged: number[] = [];
    for (let i = 1; i <= 60; i++) {
      const k = throttleKeys(hmacKey, "victim@example.com", `172.16.${i}.0/24`);
      if ((await store.recordFailure(k, CUSTOMER, at(i * 100))).attackSuspected) flagged.push(i);
    }
    expect(flagged).toEqual([10, 50]);
  });
});

describe("bucket keys", () => {
  it("are 64-hex digests; account+IP keys share the account prefix (unlock), nothing reveals the e-mail", () => {
    const a = throttleKeys(hmacKey, "x@example.com", "203.0.113.0/24");
    const b = throttleKeys(hmacKey, "x@example.com", "198.51.100.0/24");
    for (const k of [a.account, a.accountIp, a.ip]) expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(a.accountIp.slice(0, 32)).toBe(a.account.slice(0, 32));
    expect(b.accountIp.slice(0, 32)).toBe(a.account.slice(0, 32));
    expect(a.accountIp).not.toBe(b.accountIp);
    expect(JSON.stringify(a)).not.toContain("example");
    expect(throttleKeys(randomBytes(32), "x@example.com", "203.0.113.0/24").account).not.toBe(
      a.account,
    );
  });
});
