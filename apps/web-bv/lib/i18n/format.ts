/**
 * ML-6 (DP-138, ADR-028 D11): placeholders, plurals and locale formats of the BV site, without
 * the dictionaries (client components import this module and get their words as props).
 * Pure: no Next.js, no `@/` imports, no "use client".
 */

/** The site's languages (as `RouteLocale` in lib/locale-routing.ts, kept free of imports). */
export type SiteLocale = "en" | "nl";

/** A `{ one, other }` plural of the dictionary. */
export interface PluralForms {
  one: string;
  other: string;
}

/** BCP 47 tags of the formats (ADR-028 D11). */
const INTL: Record<SiteLocale, string> = { en: "en-GB", nl: "nl-NL" };

/** The time zone of every date and time the site renders (ADR-028 D11). */
export const SITE_TIME_ZONE = "Europe/Amsterdam";

export function intlLocale(locale: string): string {
  return INTL[locale as SiteLocale] ?? INTL.en;
}

export type Vars = Readonly<Record<string, string | number>>;

/** `{name}` placeholders in a template; the names, in order of appearance. */
export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map((m) => m[1] as string);
}

/** Fills `{name}` placeholders. Numbers are written as given (format them first when needed). */
export function interpolate(template: string, vars: Vars = {}): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/**
 * Splits a template into text and placeholder values, for templates with markup in them
 * (`components/i18n/rich.tsx`): `parts("A {b} c", { b: X })` → `["A ", X, " c"]`.
 */
export function parts<T>(template: string, vars: Readonly<Record<string, T>>): (string | T)[] {
  const out: (string | T)[] = [];
  let last = 0;
  for (const m of template.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)) {
    const name = m[1] as string;
    if (!Object.prototype.hasOwnProperty.call(vars, name)) continue;
    if (m.index > last) out.push(template.slice(last, m.index));
    out.push(vars[name] as T);
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push(template.slice(last));
  return out;
}

/** The plural form of `count` in a language, with `{count}` (and any other `vars`) filled. */
export function plural(locale: string, forms: PluralForms, count: number, vars: Vars = {}): string {
  const rule = new Intl.PluralRules(intlLocale(locale)).select(count);
  const template = rule === "one" ? forms.one : forms.other;
  return interpolate(template, { ...vars, count: formatNumber(locale, count) });
}

/** A number in the locale's format (`en-GB` 1,800.5 · `nl-NL` 1.800,5). */
export function formatNumber(locale: string, value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

/** A calendar date ("21 November 2026" · "21 november 2026"), in Europe/Amsterdam. */
export function formatDate(locale: string, value: string | Date): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: SITE_TIME_ZONE,
  }).format(typeof value === "string" ? new Date(value) : value);
}

/**
 * A clock time ("14:05"). `timeZone` defaults to Europe/Amsterdam; the download form passes
 * `null` for the visitor's own clock (its expiry time is read on the visitor's device, unchanged
 * since DP-042).
 */
export function formatTime(locale: string, value: string | Date, timeZone: string | null = SITE_TIME_ZONE): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleTimeString(intlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

/** "in 3 minutes" · "over 3 minuten" (`Intl.RelativeTimeFormat`, numeric always). */
export function formatRelative(locale: string, value: number, unit: Intl.RelativeTimeFormatUnit): string {
  return new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "always" }).format(value, unit);
}

/**
 * The language of country names. English keeps `en` (the names the forms showed before ML-6):
 * `en-GB` would rename 9 countries ("St. Lucia" → "St Lucia", "U.S. Virgin Islands" → "US Virgin
 * Islands"); switching is an owner decision (DP-138 note), not a side effect of ML-6.
 */
const COUNTRY_NAMES: Record<SiteLocale, string> = { en: "en", nl: "nl-NL" };

/**
 * Country options of a form: names in the page's language (`Intl.DisplayNames`), sorted by that
 * language's collation. The submitted value is always the ISO code.
 */
export function countryOptions(locale: string, codes: readonly string[]): { code: string; name: string }[] {
  const tag = COUNTRY_NAMES[locale as SiteLocale] ?? COUNTRY_NAMES.en;
  const names = new Intl.DisplayNames([tag], { type: "region" });
  return codes
    .map((code) => ({ code, name: names.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, tag));
}
