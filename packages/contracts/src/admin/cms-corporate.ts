/**
 * COM-2b (DP-028, DP-094): the field sets of the corporate site's designed pages — the home page
 * (`corporate.home`) and the product portfolio (`corporate.products`, one page at /products with
 * anchored groups, as on the live dreampetroleum.com). The layout stays in apps/web-corporate;
 * these descriptors list only what an editor may change. COM-7: images come from the corporate
 * visual pack (registered CORPORATE assets, representative scenes); the fields added then are
 * optional on read (`optional`, nullable assets), so content stored before COM-7 stays valid.
 *
 * Claims (owner decisions 2026-11-27, DP-003): there is no field for a distributorship claim, a
 * counter, a customer testimonial or a FAQ with commercial commitments, so none can be published
 * by mistake. The typical values table of the portfolio stays hidden while it has no rows; it is
 * filled only once the source of the values is approved (DP-002).
 *
 * The TypeScript types describe the validated content (`cmsFieldsSchema(fields)` output); a unit
 * test checks the seeds against both.
 */
import type { CmsField } from "./cms.js";

const text = (key: string, label: string, max: number, extra: Partial<CmsField> = {}): CmsField =>
  ({ type: "text", key, label, max, required: true, ...extra }) as CmsField;
const optional = (key: string, label: string, max: number, multiline = false): CmsField => ({
  type: "text",
  key,
  label,
  max,
  multiline,
});
const long = (key: string, label: string, max: number, hint?: string): CmsField =>
  text(key, label, max, { multiline: true, ...(hint ? { hint } : {}) });
const href = (): CmsField =>
  text("href", "Link", 500, {
    format: "href",
    required: false,
    hint: "A path of this site, e.g. /products#base-oils-group1. Empty: the card is not a link.",
  });
const link = (key: string, label: string, required = true): CmsField => ({
  type: "link",
  key,
  label,
  required,
});
const PARAGRAPHS = "Plain text. A blank line starts a new paragraph.";
/** COM-7: a registered corporate image and its alt text (both optional). */
const image = (key = "image"): CmsField[] => [
  {
    type: "asset",
    key,
    label: "Image",
    kinds: ["image"],
    required: false,
    hint: "A representative scene; never presented as the company's own site or fleet.",
  },
  {
    type: "text",
    key: `${key}Alt`,
    label: "Alt text",
    max: 300,
    requiredWith: key,
    multiline: true,
  },
];

// --- corporate.home -----------------------------------------------------------------------------

export const CORPORATE_HOME_KEY = "corporate.home";

export const CORPORATE_HOME_FIELDS: readonly CmsField[] = [
  {
    type: "group",
    key: "hero",
    label: "Hero",
    hint: "The page heading. No distributorship claim or figure without the owner's confirmation.",
    fields: [
      optional("eyebrow", "Eyebrow", 60),
      text("title", "Heading", 120),
      long("intro", "Intro", 400),
      link("primary", "Button"),
      link("secondary", "Second button", false),
      // COM-7: the activity areas the visitor switches between (picture, heading, text, button).
      {
        type: "list",
        key: "slides",
        label: "Activity areas",
        itemLabel: "Activity area",
        min: 0,
        max: 4,
        optional: true,
        hint: "Shown as tabs over the picture. None: the heading above alone.",
        fields: [
          text("label", "Tab label", 40),
          text("title", "Heading", 120),
          long("intro", "Intro", 300),
          {
            type: "asset",
            key: "image",
            label: "Image",
            kinds: ["image"],
            hint: "A representative scene; never presented as the company's own site or fleet.",
          },
          {
            type: "text",
            key: "imageAlt",
            label: "Alt text",
            max: 300,
            requiredWith: "image",
            multiline: true,
          },
          link("cta", "Button", false),
        ],
      },
    ],
  },
  {
    type: "group",
    key: "overview",
    label: "Company overview",
    fields: [
      text("eyebrow", "Eyebrow", 60),
      text("title", "Heading", 200),
      long("body", "Body", 1200, PARAGRAPHS),
      {
        type: "list",
        key: "highlights",
        label: "Highlights",
        itemLabel: "Highlight",
        min: 0,
        max: 4,
        fields: [text("title", "Title", 120), long("description", "Description", 400)],
      },
      link("link", "Link", false),
    ],
  },
  {
    type: "group",
    key: "services",
    label: "Services",
    fields: [
      text("eyebrow", "Eyebrow", 60),
      text("title", "Heading", 120),
      optional("intro", "Intro", 400, true),
      {
        type: "list",
        key: "items",
        label: "Services",
        itemLabel: "Service",
        min: 1,
        max: 6,
        fields: [
          text("title", "Title", 120),
          optional("description", "Description", 400, true),
          href(),
          ...image(),
        ],
      },
    ],
  },
  {
    type: "group",
    key: "productGroups",
    label: "Product groups",
    fields: [
      text("eyebrow", "Eyebrow", 60),
      text("title", "Heading", 120),
      optional("intro", "Intro", 400, true),
      {
        type: "list",
        key: "items",
        label: "Groups",
        itemLabel: "Group",
        min: 1,
        max: 6,
        fields: [
          text("title", "Title", 120),
          optional("description", "Description", 400, true),
          href(),
        ],
      },
      link("link", "Link", false),
    ],
  },
  {
    type: "group",
    key: "strengths",
    label: "Strengths",
    hint: "Qualitative statements only: no counters or percentages without a confirmed source.",
    fields: [
      text("eyebrow", "Eyebrow", 60),
      text("title", "Heading", 120),
      {
        type: "list",
        key: "items",
        label: "Strengths",
        itemLabel: "Strength",
        min: 1,
        max: 6,
        fields: [text("title", "Title", 120), long("description", "Description", 400)],
      },
    ],
  },
  // COM-7: the latest articles of the news model under this heading (none published: hidden).
  {
    type: "group",
    key: "news",
    label: "Latest news",
    optional: true,
    hint: "The three newest published articles are listed under this heading.",
    fields: [
      optional("eyebrow", "Eyebrow", 60),
      optional("title", "Heading", 120),
      link("link", "Link", false),
    ],
  },
  {
    type: "group",
    key: "cta",
    label: "Call to action",
    fields: [
      text("title", "Heading", 160),
      optional("text", "Text", 400, true),
      {
        type: "list",
        key: "points",
        label: "Points",
        itemLabel: "Point",
        min: 0,
        max: 6,
        fields: [text("text", "Text", 200)],
      },
      link("button", "Button"),
      ...image(),
    ],
  },
];

type Link = { label: string; href: string };
/** A card of the home page; `href` null: not a link. */
type HomeCard = { title: string; description: string | null; href: string | null };
/** COM-7: a service card may carry a registered corporate image. */
type ServiceCard = HomeCard & { image?: string | null; imageAlt?: string | null };
/** COM-7: one activity area of the home page's opening. */
export interface CorporateHeroSlide {
  label: string;
  title: string;
  intro: string;
  image: string;
  imageAlt: string | null;
  cta: Link | null;
}

export interface CorporateHomeContent {
  hero: {
    eyebrow: string | null;
    title: string;
    intro: string;
    primary: Link;
    secondary: Link | null;
    /** COM-7 (empty in content stored before it). */
    slides?: CorporateHeroSlide[];
  };
  overview: {
    eyebrow: string;
    title: string;
    body: string;
    highlights: { title: string; description: string }[];
    link: Link | null;
  };
  services: { eyebrow: string; title: string; intro: string | null; items: ServiceCard[] };
  productGroups: {
    eyebrow: string;
    title: string;
    intro: string | null;
    items: HomeCard[];
    link: Link | null;
  };
  strengths: { eyebrow: string; title: string; items: { title: string; description: string }[] };
  /** COM-7 (null in content stored before it). */
  news?: { eyebrow: string | null; title: string | null; link: Link | null } | null;
  cta: {
    title: string;
    text: string | null;
    points: { text: string }[];
    button: Link;
    /** COM-7: a registered corporate image beside the call to action. */
    image?: string | null;
    imageAlt?: string | null;
  };
}

// --- corporate.products -------------------------------------------------------------------------

export const CORPORATE_PRODUCTS_KEY = "corporate.products";
export const CORPORATE_PRODUCTS_PATH = "/products";

export const CORPORATE_PRODUCTS_FIELDS: readonly CmsField[] = [
  {
    type: "group",
    key: "intro",
    label: "Page heading",
    fields: [
      optional("eyebrow", "Eyebrow", 60),
      text("title", "Heading", 120),
      long("intro", "Intro", 400),
      ...image(),
    ],
  },
  {
    type: "list",
    key: "groups",
    label: "Product groups",
    itemLabel: "Group",
    min: 1,
    max: 8,
    unique: "anchor",
    hint: "One section per group, in this order. The anchor is the address of the section (/products#anchor).",
    fields: [
      text("anchor", "Anchor", 60, {
        format: "anchor",
        hint: "Lower-case id, e.g. group-1. Used for links to this item.",
      }),
      optional("eyebrow", "Eyebrow", 60),
      text("title", "Heading", 120),
      optional("subtitle", "Subheading", 120),
      long("description", "Description", 600),
      {
        type: "list",
        key: "items",
        label: "Products",
        itemLabel: "Product",
        min: 0,
        max: 16,
        fields: [
          text("name", "Name", 80),
          optional("type", "Type", 40),
          optional("description", "Description", 300, true),
        ],
      },
      optional("applicationsTitle", "Applications heading", 80),
      {
        type: "list",
        key: "applications",
        label: "Applications",
        itemLabel: "Application",
        min: 0,
        max: 8,
        fields: [text("text", "Application", 160)],
      },
      link("link", "Button", false),
    ],
  },
  {
    type: "group",
    key: "typicalValues",
    label: "Typical values",
    hint: "Hidden until the source of the values is approved (DP-002): keep the rows empty until then. The table is shown only with at least one row.",
    fields: [
      optional("title", "Heading", 120),
      optional("columnA", "First value column", 40),
      optional("columnB", "Second value column", 40),
      optional("note", "Note", 300, true),
      {
        type: "list",
        key: "rows",
        label: "Rows",
        itemLabel: "Row",
        min: 0,
        max: 12,
        fields: [
          text("property", "Property", 80),
          optional("unit", "Unit", 20),
          optional("valueA", "First value", 40),
          optional("valueB", "Second value", 40),
        ],
      },
    ],
  },
  {
    type: "group",
    key: "coa",
    label: "Certificate of Analysis",
    hint: "Requests for a COA go to the contact page.",
    fields: [
      text("title", "Heading", 120),
      optional("text", "Text", 400, true),
      link("button", "Button"),
    ],
  },
];

export interface CorporateProductGroup {
  anchor: string;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  description: string;
  items: { name: string; type: string | null; description: string | null }[];
  applicationsTitle: string | null;
  applications: { text: string }[];
  link: Link | null;
}

export interface CorporateProductsContent {
  intro: {
    eyebrow: string | null;
    title: string;
    intro: string;
    /** COM-7: a registered corporate image behind the heading. */
    image?: string | null;
    imageAlt?: string | null;
  };
  groups: CorporateProductGroup[];
  typicalValues: {
    title: string | null;
    columnA: string | null;
    columnB: string | null;
    note: string | null;
    rows: {
      property: string;
      unit: string | null;
      valueA: string | null;
      valueB: string | null;
    }[];
  };
  coa: { title: string; text: string | null; button: Link };
}
