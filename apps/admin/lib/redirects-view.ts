/**
 * DP-211: view helpers of Admin > SEO > Redirects (pure, shared by the server page and the client
 * components): list parameters, labels, readable messages for the API's `field:rule` codes and
 * the downloadable CSV report of a dry-run.
 *
 * ML-12d (DP-243): labels and messages in the UI language (`t`), looked up by the API's own codes
 * (origins, sorts, `field:rule`, warnings, audit actions), which are unchanged. The dry-run report
 * CSV stays English in every UI language: its columns, BOM, order and texts are byte-identical to
 * before (a file, not the screen).
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
import { en } from "./i18n/messages/en";
import { createTranslator } from "./i18n/translate";
import type { Translate } from "./i18n/types";

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

export function originLabel(origin: SiteRedirectOrigin, t: Translate): string {
  return t(`seo.redirects.origin.${origin}`);
}

export function sortLabel(sort: RedirectListParams["sort"], t: Translate): string {
  return t(`seo.redirects.sort.${sort}`);
}

/** The admin page of the content a slug-change redirect belongs to. */
export function redirectContentHref(item: SeoRedirectItem, siteParam = "bv"): string | null {
  if (!item.content) return null;
  return item.content.type === "CMS_PAGE"
    ? `/content/${item.content.id}#seo`
    : `/products/${item.content.id}?site=${siteParam}&tab=seo`;
}

type RuleKey = Exclude<
  keyof typeof en.seo.redirects.rules,
  "unknown" | "unknownField" | "unknownRule"
>;

/** `field:rule` codes of the API → their message (`seo.redirects.rules.<key>`). */
const RULES: Readonly<Record<string, RuleKey>> = {
  "source:required": "sourceRequired",
  "source:format": "sourceFormat",
  "source:reserved": "sourceReserved",
  "source:fragment": "sourceFragment",
  "source:query_format": "queryFormat",
  "source:too_long": "sourceTooLong",
  "source:live_content": "sourceLiveContent",
  "source:duplicate": "sourceDuplicate",
  "source:duplicate_in_file": "sourceDuplicateInFile",
  "source:chain": "sourceChain",
  "target:required": "targetRequired",
  "target:format": "targetFormat",
  "target:external": "targetExternal",
  "target:reserved": "targetReserved",
  "target:fragment": "targetFragment",
  "target:query_format": "queryFormat",
  "target:too_long": "targetTooLong",
  "target:self": "targetSelf",
  "target:chain": "targetChain",
  "status:format": "statusFormat",
  "active:format": "activeFormat",
  "note:format": "noteFormat",
  "redirect:protected": "protected",
  "version:stale": "versionStale",
  "import:has_errors": "importHasErrors",
  "import:changed": "importChanged",
  "csv:empty": "csvEmpty",
  "csv:header": "csvHeader",
  "csv:quote": "csvQuote",
  "csv:too_large": "csvTooLarge",
  "csv:too_many_rows": "csvTooManyRows",
  "csv:columns": "csvColumns",
  "site:no_redirects": "siteNoRedirects",
};

/** Warning codes of a saved redirect or an import row → `seo.redirects.warnings.<key>`. */
const WARNING_KEYS: Readonly<Record<string, keyof typeof en.seo.redirects.warnings>> = {
  "target:not_live": "targetNotLive",
  "source:draft_content": "sourceDraftContent",
};

/** A readable text for one warning code; an unknown code is shown as it is. */
export function warningMessage(code: string, t: Translate): string {
  const key = WARNING_KEYS[code];
  return key ? t(`seo.redirects.warnings.${key}`) : code;
}

const ruleKey = (code: string) => {
  const [field = "", rule = ""] = code.split(":");
  return { field, rule, key: `${field.startsWith("csv.") ? "csv" : field}:${rule}` };
};

/** A readable text for one `field:rule` code (CSV path "csv.<line>" counts as "csv"). */
export function ruleMessage(code: string, t: Translate): string {
  const { field, rule, key } = ruleKey(code);
  const known = RULES[key];
  if (known === "csvTooLarge")
    return t("seo.redirects.rules.csvTooLarge", { kb: SEO_REDIRECT_CSV_MAX_BYTES / 1024 });
  if (known === "csvTooManyRows")
    return t("seo.redirects.rules.csvTooManyRows", { rows: SEO_REDIRECT_CSV_MAX_ROWS });
  if (known) return t(`seo.redirects.rules.${known}`);
  return t("seo.redirects.rules.unknown", {
    field: field || t("seo.redirects.rules.unknownField"),
    rule: rule || t("seo.redirects.rules.unknownRule"),
  });
}

export function knownRule(code: string): boolean {
  return ruleKey(code).key in RULES;
}

export function importActionLabel(action: string, t: Translate): string {
  return action === "create" || action === "update" || action === "unchanged" || action === "error"
    ? t(`seo.redirects.action.${action}`)
    : action;
}

/** The report is a file: English in every UI language (byte-identical to before ML-12d). */
const REPORT_T = createTranslator("en");

/** The dry-run as a CSV report (row, action, values, problems) for download. */
export function importReportCsv(result: SeoRedirectImportResponse): string {
  const lines = [
    ["line", "result", "source", "target", "status", "active", "note", "errors", "warnings"],
  ];
  for (const r of result.rows) {
    lines.push([
      String(r.line),
      importActionLabel(r.action, REPORT_T),
      r.source,
      r.target,
      r.statusCode === null ? "" : String(r.statusCode),
      r.active === null ? "" : String(r.active),
      r.note ?? "",
      r.errors.map((e) => ruleMessage(e, REPORT_T)).join(" | "),
      r.warnings.map((w) => warningMessage(w, REPORT_T)).join(" | "),
    ]);
  }
  return `${lines.map((l) => l.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const HISTORY_ACTION: Readonly<
  Record<string, "created" | "updated" | "deleted" | "retargeted" | "retired">
> = {
  "seo.redirect_created": "created",
  "seo.redirect_updated": "updated",
  "seo.redirect_deleted": "deleted",
  "seo.redirect_retargeted": "retargeted",
  "seo.redirect_retired": "retired",
};

export function historyActionLabel(
  action: string,
  details: Record<string, unknown>,
  t: Translate,
): string {
  const key = HISTORY_ACTION[action];
  const base = key ? t(`seo.redirects.history.${key}`) : action;
  return details["via"] === "import"
    ? t("seo.redirects.history.viaImport", { action: base })
    : base;
}

/** A short description of what an audit event recorded (paths, codes and field keys as stored). */
export function historySummary(details: Record<string, unknown>, t: Translate): string {
  const parts: string[] = [];
  const str = (k: string) => (typeof details[k] === "string" ? (details[k] as string) : null);
  const source = str("sourcePath");
  const query = str("sourceQuery");
  const target = str("target");
  if (source) parts.push(`${source}${query ? `?${query}` : ""}`);
  if (target) parts.push(`→ ${target}`);
  if (typeof details["statusCode"] === "number") parts.push(String(details["statusCode"]));
  if (typeof details["active"] === "boolean")
    parts.push(
      t(details["active"] ? "seo.redirects.history.active" : "seo.redirects.history.inactive"),
    );
  if (Array.isArray(details["changed"]) && details["changed"].length) {
    parts.push(
      t("seo.redirects.history.changed", {
        fields: (details["changed"] as unknown[]).join(", "),
      }),
    );
  }
  const prev = str("previousTarget");
  if (prev) parts.push(t("seo.redirects.history.was", { target: prev }));
  return parts.join(" · ");
}
