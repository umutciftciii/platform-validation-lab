/**
 * DP-211: browser-side calls of the redirect routes through the admin's same-origin proxy.
 * Returns a value instead of throwing, with readable messages for every `field:rule` the API
 * named (lib/redirects-view.ts).
 *
 * ML-12d (DP-243): the messages are in the admin UI language (by the API's code and rule, as
 * lib/cms-client.ts); request paths, bodies and every API code are unchanged.
 */
import { DEFAULT_ERROR_MESSAGES, ErrorBodySchema } from "@dream/contracts";
import { browserAdminLocale } from "./i18n/config";
import { createTranslator } from "./i18n/translate";
import type { Translate } from "./i18n/types";
import { knownRule, ruleMessage } from "./redirects-view";

const browserT = (): Translate => createTranslator(browserAdminLocale());

export interface RuleIssue {
  path: string;
  rule: string;
}

export type RedirectCall<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string; issues: RuleIssue[] };

export function redirectErrorMessage(
  code: string | null,
  issues: RuleIssue[],
  t: Translate = browserT(),
): string {
  const known = issues.filter((i) => knownRule(`${i.path}:${i.rule}`));
  if (known.length) return known.map((i) => ruleMessage(`${i.path}:${i.rule}`, t)).join(" ");
  if (code && code in DEFAULT_ERROR_MESSAGES) {
    return t(`errors.${code as keyof typeof DEFAULT_ERROR_MESSAGES}`);
  }
  return t("seo.redirects.api.notSaved");
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
    return {
      ok: false,
      status: 0,
      message: browserT()("seo.redirects.api.unreachable"),
      issues: [],
    };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  const parsed = ErrorBodySchema.safeParse(json);
  const code = parsed.success ? parsed.data.error.code : null;
  const issues = parsed.success
    ? parsed.data.error.details.filter((d): d is RuleIssue => typeof d === "object")
    : [];
  if (res.status === 403) {
    return {
      ok: false,
      status: 403,
      message: browserT()("seo.redirects.api.forbidden"),
      issues,
    };
  }
  return { ok: false, status: res.status, message: redirectErrorMessage(code, issues), issues };
}

/** Saves text as a file in the browser (sample CSV, dry-run report). */
// i18n-ignore: a MIME type
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
