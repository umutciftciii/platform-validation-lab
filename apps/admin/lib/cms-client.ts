/**
 * Browser-side calls of the CMS API (S1, DP-015) through the admin's same-origin proxy. Returns a
 * value instead of throwing, with a readable message for the form.
 */
import { CMS_API, DEFAULT_ERROR_MESSAGES, ErrorBodySchema } from "@dream/contracts";

export interface FieldIssue {
  path: string;
  rule: string;
}

export type CallResult<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string; issues: FieldIssue[] };

const RULE_MESSAGES: Readonly<Record<string, string>> = {
  "version:stale": "Someone else saved this page meanwhile. Reload the page to see their version.",
  "slug:unique": "Another page of this site already uses this address.",
  "slug:custom":
    "This address is reserved for the site itself (for example products or privacy) or is a language code.",
  "slug:invalid_format": "Use lower-case letters, digits and single hyphens, for example about-us.",
  "slug:reserved":
    "This address is reserved for the site itself (for example products or privacy) or is a language code.",
  // DP-210: addresses and redirects.
  "slug:live_elsewhere":
    "Another published page is live at this address. Move or unpublish that page first, then publish this one.",
  "slug:old_address":
    "This address used to belong to another page and now redirects (301) to where that page moved. Choose another address.",
  "slug:redirect_loop":
    "This address change would make old addresses redirect in a circle. Choose another address.",
  "kind:not_editable_yet": "This page is managed in code until it is imported into the CMS.",
  "content:article_incomplete":
    "An article needs a summary and at least one body section before it can be published.",
  "content.coverAlt:custom": "Add the alt text of the cover image.",
  "content:invalid":
    "This content no longer matches the current fields. Save the draft again and check the highlighted fields.",
  "revisionNumber:unknown": "This revision does not exist. Reload the page.",
  // DP-209: page SEO.
  "seo.canonicalPath:custom":
    "Use a path of this site, such as /about-us (lower-case words and hyphens, no domain).",
  "seo.ogImage:custom": "Choose one of the registered site images.",
};

/** A readable name for a field path such as `content.sections.2.button.href`. */
export function describePath(path: string): string {
  const m = /^content\.sections\.(\d+)(?:\.(.+))?$/.exec(path);
  if (m)
    return `section ${Number(m[1]) + 1}${m[2] ? ` (${m[2].replace(/\.(\d+)\./g, (_, i: string) => ` ${Number(i) + 1} `)})` : ""}`;
  if (path.startsWith("seo.")) return `SEO ${path.slice(4)}`;
  // DP-219: menu paths such as content.items.2.children.0.target.
  const menu = /^content\.(items|columns|noScriptLinks|legal|social)\.(\d+)(.*)$/.exec(path);
  if (menu) {
    const rest = (menu[3] ?? "").replace(/\.(\d+)/g, (_, i: string) => ` ${Number(i) + 1}`);
    return `${menu[1]} ${Number(menu[2]) + 1}${rest.replace(/\./g, " ")}`;
  }
  if (path === "content.excerpt") return "summary";
  if (path.startsWith("content.cover")) return "cover image";
  return path;
}

export function messageForIssues(code: string | null, issues: FieldIssue[]): string {
  for (const i of issues) {
    const text = RULE_MESSAGES[`${i.path}:${i.rule}`];
    if (text) return text;
  }
  // DP-219: a menu link names a page, product or category that is not of this site (any more).
  if (issues.some((i) => i.rule === "unknown_reference")) {
    return "A menu link points at a page, product or category that no longer exists on this site. Choose another target for the highlighted links.";
  }
  if (code === "VALIDATION_FAILED" && issues.length) {
    const fields = [...new Set(issues.map((i) => describePath(i.path)))].slice(0, 4).join(", ");
    return `Check these fields: ${fields}.`;
  }
  if (code && code in DEFAULT_ERROR_MESSAGES) {
    return DEFAULT_ERROR_MESSAGES[code as keyof typeof DEFAULT_ERROR_MESSAGES];
  }
  return "The change could not be saved. Try again in a moment.";
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
    return { ok: false, status: 0, message: "The admin API cannot be reached.", issues: [] };
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
