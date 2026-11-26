/**
 * DP-293 (ADR-030 D6, D7): the pure part of the AI usage reports — query parsing, UTC buckets,
 * sums in integer micro-USD (bigint, never a float) and the alert rules. No I/O: the reports
 * service reads the rows (row-level security) and hands them here.
 *
 * Amounts stay apart (see the contracts): estimated (reserved upper bound of every operation),
 * reserved (held by open operations now), actual (LOCAL_USAGE) and assumed (UNKNOWN, counted as
 * spent). Nothing is rounded here.
 */
import {
  AI_OUTCOMES,
  AI_OUTCOME_OF_STATUS,
  AI_PROVIDERS,
  AI_RECONCILIATION_TOLERANCE_MICROS,
  AI_RECONCILIATION_TOLERANCE_PCT,
  AI_TASK_TYPES,
  AI_USAGE_GRANULARITIES,
  AI_USAGE_MAX_DAYS,
  type AiOutcome,
  type AiProviderKey,
  type AiTaskTypeKey,
  type AiUsageGranularity,
  type AiUsageTotals,
} from "@dream/contracts";

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A refusal of a query parameter: its path and rule (VALIDATION_FAILED). */
export class ReportQueryError extends Error {
  constructor(
    readonly path: string,
    readonly rule: string,
  ) {
    super(`${path}: ${rule}`);
  }
}

/** "YYYY-MM-DD" → 00:00 UTC of that day; null when not a real calendar day. */
export function utcDay(value: string): Date | null {
  if (!DAY.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d;
}

/** Start of the UTC day / month of an instant. */
export function startOfUtc(granularity: AiUsageGranularity, at: Date): Date {
  return granularity === "day"
    ? new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
    : new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** The bucket key of an instant: "YYYY-MM-DD" (UTC day) or "YYYY-MM" (UTC month). */
export function bucketOf(granularity: AiUsageGranularity, at: Date): string {
  const iso = at.toISOString();
  return granularity === "day" ? iso.slice(0, 10) : iso.slice(0, 7);
}

/** Every bucket of [from, to] (both UTC days, inclusive), in order. */
export function bucketsOf(granularity: AiUsageGranularity, from: Date, to: Date): string[] {
  const out: string[] = [];
  if (granularity === "day") {
    for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS)
      out.push(bucketOf("day", new Date(t)));
    return out;
  }
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  const endKey = bucketOf("month", to);
  for (;;) {
    const key = bucketOf("month", new Date(Date.UTC(y, m, 1)));
    out.push(key);
    if (key === endKey) return out;
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
}

export interface UsageFilters {
  provider?: AiProviderKey;
  modelId?: string;
  task?: AiTaskTypeKey;
  /** A site id, or null = platform operations only. Absent = every scope. */
  siteId?: string | null;
  outcome?: AiOutcome;
}

export interface UsageQuery {
  from: Date;
  to: Date;
  /** Exclusive end: 00:00 UTC of the day after `to`. */
  end: Date;
  fromDay: string;
  toDay: string;
  granularity: AiUsageGranularity;
  filters: UsageFilters;
}

type Raw = Record<string, string | undefined>;

/** The optional filters shared by the usage report and the operations list. */
export function parseFilters(q: Raw): UsageFilters {
  const f: UsageFilters = {};
  if (q["provider"] !== undefined) {
    const p = q["provider"].toUpperCase();
    if (!(AI_PROVIDERS as readonly string[]).includes(p))
      throw new ReportQueryError("provider", "unknown");
    f.provider = p as AiProviderKey;
  }
  if (q["modelId"] !== undefined) {
    if (!UUID.test(q["modelId"])) throw new ReportQueryError("modelId", "uuid");
    f.modelId = q["modelId"].toLowerCase();
  }
  if (q["task"] !== undefined) {
    const t = q["task"].toUpperCase();
    if (!(AI_TASK_TYPES as readonly string[]).includes(t))
      throw new ReportQueryError("task", "unknown");
    f.task = t as AiTaskTypeKey;
  }
  if (q["siteId"] !== undefined) {
    if (q["siteId"] === "platform") f.siteId = null;
    else if (UUID.test(q["siteId"])) f.siteId = q["siteId"].toLowerCase();
    else throw new ReportQueryError("siteId", "uuid");
  }
  if (q["outcome"] !== undefined) {
    if (!(AI_OUTCOMES as readonly string[]).includes(q["outcome"]))
      throw new ReportQueryError("outcome", "unknown");
    f.outcome = q["outcome"] as AiOutcome;
  }
  return f;
}

/** An optional UTC day range (both or neither); `maxDays` days at most. */
export function parseRange(
  q: Raw,
  maxDays: number,
): { from: Date; to: Date; end: Date; fromDay: string; toDay: string } | null {
  if (q["from"] === undefined && q["to"] === undefined) return null;
  const from = utcDay(q["from"] ?? "");
  if (!from) throw new ReportQueryError("from", "date");
  const to = utcDay(q["to"] ?? "");
  if (!to) throw new ReportQueryError("to", "date");
  const days = (to.getTime() - from.getTime()) / DAY_MS;
  if (days < 0 || days >= maxDays) throw new ReportQueryError("to", "range");
  return {
    from,
    to,
    end: new Date(to.getTime() + DAY_MS),
    fromDay: q["from"]!,
    toDay: q["to"]!,
  };
}

export function parseUsageQuery(q: Raw): UsageQuery {
  const range = parseRange(q, AI_USAGE_MAX_DAYS);
  if (!range) throw new ReportQueryError("from", "date");
  const g = q["granularity"] ?? "day";
  if (!(AI_USAGE_GRANULARITIES as readonly string[]).includes(g))
    throw new ReportQueryError("granularity", "unknown");
  return { ...range, granularity: g as AiUsageGranularity, filters: parseFilters(q) };
}

/** The statuses of an outcome class (for a database filter). */
export function statusesOf(outcome: AiOutcome): string[] {
  return Object.entries(AI_OUTCOME_OF_STATUS)
    .filter(([, o]) => o === outcome)
    .map(([s]) => s);
}

/** Prisma `where` of the shared filters (operations list and usage report). */
export function operationWhere(
  f: UsageFilters,
  range: { from: Date; end: Date } | null,
): Record<string, unknown> {
  return {
    ...(range ? { reservedAt: { gte: range.from, lt: range.end } } : {}),
    ...(f.provider ? { provider: f.provider } : {}),
    ...(f.modelId ? { modelId: f.modelId } : {}),
    ...(f.task ? { task: f.task } : {}),
    ...(f.siteId !== undefined ? { siteId: f.siteId } : {}),
    ...(f.outcome ? { status: { in: statusesOf(f.outcome) } } : {}),
  };
}

// --- sums --------------------------------------------------------------------------------------

/** The columns of an operation a report needs. */
export interface UsageRow {
  status: keyof typeof AI_OUTCOME_OF_STATUS;
  provider: AiProviderKey;
  modelId: string;
  task: AiTaskTypeKey;
  siteId: string | null;
  reservedAt: Date;
  reservedMicros: bigint;
  actualMicros: bigint | null;
  costBasis: "NONE" | "LOCAL_USAGE" | "ASSUMED";
  actInputTokens: number | null;
  actCachedReadTokens: number | null;
  actCacheWriteTokens: number | null;
  actOutputTokens: number | null;
  actReasoningTokens: number | null;
}

/** Running sums (bigint money, plain counts). */
export class Sums {
  operations = 0;
  readonly outcomes: Record<AiOutcome, number> = {
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    unknown: 0,
    discarded: 0,
    open: 0,
  };
  estimated = 0n;
  reserved = 0n;
  actual = 0n;
  assumed = 0n;
  settledEstimate = 0n;
  overruns = 0;
  inputTokens = 0;
  cachedReadTokens = 0;
  cacheWriteTokens = 0;
  outputTokens = 0;
  reasoningTokens = 0;

  add(r: UsageRow): void {
    const outcome = AI_OUTCOME_OF_STATUS[r.status];
    this.operations += 1;
    this.outcomes[outcome] += 1;
    this.estimated += r.reservedMicros;
    if (outcome === "open") this.reserved += r.reservedMicros;
    if (r.costBasis === "LOCAL_USAGE") {
      const actual = r.actualMicros ?? 0n;
      this.actual += actual;
      this.settledEstimate += r.reservedMicros;
      if (actual > r.reservedMicros) this.overruns += 1;
    } else if (r.costBasis === "ASSUMED") {
      this.assumed += r.actualMicros ?? r.reservedMicros;
    }
    this.inputTokens += r.actInputTokens ?? 0;
    this.cachedReadTokens += r.actCachedReadTokens ?? 0;
    this.cacheWriteTokens += r.actCacheWriteTokens ?? 0;
    this.outputTokens += r.actOutputTokens ?? 0;
    this.reasoningTokens += r.actReasoningTokens ?? 0;
  }

  dto(): AiUsageTotals {
    return {
      operations: this.operations,
      outcomes: { ...this.outcomes },
      estimatedMicros: this.estimated.toString(),
      reservedMicros: this.reserved.toString(),
      actualMicros: this.actual.toString(),
      assumedMicros: this.assumed.toString(),
      settledEstimateMicros: this.settledEstimate.toString(),
      overruns: this.overruns,
      inputTokens: this.inputTokens,
      cachedReadTokens: this.cachedReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      outputTokens: this.outputTokens,
      reasoningTokens: this.reasoningTokens,
    };
  }
}

/** Sums of rows grouped by a key, in first-seen order unless sorted by the caller. */
export function groupSums<K>(rows: readonly UsageRow[], keyOf: (r: UsageRow) => K) {
  const m = new Map<string, { key: K; sums: Sums }>();
  for (const r of rows) {
    const key = keyOf(r);
    const k = JSON.stringify(key);
    let g = m.get(k);
    if (!g) {
      g = { key, sums: new Sums() };
      m.set(k, g);
    }
    g.sums.add(r);
  }
  return [...m.values()];
}

/** Spend first (actual + assumed, descending), then operations. */
export const bySpend = (a: { sums: Sums }, b: { sums: Sums }) => {
  const sa = a.sums.actual + a.sums.assumed;
  const sb = b.sums.actual + b.sums.assumed;
  if (sa !== sb) return sa > sb ? -1 : 1;
  return b.sums.operations - a.sums.operations;
};

/** One bucket per day/month of the query, zeros included. */
export function seriesOf(q: UsageQuery, rows: readonly UsageRow[]) {
  const buckets = new Map(bucketsOf(q.granularity, q.from, q.to).map((b) => [b, new Sums()]));
  for (const r of rows) buckets.get(bucketOf(q.granularity, r.reservedAt))?.add(r);
  return [...buckets.entries()].map(([bucket, sums]) => ({ bucket, totals: sums.dto() }));
}

// --- alerts ------------------------------------------------------------------------------------

/**
 * Used share of a budget in tenths of a percent, rounded down: (committed + assumed) / limit.
 * Reserved money is not spent and not in it (the warning flag of DP-290 includes it).
 */
export function permille(used: bigint, limit: bigint): number {
  if (limit <= 0n) return 0;
  return Number((used * 1000n) / limit);
}

export type BudgetState = "exceeded" | "warning" | "ok";

/**
 * A budget's state: exceeded when used ≥ the effective limit; warning when used + reserved reach
 * warnPct of it (the same rule as DP-290's `warning`).
 */
export function budgetState(
  used: bigint,
  reserved: bigint,
  limit: bigint,
  warnPct: number,
): BudgetState {
  if (used >= limit) return "exceeded";
  if ((used + reserved) * 100n >= limit * BigInt(warnPct)) return "warning";
  return "ok";
}

/** Whether a provider figure differs beyond the tolerance from local + assumed. */
export function reconciliationDiffers(local: bigint, assumed: bigint, provider: bigint): boolean {
  const ours = local + assumed;
  const diff = provider >= ours ? provider - ours : ours - provider;
  const pct = (ours * BigInt(AI_RECONCILIATION_TOLERANCE_PCT)) / 100n;
  const tolerance =
    pct > BigInt(AI_RECONCILIATION_TOLERANCE_MICROS)
      ? pct
      : BigInt(AI_RECONCILIATION_TOLERANCE_MICROS);
  return diff >= tolerance;
}
