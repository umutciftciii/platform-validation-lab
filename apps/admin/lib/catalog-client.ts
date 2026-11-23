/**
 * Browser-side calls of the catalogue API (PM-1) through the admin's same-origin proxy. Returns
 * a value instead of throwing, with a readable message for the form: the contract's text for a
 * known error code, refined for the catalogue's validation and conflict details.
 */
import { CATALOG_API, DEFAULT_ERROR_MESSAGES, ErrorBodySchema } from "@dream/contracts";
import { browserAdminLocale } from "./i18n/config";
import { en } from "./i18n/messages/en";
import { createTranslator } from "./i18n/translate";
import type { Translate } from "./i18n/types";

const unreachable = () => createTranslator(browserAdminLocale())("catalog.api.unreachable");

export interface FieldIssue {
  path: string;
  rule: string;
}

export type CallResult<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string; issues: FieldIssue[] };

/**
 * ML-12a: the message for an API error in the console's language. The API contract is unchanged:
 * the console translates by its stable codes — a field issue (`path:rule`), the error code, or the
 * per-language publication rules — and falls back to a generic message for anything unknown.
 * English is the contract's text, word for word. `t` defaults to the browser's console language
 * (the `dp-admin-locale` cookie; English on the server).
 */
export function messageForIssues(
  code: string | null,
  issues: FieldIssue[],
  t: Translate = createTranslator(browserAdminLocale()),
): string {
  for (const i of issues) {
    const rule = `${i.path}:${i.rule}`;
    if (rule in en.catalog.rules)
      return t(`catalog.rules.${rule as keyof typeof en.catalog.rules}`);
  }
  // ML-8b: per-language publication rules ("nl:category" translation_missing, "nl" manual).
  const missing = issues.filter((i) => i.rule === "translation_missing");
  if (missing.length) {
    const langs = [...new Set(missing.map((i) => i.path.split(":")[0]!.toUpperCase()))];
    return t("catalog.api.translationMissing", { languages: langs.join(", ") });
  }
  const manual = issues.filter((i) => i.rule === "manual_review_required");
  if (manual.length) {
    return t("catalog.api.manualReview", {
      languages: manual.map((i) => i.path.toUpperCase()).join(", "),
    });
  }
  if (code === "VALIDATION_FAILED" && issues.some((i) => i.path.startsWith("spec:"))) {
    return t("catalog.api.specBlocking");
  }
  if (code === "VALIDATION_FAILED" && issues.length) {
    const fields = [...new Set(issues.map((i) => i.path))].join(", ");
    return t("catalog.api.checkFields", { fields });
  }
  if (code && code in DEFAULT_ERROR_MESSAGES) {
    return t(`errors.${code as keyof typeof DEFAULT_ERROR_MESSAGES}`);
  }
  return t("catalog.api.notSaved");
}

export async function callCatalog<T>(
  method: "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<CallResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${CATALOG_API}${path}`, {
      method,
      headers:
        method === "POST"
          ? { "Content-Type": "application/json", Accept: "application/json" }
          : { Accept: "application/json" },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: unreachable(), issues: [] };
  }
  if (res.status === 204) return { ok: true, data: undefined as T };
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  const parsed = ErrorBodySchema.safeParse(json);
  const code = parsed.success ? parsed.data.error.code : null;
  const issues = parsed.success
    ? parsed.data.error.details.filter((d): d is FieldIssue => typeof d === "object")
    : [];
  return { ok: false, status: res.status, message: messageForIssues(code, issues), issues };
}

/** ML-8b: a read of the catalogue API (GET) through the same proxy, as a value. */
export async function getCatalog<T>(path: string): Promise<CallResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${CATALOG_API}${path}`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: unreachable(), issues: [] };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: json as T };
  const parsed = ErrorBodySchema.safeParse(json);
  const code = parsed.success ? parsed.data.error.code : null;
  const issues = parsed.success
    ? parsed.data.error.details.filter((d): d is FieldIssue => typeof d === "object")
    : [];
  return { ok: false, status: res.status, message: messageForIssues(code, issues), issues };
}
