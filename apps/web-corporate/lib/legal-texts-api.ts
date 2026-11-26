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

const KEY = /^[A-Za-z0-9_-]{43,}$/;
const TIMEOUT_MS = 5_000;
const TTL_MS = 30_000;

export interface LegalTextsSnapshot {
  registry: LegalTextRegistry;
  blockers: string[];
}

function apiConfig(
  env: Record<string, string | undefined> = process.env,
): { apiUrl: string; proxyKey: string } | null {
  const apiUrl = env["DP_API_URL"]?.trim();
  const proxyKey = env["DP_PROXY_KEY_WEB_CORPORATE"]?.trim() ?? "";
  if (!apiUrl || !KEY.test(proxyKey)) return null;
  try {
    const url = new URL(apiUrl);
    const local = (env["DP_DEPLOY_ENV"]?.trim() || "local") === "local";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return { apiUrl: url.origin, proxyKey };
  } catch {
    return null;
  }
}

let cached: { at: number; snapshot: LegalTextsSnapshot } | null = null;

async function fetchLegalTexts(): Promise<LegalTextsSnapshot | null> {
  const config = apiConfig();
  if (!config) return null;
  try {
    const res = await fetch(`${config.apiUrl}${PUBLIC_LEGAL_TEXTS_API}`, {
      headers: { "X-DP-Proxy-Key": config.proxyKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
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
      blockers: privacyBlockersFor(parsed.data.pendingReview),
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
