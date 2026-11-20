/**
 * ML-3 (DP-236, ADR-028 D2/D3/D14): which languages of the BV site a visitor may see.
 *
 * The answer is data (`SiteLocale.public`, ML-1), read from `GET /api/v1/public/cms/locales` with
 * this site's proxy key; it lists only public languages. The site never makes a language public
 * itself. Read once per `TTL_MS` per server process (the proxy asks on every request under a
 * language prefix other than the default one). While the API cannot answer, only the default
 * language counts as public: a hidden language stays hidden (fail closed).
 */
import { PUBLIC_CMS_API, PublicSiteLocalesResponseSchema } from "@dream/contracts";

import { catalogConfig } from "@/lib/catalog-api";
import { DEFAULT_LOCALE } from "@/lib/locale-routing";

const TIMEOUT_MS = 5_000;
/** Short enough that a language made public by an editor shows within a minute. */
const TTL_MS = 30_000;

let cached: { at: number; locales: readonly string[] } | null = null;

async function fetchPublicLocales(): Promise<readonly string[] | null> {
  const config = catalogConfig();
  if (!config) return null;
  try {
    const res = await fetch(`${config.apiUrl}${PUBLIC_CMS_API}/locales`, {
      headers: { "X-DP-Proxy-Key": config.proxyKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = PublicSiteLocalesResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      console.error("public locales: the response does not match the contract");
      return null;
    }
    return parsed.data.locales.map((l) => l.locale);
  } catch {
    console.error("public locales: request failed (network)");
    return null;
  }
}

/** The public languages (cached); null while the API cannot answer and nothing is cached. */
export async function publicLocales(now = Date.now()): Promise<readonly string[] | null> {
  if (cached && now - cached.at < TTL_MS) return cached.locales;
  const locales = await fetchPublicLocales();
  if (locales) cached = { at: now, locales };
  return locales;
}

/** For pages: the public languages, the default language alone while the API cannot answer. */
export async function visibleLocales(): Promise<readonly string[]> {
  return (await publicLocales()) ?? [DEFAULT_LOCALE];
}
