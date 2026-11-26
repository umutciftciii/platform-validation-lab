/**
 * DP-298 (ADR-031 D1): the legal texts of the forms and the privacy page, read from the API.
 *
 * The texts are versions published in the admin (Content > Legal texts); the site has no copy of
 * its own. `GET /api/v1/public/legal-texts` with this site's proxy key, as the public languages
 * (lib/public-locales.ts): validated against @dream/contracts, 5 s timeout, logged without data,
 * read once per `TTL_MS` per server process.
 *
 * - While the API cannot answer and nothing is cached, the snapshot is the unavailable one (no
 *   language, a production blocker): no form and no policy page in production (fail closed).
 * - `fresh: true` reads past the cache. The lead and contact handlers use it when the API answered
 *   LEAD_TEXT_OUTDATED, so a version published a moment ago is what the page and
 *   `/lead-form/texts` serve next, not the 30 s old one the visitor was refused with.
 * - A failed read is remembered for `FAILURE_TTL_MS`: the proxy reads the snapshot on every page
 *   request, and a down API must not make each of them wait for the timeout.
 */
import { PUBLIC_LEGAL_TEXTS_API, type PrivacyPublication } from "@dream/contracts";

import { catalogConfig } from "@/lib/catalog-api";
import {
  legalTextsSnapshotFrom,
  unavailableLegalTexts,
  type LegalTextsSnapshot,
} from "@/lib/legal-texts-snapshot";
import type { RouteLocale } from "@/lib/locale-routing";
import { sitePrivacy } from "@/lib/privacy";
import { privacyLocalesOf } from "@/lib/proxy-routes";

const TIMEOUT_MS = 5_000;
/** Short enough that a version published in the admin shows within a minute. */
const TTL_MS = 30_000;
const FAILURE_TTL_MS = 5_000;

let cached: { at: number; snapshot: LegalTextsSnapshot } | null = null;
let failedAt: number | null = null;
/** One read at a time: concurrent requests share it. */
let inFlight: Promise<LegalTextsSnapshot | null> | null = null;

async function fetchLegalTexts(): Promise<LegalTextsSnapshot | null> {
  const config = catalogConfig();
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
    const snapshot = legalTextsSnapshotFrom(await res.json().catch(() => null));
    if (!snapshot) console.error("legal texts: the response does not match the contract");
    return snapshot;
  } catch {
    console.error("legal texts: request failed (network)");
    return null;
  }
}

function read(): Promise<LegalTextsSnapshot | null> {
  inFlight ??= fetchLegalTexts().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** The published legal texts and the production blockers (cached; fail closed). */
export async function legalTextsSnapshot(
  opts: { fresh?: boolean } = {},
  now = Date.now(),
): Promise<LegalTextsSnapshot> {
  if (!opts.fresh) {
    if (cached && now - cached.at < TTL_MS) return cached.snapshot;
    // The cache is past its lifetime here: an older snapshot is never served (fail closed).
    if (failedAt !== null && now - failedAt < FAILURE_TTL_MS) return unavailableLegalTexts();
  }
  const snapshot = await read();
  if (snapshot) {
    cached = { at: Date.now(), snapshot };
    failedAt = null;
    return snapshot;
  }
  failedAt = Date.now();
  // A fresh read that failed keeps what was read last within its lifetime; nothing else is used.
  if (cached && Date.now() - cached.at < TTL_MS) return cached.snapshot;
  return unavailableLegalTexts();
}

/** For pages: the snapshot, its publication gate here and the languages the policy exists in. */
export async function sitePrivacyNow(): Promise<{
  snapshot: LegalTextsSnapshot;
  gate: PrivacyPublication;
  locales: readonly RouteLocale[];
}> {
  const snapshot = await legalTextsSnapshot();
  return {
    snapshot,
    gate: sitePrivacy(snapshot.blockers),
    locales: privacyLocalesOf(snapshot.registry),
  };
}
