/**
 * The admin's one format module (ADR-028 D15): numbers, dates and relative times per UI language,
 * always in the company's time zone (Europe/Amsterdam). English output is exactly what
 * lib/format.ts produced before ML-11 (en-GB). Exports and CSV files do not use this module: their
 * formats are fixed by their own contracts (ADR-027).
 */
import { ADMIN_TIME_ZONE, type AdminLocale, INTL_LOCALE } from "./config";
import { createTranslator } from "./translate";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** EN "just now", "12 min ago", "3 h ago", "2 days ago", "in 25 min"; TR "12 dk önce" … */
export function relativeTime(from: Date, now: Date, locale: AdminLocale = "en"): string {
  const t = createTranslator(locale);
  const diff = now.getTime() - from.getTime();
  const abs = Math.abs(diff);
  if (abs < MINUTE) return t("time.justNow");
  let text: string;
  if (abs < HOUR) text = t("time.minutes", { n: Math.round(abs / MINUTE) });
  else if (abs < DAY) text = t("time.hours", { n: Math.round(abs / HOUR) });
  else text = t("time.days", { count: Math.round(abs / DAY) });
  return diff < 0 ? t("time.future", { text }) : t("time.past", { text });
}

export function formatNumber(value: number, locale: AdminLocale = "en"): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale]).format(value);
}

/** "14:05" (24-hour clock in both languages). */
export function formatClock(
  date: Date,
  timeZone = ADMIN_TIME_ZONE,
  locale: AdminLocale = "en",
): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

/** EN "Monday 23 November", TR "23 Kasım Pazartesi". */
export function formatLongDate(
  date: Date,
  timeZone = ADMIN_TIME_ZONE,
  locale: AdminLocale = "en",
): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(date);
}

/** Expiry of a credential link: EN "23 Nov, 14:05 CET", TR "23 Kas 14:05 GMT+1". */
export function formatLinkExpiry(date: Date, locale: AdminLocale = "en"): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ADMIN_TIME_ZONE,
    timeZoneName: "short",
  }).format(date);
}

export function greeting(
  date: Date,
  timeZone = ADMIN_TIME_ZONE,
  locale: AdminLocale = "en",
): string {
  const t = createTranslator(locale);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(date),
  );
  if (hour < 12) return t("time.goodMorning");
  if (hour < 18) return t("time.goodAfternoon");
  return t("time.goodEvening");
}
