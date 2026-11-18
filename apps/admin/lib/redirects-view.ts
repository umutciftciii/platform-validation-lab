/**
 * DP-211: view helpers of Admin > SEO > Redirects (pure, shared by the server page and the client
 * components): list parameters, labels, readable messages for the API's `field:rule` codes and
 * the downloadable CSV report of a dry-run.
 */
import {
  ADMIN_SEO_API,
  SEO_REDIRECT_CSV_MAX_BYTES,
  SEO_REDIRECT_CSV_MAX_ROWS,
  SEO_REDIRECT_SORTS,
  csvCell,
  type SeoRedirectImportResponse,
  type SeoRedirectItem,
  type SiteRedirectOrigin,
} from "@dream/contracts";

export const redirectsApi = (siteId: string) => `${ADMIN_SEO_API}/sites/${siteId}/redirects`;

export interface RedirectListParams {
  q: string;
  origin: SiteRedirectOrigin | "";
  status: "301" | "302" | "";
  active: "true" | "false" | "";
  sort: (typeof SEO_REDIRECT_SORTS)[number];
  dir: "asc" | "desc";
  page: number;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The list parameters from the page's search parameters; anything unknown falls back. */
export function parseRedirectParams(
  sp: Record<string, string | string[] | undefined>,
): RedirectListParams {
  const origin = one(sp["origin"]);
  const status = one(sp["status"]);
  const active = one(sp["active"]);
  const sort = one(sp["sort"]);
  const dir = one(sp["dir"]);
  const page = Number(one(sp["page"]));
  return {
    q: one(sp["q"]).trim().slice(0, 200),
    origin: origin === "MANUAL" || origin === "SLUG_CHANGE" || origin === "IMPORT" ? origin : "",
    status: status === "301" || status === "302" ? status : "",
    active: active === "true" || active === "false" ? active : "",
    sort: (SEO_REDIRECT_SORTS as readonly string[]).includes(sort)
      ? (sort as RedirectListParams["sort"])
      : "updated",
    dir: dir === "asc" ? "asc" : "desc",
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** The query string of a list (API and page links share it); defaults are left out. */
export function redirectQuery(p: RedirectListParams, patch: Partial<RedirectListParams> = {}) {
  const v = { ...p, ...patch };
  const qs = new URLSearchParams();
  if (v.q) qs.set("q", v.q);
  if (v.origin) qs.set("origin", v.origin);
  if (v.status) qs.set("status", v.status);
  if (v.active) qs.set("active", v.active);
  if (v.sort !== "updated") qs.set("sort", v.sort);
  if (v.dir !== "desc") qs.set("dir", v.dir);
  if (v.page !== 1) qs.set("page", String(v.page));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const ORIGIN_LABEL: Record<SiteRedirectOrigin, string> = {
  MANUAL: "Manual",
  SLUG_CHANGE: "Slug change",
  IMPORT: "Import",
};

export const SORT_LABEL: Record<RedirectListParams["sort"], string> = {
  updated: "Last changed",
  created: "Created",
  source: "Source address",
  target: "Target address",
};

/** The admin page of the content a slug-change redirect belongs to. */
export function redirectContentHref(item: SeoRedirectItem, siteParam = "bv"): string | null {
  if (!item.content) return null;
  return item.content.type === "CMS_PAGE"
    ? `/content/${item.content.id}#seo`
    : `/products/${item.content.id}?site=${siteParam}&tab=seo`;
}

const RULES: Readonly<Record<string, string>> = {
  "source:required": "Enter the old address.",
  "source:format":
    "Use an address of this site (/old-page, /news/old-article, /products/old-product) or of the old site (/en/about-us, /tr/products/x, /en/contact-us.html): letters, digits, hyphens, dots or underscores, at most 6 parts; a query such as ?id=5 is allowed.",
  "source:reserved":
    "This address belongs to the site itself (home, products, news, privacy, a language code other than the old site's /en and /tr, an app address or a site file).",
  "source:fragment": "Leave out the # part: browsers never send it to the site.",
  "source:query_format": "The query cannot be stored. Use plain name=value pairs.",
  "source:too_long": "The old address is too long.",
  "source:live_content":
    "A published page, article or product is live at this address. Unpublish or move it first: live content always wins.",
  "source:duplicate": "A redirect for this address (and query) already exists. Edit that one.",
  "source:duplicate_in_file": "This address appears more than once in the file.",
  "source:chain":
    "Another redirect leads to this address. Point that one at the final target instead (no redirect chains).",
  "target:required": "Enter the new address.",
  "target:format":
    "Use a path of this site, such as /about-us or /products?category=base-oil (lower-case words and hyphens, up to three levels).",
  "target:external": "Redirects stay on this site. Enter a path such as /about-us, not a URL.",
  "target:reserved": "This address is internal to the site and cannot be a target.",
  "target:fragment": "Leave out the # part.",
  "target:query_format": "The query cannot be stored. Use plain name=value pairs.",
  "target:too_long": "The new address is too long.",
  "target:self": "The old and the new address are the same: that would be a loop.",
  "target:chain":
    "The new address redirects itself. Enter its final address instead (no redirect chains or loops).",
  "status:format": "Status must be 301 or 302.",
  "active:format": "Active must be true or false.",
  "note:format": "The note is too long or contains control characters.",
  "redirect:protected":
    "This redirect was created when the content moved (slug change). It keeps the old address for search engines; only its note can be changed.",
  "version:stale": "Someone else changed this redirect meanwhile. Reload to see their version.",
  "import:has_errors": "Fix the rows with errors and check the file again.",
  "import:changed":
    "The redirects changed since the check. Check the file again and confirm the new result.",
  "csv:empty": "The file has no redirects.",
  "csv:header":
    "The first line must name the columns: source, target and optionally status, active, note.",
  "csv:quote": "A quoted value is not closed.",
  "csv:too_large": `The file is too large (at most ${SEO_REDIRECT_CSV_MAX_BYTES / 1024} KB).`,
  "csv:too_many_rows": `At most ${SEO_REDIRECT_CSV_MAX_ROWS} redirects per file.`,
  "csv:columns": "A line has more values than the header.",
  "site:no_redirects": "This site does not use redirects.",
};

export const WARNINGS: Readonly<Record<string, string>> = {
  "target:not_live":
    "The new address has no live content right now: visitors would land on a 404 until it is published.",
  "source:draft_content":
    "A draft page or product uses the old address. When it is published there, this redirect is switched off.",
};

/** A readable text for one `field:rule` code (CSV path "csv.<line>" counts as "csv"). */
export function ruleMessage(code: string): string {
  const [field = "", rule = ""] = code.split(":");
  const key = `${field.startsWith("csv.") ? "csv" : field}:${rule}`;
  return RULES[key] ?? `Check ${field || "the value"} (${rule || "invalid"}).`;
}

export function knownRule(code: string): boolean {
  const [field = "", rule = ""] = code.split(":");
  return `${field.startsWith("csv.") ? "csv" : field}:${rule}` in RULES;
}

export const IMPORT_ACTION_LABEL: Record<string, string> = {
  create: "New",
  update: "Update",
  unchanged: "Unchanged",
  error: "Error",
};

/** The dry-run as a CSV report (row, action, values, problems) for download. */
export function importReportCsv(result: SeoRedirectImportResponse): string {
  const lines = [
    ["line", "result", "source", "target", "status", "active", "note", "errors", "warnings"],
  ];
  for (const r of result.rows) {
    lines.push([
      String(r.line),
      IMPORT_ACTION_LABEL[r.action] ?? r.action,
      r.source,
      r.target,
      r.statusCode === null ? "" : String(r.statusCode),
      r.active === null ? "" : String(r.active),
      r.note ?? "",
      r.errors.map(ruleMessage).join(" | "),
      r.warnings.map((w) => WARNINGS[w] ?? w).join(" | "),
    ]);
  }
  return `${lines.map((l) => l.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const HISTORY_ACTION: Readonly<Record<string, string>> = {
  "seo.redirect_created": "Created",
  "seo.redirect_updated": "Changed",
  "seo.redirect_deleted": "Deleted",
  "seo.redirect_retargeted": "Target followed the content",
  "seo.redirect_retired": "Switched off (content live again)",
};

export function historyActionLabel(action: string, details: Record<string, unknown>): string {
  const base = HISTORY_ACTION[action] ?? action;
  return details["via"] === "import" ? `${base} (import)` : base;
}

/** A short description of what an audit event recorded. */
export function historySummary(details: Record<string, unknown>): string {
  const parts: string[] = [];
  const str = (k: string) => (typeof details[k] === "string" ? (details[k] as string) : null);
  const source = str("sourcePath");
  const query = str("sourceQuery");
  const target = str("target");
  if (source) parts.push(`${source}${query ? `?${query}` : ""}`);
  if (target) parts.push(`→ ${target}`);
  if (typeof details["statusCode"] === "number") parts.push(String(details["statusCode"]));
  if (typeof details["active"] === "boolean") parts.push(details["active"] ? "active" : "inactive");
  if (Array.isArray(details["changed"]) && details["changed"].length) {
    parts.push(`changed: ${(details["changed"] as unknown[]).join(", ")}`);
  }
  const prev = str("previousTarget");
  if (prev) parts.push(`(was ${prev})`);
  return parts.join(" · ");
}
