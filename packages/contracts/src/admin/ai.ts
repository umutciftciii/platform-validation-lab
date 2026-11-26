/**
 * DP-287 (ADR-030): the AI Center API, `/api/v1/admin/ai/*`.
 *
 * AI is OFF by default. Only the system owner switches it, platform-wide, in the Owner Console
 * (`POST /api/v1/admin/owner/modules/ai/platform`, owner.ts). While it is off every route here
 * answers 404 (the area looks missing) and the admin shows no AI menu, page or button
 * (`StaffSessionResponse.features.aiCenter`).
 *
 * DP-287 builds the switch only: no provider key, provider call, budget or translation link exists
 * yet (DP-288…DP-294), so no AI call is possible even while AI is on; `blockers` says why.
 */
import { z } from "zod";

export const AI_API = "/api/v1/admin/ai";

/** Why no provider call is possible yet (each later backlog item removes its own blocker). */
export const AI_BLOCKERS = ["no_provider_key", "no_enabled_model", "no_budget"] as const;
export type AiBlocker = (typeof AI_BLOCKERS)[number];

/** GET /api/v1/admin/ai/overview (ai:read). 404 while AI is off. */
export const AiOverviewResponseSchema = z.strictObject({
  enabled: z.literal(true),
  /** Whether a provider call could start now. Always false in DP-287. */
  callsPossible: z.boolean(),
  blockers: z.array(z.enum(AI_BLOCKERS)),
});
export type AiOverviewResponse = z.infer<typeof AiOverviewResponseSchema>;
