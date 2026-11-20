/**
 * ML-2 (DP-074, ADR-028 D6/D7): CMS pages per language and their translation groups.
 *
 * - Every language of a page is its own row (`CmsPage`), with its own draft, preview,
 *   publication, history and restore. The rows of one page in different languages form a
 *   translation group (`translationGroupId`, the id of the group's first page); a group holds at
 *   most one row per language, and its rows share site, kind and template key (database rules).
 * - Paths are stored without the language prefix (ADR-028 D3). The public address of a page is
 *   `cmsLocaleAddress(path, locale, defaultLocale)`: today the default language keeps its
 *   unprefixed address (the `/en` routing arrives with ML-3/ML-4, which flips
 *   `CMS_LOCALE_PREFIX_DEFAULT`), every other language lives under `/<locale>`. Slug-change
 *   redirects and the admin's address checks use the same function, so they are ready for the
 *   prefix without changing today's English addresses.
 * - "Create translation" copies the structure of the source (section ids and types, links,
 *   images, menu targets, anchors) and leaves every text empty (`cmsTranslationDraft`). Differences
 *   in structure between the languages of a group are a warning before publishing, never a refusal
 *   (`cmsStructureWarnings`).
 * - Translation state per group and language: missing, draft, published, outdated (the source
 *   language has a newer revision than the one the translation was made from).
 * - No fallback (D7): a language without published content shows nothing; English is never served
 *   in its place.
 */
import { z } from "zod";
import { LocaleTagSchema } from "../site-locales.js";
import {
  CMS_ARTICLE_FIELDS,
  CMS_SECTION_TYPES,
  CmsArticleSlugSchema,
  CmsSlugSchema,
  type CmsField,
  type CmsStructureWarning,
  type CmsTranslationState,
} from "./cms.js";
import { cmsDesignTemplate } from "./cms-bv.js";
import { cmsIsMenu } from "./cms-menu.js";

const VersionSchema = z.number().int().min(1);

// --- addresses per language ---------------------------------------------------------------------

/**
 * Whether the default language is served under its own prefix (`/en/...`). False until ML-3/ML-4
 * reach an environment together (ADR-028 D5): today English stays at `/about-us`.
 */
export const CMS_LOCALE_PREFIX_DEFAULT = false;

/** The public address of a stored page path in a language ("/" in Dutch → "/nl"). */
export function cmsLocaleAddress(
  path: string,
  locale: string,
  defaultLocale: string,
  prefixDefault: boolean = CMS_LOCALE_PREFIX_DEFAULT,
): string {
  if (locale === defaultLocale && !prefixDefault) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/**
 * The language and stored path of a public address, or null when it is not an address of a page
 * in one of `locales` (e.g. an old-site `/en/...` address while the default is unprefixed).
 */
export function cmsAddressLocale(
  address: string,
  locales: readonly string[],
  defaultLocale: string,
  prefixDefault: boolean = CMS_LOCALE_PREFIX_DEFAULT,
): { locale: string; path: string } | null {
  const first = address.split("/")[1] ?? "";
  if (first && locales.includes(first) && (first !== defaultLocale || prefixDefault)) {
    const rest = address.slice(first.length + 1);
    return { locale: first, path: rest === "" ? "/" : rest };
  }
  if (prefixDefault) return null;
  return { locale: defaultLocale, path: address };
}

// --- translation drafts -------------------------------------------------------------------------

type Json = unknown;

function blankFields(fields: readonly CmsField[], value: Json): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  for (const f of fields) {
    if (!(f.key in src)) continue;
    const v = src[f.key];
    switch (f.type) {
      case "text":
        // Anchors, focal points and link targets are structure; every other text is translated.
        if (!f.format && typeof v === "string") out[f.key] = "";
        break;
      case "link":
        if (v && typeof v === "object" && !Array.isArray(v)) {
          out[f.key] = { ...(v as Record<string, unknown>), label: "" };
        }
        break;
      case "list":
        if (Array.isArray(v)) out[f.key] = v.map((item) => blankFields(f.fields, item));
        break;
      case "group":
        out[f.key] = blankFields(f.fields, v);
        break;
      case "asset":
        break;
    }
  }
  return out;
}

function blankSections(sections: Json): Json {
  if (!Array.isArray(sections)) return sections;
  return sections.map((s) => {
    if (!s || typeof s !== "object") return s;
    const type = (s as { type?: unknown }).type;
    const def = CMS_SECTION_TYPES.find((t) => t.type === type);
    return def ? blankFields(def.fields, s) : s;
  });
}

/** Menu texts (labels, column titles, address lines, the "not ready" note); targets, URLs stay. */
const MENU_TEXT_KEYS = new Set(["label", "title", "text", "pendingNote"]);
function blankMenu(value: Json): Json {
  if (Array.isArray(value)) return value.map(blankMenu);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // A menu target (`{ type: "page", pageId }`) keeps everything.
    if (k === "target") out[k] = v;
    else if (MENU_TEXT_KEYS.has(k) && typeof v === "string") out[k] = "";
    else out[k] = blankMenu(v);
  }
  return out;
}

/**
 * The content of a new translation: the source's structure with every text emptied. TEMPLATE
 * pages keep their section ids and types, articles their cover image; designed pages and
 * fragments keep images, anchors, link targets and menu targets.
 */
export function cmsTranslationDraft(
  page: { kind: string; templateKey: string },
  content: Record<string, unknown>,
): Record<string, unknown> {
  if (page.kind === "TEMPLATE") {
    const base =
      page.templateKey === "article"
        ? (blankFields(CMS_ARTICLE_FIELDS, content) as Record<string, unknown>)
        : { ...content };
    return { ...base, sections: blankSections(content["sections"]) };
  }
  if (cmsIsMenu(page.templateKey)) return blankMenu(content) as Record<string, unknown>;
  const template = cmsDesignTemplate(page.templateKey);
  if (template?.fields) return blankFields(template.fields, content) as Record<string, unknown>;
  // A template with its own schema and no field list: keep the structure, empty plain texts.
  return blankMenu(content) as Record<string, unknown>;
}

// --- structure warnings -------------------------------------------------------------------------

/** A comparable outline of content: section ids/types, list sizes, images and link targets. */
function outline(value: Json, path: string, acc: Record<CmsStructureWarning, string[]>): void {
  if (Array.isArray(value)) {
    acc.lists.push(`${path}#${value.length}`);
    value.forEach((v, i) => outline(v, `${path}.${i}`, acc));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.startsWith("/media/"))
      acc.images.push(`${path}=${value}`);
    return;
  }
  const obj = value as Record<string, unknown>;
  if (path.startsWith("sections.") && typeof obj["id"] === "string") {
    acc.sections.push(`${String(obj["id"])}:${String(obj["type"])}`);
  }
  for (const [k, v] of Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (k === "href" && typeof v === "string") acc.links.push(`${path}.${k}=${v}`);
    else if (k === "target") acc.links.push(`${path}.${k}=${JSON.stringify(v)}`);
    else outline(v, path ? `${path}.${k}` : k, acc);
  }
}

/**
 * What differs in structure between a translation and its source (ADR-028 D6: shown before
 * publishing, never a refusal). Texts are not compared.
 */
export function cmsStructureWarnings(
  source: Record<string, unknown>,
  translation: Record<string, unknown>,
): CmsStructureWarning[] {
  const a = { sections: [], lists: [], images: [], links: [] } as Record<
    CmsStructureWarning,
    string[]
  >;
  const b = { sections: [], lists: [], images: [], links: [] } as Record<
    CmsStructureWarning,
    string[]
  >;
  outline(source, "", a);
  outline(translation, "", b);
  return (["sections", "lists", "images", "links"] as const).filter(
    (k) => a[k].join("|") !== b[k].join("|"),
  );
}

// --- translation state --------------------------------------------------------------------------

/** The translation state of a page as a whole (`missing` < `draft` < `published`, `outdated`). */
export function cmsTranslationState(input: {
  exists: boolean;
  published: boolean;
  outdated: boolean;
}): CmsTranslationState {
  if (!input.exists) return "missing";
  if (!input.published) return "draft";
  return input.outdated ? "outdated" : "published";
}

/** Whether a translation made from `made` is behind the source's newest revision `latest`. */
export function cmsTranslationOutdated(made: number | null, latest: number | null): boolean {
  if (latest === null) return false;
  return made === null || made < latest;
}

// --- requests -----------------------------------------------------------------------------------

/**
 * `POST /api/v1/admin/cms/pages/:id/translations`: creates the page in another enabled language
 * of its site from the page `:id` (any page of the group). `title` is the translated title; TEMPLATE
 * pages and articles may take their own slug in the new language (default: the source's slug).
 * 409 `locale` `exists` when the group already has the language (never created twice).
 */
export const CmsTranslationCreateRequestSchema = z.strictObject({
  locale: LocaleTagSchema,
  title: z.string().trim().min(1).max(200),
  slug: z.string().optional(),
});
export type CmsTranslationCreateRequest = z.input<typeof CmsTranslationCreateRequestSchema>;

/** Validates the slug of a new translation by the page's kind (pages vs. articles). */
export function cmsTranslationSlugSchema(article: boolean) {
  return article ? CmsArticleSlugSchema : CmsSlugSchema;
}

/**
 * `POST /api/v1/admin/cms/pages/:id/translation-source`: records that the translation `:id` now
 * matches revision `revisionNumber` of its source page (clears "outdated"). A normal draft change:
 * `content:edit`, names the draft version, audited.
 */
export const CmsTranslationSourceRequestSchema = z.strictObject({
  version: VersionSchema,
  revisionNumber: z.number().int().min(1),
});
export type CmsTranslationSourceRequest = z.infer<typeof CmsTranslationSourceRequestSchema>;
