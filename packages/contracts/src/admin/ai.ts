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
] as const;
export type AiBlocker = (typeof AI_BLOCKERS)[number];

/** GET /api/v1/admin/ai/overview (ai:read). 404 while AI is off. */
export const AiOverviewResponseSchema = z.strictObject({
  enabled: z.literal(true),
  /** Whether a provider call could start now. Always false until DP-291 (no call path yet). */
  callsPossible: z.boolean(),
  blockers: z.array(z.enum(AI_BLOCKERS)),
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
