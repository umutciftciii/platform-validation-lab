/**
 * CMS S2 (DP-134, ADR-020 D1/D7): the field sets of the BV site's designed page and fragments.
 *
 * The components, layout and motion of these pages stay in apps/web-bv; these descriptors list
 * only what an editor may change. UI strings and accessibility labels of the components (carousel
 * controls, skip links) stay in code (ADR-020 D3, DP-138). The brand logo stays in code too.
 *
 * Claims: the disclosure and status fields below are required, so the notes the source documents
 * demand (CGI images, AI concepts, temporary animations, the ICCSYN testing caveat) cannot be
 * removed by emptying a field (R-27).
 *
 * The TypeScript types describe the validated content (`cmsFieldsSchema(fields)` output); a unit
 * test checks the seed against both.
 */
import type { z } from "zod";
import type { CmsField } from "./cms.js";
import {
  BV_FOOTER_KEY,
  BV_NAV_KEY,
  BvFooterMenuSchema,
  BvNavMenuSchema,
  CORPORATE_FOOTER_KEY,
  CORPORATE_NAV_KEY,
} from "./cms-menu.js";
import {
  CORPORATE_HOME_FIELDS,
  CORPORATE_HOME_KEY,
  CORPORATE_PRODUCTS_FIELDS,
  CORPORATE_PRODUCTS_KEY,
  CORPORATE_PRODUCTS_PATH,
} from "./cms-corporate.js";

const text = (key: string, label: string, max: number, extra: Partial<CmsField> = {}): CmsField =>
  ({ type: "text", key, label, max, required: true, ...extra }) as CmsField;
const optional = (key: string, label: string, max: number, multiline = false): CmsField => ({
  type: "text",
  key,
  label,
  max,
  multiline,
});
const long = (key: string, label: string, max: number): CmsField =>
  text(key, label, max, { multiline: true });
const anchor = (hint = "Lower-case id, e.g. group-1. Used for links to this item."): CmsField =>
  text("anchor", "Anchor", 60, { format: "anchor", hint });
const position = (key: string, label: string): CmsField =>
  text(key, label, 12, { format: "position", hint: "Focal point, e.g. 50% 30%." });
const image = (key: string, label: string): CmsField => ({
  type: "asset",
  key,
  label,
  kinds: ["image"],
});
const link = (key: string, label: string): CmsField => ({
  type: "link",
  key,
  label,
  required: true,
});
const group = (key: string, label: string, fields: CmsField[]): CmsField => ({
  type: "group",
  key,
  label,
  fields,
});

// --- bv.home -----------------------------------------------------------------------------------

export const BV_HOME_FIELDS: readonly CmsField[] = [
  {
    type: "group",
    key: "hero",
    label: "Hero (ICCSYN)",
    hint: "The animation and its scroll length stay in code. Every application needs a source document.",
    fields: [
      text("brand", "Wordmark", 60),
      text("tagline", "Tagline", 120),
      text("scrollCue", "Scroll cue", 60),
      {
        type: "group",
        key: "cta",
        label: "Button",
        fields: [
          text("label", "Label", 80),
          text("href", "Link", 500, {
            format: "href",
            required: false,
            hint: "Empty: the button is shown disabled with the note below.",
          }),
          text("disabledNote", "Note while disabled", 200),
        ],
      },
      text("supply", "Supply line", 200),
      long("legal", "Legal note", 400),
      long("mediaAlt", "Alt text of the laboratory film", 300),
      {
        type: "list",
        key: "applications",
        label: "Application cards",
        itemLabel: "Card",
        min: 6,
        max: 6,
        hint: "Exactly six: the scatter of the animation has six places.",
        fields: [
          text("title", "Title", 120),
          long("description", "Description", 300),
          image("image", "Image"),
        ],
      },
    ],
  },
  {
    type: "group",
    key: "productGroups",
    label: "Product groups",
    fields: [
      text("label", "Section label", 60),
      long("disclosure", "Disclosure (required)", 400),
      {
        type: "list",
        key: "groups",
        label: "Groups",
        itemLabel: "Group",
        min: 1,
        max: 6,
        unique: "anchor",
        fields: [
          anchor(),
          text("nameWord", "Name", 40),
          text("nameNumeral", "Numeral (accent colour)", 10),
          text("eyebrow", "Eyebrow", 60),
          long("description", "Description", 400),
          optional("note", "Qualifier note", 300, true),
          text("samples", "Sample grades", 120),
          link("cta", "Button"),
          { type: "asset", key: "animation", label: "Animation", kinds: ["animation"] },
          image("poster", "Poster (first frame)"),
          long("mediaAlt", "Alt text", 300),
        ],
      },
    ],
  },
  {
    type: "group",
    key: "services",
    label: "Services",
    fields: [
      text("eyebrow", "Eyebrow", 60),
      text("title", "Heading", 120),
      long("intro", "Intro", 400),
      long("disclosure", "Image disclosure (required)", 300),
      {
        type: "list",
        key: "items",
        label: "Services",
        itemLabel: "Service",
        min: 1,
        max: 6,
        unique: "anchor",
        fields: [
          anchor(),
          text("title", "Title", 120),
          long("description", "Description (desktop)", 500),
          long("shortDescription", "Short description (phones)", 300),
          link("cta", "Button"),
          long("imageAlt", "Alt text", 300),
          image("desktopImage", "Image, desktop (4:3)"),
          position("desktopPosition", "Focus, desktop"),
          image("mobileImage", "Image, phones (3:4)"),
          position("mobilePosition", "Focus, phones"),
        ],
      },
    ],
  },
  {
    type: "group",
    key: "ctl",
    label: "CTL technology",
    hint: "No performance figures here: binding values are on each lot's TDS or CoA.",
    fields: [
      text("eyebrow", "Eyebrow", 60),
      text("title", "Heading", 120),
      link("document", "Document link"),
      {
        type: "list",
        key: "stages",
        label: "Process stages",
        itemLabel: "Stage",
        min: 3,
        max: 3,
        hint: "Exactly three: the scroll animation hands over between three images.",
        unique: "anchor",
        fields: [
          anchor(),
          text("title", "Title", 120),
          long("description", "Description", 600),
          long("disclosure", "Image disclosure (required)", 300),
          image("image", "Image"),
          long("imageAlt", "Alt text", 300),
          position("positionDesktop", "Focus, desktop"),
          position("positionMobile", "Focus, phones"),
        ],
      },
    ],
  },
  {
    type: "group",
    key: "applications",
    label: "Application concepts",
    hint: "AI concepts only: no suitability, safety or certification claim. Status and disclosures must stay visible.",
    fields: [
      text("eyebrow", "Eyebrow", 60),
      text("title", "Heading", 120),
      text("status", "Status label (required)", 80),
      long("intro", "Intro", 400),
      {
        type: "group",
        key: "validation",
        label: "Validation box",
        fields: [
          text("title", "Heading", 120),
          long("intro", "Intro", 300),
          {
            type: "list",
            key: "requirements",
            label: "Requirements",
            itemLabel: "Requirement",
            min: 1,
            max: 6,
            fields: [text("text", "Requirement", 200)],
          },
          long("note", "Note", 300),
          link("cta", "Button"),
        ],
      },
      {
        type: "list",
        key: "scenes",
        label: "Concepts",
        itemLabel: "Concept",
        min: 3,
        max: 3,
        hint: "Exactly three: the scroll animation hands over between three scenes.",
        unique: "anchor",
        fields: [
          anchor(),
          text("title", "Title", 120),
          long("description", "Description", 400),
          long("disclosure", "Disclosure (required)", 300),
          link("cta", "Button"),
          image("image", "Image, desktop"),
          image("imageSmall", "Image, phones"),
          long("imageAlt", "Alt text", 400),
          position("positionDesktop", "Focus, desktop"),
        ],
      },
    ],
  },
];

export interface BvHomeContent {
  hero: {
    brand: string;
    tagline: string;
    scrollCue: string;
    cta: { label: string; href: string | null; disabledNote: string };
    supply: string;
    legal: string;
    mediaAlt: string;
    applications: { title: string; description: string; image: string }[];
  };
  productGroups: {
    label: string;
    disclosure: string;
    groups: {
      anchor: string;
      nameWord: string;
      nameNumeral: string;
      eyebrow: string;
      description: string;
      note: string | null;
      samples: string;
      cta: { label: string; href: string };
      animation: string;
      poster: string;
      mediaAlt: string;
    }[];
  };
  services: {
    eyebrow: string;
    title: string;
    intro: string;
    disclosure: string;
    items: {
      anchor: string;
      title: string;
      description: string;
      shortDescription: string;
      cta: { label: string; href: string };
      imageAlt: string;
      desktopImage: string;
      desktopPosition: string;
      mobileImage: string;
      mobilePosition: string;
    }[];
  };
  ctl: {
    eyebrow: string;
    title: string;
    document: { label: string; href: string };
    stages: {
      anchor: string;
      title: string;
      description: string;
      disclosure: string;
      image: string;
      imageAlt: string;
      positionDesktop: string;
      positionMobile: string;
    }[];
  };
  applications: {
    eyebrow: string;
    title: string;
    status: string;
    intro: string;
    validation: {
      title: string;
      intro: string;
      requirements: { text: string }[];
      note: string;
      cta: { label: string; href: string };
    };
    scenes: {
      anchor: string;
      title: string;
      description: string;
      disclosure: string;
      cta: { label: string; href: string };
      image: string;
      imageSmall: string;
      imageAlt: string;
      positionDesktop: string;
    }[];
  };
}

// --- bv.site-nav, bv.site-footer (DP-219) ---------------------------------------------------------

/**
 * The header and footer menus have their own schema and editor (cms-menu.ts, content schema
 * version 2: content references, submenus, visibility, new tab, social links); version 1 content
 * is read as version 2. They stay fragments of this registry with the shared CMS flow.
 */
// --- bv.news-index (DP-153) -----------------------------------------------------------------------

/**
 * The heading of the news list at /news: the articles themselves are TEMPLATE pages (DP-020); the
 * list's eyebrow, title, introduction and empty state are this designed page, so an editor changes
 * them through the same draft, preview and publication flow. The page title and SEO fields of the
 * page give the browser title and description.
 */
export const BV_NEWS_INDEX_FIELDS: readonly CmsField[] = [
  text("eyebrow", "Eyebrow", 40),
  text("title", "Heading", 120),
  long("intro", "Introduction", 400),
  group("empty", "When no article is published", [
    text("title", "Heading", 120),
    long("text", "Text", 400),
  ]),
];

export interface BvNewsIndexContent {
  eyebrow: string;
  title: string;
  intro: string;
  empty: { title: string; text: string };
}

/** COM-3: the heading of the corporate news list (`/<l>/news`), the same fields as on BV. */
export const CORPORATE_NEWS_INDEX_KEY = "corporate.news-index";
export const CORPORATE_NEWS_INDEX_FIELDS: readonly CmsField[] = BV_NEWS_INDEX_FIELDS;
export type CmsNewsIndexContent = BvNewsIndexContent;

/** COM-3: the designed page that holds the heading of each site's news list. */
export const CMS_NEWS_INDEX_KEYS = {
  BV: "bv.news-index",
  CORPORATE: CORPORATE_NEWS_INDEX_KEY,
} as const;
/** Whether a registry key is the news list heading of a site. */
export function cmsIsNewsIndex(templateKey: string): boolean {
  return templateKey === CMS_NEWS_INDEX_KEYS.BV || templateKey === CMS_NEWS_INDEX_KEYS.CORPORATE;
}

// --- bv.site-seo (DP-209) ---------------------------------------------------------------------------

/**
 * The site-wide SEO defaults of the BV site: used where a page has no value of its own (a page
 * without a meta description, an Open Graph image or a title of its own), and the site name of
 * link previews and of the titles the site builds (e.g. "Products | <site name>"). A fragment:
 * edited, published and restored like the navigation and the footer, so the defaults change on
 * the site only when they are published. Lengths are advice in the admin, not limits.
 */
export const BV_SITE_SEO_FIELDS: readonly CmsField[] = [
  text("siteName", "Site name", 80, {
    hint: "Shown as the site name of link previews and after the page name in browser titles.",
  }),
  text("defaultTitle", "Default SEO title", 120, {
    hint: "For pages without a title of their own (e.g. the home page without an SEO title).",
  }),
  long("defaultDescription", "Default meta description", 320),
  {
    type: "asset",
    key: "defaultOgImage",
    label: "Default Open Graph image",
    kinds: ["image"],
    hint: "Shown in link previews of pages without an image of their own. About 1200×630 works best.",
  },
];

export interface BvSiteSeoContent {
  siteName: string;
  defaultTitle: string;
  defaultDescription: string;
  defaultOgImage: string;
}

/** DP-209: the registry key of the site SEO defaults. */
export const BV_SITE_SEO_KEY = "bv.site-seo";

/**
 * COM-1: the SEO defaults of dreampetroleum.com — the same fields as `bv.site-seo`, except that the
 * default Open Graph image is optional: the registered static assets (CMS_STATIC_ASSETS) are files
 * of the BV site, and the corporate site has none of its own yet (its media comes with COM-2/COM-5).
 */
export const CORPORATE_SITE_SEO_KEY = "corporate.site-seo";
export const CORPORATE_SITE_SEO_FIELDS: readonly CmsField[] = BV_SITE_SEO_FIELDS.map((f) =>
  f.key === "defaultOgImage" && f.type === "asset" ? { ...f, required: false } : f,
);

/** COM-1: the SEO defaults fragment of each site. */
export const CMS_SITE_SEO_KEYS = {
  BV: BV_SITE_SEO_KEY,
  CORPORATE: CORPORATE_SITE_SEO_KEY,
} as const;
export function cmsIsSiteSeo(templateKey: string): boolean {
  return templateKey === BV_SITE_SEO_KEY || templateKey === CORPORATE_SITE_SEO_KEY;
}
/** The fields of a site SEO defaults fragment (by its registry key). */
export function cmsSiteSeoFields(templateKey: string): readonly CmsField[] {
  return templateKey === CORPORATE_SITE_SEO_KEY ? CORPORATE_SITE_SEO_FIELDS : BV_SITE_SEO_FIELDS;
}

// --- registry of designed templates --------------------------------------------------------------

export interface CmsDesignTemplate {
  key: string;
  site: "BV" | "CORPORATE";
  kind: "DESIGN" | "FRAGMENT";
  title: string;
  path: string | null;
  fields: readonly CmsField[];
  /**
   * DP-219: a schema of its own instead of the generic field form (the menus). The admin shows a
   * dedicated editor for it; `fields` is empty.
   */
  schema?: z.ZodType;
}

export const CMS_DESIGN_TEMPLATES: readonly CmsDesignTemplate[] = [
  { key: "bv.home", site: "BV", kind: "DESIGN", title: "Home", path: "/", fields: BV_HOME_FIELDS },
  {
    key: BV_NAV_KEY,
    site: "BV",
    kind: "FRAGMENT",
    title: "Navigation",
    path: null,
    fields: [],
    schema: BvNavMenuSchema,
  },
  {
    key: BV_FOOTER_KEY,
    site: "BV",
    kind: "FRAGMENT",
    title: "Footer",
    path: null,
    fields: [],
    schema: BvFooterMenuSchema,
  },
  {
    key: "bv.news-index",
    site: "BV",
    kind: "DESIGN",
    title: "News",
    path: "/news",
    fields: BV_NEWS_INDEX_FIELDS,
  },
  {
    key: BV_SITE_SEO_KEY,
    site: "BV",
    kind: "FRAGMENT",
    title: "SEO defaults",
    path: null,
    fields: BV_SITE_SEO_FIELDS,
  },
  // COM-2b: the designed pages of dreampetroleum.com (cms-corporate.ts).
  {
    key: CORPORATE_HOME_KEY,
    site: "CORPORATE",
    kind: "DESIGN",
    title: "Home",
    path: "/",
    fields: CORPORATE_HOME_FIELDS,
  },
  {
    key: CORPORATE_PRODUCTS_KEY,
    site: "CORPORATE",
    kind: "DESIGN",
    title: "Products",
    path: CORPORATE_PRODUCTS_PATH,
    fields: CORPORATE_PRODUCTS_FIELDS,
  },
  // COM-3: the heading of the corporate news list (the articles are TEMPLATE pages).
  {
    key: CORPORATE_NEWS_INDEX_KEY,
    site: "CORPORATE",
    kind: "DESIGN",
    title: "News",
    path: "/news",
    fields: CORPORATE_NEWS_INDEX_FIELDS,
  },
  // COM-1: the fragments of dreampetroleum.com.
  {
    key: CORPORATE_NAV_KEY,
    site: "CORPORATE",
    kind: "FRAGMENT",
    title: "Navigation",
    path: null,
    fields: [],
    schema: BvNavMenuSchema,
  },
  {
    key: CORPORATE_FOOTER_KEY,
    site: "CORPORATE",
    kind: "FRAGMENT",
    title: "Footer",
    path: null,
    fields: [],
    schema: BvFooterMenuSchema,
  },
  {
    key: CORPORATE_SITE_SEO_KEY,
    site: "CORPORATE",
    kind: "FRAGMENT",
    title: "SEO defaults",
    path: null,
    fields: CORPORATE_SITE_SEO_FIELDS,
  },
];

export function cmsDesignTemplate(key: string): CmsDesignTemplate | undefined {
  return CMS_DESIGN_TEMPLATES.find((t) => t.key === key);
}

/** The fragments a BV page shows around its content. */
export const BV_FRAGMENT_KEYS = ["bv.site-nav", "bv.site-footer"] as const;
/** COM-1: the fragments a corporate page shows around its content. */
export const CORPORATE_FRAGMENT_KEYS = ["corporate.site-nav", "corporate.site-footer"] as const;
