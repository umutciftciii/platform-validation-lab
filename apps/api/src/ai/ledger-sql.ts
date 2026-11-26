/**
 * DP-290 (ADR-030 D6): calls of the engine's SECURITY DEFINER functions (migration dp_290), the
 * only write path to operations, usage counters and the ledger. Tagged templates only; no table
 * query. Reservations run in the caller's staff transaction (the database checks ai:invoke and
 * holds the AI switch); the other transitions need no staff context.
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
