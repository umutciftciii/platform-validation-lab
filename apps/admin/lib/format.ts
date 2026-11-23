/**
 * Formatting helpers of the console. Since ML-11 the language-aware ones live in lib/i18n/format.ts
 * (one format module, ADR-028 D15); they are re-exported here with English as the default, so the
 * modules not yet translated (ML-12) render exactly as before.
 */
export { formatClock, formatLongDate, formatNumber, greeting, relativeTime } from "./i18n/format";

/** Signed change with one decimal: "+4.2%", "−1.0%" (true minus sign). */
export function formatDelta(percent: number): string {
  const fixed = Math.abs(percent).toFixed(1);
  if (percent > 0) return `+${fixed}%`;
  if (percent < 0) return `−${fixed}%`;
  return `${fixed}%`;
}

export function initials(name: string): string {
  const parts = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts.slice(0, 1);
  return letters
    .map((p) => p![0]!.toUpperCase())
    .join("")
    .slice(0, 2);
}
