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
