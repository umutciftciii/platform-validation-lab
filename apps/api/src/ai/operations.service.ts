/**
 * DP-291 (ADR-030 D6–D8): the shared AI operation service — the one entry point for every AI task
 * (AI-1 diagnostic ping; AI-2 translation/SEO/content drafts later):
 *
 *   permission (ai:invoke, AI on) → transport on → task available → input checks (length,
 *   personal data) → task plan (model, limits) → conservative estimate → budget reservation
 *   (DP-290, atomic, idempotent) → queue (runner) → one provider call → usage + settlement.
 *
 * The caller gets the operation id at once (202) and fetches the state — and, as its actor, the
 * DRAFT answer for 15 minutes — with `get`, through any API instance. DP-297: the job's input and
 * the draft are held ENCRYPTED for at most 15 minutes in "AiTransient" (UNLOGGED, migration
 * dp_297; key derived from DP_AI_ENC_KEYS, never in the database) — never in a permanent table, a
 * log or an audit event: the operation keeps a SHA-256 digest of the input, token counts, amounts
 * and codes. The AI service never writes or publishes content.
 */
import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  AiOperationCreateRequestSchema,
  type AiOperation,
  type AiOperationCancelResponse,
  type AiOperationCreated,
  type AiOperationDetail,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { aiAuditMetadata } from "./audit.js";
import { AI_CONFIG } from "./config/ai-config.provider.js";
import type { AiConfig } from "./config/ai-config.js";
import { estimateInputTokens, estimateOutputTokens, profileFor } from "./engine/estimate.js";
import { personalDataIn } from "./engine/input-policy.js";
import { AiLedgerService } from "./ledger.service.js";
import {
  sqlEnqueue,
  sqlOperationView,
  sqlRequestCancel,
  sqlResultCiphertext,
  sqlTaskPlan,
  type OperationView,
} from "./ledger-sql.js";
import { AiRunnerService } from "./runner/runner.service.js";
import { AI_TASKS } from "./tasks/registry.js";
import { openResult, sealInput } from "./transient-box.js";

type Tx = Parameters<Parameters<StaffAccess["staffData"]>[0]>[0];
const PLATFORM = { scope: "platform" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Rolls the reservation back when its input could not be queued (never expected). */
class EnqueueRefused extends Error {
  override name = "EnqueueRefused";
}
const conflict = (rule: string, path = "(root)") =>
  new ApiError("CONFLICT_STATE", [{ path, rule }]);
const invalid = (path: string, rule: string) => new ApiError("VALIDATION_FAILED", [{ path, rule }]);

/** The reservation's refusals that are the caller's request, not the configuration's state. */
const REQUEST_REFUSALS = new Set(["input_too_large", "output_too_large", "invalid"]);

function operationDto(o: OperationView): AiOperation {
  return {
    id: o.id,
    task: o.task,
    siteId: o.siteId,
    provider: o.provider,
    modelId: o.modelId,
    status: o.status as AiOperation["status"],
    estInputTokens: o.estInputTokens,
    estOutputTokens: o.estOutputTokens,
    reservedMicros: o.reservedMicros.toString(),
    actualMicros: o.actualMicros === null ? null : o.actualMicros.toString(),
    costBasis: o.costBasis,
    inputTokens: o.inputTokens,
    cachedReadTokens: o.cachedReadTokens,
    cacheWriteTokens: o.cacheWriteTokens,
    outputTokens: o.outputTokens,
    reasoningTokens: o.reasoningTokens,
    errorCode: o.errorCode,
    reservedAt: o.reservedAt.toISOString(),
    finishedAt: o.finishedAt ? o.finishedAt.toISOString() : null,
  };
}

@Injectable()
export class AiOperationsService {
  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(AiLedgerService) private readonly ledger: AiLedgerService,
    @Inject(AiRunnerService) private readonly runner: AiRunnerService,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
  ) {}

  private async allow(ctx: RequestContext, permission: string): Promise<StaffAccess> {
    const access = await this.access.begin(ctx);
    const refusal = access.refusal(permission, PLATFORM);
    const target = { type: "ai_operation", id: null };
    if (refusal === "module_disabled") {
      await access.denied(permission, target, "ai_disabled");
      throw new ApiError("NOT_FOUND");
    }
    if (refusal === "mfa_required") {
      await access.denied(permission, target, "mfa_required");
      throw new ApiError("AUTH_STEP_UP_REQUIRED");
    }
    await access.require(permission, PLATFORM, target);
    return access;
  }

  private audit(
    access: StaffAccess,
    tx: Tx,
    action: string,
    id: string | null,
    siteId: string | null,
    metadata: Record<string, unknown>,
    failure?: string,
  ) {
    return access.audit(tx, {
      action,
      resourceType: "ai_operation",
      resourceId: id,
      siteId,
      permission: "ai:invoke",
      metadata: aiAuditMetadata(metadata),
      ...(failure ? { failure: { reason: failure } } : {}),
    });
  }

  /** A refusal before any reservation, audited with its code only (never the input). */
  private async refuse(
    access: StaffAccess,
    task: string,
    siteId: string | null,
    code: string,
    error: ApiError,
  ): Promise<never> {
    await access.staffData((tx) =>
      this.audit(access, tx, "ai.operation.denied", null, siteId, { task, code }, code),
    );
    throw error;
  }

  /**
   * Starts one operation (the shared contract of AI-2/AI-3: `run(ctx, {task, siteId, input,
   * idempotencyKey})` → operation id). The reservation either succeeds as a whole or leaves no
   * trace; a refusal is an error with the engine's code as its rule.
   */
  async run(ctx: RequestContext, body: unknown): Promise<AiOperationCreated> {
    const access = await this.allow(ctx, "ai:invoke");
    const req = parseBody(AiOperationCreateRequestSchema, body);
    const siteId = req.siteId ?? null;
    if (siteId !== null && !UUID.test(siteId)) throw invalid("siteId", "uuid");
    if (this.config.transport === "off") {
      return this.refuse(access, req.task, siteId, "transport_off", conflict("transport_off"));
    }
    const def = AI_TASKS[req.task];
    if (!def.available) {
      return this.refuse(
        access,
        req.task,
        siteId,
        "task_not_available",
        conflict("task_not_available", "task"),
      );
    }
    const input = req.input.trim();
    if (input.length === 0 || input.length > def.maxInputChars) {
      return this.refuse(access, req.task, siteId, "input_too_large", invalid("input", "length"));
    }
    const personal = personalDataIn(input);
    if (personal) {
      return this.refuse(
        access,
        req.task,
        siteId,
        "input_rejected_personal_data",
        invalid("input", `input_rejected_personal_data:${personal}`),
      );
    }
    const digest = createHash("sha256")
      .update(JSON.stringify([req.task, siteId, input]))
      .digest("hex");

    const outcome = await access
      .staffData(async (tx) => {
        const plan = await sqlTaskPlan(tx, req.task);
        if (!plan) return null;
        const profile = profileFor(plan.billingProfile);
        const estInput = estimateInputTokens({ system: def.system, input }, profile);
        const estOutput = estimateOutputTokens(plan, profile);
        const r = await this.ledger.reserveIn(tx, {
          task: req.task,
          siteId,
          idempotencyKey: req.idempotencyKey,
          inputDigest: digest,
          estInputTokens: estInput,
          estOutputTokens: estOutput,
        });
        if (r.outcome === "reserved") {
          // The job: its encrypted input in the reservation's own transaction (both or neither).
          const keyring = this.config.keyring;
          if (!keyring) throw new EnqueueRefused();
          const sealed = sealInput(keyring, r.operationId as string, access.userId, {
            input,
            maxOutputTokens: plan.maxOutputTokens,
            thinkingBudget: plan.thinkingBudget,
            temperature: plan.temperatureMilli === null ? null : plan.temperatureMilli / 1000,
          });
          if ((await sqlEnqueue(tx, r.operationId as string, sealed)) !== "queued") {
            throw new EnqueueRefused();
          }
        }
        if (r.outcome === "reserved" || r.outcome === "existing") {
          await this.audit(access, tx, "ai.operation.create", r.operationId, siteId, {
            operationId: r.operationId,
            task: req.task,
            reservedMicros: r.reservedMicros,
            estInputTokens: estInput,
            estOutputTokens: estOutput,
            existing: r.outcome === "existing",
          });
        }
        return { plan, r };
      })
      .catch((error: unknown) => {
        if (error instanceof EnqueueRefused) throw conflict("queue_refused");
        throw error;
      });
    if (outcome === null) {
      return this.refuse(
        access,
        req.task,
        siteId,
        "task_disabled",
        conflict("task_disabled", "task"),
      );
    }
    const { r } = outcome;
    if (r.outcome === "ai_disabled") throw new ApiError("NOT_FOUND");
    if (r.outcome === "not_allowed") throw new ApiError("FORBIDDEN");
    if (r.outcome !== "reserved" && r.outcome !== "existing") {
      const error = REQUEST_REFUSALS.has(r.outcome)
        ? invalid("input", r.outcome)
        : conflict(r.outcome);
      return this.refuse(access, req.task, siteId, r.outcome, error);
    }
    const operationId = r.operationId as string;
    if (r.outcome === "reserved") this.runner.wake();
    const view = await access.staffData((tx) => sqlOperationView(tx, operationId));
    return {
      operationId,
      status: (view?.status ?? "RESERVED") as AiOperationCreated["status"],
      existing: r.outcome === "existing",
    };
  }

  /**
   * One operation: its own actor (ai:invoke) or an ai_usage:read holder. The draft only for its
   * actor, for 15 minutes, from the database — whichever instance ran the call.
   */
  async get(ctx: RequestContext, id: string): Promise<AiOperationDetail> {
    const access = await this.allow(ctx, "ai:invoke");
    if (!UUID.test(id)) throw new ApiError("NOT_FOUND");
    const { view, sealed } = await access.staffData(async (tx) => {
      const v = await sqlOperationView(tx, id);
      const c = v?.own && v.status === "SUCCEEDED" ? await sqlResultCiphertext(tx, id) : null;
      return { view: v, sealed: c };
    });
    if (!view) throw new ApiError("NOT_FOUND");
    const keyring = this.config.keyring;
    const text = sealed && keyring ? openResult(keyring, id, access.userId, sealed) : null;
    return {
      operation: operationDto(view),
      own: view.own,
      runner:
        view.status === "RESERVED" ? "queued" : view.status === "IN_FLIGHT" ? "running" : "none",
      result: text === null ? null : { draft: true, text },
    };
  }

  /**
   * The actor's cancel, through any instance: a queued job is released (cost 0); a running call is
   * asked to stop — aborted at once here, or by the instance that runs it at its next poll; it ends
   * UNKNOWN (no answer) or DISCARDED (the answer came anyway). A held draft is wiped.
   */
  async cancel(ctx: RequestContext, id: string): Promise<AiOperationCancelResponse> {
    const access = await this.allow(ctx, "ai:invoke");
    if (!UUID.test(id)) throw new ApiError("NOT_FOUND");
    const view = await access.staffData((tx) => sqlOperationView(tx, id));
    if (!view || !view.own) throw new ApiError("NOT_FOUND");
    const r = await access.staffData((tx) => sqlRequestCancel(tx, id));
    if (r === "not_found") throw new ApiError("NOT_FOUND");
    const stopped: AiOperationCancelResponse["stopped"] =
      r === "queued" ? "queued" : r === "running" ? "running" : "none";
    if (stopped === "running") this.runner.abortLocal(id);
    await access.staffData((tx) =>
      this.audit(access, tx, "ai.operation.cancel", id, view.siteId, {
        operationId: id,
        task: view.task,
        stopped,
        status: view.status,
      }),
    );
    return { operationId: id, stopped };
  }
}
