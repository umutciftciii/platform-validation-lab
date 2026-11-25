/**
 * ML-13b (DP-244): the admin side of the translation packages of ML-13a (contracts
 * `admin/translation-packages.ts`). Pure helpers, safe for server and client components:
 *
 *  - reading a package file the user picked (size, JSON, format, version, schema) before anything
 *    is sent: the API checks it again and decides (hashes, permissions, every unit);
 *  - joining a dry-run or import report with the package's units into table rows, with the
 *    status groups the screen filters by;
 *  - the readable reason of a skipped unit (the API's `rule`), unknown rules shown as their code;
 *  - the extension point for translation assistants (`TranslationAssist`): none is registered.
 *
 * Nothing here writes or publishes. The import writes drafts only (API); the target language's
 * `public` switch is never touched by it.
 */
import {
  TRANSLATION_PACKAGE_FORMAT,
  TRANSLATION_PACKAGE_MAX_BODY_BYTES,
  TRANSLATION_PACKAGE_VERSION,
  TranslationPackageSchema,
  parseTranslationUnitKey,
  type TranslationImportReport,
  type TranslationPackage,
  type TranslationPackageType,
  type TranslationUnit,
  type TranslationUnitKind,
  type TranslationUnitStatus,
} from "@dream/contracts";
import type { PlainKey, Translate } from "./i18n/types";

export const TRANSLATIONS_PATH = "/translations";

// --- the sites the screen offers --------------------------------------------------------------

/** One language a package can be exported for (an enabled language other than the default). */
export interface TranslationTarget {
  locale: string;
  /** Shown to visitors (BV "nl": false until the Dutch content is complete). */
  public: boolean;
}

/** A site with what the signed-in user may read and write there (from the context routes). */
export interface TranslationSite {
  id: string;
  key: "BV" | "CORPORATE";
  name: string;
  /** The site's default language: the source of every package. */
  sourceLocale: string;
  targets: TranslationTarget[];
  /**
   * content:read / product:read of the site: which parts may be exported and checked. Whether
   * the user may import is the dry run's answer (`canImport`, `missingPermissions`).
   */
  read: Record<TranslationPackageType, boolean>;
}

/** The parts the user may export from this site, in the contract's order. */
export function readableTypes(site: TranslationSite): TranslationPackageType[] {
  return (["cms", "catalog"] as const).filter((t) => site.read[t]);
}

/** `GET …/export` with the contract's query (siteId, locale, types). */
export function exportQuery(
  siteId: string,
  locale: string,
  types: readonly TranslationPackageType[],
): string {
  const q = new URLSearchParams({ siteId, locale, types: types.join(",") });
  return `?${q.toString()}`;
}

/** The download name of an exported package, e.g. `translation-bv-en-nl-cms-catalog-20261125.json`. */
export function packageFileName(pkg: TranslationPackage): string {
  const day = pkg.exportedAt.slice(0, 10).replaceAll("-", "");
  return `translation-${pkg.site.key.toLowerCase()}-${pkg.sourceLocale}-${pkg.targetLocale}-${pkg.types.join("-")}-${day}.json`;
}

// --- reading a package file -------------------------------------------------------------------

export type PackageFileProblem =
  "empty" | "too_large" | "not_json" | "not_package" | "version" | "schema";

export type PackageFileRead =
  | { ok: true; pkg: TranslationPackage; bodyBytes: number }
  | { ok: false; problem: PackageFileProblem; paths: string[] };

/** The request body the dry run and the import send: `{ "package": … }`. */
export function requestBody(pkg: TranslationPackage): string {
  return JSON.stringify({ package: pkg });
}

const utf8Length = (text: string) => new TextEncoder().encode(text).byteLength;

/**
 * Checks a picked file before it is sent. `fileBytes` is the file's size: a file far above the
 * limit is refused before it is read. The request body (the package re-serialised, wrapped in
 * `{ "package": … }`) must fit the API's and the proxy's 4 MB limit. A byte order mark (some
 * editors add one) is ignored.
 */
export function readPackageFile(text: string, fileBytes = utf8Length(text)): PackageFileRead {
  if (fileBytes > TRANSLATION_PACKAGE_MAX_BODY_BYTES) {
    return { ok: false, problem: "too_large", paths: [] };
  }
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) return { ok: false, problem: "empty", paths: [] };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { ok: false, problem: "not_json", paths: [] };
  }
  const head = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!head || (head as { format?: unknown }).format !== TRANSLATION_PACKAGE_FORMAT) {
    return { ok: false, problem: "not_package", paths: [] };
  }
  if ((head as { version?: unknown }).version !== TRANSLATION_PACKAGE_VERSION) {
    return { ok: false, problem: "version", paths: [] };
  }
  const parsed = TranslationPackageSchema.safeParse(value);
  if (!parsed.success) {
    const paths = [
      ...new Set(parsed.error.issues.map((i) => i.path.map(String).join(".") || "(package)")),
    ];
    return { ok: false, problem: "schema", paths: paths.slice(0, 5) };
  }
  const bodyBytes = utf8Length(requestBody(parsed.data));
  if (bodyBytes > TRANSLATION_PACKAGE_MAX_BODY_BYTES) {
    return { ok: false, problem: "too_large", paths: [] };
  }
  return { ok: true, pkg: parsed.data, bodyBytes };
}

/** A short summary of a loaded package. */
export function packageSummary(pkg: TranslationPackage) {
  const filled = pkg.units.filter((u) => u.target !== null && u.target.trim() !== "").length;
  return { units: pkg.units.length, filled, pages: pkg.pages.length };
}

// --- statuses and filters ---------------------------------------------------------------------

/**
 * The filters of the report table, in the order of the owner's brief: new, to update, unchanged,
 * outdated, conflicting, invalid — plus not found and empty, and "skipped" (every unit the import
 * leaves out for a reason).
 */
export const STATUS_FILTERS = [
  "all",
  "create",
  "update",
  "unchanged",
  "outdated",
  "conflict",
  "invalid",
  "not_found",
  "empty",
  "skipped",
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** Statuses the import leaves out for a reason (shown with the reason). */
export const SKIPPED_STATUSES: readonly TranslationUnitStatus[] = [
  "outdated",
  "conflict",
  "invalid",
  "not_found",
];

export function matchesFilter(status: TranslationUnitStatus, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "skipped") return SKIPPED_STATUSES.includes(status);
  return status === filter;
}

export type StatusTone = "petrol" | "amber" | "success" | "danger" | "neutral";

export const STATUS_TONE: Readonly<Record<TranslationUnitStatus, StatusTone>> = {
  create: "petrol",
  update: "petrol",
  unchanged: "neutral",
  empty: "neutral",
  outdated: "amber",
  conflict: "amber",
  invalid: "danger",
  not_found: "danger",
};

/** Units the import writes to drafts (`create` + `update` of the report). */
export function writableCount(report: TranslationImportReport): number {
  return (report.counts.create ?? 0) + (report.counts.update ?? 0);
}

export function skippedCount(report: TranslationImportReport): number {
  return SKIPPED_STATUSES.reduce((n, s) => n + (report.counts[s] ?? 0), 0);
}

export function filterCount(report: TranslationImportReport, filter: StatusFilter): number {
  if (filter === "all") return report.units.length;
  if (filter === "skipped") return skippedCount(report);
  return report.counts[filter] ?? 0;
}

// --- rows -------------------------------------------------------------------------------------

export interface ReportRow {
  key: string;
  kind: TranslationUnitKind | null;
  /** The unit's field (`title`, `seo.description`, `content.sections.@…heading`). */
  field: string;
  /** Where the text is shown (from the package, for translators). */
  context: string;
  source: string | null;
  current: string | null;
  target: string | null;
  status: TranslationUnitStatus;
  rule: string | null;
}

/** The report's units with the texts of the package (matched by key; report order). */
export function reportRows(pkg: TranslationPackage, report: TranslationImportReport): ReportRow[] {
  const units = new Map<string, TranslationUnit>(pkg.units.map((u) => [u.key, u]));
  return report.units.map((r) => {
    const unit = units.get(r.key);
    const parsed = parseTranslationUnitKey(r.key);
    return {
      key: r.key,
      kind: parsed?.kind ?? null,
      field: parsed?.field ?? r.key,
      context: unit?.context ?? "",
      source: unit?.source ?? null,
      current: unit?.current ?? null,
      target: unit?.target ?? null,
      status: r.status,
      rule: r.rule,
    };
  });
}

/** Rows of one filter whose key, context or texts contain `query` (case-insensitive). */
export function filterRows(rows: readonly ReportRow[], filter: StatusFilter, query: string) {
  const q = query.trim().toLocaleLowerCase();
  return rows.filter(
    (r) =>
      matchesFilter(r.status, filter) &&
      (!q ||
        [r.key, r.context, r.source, r.target].some((v) => v?.toLocaleLowerCase().includes(q))),
  );
}

export const PAGE_SIZE = 50;

export function pageOf<T>(rows: readonly T[], page: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pages };
}

// --- reasons ----------------------------------------------------------------------------------

/** The API's unit and page rules (ML-13a units.ts, cms-part.ts, catalog-part.ts). */
export const UNIT_RULES = [
  "source_changed",
  "source_removed",
  "source_unpublished",
  "target_changed",
  "structure",
  "archived",
  "too_long",
  "control_characters",
  "format",
  "schema",
  "title_required",
  "name_required",
  "nothing_to_write",
  "page_missing",
  "registry_taken",
  "duplicate_slug",
  "slug_taken",
  "path_taken",
  "old_address",
] as const;
export type UnitRule = (typeof UNIT_RULES)[number];

export const isUnitRule = (rule: string): rule is UnitRule =>
  (UNIT_RULES as readonly string[]).includes(rule);

/** The reason in the UI language; a rule without its own text is shown as its code. */
export function ruleText(rule: string | null, t: Translate): string | null {
  if (!rule) return null;
  return isUnitRule(rule) ? t(`translationPackages.rules.${rule}`) : rule;
}

export function statusLabel(status: TranslationUnitStatus, t: Translate): string {
  return t(`translationPackages.status.${status}`);
}

export function filterLabel(filter: StatusFilter, t: Translate): string {
  return t(`translationPackages.filters.${filter}`);
}

// --- translation assistants (extension point, none registered) --------------------------------

/**
 * ML-13b: where a translation assistant (e.g. a machine translation or AI service) will plug in
 * later. An assistant proposes `target` texts for units of a loaded package; the result is a new
 * package that goes through the same dry run, the same confirmation and the same draft-only
 * import as a file translated by people — an assistant never writes or publishes anything itself.
 *
 * No assistant exists yet (owner brief ML-13b: no AI call and no button that only pretends to
 * work), so `TRANSLATION_ASSISTS` is empty and the screen renders nothing for it. Adding one means
 * registering it here, behind its own API route and permission.
 */
export interface TranslationAssist {
  id: string;
  /** The button's text (a dictionary key without parameters). */
  label: PlainKey;
  /** Proposals by unit key; units it leaves out keep their target. */
  propose: (
    units: readonly TranslationUnit[],
    pkg: TranslationPackage,
  ) => Promise<Record<string, string>>;
}

export const TRANSLATION_ASSISTS: readonly TranslationAssist[] = [];

/** The package with `targets` filled in (only keys it has; nothing else changes). */
export function withTargets(
  pkg: TranslationPackage,
  targets: Readonly<Record<string, string>>,
): TranslationPackage {
  return {
    ...pkg,
    units: pkg.units.map((u) => (u.key in targets ? { ...u, target: targets[u.key] ?? null } : u)),
  };
}
