// ML-12c (DP-243): API response fixtures of the Content area (CMS pages, news, menus). Shared by
// the EN regression (content-en.test.tsx, recorded on private main a7b140f before ML-12c) and the
// EN/TR comparison (content-i18n.test.tsx). Every value here is data: page titles, menu labels,
// people's names and addresses stay as they are in both languages.

export const FAIL = Symbol("fail");

export const BV = "0190f2a1-0000-7000-8000-0000000000b1";
export const COM = "0190f2a1-0000-7000-8000-0000000000c1";
export const HOME = "0190f2a1-0000-7000-8000-000000000101";
export const ABOUT = "0190f2a1-0000-7000-8000-000000000102";
export const ARTICLE = "0190f2a1-0000-7000-8000-000000000103";
export const NL = "0190f2a1-0000-7000-8000-000000000104";
export const NAV = "0190f2a1-0000-7000-8000-000000000105";
export const FOOTER = "0190f2a1-0000-7000-8000-000000000106";
export const SEO = "0190f2a1-0000-7000-8000-000000000107";
export const NEWS = "0190f2a1-0000-7000-8000-000000000108";
export const CORP = "0190f2a1-0000-7000-8000-000000000109";
export const BROKEN = "0190f2a1-0000-7000-8000-00000000010a";
export const EMPTY = "0190f2a1-0000-7000-8000-00000000010b";
export const NAV_NL = "0190f2a1-0000-7000-8000-00000000010c";
export const OLD = "0190f2a1-0000-7000-8000-00000000010d";
export const PRODUCT = "0190f2a1-0000-7000-8000-000000000301";
export const PRODUCT_OFF = "0190f2a1-0000-7000-8000-000000000302";
export const CATEGORY = "0190f2a1-0000-7000-8000-000000000401";
export const CATEGORY_EMPTY = "0190f2a1-0000-7000-8000-000000000402";
export const GONE = "0190f2a1-0000-7000-8000-000000000999";

export const USER = { id: "0190f2a1-0000-7000-8000-000000000201", name: "Editor (fixture)" };
export const PUBLISHER = {
  id: "0190f2a1-0000-7000-8000-000000000202",
  name: "Publisher (fixture)",
};
export const AT = "2026-11-13T12:00:00.000Z";
export const LATER = "2026-11-20T09:30:00.000Z";

export const LOCALES = [
  { locale: "en", enabled: true, public: true, isDefault: true, sortOrder: 0 },
  { locale: "nl", enabled: true, public: false, isDefault: false, sortOrder: 10 },
];

export const site = (
  key: "BV" | "CORPORATE",
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: key === "BV" ? BV : COM,
  key,
  name: key === "BV" ? "Dream Petroleum BV" : "Dream Petroleum",
  locale: "en",
  canEdit: true,
  canPublish: true,
  ...over,
});

export const publication = (over: Record<string, unknown> = {}) => ({
  status: "PUBLISHED",
  revisionNumber: 2,
  pageVersion: 3,
  path: null,
  publishedAt: AT,
  publishedBy: PUBLISHER,
  unpublishedAt: null,
  unpublishedBy: null,
  version: 1,
  ...over,
});

export const summary = (over: Record<string, unknown>) => ({
  siteId: BV,
  locale: "en",
  sectionCount: 0,
  version: 1,
  updatedAt: AT,
  updatedBy: USER,
  publication: null,
  ...over,
});

export const detail = (s: Record<string, unknown>, content: Record<string, unknown>) => ({
  ...s,
  slug: s["kind"] === "TEMPLATE" ? String(s["path"]).replace(/^\/(news\/)?/, "") : null,
  seo: { title: null, description: null, noindex: false },
  redirectsHere: s["templateKey"] === "article" ? ["/news/q3-update"] : [],
  keepsOldAddress: s["kind"] === "TEMPLATE",
  content,
  createdAt: AT,
  createdBy: USER,
});

export const translation = (over: Record<string, unknown>) => ({
  title: null,
  path: null,
  isSource: false,
  outdated: false,
  sourceRevisionNumber: null,
  sourceLatestRevisionNumber: null,
  ...over,
});

export const homePage = summary({
  id: HOME,
  kind: "DESIGN",
  templateKey: "bv.home",
  path: "/",
  title: "Home",
  sectionCount: 5,
  version: 4,
  publication: publication({ path: "/" }),
});
export const aboutPage = summary({
  id: ABOUT,
  kind: "TEMPLATE",
  templateKey: "standard",
  path: "/about-us",
  title: "About us (fixture)",
  sectionCount: 8,
});
export const emptyPage = summary({
  id: EMPTY,
  kind: "TEMPLATE",
  templateKey: "standard",
  path: "/empty-page",
  title: "Empty page (fixture)",
  publication: publication({
    status: "UNPUBLISHED",
    path: "/empty-page",
    pageVersion: 1,
    unpublishedAt: LATER,
    unpublishedBy: PUBLISHER,
  }),
});
export const articlePage = summary({
  id: ARTICLE,
  kind: "TEMPLATE",
  templateKey: "article",
  path: "/news/market-update",
  title: "Market update (fixture)",
  sectionCount: 1,
  version: 2,
  publication: publication({ path: "/news/market-update-2024", pageVersion: 2, revisionNumber: 1 }),
});
export const oldArticle = summary({
  id: OLD,
  kind: "TEMPLATE",
  templateKey: "article",
  path: "/news/old-note",
  title: "Old note (fixture)",
  sectionCount: 0,
});
export const navPage = summary({
  id: NAV,
  kind: "FRAGMENT",
  templateKey: "bv.site-nav",
  path: null,
  title: "Navigation",
  version: 3,
  publication: publication({ pageVersion: 3 }),
});
export const footerPage = summary({
  id: FOOTER,
  kind: "FRAGMENT",
  templateKey: "bv.site-footer",
  path: null,
  title: "Footer",
  version: 2,
});
export const seoPage = summary({
  id: SEO,
  kind: "FRAGMENT",
  templateKey: "bv.site-seo",
  path: null,
  title: "SEO defaults",
});
export const newsIndexPage = summary({
  id: NEWS,
  kind: "DESIGN",
  templateKey: "bv.news-index",
  path: "/news",
  title: "News",
  publication: publication({ path: "/news", pageVersion: 1 }),
});
export const brokenNavPage = summary({
  id: BROKEN,
  kind: "FRAGMENT",
  templateKey: "bv.site-nav",
  path: null,
  title: "Navigation",
});
export const corpHome = summary({
  id: CORP,
  siteId: COM,
  kind: "DESIGN",
  templateKey: "corporate.home",
  path: "/",
  title: "Home",
});

/** Every section type of the standard template, with values. */
export const ALL_SECTIONS = [
  {
    id: "sec-000001",
    type: "hero",
    eyebrow: "About",
    title: "Who we are",
    intro: "A short intro.",
    cta: { label: "Contact", href: "/contact" },
  },
  { id: "sec-000002", type: "text", title: "Our story", body: "First paragraph.\n\nSecond." },
  {
    id: "sec-000003",
    type: "cards",
    title: "What we do",
    intro: "Three things.",
    items: [{ title: "Trading", description: "Base oils.", link: { label: "More", href: "/x" } }],
  },
  {
    id: "sec-000004",
    type: "cta",
    title: "Talk to us",
    text: "We reply within a day.",
    button: { label: "Contact", href: "/contact" },
  },
  {
    id: "sec-000005",
    type: "media",
    eyebrow: "Terminal",
    title: "Rotterdam",
    body: "Storage.",
    image: "/media/services-showcase/logistics-desktop.webp",
    imageAlt: "Terminal",
    imageNote: "Illustrative.",
  },
  {
    id: "sec-000006",
    type: "specs",
    title: "Facts",
    intro: "Key numbers.",
    rows: [{ term: "Founded", detail: "2019" }],
    link: { label: "", href: null },
  },
  { id: "sec-000007", type: "quote", text: "Energy in motion.", source: "Founder" },
  {
    id: "sec-000008",
    type: "contact",
    title: "Contact",
    intro: "Reach us.",
    formTitle: "Send a message",
  },
  { id: "sec-000009", type: "legacy-gallery", title: "Unknown" },
];

export const NAV_CONTENT = {
  items: [
    { label: "Home", target: { type: "path", path: "#top" }, children: [] },
    {
      label: "Products",
      target: { type: "category", categoryId: CATEGORY },
      children: [
        { label: "Base oils", target: { type: "product", productId: PRODUCT } },
        {
          label: "Old product",
          target: { type: "product", productId: PRODUCT_OFF },
          visible: false,
        },
        { label: "Empty group", target: { type: "category", categoryId: CATEGORY_EMPTY } },
        { label: "Removed", target: { type: "category", categoryId: GONE } },
      ],
    },
    { label: "Company", target: { type: "page", pageId: ABOUT }, children: [] },
    { label: "Blog", target: { type: "page", pageId: EMPTY }, children: [] },
    { label: "Gone page", target: { type: "page", pageId: GONE }, children: [] },
    {
      label: "Partner",
      target: { type: "url", url: "https://partner.example.org/" },
      newTab: true,
      children: [],
    },
    { label: "Careers", target: { type: "none" }, children: [] },
  ],
  contact: { label: "Contact", target: { type: "path", path: "/about-us" } },
  noScriptLinks: [{ label: "Home", target: { type: "path", path: "#top" } }],
  pendingNote: "This page isn't ready yet.",
};

export const FOOTER_CONTENT = {
  headline: "Let’s Move Energy Forward.",
  cta: { label: "Get in Touch", target: { type: "path", path: "/contact" } },
  intro: "Dream Petroleum BV trades base oils (fixture).",
  contact: {
    title: "Contact Us",
    company: "Dream Petroleum B.V.",
    addressLines: [{ text: "Herengracht 420" }, { text: "1017 AMSTERDAM" }],
    phone: { label: "020 210 13 50", href: "tel:+31202101350", note: "Mon–Fri 08:30–18:30" },
    email: {
      label: "info@fixture.invalid",
      href: "mailto:info@fixture.invalid",
      note: "We reply within 24h",
      visible: false,
    },
  },
  columns: [
    {
      title: "Products",
      links: [
        { label: "Base Oils", target: { type: "path", path: "/products?category=base-oil" } },
        { label: "About Us", target: { type: "path", path: "/about-us" } },
      ],
    },
    {
      title: "Hidden column",
      visible: false,
      links: [{ label: "News", target: { type: "page", pageId: NEWS } }],
    },
  ],
  social: [
    { network: "linkedin", label: "LinkedIn", url: "https://www.linkedin.com/company/x" },
    { network: "other", label: "Forum", url: "https://forum.example.org/", visible: false },
  ],
  copyright: "© 2026 Dream Petroleum BV. All rights reserved.",
  legal: [
    { label: "Privacy Policy", target: { type: "path", path: "/privacy" } },
    { label: "Terms & Conditions", target: { type: "none" } },
  ],
  pendingNote: "page not available yet",
};

export const MENU_TARGETS = {
  pages: [
    {
      id: ABOUT,
      title: "About us (fixture)",
      kind: "TEMPLATE",
      path: "/about-us",
      livePath: "/about-us",
      status: "PUBLISHED",
    },
    {
      id: EMPTY,
      title: "Empty page (fixture)",
      kind: "TEMPLATE",
      path: "/empty-page",
      livePath: null,
      status: "UNPUBLISHED",
    },
    {
      id: NEWS,
      title: "News",
      kind: "DESIGN",
      path: "/news",
      livePath: null,
      status: "DRAFT",
    },
  ],
  products: [
    { id: PRODUCT, name: "SN 150 (fixture)", code: "G1-SN150", livePath: "/products/sn-150" },
    { id: PRODUCT_OFF, name: "SN 900 (fixture)", code: null, livePath: null },
  ],
  productsComplete: false,
  categories: [
    {
      id: CATEGORY,
      name: "Base oils",
      slug: "base-oil",
      parentId: null,
      path: "/products?category=base-oil",
      liveProducts: 4,
    },
    {
      id: CATEGORY_EMPTY,
      name: "Waxes",
      slug: "wax",
      parentId: CATEGORY,
      path: "/products?category=wax",
      liveProducts: 0,
    },
  ],
};

export const HISTORY = {
  revisions: [
    {
      revisionNumber: 2,
      pageVersion: 3,
      title: "Home",
      path: "/",
      publishedAt: LATER,
      publishedBy: PUBLISHER,
      live: true,
    },
    {
      revisionNumber: 1,
      pageVersion: 1,
      title: "Home",
      path: "/",
      publishedAt: AT,
      publishedBy: PUBLISHER,
      live: false,
    },
  ],
};

const CMS = "/api/v1/admin/cms";
const bvList: Record<string, unknown>[] = [
  homePage,
  aboutPage,
  emptyPage,
  articlePage,
  oldArticle,
  navPage,
  footerPage,
  seoPage,
  newsIndexPage,
];

/** The default reads: both sites, every BV page and the Corporate home. */
export function seedContentReads(reads: Map<string, unknown>): void {
  reads.clear();
  const bv = site("BV", { locales: LOCALES });
  const com = site("CORPORATE", { canPublish: false });
  reads.set(`${CMS}/context`, { sites: [bv, com] });
  reads.set(`${CMS}/sites/${BV}/pages`, {
    site: bv,
    items: bvList.map((p) =>
      p.id === ABOUT
        ? {
            ...p,
            translations: [
              translation({ locale: "nl", pageId: NL, state: "outdated", outdated: true }),
            ],
          }
        : p.id === HOME
          ? { ...p, translations: [translation({ locale: "nl", pageId: null, state: "missing" })] }
          : p,
    ),
  });
  reads.set(`${CMS}/sites/${BV}/pages?locale=nl`, {
    site: bv,
    items: [summary({ ...aboutPage, id: NL, locale: "nl", title: "Over ons (fixture)" })],
  });
  reads.set(`${CMS}/sites/${COM}/pages`, { site: com, items: [corpHome] });
  reads.set(`${CMS}/sites/${BV}/menu-targets`, MENU_TARGETS);

  const enSource = (pageId: string, state = "published") =>
    translation({ locale: "en", pageId, isSource: true, state });
  const nlMissing = translation({ locale: "nl", pageId: null, state: "missing" });

  reads.set(`${CMS}/pages/${HOME}`, {
    page: detail(homePage, { hero: { brand: "ICCSYN BASE OILS (fixture)" } }),
    site: bv,
    translations: [enSource(HOME), nlMissing],
  });
  reads.set(`${CMS}/pages/${HOME}/history`, HISTORY);
  reads.set(`${CMS}/pages/${ABOUT}`, {
    page: detail(aboutPage, { sections: ALL_SECTIONS }),
    site: bv,
    translations: [
      enSource(ABOUT, "draft"),
      translation({
        locale: "nl",
        pageId: NL,
        state: "outdated",
        outdated: true,
        sourceRevisionNumber: 1,
        sourceLatestRevisionNumber: 2,
      }),
    ],
  });
  reads.set(`${CMS}/pages/${ABOUT}/history`, { revisions: [] });
  reads.set(`${CMS}/pages/${NL}`, {
    page: {
      ...detail(
        { ...aboutPage, id: NL, locale: "nl", title: "Over ons (fixture)" },
        { sections: [] },
      ),
      structureWarnings: ["sections", "lists", "images", "links"],
    },
    site: bv,
    translations: [
      enSource(ABOUT),
      translation({
        locale: "nl",
        pageId: NL,
        state: "outdated",
        outdated: true,
        sourceRevisionNumber: 1,
        sourceLatestRevisionNumber: 2,
      }),
    ],
  });
  reads.set(`${CMS}/pages/${NL}/history`, { revisions: [] });
  reads.set(`${CMS}/pages/${EMPTY}`, {
    page: detail(emptyPage, { sections: [] }),
    site: bv,
    translations: [],
  });
  reads.set(`${CMS}/pages/${EMPTY}/history`, FAIL);
  reads.set(`${CMS}/pages/${ARTICLE}`, {
    page: detail(articlePage, {
      excerpt: "Prices eased in the third quarter (fixture).",
      coverImage: "/media/services-showcase/logistics-desktop.webp",
      coverAlt: "Terminal",
      sections: [{ id: "sec-0001bb", type: "text", title: null, body: "Body text." }],
    }),
    site: bv,
    translations: [],
  });
  reads.set(`${CMS}/pages/${ARTICLE}/history`, {
    revisions: [{ ...HISTORY.revisions[1], title: "Market update (fixture)", live: true }],
  });
  reads.set(`${CMS}/pages/${OLD}`, {
    page: detail(oldArticle, { excerpt: "", coverImage: null, coverAlt: null, sections: [] }),
    site: bv,
    translations: [],
  });
  reads.set(`${CMS}/pages/${OLD}/history`, { revisions: [] });
  reads.set(`${CMS}/pages/${NAV}`, {
    page: detail(navPage, NAV_CONTENT),
    site: bv,
    translations: [enSource(NAV), translation({ locale: "nl", pageId: NAV_NL, state: "draft" })],
  });
  reads.set(`${CMS}/pages/${NAV}/history`, HISTORY);
  reads.set(`${CMS}/pages/${NAV_NL}`, {
    page: {
      ...detail({ ...navPage, id: NAV_NL, locale: "nl", publication: null }, NAV_CONTENT),
      menuWarnings: [
        { path: "items.3", label: "Blog", rule: "not_live" },
        { path: "items.2", label: "Company", rule: "no_translation" },
        { path: "items.1.children.0", label: "Base oils", rule: "not_in_language" },
        { path: "items.4", label: "Gone page", rule: "unknown_target" },
        { path: "items.1.children.2", label: "Empty group", rule: "not_in_language" },
      ],
    },
    site: bv,
    translations: [
      enSource(NAV),
      translation({
        locale: "nl",
        pageId: NAV_NL,
        state: "draft",
        sourceRevisionNumber: 2,
        sourceLatestRevisionNumber: 2,
      }),
    ],
  });
  reads.set(`${CMS}/pages/${NAV_NL}/history`, { revisions: [] });
  reads.set(`${CMS}/pages/${FOOTER}`, {
    page: detail(footerPage, FOOTER_CONTENT),
    site: bv,
    translations: [],
  });
  reads.set(`${CMS}/pages/${FOOTER}/history`, { revisions: [] });
  reads.set(`${CMS}/pages/${BROKEN}`, {
    page: detail(brokenNavPage, { items: "not a menu" }),
    site: bv,
    translations: [],
  });
  reads.set(`${CMS}/pages/${BROKEN}/history`, { revisions: [] });
  reads.set(`${CMS}/pages/${SEO}`, {
    page: detail(seoPage, {
      siteName: "Dream Petroleum BV",
      defaultTitle: "Dream Petroleum BV",
      defaultDescription: "Base oils (fixture).",
      defaultOgImage: "/media/ctl-technology/clear-base-oil.webp",
    }),
    site: bv,
    translations: [],
  });
  reads.set(`${CMS}/pages/${SEO}/history`, { revisions: [] });
  reads.set(`${CMS}/pages/${NEWS}`, {
    page: detail(newsIndexPage, {
      eyebrow: "News",
      title: "News and insights",
      intro: "Updates (fixture).",
      empty: { title: "No articles yet", text: "Soon." },
    }),
    site: bv,
    translations: [],
  });
  reads.set(`${CMS}/pages/${NEWS}/history`, { revisions: [] });
  reads.set(`${CMS}/pages/${CORP}`, {
    page: detail(corpHome, {}),
    site: com,
    translations: [],
  });
  reads.set(`${CMS}/pages/${CORP}/history`, { revisions: [] });
}
