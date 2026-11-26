/**
 * DP-292 (ADR-030): pure helpers of the AI Center screens — tabs, provider names, money in micro-USD,
 * capability labels and which actions a key or a model offers to whom. No I/O: the API decides
 * again on every call; these only choose what the admin shows.
 */
import {
  AI_OUTCOMES,
  AI_PROVIDERS,
  AI_TASK_TYPES,
  AI_USAGE_MAX_DAYS,
  type AiCredentialSummary,
  type AiModelSummary,
  type AiOutcome,
  type AiPermissions,
  type AiProviderKey,
  type AiTaskTypeKey,
  type AiUsageGranularity,
} from "@dream/contracts";
import { INTL_LOCALE, type AdminLocale } from "./i18n/config";

export const AI_TABS = [
  "overview",
  "budgets",
  "usage",
  "operations",
  "providers",
  "models",
  "prices",
  "tasks",
  "reconciliation",
  "audit",
] as const;
export type AiTab = (typeof AI_TABS)[number];

export function parseAiTab(value: string | string[] | undefined): AiTab {
  const v = Array.isArray(value) ? value[0] : value;
  return (AI_TABS as readonly string[]).includes(v ?? "") ? (v as AiTab) : "overview";
}

/**
 * DP-293: the tabs a user sees. Usage, operations, reconciliation and the budgets' figures need
 * ai_usage:read; the audit trail also audit:read. The API decides again on every read.
 */
export function visibleTabs(can: Pick<AiPermissions, "usageRead" | "auditRead">): AiTab[] {
  return AI_TABS.filter((tab) => {
    if (tab === "usage" || tab === "operations" || tab === "reconciliation") return can.usageRead;
    if (tab === "audit") return can.usageRead && can.auditRead;
    return true;
  });
}

/** Product names (never translated). */
export const PROVIDER_NAMES: Readonly<Record<AiProviderKey, string>> = {
  OPENAI: "OpenAI",
  ANTHROPIC: "Claude (Anthropic)",
  GEMINI: "Gemini (Google)",
};

/** "1234567" µ$ → "1.234567" (USD, up to six decimals, trailing zeros dropped, at least two). */
export function microsToUsd(micros: string | bigint): string {
  const v = typeof micros === "bigint" ? micros : BigInt(micros);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / 1_000_000n;
  let frac = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

/** "0.40" / "12" / "0.000001" → micro-USD string; null when not a non-negative amount with ≤ 6 decimals. */
export function usdToMicros(value: string): string | null {
  const m = /^\s*(\d{1,9})(?:[.,](\d{1,6}))?\s*$/.exec(value);
  if (!m) return null;
  const micros =
    BigInt(m[1] as string) * 1_000_000n + BigInt(((m[2] ?? "") + "000000").slice(0, 6));
  return micros.toString();
}

export type Capability = "yes" | "no" | "unknown";
export const capability = (v: boolean | null): Capability =>
  v === null ? "unknown" : v ? "yes" : "no";

export type CredentialAction = "test" | "activate" | "disable" | "revoke";

/** What a key offers to an AI administrator (nothing to anyone else; a revoked key is history). */
export function credentialActions(
  c: Pick<AiCredentialSummary, "status">,
  can: Pick<AiPermissions, "providerManage">,
): CredentialAction[] {
  if (!can.providerManage) return [];
  switch (c.status) {
    case "PENDING_TEST":
      return ["test", "revoke"];
    case "ACTIVE":
      return ["test", "disable", "revoke"];
    case "DISABLED":
      return ["test", "activate", "revoke"];
    default:
      return [];
  }
}

export type ModelAction = "verify" | "enable" | "disable";

/**
 * What a model offers to an AI administrator. Enabling needs a verified, compatible model; a model
 * whose capabilities the provider does not report needs the administrator's explicit confirmation
 * (the dialog asks; the API refuses without it).
 */
export function modelActions(
  m: Pick<AiModelSummary, "status" | "compatible" | "requiresConfirmation">,
  can: Pick<AiPermissions, "modelManage">,
): ModelAction[] {
  if (!can.modelManage) return [];
  switch (m.status) {
    case "ENABLED":
      return ["disable"];
    case "VERIFIED":
      return m.compatible || m.requiresConfirmation ? ["enable", "verify"] : ["verify"];
    case "DISABLED":
      return ["verify", ...(m.compatible ? (["enable"] as const) : [])];
    default:
      return ["verify"];
  }
}

/** The active key of a provider, if any. */
export const activeCredential = (credentials: readonly AiCredentialSummary[]) =>
  credentials.find((c) => c.status === "ACTIVE") ?? null;

/** Models a task or a provider may use: enabled and compatible. */
export const usableModels = <M extends Pick<AiModelSummary, "status" | "compatible">>(
  models: readonly M[],
) => models.filter((m) => m.status === "ENABLED" && m.compatible);

// =============================================================================================
// DP-293: budgets, usage and reports. Money arrives as exact micro-USD strings; it is rounded
// here, for display only, and never fed back to the API.
// =============================================================================================

/**
 * Rounds micro-USD to `decimals` (0–6) places, half away from zero, as a decimal string
 * ("1234567", 2 → "1.23"; "-5000", 2 → "-0.01"). Integer arithmetic only.
 */
export function roundMicros(micros: string | bigint, decimals: number): string {
  const v = typeof micros === "bigint" ? micros : BigInt(micros);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const unit = 10n ** BigInt(6 - decimals);
  const q = (abs + unit / 2n) / unit; // half up on the absolute value
  const scale = 10n ** BigInt(decimals);
  const whole = q / scale;
  const frac = decimals ? `.${(q % scale).toString().padStart(decimals, "0")}` : "";
  return `${neg && q !== 0n ? "-" : ""}${whole.toString()}${frac}`;
}

/**
 * Decimals shown for an amount: 2 from one cent up; all 6 below it (exact: a single call costs
 * fractions of a cent and must not read as "0.00" or be rounded up).
 */
export function displayDecimals(micros: string | bigint): number {
  const v = typeof micros === "bigint" ? micros : BigInt(micros);
  const abs = v < 0n ? -v : v;
  return abs === 0n || abs >= 10_000n ? 2 : 6;
}

/** "$1,234.57" / "$0.000021" in the UI language (rounded for display; the API keeps µ$). */
export function formatUsd(micros: string | bigint, locale: AdminLocale, decimals?: number): string {
  const d = decimals ?? displayDecimals(micros);
  const rounded = roundMicros(micros, d);
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(rounded as unknown as number);
}

/** Share of `part` in `whole` in tenths of a percent, rounded down (0 when `whole` is 0). */
export function permilleOf(part: string | bigint, whole: string | bigint): number {
  const p = BigInt(part);
  const w = BigInt(whole);
  if (w <= 0n || p <= 0n) return 0;
  return Number((p * 1000n) / w);
}

/** "12.3%" from tenths of a percent. */
export function formatPermille(permille: number, locale: AdminLocale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(permille / 1000);
}

/** The UTC bounds of a budget period starting at `periodStart` (ISO): [start, end). */
export function periodBounds(periodStart: string, period: "DAILY" | "MONTHLY") {
  const start = new Date(periodStart);
  const end =
    period === "DAILY"
      ? new Date(start.getTime() + 86_400_000)
      : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, end };
}

/**
 * The bar of a budget: committed, assumed and reserved as shares of the effective limit (each
 * 0…1, together at most 1), and whether used + reserved went past the limit (shown, not clipped
 * in the numbers).
 */
export function budgetBar(c: {
  committedMicros: string;
  assumedMicros: string;
  reservedMicros: string;
  limitMicros: string;
}) {
  const limit = BigInt(c.limitMicros);
  const parts = [c.committedMicros, c.assumedMicros, c.reservedMicros].map(BigInt);
  const total = parts.reduce((a, b) => a + b, 0n);
  const base = total > limit ? total : limit;
  const share = (v: bigint) => (base > 0n ? Number((v * 10_000n) / base) / 10_000 : 0);
  return {
    committed: share(parts[0]!),
    assumed: share(parts[1]!),
    reserved: share(parts[2]!),
    over: total > limit,
    usedPermille: permilleOf(parts[0]! + parts[1]!, limit),
    remainingMicros: (limit - parts[0]! - parts[1]! - parts[2]! > 0n
      ? limit - parts[0]! - parts[1]! - parts[2]!
      : 0n
    ).toString(),
  };
}

/** Bar heights (0…1) of a series of amounts, relative to its largest value. */
export function scaleSeries(values: readonly bigint[]): number[] {
  const max = values.reduce((a, b) => (b > a ? b : a), 0n);
  return values.map((v) => (max > 0n ? Number((v * 10_000n) / max) / 10_000 : 0));
}

/** The usage tab's query, from the URL (invalid values fall back to the default). */
export interface UsageParams {
  from: string;
  to: string;
  granularity: AiUsageGranularity;
  provider: AiProviderKey | null;
  modelId: string | null;
  task: AiTaskTypeKey | null;
  siteId: string | null;
  outcome: AiOutcome | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const isDay = (v: string) =>
  DAY.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const utcDayString = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Defaults: the last 30 UTC days by day, or the last 12 UTC months by month. A range the API would
 * refuse (reversed, longer than 366 days) falls back to the default.
 */
export function parseUsageParams(
  sp: Record<string, string | string[] | undefined>,
  now: Date,
): UsageParams {
  const granularity: AiUsageGranularity = first(sp["granularity"]) === "month" ? "month" : "day";
  const today = utcDayString(now);
  const defFrom =
    granularity === "day"
      ? utcDayString(new Date(now.getTime() - 29 * 86_400_000))
      : utcDayString(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)));
  let from = first(sp["from"]);
  let to = first(sp["to"]);
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (!isDay(from) || !isDay(to) || !(days >= 0 && days < AI_USAGE_MAX_DAYS)) {
    from = defFrom;
    to = today;
  }
  const provider = first(sp["provider"]).toUpperCase();
  const task = first(sp["task"]).toUpperCase();
  const site = first(sp["siteId"]);
  const outcome = first(sp["outcome"]);
  const modelId = first(sp["modelId"]);
  return {
    from,
    to,
    granularity,
    provider: (AI_PROVIDERS as readonly string[]).includes(provider)
      ? (provider as AiProviderKey)
      : null,
    modelId: UUID.test(modelId) ? modelId.toLowerCase() : null,
    task: (AI_TASK_TYPES as readonly string[]).includes(task) ? (task as AiTaskTypeKey) : null,
    siteId: site === "platform" || UUID.test(site) ? site.toLowerCase() : null,
    outcome: (AI_OUTCOMES as readonly string[]).includes(outcome) ? (outcome as AiOutcome) : null,
  };
}

/** The API query string of the usage params (filters only when set). */
export function usageQuery(p: UsageParams, extra: Record<string, string | null> = {}): string {
  const q = new URLSearchParams();
  const set = (k: string, v: string | null) => {
    if (v) q.set(k, v);
  };
  set("from", p.from);
  set("to", p.to);
  set("granularity", p.granularity);
  set("provider", p.provider);
  set("modelId", p.modelId);
  set("task", p.task);
  set("siteId", p.siteId);
  set("outcome", p.outcome);
  for (const [k, v] of Object.entries(extra)) set(k, v);
  return q.toString();
}

/** The status pill tone of an outcome class. */
export const OUTCOME_TONE: Readonly<
  Record<AiOutcome, "success" | "danger" | "neutral" | "amber" | "petrol">
> = {
  succeeded: "success",
  failed: "danger",
  cancelled: "neutral",
  unknown: "amber",
  discarded: "neutral",
  open: "petrol",
};
