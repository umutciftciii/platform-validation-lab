/**
 * DP-290 (ADR-030 D6): calls of the engine's SECURITY DEFINER functions (migration dp_290), the
 * only write path to operations, usage counters and the ledger. Tagged templates only; no table
 * query. Reservations run in the caller's staff transaction (the database checks ai:invoke and
 * holds the AI switch); the other transitions need no staff context.
 * DP-291: the narrow readers of migration dp_291 (task plan, call plan, operation view).
 */
import type { Db } from "../iam/db.js";

export type ReserveOutcome =
  | "reserved"
  | "existing"
  | "not_allowed"
  | "ai_disabled"
  | "idempotency_conflict"
  | "task_disabled"
  | "model_not_enabled"
  | "provider_disabled"
  | "no_active_credential"
  | "price_missing"
  | "input_too_large"
  | "output_too_large"
  | "op_cost_limit"
  | "concurrency_limit"
  | "budget_missing"
  | "budget_exceeded"
  | "invalid";

export interface ReserveArgs {
  task: "DIAGNOSTIC_PING" | "TRANSLATION" | "SEO_META" | "CONTENT_DRAFT";
  siteId: string | null;
  idempotencyKey: string;
  inputDigest: string;
  estInputTokens: number;
  estOutputTokens: number;
  instanceId: string;
  capDailyMicros: bigint | null;
  capMonthlyMicros: bigint | null;
}

export interface ReserveResult {
  operationId: string | null;
  outcome: ReserveOutcome;
  reservedMicros: bigint | null;
}

export async function sqlReserve(db: Db, a: ReserveArgs): Promise<ReserveResult> {
  const rows = await db.$queryRaw<
    { operation_id: string | null; outcome: ReserveOutcome; reserved_micros: bigint | null }[]
  >`
    SELECT operation_id, outcome, reserved_micros FROM ai_reserve(
      ${a.task}::"AiTaskType", ${a.siteId}::uuid, ${a.idempotencyKey}, ${a.inputDigest},
      ${a.estInputTokens}::integer, ${a.estOutputTokens}::integer, ${a.instanceId},
      ${a.capDailyMicros}::bigint, ${a.capMonthlyMicros}::bigint)`;
  const r = rows[0];
  if (!r) return { operationId: null, outcome: "invalid", reservedMicros: null };
  return { operationId: r.operation_id, outcome: r.outcome, reservedMicros: r.reserved_micros };
}

export async function sqlStart(
  db: Db,
  operationId: string,
  instanceId: string,
  leaseSec: number,
): Promise<string> {
  const rows = await db.$queryRaw<{ r: string }[]>`
    SELECT ai_start(${operationId}::uuid, ${instanceId}, ${leaseSec}::integer) AS "r"`;
  return rows[0]?.r ?? "unknown";
}

export interface SettleArgs {
  status: "SUCCEEDED" | "FAILED" | "DISCARDED";
  inputTokens: number;
  cachedReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  providerRequestId: string | null;
  errorCode: string | null;
}

export async function sqlSettle(db: Db, operationId: string, a: SettleArgs): Promise<string> {
  const rows = await db.$queryRaw<{ r: string }[]>`
    SELECT ai_settle(${operationId}::uuid, ${a.status}::"AiOperationStatus", ${a.inputTokens}::integer,
      ${a.cachedReadTokens}::integer, ${a.cacheWriteTokens}::integer, ${a.outputTokens}::integer,
      ${a.reasoningTokens}::integer, ${a.providerRequestId}, ${a.errorCode}) AS "r"`;
  return rows[0]?.r ?? "unknown";
}

export async function sqlRelease(
  db: Db,
  operationId: string,
  reason: "cancel" | "release" | "expire",
): Promise<string> {
  const rows = await db.$queryRaw<
    { r: string }[]
  >`SELECT ai_release(${operationId}::uuid, ${reason}) AS "r"`;
  return rows[0]?.r ?? "unknown";
}

export async function sqlMarkUnknown(db: Db, operationId: string, code: string): Promise<string> {
  const rows = await db.$queryRaw<
    { r: string }[]
  >`SELECT ai_mark_unknown(${operationId}::uuid, ${code}) AS "r"`;
  return rows[0]?.r ?? "unknown";
}

export async function sqlSweep(
  db: Db,
): Promise<{ released: number; assumed: number; cancelled: number }> {
  const rows = await db.$queryRaw<{ released: number; assumed: number; cancelled: number }[]>`
    SELECT released, assumed, cancelled FROM ai_sweep()`;
  const r = rows[0];
  return {
    released: Number(r?.released ?? 0),
    assumed: Number(r?.assumed ?? 0),
    cancelled: Number(r?.cancelled ?? 0),
  };
}

export async function sqlLedgerMismatches(db: Db): Promise<number> {
  const rows = await db.$queryRaw<
    { n: bigint }[]
  >`SELECT count(*)::bigint AS "n" FROM ai_ledger_mismatches()`;
  return Number(rows[0]?.n ?? 0);
}

// --- DP-291: readers (migration dp_291) ---------------------------------------------------------

export type AiTask = ReserveArgs["task"];
export type AiProviderValue = "OPENAI" | "ANTHROPIC" | "GEMINI";

export interface TaskPlan {
  modelId: string;
  provider: AiProviderValue;
  providerModelId: string;
  billingProfile: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  thinkingBudget: number;
  temperatureMilli: number | null;
}

/** The task's model and limits, in the caller's staff transaction (AI on + ai:invoke). */
export async function sqlTaskPlan(db: Db, task: AiTask): Promise<TaskPlan | null> {
  const rows = await db.$queryRaw<
    {
      model_id: string;
      provider: AiProviderValue;
      provider_model_id: string;
      billing_profile: string;
      max_input_tokens: number;
      max_output_tokens: number;
      thinking_budget: number;
      temperature_milli: number | null;
    }[]
  >`SELECT * FROM ai_task_plan(${task}::"AiTaskType")`;
  const r = rows[0];
  if (!r) return null;
  return {
    modelId: r.model_id,
    provider: r.provider,
    providerModelId: r.provider_model_id,
    billingProfile: r.billing_profile,
    maxInputTokens: r.max_input_tokens,
    maxOutputTokens: r.max_output_tokens,
    thinkingBudget: r.thinking_budget,
    temperatureMilli: r.temperature_milli,
  };
}

export interface CallPlan {
  provider: AiProviderValue;
  providerModelId: string;
  credentialId: string;
  projectRef: string | null;
}

/** One started operation's provider model and ACTIVE key id (no staff context; AI on). */
export async function sqlCallPlan(db: Db, operationId: string): Promise<CallPlan | null> {
  const rows = await db.$queryRaw<
    {
      provider: AiProviderValue;
      provider_model_id: string;
      credential_id: string;
      project_ref: string | null;
    }[]
  >`SELECT * FROM ai_call_plan(${operationId}::uuid)`;
  const r = rows[0];
  if (!r) return null;
  return {
    provider: r.provider,
    providerModelId: r.provider_model_id,
    credentialId: r.credential_id,
    projectRef: r.project_ref,
  };
}

export interface OperationView {
  id: string;
  task: AiTask;
  siteId: string | null;
  provider: AiProviderValue;
  modelId: string;
  status: string;
  estInputTokens: number;
  estOutputTokens: number;
  reservedMicros: bigint;
  actualMicros: bigint | null;
  costBasis: "NONE" | "LOCAL_USAGE" | "ASSUMED";
  inputTokens: number | null;
  cachedReadTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  errorCode: string | null;
  reservedAt: Date;
  finishedAt: Date | null;
  /** The caller started it. */
  own: boolean;
}

/** One operation for its actor (ai:invoke) or an ai_usage:read holder, in the staff context. */
export async function sqlOperationView(db: Db, operationId: string): Promise<OperationView | null> {
  const rows = await db.$queryRaw<
    {
      id: string;
      task: AiTask;
      site_id: string | null;
      provider: AiProviderValue;
      model_id: string;
      status: string;
      est_input_tokens: number;
      est_output_tokens: number;
      reserved_micros: bigint;
      actual_micros: bigint | null;
      cost_basis: "NONE" | "LOCAL_USAGE" | "ASSUMED";
      input_tokens: number | null;
      cached_read_tokens: number | null;
      cache_write_tokens: number | null;
      output_tokens: number | null;
      reasoning_tokens: number | null;
      error_code: string | null;
      reserved_at: Date;
      finished_at: Date | null;
      own: boolean;
    }[]
  >`SELECT * FROM ai_operation_view(${operationId}::uuid)`;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    task: r.task,
    siteId: r.site_id,
    provider: r.provider,
    modelId: r.model_id,
    status: r.status,
    estInputTokens: r.est_input_tokens,
    estOutputTokens: r.est_output_tokens,
    reservedMicros: r.reserved_micros,
    actualMicros: r.actual_micros,
    costBasis: r.cost_basis,
    inputTokens: r.input_tokens,
    cachedReadTokens: r.cached_read_tokens,
    cacheWriteTokens: r.cache_write_tokens,
    outputTokens: r.output_tokens,
    reasoningTokens: r.reasoning_tokens,
    errorCode: r.error_code,
    reservedAt: r.reserved_at,
    finishedAt: r.finished_at,
    own: r.own,
  };
}

// --- DP-297: the durable queue and the held texts (migration dp_297) ----------------------------

/** The encrypted input of a just-reserved operation, in the reservation's staff transaction. */
export async function sqlEnqueue(db: Db, operationId: string, ciphertext: string): Promise<string> {
  const rows = await db.$queryRaw<{ r: string }[]>`
    SELECT ai_enqueue(${operationId}::uuid, ${ciphertext}) AS "r"`;
  return rows[0]?.r ?? "unknown";
}

export interface ClaimedJob {
  operationId: string;
  actorUserId: string | null;
  task: AiTask;
  siteId: string | null;
  /** The encrypted job payload, handed out once (wiped in the same transaction). */
  payload: string;
}

/** Claims up to `limit` queued jobs for this instance (atomic; no staff context). */
export async function sqlClaim(
  db: Db,
  instanceId: string,
  leaseSec: number,
  limit: number,
): Promise<ClaimedJob[]> {
  const rows = await db.$queryRaw<
    {
      op_id: string;
      op_actor: string | null;
      op_task: AiTask;
      op_site: string | null;
      op_payload: string;
    }[]
  >`SELECT op_id, op_actor, op_task, op_site, op_payload
      FROM ai_claim(${instanceId}, ${leaseSec}::integer, ${limit}::integer)`;
  return rows.map((r) => ({
    operationId: r.op_id,
    actorUserId: r.op_actor,
    task: r.op_task,
    siteId: r.op_site,
    payload: r.op_payload,
  }));
}

export type DispatchOutcome =
  | "dispatch"
  | "ai_disabled"
  | "cancelled"
  | "not_in_flight"
  | "lease_expired"
  | "already_dispatched"
  | "unknown";

/**
 * The permission to send the paid provider request (ai_dispatch). Only inside the transaction
 * that holds the AI switch (whileEnabled) and that the request is started in.
 */
export async function sqlDispatch(db: Db, operationId: string): Promise<DispatchOutcome> {
  const rows = await db.$queryRaw<{ r: DispatchOutcome }[]>`
    SELECT ai_dispatch(${operationId}::uuid) AS "r"`;
  return rows[0]?.r ?? "unknown";
}

export type StopSignal = "ai_disabled" | "cancelled" | "not_in_flight" | "lease_expired";

/** Which of these running calls must stop, and why (no staff context). */
export async function sqlStopSignals(
  db: Db,
  operationIds: string[],
): Promise<{ operationId: string; reason: StopSignal }[]> {
  if (operationIds.length === 0) return [];
  const rows = await db.$queryRaw<{ op_id: string; reason: StopSignal }[]>`
    SELECT op_id, reason FROM ai_stop_signals(${operationIds}::uuid[])`;
  return rows.map((r) => ({ operationId: r.op_id, reason: r.reason }));
}

/** The actor's cancel in the staff context: queued | running | none | not_found. */
export async function sqlRequestCancel(db: Db, operationId: string): Promise<string> {
  const rows = await db.$queryRaw<{ r: string }[]>`
    SELECT ai_request_cancel(${operationId}::uuid) AS "r"`;
  return rows[0]?.r ?? "not_found";
}

/** The encrypted draft of a SUCCEEDED operation, in its settlement's whileEnabled transaction. */
export async function sqlStoreResult(
  db: Db,
  operationId: string,
  ciphertext: string,
): Promise<string> {
  const rows = await db.$queryRaw<{ r: string }[]>`
    SELECT ai_store_result(${operationId}::uuid, ${ciphertext}) AS "r"`;
  return rows[0]?.r ?? "refused";
}

/** The encrypted draft for its own actor (staff context), or null. */
export async function sqlResultCiphertext(db: Db, operationId: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ c: string | null }[]>`
    SELECT ai_result_ciphertext(${operationId}::uuid) AS "c"`;
  return rows[0]?.c ?? null;
}

/** Claimable jobs on all instances (a count). */
export async function sqlQueueDepth(db: Db): Promise<number> {
  const rows = await db.$queryRaw<{ n: number }[]>`SELECT ai_queue_depth() AS "n"`;
  return Number(rows[0]?.n ?? 0);
}
