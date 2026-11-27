/**
 * DP-291 + DP-297 (ADR-030 D6–D8, D10; design §4.3, §7.2–7.3): the workers of the AI operation
 * service. Infrastructure: it runs outside any request (no staff context) and reads the provider
 * key through credential-store.
 *
 * The queue is the database (DP-297): a reserved operation with its encrypted input
 * ("AiTransient", migration dp_297) is a job. Every API instance runs this worker; each poll
 * (AI_WORKER_POLL_MS, default 1000; at once after a local submit):
 *   1. asks which of its running calls must stop (`ai_stop_signals`: the owner's switch-off, the
 *      actor's cancel received by ANY instance, a lease the sweeper ended) and aborts them;
 *   2. claims up to its free slots (`ai_claim`: holds the AI switch, never more calls in flight on
 *      all instances than AiSettings.maxConcurrency, row lock + SKIP LOCKED, RESERVED → IN_FLIGHT
 *      in the same transaction, the input handed out once and wiped). No job runs twice.
 * A claimed job: the call plan (model, ACTIVE key; none once AI is off or a stop was requested) →
 * the key, decrypted for this one call → ONE provider call with a deadline
 * (AI_CALL_TIMEOUT_SECONDS, default 45) — never repeated → settlement: SUCCEEDED (answer checked
 * by the task; its encrypted draft stored in the same whileEnabled('ai') transaction, 15 min, for
 * its actor only, readable through any instance), FAILED (refusal before work: cost 0; unusable
 * answer: its usage), UNKNOWN (timeout, lost connection, unreadable answer, cancel, switch-off or
 * shutdown while waiting: counted as spent), DISCARDED (an answer after a cancel or the
 * switch-off: cost settled, text dropped).
 *
 * DP-307: a personal-data operation names its provider-terms record. ai_dispatch checks it again
 * under the provider's terms gate in the dispatch transaction: revoked or renewed → no request,
 * FAILED with cost 0 (`provider_terms_revoked`, audited `ai.operation.refused` with the record's
 * id). A running call whose terms are revoked is stopped at the next poll, and its answer is
 * settled DISCARDED in a settlement transaction that holds the terms gate (never stored).
 *
 * Restart and crash: queued jobs stay in the database and any instance claims them while their
 * reservation lasts (AiSettings.reservationTtlSec), then they EXPIRE (cost 0; the user starts a new
 * operation). A call that was running when its instance stopped is never repeated: the sweeper
 * counts it as spent at lease end (UNKNOWN). Texts never reach a log or an audit event.
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { Db } from "../../iam/db.js";
import { writeAudit } from "../../iam/staff/audit-writer.js";
import {
  AI_MODULE,
  PlatformModuleDisabledError,
  PlatformModuleService,
  WHILE_ENABLED_TIMEOUT_MS,
} from "../../iam/platform-modules.js";
import { AI_ADAPTERS, AI_CONFIG } from "../config/ai-config.provider.js";
import type { AiConfig } from "../config/ai-config.js";
import type { AdapterRegistry } from "../providers/registry.js";
import { ProviderCallError, isUncertain, type GenerateResult } from "../providers/types.js";
import { readCredentialKey } from "../credential-store.js";
import { AiLedgerService } from "../ledger.service.js";
import {
  sqlClaim,
  sqlDispatch,
  sqlQueueDepth,
  sqlSettle,
  sqlStopSignals,
  sqlStoreResult,
  sqlTermsHold,
  type AiTask,
  type ClaimedJob,
  type DispatchOutcome,
  type SettleArgs,
  type StopSignal,
} from "../ledger-sql.js";
import { aiAuditMetadata, type AiAuditAction } from "../audit.js";
import { AI_TASKS } from "../tasks/registry.js";
import { openInput, sealResult, type JobPayload } from "../transient-box.js";

/** One claimed job with its decrypted payload. */
export interface AiJob extends JobPayload {
  operationId: string;
  actorUserId: string;
  siteId: string | null;
  task: AiTask;
  /** DP-307: the provider-terms record of a personal-data operation (null: none). */
  dataTermsId: string | null;
}

/** Why a running call was stopped by the platform, not by the provider. */
export type StopReason =
  "cancelled" | "ai_disabled" | "shutdown" | "lease_expired" | "provider_terms_revoked";

export const RESULT_TTL_MS = 15 * 60 * 1000;
const LEASE_GRACE_SEC = 15;

const intEnv = (raw: string | undefined, fallback: number, min: number, max: number) => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
/**
 * Workers per instance (AI_WORKER_CONCURRENCY, 0–16, default 2; 0 = an API-only instance that
 * accepts and serves operations but runs no call). The total in flight stays maxConcurrency.
 */
export const workerConcurrency = (env: NodeJS.ProcessEnv = process.env) =>
  intEnv(env["AI_WORKER_CONCURRENCY"], 2, 0, 16);
/** A provider call's deadline (AI_CALL_TIMEOUT_SECONDS, 5–300, default 45). */
export const callTimeoutSeconds = (env: NodeJS.ProcessEnv = process.env) =>
  intEnv(env["AI_CALL_TIMEOUT_SECONDS"], 45, 5, 300);
/** How often an instance looks for jobs and stop signals (AI_WORKER_POLL_MS, 100–10000, default 1000). */
export const workerPollMs = (env: NodeJS.ProcessEnv = process.env) =>
  intEnv(env["AI_WORKER_POLL_MS"], 1000, 100, 10_000);

const ZERO = {
  inputTokens: 0,
  cachedReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

const STOP_REASON: Record<StopSignal, StopReason> = {
  ai_disabled: "ai_disabled",
  cancelled: "cancelled",
  provider_terms_revoked: "provider_terms_revoked",
  not_in_flight: "lease_expired",
  lease_expired: "lease_expired",
};

/** How long the switch is held at most for a request to reach the transport (ms). */
export const DISPATCH_HANDOFF_MS = 2_000;
/**
 * DP-307: the latest moment (ms after the dispatch transaction began) a request may still be
 * started in it. The transaction is ended by Prisma at WHILE_ENABLED_TIMEOUT_MS; the lock waits of
 * ai_dispatch (switch, operation row, terms gate; each ≤ WHILE_ENABLED_LOCK_TIMEOUT_MS) could use
 * most of it. A request started later could be handed to the transport after the rollback — i.e.
 * after the locks were released, unordered against a switch-off or a terms revocation. Past this
 * point nothing is started (no request, cost 0, `dispatch_timeout`).
 */
export const DISPATCH_START_DEADLINE_MS = WHILE_ENABLED_TIMEOUT_MS - DISPATCH_HANDOFF_MS - 2_000;

class DispatchRefused extends Error {
  override name = "DispatchRefused";
  constructor(readonly outcome: StopReason | "dispatch_timeout") {
    super(outcome);
  }
}

/** The settlement code of a refused dispatch (no request was sent). */
const DISPATCH_CODE: Partial<Record<string, string>> = {
  not_in_flight: "lease_expired",
  unknown: "lease_expired",
};

interface Running {
  operationId: string;
  controller: AbortController;
  reason: StopReason | null;
  done: Promise<void>;
}

/** Whether a call of this instance runs the operation (diagnostics; the database knows the rest). */
export type JobState = "running" | "none";

@Injectable()
export class AiRunnerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("AiRunner");
  private readonly running = new Map<string, Running>();
  /** Bumped when AI is switched off here: an answer settled before it is not stored after it. */
  private generation = 0;
  private stopped = false;
  private unsubscribe: (() => void) | undefined;
  private timer: NodeJS.Timeout | undefined;
  private ticking: Promise<void> | null = null;
  private again = false;
  private readonly concurrency = workerConcurrency();
  private readonly timeoutMs = callTimeoutSeconds() * 1000;
  private readonly leaseSec = Math.min(600, callTimeoutSeconds() + LEASE_GRACE_SEC);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlatformModuleService) private readonly modules: PlatformModuleService,
    @Inject(AiLedgerService) private readonly ledger: AiLedgerService,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    @Inject(AI_ADAPTERS) private readonly adapters: AdapterRegistry,
  ) {}

  onApplicationBootstrap(): void {
    // Fast path in this instance; the other instances learn it from ai_stop_signals.
    this.unsubscribe = this.modules.onChange((change) => {
      if (change.moduleKey === AI_MODULE && !change.enabled) this.abortAll("ai_disabled");
    });
    if (this.config.transport === "off" || !this.config.keyring || this.concurrency === 0) return;
    this.timer = setInterval(() => void this.tick(), workerPollMs());
    this.timer.unref();
  }

  /** Shutdown: running calls are aborted (UNKNOWN, never repeated); queued jobs stay queued. */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
    this.abortAll("shutdown");
    await this.ticking?.catch(() => undefined);
    await Promise.allSettled([...this.running.values()].map((r) => r.done));
  }

  /** A job was queued in this instance: look at once instead of at the next poll. */
  wake(): void {
    if (!this.stopped && this.timer) void this.tick();
  }

  state(operationId: string): JobState {
    return this.running.has(operationId) ? "running" : "none";
  }

  /** The actor's cancel reached this instance: abort the call at once if it runs here. */
  abortLocal(operationId: string): boolean {
    const r = this.running.get(operationId);
    if (!r) return false;
    r.reason ??= "cancelled";
    r.controller.abort();
    return true;
  }

  /** Resolves once this instance runs nothing and nothing is queued on any instance (tests). */
  async whenIdle(timeoutMs = 30_000): Promise<void> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      if (Date.now() > end) throw new Error("AI runner not idle");
      await this.tick();
      await Promise.allSettled([...this.running.values()].map((r) => r.done));
      // A poll started by a finished job may hold a claim not yet in `running`: wait for it.
      if (this.ticking || this.running.size > 0) continue;
      const depth = await sqlQueueDepth(this.prisma as unknown as Db);
      if (depth === 0 && !this.ticking && this.running.size === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** One poll: stop signals, then claims. Never two at once; a request in between runs again. */
  tick(): Promise<void> {
    if (this.ticking) {
      this.again = true;
      return this.ticking;
    }
    this.ticking = (async () => {
      try {
        do {
          this.again = false;
          await this.signals();
          await this.claim();
        } while (this.again && !this.stopped);
      } catch (error) {
        // A database failure: the next poll tries again; the lease protects the money.
        this.logger.error(`poll failed: ${(error as Error).name}`);
      } finally {
        this.ticking = null;
      }
    })();
    return this.ticking;
  }

  private abortAll(reason: StopReason): void {
    if (reason === "ai_disabled") this.generation++;
    for (const r of this.running.values()) {
      r.reason ??= reason;
      r.controller.abort();
    }
  }

  private async signals(): Promise<void> {
    if (this.running.size === 0) return;
    const stops = await sqlStopSignals(this.prisma as unknown as Db, [...this.running.keys()]);
    for (const s of stops) {
      const r = this.running.get(s.operationId);
      if (!r) continue;
      if (s.reason === "ai_disabled") this.generation++;
      r.reason ??= STOP_REASON[s.reason];
      r.controller.abort();
    }
  }

  private async claim(): Promise<void> {
    const keyring = this.config.keyring;
    if (this.stopped || !keyring || this.config.transport === "off") return;
    const free = this.concurrency - this.running.size;
    if (free <= 0) return;
    const jobs = await this.prisma.$transaction((tx) =>
      sqlClaim(tx as unknown as Db, this.ledger.instanceId, this.leaseSec, free),
    );
    for (const claimed of jobs) {
      // The sweeper counts the call as spent at lease end: an answer settled after that is
      // DISCARDED by the database and never stored.
      const leaseEnds = Date.now() + this.leaseSec * 1000 - 2000;
      const entry: Running = {
        operationId: claimed.operationId,
        controller: new AbortController(),
        reason: null,
        done: Promise.resolve(),
      };
      this.running.set(claimed.operationId, entry);
      entry.done = this.work(entry, claimed, leaseEnds).finally(() => {
        this.running.delete(claimed.operationId);
        if (!this.stopped) this.again = true;
        if (!this.stopped && !this.ticking) void this.tick();
      });
    }
  }

  private async work(entry: Running, claimed: ClaimedJob, leaseEnds: number): Promise<void> {
    const id = claimed.operationId;
    const keyring = this.config.keyring;
    const payload =
      keyring && claimed.actorUserId
        ? openInput(keyring, id, claimed.actorUserId, claimed.payload)
        : null;
    const job: AiJob = {
      operationId: id,
      actorUserId: claimed.actorUserId ?? "",
      siteId: claimed.siteId,
      task: claimed.task,
      dataTermsId: claimed.dataTermsId ?? null,
      input: payload?.input ?? "",
      maxOutputTokens: payload?.maxOutputTokens ?? 0,
      thinkingBudget: payload?.thinkingBudget ?? 0,
      temperature: payload?.temperature ?? null,
    };
    try {
      const failed = async (code: string) => {
        await this.settle(job, "FAILED", ZERO, null, code);
        // DP-307: a refusal by the terms (no request, cost 0) is audited with the record's id.
        if (code === "provider_terms_revoked") await this.audit(job, "ai.operation.refused", code);
      };
      // No call was made: an input that does not decrypt (other keyring, tampering) costs nothing.
      if (!payload || !keyring) return void (await failed("input_unreadable"));
      if (entry.reason) return void (await failed(entry.reason));
      const def = AI_TASKS[job.task];
      const plan = await this.ledger.callPlan(id);
      if (!plan) {
        // No plan: AI off, a stop requested, the lease over — or no ACTIVE key any more.
        const stop = (await sqlStopSignals(this.prisma as unknown as Db, [id]))[0];
        return void (await failed(
          entry.reason ?? (stop ? STOP_REASON[stop.reason] : "no_active_credential"),
        ));
      }
      const adapter = this.adapters.get(plan.provider);
      if (!adapter) return void (await failed("transport_off"));
      const key = await readCredentialKey(
        this.prisma as unknown as Db,
        keyring,
        plan.credentialId,
        plan.provider,
      );
      if (key === null) return void (await failed("no_active_credential"));
      // A cancel or switch-off until here costs nothing.
      if (entry.reason) return void (await failed(entry.reason));

      // DP-297: the paid request starts ONLY inside a transaction that holds the AI switch
      // (ai_dispatch). The owner's switch-off waits for that transaction, so every request is
      // ordered before the switch-off COMMIT; after it, ai_dispatch answers ai_disabled.
      const signal = AbortSignal.any([
        entry.controller.signal,
        AbortSignal.timeout(this.timeoutMs),
      ]);
      const request = {
        model: plan.providerModelId,
        system: def.system,
        input: job.input,
        maxOutputTokens: job.maxOutputTokens,
        thinkingBudget: job.thinkingBudget,
        temperature: job.temperature,
      };
      const dispatch = await this.dispatch(entry, (onDispatch) =>
        adapter.generate(key, request, { projectRef: plan.projectRef, signal, onDispatch }),
      );
      if (dispatch.kind === "refused") {
        if (dispatch.outcome === "already_dispatched") {
          // Never expected (claims are unique): the other request is not touched.
          this.logger.error(`operation ${id}: dispatched twice refused`);
          return;
        }
        // No request was sent: cost 0 (from UNKNOWN the database releases the assumed amount).
        return void (await failed(DISPATCH_CODE[dispatch.outcome] ?? dispatch.outcome));
      }

      let result: GenerateResult;
      try {
        result = await dispatch.call;
      } catch (error) {
        const code = error instanceof ProviderCallError ? error.code : "network_error";
        if (entry.reason || isUncertain(code)) {
          // The provider may have done (and billed) the work: counted as spent, never repeated.
          const why = entry.reason ?? code;
          await this.ledger.markUnknown(id, why);
          await this.audit(job, "ai.operation.unknown", why);
        } else {
          // Refused before any work (key, permission, model, rate limit, quota, outage): cost 0.
          await failed(code);
        }
        return;
      }

      if (entry.reason) {
        await this.settle(job, "DISCARDED", result.usage, result.providerRequestId, entry.reason);
        await this.audit(job, "ai.operation.discarded", entry.reason);
        return;
      }
      const text = result.finish === "complete" ? def.checkOutput(result.text) : null;
      if (text === null) {
        const code = result.finish === "complete" ? "output_invalid" : `output_${result.finish}`;
        await this.settle(job, "FAILED", result.usage, result.providerRequestId, code);
        return;
      }
      const generation = this.generation;
      const sealed = sealResult(keyring, id, job.actorUserId, text);
      try {
        const { outcome, cancelled } = await this.modules.whileEnabled(AI_MODULE, async (tx) => {
          const db = tx as unknown as Db;
          // DP-307: the terms gate held to COMMIT; revoked or renewed meanwhile → dropped.
          const terms = job.dataTermsId === null ? "ok" : await sqlTermsHold(db, id);
          // A cancel received by another instance and not yet seen here: the answer is dropped.
          const stop = (await sqlStopSignals(db, [id])).find((s) => s.reason === "cancelled");
          if (stop || terms !== "ok") {
            const why = stop ? "cancelled" : "provider_terms_revoked";
            const r = await sqlSettle(db, id, {
              status: "DISCARDED",
              ...result.usage,
              providerRequestId: result.providerRequestId,
              errorCode: why,
            });
            return { outcome: r, cancelled: why };
          }
          const r = await sqlSettle(db, id, {
            status: "SUCCEEDED",
            ...result.usage,
            providerRequestId: result.providerRequestId,
            errorCode: null,
          });
          // Stored only if SUCCEEDED now (not counted as spent by the sweeper meanwhile), before
          // the lease ended, with AI on (held to COMMIT) and no switch-off seen here.
          if (
            r.startsWith("settled") &&
            Date.now() < leaseEnds &&
            generation === this.generation &&
            !entry.reason
          ) {
            await sqlStoreResult(db, id, sealed);
          }
          return { outcome: r, cancelled: null };
        });
        if (cancelled) await this.audit(job, "ai.operation.discarded", cancelled);
        if (outcome === "settled_overrun") await this.audit(job, "ai.operation.overrun", "overrun");
      } catch (error) {
        if (!(error instanceof PlatformModuleDisabledError)) throw error;
        // The answer arrived after the switch-off: settled, never handed out.
        await this.settle(job, "DISCARDED", result.usage, result.providerRequestId, "ai_disabled");
        await this.audit(job, "ai.operation.discarded", "ai_disabled");
      }
    } catch (error) {
      // A database failure: the lease decides (IN_FLIGHT → counted as spent at lease end).
      this.logger.error(`operation ${id}: ${(error as Error).name}`);
    }
  }

  /**
   * DP-297: runs `start` (the provider request) inside one whileEnabled('ai') transaction after
   * ai_dispatch granted it, and commits only once the request was handed to the transport
   * (`onDispatch`) or failed — bounded by DISPATCH_HANDOFF_MS, after which the request is aborted
   * before it is sent. The switch is never held for the provider's answer.
   */
  private async dispatch(
    entry: Running,
    start: (onDispatch: () => void) => Promise<GenerateResult>,
  ): Promise<
    | { kind: "sent"; call: Promise<GenerateResult> }
    | {
        kind: "refused";
        outcome: Exclude<DispatchOutcome, "dispatch"> | StopReason | "dispatch_timeout";
      }
  > {
    let call: Promise<GenerateResult> | null = null;
    let handedOff = false;
    try {
      const outcome = await this.modules.whileEnabled(AI_MODULE, async (tx) => {
        const began = Date.now();
        const r = await sqlDispatch(tx as unknown as Db, entry.operationId);
        if (r !== "dispatch") return r;
        // Stopped here since the claim (this instance's listener): roll the permission back.
        if (entry.reason) throw new DispatchRefused(entry.reason);
        // DP-307: too late in the transaction to start a request that must reach the transport
        // while the locks are still held (see DISPATCH_START_DEADLINE_MS): roll back, send nothing.
        if (Date.now() - began > DISPATCH_START_DEADLINE_MS) {
          throw new DispatchRefused("dispatch_timeout");
        }
        let markHanded: () => void = () => undefined;
        const handed = new Promise<"handed">((resolve) => (markHanded = () => resolve("handed")));
        const pending = start(() => {
          handedOff = true;
          markHanded();
        });
        call = pending;
        pending.catch(() => undefined);
        let timer: NodeJS.Timeout | undefined;
        const first = await Promise.race([
          handed,
          pending.then(
            () => "settled" as const,
            () => "settled" as const,
          ),
          new Promise<"late">(
            (resolve) => (timer = setTimeout(() => resolve("late"), DISPATCH_HANDOFF_MS)),
          ),
        ]);
        clearTimeout(timer);
        if (first === "late") {
          // Not with the transport in time: abort before anything is sent, roll back.
          entry.reason ??= "cancelled";
          entry.controller.abort();
          throw new DispatchRefused("dispatch_timeout");
        }
        return "dispatch" as const;
      });
      if (outcome !== "dispatch") return { kind: "refused", outcome };
      return { kind: "sent", call: call as unknown as Promise<GenerateResult> };
    } catch (error) {
      if (error instanceof PlatformModuleDisabledError) {
        return { kind: "refused", outcome: "ai_disabled" };
      }
      if (error instanceof DispatchRefused) {
        await (call as Promise<GenerateResult> | null)?.catch(() => undefined);
        return { kind: "refused", outcome: error.outcome };
      }
      if (call && handedOff) {
        // The request was handed to the transport while the switch and the terms gate were held,
        // but the transaction did not commit: it was still ordered before any switch-off or
        // revocation; its outcome is uncertain (handled as a running call).
        return { kind: "sent", call };
      }
      if (call) {
        // DP-307: started but not with the transport, and the locks are gone: abort before it is
        // sent (postJson checks the signal right before fetch), then let the caller see the error.
        entry.reason ??= "cancelled";
        entry.controller.abort();
        await (call as Promise<GenerateResult>).catch(() => undefined);
      }
      throw error;
    }
  }

  private async settle(
    job: AiJob,
    status: SettleArgs["status"],
    usage: typeof ZERO,
    providerRequestId: string | null,
    errorCode: string | null,
  ): Promise<void> {
    const r = await this.ledger.settle(job.operationId, {
      status,
      ...usage,
      providerRequestId,
      errorCode,
    });
    if (r === "settled_overrun") await this.audit(job, "ai.operation.overrun", "overrun");
  }

  /** A system audit event: ids and codes only (aiAuditMetadata), never a text. */
  private async audit(job: AiJob, action: AiAuditAction, code: string): Promise<void> {
    await writeAudit(this.prisma as unknown as Db, {
      actorType: "SYSTEM",
      action,
      resourceType: "ai_operation",
      resourceId: job.operationId,
      scopeType: job.siteId ? "SITE" : "PLATFORM",
      siteId: job.siteId,
      outcome: "FAILURE",
      reason: code,
      metadata: aiAuditMetadata({
        operationId: job.operationId,
        task: job.task,
        code,
        ...(job.dataTermsId ? { personalData: true, dataTermsId: job.dataTermsId } : {}),
      }),
      requestId: null,
    }).catch((error: unknown) => this.logger.error(`audit failed: ${(error as Error).name}`));
  }
}
