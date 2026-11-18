/**
 * DP-211: browser-side calls of the redirect routes through the admin's same-origin proxy.
 * Returns a value instead of throwing, with readable messages for every `field:rule` the API
 * named (lib/redirects-view.ts).
 */
import { DEFAULT_ERROR_MESSAGES, ErrorBodySchema } from "@dream/contracts";
import { knownRule, ruleMessage } from "./redirects-view";

export interface RuleIssue {
  path: string;
  rule: string;
}

export type RedirectCall<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string; issues: RuleIssue[] };

export function redirectErrorMessage(code: string | null, issues: RuleIssue[]): string {
  const known = issues.filter((i) => knownRule(`${i.path}:${i.rule}`));
  if (known.length) return known.map((i) => ruleMessage(`${i.path}:${i.rule}`)).join(" ");
  if (code && code in DEFAULT_ERROR_MESSAGES) {
    return DEFAULT_ERROR_MESSAGES[code as keyof typeof DEFAULT_ERROR_MESSAGES];
  }
  return "The change could not be saved. Try again in a moment.";
}

export async function callRedirects<T>(
  path: string,
  init: { method: "GET" } | { method: "POST"; body: unknown },
): Promise<RedirectCall<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method,
      headers:
        init.method === "POST"
          ? { "Content-Type": "application/json", Accept: "application/json" }
          : { Accept: "application/json" },
      ...(init.method === "POST" ? { body: JSON.stringify(init.body ?? {}) } : {}),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: "The admin API cannot be reached.", issues: [] };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  const parsed = ErrorBodySchema.safeParse(json);
  const code = parsed.success ? parsed.data.error.code : null;
  const issues = parsed.success
    ? parsed.data.error.details.filter((d): d is RuleIssue => typeof d === "object")
    : [];
  if (res.status === 403) {
    return { ok: false, status: 403, message: "Your roles do not allow this change.", issues };
  }
  return { ok: false, status: res.status, message: redirectErrorMessage(code, issues), issues };
}

/** Saves text as a file in the browser (sample CSV, dry-run report). */
export function downloadText(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
