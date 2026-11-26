/**
 * DP-291 (ADR-030 D6–D8; design §4.3, §7.2–7.3): the queue and workers of the AI operation
 * service. Infrastructure: it runs outside any request (no staff context) and reads the provider
 * key through credential-store.
 *
 * One job = one reserved operation (DP-290). A worker:
 *   1. `ai_start` (holds the AI switch: once the owner's switch-off COMMITTED, no call starts);
 *   2. the call plan (model, ACTIVE key) and the key, decrypted for this one call;
 *   3. ONE provider call with a deadline (AI_CALL_TIMEOUT_SECONDS, default 45) — never repeated;
 *   4. settlement: SUCCEEDED (answer checked by the task) inside `whileEnabled('ai')`, FAILED
 *      (provider refusal before work: cost 0; unusable answer: its usage), UNKNOWN (timeout,
 *      lost connection, unreadable answer, cancel or switch-off while waiting: counted as spent),
 *      DISCARDED (an answer after a cancel or the switch-off: cost settled, text dropped).
 *
 * The answer text lives only in this process's memory, for its actor, for RESULT_TTL_MS — never
 * in the database, a log or an audit event — and is a DRAFT (tasks/registry.ts). Switching AI off
 * cancels every queued job, aborts every running call and drops every held answer. A crash loses
 * the queue: the sweeper (DP-290) releases RESERVED and counts IN_FLIGHT as spent at lease end.
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
} from "../../iam/platform-modules.js";
import { AI_ADAPTERS, AI_CONFIG } from "../config/ai-config.provider.js";
import type { AiConfig } from "../config/ai-config.js";
import type { AdapterRegistry } from "../providers/registry.js";
import { ProviderCallError, isUncertain, type GenerateResult } from "../providers/types.js";
import { readCredentialKey } from "../credential-store.js";
import { AiLedgerService } from "../ledger.service.js";
import { sqlCallPlan, sqlSettle, type AiTask, type SettleArgs } from "../ledger-sql.js";
import { aiAuditMetadata, type AiAuditAction } from "../audit.js";
import { AI_TASKS } from "../tasks/registry.js";

export interface AiJob {
  operationId: string;
  actorUserId: string;
  siteId: string | null;
  task: AiTask;
  input: string;
  /** The output cap and thinking budget the reservation was made for. */
  maxOutputTokens: number;
  thinkingBudget: number;
  temperature: number | null;
}

/** Why a running call was stopped by the platform, not by the provider. */
export type StopReason = "cancelled" | "ai_disabled" | "shutdown";

export const RESULT_TTL_MS = 15 * 60 * 1000;
const MAX_RESULTS = 500;
const LEASE_GRACE_SEC = 15;

const intEnv = (raw: string | undefined, fallback: number, min: number, max: number) => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
/** Workers per process (AI_WORKER_CONCURRENCY, 1–16, default 2). */
export const workerConcurrency = (env: NodeJS.ProcessEnv = process.env) =>
  intEnv(env["AI_WORKER_CONCURRENCY"], 2, 1, 16);
/** A provider call's deadline (AI_CALL_TIMEOUT_SECONDS, 5–300, default 45). */
export const callTimeoutSeconds = (env: NodeJS.ProcessEnv = process.env) =>
  intEnv(env["AI_CALL_TIMEOUT_SECONDS"], 45, 5, 300);

const ZERO = {
  inputTokens: 0,
  cachedReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

interface Running {
  job: AiJob;
  controller: AbortController;
  reason: StopReason | null;
}

export type JobState = "queued" | "running" | "none";

@Injectable()
export class AiRunnerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("AiRunner");
  private readonly queue: AiJob[] = [];
  private readonly running = new Map<string, Running>();
  private readonly results = new Map<string, { actorUserId: string; text: string; at: number }>();
  /** Bumped when AI is switched off: an answer settled before it is not handed out after it. */
  private generation = 0;
  private stopped = false;
  private unsubscribe: (() => void) | undefined;
  private readonly concurrency = workerConcurrency();
  private readonly timeoutMs = callTimeoutSeconds() * 1000;
  /** Settled jobs (tests wait on it). */
  private readonly idle = new Set<() => void>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlatformModuleService) private readonly modules: PlatformModuleService,
    @Inject(AiLedgerService) private readonly ledger: AiLedgerService,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    @Inject(AI_ADAPTERS) private readonly adapters: AdapterRegistry,
  ) {}

  onApplicationBootstrap(): void {
    this.unsubscribe = this.modules.onChange(async (change) => {
      if (change.moduleKey === AI_MODULE && !change.enabled) await this.stopAll("ai_disabled");
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.unsubscribe?.();
    await this.stopAll("shutdown");
    this.stopped = true;
  }

  /** Queues a reserved operation (the caller's reservation transaction has committed). */
  submit(job: AiJob): void {
    if (this.stopped) return;
    this.queue.push(job);
    this.pump();
  }

  state(operationId: string): JobState {
    if (this.running.has(operationId)) return "running";
    return this.queue.some((j) => j.operationId === operationId) ? "queued" : "none";
  }

  /**
   * The actor's cancel: a queued job is released (cost 0); a running call is aborted — it ends
   * UNKNOWN (no answer) or DISCARDED (the answer came anyway). Its answer is never handed out.
   */
  async cancel(operationId: string): Promise<JobState> {
    this.results.delete(operationId);
    const i = this.queue.findIndex((j) => j.operationId === operationId);
    if (i >= 0) {
      this.queue.splice(i, 1);
      await this.ledger.release(operationId, "cancel");
      return "queued";
    }
    const r = this.running.get(operationId);
    if (r) {
      r.reason ??= "cancelled";
      r.controller.abort();
      return "running";
    }
    return "none";
  }

  /** The draft answer of a SUCCEEDED operation, for its actor only, while held. */
  result(operationId: string, actorUserId: string): string | null {
    const r = this.results.get(operationId);
    if (!r || r.actorUserId !== actorUserId) return null;
    if (Date.now() - r.at > RESULT_TTL_MS) {
      this.results.delete(operationId);
      return null;
    }
    return r.text;
  }

  /** Resolves once no job is queued or running (tests). */
  whenIdle(): Promise<void> {
    if (this.queue.length === 0 && this.running.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idle.add(resolve));
  }

  private async stopAll(reason: StopReason): Promise<void> {
    this.generation++;
    this.results.clear();
    const queued = this.queue.splice(0);
    for (const r of this.running.values()) {
      r.reason ??= reason;
      r.controller.abort();
    }
    for (const job of queued) {
      await this.ledger.release(job.operationId, "cancel").catch(() => undefined);
    }
    if (queued.length) this.logger.log(`${reason}: ${queued.length} queued operation(s) cancelled`);
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift() as AiJob;
      const entry: Running = { job, controller: new AbortController(), reason: null };
      this.running.set(job.operationId, entry);
      void this.work(entry).finally(() => {
        this.running.delete(job.operationId);
        this.pump();
        if (this.queue.length === 0 && this.running.size === 0) {
          for (const resolve of this.idle) resolve();
          this.idle.clear();
        }
      });
    }
  }

  private async work(entry: Running): Promise<void> {
    const { job } = entry;
    const id = job.operationId;
    let started = false;
    try {
      const leaseSec = Math.min(600, this.timeoutMs / 1000 + LEASE_GRACE_SEC);
      const start = await this.ledger.start(id, leaseSec);
      if (start !== "started") {
        if (start === "expired") await this.ledger.release(id, "expire");
        else if (start === "ai_disabled") await this.ledger.release(id, "cancel");
        return;
      }
      started = true;
      // The sweeper counts the operation as spent at lease end: an answer settled after that is
      // DISCARDED by the database (late answer) and must not be handed out.
      const leaseEnds = Date.now() + leaseSec * 1000 - 2000;
      const failed = (code: string) => this.settle(job, "FAILED", ZERO, null, code);
      if (entry.reason) return void (await failed(entry.reason));
      const def = AI_TASKS[job.task];
      const plan = await this.ledger.callPlan(id);
      if (!plan) return void (await failed("no_active_credential"));
      const adapter = this.adapters.get(plan.provider);
      if (!adapter || !this.config.keyring) return void (await failed("transport_off"));
      const key = await readCredentialKey(
        this.prisma as unknown as Db,
        this.config.keyring,
        plan.credentialId,
        plan.provider,
      );
      if (key === null) return void (await failed("no_active_credential"));
      // Last check before the paid call: a cancel or switch-off until here costs nothing.
      if (entry.reason) return void (await failed(entry.reason));

      let result: GenerateResult;
      try {
        result = await adapter.generate(
          key,
          {
            model: plan.providerModelId,
            system: def.system,
            input: job.input,
            maxOutputTokens: job.maxOutputTokens,
            thinkingBudget: job.thinkingBudget,
            temperature: job.temperature,
          },
          {
            projectRef: plan.projectRef,
            signal: AbortSignal.any([entry.controller.signal, AbortSignal.timeout(this.timeoutMs)]),
          },
        );
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
      try {
        const { outcome, inFlight } = await this.modules.whileEnabled(AI_MODULE, async (tx) => {
          const db = tx as unknown as Db;
          // Still IN_FLIGHT (not counted as spent by the sweeper in the meantime)?
          const live = (await sqlCallPlan(db, id)) !== null;
          const r = await sqlSettle(db, id, {
            status: "SUCCEEDED",
            ...result.usage,
            providerRequestId: result.providerRequestId,
            errorCode: null,
          });
          return { outcome: r, inFlight: live };
        });
        if (outcome === "settled_overrun") await this.audit(job, "ai.operation.overrun", "overrun");
        const deliver =
          inFlight &&
          outcome.startsWith("settled") &&
          Date.now() < leaseEnds &&
          generation === this.generation &&
          !entry.reason;
        if (deliver) {
          this.keep(id, job.actorUserId, text);
        }
      } catch (error) {
        if (!(error instanceof PlatformModuleDisabledError)) throw error;
        // The answer arrived after the switch-off: settled, never handed out.
        await this.settle(job, "DISCARDED", result.usage, result.providerRequestId, "ai_disabled");
        await this.audit(job, "ai.operation.discarded", "ai_disabled");
      }
    } catch (error) {
      // A database failure: the lease decides (RESERVED → released, IN_FLIGHT → counted as spent).
      this.logger.error(
        `operation ${id} ${started ? "after start" : "before start"}: ${(error as Error).name}`,
      );
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

  private keep(id: string, actorUserId: string, text: string): void {
    const now = Date.now();
    for (const [k, v] of this.results) {
      if (now - v.at > RESULT_TTL_MS) this.results.delete(k);
    }
    while (this.results.size >= MAX_RESULTS) {
      const oldest = this.results.keys().next().value as string;
      this.results.delete(oldest);
    }
    this.results.set(id, { actorUserId, text, at: now });
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
      metadata: aiAuditMetadata({ operationId: job.operationId, task: job.task, code }),
      requestId: null,
    }).catch((error: unknown) => this.logger.error(`audit failed: ${(error as Error).name}`));
  }
}
