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
import { CORPORATE_TR_PROPOSAL_INDEX } from "./cms-corporate-content.js";
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
import { BV_FOOTER_KEY, BV_NAV_KEY, cmsIsMenu } from "./cms-menu.js";
import { menuNlProposal } from "./cms-menu-nl.js";

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

/**
 * ML-13 (DP-244): one translatable text of a page's content. `path` is a dot path into the
 * content; a section of a TEMPLATE page is addressed by its id (`sections.@<id>`), so the path is
 * the same in every language of a group (the ids are copied by "Create translation").
 */
export interface CmsTextSlot {
  path: string;
  /** The field's length limit where the field descriptor has one (menus: checked by the schema). */
  max: number | null;
  multiline: boolean;
}

/**
 * Called for every translatable text of a content tree with its current value (a string, or null
 * for an optional text field that holds no value); returns the new value. Returning the given
 * value leaves the text unchanged.
 */
type TextMap = (slot: CmsTextSlot, value: string | null) => string | null;

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

function mapFields(fields: readonly CmsField[], value: Json, path: string, fn: TextMap): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  for (const f of fields) {
    if (!(f.key in src)) continue;
    const v = src[f.key];
    const at = join(path, f.key);
    switch (f.type) {
      case "text":
        // Anchors, focal points and link targets are structure; every other text is translated.
        if (!f.format && (typeof v === "string" || v === null)) {
          out[f.key] = fn({ path: at, max: f.max, multiline: f.multiline === true }, v);
        }
        break;
      case "link":
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const link = v as Record<string, unknown>;
          const label = link["label"];
          if (typeof label === "string") {
            out[f.key] = {
              ...link,
              label: fn({ path: `${at}.label`, max: 80, multiline: false }, label),
            };
          }
        }
        break;
      case "list":
        if (Array.isArray(v)) {
          out[f.key] = v.map((item, i) => mapFields(f.fields, item, `${at}.${i}`, fn));
        }
        break;
      case "group":
        out[f.key] = mapFields(f.fields, v, at, fn);
        break;
      case "asset":
        break;
    }
  }
  return out;
}

/** A section's path segment: its id when it has one (stable across languages), else its index. */
function sectionSegment(section: unknown, index: number): string {
  const id = (section as { id?: unknown } | null)?.id;
  return typeof id === "string" && /^[a-z0-9-]{8,40}$/.test(id) ? `@${id}` : `${index}`;
}

function mapSections(sections: Json, fn: TextMap): Json {
  if (!Array.isArray(sections)) return sections;
  return sections.map((s, i) => {
    if (!s || typeof s !== "object") return s;
    const type = (s as { type?: unknown }).type;
    const def = CMS_SECTION_TYPES.find((t) => t.type === type);
    return def ? mapFields(def.fields, s, `sections.${sectionSegment(s, i)}`, fn) : s;
  });
}

/** The draft-creation rule (ML-2): every text becomes empty; a field without a value stays so. */
const BLANK: TextMap = (_slot, value) => (value === null ? null : "");

/**
 * Menu texts (labels, column and contact titles, address-free notes, the footer's headline, intro
 * and copyright, the "not ready" note). Targets, URLs and switches are structure. ML-7: the
 * company's contact details are shared by every language and stay as they are: company name,
 * address lines, the telephone number and e-mail address shown, and the names of social networks.
 */
const MENU_TEXT_KEYS = new Set([
  "label",
  "title",
  "text",
  "note",
  "pendingNote",
  "headline",
  "intro",
  "copyright",
]);
const MENU_SHARED = [
  /^contact\.company$/,
  /^contact\.addressLines\.\d+\.text$/,
  /^contact\.(phone|email)\.label$/,
  /^social\.\d+\.label$/,
];
function mapMenu(value: Json, path: string, fn: TextMap): Json {
  if (Array.isArray(value)) return value.map((v, i) => mapMenu(v, join(path, `${i}`), fn));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const at = join(path, k);
    // A menu target (`{ type: "page", pageId }`) keeps everything.
    if (k === "target") out[k] = v;
    else if (MENU_TEXT_KEYS.has(k) && typeof v === "string") {
      out[k] = MENU_SHARED.some((r) => r.test(at))
        ? v
        : fn({ path: at, max: null, multiline: k === "intro" }, v);
    } else out[k] = mapMenu(v, at, fn);
  }
  return out;
}

/**
 * Applies `fn` to every translatable text of a page's content (the same texts "Create
 * translation" empties): TEMPLATE pages their sections (articles also summary and cover alt text),
 * menus their labels and notes except the shared contact details, other designed pages and
 * fragments the plain texts of their template fields.
 */
function mapCmsTexts(
  page: { kind: string; templateKey: string },
  content: Record<string, unknown>,
  fn: TextMap,
): Record<string, unknown> {
  if (page.kind === "TEMPLATE") {
    const base =
      page.templateKey === "article"
        ? (mapFields(CMS_ARTICLE_FIELDS, content, "", fn) as Record<string, unknown>)
        : { ...content };
    return { ...base, sections: mapSections(content["sections"], fn) };
  }
  if (cmsIsMenu(page.templateKey)) return mapMenu(content, "", fn) as Record<string, unknown>;
  const template = cmsDesignTemplate(page.templateKey);
  if (template?.fields)
    return mapFields(template.fields, content, "", fn) as Record<string, unknown>;
  // A template with its own schema and no field list: its plain texts by key (as the menus).
  return mapMenu(content, "", fn) as Record<string, unknown>;
}

/**
 * ML-13 (DP-244): the translatable texts of a page's content with their values (a text field
 * without a value is listed with `null`), in document order.
 */
export function cmsContentTexts(
  page: { kind: string; templateKey: string },
  content: Record<string, unknown>,
): (CmsTextSlot & { value: string | null })[] {
  const out: (CmsTextSlot & { value: string | null })[] = [];
  mapCmsTexts(page, content, (slot, value) => {
    out.push({ ...slot, value });
    return value;
  });
  return out;
}

/**
 * ML-13 (DP-244): the content with the texts at the given paths replaced; every other value
 * (structure, images, links, menu targets, texts not named) stays as it is. Paths that are not a
 * text of this content are ignored (the caller checks them with `cmsContentTexts`).
 */
export function cmsWithContentTexts(
  page: { kind: string; templateKey: string },
  content: Record<string, unknown>,
  texts: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return mapCmsTexts(page, content, (slot, value) => texts.get(slot.path) ?? value);
}

/** Languages and templates with a reviewed-pending proposal for "Create translation" (ML-7). */
export function cmsTranslationHasProposal(templateKey: string, locale: string): boolean {
  // The Dutch proposal is written for the BV menus only (COM-1: the corporate menus have none).
  return locale === "nl" && (templateKey === BV_NAV_KEY || templateKey === BV_FOOTER_KEY);
}

/**
 * COM-5 (DP-038): the place of a corporate source page among the Turkish proposals — a designed
 * page or fragment by its registry key, a content page or article by its template and English
 * address (`standard|/about-us`, `article|/news/<slug>`).
 */
export function cmsCorporateTrPlace(page: {
  kind: string;
  templateKey: string;
  path: string | null;
}): string {
  return page.kind === "TEMPLATE" ? `${page.templateKey}|${page.path ?? ""}` : page.templateKey;
}

/**
 * The proposal "Create translation" may start from, or null: the Dutch BV menus (ML-7; their own
 * title and slug), or COM-5's Turkish proposal of a corporate page (the live Turkish page, with
 * its Turkish title and, for a content page or article, its Turkish slug).
 */
export function cmsTranslationProposal(
  siteKey: string,
  page: { kind: string; templateKey: string; path: string | null },
  locale: string,
): { title: string | null; slug: string | null } | null {
  if (cmsTranslationHasProposal(page.templateKey, locale)) return { title: null, slug: null };
  if (siteKey !== "CORPORATE" || locale !== "tr") return null;
  return CORPORATE_TR_PROPOSAL_INDEX[cmsCorporateTrPlace(page)] ?? null;
}

/**
 * The content of a new translation: the source's structure with every text emptied. TEMPLATE
 * pages keep their section ids and types, articles their cover image; designed pages and
 * fragments keep images, anchors, link targets and menu targets.
 */
export function cmsTranslationDraft(
  page: { kind: string; templateKey: string },
  content: Record<string, unknown>,
  /**
   * ML-7: fill the texts with the Dutch proposal (`cms-menu-nl.ts`) where one exists; only for
   * the menus in Dutch (`cmsTranslationHasProposal`), ignored otherwise. Still a draft.
   */
  proposal?: { locale: string },
): Record<string, unknown> {
  if (
    cmsIsMenu(page.templateKey) &&
    proposal &&
    cmsTranslationHasProposal(page.templateKey, proposal.locale)
  ) {
    return mapCmsTexts(page, content, (slot, en) =>
      en === null ? null : menuNlProposal(page.templateKey, slot.path, en),
    );
  }
  return mapCmsTexts(page, content, BLANK);
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
  /**
   * ML-7: start from the reviewed-pending proposal of the language (menus in Dutch,
   * `cmsTranslationHasProposal`); 400 `proposal` `unavailable` where there is none. A draft.
   */
  proposal: z.boolean().optional(),
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
