/**
 * DP-211: redirect management of the BV site (Admin > SEO > Redirects), on the DP-210 table
 * `SiteRedirect` (no new table). The admin and the API share these contracts and the address
 * rules below, so a form, a CSV row and the API refuse the same things with the same rule names.
 *
 * Routes (admin proxy key; `content:read` or `product:read` of the site reads, `content:publish`
 * of the site changes: a manual redirect takes effect at once, without a second approval, so it
 * needs the right to change the live site; history additionally needs `audit:read`):
 *
 *  - `GET  /api/v1/admin/seo/sites/:siteId/redirects?q=&origin=&status=&active=&sort=&dir=&page=`
 *  - `POST /api/v1/admin/seo/sites/:siteId/redirects`                 create (MANUAL)
 *  - `POST /api/v1/admin/seo/sites/:siteId/redirects/:id`             update (version)
 *  - `POST /api/v1/admin/seo/sites/:siteId/redirects/:id/delete`      delete (version)
 *  - `GET  /api/v1/admin/seo/sites/:siteId/redirects/:id/history`     audit events of the row
 *  - `POST /api/v1/admin/seo/sites/:siteId/redirects/import`          CSV dry-run / import
 *
 * Rules (ADR-024 D9):
 *  - Source: an address the BV site can answer (`/<slug>`, `/news/<slug>`, `/products/<slug>`,
 *    lower case), never a reserved app address, never an address with live content, once per
 *    site (with its optional query). Legacy formats (upper case, `.html`, deeper paths) are DP-212.
 *  - Target: a path of the same site (optionally with a query); never another host, never an app
 *    internal, never the source itself. No chain: a target is never another active redirect's
 *    source, a source never another active redirect's target (the database trigger
 *    `SiteRedirect_no_chain` enforces the same for every writer), so there is no loop either.
 *  - SLUG_CHANGE rows (DP-210) are shown with their content but are protected: only their note
 *    may change; they end when the content returns to the address (DP-210 rule 1).
 *  - A query-bound source (`/old?id=5`) applies only with exactly that query (parameters in any
 *    order) and sends the target as is; a plain source keeps the request's query when the target
 *    has none (DP-210 behaviour).
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";
import { CMS_RESERVED_SLUGS } from "./cms.js";
import { SITE_REDIRECT_ORIGINS } from "../seo.js";

const IsoDate = z.iso.datetime({ offset: true });
const VersionSchema = z.number().int().min(1);

export const SEO_REDIRECT_STATUS_CODES = [301, 302] as const;
export type SeoRedirectStatusCode = (typeof SEO_REDIRECT_STATUS_CODES)[number];

/** Database column limits (SiteRedirect). */
export const SEO_REDIRECT_LIMITS = {
  sourcePath: 300,
  sourceQuery: 300,
  target: 500,
  note: 500,
} as const;

// --- address rules ------------------------------------------------------------------------------

const SEGMENT = "[a-z0-9]+(?:-[a-z0-9]+)*";
/** The sources the BV proxy answers (DP-207 matcher): `/<slug>`, `/news/<slug>`, `/products/<slug>`. */
const SOURCE_PATH = new RegExp(`^/(?:(?:news|products)/${SEGMENT}|${SEGMENT})$`);
/** A target path of the site: `/` or one to three lower-case kebab-case segments. */
const TARGET_PATH = new RegExp(`^/(?:${SEGMENT}(?:/${SEGMENT}){0,2})?$`);
/** The characters a stored query may hold (DB CHECK `SiteRedirect_source_query`). */
const QUERY_CHARS = /^[A-Za-z0-9._~%=&+-]+$/;

/** First segments a redirect target may never name (app internals, forms, previews, files). */
export const SEO_REDIRECT_BLOCKED_TARGET_SEGMENTS: readonly string[] = [
  "_next",
  "__dp",
  "api",
  "lead-form",
  "preview",
  "product-documents",
  "product-images",
];

export type RedirectRule =
  "required" | "format" | "reserved" | "fragment" | "query_format" | "external" | "too_long";

export type RedirectParse<T> = { ok: true; value: T } | { ok: false; rule: RedirectRule };

const encodeQueryPart = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * A query string in its stored form: parameters sorted by name then value, empty names dropped,
 * percent-encoded with the characters the database accepts. "" for no parameters. The same
 * function normalises a request's query on the public site, so parameter order never matters.
 */
export function normalizeRedirectQuery(raw: string): RedirectParse<string> {
  const text = raw.startsWith("?") ? raw.slice(1) : raw;
  if (text === "") return { ok: true, value: "" };
  // Parsed by hand (no URLSearchParams: the contracts run without DOM or Node types): "+" is a
  // space, as in a browser's form encoding; an undecodable "%" is refused.
  const pairs: [string, string][] = [];
  for (const part of text.split("&")) {
    if (part === "") continue;
    const i = part.indexOf("=");
    const decode = (v: string) => decodeURIComponent(v.replace(/\+/g, " "));
    try {
      pairs.push(
        i < 0 ? [decode(part), ""] : [decode(part.slice(0, i)), decode(part.slice(i + 1))],
      );
    } catch {
      return { ok: false, rule: "query_format" };
    }
  }
  const sorted = pairs
    .filter(([k]) => k !== "")
    .sort(([ak, av], [bk, bv]) =>
      ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1,
    );
  const value = sorted.map(([k, v]) => `${encodeQueryPart(k)}=${encodeQueryPart(v)}`).join("&");
  if (value === "") return { ok: true, value: "" };
  if (!QUERY_CHARS.test(value)) return { ok: false, rule: "query_format" };
  if (value.length > SEO_REDIRECT_LIMITS.sourceQuery) return { ok: false, rule: "too_long" };
  return { ok: true, value };
}

/** Splits "/a?b=1" into path and query; a fragment or whitespace is refused. */
function splitAddress(raw: string): RedirectParse<{ path: string; query: string }> {
  if (raw.includes("#")) return { ok: false, rule: "fragment" };
  if (/\s/.test(raw)) return { ok: false, rule: "format" };
  const i = raw.indexOf("?");
  let path = i < 0 ? raw : raw.slice(0, i);
  const query = i < 0 ? "" : raw.slice(i + 1);
  // "/old-page/" is the same address as "/old-page".
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return { ok: true, value: { path, query } };
}

export interface RedirectSource {
  sourcePath: string;
  sourceQuery: string;
}

/**
 * A redirect source from what an editor typed: a path of the BV site, optionally with a query.
 * A full URL is accepted and reduced to its path and query (the source is always on this site).
 */
export function parseRedirectSource(input: string): RedirectParse<RedirectSource> {
  let raw = input.trim();
  if (raw === "") return { ok: false, rule: "required" };
  // A full URL of the site: keep its path and query (the host is this site by definition).
  const absolute = /^https?:\/\/[^/?#\s]+(.*)$/i.exec(raw);
  if (absolute) raw = absolute[1] || "/";
  const split = splitAddress(raw);
  if (!split.ok) return split;
  const { path, query } = split.value;
  if (path.length > SEO_REDIRECT_LIMITS.sourcePath) return { ok: false, rule: "too_long" };
  if (!SOURCE_PATH.test(path)) {
    // "/", "/news", "/products" and app addresses are the site's own; tell them from typos.
    const first = path.split("/")[1] ?? "";
    if (path === "/" || path === "/news" || path === "/products")
      return { ok: false, rule: "reserved" };
    if (first === "_next" || first === "__dp" || first === "api")
      return { ok: false, rule: "reserved" };
    return { ok: false, rule: "format" };
  }
  const segments = path.split("/").slice(1);
  if (segments.length === 1) {
    const slug = segments[0]!;
    if (CMS_RESERVED_SLUGS.includes(slug) || /^[a-z]{2}$/.test(slug)) {
      return { ok: false, rule: "reserved" };
    }
  }
  const q = normalizeRedirectQuery(query);
  if (!q.ok) return q;
  return { ok: true, value: { sourcePath: path, sourceQuery: q.value } };
}

/**
 * A redirect target from what an editor typed: a path of the same site, optionally with a query.
 * Another host (absolute or protocol-relative URL) is refused, and so is an app internal.
 */
export function parseRedirectTarget(input: string): RedirectParse<string> {
  const raw = input.trim();
  if (raw === "") return { ok: false, rule: "required" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//") || raw.startsWith("\\")) {
    return { ok: false, rule: "external" };
  }
  const split = splitAddress(raw);
  if (!split.ok) return split;
  const { path, query } = split.value;
  if (!path.startsWith("/")) return { ok: false, rule: "format" };
  const first = path.split("/")[1] ?? "";
  if (SEO_REDIRECT_BLOCKED_TARGET_SEGMENTS.includes(first)) return { ok: false, rule: "reserved" };
  if (!TARGET_PATH.test(path)) return { ok: false, rule: "format" };
  const q = normalizeRedirectQuery(query);
  if (!q.ok) return q;
  const value = q.value ? `${path}?${q.value}` : path;
  if (value.length > SEO_REDIRECT_LIMITS.target) return { ok: false, rule: "too_long" };
  return { ok: true, value };
}

/** How a source is shown: its path, with "?query" when it is bound to one. */
export function redirectSourceLabel(r: RedirectSource): string {
  return r.sourceQuery ? `${r.sourcePath}?${r.sourceQuery}` : r.sourcePath;
}

/** The path part of a stored target ("/a?b=1" -> "/a"). */
export function redirectTargetPath(target: string): string {
  return target.split("?", 1)[0] ?? target;
}

// --- list and rows ------------------------------------------------------------------------------

export const SEO_REDIRECT_SORTS = ["updated", "created", "source", "target"] as const;
export type SeoRedirectSort = (typeof SEO_REDIRECT_SORTS)[number];
export const SEO_REDIRECT_PAGE_SIZE = 50;

export const SeoRedirectListQuerySchema = z.strictObject({
  q: z.string().trim().max(200).optional().default(""),
  origin: z.enum(SITE_REDIRECT_ORIGINS).optional(),
  status: z.enum(["301", "302"]).optional(),
  active: z.enum(["true", "false"]).optional(),
  sort: z.enum(SEO_REDIRECT_SORTS).optional().default("updated"),
  dir: z.enum(["asc", "desc"]).optional().default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
});
export type SeoRedirectListQuery = z.input<typeof SeoRedirectListQuerySchema>;

/** The content a SLUG_CHANGE redirect belongs to (the page, article or product that moved). */
export const SeoRedirectContentSchema = z.strictObject({
  type: z.enum(["CMS_PAGE", "PRODUCT"]),
  id: UuidSchema,
  /** null when the content no longer exists or the caller may not read it. */
  name: z.string().nullable(),
  /** Its live address now (the redirect's target follows it), null when not live. */
  livePath: z.string().nullable(),
});
export type SeoRedirectContent = z.infer<typeof SeoRedirectContentSchema>;

export const SeoRedirectItemSchema = z.strictObject({
  id: UuidSchema,
  sourcePath: z.string(),
  sourceQuery: z.string(),
  target: z.string(),
  statusCode: z.union([z.literal(301), z.literal(302)]),
  active: z.boolean(),
  origin: z.enum(SITE_REDIRECT_ORIGINS),
  note: z.string().nullable(),
  version: z.number().int(),
  /** SLUG_CHANGE: protected (only the note may change; never deleted here). */
  protected: z.boolean(),
  content: SeoRedirectContentSchema.nullable(),
  createdBy: z.string().nullable(),
  updatedBy: z.string().nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type SeoRedirectItem = z.infer<typeof SeoRedirectItemSchema>;

export const SeoRedirectPermissionsSchema = z.strictObject({
  /** content:publish of the site: create, edit, delete and import. */
  manage: z.boolean(),
  /** audit:read of the site: the change history of a redirect. */
  history: z.boolean(),
});

export const SeoRedirectListResponseSchema = z.strictObject({
  site: z.strictObject({ id: UuidSchema, key: z.enum(["BV", "CORPORATE"]), name: z.string() }),
  permissions: SeoRedirectPermissionsSchema,
  items: z.array(SeoRedirectItemSchema).max(SEO_REDIRECT_PAGE_SIZE),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int(),
  /** Rows per origin and active state, for the filter chips (whole site, not the page). */
  counts: z.strictObject({
    all: z.number().int(),
    MANUAL: z.number().int(),
    SLUG_CHANGE: z.number().int(),
    IMPORT: z.number().int(),
    inactive: z.number().int(),
  }),
});
export type SeoRedirectListResponse = z.infer<typeof SeoRedirectListResponseSchema>;

// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const NoteSchema = z
  .string()
  .trim()
  .max(SEO_REDIRECT_LIMITS.note)
  .refine((v) => !CONTROL.test(v), { message: "control_characters" })
  .nullish()
  .transform((v) => (v ? v : null));

/** Source and target as typed (the API parses them with the rules above). */
export const SeoRedirectInputSchema = z.strictObject({
  source: z.string().max(1000),
  target: z.string().max(1000),
  statusCode: z.union([z.literal(301), z.literal(302)]),
  active: z.boolean(),
  note: NoteSchema,
});
export type SeoRedirectInput = z.input<typeof SeoRedirectInputSchema>;

export const SeoRedirectCreateRequestSchema = SeoRedirectInputSchema;
export type SeoRedirectCreateRequest = z.input<typeof SeoRedirectCreateRequestSchema>;

/** An update names the version it was based on (409 `version:stale` when another save won). */
export const SeoRedirectUpdateRequestSchema = SeoRedirectInputSchema.extend({
  version: VersionSchema,
});
export type SeoRedirectUpdateRequest = z.input<typeof SeoRedirectUpdateRequestSchema>;

export const SeoRedirectDeleteRequestSchema = z.strictObject({ version: VersionSchema });

/** Advice that never blocks a save (the editor sees it after saving or in the dry-run). */
export const SEO_REDIRECT_WARNINGS = ["target:not_live", "source:draft_content"] as const;
export type SeoRedirectWarning = (typeof SEO_REDIRECT_WARNINGS)[number];

export const SeoRedirectResponseSchema = z.strictObject({
  redirect: SeoRedirectItemSchema,
  warnings: z.array(z.enum(SEO_REDIRECT_WARNINGS)),
});
export type SeoRedirectResponse = z.infer<typeof SeoRedirectResponseSchema>;

export const SeoRedirectDeleteResponseSchema = z.strictObject({ deleted: z.literal(true) });

export const SeoRedirectHistoryEventSchema = z.strictObject({
  id: UuidSchema,
  occurredAt: IsoDate,
  action: z.string(),
  actor: z.string().nullable(),
  /** The values the event recorded (paths, status, active, origin, note length, reason). */
  details: z.record(z.string(), z.unknown()),
});
export const SeoRedirectHistoryResponseSchema = z.strictObject({
  events: z.array(SeoRedirectHistoryEventSchema).max(200),
});
export type SeoRedirectHistoryResponse = z.infer<typeof SeoRedirectHistoryResponseSchema>;

// --- CSV import ---------------------------------------------------------------------------------

/** Kept under the 16 KiB request limit of the admin proxy and the API (JSON-escaped). */
export const SEO_REDIRECT_CSV_MAX_BYTES = 12 * 1024;
export const SEO_REDIRECT_CSV_MAX_ROWS = 200;
export const SEO_REDIRECT_CSV_COLUMNS = ["source", "target", "status", "active", "note"] as const;

export const SEO_REDIRECT_CSV_SAMPLE = [
  "source,target,status,active,note",
  "/old-about,/about-us,301,true,Old company page",
  "/products/old-base-oil,/products?category=base-oil,301,true,",
  "/news/spring-campaign,/news,302,true,Campaign ended",
  "/offer?ref=mail,/contact,302,false,Mail campaign (not active yet)",
  "",
].join("\n");

export interface RedirectCsvRow {
  /** 1-based line of the file (the header is line 1). */
  line: number;
  source: string;
  target: string;
  status: string;
  active: string;
  note: string;
}

export type RedirectCsvParse =
  | { ok: true; rows: RedirectCsvRow[] }
  | {
      ok: false;
      rule: "empty" | "header" | "quote" | "too_large" | "too_many_rows" | "columns";
      line?: number;
    };

/**
 * Parses the redirect CSV (RFC 4180: comma or semicolon separator, double quotes, CRLF or LF, an
 * optional BOM). The header names the columns in any order; `source` and `target` are required,
 * `status` (301), `active` (true) and `note` are optional. Blank lines are skipped.
 */
/** UTF-8 size of a string (no TextEncoder: the contracts run without DOM or Node types). */
function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

export function parseRedirectCsv(text: string): RedirectCsvParse {
  if (utf8Length(text) > SEO_REDIRECT_CSV_MAX_BYTES) {
    return { ok: false, rule: "too_large" };
  }
  const body = text.replace(/^\uFEFF/, "");
  if (body.trim() === "") return { ok: false, rule: "empty" };
  const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
  const sep = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === "\n") line++;
        cell += c;
      }
      continue;
    }
    if (c === '"') {
      if (cell.trim() !== "") return { ok: false, rule: "quote", line };
      cell = "";
      quoted = true;
    } else if (c === sep) {
      cells.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && body[i + 1] === "\n") i++;
      cells.push(cell);
      records.push({ line: startLine, cells });
      cells = [];
      cell = "";
      line++;
      startLine = line;
    } else {
      cell += c;
    }
  }
  if (quoted) return { ok: false, rule: "quote", line: startLine };
  if (cell !== "" || cells.length) {
    cells.push(cell);
    records.push({ line: startLine, cells });
  }
  const nonBlank = records.filter((r) => r.cells.some((c) => c.trim() !== ""));
  const header = nonBlank.shift();
  if (!header) return { ok: false, rule: "empty" };
  const names = header.cells.map((c) => c.trim().toLowerCase());
  const index = (n: string) => names.indexOf(n);
  if (
    index("source") < 0 ||
    index("target") < 0 ||
    names.some((n) => !(SEO_REDIRECT_CSV_COLUMNS as readonly string[]).includes(n)) ||
    new Set(names).size !== names.length
  ) {
    return { ok: false, rule: "header", line: header.line };
  }
  if (nonBlank.length === 0) return { ok: false, rule: "empty" };
  if (nonBlank.length > SEO_REDIRECT_CSV_MAX_ROWS) return { ok: false, rule: "too_many_rows" };
  const rows: RedirectCsvRow[] = [];
  for (const r of nonBlank) {
    if (r.cells.length > names.length) return { ok: false, rule: "columns", line: r.line };
    const get = (n: string) => (index(n) >= 0 ? (r.cells[index(n)] ?? "").trim() : "");
    rows.push({
      line: r.line,
      source: get("source"),
      target: get("target"),
      status: get("status"),
      active: get("active"),
      note: get("note"),
    });
  }
  return { ok: true, rows };
}

/** "301"/"302" (empty: 301); null when invalid. */
export function parseCsvStatus(v: string): SeoRedirectStatusCode | null {
  const t = v.trim();
  if (t === "") return 301;
  return t === "301" ? 301 : t === "302" ? 302 : null;
}

/** true/false, yes/no, 1/0, active/inactive (empty: true); null when invalid. */
export function parseCsvActive(v: string): boolean | null {
  const t = v.trim().toLowerCase();
  if (t === "" || ["true", "yes", "1", "active"].includes(t)) return true;
  if (["false", "no", "0", "inactive"].includes(t)) return false;
  return null;
}

/**
 * One CSV cell of a downloaded report: quoted when needed, and a value that a spreadsheet would
 * run as a formula (=, +, -, @, tab, CR) is prefixed with an apostrophe (CSV injection).
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const SEO_REDIRECT_IMPORT_ACTIONS = ["create", "update", "unchanged", "error"] as const;
export type SeoRedirectImportAction = (typeof SEO_REDIRECT_IMPORT_ACTIONS)[number];

export const SeoRedirectImportRequestSchema = z.strictObject({
  csv: z.string().max(SEO_REDIRECT_CSV_MAX_BYTES),
  /** true: validate and report only, nothing is written. */
  dryRun: z.boolean(),
  /** Import only: the `planHash` of the dry-run the editor confirmed (409 when it changed). */
  planHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
export type SeoRedirectImportRequest = z.input<typeof SeoRedirectImportRequestSchema>;

export const SeoRedirectImportRowSchema = z.strictObject({
  line: z.number().int(),
  source: z.string(),
  target: z.string(),
  statusCode: z.union([z.literal(301), z.literal(302)]).nullable(),
  active: z.boolean().nullable(),
  note: z.string().nullable(),
  action: z.enum(SEO_REDIRECT_IMPORT_ACTIONS),
  /** `field:rule` codes (the same rules as the form). */
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type SeoRedirectImportRow = z.infer<typeof SeoRedirectImportRowSchema>;

export const SeoRedirectImportResponseSchema = z.strictObject({
  dryRun: z.boolean(),
  /** Whether rows were written (import without errors). */
  applied: z.boolean(),
  /** Identifies this plan; the import must send it back unchanged. */
  planHash: z.string(),
  summary: z.strictObject({
    rows: z.number().int(),
    create: z.number().int(),
    update: z.number().int(),
    unchanged: z.number().int(),
    error: z.number().int(),
  }),
  rows: z.array(SeoRedirectImportRowSchema).max(SEO_REDIRECT_CSV_MAX_ROWS),
});
export type SeoRedirectImportResponse = z.infer<typeof SeoRedirectImportResponseSchema>;
