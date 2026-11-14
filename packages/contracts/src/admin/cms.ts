/**
 * CMS page contracts (S1: DP-015 page and section model, ADR-020). The admin console and the API
 * share them.
 *
 * - A page belongs to one site and is stored in the site's default locale (one locale for now;
 *   DP-073 adds more).
 * - Three kinds share one table and one draft/SEO model:
 *     TEMPLATE  new pages built from the four ready-made section types below;
 *     DESIGN    the existing hand-designed pages: components and motion stay in code, the CMS
 *               fills their fields (imported in S2, see CMS_SITE_REGISTRY);
 *     FRAGMENT  site-wide parts without a URL (navigation, footer).
 * - Content is validated against the field descriptors here, in the API on every save. Unknown
 *   keys are refused (strict objects); text is plain text, never HTML.
 * - Updates name the `version` they were based on; a stale version answers 409 CONFLICT_STATE
 *   (`details: [{ path: "version", rule: "stale" }]`).
 * - S1 stores drafts only. Publication, revisions and preview come in S2; nothing here is public.
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";

export const CMS_API = "/api/v1/admin/cms";

const IsoDate = z.iso.datetime({ offset: true });
const VersionSchema = z.number().int().min(1);

/** Control characters other than tab and line breaks are refused in every text. */
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const plain = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !CONTROL.test(v), { message: "control_characters" });
const requiredText = (max: number) => plain(max).pipe(z.string().min(1));
/** Optional text: missing, null or blank all mean "no value" (stored as null). */
const optionalText = (max: number) =>
  plain(max)
    .nullish()
    .transform((v) => (v ? v : null));

// --- page kinds and paths ------------------------------------------------------------------

export const CMS_PAGE_KINDS = ["DESIGN", "TEMPLATE", "FRAGMENT"] as const;
export const CmsPageKindSchema = z.enum(CMS_PAGE_KINDS);
export type CmsPageKind = z.infer<typeof CmsPageKindSchema>;

/** The template key of every TEMPLATE page (one template with four section types in S1). */
export const CMS_STANDARD_TEMPLATE = "standard";

/**
 * First path segments that belong to the apps' own routes or are kept for later (locale prefixes
 * of DP-073 are two letters, so every two-letter slug is reserved as well). The database refuses
 * the same list (migration 20261126090000_cms_s1_pages).
 */
export const CMS_RESERVED_SLUGS: readonly string[] = [
  "api",
  "demo",
  "lead-form",
  "news",
  "preview",
  "privacy",
  "product-documents",
  "product-images",
  "products",
  "robots",
  "search",
  "sitemap",
];

/** One lower-case kebab-case segment; the page lives at `/<slug>`. */
export const CmsSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: "format" })
  .refine((s) => !/^[a-z]{2}$/.test(s) && !CMS_RESERVED_SLUGS.includes(s), {
    message: "reserved",
  });

export function cmsPathForSlug(slug: string): string {
  return `/${slug}`;
}

// --- field descriptors -----------------------------------------------------------------------

/**
 * Describes the editable fields of a section or page. The admin renders its form from these and
 * the API validates with `cmsFieldsSchema`, so the two can never disagree. This is a form
 * description, not a page builder: layouts and components stay in the web apps' code.
 */
export type CmsField =
  | {
      type: "text";
      key: string;
      label: string;
      max: number;
      required?: boolean;
      multiline?: boolean;
      /**
       * anchor:   a DOM id / stable key (lower-case kebab-case);
       * position: a focal point, CSS object-position "X% Y%";
       * href:     an optional link target (null = a page that does not exist yet, shown as text).
       */
      format?: "anchor" | "position" | "href";
      /**
       * Required as soon as the sibling field with this key has a value (e.g. an image's alt
       * text); the schema of the whole object checks it, the admin labels it accordingly.
       */
      requiredWith?: string;
      hint?: string;
    }
  | { type: "link"; key: string; label: string; required?: boolean; hint?: string }
  | {
      type: "list";
      key: string;
      label: string;
      itemLabel: string;
      min: number;
      max: number;
      fields: readonly CmsField[];
      /** A field whose value must differ between the items (e.g. the anchor). */
      unique?: string;
      hint?: string;
    }
  /** A fixed group of fields (one card, one block of a designed page). */
  | { type: "group"; key: string; label: string; fields: readonly CmsField[]; hint?: string }
  /** A registered static asset of the site (CMS_STATIC_ASSETS); uploads come with S5. */
  | {
      type: "asset";
      key: string;
      label: string;
      kinds: readonly CmsAssetKind[];
      /** Default true. Optional assets (e.g. an article's cover) store null when none is chosen. */
      required?: boolean;
      hint?: string;
    };

// --- registered static assets ------------------------------------------------------------------

export type CmsAssetKind = "image" | "animation";

export interface CmsStaticAsset {
  site: "BV" | "CORPORATE";
  src: string;
  kind: CmsAssetKind;
  width: number;
  height: number;
}

const bv = (src: string, width: number, height: number, kind: CmsAssetKind = "image") =>
  ({ site: "BV", src, kind, width, height }) as const;

/**
 * Files in the web apps' public folders that pages may use (S2). An asset field accepts only these,
 * so a draft can never point at an arbitrary URL; the sizes give next/image its dimensions. The
 * hero's frame sequence and the brand logo stay in code (DP-137, ADR-020 D3).
 */
export const CMS_STATIC_ASSETS: readonly CmsStaticAsset[] = [
  bv("/media/applications/baby-care-concept-1448.webp", 1448, 1086),
  bv("/media/applications/baby-care-concept-828.webp", 828, 621),
  bv("/media/applications/personal-care-packaging-1448.webp", 1448, 1086),
  bv("/media/applications/personal-care-packaging-828.webp", 828, 621),
  bv("/media/applications/transparent-polymers-1448.webp", 1448, 1086),
  bv("/media/applications/transparent-polymers-828.webp", 828, 621),
  bv("/media/ctl-technology/clear-base-oil.webp", 826, 461),
  bv("/media/ctl-technology/industrial-process.webp", 826, 460),
  bv("/media/ctl-technology/molecular-visualization.webp", 826, 460),
  bv("/media/iccsyn-cards/engine-valvetrain.webp", 1200, 900),
  bv("/media/iccsyn-cards/hydraulic-power-unit.webp", 1200, 900),
  bv("/media/iccsyn-cards/turbine-compressor-rotor.webp", 1200, 900),
  bv("/media/iccsyn-cards/temp/compressor-turbine.webp", 900, 675),
  bv("/media/iccsyn-cards/temp/engine-oils.webp", 900, 674),
  bv("/media/iccsyn-cards/temp/hydraulic.webp", 900, 675),
  bv("/media/iccsyn-cards/temp/industrial.webp", 900, 675),
  bv("/media/iccsyn-cards/temp/specialty.webp", 900, 675),
  bv("/media/iccsyn-cards/temp/transmission-gear.webp", 900, 675),
  bv("/media/iccsyn-groups/temp/group-1-loop.gif", 587, 436, "animation"),
  bv("/media/iccsyn-groups/temp/group-1-poster.webp", 587, 436),
  bv("/media/iccsyn-groups/temp/group-2-loop.gif", 587, 435, "animation"),
  bv("/media/iccsyn-groups/temp/group-2-poster.webp", 587, 435),
  bv("/media/iccsyn-groups/temp/group-3-loop.gif", 587, 439, "animation"),
  bv("/media/iccsyn-groups/temp/group-3-poster.webp", 587, 439),
  bv("/media/iccsyn-groups/temp/group-3-plus-loop.gif", 586, 439, "animation"),
  bv("/media/iccsyn-groups/temp/group-3-plus-poster.webp", 586, 439),
  bv("/media/services-showcase/energy-trading-supply-desktop.webp", 1448, 1086),
  bv("/media/services-showcase/energy-trading-supply-mobile.webp", 815, 1086),
  bv("/media/services-showcase/logistics-desktop.webp", 1448, 1086),
  bv("/media/services-showcase/logistics-mobile.webp", 815, 1086),
  bv("/media/services-showcase/storage-distribution-desktop.webp", 1448, 1086),
  bv("/media/services-showcase/storage-distribution-mobile.webp", 815, 1086),
];

export function cmsAsset(src: string): CmsStaticAsset | undefined {
  return CMS_STATIC_ASSETS.find((a) => a.src === src);
}

/**
 * Link targets: a site path, an in-page anchor, https, mailto or tel. Everything else (javascript:,
 * data:, protocol-relative //host, http) is refused.
 */
export const CmsHrefSchema = plain(500)
  .pipe(z.string().min(1))
  .refine(
    (v) =>
      /^\/(?!\/)[^\s]*$/.test(v) ||
      /^#[A-Za-z][\w-]*$/.test(v) ||
      /^https:\/\/[^\s/]+[^\s]*$/.test(v) ||
      /^mailto:[^\s@]+@[^\s@]+$/.test(v) ||
      /^tel:\+?[0-9 ()-]{3,30}$/.test(v),
    { message: "href" },
  );

export const CmsLinkSchema = z.strictObject({
  label: requiredText(80),
  href: CmsHrefSchema,
});
export type CmsLink = z.infer<typeof CmsLinkSchema>;

const ANCHOR = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const POSITION = /^\d{1,3}% \d{1,3}%$/;

function textSchema(field: Extract<CmsField, { type: "text" }>): z.ZodType {
  switch (field.format) {
    case "anchor":
      return requiredText(Math.min(field.max, 60)).pipe(
        z.string().regex(ANCHOR, { message: "anchor" }),
      );
    case "position":
      return requiredText(12).pipe(z.string().regex(POSITION, { message: "position" }));
    case "href":
      return CmsHrefSchema.nullish()
        .or(z.literal("").transform(() => null))
        .transform((v) => v ?? null);
    default:
      return field.required ? requiredText(field.max) : optionalText(field.max);
  }
}

function fieldSchema(field: CmsField): z.ZodType {
  switch (field.type) {
    case "text":
      return textSchema(field);
    case "link":
      return field.required ? CmsLinkSchema : CmsLinkSchema.nullish().transform((v) => v ?? null);
    case "list": {
      const list = z.array(cmsFieldsSchema(field.fields)).min(field.min).max(field.max);
      const key = field.unique;
      if (!key) return list;
      return list.refine((items) => new Set(items.map((i) => i[key])).size === items.length, {
        message: "duplicate",
        path: [],
      });
    }
    case "group":
      return cmsFieldsSchema(field.fields);
    case "asset": {
      const asset = z.string().refine(
        (src) => {
          const a = cmsAsset(src);
          return Boolean(a && field.kinds.includes(a.kind));
        },
        { message: "asset" },
      );
      if (field.required !== false) return asset;
      return asset
        .nullish()
        .or(z.literal("").transform(() => null))
        .transform((v) => v ?? null);
    }
  }
}

/** The strict object schema of a set of fields. */
export function cmsFieldsSchema(fields: readonly CmsField[]): z.ZodType<Record<string, unknown>> {
  return z.strictObject(Object.fromEntries(fields.map((f) => [f.key, fieldSchema(f)]))) as never;
}

// --- section types of TEMPLATE pages -----------------------------------------------------------

export interface CmsSectionType {
  type: string;
  label: string;
  description: string;
  fields: readonly CmsField[];
}

export const CMS_SECTION_TYPES: readonly CmsSectionType[] = [
  {
    type: "hero",
    label: "Hero",
    description: "The page opening: eyebrow, heading, intro and an optional button.",
    fields: [
      { type: "text", key: "eyebrow", label: "Eyebrow", max: 60 },
      { type: "text", key: "title", label: "Heading", max: 120, required: true },
      { type: "text", key: "intro", label: "Intro", max: 400, multiline: true },
      { type: "link", key: "cta", label: "Button" },
    ],
  },
  {
    type: "text",
    label: "Text",
    description: "A heading and body text. A blank line starts a new paragraph.",
    fields: [
      { type: "text", key: "title", label: "Heading", max: 120 },
      {
        type: "text",
        key: "body",
        label: "Body",
        max: 6000,
        required: true,
        multiline: true,
        hint: "Plain text. A blank line starts a new paragraph.",
      },
    ],
  },
  {
    type: "cards",
    label: "Cards",
    description: "A heading and a list of cards (features, services, facts).",
    fields: [
      { type: "text", key: "title", label: "Heading", max: 120 },
      { type: "text", key: "intro", label: "Intro", max: 400, multiline: true },
      {
        type: "list",
        key: "items",
        label: "Cards",
        itemLabel: "Card",
        min: 1,
        max: 12,
        fields: [
          { type: "text", key: "title", label: "Title", max: 120, required: true },
          { type: "text", key: "description", label: "Description", max: 400, multiline: true },
          { type: "link", key: "link", label: "Link" },
        ],
      },
    ],
  },
  {
    type: "cta",
    label: "Call to action",
    description: "A closing message with one button.",
    fields: [
      { type: "text", key: "title", label: "Heading", max: 120, required: true },
      { type: "text", key: "text", label: "Text", max: 400, multiline: true },
      { type: "link", key: "button", label: "Button", required: true },
    ],
  },
  // BV content pages (DP-135): a page opening or block with a registered image, a technical
  // data-sheet style list (term and detail per row), and a pull quote.
  {
    type: "split",
    label: "Image and text",
    description:
      "Heading and text next to a registered site image. As the first section it is the page heading.",
    fields: [
      { type: "text", key: "eyebrow", label: "Eyebrow", max: 60 },
      { type: "text", key: "title", label: "Heading", max: 120, required: true },
      {
        type: "text",
        key: "body",
        label: "Text",
        max: 1200,
        required: true,
        multiline: true,
        hint: "Plain text. A blank line starts a new paragraph.",
      },
      { type: "asset", key: "image", label: "Image", kinds: ["image"] },
      {
        type: "text",
        key: "imageAlt",
        label: "Alt text",
        max: 300,
        required: true,
        multiline: true,
      },
      {
        type: "text",
        key: "imageNote",
        label: "Image note",
        max: 200,
        hint: "Shown under the image, e.g. that a render is illustrative.",
      },
    ],
  },
  {
    type: "specList",
    label: "Specification list",
    description: "A heading and rows of a term with an optional detail, like a data sheet.",
    fields: [
      { type: "text", key: "title", label: "Heading", max: 120, required: true },
      { type: "text", key: "intro", label: "Intro", max: 600, multiline: true },
      {
        type: "list",
        key: "items",
        label: "Rows",
        itemLabel: "Row",
        min: 1,
        max: 16,
        fields: [
          { type: "text", key: "term", label: "Term", max: 160, required: true },
          { type: "text", key: "detail", label: "Detail", max: 300, multiline: true },
        ],
      },
      { type: "link", key: "link", label: "Link" },
    ],
  },
  {
    type: "quote",
    label: "Quote",
    description: "A short statement set large.",
    fields: [
      { type: "text", key: "text", label: "Quote", max: 300, required: true, multiline: true },
      { type: "text", key: "source", label: "Source", max: 120 },
    ],
  },
  {
    type: "contact",
    label: "Contact details and form",
    description:
      "Phone, e-mail and address from the published footer, next to the contact form. The form does not send until it is connected (DP-151); the note says so.",
    fields: [
      { type: "text", key: "title", label: "Heading", max: 120, required: true },
      { type: "text", key: "intro", label: "Introduction", max: 400, multiline: true },
      { type: "text", key: "formTitle", label: "Form heading", max: 120, required: true },
      {
        type: "text",
        key: "formNote",
        label: "Note on the form",
        max: 300,
        required: true,
        multiline: true,
        hint: "Shown above the form while it cannot send messages.",
      },
    ],
  },
];

export const CMS_SECTION_TYPE_KEYS = CMS_SECTION_TYPES.map((s) => s.type);
export const CMS_SECTIONS_MAX = 30;

/** Client-generated section id (stable React key and later preview anchor). */
const SectionIdSchema = z.string().regex(/^[a-z0-9-]{8,40}$/);

const sectionSchema = (allowed: readonly string[]) =>
  z.looseObject({ id: SectionIdSchema, type: z.string() }).transform((value, ctx) => {
    const def = allowed.includes(value.type)
      ? CMS_SECTION_TYPES.find((s) => s.type === value.type)
      : undefined;
    if (!def) {
      ctx.addIssue({ code: "custom", path: ["type"], message: "unknown_section" });
      return z.NEVER;
    }
    const { id, type, ...fields } = value;
    const parsed = cmsFieldsSchema(def.fields).safeParse(fields);
    if (!parsed.success) {
      // The original code is kept as the message; the error envelope reports `custom`.
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: "custom", path: issue.path, message: issue.code });
      }
      return z.NEVER;
    }
    return { id, type, ...parsed.data };
  });

export type CmsSection = { id: string; type: string } & Record<string, unknown>;

const sectionList = (allowed: readonly string[]) =>
  z
    .array(sectionSchema(allowed))
    .max(CMS_SECTIONS_MAX)
    .refine((list) => new Set(list.map((s) => s.id)).size === list.length, {
      message: "duplicate_section_id",
    });

export const CmsTemplateContentSchema = z.strictObject({
  sections: sectionList(CMS_SECTION_TYPE_KEYS),
});
export type CmsTemplateContent = { sections: CmsSection[] };

// --- articles (DP-020: Blog / News) -------------------------------------------------------------

/**
 * A news article is a TEMPLATE page with the template key "article" at `/news/<slug>` (ADR-020
 * addendum, DP-020): the same draft, revision, preview and publication model as every CMS page.
 * Its own fields are a summary and an optional cover image; its body is a list of the text-like
 * section types. Categories, tags, comments and a rich-text editor are out of scope (phase 1).
 * The date shown on the site is the first publication (revision 1), so republishing a correction
 * does not move an article up the list.
 */
export const CMS_ARTICLE_TEMPLATE = "article";
export const CMS_NEWS_PATH = "/news";

export const CMS_ARTICLE_FIELDS: readonly CmsField[] = [
  {
    type: "text",
    key: "excerpt",
    label: "Summary",
    max: 400,
    required: true,
    multiline: true,
    hint: "Shown on the news list and under the article title.",
  },
  {
    type: "asset",
    key: "coverImage",
    label: "Cover image",
    kinds: ["image"],
    required: false,
    hint: "Optional. A registered site image; uploads arrive with the media library.",
  },
  {
    type: "text",
    key: "coverAlt",
    label: "Cover image alt text",
    max: 300,
    multiline: true,
    requiredWith: "coverImage",
    hint: "Required when a cover image is chosen: what the image shows.",
  },
];

/** Section types an article body may use (no page hero, no contact form). */
export const CMS_ARTICLE_SECTION_TYPES: readonly string[] = [
  "text",
  "split",
  "quote",
  "specList",
  "cards",
  "cta",
];

export const CmsArticleContentSchema = z
  .strictObject({
    ...(Object.fromEntries(CMS_ARTICLE_FIELDS.map((f) => [f.key, fieldSchema(f)])) as Record<
      string,
      z.ZodType
    >),
    sections: sectionList(CMS_ARTICLE_SECTION_TYPES),
  })
  .superRefine((value, ctx) => {
    const v = value as Record<string, unknown>;
    if (v["coverImage"] && !v["coverAlt"]) {
      ctx.addIssue({ code: "custom", path: ["coverAlt"], message: "required_with_image" });
    }
  });

export interface CmsArticleContent {
  excerpt: string;
  coverImage: string | null;
  coverAlt: string | null;
  sections: CmsSection[];
}

/** One lower-case kebab-case segment; the article lives at `/news/<slug>`. */
export const CmsArticleSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: "format" });

export function cmsArticlePath(slug: string): string {
  return `${CMS_NEWS_PATH}/${slug}`;
}

/** Whether a page is a news article (TEMPLATE page with the article template). */
export function cmsIsArticle(page: { kind: string; templateKey: string }): boolean {
  return page.kind === "TEMPLATE" && page.templateKey === CMS_ARTICLE_TEMPLATE;
}

/** The slug of a page path: `/about-us` → about-us, `/news/x` → x (articles). */
export function cmsSlugOfPath(path: string): string {
  return path.startsWith(`${CMS_NEWS_PATH}/`)
    ? path.slice(CMS_NEWS_PATH.length + 1)
    : path.slice(1);
}

// --- the site registry: every page of the two apps and who manages it -------------------------

export const CMS_SITE_KEYS = ["BV", "CORPORATE"] as const;
export type CmsSiteKey = (typeof CMS_SITE_KEYS)[number];

/**
 * How a route of the web apps is managed today.
 *  - cms_pending: becomes a DESIGN page or FRAGMENT when it is imported (stage in `stage`);
 *  - contract:    versioned legal text in @dream/contracts (privacy, consent); never the CMS;
 *  - catalog:     product data from the catalogue module; never the CMS.
 */
export interface CmsRegistryEntry {
  key: string;
  site: CmsSiteKey;
  kind: "DESIGN" | "FRAGMENT" | "TEMPLATE" | "LEGAL" | "CATALOG";
  title: string;
  path: string | null;
  managedBy: "cms_pending" | "contract" | "catalog";
  stage: "S2" | "S4" | "content" | null;
  note: string;
  /** The API holds an import seed for it (admin shows "Import into CMS"). */
  importable?: boolean;
}

export const CMS_SITE_REGISTRY: readonly CmsRegistryEntry[] = [
  {
    key: "bv.home",
    site: "BV",
    kind: "DESIGN",
    title: "Home",
    path: "/",
    managedBy: "cms_pending",
    stage: "S2",
    note: "Hero, product groups, services, CTL technology and applications. Motion stays in code.",
    importable: true,
  },
  {
    key: "bv.products-index",
    site: "BV",
    kind: "DESIGN",
    title: "Products",
    path: "/products",
    managedBy: "cms_pending",
    stage: "S2",
    note: "Heading, intro and SEO. The products themselves stay in the catalogue.",
  },
  {
    key: "bv.news-index",
    site: "BV",
    kind: "DESIGN",
    title: "News",
    path: "/news",
    managedBy: "cms_pending",
    stage: "content",
    note: "Heading, introduction and empty state of the news list (DP-153). The articles are under News.",
    importable: true,
  },
  {
    key: "bv.site-nav",
    site: "BV",
    kind: "FRAGMENT",
    title: "Navigation",
    path: null,
    managedBy: "cms_pending",
    stage: "S2",
    note: "Menu items and contact link of every page.",
    importable: true,
  },
  {
    key: "bv.site-footer",
    site: "BV",
    kind: "FRAGMENT",
    title: "Footer",
    path: null,
    managedBy: "cms_pending",
    stage: "S2",
    note: "Headline, contact details, link columns and legal links.",
    importable: true,
  },
  {
    key: "bv.about-us",
    site: "BV",
    kind: "TEMPLATE",
    title: "About Us",
    path: "/about-us",
    managedBy: "cms_pending",
    stage: "content",
    note: "From the live site (DP-135). Market images not used: stock photos unrelated to the markets.",
    importable: true,
  },
  {
    key: "bv.energy-trading",
    site: "BV",
    kind: "TEMPLATE",
    title: "Energy Trading & Supply",
    path: "/energy-trading",
    managedBy: "cms_pending",
    stage: "content",
    note: "From the live site (DP-135); the unsourced +12% figure is left out.",
    importable: true,
  },
  {
    key: "bv.logistics",
    site: "BV",
    kind: "TEMPLATE",
    title: "Logistics",
    path: "/logistics",
    managedBy: "cms_pending",
    stage: "content",
    note: "From the live site (DP-135).",
    importable: true,
  },
  {
    key: "bv.storage-distribution",
    site: "BV",
    kind: "TEMPLATE",
    title: "Storage & Distribution",
    path: "/storage-distribution",
    managedBy: "cms_pending",
    stage: "content",
    note: "From the live site (DP-135).",
    importable: true,
  },
  {
    key: "bv.contact",
    site: "BV",
    kind: "TEMPLATE",
    title: "Contact Us",
    path: "/contact",
    managedBy: "cms_pending",
    stage: "content",
    note: "DP-150. Contact details come from the published footer; the form sends nothing until DP-151.",
    importable: true,
  },
  {
    key: "bv.strategic-partnership",
    site: "BV",
    kind: "TEMPLATE",
    title: "Strategic Partnership",
    path: "/strategic-partnership",
    managedBy: "cms_pending",
    stage: "content",
    note: "Next package: the partnership models need confirmation by Dream Petroleum.",
  },
  {
    key: "bv.sustainability",
    site: "BV",
    kind: "TEMPLATE",
    title: "Sustainability",
    path: "/sustainability",
    managedBy: "cms_pending",
    stage: "content",
    note: "Next package: the net-zero 2050 commitment needs confirmation by Dream Petroleum.",
  },
  {
    key: "bv.our-team",
    site: "BV",
    kind: "TEMPLATE",
    title: "Our Leadership Team",
    path: "/our-team",
    managedBy: "cms_pending",
    stage: "content",
    note: "Not built: the live page has no names, photos or figures (placeholders only).",
  },
  {
    key: "bv.product-detail",
    site: "BV",
    kind: "CATALOG",
    title: "Product pages",
    path: "/products/{slug}",
    managedBy: "catalog",
    stage: null,
    note: "Published product snapshots. Edit them under Products.",
  },
  {
    key: "bv.privacy",
    site: "BV",
    kind: "LEGAL",
    title: "Privacy Policy",
    path: "/privacy",
    managedBy: "contract",
    stage: null,
    note: "Versioned legal text tied to consent records. Changed only through a new version.",
  },
  {
    key: "corporate.home",
    site: "CORPORATE",
    kind: "DESIGN",
    title: "Home",
    path: "/",
    managedBy: "cms_pending",
    stage: "S4",
    note: "Skeleton today. Built from the dreampetroleum.com inventory in S4.",
  },
  {
    key: "corporate.privacy",
    site: "CORPORATE",
    kind: "LEGAL",
    title: "Privacy Policy",
    path: "/privacy",
    managedBy: "contract",
    stage: null,
    note: "Versioned legal text tied to consent records. Changed only through a new version.",
  },
];

// --- requests --------------------------------------------------------------------------------

export const CmsSeoSchema = z.strictObject({
  title: optionalText(120),
  description: optionalText(320),
  noindex: z.boolean(),
});
export type CmsSeo = z.infer<typeof CmsSeoSchema>;

export const CmsPageCreateRequestSchema = z.strictObject({
  title: requiredText(200),
  slug: CmsSlugSchema,
  template: z.literal(CMS_STANDARD_TEMPLATE).optional(),
});
export type CmsPageCreateRequest = z.input<typeof CmsPageCreateRequestSchema>;

/** DP-020: creates an empty news article (a draft at `/news/<slug>`). */
export const CmsArticleCreateRequestSchema = z.strictObject({
  title: requiredText(200),
  slug: CmsArticleSlugSchema,
  template: z.literal(CMS_ARTICLE_TEMPLATE),
});
export type CmsArticleCreateRequest = z.input<typeof CmsArticleCreateRequestSchema>;

/** Saves the whole draft of a TEMPLATE page. DESIGN pages and fragments arrive with S2. */
export const CmsPageDraftRequestSchema = z.strictObject({
  version: VersionSchema,
  title: requiredText(200),
  slug: CmsSlugSchema,
  seo: CmsSeoSchema,
  content: CmsTemplateContentSchema,
});
export type CmsPageDraftRequest = z.input<typeof CmsPageDraftRequestSchema>;

/** DP-020: saves the whole draft of a news article. */
export const CmsArticleDraftRequestSchema = z.strictObject({
  version: VersionSchema,
  title: requiredText(200),
  slug: CmsArticleSlugSchema,
  seo: CmsSeoSchema,
  content: CmsArticleContentSchema,
});
export type CmsArticleDraftRequest = z.input<typeof CmsArticleDraftRequestSchema>;

// --- responses -------------------------------------------------------------------------------

const SiteKeySchema = z.enum(CMS_SITE_KEYS);

export const CmsSiteSchema = z.object({
  id: UuidSchema,
  key: SiteKeySchema,
  name: z.string(),
  locale: z.string(),
  canEdit: z.boolean(),
  canPublish: z.boolean(),
});
export type CmsSite = z.infer<typeof CmsSiteSchema>;

export const CmsContextResponseSchema = z.object({ sites: z.array(CmsSiteSchema) });
export type CmsContextResponse = z.infer<typeof CmsContextResponseSchema>;

const UserRefSchema = z.object({ id: UuidSchema, name: z.string() });

/** S2: the page's current publication (one per page; PM-3 pattern). */
export const CmsPublicationSchema = z.object({
  status: z.enum(["PUBLISHED", "UNPUBLISHED"]),
  revisionNumber: z.number().int(),
  /** The draft version that was published; differs from the page version after an edit. */
  pageVersion: z.number().int(),
  publishedAt: IsoDate,
  publishedBy: UserRefSchema,
  unpublishedAt: IsoDate.nullable(),
  unpublishedBy: UserRefSchema.nullable(),
  version: z.number().int(),
});
export type CmsPublication = z.infer<typeof CmsPublicationSchema>;

export const CmsPageSummarySchema = z.object({
  id: UuidSchema,
  siteId: UuidSchema,
  kind: CmsPageKindSchema,
  templateKey: z.string(),
  path: z.string().nullable(),
  title: z.string(),
  locale: z.string(),
  sectionCount: z.number().int(),
  version: z.number().int(),
  updatedAt: IsoDate,
  updatedBy: UserRefSchema,
  publication: CmsPublicationSchema.nullable(),
});
export type CmsPageSummary = z.infer<typeof CmsPageSummarySchema>;

export const CmsPageListResponseSchema = z.object({
  site: CmsSiteSchema,
  items: z.array(CmsPageSummarySchema),
});
export type CmsPageListResponse = z.infer<typeof CmsPageListResponseSchema>;

export const CmsPageSchema = CmsPageSummarySchema.extend({
  slug: z.string().nullable(),
  seo: z.object({
    title: z.string().nullable(),
    description: z.string().nullable(),
    noindex: z.boolean(),
  }),
  /** TEMPLATE pages: `{ sections }`; DESIGN pages and fragments: their template's fields. */
  content: z.record(z.string(), z.unknown()),
  createdAt: IsoDate,
  createdBy: UserRefSchema,
});
export type CmsPage = z.infer<typeof CmsPageSchema>;

export const CmsPageResponseSchema = z.object({ page: CmsPageSchema, site: CmsSiteSchema });
export type CmsPageResponse = z.infer<typeof CmsPageResponseSchema>;
