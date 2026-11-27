/**
 * DP-291 + DP-297 (ADR-030 D6–D8, D10): the workers against a stub database that behaves like the
 * dp_297 functions (claim with RESERVED → IN_FLIGHT, stop signals, stored drafts) — the order
 * claim → call plan → one provider call → settlement, and every way a call ends: success (the
 * encrypted draft stored for its actor), refusal (cost 0), uncertain (counted as spent, never
 * repeated), unreadable input (cost 0, no call), cancel from any instance, switch-off (running
 * aborted, a late answer discarded and never stored), lease end, shutdown.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { aiCredentialAad, encryptSecret, parseKeyring } from "../../../src/iam/auth/secret-box.js";
import { PlatformModuleDisabledError } from "../../../src/iam/platform-modules.js";
import {
  AiRunnerService,
  DISPATCH_START_DEADLINE_MS,
  callTimeoutSeconds,
  workerConcurrency,
  workerPollMs,
} from "../../../src/ai/runner/runner.service.js";
import {
  ProviderCallError,
  type AiProviderAdapter,
  type GenerateResult,
} from "../../../src/ai/providers/types.js";
import { openResult, sealInput } from "../../../src/ai/transient-box.js";

const keyring = parseKeyring(`1:${randomBytes(32).toString("base64url")}`, "DP_AI_ENC_KEYS");
const otherKeyring = parseKeyring(`1:${randomBytes(32).toString("base64url")}`, "DP_AI_ENC_KEYS");
const CRED = "0190c0de-0000-7000-8000-000000000001";
const KEY = "fake-provider-key-0123456789";
const stored = encryptSecret(keyring, Buffer.from(KEY), aiCredentialAad(CRED, "OPENAI"));
const USAGE = {
  inputTokens: 10,
  cachedReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 2,
  reasoningTokens: 0,
};
const OK: GenerateResult = {
  text: "pong",
  usage: USAGE,
  finish: "complete",
  providerRequestId: "r1",
};

type Status = "RESERVED" | "IN_FLIGHT" | "SUCCEEDED" | "FAILED" | "UNKNOWN" | "DISCARDED";
interface Op {
  id: string;
  actor: string;
  status: Status;
  payload: string | null;
  stop: boolean;
  instance: string | null;
  dispatched: number | null;
  /** DP-307: the provider-terms record of a personal-data operation. */
  terms?: string | null;
}
type Settled = { id: string; status: string; errorCode: string | null; outputTokens: number };

/** One shared stub database; several runners (instances) may use it. */
function database() {
  const ops = new Map<string, Op>();
  const results = new Map<string, string>();
  const settled: Settled[] = [];
  const unknown: { id: string; code: string }[] = [];
  const audits: string[] = [];
  const auditRows: { action: string; metadata: Record<string, unknown> }[] = [];
  const st = {
    enabled: true,
    maxConcurrency: 20,
    claims: 0,
    afterClaim: null as ((id: string) => void) | null,
    /** Open whileEnabled transactions (the switch held), and requests started without it. */
    held: 0,
    unheldCalls: 0,
    version: 1,
    /** DP-307: revoked (or renewed) provider-terms records. */
    revokedTerms: new Set<string>(),
    /** DP-307: lock waits inside ai_dispatch, as a clock skew (ms). */
    dispatchWaitMs: 0,
    /** DP-307: a revocation that commits right after the answer, before the settlement. */
    revokeBeforeSettle: null as string | null,
  };
  const revoked = (o: Op) => !!o.terms && st.revokedTerms.has(o.terms);

  const settle = (id: string, status: string, errorCode: string | null, outputTokens: number) => {
    const o = ops.get(id)!;
    if (o.status !== "IN_FLIGHT" && o.status !== "UNKNOWN") return "already_settled";
    const late = o.status === "UNKNOWN";
    o.status = (late ? "DISCARDED" : status) as Status;
    settled.push({ id, status: o.status, errorCode, outputTokens });
    return "settled";
  };
  const signals = (ids: string[]) =>
    ids.flatMap((id) => {
      const o = ops.get(id);
      if (!o) return [];
      const reason = !st.enabled
        ? "ai_disabled"
        : o.stop
          ? "cancelled"
          : revoked(o)
            ? "provider_terms_revoked"
            : o.status !== "IN_FLIGHT"
              ? "not_in_flight"
              : null;
      return reason ? [{ op_id: id, reason }] : [];
    });
  const sql = (instance?: string) => ({
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = strings.join("?");
      if (q.includes("ai_claim")) {
        st.claims++;
        if (!st.enabled) return [];
        const limit = values[2] as number;
        const flight = [...ops.values()].filter((o) => o.status === "IN_FLIGHT").length;
        const slots = Math.min(limit, st.maxConcurrency - flight);
        const out = [];
        for (const o of ops.values()) {
          if (out.length >= slots) break;
          if (o.status !== "RESERVED" || o.payload === null || o.stop) continue;
          out.push({
            op_id: o.id,
            op_actor: o.actor,
            op_task: "DIAGNOSTIC_PING",
            op_site: null,
            op_payload: o.payload,
            op_terms: o.terms ?? null,
          });
          o.payload = null; // handed out once
          o.status = "IN_FLIGHT";
          o.instance = (values[0] as string) ?? instance ?? null;
          st.afterClaim?.(o.id);
        }
        return out;
      }
      if (q.includes("ai_queue_depth")) {
        return [
          {
            n: [...ops.values()].filter((o) => o.status === "RESERVED" && o.payload && !o.stop)
              .length,
          },
        ];
      }
      if (q.includes("ai_stop_signals")) return signals(values[0] as string[]);
      if (q.includes("ai_dispatch")) {
        const o = ops.get(values[0] as string)!;
        const r = !st.enabled
          ? "ai_disabled"
          : o.status !== "IN_FLIGHT"
            ? "not_in_flight"
            : o.dispatched !== null
              ? "already_dispatched"
              : o.stop
                ? "cancelled"
                : revoked(o)
                  ? "provider_terms_revoked"
                  : "dispatch";
        if (r === "dispatch") o.dispatched = st.version;
        if (st.dispatchWaitMs) skew.ms += st.dispatchWaitMs;
        return [{ r }];
      }
      if (q.includes("ai_credential_ciphertext")) return [{ c: stored }];
      if (q.includes("ai_terms_hold")) {
        const o = ops.get(values[0] as string)!;
        if (st.revokeBeforeSettle) st.revokedTerms.add(st.revokeBeforeSettle);
        return [{ r: revoked(o) ? "provider_terms_revoked" : "ok" }];
      }
      if (q.includes("ai_settle")) {
        return [
          {
            r: settle(
              values[0] as string,
              values[1] as string,
              values[8] as string | null,
              values[5] as number,
            ),
          },
        ];
      }
      if (q.includes("ai_store_result")) {
        const o = ops.get(values[0] as string)!;
        if (!st.enabled || o.status !== "SUCCEEDED" || o.stop || revoked(o)) {
          return [{ r: "refused" }];
        }
        results.set(o.id, values[1] as string);
        return [{ r: "stored" }];
      }
      throw new Error(`unexpected SQL ${q}`);
    },
  });
  return { ops, results, settled, unknown, audits, auditRows, st, settle, sql };
}

function instance(
  db: ReturnType<typeof database>,
  name: string,
  generate: (input: string, signal: AbortSignal) => Promise<GenerateResult>,
  ring = keyring,
  handOff = true,
) {
  const listeners: ((c: { moduleKey: string; enabled: boolean }) => Promise<void> | void)[] = [];
  let calls = 0;
  const tx = db.sql(name);
  const prisma = {
    ...tx,
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    auditEvent: {
      createMany: async (a: { data: { action: string; metadata: Record<string, unknown> }[] }) => {
        db.audits.push(a.data[0]!.action);
        db.auditRows.push({ action: a.data[0]!.action, metadata: a.data[0]!.metadata });
      },
    },
  };
  const modules = {
    onChange: (l: (typeof listeners)[number]) => {
      listeners.push(l);
      return () => undefined;
    },
    whileEnabled: async (_key: string, fn: (t: unknown) => Promise<unknown>) => {
      if (!db.st.enabled) throw new PlatformModuleDisabledError("ai");
      db.st.held++;
      try {
        return await fn(tx);
      } finally {
        db.st.held--;
      }
    },
  };
  const ledger = {
    instanceId: name,
    callPlan: async (id: string) => {
      const o = db.ops.get(id)!;
      return o.status === "IN_FLIGHT" &&
        db.st.enabled &&
        !o.stop &&
        !(o.terms && db.st.revokedTerms.has(o.terms))
        ? { provider: "OPENAI", providerModelId: "gpt-x", credentialId: CRED, projectRef: null }
        : null;
    },
    settle: async (
      id: string,
      a: { status: string; errorCode: string | null; outputTokens: number },
    ) => db.settle(id, a.status, a.errorCode, a.outputTokens),
    markUnknown: async (id: string, code: string) => {
      const o = db.ops.get(id)!;
      if (o.status !== "IN_FLIGHT") return "not_in_flight";
      o.status = "UNKNOWN";
      db.unknown.push({ id, code });
      return "assumed";
    },
  };
  const adapter = {
    provider: "OPENAI",
    billingProfile: "openai.fake",
    listModels: async () => [],
    getModel: async () => null,
    generate: async (
      key: string,
      r: { input: string },
      o: { signal: AbortSignal; onDispatch?: () => void },
    ) => {
      expect(key).toBe(KEY);
      if (o.signal.aborted) throw new ProviderCallError("timeout"); // never sent
      if (db.st.held === 0) db.st.unheldCalls++;
      calls++;
      if (handOff) o.onDispatch?.();
      return generate(r.input, o.signal);
    },
  } as unknown as AiProviderAdapter;
  const runner = new AiRunnerService(
    prisma as never,
    modules as never,
    ledger as never,
    { transport: "fake", keyring: ring, localCap: null },
    new Map([["OPENAI", adapter]]),
  );
  runner.onApplicationBootstrap();
  return {
    runner,
    calls: () => calls,
    async switchOffHere() {
      for (const l of listeners) await l({ moduleKey: "ai", enabled: false });
    },
  };
}

/** DP-307: a clock skew the stub adds while ai_dispatch "waits" for locks. */
const skew = { ms: 0 };

let seq = 0;
function enqueue(
  db: ReturnType<typeof database>,
  input = "ping",
  actor = "actor-1",
  terms: string | null = null,
): string {
  const id = `op-${++seq}`;
  const payload = sealInput(keyring, id, actor, {
    input,
    maxOutputTokens: 16,
    thinkingBudget: 0,
    temperature: null,
  });
  db.ops.set(id, {
    id,
    actor,
    status: "RESERVED",
    payload,
    stop: false,
    instance: null,
    dispatched: null,
    terms,
  });
  return id;
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new ProviderCallError("timeout"));
    });
  });
const tick = () => new Promise((r) => setTimeout(r, 5));
async function until(fn: () => boolean, ms = 2_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("condition not reached");
    await tick();
  }
}
const draft = (db: ReturnType<typeof database>, id: string, actor = "actor-1") => {
  const c = db.results.get(id);
  return c ? openResult(keyring, id, actor, c) : null;
};

describe("DP-297: the worker on the database queue", () => {
  it("claims, calls once, settles SUCCEEDED and stores the encrypted draft for its actor only", async () => {
    const db = database();
    const a = instance(db, "api-a", async () => OK);
    const id = enqueue(db, "ping secret-canary");
    await a.runner.whenIdle();
    expect(a.calls()).toBe(1);
    expect(db.settled).toEqual([{ id, status: "SUCCEEDED", errorCode: null, outputTokens: 2 }]);
    expect(db.results.get(id)).not.toContain("pong");
    expect(draft(db, id)).toBe("pong");
    expect(draft(db, id, "someone-else")).toBeNull();
    expect(db.ops.get(id)!.payload).toBeNull();
    await a.runner.onModuleDestroy();
  });

  it("two instances never run the same job; the total respects maxConcurrency", async () => {
    const db = database();
    db.st.maxConcurrency = 3;
    let flying = 0;
    let peak = 0;
    const slow = async () => {
      flying++;
      peak = Math.max(peak, flying);
      await wait(30);
      flying--;
      return OK;
    };
    const a = instance(db, "api-a", slow);
    const b = instance(db, "api-b", slow);
    const ids = Array.from({ length: 10 }, (_, i) => enqueue(db, `job ${i}`));
    await Promise.all([a.runner.whenIdle(), b.runner.whenIdle()]);
    expect(a.calls() + b.calls()).toBe(10);
    expect(peak).toBeLessThanOrEqual(3);
    expect(new Set(db.settled.map((s) => s.id)).size).toBe(10);
    for (const id of ids) expect(db.ops.get(id)!.status).toBe("SUCCEEDED");
    expect(new Set(ids.map((id) => db.ops.get(id)!.instance))).toEqual(new Set(["api-a", "api-b"]));
    await a.runner.onModuleDestroy();
    await b.runner.onModuleDestroy();
  });

  it("settles a refusal before work as FAILED with cost 0 and never repeats it", async () => {
    const db = database();
    const a = instance(db, "api-a", async () => {
      throw new ProviderCallError("rate_limited", 429, 1);
    });
    const id = enqueue(db);
    await a.runner.whenIdle();
    expect(a.calls()).toBe(1);
    expect(db.settled).toEqual([
      { id, status: "FAILED", errorCode: "rate_limited", outputTokens: 0 },
    ]);
    expect(db.unknown).toEqual([]);
    await a.runner.onModuleDestroy();
  });

  it("counts a timeout, a lost connection or an unreadable answer as spent (UNKNOWN), once", async () => {
    for (const code of ["timeout", "network_error", "bad_response"] as const) {
      const db = database();
      const a = instance(db, "api-a", async () => {
        throw new ProviderCallError(code);
      });
      const id = enqueue(db);
      await a.runner.whenIdle();
      expect(a.calls()).toBe(1);
      expect(db.unknown).toEqual([{ id, code }]);
      expect(db.settled).toEqual([]);
      expect(db.audits).toEqual(["ai.operation.unknown"]);
      expect(db.results.size).toBe(0);
      await a.runner.onModuleDestroy();
    }
  });

  it("settles an unusable answer FAILED with its usage (refusal, cap reached, empty)", async () => {
    for (const [r, code] of [
      [{ ...OK, finish: "refused", text: "" }, "output_refused"],
      [{ ...OK, finish: "max_tokens" }, "output_max_tokens"],
      [{ ...OK, text: "  " }, "output_invalid"],
    ] as const) {
      const db = database();
      const a = instance(db, "api-a", async () => r);
      const id = enqueue(db);
      await a.runner.whenIdle();
      expect(db.settled).toEqual([{ id, status: "FAILED", errorCode: code, outputTokens: 2 }]);
      expect(db.results.size).toBe(0);
      await a.runner.onModuleDestroy();
    }
  });

  it("an input that does not decrypt (other keyring) costs nothing and makes no call", async () => {
    const db = database();
    const a = instance(db, "api-a", async () => OK, otherKeyring);
    const id = enqueue(db);
    await a.runner.whenIdle();
    expect(a.calls()).toBe(0);
    expect(db.settled).toEqual([
      { id, status: "FAILED", errorCode: "input_unreadable", outputTokens: 0 },
    ]);
    await a.runner.onModuleDestroy();
  });

  it("switch-off: running calls on every instance are aborted (UNKNOWN), nothing is claimed after it", async () => {
    const db = database();
    const a = instance(db, "api-a", (_i, signal) => wait(10_000, signal).then(() => OK));
    const b = instance(db, "api-b", (_i, signal) => wait(10_000, signal).then(() => OK));
    for (let i = 0; i < 6; i++) enqueue(db, `job ${i}`);
    await a.runner.tick();
    await b.runner.tick();
    await until(() => a.calls() + b.calls() === 4);
    const before = a.calls() + b.calls();
    // The database cancels the queue in the owner's transaction (trigger); this instance hears
    // the listener, the other one only the stop signal at its next poll.
    db.st.enabled = false;
    for (const o of db.ops.values()) if (o.status === "RESERVED") o.payload = null;
    await a.switchOffHere();
    await b.runner.tick();
    await Promise.all([a.runner.whenIdle(), b.runner.whenIdle()]);
    expect(a.calls() + b.calls()).toBe(before);
    expect(db.unknown.map((u) => u.code)).toEqual([
      "ai_disabled",
      "ai_disabled",
      "ai_disabled",
      "ai_disabled",
    ]);
    expect(db.results.size).toBe(0);
    await a.runner.onModuleDestroy();
    await b.runner.onModuleDestroy();
  });

  it("an answer that arrives after the switch-off is settled DISCARDED and never stored", async () => {
    const db = database();
    let finish: (r: GenerateResult) => void = () => undefined;
    const a = instance(db, "api-a", () => new Promise<GenerateResult>((r) => (finish = r)));
    const id = enqueue(db);
    await a.runner.tick();
    await until(() => a.calls() === 1);
    db.st.enabled = false;
    await a.switchOffHere(); // the adapter ignores the abort and answers anyway
    finish(OK);
    await a.runner.whenIdle();
    expect(db.settled).toEqual([
      { id, status: "DISCARDED", errorCode: "ai_disabled", outputTokens: 2 },
    ]);
    expect(db.audits).toEqual(["ai.operation.discarded"]);
    expect(db.results.size).toBe(0);
    await a.runner.onModuleDestroy();
  });

  it("a cancel received by another instance stops the call at the next poll; its answer is dropped", async () => {
    const db = database();
    let finish: (r: GenerateResult) => void = () => undefined;
    const a = instance(db, "api-a", () => new Promise<GenerateResult>((r) => (finish = r)));
    const id = enqueue(db);
    await a.runner.tick();
    await until(() => a.calls() === 1);
    expect(a.runner.state(id)).toBe("running");
    db.ops.get(id)!.stop = true; // ai_request_cancel through api-b
    await a.runner.tick(); // stop signal → abort; this adapter answers anyway
    finish(OK);
    await a.runner.whenIdle();
    expect(db.settled).toEqual([
      { id, status: "DISCARDED", errorCode: "cancelled", outputTokens: 2 },
    ]);
    expect(db.results.size).toBe(0);
    await a.runner.onModuleDestroy();
  });

  it("a cancel that lands between the answer and its settlement drops the answer too", async () => {
    const db = database();
    let finish: (r: GenerateResult) => void = () => undefined;
    const a = instance(db, "api-a", () => new Promise<GenerateResult>((r) => (finish = r)));
    const id = enqueue(db);
    await a.runner.tick();
    await until(() => a.calls() === 1);
    db.ops.get(id)!.stop = true; // not yet seen by api-a's poll
    finish(OK);
    await a.runner.whenIdle();
    expect(db.settled).toEqual([
      { id, status: "DISCARDED", errorCode: "cancelled", outputTokens: 2 },
    ]);
    expect(db.audits).toEqual(["ai.operation.discarded"]);
    expect(db.results.size).toBe(0);
    await a.runner.onModuleDestroy();
  });

  it("an answer after the sweeper ended the lease (UNKNOWN) is DISCARDED and not stored", async () => {
    const db = database();
    let finish: (r: GenerateResult) => void = () => undefined;
    const a = instance(db, "api-a", () => new Promise<GenerateResult>((r) => (finish = r)));
    const id = enqueue(db);
    await a.runner.tick();
    await until(() => a.calls() === 1);
    db.ops.get(id)!.status = "UNKNOWN"; // ai_sweep at lease end
    finish(OK);
    await a.runner.whenIdle();
    expect(db.ops.get(id)!.status).toBe("DISCARDED");
    expect(db.results.size).toBe(0);
    await a.runner.onModuleDestroy();
  });

  it("the local cancel fast path aborts at once", async () => {
    const db = database();
    const a = instance(db, "api-a", (_i, signal) => wait(10_000, signal).then(() => OK));
    const id = enqueue(db);
    await a.runner.tick();
    await until(() => a.calls() === 1);
    expect(a.runner.abortLocal(id)).toBe(true);
    expect(a.runner.abortLocal("op-unknown")).toBe(false);
    await a.runner.whenIdle();
    expect(db.unknown).toEqual([{ id, code: "cancelled" }]);
    await a.runner.onModuleDestroy();
  });

  it("shutdown: a running call ends UNKNOWN (never repeated), queued jobs stay for another instance", async () => {
    const db = database();
    db.st.maxConcurrency = 1;
    const a = instance(db, "api-a", (_i, signal) => wait(10_000, signal).then(() => OK));
    const first = enqueue(db, "first");
    const second = enqueue(db, "second");
    await a.runner.tick();
    await until(() => a.calls() === 1);
    await a.runner.onModuleDestroy();
    expect(db.unknown).toEqual([{ id: first, code: "shutdown" }]);
    expect(db.ops.get(second)!.status).toBe("RESERVED");
    const b = instance(db, "api-b", async () => OK);
    await b.runner.whenIdle();
    expect(b.calls()).toBe(1);
    expect(db.ops.get(second)!.status).toBe("SUCCEEDED");
    expect(db.ops.get(first)!.status).toBe("UNKNOWN");
    await b.runner.onModuleDestroy();
  });

  it("a stop seen before the paid call costs nothing: FAILED, no provider call", async () => {
    const db = database();
    const a = instance(db, "api-a", async () => OK);
    const id = enqueue(db);
    // Claimed, then cancelled through another instance before the call plan is read.
    db.st.afterClaim = (claimed) => void (db.ops.get(claimed)!.stop = true);
    await a.runner.whenIdle();
    expect(a.calls()).toBe(0);
    expect(db.settled).toEqual([{ id, status: "FAILED", errorCode: "cancelled", outputTokens: 0 }]);
    await a.runner.onModuleDestroy();
  });

  it("starts every provider request while the AI switch is held (ai_dispatch), never outside", async () => {
    const db = database();
    const a = instance(db, "api-a", async () => OK);
    const b = instance(db, "api-b", async () => OK);
    const ids = Array.from({ length: 8 }, (_, i) => enqueue(db, `held ${i}`));
    await Promise.all([a.runner.whenIdle(), b.runner.whenIdle()]);
    expect(a.calls() + b.calls()).toBe(8);
    expect(db.st.unheldCalls).toBe(0);
    for (const id of ids) expect(db.ops.get(id)!.dispatched).toBe(1);
    await a.runner.onModuleDestroy();
    await b.runner.onModuleDestroy();
  });

  it("a switch-off committed between the claim and the dispatch: no request at all, cost 0", async () => {
    const db = database();
    const a = instance(db, "api-a", async () => OK);
    const id = enqueue(db);
    // The owner's COMMIT lands after the claim: this instance has not polled nor heard it.
    db.st.afterClaim = () => void (db.st.enabled = false);
    await a.runner.tick();
    await until(() => db.settled.length === 1);
    expect(a.calls()).toBe(0);
    expect(db.ops.get(id)!.dispatched).toBeNull();
    expect(db.settled).toEqual([
      { id, status: "FAILED", errorCode: "ai_disabled", outputTokens: 0 },
    ]);
    await a.runner.onModuleDestroy();
  });

  it("a request not handed to the transport in time is aborted before it is sent, cost 0", async () => {
    const db = database();
    const a = instance(
      db,
      "api-a",
      (_i, signal) => wait(10_000, signal).then(() => OK),
      keyring,
      false,
    );
    const id = enqueue(db);
    await a.runner.whenIdle();
    expect(db.settled).toEqual([
      { id, status: "FAILED", errorCode: "dispatch_timeout", outputTokens: 0 },
    ]);
    expect(db.unknown).toEqual([]);
    await a.runner.onModuleDestroy();
  }, 10_000);

  it("an instance with free slots claims only what it can run (AI_WORKER_CONCURRENCY)", async () => {
    const db = database();
    const a = instance(db, "api-a", (_i, signal) => wait(10_000, signal).then(() => OK));
    for (let i = 0; i < 5; i++) enqueue(db, `job ${i}`);
    await a.runner.tick();
    await until(() => a.calls() === workerConcurrency());
    expect(a.calls()).toBe(workerConcurrency());
    expect([...db.ops.values()].filter((o) => o.status === "RESERVED")).toHaveLength(3);
    await a.runner.onModuleDestroy();
  });

  // DP-307: the provider-terms record of a personal-data operation, checked again at dispatch.
  const TERMS = "0190c0de-0000-7000-8000-000000000307";

  it("DP-307: terms revoked between the claim and the dispatch: no request, FAILED cost 0, audited with the record", async () => {
    const db = database();
    const a = instance(db, "api-a", async () => OK);
    const id = enqueue(db, "personal", "actor-1", TERMS);
    // The owner's revocation commits after the claim; this instance has not polled since.
    db.st.afterClaim = () => void db.st.revokedTerms.add(TERMS);
    await a.runner.tick();
    await until(() => db.settled.length === 1);
    expect(a.calls()).toBe(0);
    expect(db.ops.get(id)!.dispatched).toBeNull();
    expect(db.settled).toEqual([
      { id, status: "FAILED", errorCode: "provider_terms_revoked", outputTokens: 0 },
    ]);
    expect(db.unknown).toEqual([]);
    expect(db.results.size).toBe(0);
    await until(() => db.auditRows.length === 1);
    expect(db.auditRows[0]).toMatchObject({
      action: "ai.operation.refused",
      metadata: {
        operationId: id,
        code: "provider_terms_revoked",
        personalData: true,
        dataTermsId: TERMS,
      },
    });
    await a.runner.onModuleDestroy();
  });

  it("DP-307: the dispatch itself refuses revoked terms (ai_dispatch): no request, cost 0", async () => {
    const db = database();
    const a = instance(db, "api-a", async () => OK);
    const id = enqueue(db, "personal", "actor-1", TERMS);
    // Revoked after the call plan was read: only ai_dispatch can see it.
    let planned = false;
    const ledger = (a.runner as unknown as { ledger: { callPlan: (id: string) => unknown } })
      .ledger;
    const plan = ledger.callPlan.bind(ledger);
    ledger.callPlan = async (op: string) => {
      const p = await plan(op);
      planned = true;
      db.st.revokedTerms.add(TERMS);
      return p;
    };
    await a.runner.whenIdle();
    expect(planned).toBe(true);
    expect(a.calls()).toBe(0);
    expect(db.settled).toEqual([
      { id, status: "FAILED", errorCode: "provider_terms_revoked", outputTokens: 0 },
    ]);
    await a.runner.onModuleDestroy();
  });

  it("DP-307: terms revoked while the call runs: stopped at the next poll, the answer is not kept", async () => {
    const db = database();
    const a = instance(db, "api-a", (_i, signal) => wait(10_000, signal).then(() => OK));
    const id = enqueue(db, "personal", "actor-1", TERMS);
    await a.runner.tick();
    await until(() => a.calls() === 1);
    db.st.revokedTerms.add(TERMS);
    await a.runner.tick(); // the poll sees provider_terms_revoked and aborts
    await until(() => db.unknown.length === 1);
    expect(db.unknown).toEqual([{ id, code: "provider_terms_revoked" }]);
    expect(db.results.size).toBe(0);
    expect(a.calls()).toBe(1);
    await a.runner.onModuleDestroy();
  });

  it("DP-307: terms revoked between the answer and its settlement: DISCARDED under the held gate, never stored", async () => {
    const db = database();
    const a = instance(db, "api-a", async () => OK);
    const id = enqueue(db, "personal", "actor-1", TERMS);
    db.st.revokeBeforeSettle = TERMS;
    await a.runner.whenIdle();
    expect(a.calls()).toBe(1);
    expect(db.settled).toEqual([
      { id, status: "DISCARDED", errorCode: "provider_terms_revoked", outputTokens: 2 },
    ]);
    expect(db.results.size).toBe(0);
    expect(db.audits).toContain("ai.operation.discarded");
    await a.runner.onModuleDestroy();
  });

  it("DP-307: an operation without personal data never takes the terms gate at settlement", async () => {
    const db = database();
    const a = instance(db, "api-a", async () => OK);
    const id = enqueue(db);
    db.st.revokeBeforeSettle = TERMS; // would only be seen by ai_terms_hold
    await a.runner.whenIdle();
    expect(db.settled).toEqual([{ id, status: "SUCCEEDED", errorCode: null, outputTokens: 2 }]);
    expect(draft(db, id)).toBe("pong");
    await a.runner.onModuleDestroy();
  });

  it("DP-307: no request is started once the dispatch transaction is past its start deadline", async () => {
    const db = database();
    const a = instance(db, "api-a", async () => OK);
    const id = enqueue(db);
    const real = Date.now.bind(Date);
    const now = vi.spyOn(Date, "now").mockImplementation(() => real() + skew.ms);
    try {
      // The lock waits inside ai_dispatch used the transaction's time.
      db.st.dispatchWaitMs = DISPATCH_START_DEADLINE_MS + 1;
      await a.runner.tick();
      await until(() => db.settled.length === 1);
    } finally {
      now.mockRestore();
      skew.ms = 0;
    }
    expect(a.calls()).toBe(0);
    expect(db.settled).toEqual([
      { id, status: "FAILED", errorCode: "dispatch_timeout", outputTokens: 0 },
    ]);
    await a.runner.onModuleDestroy();
  });

  it("reads its limits from the environment within bounds", () => {
    expect(workerConcurrency({})).toBe(2);
    expect(workerConcurrency({ AI_WORKER_CONCURRENCY: "4" })).toBe(4);
    expect(workerConcurrency({ AI_WORKER_CONCURRENCY: "99" })).toBe(2);
    expect(workerConcurrency({ AI_WORKER_CONCURRENCY: "0" })).toBe(0);
    expect(callTimeoutSeconds({})).toBe(45);
    expect(callTimeoutSeconds({ AI_CALL_TIMEOUT_SECONDS: "2" })).toBe(45);
    expect(callTimeoutSeconds({ AI_CALL_TIMEOUT_SECONDS: "120" })).toBe(120);
    expect(workerPollMs({})).toBe(1000);
    expect(workerPollMs({ AI_WORKER_POLL_MS: "250" })).toBe(250);
    expect(workerPollMs({ AI_WORKER_POLL_MS: "5" })).toBe(1000);
  });
});
