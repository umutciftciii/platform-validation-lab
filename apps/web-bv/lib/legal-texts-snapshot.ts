/**
 * DP-298 (ADR-031 D1): the legal texts of the forms and the privacy page as the API answers them
 * (`GET /api/v1/public/legal-texts`), turned into what the site renders. Pure (no Next.js, no
 * fetch, no `@/` imports) so `node --test` covers it; lib/legal-texts-api.ts reads the API.
 *
 * - `registry`: the languages whose four texts are published (`legalTextRegistryFrom`).
 * - `blockers`: what stops production publication (`privacyBlockersFor`): the controller details
 *   and open points of @dream/contracts plus every current version still under legal review.
 * - Anything that is not the contract, or no answer at all, is the unavailable snapshot: no
 *   language, and a blocker, so production shows no form and no policy (fail closed).
 */
import {
  PublicLegalTextsResponseSchema,
  legalTextRegistryFrom,
  privacyBlockersFor,
  type LegalTextRegistry,
} from "@dream/contracts";

export interface LegalTextsSnapshot {
  registry: LegalTextRegistry;
  blockers: string[];
}

/** No texts could be read: nothing is offered, production is blocked. */
export function unavailableLegalTexts(): LegalTextsSnapshot {
  return { registry: {}, blockers: privacyBlockersFor(null) };
}

/** The snapshot of an API answer, or null when the answer does not match the contract. */
export function legalTextsSnapshotFrom(payload: unknown): LegalTextsSnapshot | null {
  const parsed = PublicLegalTextsResponseSchema.safeParse(payload);
  if (!parsed.success) return null;
  return {
    registry: legalTextRegistryFrom(parsed.data.sets),
    blockers: privacyBlockersFor(parsed.data.pendingReview),
  };
}
