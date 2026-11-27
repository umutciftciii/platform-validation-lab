/**
 * COM-1 (ADR-028 D2/D14): which languages of the corporate site a visitor may see — data
 * (`SiteLocale.public`), read from `GET /api/v1/public/cms/locales` with this site's key, once per
 * `TTL_MS`. While the API cannot answer only the default language counts (fail closed).
 */
import { PUBLIC_CMS_API, PublicSiteLocalesResponseSchema } from "@dream/contracts";

import { apiGet } from "@/lib/api";
import { DEFAULT_LOCALE } from "@/lib/locale-routing";

const TTL_MS = 30_000;
let cached: { at: number; locales: readonly string[] } | null = null;

async function fetchPublicLocales(): Promise<readonly string[] | null> {
  const res = await apiGet(`${PUBLIC_CMS_API}/locales`);
  if (!res?.ok) return null;
  const parsed = PublicSiteLocalesResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    console.error("public locales: the response does not match the contract");
    return null;
  }
  return parsed.data.locales.map((l) => l.locale);
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
