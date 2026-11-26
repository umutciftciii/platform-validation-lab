/**
 * DP-291 (ADR-030 D6–D8; design §4.3, §7.2): the queue and workers against stub engine, switch,
 * database and adapters — the order start → call plan → one provider call → settlement, and every
 * way a call ends: success (draft handed to its actor only), refusal (cost 0), uncertain (counted
 * as spent, never repeated), cancel and switch-off (queued released, running aborted, a late
 * answer discarded and never handed out).
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aiCredentialAad, encryptSecret, parseKeyring } from "../../../src/iam/auth/secret-box.js";
import { PlatformModuleDisabledError } from "../../../src/iam/platform-modules.js";
import {
  AiRunnerService,
  callTimeoutSeconds,
  workerConcurrency,
  type AiJob,
} from "../../../src/ai/runner/runner.service.js";
import {
  ProviderCallError,
  type AiProviderAdapter,
  type GenerateResult,
} from "../../../src/ai/providers/types.js";

const keyring = parseKeyring(`1:${randomBytes(32).toString("base64url")}`, "DP_AI_ENC_KEYS");
const CRED = "0190c0de-0000-7000-8000-000000000001";
const KEY = "fake-provider-key-0123456789";
const stored = encryptSecret(keyring, Buffer.from(KEY), aiCredentialAad(CRED, "OPENAI"));
const PLAN = {
  provider: "OPENAI",
  provider_model_id: "gpt-x",
  credential_id: CRED,
  project_ref: null,
};
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

type Settled = { id: string; status: string; errorCode: string | null; outputTokens: number };

function harness(generate: (input: string, signal: AbortSignal) => Promise<GenerateResult>) {
  const log: string[] = [];
  const settled: Settled[] = [];
  const unknown: { id: string; code: string }[] = [];
  const released: { id: string; reason: string }[] = [];
  let enabled = true;
  let inFlight = new Set<string>();
  const listeners: ((c: { moduleKey: string; enabled: boolean }) => Promise<void> | void)[] = [];
  const audits: string[] = [];
  let calls = 0;

  const sqlTx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      const id = values[0] as string;
      if (sql.includes("ai_credential_ciphertext")) return [{ c: stored }];
      if (sql.includes("ai_call_plan")) return inFlight.has(id) ? [PLAN] : [];
      if (sql.includes("ai_settle")) {
        settled.push({
          id,
          status: values[1] as string,
          errorCode: values[8] as string | null,
          outputTokens: values[5] as number,
        });
        inFlight.delete(id);
        return [{ r: "settled" }];
      }
      throw new Error(`unexpected SQL ${sql}`);
    },
  };
  const prisma = {
    ...sqlTx,
    auditEvent: {
      createMany: async (a: { data: { action: string }[] }) => void audits.push(a.data[0]!.action),
    },
  };
  const modules = {
    onChange: (l: (typeof listeners)[number]) => {
      listeners.push(l);
      return () => undefined;
    },
    whileEnabled: async (_key: string, fn: (tx: unknown) => Promise<unknown>) => {
      if (!enabled) throw new PlatformModuleDisabledError("ai");
      return fn(sqlTx);
    },
  };
  const ledger = {
    start: async (id: string) => {
      log.push(`start ${id}`);
      if (!enabled) return "ai_disabled";
      inFlight.add(id);
      return "started";
    },
    callPlan: async (id: string) =>
      inFlight.has(id) && enabled
        ? { provider: "OPENAI", providerModelId: "gpt-x", credentialId: CRED, projectRef: null }
        : null,
    settle: async (
      id: string,
      a: { status: string; errorCode: string | null; outputTokens: number },
    ) => {
      settled.push({ id, status: a.status, errorCode: a.errorCode, outputTokens: a.outputTokens });
      inFlight.delete(id);
      return "settled";
    },
    markUnknown: async (id: string, code: string) => {
      unknown.push({ id, code });
      inFlight.delete(id);
      return "assumed";
    },
    release: async (id: string, reason: string) => {
      released.push({ id, reason });
      return "released";
    },
  };
  const adapter = {
    provider: "OPENAI",
    billingProfile: "openai.fake",
    listModels: async () => [],
    getModel: async () => null,
    generate: async (key: string, r: { input: string }, o: { signal: AbortSignal }) => {
      expect(key).toBe(KEY);
      calls++;
      return generate(r.input, o.signal);
    },
  } as unknown as AiProviderAdapter;
  const runner = new AiRunnerService(
    prisma as never,
    modules as never,
    ledger as never,
    { transport: "fake", keyring, localCap: null },
    new Map([["OPENAI", adapter]]),
  );
  runner.onApplicationBootstrap();
  const job = (n: number, input = "ping", actor = "actor-1"): AiJob => ({
    operationId: `op-${n}`,
    actorUserId: actor,
    siteId: null,
    task: "DIAGNOSTIC_PING",
    input,
    maxOutputTokens: 16,
    thinkingBudget: 0,
    temperature: null,
  });
  return {
    runner,
    job,
    settled,
    unknown,
    released,
    audits,
    log,
    calls: () => calls,
    async switchOff() {
      enabled = false;
      for (const l of listeners) await l({ moduleKey: "ai", enabled: false });
    },
    expireLease(id: string) {
      inFlight.delete(id);
    },
    reset() {
      inFlight = new Set();
    },
  };
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

describe("DP-291: the worker", () => {
  it("starts, calls once, settles SUCCEEDED and hands the draft to its actor only", async () => {
    const h = harness(async () => OK);
    h.runner.submit(h.job(1));
    await h.runner.whenIdle();
    expect(h.calls()).toBe(1);
    expect(h.settled).toEqual([
      { id: "op-1", status: "SUCCEEDED", errorCode: null, outputTokens: 2 },
    ]);
    expect(h.runner.result("op-1", "actor-1")).toBe("pong");
    expect(h.runner.result("op-1", "someone-else")).toBeNull();
    expect(h.runner.state("op-1")).toBe("none");
  });

  it("settles a refusal before work as FAILED with cost 0 and never repeats it", async () => {
    const h = harness(async () => {
      throw new ProviderCallError("rate_limited", 429, 1);
    });
    h.runner.submit(h.job(2));
    await h.runner.whenIdle();
    expect(h.calls()).toBe(1);
    expect(h.settled).toEqual([
      { id: "op-2", status: "FAILED", errorCode: "rate_limited", outputTokens: 0 },
    ]);
    expect(h.unknown).toEqual([]);
  });

  it("counts a timeout, a lost connection or an unreadable answer as spent (UNKNOWN), once", async () => {
    for (const code of ["timeout", "network_error", "bad_response"] as const) {
      const h = harness(async () => {
        throw new ProviderCallError(code);
      });
      h.runner.submit(h.job(3));
      await h.runner.whenIdle();
      expect(h.calls()).toBe(1);
      expect(h.unknown).toEqual([{ id: "op-3", code }]);
      expect(h.settled).toEqual([]);
      expect(h.audits).toEqual(["ai.operation.unknown"]);
      expect(h.runner.result("op-3", "actor-1")).toBeNull();
    }
  });

  it("settles an unusable answer FAILED with its usage (refusal, cap reached, empty)", async () => {
    for (const [r, code] of [
      [{ ...OK, finish: "refused", text: "" }, "output_refused"],
      [{ ...OK, finish: "max_tokens" }, "output_max_tokens"],
      [{ ...OK, text: "  " }, "output_invalid"],
    ] as const) {
      const h = harness(async () => r);
      h.runner.submit(h.job(4));
      await h.runner.whenIdle();
      expect(h.settled).toEqual([
        { id: "op-4", status: "FAILED", errorCode: code, outputTokens: 2 },
      ]);
      expect(h.runner.result("op-4", "actor-1")).toBeNull();
    }
  });

  it("switch-off: queued jobs are released, running calls aborted (UNKNOWN), no call starts after it", async () => {
    const h = harness((_input, signal) => wait(10_000, signal).then(() => OK));
    for (let i = 10; i < 16; i++) h.runner.submit(h.job(i));
    await tick();
    expect(h.runner.state("op-10")).toBe("running");
    expect(h.runner.state("op-15")).toBe("queued");
    const before = h.calls();
    await h.switchOff();
    await h.runner.whenIdle();
    expect(h.calls()).toBe(before);
    expect(h.released.map((r) => r.reason)).toEqual(["cancel", "cancel", "cancel", "cancel"]);
    expect(h.unknown.map((u) => u.code)).toEqual(["ai_disabled", "ai_disabled"]);
    // Submitting after the switch-off: start is refused by the database and released.
    h.runner.submit(h.job(20));
    await h.runner.whenIdle();
    expect(h.calls()).toBe(before);
    expect(h.released.at(-1)).toEqual({ id: "op-20", reason: "cancel" });
  });

  it("an answer that arrives after the switch-off is settled DISCARDED and never handed out", async () => {
    let finish: (r: GenerateResult) => void = () => undefined;
    const h = harness(() => new Promise<GenerateResult>((resolve) => (finish = resolve)));
    h.runner.submit(h.job(30));
    await tick();
    await h.switchOff(); // the adapter ignores the abort and answers anyway
    finish(OK);
    await h.runner.whenIdle();
    expect(h.settled).toEqual([
      { id: "op-30", status: "DISCARDED", errorCode: "ai_disabled", outputTokens: 2 },
    ]);
    expect(h.audits).toEqual(["ai.operation.discarded"]);
    expect(h.runner.result("op-30", "actor-1")).toBeNull();
  });

  it("a SUCCEEDED answer is dropped when the switch-off comes before it is handed out", async () => {
    const h = harness(async () => OK);
    h.runner.submit(h.job(31));
    await h.runner.whenIdle();
    expect(h.runner.result("op-31", "actor-1")).toBe("pong");
    await h.switchOff();
    expect(h.runner.result("op-31", "actor-1")).toBeNull();
  });

  it("an answer after the lease ended (counted as spent) is not handed out", async () => {
    let finish: (r: GenerateResult) => void = () => undefined;
    const h = harness(() => new Promise<GenerateResult>((resolve) => (finish = resolve)));
    h.runner.submit(h.job(32));
    await tick();
    h.expireLease("op-32");
    finish(OK);
    await h.runner.whenIdle();
    expect(h.runner.result("op-32", "actor-1")).toBeNull();
  });

  it("the actor's cancel releases a queued job and aborts a running call", async () => {
    const pending = new Map<string, (r: GenerateResult) => void>();
    const h = harness(
      (input) => new Promise<GenerateResult>((resolve) => pending.set(input, resolve)),
    );
    h.runner.submit(h.job(40, "a"));
    h.runner.submit(h.job(41, "b"));
    h.runner.submit(h.job(42, "c"));
    await tick();
    expect(await h.runner.cancel("op-42")).toBe("queued");
    expect(await h.runner.cancel("op-40")).toBe("running");
    expect(await h.runner.cancel("op-99")).toBe("none");
    pending.get("a")!(OK); // op-40 answers anyway: DISCARDED
    pending.get("b")!(OK); // op-41 completes
    await h.runner.whenIdle();
    expect(h.released).toEqual([{ id: "op-42", reason: "cancel" }]);
    expect(h.settled.find((s) => s.id === "op-40")).toMatchObject({
      status: "DISCARDED",
      errorCode: "cancelled",
    });
    expect(h.runner.result("op-40", "actor-1")).toBeNull();
    expect(h.runner.result("op-41", "actor-1")).toBe("pong");
  });

  it("reads its limits from the environment within bounds", () => {
    expect(workerConcurrency({})).toBe(2);
    expect(workerConcurrency({ AI_WORKER_CONCURRENCY: "4" })).toBe(4);
    expect(workerConcurrency({ AI_WORKER_CONCURRENCY: "99" })).toBe(2);
    expect(callTimeoutSeconds({})).toBe(45);
    expect(callTimeoutSeconds({ AI_CALL_TIMEOUT_SECONDS: "2" })).toBe(45);
    expect(callTimeoutSeconds({ AI_CALL_TIMEOUT_SECONDS: "120" })).toBe(120);
  });
});
