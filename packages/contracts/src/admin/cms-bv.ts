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
/** A label with an optional target: empty = the page does not exist yet (shown as plain text). */
const pendingLink = (): CmsField[] => [
  text("label", "Label", 80),
  text("href", "Link", 500, {
    format: "href",
    required: false,
    hint: "Empty while the page does not exist yet: shown as text, never a 404.",
  }),
];

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

// --- bv.site-nav -------------------------------------------------------------------------------

export const BV_NAV_FIELDS: readonly CmsField[] = [
  {
    type: "list",
    key: "items",
    label: "Menu items",
    itemLabel: "Item",
    min: 1,
    max: 8,
    fields: pendingLink(),
  },
  { type: "group", key: "contact", label: "Contact button", fields: pendingLink() },
  {
    type: "list",
    key: "noScriptLinks",
    label: "Links without JavaScript (phones)",
    itemLabel: "Link",
    min: 0,
    max: 8,
    hint: "Real destinations only: shown when a phone has JavaScript off.",
    fields: pendingLink(),
  },
  text("pendingNote", "Note on pages that do not exist yet", 120),
];

export interface BvNavContent {
  items: { label: string; href: string | null }[];
  contact: { label: string; href: string | null };
  noScriptLinks: { label: string; href: string | null }[];
  pendingNote: string;
}

// --- bv.site-footer ----------------------------------------------------------------------------

export const BV_FOOTER_FIELDS: readonly CmsField[] = [
  text("headline", "Headline", 120),
  link("cta", "Button"),
  long("intro", "Intro", 500),
  {
    type: "group",
    key: "contact",
    label: "Contact details",
    hint: "Keep address, phone and e-mail identical to the company's official details.",
    fields: [
      text("title", "Heading", 60),
      text("company", "Company", 120),
      {
        type: "list",
        key: "addressLines",
        label: "Address",
        itemLabel: "Line",
        min: 1,
        max: 4,
        fields: [text("text", "Line", 120)],
      },
      {
        type: "group",
        key: "phone",
        label: "Phone",
        fields: [
          text("label", "Shown as", 60),
          text("href", "Link (tel:)", 60),
          text("note", "Note", 80),
        ],
      },
      {
        type: "group",
        key: "email",
        label: "E-mail",
        fields: [
          text("label", "Shown as", 120),
          text("href", "Link (mailto:)", 200),
          text("note", "Note", 80),
        ],
      },
    ],
  },
  {
    type: "list",
    key: "columns",
    label: "Link columns",
    itemLabel: "Column",
    min: 1,
    max: 4,
    fields: [
      text("title", "Heading", 60),
      {
        type: "list",
        key: "links",
        label: "Links",
        itemLabel: "Link",
        min: 1,
        max: 8,
        fields: pendingLink(),
      },
    ],
  },
  text("copyright", "Copyright line", 200),
  {
    type: "list",
    key: "legal",
    label: "Legal links",
    itemLabel: "Link",
    min: 0,
    max: 4,
    hint: "The Privacy Policy link is hidden automatically where the policy is not published.",
    fields: pendingLink(),
  },
  text("pendingNote", "Note on pages that do not exist yet", 120),
];

export interface BvFooterContent {
  headline: string;
  cta: { label: string; href: string };
  intro: string;
  contact: {
    title: string;
    company: string;
    addressLines: { text: string }[];
    phone: { label: string; href: string; note: string };
    email: { label: string; href: string; note: string };
  };
  columns: { title: string; links: { label: string; href: string | null }[] }[];
  copyright: string;
  legal: { label: string; href: string | null }[];
  pendingNote: string;
}

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

// --- registry of designed templates --------------------------------------------------------------

export interface CmsDesignTemplate {
  key: string;
  site: "BV" | "CORPORATE";
  kind: "DESIGN" | "FRAGMENT";
  title: string;
  path: string | null;
  fields: readonly CmsField[];
}

export const CMS_DESIGN_TEMPLATES: readonly CmsDesignTemplate[] = [
  { key: "bv.home", site: "BV", kind: "DESIGN", title: "Home", path: "/", fields: BV_HOME_FIELDS },
  {
    key: "bv.site-nav",
    site: "BV",
    kind: "FRAGMENT",
    title: "Navigation",
    path: null,
    fields: BV_NAV_FIELDS,
  },
  {
    key: "bv.site-footer",
    site: "BV",
    kind: "FRAGMENT",
    title: "Footer",
    path: null,
    fields: BV_FOOTER_FIELDS,
  },
  {
    key: "bv.news-index",
    site: "BV",
    kind: "DESIGN",
    title: "News",
    path: "/news",
    fields: BV_NEWS_INDEX_FIELDS,
  },
];

export function cmsDesignTemplate(key: string): CmsDesignTemplate | undefined {
  return CMS_DESIGN_TEMPLATES.find((t) => t.key === key);
}

/** The fragments a BV page shows around its content. */
export const BV_FRAGMENT_KEYS = ["bv.site-nav", "bv.site-footer"] as const;
