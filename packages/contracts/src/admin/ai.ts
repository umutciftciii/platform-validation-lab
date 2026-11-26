/**
 * DP-287 (ADR-030): the AI Center API, `/api/v1/admin/ai/*`.
 *
 * AI is OFF by default. Only the system owner switches it, platform-wide, in the Owner Console
 * (`POST /api/v1/admin/owner/modules/ai/platform`, owner.ts). While it is off every route here
 * answers 404 (the area looks missing) and the admin shows no AI menu, page or button
 * (`StaffSessionResponse.features.aiCenter`).
 *
 * DP-287 built the switch, DP-288 the data model (keys, models, prices, tasks, budgets, usage);
 * no provider call, key screen or budget engine exists yet (DP-289…DP-293), so no AI call is
 * possible even while AI is on; `blockers` says what is still missing.
 */
import { z } from "zod";

export const AI_API = "/api/v1/admin/ai";

/** DP-288 (owner decision 8): the providers, each with its own platform API key. */
export const AI_PROVIDERS = ["OPENAI", "ANTHROPIC", "GEMINI"] as const;
export type AiProviderKey = (typeof AI_PROVIDERS)[number];

/** DP-288: the task types with their own model and limits (AiTaskSetting). */
export const AI_TASK_TYPES = [
  "DIAGNOSTIC_PING",
  "TRANSLATION",
  "SEO_META",
  "CONTENT_DRAFT",
] as const;
export type AiTaskTypeKey = (typeof AI_TASK_TYPES)[number];

/**
 * Why no provider call is possible: the environment transport is off; no enabled provider has an
 * ACTIVE key; no ENABLED model has a price in force; the daily or monthly platform budget is
 * missing. DP-288 reads them from the data; the call path itself arrives with DP-291.
 */
export const AI_BLOCKERS = [
  "transport_off",
  "no_provider_key",
  "no_enabled_model",
  "no_budget",
  // DP-292: no task is enabled (a task names its model and limits).
  "no_enabled_task",
] as const;
export type AiBlocker = (typeof AI_BLOCKERS)[number];

/**
 * DP-292: what the signed-in user may do in the AI Center (presentation only: the API decides
 * again on every route). Super admins and AI viewers read; AI administrators and the system owner
 * manage; switching AI on or off is not here (Owner Console only).
 */
export const AiPermissionsSchema = z.strictObject({
  usageRead: z.boolean(),
  providerManage: z.boolean(),
  modelManage: z.boolean(),
  budgetManage: z.boolean(),
  invoke: z.boolean(),
  /** DP-293: the AI audit trail needs audit:read (platform) besides ai_usage:read. */
  auditRead: z.boolean(),
});
export type AiPermissions = z.infer<typeof AiPermissionsSchema>;

/** GET /api/v1/admin/ai/overview (ai:read). 404 while AI is off. */
export const AiOverviewResponseSchema = z.strictObject({
  enabled: z.literal(true),
  /** DP-291: whether a provider call could start now (no blocker left). */
  callsPossible: z.boolean(),
  blockers: z.array(z.enum(AI_BLOCKERS)),
  /** DP-292: the server environment's transport (off / fake / live). */
  transport: z.enum(["off", "fake", "live"]),
  permissions: AiPermissionsSchema,
  /** DP-293: the sites the caller knows (site budgets and per-site usage show their names). */
  sites: z.array(
    z.strictObject({ id: z.uuid(), key: z.enum(["BV", "CORPORATE"]), name: z.string() }),
  ),
});
export type AiOverviewResponse = z.infer<typeof AiOverviewResponseSchema>;

// =============================================================================================
// DP-289 (ADR-030 D4, D5): providers, their separate API keys and their models. A key is sent to
// the API once (POST body) and never comes back: responses carry its hint only. While AI is off
// every route is a 404 (AiGateGuard). Provider calls are list/retrieve only (no generation, no
// cost); with DP_AI_TRANSPORT=off they are refused (CONFLICT_STATE, rule `transport_off`).
// =============================================================================================

const IsoDateTime = z.iso.datetime({ offset: true });
const Uuid = z.uuid();

export const AiProviderKeySchema = z.enum(AI_PROVIDERS);
export const AI_CREDENTIAL_STATUSES = ["PENDING_TEST", "ACTIVE", "DISABLED", "REVOKED"] as const;
export const AI_MODEL_STATUSES = [
  "DISCOVERED",
  "VERIFIED",
  "ENABLED",
  "DISABLED",
  "UNAVAILABLE",
] as const;

/** Outcome codes of a provider call (never the provider's own message). */
export const AI_PROVIDER_RESULT_CODES = [
  "ok",
  "credential_invalid",
  "permission_denied",
  "model_not_found",
  "rate_limited",
  "quota_exceeded",
  "provider_unavailable",
  "timeout",
  "network_error",
  "bad_response",
] as const;
export type AiProviderResultCode = (typeof AI_PROVIDER_RESULT_CODES)[number];

export const AiCredentialSummarySchema = z.strictObject({
  id: Uuid,
  provider: AiProviderKeySchema,
  label: z.string(),
  status: z.enum(AI_CREDENTIAL_STATUSES),
  /** Provider prefix and the last four characters, e.g. `sk-…ab12`. Never the key. */
  keyHint: z.string(),
  projectRef: z.string().nullable(),
  lastTestedAt: IsoDateTime.nullable(),
  lastTestCode: z.string().nullable(),
  createdAt: IsoDateTime,
  activatedAt: IsoDateTime.nullable(),
  disabledAt: IsoDateTime.nullable(),
  revokedAt: IsoDateTime.nullable(),
  version: z.number().int().positive(),
});
export type AiCredentialSummary = z.infer<typeof AiCredentialSummarySchema>;

export const AiProviderSummarySchema = z.strictObject({
  provider: AiProviderKeySchema,
  enabled: z.boolean(),
  defaultModelId: Uuid.nullable(),
  version: z.number().int().positive(),
  credentials: z.array(AiCredentialSummarySchema),
});
export type AiProviderSummary = z.infer<typeof AiProviderSummarySchema>;

/** GET /api/v1/admin/ai/providers (ai:read). */
export const AiProvidersResponseSchema = z.strictObject({
  transport: z.enum(["off", "fake", "live"]),
  providers: z.array(AiProviderSummarySchema).length(AI_PROVIDERS.length),
});
export type AiProvidersResponse = z.infer<typeof AiProvidersResponseSchema>;

/**
 * POST /api/v1/admin/ai/providers/:provider/credentials (ai_provider:manage, step-up). The key is
 * tested at once; with `activate` (default) a working key becomes the provider's ACTIVE key and
 * the previous one is DISABLED (replacement).
 */
export const AiCredentialAddRequestSchema = z.strictObject({
  apiKey: z.string().min(20).max(512),
  label: z.string().trim().min(1).max(100),
  projectRef: z.string().trim().min(1).max(200).optional(),
  activate: z.boolean().optional(),
});
export type AiCredentialAddRequest = z.infer<typeof AiCredentialAddRequestSchema>;

export const AiCredentialResultSchema = z.strictObject({
  credential: AiCredentialSummarySchema,
  test: z.strictObject({
    code: z.enum(AI_PROVIDER_RESULT_CODES),
    models: z.number().int().nonnegative(),
  }),
});
export type AiCredentialResult = z.infer<typeof AiCredentialResultSchema>;

export const AiModelCapabilitiesSchema = z.strictObject({
  /**
   * Null = unknown: the provider does not say (OpenAI's model list carries no capabilities). An
   * unknown model is never enabled automatically; an AI administrator confirms it explicitly.
   */
  textGeneration: z.boolean().nullable(),
  structuredOutput: z.boolean().nullable(),
  thinking: z.boolean().nullable(),
  lifecycle: z.enum(["active", "deprecated", "retired"]).nullable(),
});
export type AiModelCapabilities = z.infer<typeof AiModelCapabilitiesSchema>;

export const AiModelSummarySchema = z.strictObject({
  id: Uuid,
  provider: AiProviderKeySchema,
  modelId: z.string(),
  displayName: z.string(),
  status: z.enum(AI_MODEL_STATUSES),
  compatible: z.boolean(),
  /**
   * The provider does not report the model's capabilities: enabling needs the administrator's
   * explicit confirmation (`confirmUnknownCapabilities`) after a successful verification.
   */
  requiresConfirmation: z.boolean(),
  capabilities: AiModelCapabilitiesSchema,
  contextWindow: z.number().int().nullable(),
  maxOutputTokens: z.number().int().nullable(),
  lastVerifiedAt: IsoDateTime.nullable(),
  verifyCode: z.string().nullable(),
  version: z.number().int().positive(),
});
export type AiModelSummary = z.infer<typeof AiModelSummarySchema>;

/** GET /api/v1/admin/ai/models?provider=… (ai:read). */
export const AiModelsResponseSchema = z.strictObject({ items: z.array(AiModelSummarySchema) });
export type AiModelsResponse = z.infer<typeof AiModelsResponseSchema>;

/** POST /api/v1/admin/ai/providers/:provider/models/refresh (ai_model:manage, step-up). */
export const AiModelRefreshResponseSchema = z.strictObject({
  code: z.enum(AI_PROVIDER_RESULT_CODES),
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unavailable: z.number().int().nonnegative(),
});
export type AiModelRefreshResponse = z.infer<typeof AiModelRefreshResponseSchema>;

/**
 * POST /api/v1/admin/ai/models/:id/enable (ai_model:manage, step-up). A model whose capabilities
 * the provider does not report (`requiresConfirmation`) is enabled only with
 * `confirmUnknownCapabilities: true` after a successful verification; without it the API answers
 * CONFLICT_STATE, rule `capabilities_unknown`.
 */
export const AiModelEnableRequestSchema = z.strictObject({
  confirmUnknownCapabilities: z.boolean().optional(),
});
export type AiModelEnableRequest = z.infer<typeof AiModelEnableRequestSchema>;

/** POST /api/v1/admin/ai/providers/:provider/settings (ai_provider:manage, step-up). */
export const AiProviderSettingRequestSchema = z.strictObject({
  enabled: z.boolean(),
  defaultModelId: Uuid.nullable(),
  version: z.number().int().positive(),
});
export type AiProviderSettingRequest = z.infer<typeof AiProviderSettingRequestSchema>;

// =============================================================================================
// DP-290 (ADR-030 D6, D7): settings, prices, task limits, budgets, usage, operations and
// reconciliation. Money is micro-USD (1 USD = 1 000 000) as a decimal string; prices are micro-USD
// per 1 000 000 tokens. Budget periods are UTC (the admin shows local time too). Amounts are the
// local calculation (tokens × dated price), never an invoice: `providerMicros` comes from the
// provider's own figures (reconciliation) and the difference is reported separately.
// =============================================================================================

const Micros = z.string().regex(/^\d{1,15}$/);
const PositiveMicros = Micros.refine((v) => BigInt(v) > 0n, "positive");

/** GET/POST /api/v1/admin/ai/settings (ai:read / ai_budget:manage, step-up). */
export const AiSettingsSchema = z.strictObject({
  maxConcurrency: z.number().int().min(1).max(20),
  reservationTtlSec: z.number().int().min(30).max(3600),
  safetyMarginPct: z.number().int().min(0).max(100),
  version: z.number().int().positive(),
});
export type AiSettingsDto = z.infer<typeof AiSettingsSchema>;

export const AiPriceSchema = z.strictObject({
  id: Uuid,
  modelId: Uuid,
  inputMicrosPerMTok: Micros,
  cachedReadMicrosPerMTok: Micros,
  cacheWriteMicrosPerMTok: Micros.nullable(),
  outputMicrosPerMTok: Micros,
  longContextThreshold: z.number().int().positive().nullable(),
  longInputMicrosPerMTok: Micros.nullable(),
  longOutputMicrosPerMTok: Micros.nullable(),
  perRequestFeeMicros: Micros,
  effectiveFrom: IsoDateTime,
  source: z.string(),
  sourceNote: z.string(),
  createdAt: IsoDateTime,
});
export type AiPrice = z.infer<typeof AiPriceSchema>;

/** POST /api/v1/admin/ai/models/:id/prices (ai_model:manage, step-up). Never backdated. */
export const AiPriceCreateRequestSchema = z.strictObject({
  inputMicrosPerMTok: Micros,
  cachedReadMicrosPerMTok: Micros,
  cacheWriteMicrosPerMTok: Micros.nullable().optional(),
  outputMicrosPerMTok: Micros,
  longContextThreshold: z.number().int().positive().nullable().optional(),
  longInputMicrosPerMTok: Micros.nullable().optional(),
  longOutputMicrosPerMTok: Micros.nullable().optional(),
  perRequestFeeMicros: Micros.optional(),
  /** Default: now. Never in the past. */
  effectiveFrom: IsoDateTime.optional(),
  sourceNote: z.string().trim().min(3).max(500),
});
export type AiPriceCreateRequest = z.infer<typeof AiPriceCreateRequestSchema>;

export const AiPricesResponseSchema = z.strictObject({ items: z.array(AiPriceSchema) });
export type AiPricesResponse = z.infer<typeof AiPricesResponseSchema>;

export const AiTaskSettingSchema = z.strictObject({
  task: z.enum(AI_TASK_TYPES),
  enabled: z.boolean(),
  modelId: Uuid.nullable(),
  maxInputTokens: z.number().int().positive().max(2_000_000),
  maxOutputTokens: z.number().int().positive().max(200_000),
  thinkingBudget: z.number().int().min(0).max(200_000),
  maxCostPerOpMicros: PositiveMicros,
  temperatureMilli: z.number().int().min(0).max(2000).nullable(),
  version: z.number().int().positive(),
});
export type AiTaskSettingDto = z.infer<typeof AiTaskSettingSchema>;
export const AiTasksResponseSchema = z.strictObject({ items: z.array(AiTaskSettingSchema) });
export type AiTasksResponse = z.infer<typeof AiTasksResponseSchema>;
/** POST /api/v1/admin/ai/tasks/:task (ai_model:manage, step-up). */
export const AiTaskSettingRequestSchema = AiTaskSettingSchema.omit({ task: true });
export type AiTaskSettingRequest = z.infer<typeof AiTaskSettingRequestSchema>;

export const AI_BUDGET_SCOPES = ["PLATFORM", "SITE"] as const;
export const AI_BUDGET_PERIODS = ["DAILY", "MONTHLY"] as const;

export const AiBudgetSchema = z.strictObject({
  id: Uuid,
  scope: z.enum(AI_BUDGET_SCOPES),
  siteId: Uuid.nullable(),
  period: z.enum(AI_BUDGET_PERIODS),
  limitMicros: Micros,
  /** The limit in force: in a capped local deployment never above the local ceiling. */
  effectiveLimitMicros: Micros,
  warnPct: z.number().int().min(1).max(100),
  active: z.boolean(),
  version: z.number().int().positive(),
  /** The current UTC period's counters (zero when nothing happened yet). */
  current: z.strictObject({
    periodStart: IsoDateTime,
    reservedMicros: Micros,
    committedMicros: Micros,
    assumedMicros: Micros,
    /** reserved + committed + assumed ≥ warnPct of the effective limit. */
    warning: z.boolean(),
  }),
});
export type AiBudget = z.infer<typeof AiBudgetSchema>;
/** GET /api/v1/admin/ai/budgets (ai:read). */
export const AiBudgetsResponseSchema = z.strictObject({
  items: z.array(AiBudgetSchema),
  /** The local ceiling of DP_AI_TRANSPORT=live in the local deployment, if any. */
  localCap: z.strictObject({ dailyMicros: Micros, monthlyMicros: Micros }).nullable(),
});
export type AiBudgetsResponse = z.infer<typeof AiBudgetsResponseSchema>;
/** POST /api/v1/admin/ai/budgets (ai_budget:manage, step-up). One active per scope/site/period. */
export const AiBudgetCreateRequestSchema = z.strictObject({
  scope: z.enum(AI_BUDGET_SCOPES),
  siteId: Uuid.nullable().optional(),
  period: z.enum(AI_BUDGET_PERIODS),
  limitMicros: PositiveMicros,
  warnPct: z.number().int().min(1).max(100).optional(),
});
export type AiBudgetCreateRequest = z.infer<typeof AiBudgetCreateRequestSchema>;
/** POST /api/v1/admin/ai/budgets/:id (ai_budget:manage, step-up). */
export const AiBudgetUpdateRequestSchema = z.strictObject({
  limitMicros: PositiveMicros,
  warnPct: z.number().int().min(1).max(100),
  active: z.boolean(),
  version: z.number().int().positive(),
});
export type AiBudgetUpdateRequest = z.infer<typeof AiBudgetUpdateRequestSchema>;

export const AI_OPERATION_STATUSES = [
  "RESERVED",
  "IN_FLIGHT",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "RELEASED",
  "EXPIRED",
  "UNKNOWN",
  "DISCARDED",
] as const;

/** One operation: ids, counts, amounts and codes only — never a prompt or response text. */
export const AiOperationSchema = z.strictObject({
  id: Uuid,
  task: z.enum(AI_TASK_TYPES),
  siteId: Uuid.nullable(),
  provider: AiProviderKeySchema,
  modelId: Uuid,
  status: z.enum(AI_OPERATION_STATUSES),
  estInputTokens: z.number().int(),
  estOutputTokens: z.number().int(),
  reservedMicros: Micros,
  actualMicros: Micros.nullable(),
  costBasis: z.enum(["NONE", "LOCAL_USAGE", "ASSUMED"]),
  inputTokens: z.number().int().nullable(),
  cachedReadTokens: z.number().int().nullable(),
  cacheWriteTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  reasoningTokens: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  reservedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
});
export type AiOperation = z.infer<typeof AiOperationSchema>;
/** GET /api/v1/admin/ai/operations?before=<iso>&limit=<1..100> (ai_usage:read). */
export const AiOperationsResponseSchema = z.strictObject({
  items: z.array(AiOperationSchema).max(100),
  nextBefore: IsoDateTime.nullable(),
});
export type AiOperationsResponse = z.infer<typeof AiOperationsResponseSchema>;

// --- DP-291: the shared operation service ---------------------------------------------------------

/**
 * POST /api/v1/admin/ai/operations (ai:invoke): starts one task on its configured model, within
 * the budgets. Answers 202; the result is fetched with GET /operations/:id. `idempotencyKey` is
 * the caller's: the same key with the same input returns the same operation.
 */
export const AiOperationCreateRequestSchema = z.strictObject({
  task: z.enum(AI_TASK_TYPES),
  siteId: Uuid.nullable().optional(),
  input: z.string().min(1).max(20_000),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,100}$/),
});
export type AiOperationCreateRequest = z.infer<typeof AiOperationCreateRequestSchema>;
export const AiOperationCreatedSchema = z.strictObject({
  operationId: Uuid,
  status: z.enum(AI_OPERATION_STATUSES),
  /** True when the idempotency key named an operation that already existed. */
  existing: z.boolean(),
});
export type AiOperationCreated = z.infer<typeof AiOperationCreatedSchema>;
/**
 * GET /api/v1/admin/ai/operations/:id (its actor with ai:invoke, or ai_usage:read). `result` is
 * the answer of a SUCCEEDED operation, for its actor only, while the API holds it (minutes, in
 * memory; never stored). It is always a DRAFT: nothing is applied or published by the AI service.
 */
export const AiOperationDetailSchema = z.strictObject({
  operation: AiOperationSchema,
  own: z.boolean(),
  /** queued / running in this API process, or none. */
  runner: z.enum(["queued", "running", "none"]),
  result: z.strictObject({ draft: z.literal(true), text: z.string().max(20_000) }).nullable(),
});
export type AiOperationDetail = z.infer<typeof AiOperationDetailSchema>;
/** POST /api/v1/admin/ai/operations/:id/cancel (its actor, ai:invoke). */
export const AiOperationCancelResponseSchema = z.strictObject({
  operationId: Uuid,
  /** What was stopped: a queued job (released), a running call (aborted) or nothing. */
  stopped: z.enum(["queued", "running", "none"]),
});
export type AiOperationCancelResponse = z.infer<typeof AiOperationCancelResponseSchema>;

/** GET /api/v1/admin/ai/reconciliation?from=YYYY-MM-DD&to=YYYY-MM-DD (ai_usage:read). */
export const AiReconciliationRowSchema = z.strictObject({
  provider: AiProviderKeySchema,
  day: z.iso.date(),
  /** Local calculation of finished operations that UTC day (tokens × dated price). */
  localMicros: Micros,
  /** Outcome unknown (counted as spent at the reserved amount). */
  assumedMicros: Micros,
  /** The provider's own figure (latest entry), if entered. */
  providerMicros: Micros.nullable(),
  /** provider − (local + assumed); null without a provider figure. Signed. */
  differenceMicros: z
    .string()
    .regex(/^-?\d{1,16}$/)
    .nullable(),
});
export type AiReconciliationRow = z.infer<typeof AiReconciliationRowSchema>;
export const AiReconciliationResponseSchema = z.strictObject({
  items: z.array(AiReconciliationRowSchema),
});
export type AiReconciliationResponse = z.infer<typeof AiReconciliationResponseSchema>;
/** POST /api/v1/admin/ai/reconciliation (ai_budget:manage, step-up): the provider's daily figure. */
export const AiReconciliationCreateRequestSchema = z.strictObject({
  provider: AiProviderKeySchema,
  day: z.iso.date(),
  providerAmountMicros: Micros,
  projectRef: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
});
export type AiReconciliationCreateRequest = z.infer<typeof AiReconciliationCreateRequestSchema>;

// =============================================================================================
// DP-293 (ADR-030 D6, D7): budget, usage and reporting of the AI Center. Read-only reports over
// what DP-290/DP-291 recorded; every amount is integer micro-USD as a string (the admin rounds for
// display only). Four amounts stay apart everywhere:
//   - estimated  — the upper bound reserved before the call (`reservedMicros`; never a cost);
//   - reserved   — money held by RESERVED / IN_FLIGHT operations right now (not spent);
//   - actual     — the local calculation of finished calls (reported tokens × dated price,
//                  cost basis LOCAL_USAGE); not an invoice;
//   - assumed    — operations whose outcome is unknown (UNKNOWN), counted as spent at their
//                  reserved amount until reconciled (conservative);
//   - the provider's own figure (reconciliation) is a fifth, separate amount.
// Periods and buckets are UTC (a day = 00:00–24:00 UTC, a month from the 1st 00:00 UTC). All
// routes are 404 while AI is off; budget limits are enforced by the database only (DP-290).
// =============================================================================================

/** How an operation ended, for reports: one class per status. */
export const AI_OUTCOMES = [
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
  "discarded",
  "open",
] as const;
export type AiOutcome = (typeof AI_OUTCOMES)[number];

/** The outcome class of an operation status. */
export const AI_OUTCOME_OF_STATUS: Readonly<
  Record<(typeof AI_OPERATION_STATUSES)[number], AiOutcome>
> = {
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
  RELEASED: "cancelled",
  EXPIRED: "cancelled",
  UNKNOWN: "unknown",
  DISCARDED: "discarded",
  RESERVED: "open",
  IN_FLIGHT: "open",
};

const Count = z.number().int().min(0);

/** The sums of a set of operations. */
export const AiUsageTotalsSchema = z.strictObject({
  operations: Count,
  outcomes: z.strictObject({
    succeeded: Count,
    failed: Count,
    cancelled: Count,
    unknown: Count,
    discarded: Count,
    open: Count,
  }),
  /** Sum of the upper-bound estimates reserved for these operations (not a cost). */
  estimatedMicros: Micros,
  /** Held now by open operations (RESERVED / IN_FLIGHT): not spent. */
  reservedMicros: Micros,
  /** Local calculation of finished calls (LOCAL_USAGE). */
  actualMicros: Micros,
  /** Unknown outcome, counted as spent (ASSUMED). */
  assumedMicros: Micros,
  /** Estimate of the operations that finished with a local calculation (for the deviation). */
  settledEstimateMicros: Micros,
  /** Operations whose local calculation exceeded their estimate. */
  overruns: Count,
  inputTokens: Count,
  cachedReadTokens: Count,
  cacheWriteTokens: Count,
  outputTokens: Count,
  reasoningTokens: Count,
});
export type AiUsageTotals = z.infer<typeof AiUsageTotalsSchema>;

export const AI_USAGE_GRANULARITIES = ["day", "month"] as const;
export type AiUsageGranularity = (typeof AI_USAGE_GRANULARITIES)[number];
/** At most this many UTC days per usage report. */
export const AI_USAGE_MAX_DAYS = 366;

/**
 * GET /api/v1/admin/ai/usage?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=day|month
 *   [&provider=][&modelId=][&task=][&siteId=|platform][&outcome=] (ai_usage:read).
 * Operations by their reservation time (the UTC day/month whose budget they count against).
 */
export const AiUsageReportSchema = z.strictObject({
  from: z.iso.date(),
  to: z.iso.date(),
  granularity: z.enum(AI_USAGE_GRANULARITIES),
  totals: AiUsageTotalsSchema,
  /** One bucket per UTC day ("YYYY-MM-DD") or month ("YYYY-MM") of the range, zeros included. */
  series: z.array(z.strictObject({ bucket: z.string(), totals: AiUsageTotalsSchema })),
  byProvider: z.array(
    z.strictObject({ provider: AiProviderKeySchema, totals: AiUsageTotalsSchema }),
  ),
  byModel: z.array(
    z.strictObject({
      provider: AiProviderKeySchema,
      modelId: Uuid,
      /** The provider's model id and display name (no secret). */
      modelKey: z.string(),
      displayName: z.string(),
      totals: AiUsageTotalsSchema,
    }),
  ),
  byTask: z.array(z.strictObject({ task: z.enum(AI_TASK_TYPES), totals: AiUsageTotalsSchema })),
  /** siteId null = platform operations. */
  bySite: z.array(z.strictObject({ siteId: Uuid.nullable(), totals: AiUsageTotalsSchema })),
});
export type AiUsageReport = z.infer<typeof AiUsageReportSchema>;

/**
 * DP-293: optional filters of GET /api/v1/admin/ai/operations (besides `before` / `limit`):
 * `from` / `to` (YYYY-MM-DD, UTC, by reservation), `provider`, `modelId`, `task`, `siteId`
 * (a uuid or `platform`), `outcome` (AI_OUTCOMES).
 */
export const AI_OPERATION_FILTERS = [
  "from",
  "to",
  "provider",
  "modelId",
  "task",
  "siteId",
  "outcome",
] as const;

/** GET /api/v1/admin/ai/prices (ai:read): every dated price with its model and state. */
export const AI_PRICE_STATES = ["in_force", "scheduled", "superseded"] as const;
export const AiPriceListItemSchema = z.strictObject({
  price: AiPriceSchema,
  provider: AiProviderKeySchema,
  modelKey: z.string(),
  displayName: z.string(),
  modelStatus: z.enum(AI_MODEL_STATUSES),
  state: z.enum(AI_PRICE_STATES),
});
export type AiPriceListItem = z.infer<typeof AiPriceListItemSchema>;
export const AiPriceListResponseSchema = z.strictObject({
  items: z.array(AiPriceListItemSchema),
  /** Enabled models (or models of an enabled task) without a price in force. */
  missing: z.array(
    z.strictObject({
      modelId: Uuid,
      provider: AiProviderKeySchema,
      modelKey: z.string(),
      displayName: z.string(),
      tasks: z.array(z.enum(AI_TASK_TYPES)),
    }),
  ),
});
export type AiPriceListResponse = z.infer<typeof AiPriceListResponseSchema>;

/**
 * GET /api/v1/admin/ai/alerts (ai_usage:read): what needs attention now, computed on request
 * for the current UTC day and month. Ids, codes, counts and amounts only.
 */
export const AI_ALERT_CODES = [
  "budget_exceeded",
  "budget_warning",
  "budget_missing",
  "price_missing",
  "unknown_operations",
  "cost_overrun",
  "reconciliation_difference",
  "ledger_mismatch",
] as const;
export type AiAlertCode = (typeof AI_ALERT_CODES)[number];
export const AiAlertSchema = z.strictObject({
  code: z.enum(AI_ALERT_CODES),
  severity: z.enum(["critical", "warning", "info"]),
  budgetId: Uuid.nullable(),
  siteId: Uuid.nullable(),
  period: z.enum(AI_BUDGET_PERIODS).nullable(),
  provider: AiProviderKeySchema.nullable(),
  modelId: Uuid.nullable(),
  /** UTC day of a reconciliation difference. */
  day: z.iso.date().nullable(),
  count: Count.nullable(),
  /** Used (committed + assumed) for budgets; the amount concerned otherwise. Signed. */
  amountMicros: z
    .string()
    .regex(/^-?\d{1,16}$/)
    .nullable(),
  limitMicros: Micros.nullable(),
  /** Used share of the limit in tenths of a percent (budgets; reserved not included). */
  permille: z.number().int().min(0).nullable(),
});
export type AiAlert = z.infer<typeof AiAlertSchema>;
export const AiAlertsResponseSchema = z.strictObject({
  generatedAt: IsoDateTime,
  dayStart: IsoDateTime,
  monthStart: IsoDateTime,
  items: z.array(AiAlertSchema),
});
export type AiAlertsResponse = z.infer<typeof AiAlertsResponseSchema>;
/** A reconciliation difference is reported when |diff| ≥ max(this, 5 % of local + assumed). */
export const AI_RECONCILIATION_TOLERANCE_MICROS = 10_000;
export const AI_RECONCILIATION_TOLERANCE_PCT = 5;

/** One AI audit event: action, outcome, actor name, allowed metadata (ids, codes, amounts). */
export const AiAuditEventSchema = z.strictObject({
  id: Uuid,
  occurredAt: IsoDateTime,
  action: z.string(),
  outcome: z.enum(["SUCCESS", "DENIED", "FAILURE"]),
  actor: z.string().nullable(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  /** A refusal's code (e.g. budget_exceeded), never free text. */
  reason: z.string().nullable(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type AiAuditEvent = z.infer<typeof AiAuditEventSchema>;
/**
 * GET /api/v1/admin/ai/audit?before=<iso>&limit=<1..100>[&action=ai.<…>] — ai_usage:read AND
 * audit:read (platform); the PROTECTED stream stays the owner's (row-level security).
 */
export const AiAuditResponseSchema = z.strictObject({
  items: z.array(AiAuditEventSchema).max(100),
  nextBefore: IsoDateTime.nullable(),
});
export type AiAuditResponse = z.infer<typeof AiAuditResponseSchema>;

export const AI_LEDGER_KINDS = [
  "RESERVE",
  "START",
  "SETTLE",
  "RELEASE",
  "CANCEL",
  "EXPIRE",
  "ASSUME_SPENT",
  "OVERRUN",
  "ESTIMATE_UNDERRUN",
  "ADJUST",
] as const;
/**
 * GET /api/v1/admin/ai/operations/:id/history (ai_usage:read): the budget ledger of one operation
 * (what moved, on which budget and period) and, with audit:read, its audit events (else null).
 */
export const AiOperationHistorySchema = z.strictObject({
  operationId: Uuid,
  ledger: z.array(
    z.strictObject({
      id: Uuid,
      at: IsoDateTime,
      kind: z.enum(AI_LEDGER_KINDS),
      budgetId: Uuid,
      scope: z.enum(AI_BUDGET_SCOPES),
      siteId: Uuid.nullable(),
      period: z.enum(AI_BUDGET_PERIODS),
      periodStart: IsoDateTime,
      deltaReservedMicros: z.string().regex(/^-?\d{1,16}$/),
      deltaCommittedMicros: z.string().regex(/^-?\d{1,16}$/),
      deltaAssumedMicros: z.string().regex(/^-?\d{1,16}$/),
    }),
  ),
  audit: z.array(AiAuditEventSchema).nullable(),
});
export type AiOperationHistory = z.infer<typeof AiOperationHistorySchema>;
