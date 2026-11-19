/**
 * CSV encoding of the lead export (DP-227). Pure functions, unit-tested on their own.
 *
 * - RFC 4180: comma separator, CRLF line ends, every cell in double quotes, a quote inside a
 *   cell doubled. Commas, quotes and line breaks in a value therefore stay inside their cell.
 * - The file starts with a UTF-8 byte order mark so that Excel opens accented and Turkish
 *   characters (ç, ğ, ı, İ, ö, ş, ü) correctly.
 * - Formula injection (CSV injection): a cell whose text starts with `=`, `+`, `-`, `@`, a tab
 *   or a carriage return would run as a formula in a spreadsheet. Such a value gets a leading
 *   apostrophe, so the spreadsheet shows it as text (OWASP "CSV Injection"). Leading spaces are
 *   looked through, because spreadsheets ignore them before a formula sign.
 * - Dates are written in the admin console's time zone (Europe/Amsterdam) as
 *   `YYYY-MM-DD HH:mm:ss`, which spreadsheets read as a date.
 */
export const CSV_BOM = "﻿";
export const CSV_EOL = "\r\n";
export const EXPORT_TIME_ZONE = "Europe/Amsterdam";

const FORMULA_START = /^[\s\u00A0]*[=+\-@\t\r]/;

/** Neutralises a value that a spreadsheet would read as a formula. */
export function neutraliseFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** One cell: formula-safe, quoted, inner quotes doubled. */
export function csvCell(value: string | null | undefined): string {
  const text = neutraliseFormula(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

/** One CSV line (with its CRLF). */
export function csvLine(values: readonly (string | null | undefined)[]): string {
  return values.map(csvCell).join(",") + CSV_EOL;
}

const PART_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: EXPORT_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function parts(at: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of PART_FORMAT.formatToParts(at)) out[p.type] = p.value;
  return out;
}

/** `YYYY-MM-DD HH:mm:ss` in Europe/Amsterdam. */
export function csvDateTime(at: Date | null): string {
  if (!at) return "";
  const p = parts(at);
  return `${p["year"]}-${p["month"]}-${p["day"]} ${p["hour"]}:${p["minute"]}:${p["second"]}`;
}

/** Local offset of the time zone at an instant, in ms (local minus UTC). */
function offsetMs(instant: number): number {
  const p = parts(new Date(instant));
  const local = Date.UTC(
    Number(p["year"]),
    Number(p["month"]) - 1,
    Number(p["day"]),
    Number(p["hour"]),
    Number(p["minute"]),
    Number(p["second"]),
  );
  return local - Math.floor(instant / 1000) * 1000;
}

/** A calendar day `YYYY-MM-DD` (already validated). */
function ymd(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return [y, m, d];
}

/** The instant a calendar day starts in Europe/Amsterdam (DST-aware). */
export function dayStart(day: string): Date {
  const [y, m, d] = ymd(day);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetMs(guess);
  const second = guess - offsetMs(first);
  return new Date(second);
}

/** The instant the day after `day` starts (exclusive end of an inclusive date range). */
export function dayEnd(day: string): Date {
  const [y, m, d] = ymd(day);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return dayStart(next.toISOString().slice(0, 10));
}

/** `YYYY-MM-DD` and a real calendar date. */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = ymd(value);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    y >= 2000 &&
    y <= 2999 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** `leads-<site>-YYYY-MM-DD-HHmm.csv` in Europe/Amsterdam; ASCII only. */
export function exportFilename(siteLabel: string, now: Date): string {
  const p = parts(now);
  const site =
    siteLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "all";
  return `leads-${site}-${p["year"]}-${p["month"]}-${p["day"]}-${p["hour"]}${p["minute"]}.csv`;
}
