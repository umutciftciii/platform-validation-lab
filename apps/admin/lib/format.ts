const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "12 min ago", "3 h ago", "2 days ago"; future times read "in 25 min". */
export function relativeTime(from: Date, now: Date): string {
  const diff = now.getTime() - from.getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  let text: string;
  if (abs < MINUTE) return "just now";
  if (abs < HOUR) text = `${Math.round(abs / MINUTE)} min`;
  else if (abs < DAY) text = `${Math.round(abs / HOUR)} h`;
  else {
    const days = Math.round(abs / DAY);
    text = `${days} ${days === 1 ? "day" : "days"}`;
  }
  return future ? `in ${text}` : `${text} ago`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

/** Signed change with one decimal: "+4.2%", "−1.0%" (true minus sign). */
export function formatDelta(percent: number): string {
  const fixed = Math.abs(percent).toFixed(1);
  if (percent > 0) return `+${fixed}%`;
  if (percent < 0) return `−${fixed}%`;
  return `${fixed}%`;
}

export function formatClock(date: Date, timeZone = "Europe/Amsterdam"): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(
    date,
  );
}

export function formatLongDate(date: Date, timeZone = "Europe/Amsterdam"): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(date);
}

export function greeting(date: Date, timeZone = "Europe/Amsterdam"): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(date),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
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
