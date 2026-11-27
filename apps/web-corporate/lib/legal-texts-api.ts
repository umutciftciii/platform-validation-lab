/**
 * DP-298 (ADR-031 D1): the legal texts of dreampetroleum.com, read from the API like web-bv does
 * (apps/web-bv/lib/legal-texts-api.ts): `GET /api/v1/public/legal-texts` with this site's proxy
 * key, validated against @dream/contracts, 5 s timeout, logged without data, cached 30 s.
 *
 * - Same environment names as web-bv: `DP_API_URL` and this site's own key
 *   `DP_PROXY_KEY_WEB_CORPORATE` (server only, never NEXT_PUBLIC_). The API derives the site from
 *   the key.
 * - Not configured, not answering or not the contract: the unavailable snapshot (no language, a
 *   production blocker), so there is no policy page and no link (fail closed). The site has no
 *   copy of the texts.
 */
import {
  PUBLIC_LEGAL_TEXTS_API,
  PublicLegalTextsResponseSchema,
  legalTextRegistryFrom,
  privacyBlockersFor,
  type LegalTextRegistry,
} from "@dream/contracts";

import { apiConfig, apiGet } from "@/lib/api";

const TTL_MS = 30_000;

export interface LegalTextsSnapshot {
  registry: LegalTextRegistry;
  blockers: string[];
}

let cached: { at: number; snapshot: LegalTextsSnapshot } | null = null;

async function fetchLegalTexts(): Promise<LegalTextsSnapshot | null> {
  if (!apiConfig()) return null;
  try {
    const res = await apiGet(PUBLIC_LEGAL_TEXTS_API);
    if (!res) return null;
    if (!res.ok) {
      console.error(`legal texts: the API answered ${res.status}`);
      return null;
    }
    const parsed = PublicLegalTextsResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      console.error("legal texts: the response does not match the contract");
      return null;
    }
    return {
      registry: legalTextRegistryFrom(parsed.data.sets),
      blockers: privacyBlockersFor(
        parsed.data.pendingReview,
        undefined,
        undefined,
        parsed.data.missingValues,
      ),
    };
  } catch {
    console.error("legal texts: request failed (network)");
    return null;
  }
}

/** The published legal texts and the production blockers (cached; fail closed). */
export async function legalTextsSnapshot(now = Date.now()): Promise<LegalTextsSnapshot> {
  if (cached && now - cached.at < TTL_MS) return cached.snapshot;
  const snapshot = await fetchLegalTexts();
  if (snapshot) {
    cached = { at: now, snapshot };
    return snapshot;
  }
  return { registry: {}, blockers: privacyBlockersFor(null) };
}
