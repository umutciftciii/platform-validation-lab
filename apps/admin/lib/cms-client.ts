/**
 * Browser-side calls of the CMS API (S1, DP-015) through the admin's same-origin proxy. Returns a
 * value instead of throwing, with a readable message for the form.
 *
 * ML-12c (DP-243): the message is in the admin UI language (by the API's code and rule); the API
 * payload, its codes and its own English messages are unchanged.
 */
import { CMS_API, DEFAULT_ERROR_MESSAGES, ErrorBodySchema } from "@dream/contracts";
import { browserAdminLocale } from "./i18n/config";
import { en } from "./i18n/messages/en";
import { createTranslator } from "./i18n/translate";
import type { Translate } from "./i18n/types";

export interface FieldIssue {
  path: string;
  rule: string;
}

export type CallResult<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string; issues: FieldIssue[] };

/** `<path>:<rule>` of an issue → its message (content.api.rules); the codes stay the API's. */
const RULE_KEYS: Readonly<Record<string, keyof typeof en.content.api.rules>> = {
  "version:stale": "versionStale",
  "slug:unique": "slugUnique",
  "slug:custom": "slugReserved",
  "slug:invalid_format": "slugInvalidFormat",
  "slug:reserved": "slugReserved",
  // DP-210: addresses and redirects.
  "slug:live_elsewhere": "slugLiveElsewhere",
  "slug:old_address": "slugOldAddress",
  "slug:redirect_loop": "slugRedirectLoop",
  "kind:not_editable_yet": "kindNotEditableYet",
  "content:article_incomplete": "articleIncomplete",
  "content.coverAlt:custom": "coverAlt",
  "content:invalid": "contentInvalid",
  "revisionNumber:unknown": "revisionUnknown",
  // ML-2 (DP-074): languages and translations.
  "locale:exists": "localeExists",
  "locale:not_enabled": "localeNotEnabled",
  "locale:is_source": "localeIsSource",
  "locale:unknown": "localeUnknown",
  "slug:fixed_address": "slugFixedAddress",
  "slug:format": "slugFormat",
  // DP-209: page SEO.
  "seo.canonicalPath:custom": "canonicalPath",
  "seo.ogImage:custom": "ogImage",
};

const browserT = (): Translate => createTranslator(browserAdminLocale());

/** A word of a field path in the UI language (English: the API's key as it is). */
function pathWord(word: string, t: Translate): string {
  return word in en.content.api.pathWords
    ? t(`content.api.pathWords.${word as keyof typeof en.content.api.pathWords}`)
    : word;
}

/** A readable name for a field path such as `content.sections.2.button.href`. */
export function describePath(path: string, t: Translate = browserT()): string {
  const words = (s: string) => s.replace(/[A-Za-z]+/g, (w) => pathWord(w, t));
  const m = /^content\.sections\.(\d+)(?:\.(.+))?$/.exec(path);
  if (m) {
    const n = Number(m[1]) + 1;
    if (!m[2]) return t("content.api.path.section", { n });
    const field = m[2].replace(/\.(\d+)\./g, (_, i: string) => ` ${Number(i) + 1} `);
    const sep = t("content.api.path.separator");
    return t("content.api.path.sectionField", { n, field: words(field).split(".").join(sep) });
  }
  if (path.startsWith("seo."))
    return t("content.api.path.seo", {
      field: words(path.slice(4)).split(".").join(t("content.api.path.separator")),
    });
  // DP-219: menu paths such as content.items.2.children.0.target.
  const menu = /^content\.(items|columns|noScriptLinks|legal|social)\.(\d+)(.*)$/.exec(path);
  if (menu) {
    const rest = (menu[3] ?? "").replace(/\.(\d+)/g, (_, i: string) => ` ${Number(i) + 1}`);
    return t("content.api.path.menu", {
      group: pathWord(menu[1]!, t),
      n: Number(menu[2]) + 1,
      rest: words(rest.replace(/\./g, " ")),
    });
  }
  if (path === "content.excerpt") return t("content.api.path.summary");
  if (path.startsWith("content.cover")) return t("content.api.path.cover");
  return path;
}

/** The message of a refused change in the UI language (by code; the API's text stays English). */
export function messageForIssues(
  code: string | null,
  issues: FieldIssue[],
  t: Translate = browserT(),
): string {
  for (const i of issues) {
    const key = RULE_KEYS[`${i.path}:${i.rule}`];
    if (key) return t(`content.api.rules.${key}`);
  }
  // DP-219: a menu link names a page, product or category that is not of this site (any more).
  if (issues.some((i) => i.rule === "unknown_reference")) {
    return t("content.api.unknownReference");
  }
  if (code === "VALIDATION_FAILED" && issues.length) {
    const fields = [...new Set(issues.map((i) => describePath(i.path, t)))].slice(0, 4).join(", ");
    return t("content.api.checkFields", { fields });
  }
  if (code && code in DEFAULT_ERROR_MESSAGES) {
    return t(`errors.${code as keyof typeof DEFAULT_ERROR_MESSAGES}`);
  }
  return t("content.api.notSaved");
}

export async function callCms<T>(path: string, body: unknown): Promise<CallResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${CMS_API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body ?? {}),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: browserT()("content.api.unreachable"), issues: [] };
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
