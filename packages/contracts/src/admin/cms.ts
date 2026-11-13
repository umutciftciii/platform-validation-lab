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
      hint?: string;
    };

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

function fieldSchema(field: CmsField): z.ZodType {
  switch (field.type) {
    case "text":
      return field.required ? requiredText(field.max) : optionalText(field.max);
    case "link":
      return field.required ? CmsLinkSchema : CmsLinkSchema.nullish().transform((v) => v ?? null);
    case "list":
      return z.array(cmsFieldsSchema(field.fields)).min(field.min).max(field.max);
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
];

export const CMS_SECTION_TYPE_KEYS = CMS_SECTION_TYPES.map((s) => s.type);
export const CMS_SECTIONS_MAX = 30;

/** Client-generated section id (stable React key and later preview anchor). */
const SectionIdSchema = z.string().regex(/^[a-z0-9-]{8,40}$/);

const SectionSchema = z
  .looseObject({ id: SectionIdSchema, type: z.string() })
  .transform((value, ctx) => {
    const def = CMS_SECTION_TYPES.find((s) => s.type === value.type);
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

export const CmsTemplateContentSchema = z.strictObject({
  sections: z
    .array(SectionSchema)
    .max(CMS_SECTIONS_MAX)
    .refine((list) => new Set(list.map((s) => s.id)).size === list.length, {
      message: "duplicate_section_id",
    }),
});
export type CmsTemplateContent = { sections: CmsSection[] };

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
  kind: "DESIGN" | "FRAGMENT" | "LEGAL" | "CATALOG";
  title: string;
  path: string | null;
  managedBy: "cms_pending" | "contract" | "catalog";
  stage: "S2" | "S4" | null;
  note: string;
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
    key: "bv.site-nav",
    site: "BV",
    kind: "FRAGMENT",
    title: "Navigation",
    path: null,
    managedBy: "cms_pending",
    stage: "S2",
    note: "Menu items and contact link of every page.",
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
});
export type CmsPageCreateRequest = z.input<typeof CmsPageCreateRequestSchema>;

/** Saves the whole draft of a TEMPLATE page. DESIGN pages and fragments arrive with S2. */
export const CmsPageDraftRequestSchema = z.strictObject({
  version: VersionSchema,
  title: requiredText(200),
  slug: CmsSlugSchema,
  seo: CmsSeoSchema,
  content: CmsTemplateContentSchema,
});
export type CmsPageDraftRequest = z.input<typeof CmsPageDraftRequestSchema>;

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
  content: z.object({ sections: z.array(z.looseObject({ id: z.string(), type: z.string() })) }),
  createdAt: IsoDate,
  createdBy: UserRefSchema,
});
export type CmsPage = z.infer<typeof CmsPageSchema>;

export const CmsPageResponseSchema = z.object({ page: CmsPageSchema, site: CmsSiteSchema });
export type CmsPageResponse = z.infer<typeof CmsPageResponseSchema>;
