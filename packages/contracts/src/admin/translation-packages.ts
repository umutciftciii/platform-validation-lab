/**
 * ML-13a (DP-244, ADR-028 D13): translation packages — export every source text unit of a site,
 * have it translated outside the system, import the reviewed package as DRAFTS ONLY.
 *
 * Format `dream-translation-package` version 1 (owner decision 2026-11-25: JSON).
 *
 *  - One package = one site, its default language as the source and one other enabled language as
 *    the target. `types` says which parts it holds: "cms" (pages, articles, menus and other
 *    fragments with their titles, addresses and SEO texts) and/or "catalog" (listing texts and
 *    their SEO texts, categories, specification names, alt texts of public images).
 *  - A unit is one text with a stable key `<kind>:<id>:<field>`: the id of the translation group
 *    (CMS), listing, category, specification definition or image. CMS content fields are dot
 *    paths (`content.sections.@<sectionId>.heading`), the same in every language of a group.
 *  - `source` is the text in the source language when the package was exported and `sourceHash`
 *    its SHA-256 (hex, UTF-8). `current`/`currentHash` are the target language's text at export
 *    (null: none). Translators fill `target` only; null or blank means "no translation".
 *  - Import (and its read-only dry run) decides per unit:
 *      outdated  — the source text changed since the export (its hash differs): skipped;
 *      conflict  — the target text changed since the export, the translation's structure differs
 *                  from the source, the address is taken, or the product is archived: skipped;
 *      invalid   — too long, control characters, a bad or reserved address, or a page that would
 *                  need to be created without a title: skipped;
 *      not_found — the page, listing, category, definition or image no longer exists: skipped;
 *      empty     — no target text: nothing to do;
 *      unchanged — the target already holds exactly this text (a repeated import writes nothing);
 *      create / update — written to the draft.
 *    The other units are still processed (owner decision 2026-11-25). A package that does not
 *    match this schema (or whose `source` does not match its `sourceHash`), and a caller without
 *    the permissions of every part the package holds, is refused as a whole.
 *  - A repeated import of the same package writes no content and raises no version (every unit
 *    `unchanged`, `written` all zero). It still writes its one summary audit event
 *    (`translation.package_imported`, the attempt with its digest and counts) — deliberately: an
 *    import is an accountable action even when it changes nothing. No per-row event is written
 *    for a row that does not change.
 *  - CMS source texts are those of the PUBLISHED revision of the default-language page; a newer
 *    draft is not exported, and a page that is not live is out of scope (export and import).
 *  - Nothing is published: CMS texts go into the page's draft (a missing translation is created as
 *    a draft page of the group), catalogue texts into the language rows that the next publication
 *    reads. Publication rows, snapshots and the language's `public` switch are never written.
 */
import { z } from "zod";
import { SEO_TEXT_LIMITS } from "../seo.js";
import { LocaleTagSchema } from "../site-locales.js";
import { DESCRIPTION_MAX } from "./catalog.js";
import { ALT_TEXT_MAX } from "./catalog-specs.js";
import { CMS_PAGE_KINDS, CMS_SITE_KEYS } from "./cms.js";

export const TRANSLATION_PACKAGE_API = "/api/v1/admin/translation-packages";
export const TRANSLATION_PACKAGE_FORMAT = "dream-translation-package";
export const TRANSLATION_PACKAGE_VERSION = 1;

/**
 * The JSON body limit of the dry-run and import requests (the only admin JSON routes besides the
 * redirect import with a larger limit, applied by the API and, with ML-13b, the admin proxy).
 */
export const TRANSLATION_PACKAGE_MAX_BODY_BYTES = 4 * 1024 * 1024;
export const TRANSLATION_PACKAGE_BODY_PATH =
  /^\/api\/v1\/admin\/translation-packages\/(dry-run|import)$/;
export const TRANSLATION_PACKAGE_MAX_UNITS = 20_000;
export const TRANSLATION_PACKAGE_MAX_PAGES = 2_000;
/** The longest text of any unit (a listing description is 8000). */
export const TRANSLATION_UNIT_TEXT_MAX = 20_000;

export const TRANSLATION_PACKAGE_TYPES = ["cms", "catalog"] as const;
export const TranslationPackageTypeSchema = z.enum(TRANSLATION_PACKAGE_TYPES);
export type TranslationPackageType = z.infer<typeof TranslationPackageTypeSchema>;

export const TRANSLATION_UNIT_KINDS = ["cms", "listing", "category", "spec", "image"] as const;
export const TranslationUnitKindSchema = z.enum(TRANSLATION_UNIT_KINDS);
export type TranslationUnitKind = z.infer<typeof TranslationUnitKindSchema>;

/** The package type a unit kind belongs to. */
export function translationUnitType(kind: TranslationUnitKind): TranslationPackageType {
  return kind === "cms" ? "cms" : "catalog";
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UuidSchema = z.string().regex(new RegExp(`^${UUID}$`));
const KEY = new RegExp(
  `^(${TRANSLATION_UNIT_KINDS.join("|")}):(${UUID}):([A-Za-z0-9@._-]{1,300})$`,
);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** The stable key of a unit. */
export function translationUnitKey(kind: TranslationUnitKind, id: string, field: string): string {
  return `${kind}:${id}:${field}`;
}

/** The parts of a unit key, or null when it is not one. */
export function parseTranslationUnitKey(
  key: string,
): { kind: TranslationUnitKind; id: string; field: string } | null {
  const m = KEY.exec(key);
  if (!m) return null;
  return { kind: m[1] as TranslationUnitKind, id: m[2] as string, field: m[3] as string };
}

/** The fields of the catalogue units, with their length limits (the editors' limits). */
export const TRANSLATION_CATALOG_FIELDS = {
  listing: {
    title: 200,
    summary: 500,
    description: DESCRIPTION_MAX,
    "seo.title": SEO_TEXT_LIMITS.title.max,
    "seo.description": SEO_TEXT_LIMITS.description.max,
    "seo.ogTitle": SEO_TEXT_LIMITS.ogTitle.max,
    "seo.ogDescription": SEO_TEXT_LIMITS.ogDescription.max,
  },
  category: { name: 120, description: 1000 },
  spec: { name: 120 },
  image: { alt: ALT_TEXT_MAX },
} as const satisfies Record<Exclude<TranslationUnitKind, "cms">, Record<string, number>>;

/** The page fields of a CMS unit besides its content texts (`content.<path>`). */
export const TRANSLATION_CMS_PAGE_FIELDS = {
  title: 200,
  slug: 80,
  "seo.title": SEO_TEXT_LIMITS.title.max,
  "seo.description": SEO_TEXT_LIMITS.description.max,
  "seo.ogTitle": SEO_TEXT_LIMITS.ogTitle.max,
  "seo.ogDescription": SEO_TEXT_LIMITS.ogDescription.max,
} as const;

/** Multi-line fields (the editors offer a text area). */
export const TRANSLATION_MULTILINE_FIELDS: ReadonlySet<string> = new Set([
  "listing:summary",
  "listing:description",
  "listing:seo.description",
  "listing:seo.ogDescription",
  "category:description",
  "cms:seo.description",
  "cms:seo.ogDescription",
]);

const UnitTextSchema = z.string().max(TRANSLATION_UNIT_TEXT_MAX);

export const TranslationUnitSchema = z.strictObject({
  key: z.string().regex(KEY),
  kind: TranslationUnitKindSchema,
  /** Where the text is shown (page address and title, product, category, …), for translators. */
  context: z.string().max(400),
  /** The length limit of the field (null: checked by the content schema on import). */
  maxLength: z.number().int().min(1).max(TRANSLATION_UNIT_TEXT_MAX).nullable(),
  multiline: z.boolean(),
  source: UnitTextSchema.min(1),
  sourceHash: HashSchema,
  current: UnitTextSchema.nullable(),
  currentHash: HashSchema.nullable(),
  target: UnitTextSchema.nullable(),
});
export type TranslationUnit = z.infer<typeof TranslationUnitSchema>;

/** A CMS page group of the package (what the import needs besides its units). */
export const TranslationPackagePageSchema = z.strictObject({
  groupId: UuidSchema,
  /** The source page (site's default language) and the revision its texts were exported from. */
  sourcePageId: UuidSchema,
  sourceRevisionNumber: z.number().int().min(1),
  kind: z.enum(CMS_PAGE_KINDS),
  templateKey: z.string().min(1).max(80),
  /** The source page's stored path (null for fragments). */
  path: z.string().max(120).nullable(),
  /** The page of the group in the target language at export (null: none yet). */
  targetPageId: UuidSchema.nullable(),
});
export type TranslationPackagePage = z.infer<typeof TranslationPackagePageSchema>;

export const TranslationPackageSchema = z
  .strictObject({
    format: z.literal(TRANSLATION_PACKAGE_FORMAT),
    version: z.literal(TRANSLATION_PACKAGE_VERSION),
    site: z.strictObject({ id: UuidSchema, key: z.enum(CMS_SITE_KEYS) }),
    sourceLocale: LocaleTagSchema,
    targetLocale: LocaleTagSchema,
    exportedAt: z.iso.datetime({ offset: true }),
    types: z.array(TranslationPackageTypeSchema).min(1).max(2),
    pages: z.array(TranslationPackagePageSchema).max(TRANSLATION_PACKAGE_MAX_PAGES),
    units: z.array(TranslationUnitSchema).max(TRANSLATION_PACKAGE_MAX_UNITS),
  })
  .superRefine((p, ctx) => {
    if (p.sourceLocale === p.targetLocale) {
      ctx.addIssue({ code: "custom", path: ["targetLocale"], message: "same_as_source" });
    }
    if (new Set(p.types).size !== p.types.length) {
      ctx.addIssue({ code: "custom", path: ["types"], message: "duplicate" });
    }
    const groups = new Set<string>();
    p.pages.forEach((page, i) => {
      if (groups.has(page.groupId)) {
        ctx.addIssue({ code: "custom", path: ["pages", i, "groupId"], message: "duplicate" });
      }
      groups.add(page.groupId);
    });
    if (p.pages.length > 0 && !p.types.includes("cms")) {
      ctx.addIssue({ code: "custom", path: ["pages"], message: "type_not_declared" });
    }
    const keys = new Set<string>();
    p.units.forEach((u, i) => {
      const at = (field: string) => ["units", i, field];
      if (keys.has(u.key)) ctx.addIssue({ code: "custom", path: at("key"), message: "duplicate" });
      keys.add(u.key);
      const parsed = parseTranslationUnitKey(u.key);
      if (!parsed || parsed.kind !== u.kind) {
        ctx.addIssue({ code: "custom", path: at("kind"), message: "key_mismatch" });
        return;
      }
      if (!p.types.includes(translationUnitType(u.kind))) {
        ctx.addIssue({ code: "custom", path: at("kind"), message: "type_not_declared" });
      }
      if (u.kind === "cms") {
        if (!groups.has(parsed.id)) {
          ctx.addIssue({ code: "custom", path: at("key"), message: "unknown_page" });
        }
        const pageField = parsed.field in TRANSLATION_CMS_PAGE_FIELDS;
        if (!pageField && !/^content\.[A-Za-z0-9@_-]+(\.[A-Za-z0-9@_-]+)*$/.test(parsed.field)) {
          ctx.addIssue({ code: "custom", path: at("key"), message: "unknown_field" });
        }
      } else if (!(parsed.field in TRANSLATION_CATALOG_FIELDS[u.kind])) {
        ctx.addIssue({ code: "custom", path: at("key"), message: "unknown_field" });
      }
      if ((u.current === null) !== (u.currentHash === null)) {
        ctx.addIssue({ code: "custom", path: at("currentHash"), message: "mismatch" });
      }
    });
  });
export type TranslationPackage = z.infer<typeof TranslationPackageSchema>;

// --- requests -------------------------------------------------------------------------------------

/**
 * `GET /api/v1/admin/translation-packages/export?siteId=&locale=&types=cms,catalog`: the package of
 * the site's texts for `locale` (any enabled language other than the default, public or not).
 * "cms" needs `content:read` of the site, "catalog" `product:read` of the site. Read only; one
 * audit event (counts, never texts). Default types: both.
 */
export const TranslationExportQuerySchema = z.strictObject({
  siteId: UuidSchema,
  locale: LocaleTagSchema,
  types: z
    .string()
    .max(40)
    .optional()
    .transform((v, ctx) => {
      const list = (v ?? TRANSLATION_PACKAGE_TYPES.join(",")).split(",").map((s) => s.trim());
      const out: TranslationPackageType[] = [];
      for (const t of list) {
        const parsed = TranslationPackageTypeSchema.safeParse(t);
        if (!parsed.success) {
          ctx.addIssue({ code: "custom", message: "unknown_type" });
          return z.NEVER;
        }
        if (!out.includes(parsed.data)) out.push(parsed.data);
      }
      return out;
    }),
});
export type TranslationExportQuery = z.input<typeof TranslationExportQuerySchema>;

/**
 * `POST /api/v1/admin/translation-packages/dry-run` (read only, nothing written, no audit event)
 * and `POST /api/v1/admin/translation-packages/import` (drafts only). The dry run needs the read
 * permissions of the package's parts and reports whether the caller could import it; the import
 * needs `content:edit` of the site for "cms" units, `product:edit` of the site for listing and
 * category units and `product_master:edit` (platform) for specification and image units — all of
 * them, or nothing is written (403).
 */
export const TranslationImportRequestSchema = z.strictObject({
  package: TranslationPackageSchema,
});
export type TranslationImportRequest = z.input<typeof TranslationImportRequestSchema>;

// --- report ---------------------------------------------------------------------------------------

export const TRANSLATION_UNIT_STATUSES = [
  "create",
  "update",
  "unchanged",
  "empty",
  "outdated",
  "conflict",
  "invalid",
  "not_found",
] as const;
export const TranslationUnitStatusSchema = z.enum(TRANSLATION_UNIT_STATUSES);
export type TranslationUnitStatus = z.infer<typeof TranslationUnitStatusSchema>;

/** Statuses that write the draft. */
export const TRANSLATION_WRITING_STATUSES: readonly TranslationUnitStatus[] = ["create", "update"];

export const TRANSLATION_PAGE_ACTIONS = ["create", "update", "unchanged", "skipped"] as const;

export const TranslationUnitResultSchema = z.strictObject({
  key: z.string(),
  status: TranslationUnitStatusSchema,
  /** Why a unit is skipped (e.g. `target_changed`, `structure`, `slug_taken`, `too_long`). */
  rule: z.string().max(60).nullable(),
});
export type TranslationUnitResult = z.infer<typeof TranslationUnitResultSchema>;

export const TranslationPageResultSchema = z.strictObject({
  groupId: z.string(),
  /** The page in the target language (null: none, and none will be created). */
  targetPageId: z.string().nullable(),
  action: z.enum(TRANSLATION_PAGE_ACTIONS),
  rule: z.string().max(60).nullable(),
});
export type TranslationPageResult = z.infer<typeof TranslationPageResultSchema>;

export const TranslationImportReportSchema = z.strictObject({
  dryRun: z.boolean(),
  /** SHA-256 of the package as received (canonical JSON): names it in the audit event. */
  digest: HashSchema,
  siteId: z.string(),
  sourceLocale: LocaleTagSchema,
  targetLocale: LocaleTagSchema,
  /** Whether the caller holds every permission the import of this package needs. */
  canImport: z.boolean(),
  missingPermissions: z.array(z.string()).max(10),
  counts: z.record(TranslationUnitStatusSchema, z.number().int().min(0)),
  pages: z.array(TranslationPageResultSchema).max(TRANSLATION_PACKAGE_MAX_PAGES),
  units: z.array(TranslationUnitResultSchema).max(TRANSLATION_PACKAGE_MAX_UNITS),
  /** Rows written by the import (all zero for a dry run). */
  written: z.strictObject({
    cmsPagesCreated: z.number().int().min(0),
    cmsPagesUpdated: z.number().int().min(0),
    listings: z.number().int().min(0),
    categories: z.number().int().min(0),
    specs: z.number().int().min(0),
    images: z.number().int().min(0),
  }),
});
export type TranslationImportReport = z.infer<typeof TranslationImportReportSchema>;
