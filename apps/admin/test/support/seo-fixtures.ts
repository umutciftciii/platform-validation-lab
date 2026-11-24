// ML-12d (DP-243): fixtures of the SEO area shared by seo-en.test.tsx (EN baseline) and
// seo-i18n.test.tsx (Turkish): an SEO overview with every row note and state, a redirect list with
// manual, imported and protected slug-change rows, a dry-run result and a change history. All
// values are API response shapes (@dream/contracts) and data: they are never translated.
import type { SeoOverviewItem, SeoRedirectImportResponse } from "@dream/contracts";

export const BV = "0190f2a1-0000-7000-8000-0000000000b1";
export const AT = "2026-11-18T12:00:00.000Z";
export const LATER = "2026-11-20T08:05:00.000Z";
export const id = (n: number) => `0190f2a1-0000-7000-8000-${String(n).padStart(12, "0")}`;
export const SEO = "/api/v1/admin/seo";
export const CMS_CONTEXT = "/api/v1/admin/cms/context";
export const OVERVIEW = `${SEO}/sites/${BV}/overview`;
export const REDIRECTS = `${SEO}/sites/${BV}/redirects`;

export const bvContext = {
  sites: [
    {
      id: BV,
      key: "BV",
      name: "Dream Petroleum BV",
      locale: "en",
      canEdit: true,
      canPublish: true,
    },
  ],
};

// --- SEO overview fixtures ------------------------------------------------------------------------

export const item = (n: number, over: Partial<SeoOverviewItem>): SeoOverviewItem => ({
  id: id(n),
  source: "cms",
  kind: "page",
  name: `Page ${n} (fixture)`,
  path: `/page-${n}`,
  title: `Page ${n} title`,
  description: "A description of normal length for the fixture page.",
  ogTitle: null,
  ogDescription: null,
  hasOgImage: false,
  canonicalPath: null,
  noindex: false,
  live: true,
  pendingChanges: false,
  inSitemap: true,
  ...over,
});

export const ITEMS: SeoOverviewItem[] = [
  item(1, { kind: "home", name: "Home", path: "/", title: null }),
  item(2, { name: "About Us", path: "/about-us", description: null }),
  item(3, {
    kind: "article",
    name: "Market update (fixture)",
    path: "/news/market-update",
    title: "T".repeat(70),
    description: "D".repeat(180),
    pendingChanges: true,
  }),
  item(4, {
    name: "Old page",
    path: "/old-page",
    canonicalPath: "/about-us",
    noindex: true,
    inSitemap: false,
  }),
  item(5, {
    name: "Broken canonical",
    path: "/broken",
    canonicalPath: "not a path",
    live: false,
    inSitemap: false,
  }),
  item(6, {
    source: "product",
    kind: "product",
    name: "Clear base oil (fixture)",
    path: "/products/clear-base-oil",
  }),
  item(7, { kind: "products", name: "Products", path: "/products" }),
  item(8, { kind: "news", name: "News", path: "/news" }),
];

export const overviewData = (over: Record<string, unknown> = {}) => ({
  site: { id: BV, key: "BV", name: "Dream Petroleum BV" },
  permissions: {
    readPages: true,
    editPages: true,
    publishPages: true,
    readProducts: true,
    editProducts: true,
  },
  settings: {
    pageId: id(40),
    version: 3,
    published: true,
    pendingChanges: false,
    draft: {
      siteName: "Dream Petroleum BV",
      defaultTitle: "Dream Petroleum BV | Base oils",
      defaultDescription: "Base oils and lubricants from Rotterdam.",
      defaultOgImage: "/media/ctl-technology/clear-base-oil.webp",
    },
  },
  liveSettings: {
    siteName: "Dream Petroleum BV",
    defaultTitle: "Dream Petroleum BV | Base oils",
    defaultDescription: "Base oils and lubricants from Rotterdam.",
    defaultOgImage: "/media/ctl-technology/clear-base-oil.webp",
  },
  items: ITEMS,
  ...over,
});

// --- redirect fixtures ----------------------------------------------------------------------------

export const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n),
  sourcePath: `/old-${n}`,
  sourceQuery: "",
  target: "/about-us",
  statusCode: 301,
  active: true,
  origin: "MANUAL",
  note: null,
  version: 1,
  protected: false,
  content: null,
  createdBy: "Editor (fixture)",
  updatedBy: "Editor (fixture)",
  createdAt: AT,
  updatedAt: LATER,
  ...over,
});

export const ROWS = [
  row(1, { note: "Old company page" }),
  row(2, {
    sourcePath: "/offer",
    sourceQuery: "ref=mail",
    target: "/contact",
    statusCode: 302,
    active: false,
    origin: "IMPORT",
    updatedBy: null,
  }),
  row(3, {
    sourcePath: "/products/old-oil",
    target: "/products/new-oil",
    origin: "SLUG_CHANGE",
    protected: true,
    content: { type: "PRODUCT", id: id(9), name: "New oil", livePath: "/products/new-oil" },
  }),
  row(4, {
    sourcePath: "/old-about",
    target: "/about-us",
    origin: "SLUG_CHANGE",
    protected: true,
    content: { type: "CMS_PAGE", id: id(10), name: null, livePath: null },
  }),
  row(5, {
    sourcePath: "/en/contact-us.html",
    target: "/contact",
    origin: "IMPORT",
    note: "Legacy URL of the old site",
  }),
];

export const listData = (manage: boolean, over: Record<string, unknown> = {}) => ({
  site: { id: BV, key: "BV", name: "Dream Petroleum BV" },
  permissions: { manage, history: manage },
  items: ROWS,
  total: ROWS.length,
  page: 1,
  pageSize: 50,
  counts: { all: 93, MANUAL: 10, SLUG_CHANGE: 0, IMPORT: 83, inactive: 50 },
  ...over,
});

export const IMPORT_RESULT: SeoRedirectImportResponse = {
  dryRun: true,
  applied: false,
  planHash: "0".repeat(64),
  summary: { rows: 4, create: 1, update: 1, unchanged: 1, error: 1 },
  rows: [
    {
      line: 2,
      source: "/a",
      target: "/b",
      statusCode: 301,
      active: true,
      note: "=cmd()",
      action: "create",
      errors: [],
      warnings: ["target:not_live"],
    },
    {
      line: 3,
      source: "/c",
      target: "/about-us",
      statusCode: 302,
      active: false,
      note: null,
      action: "update",
      errors: [],
      warnings: ["source:draft_content"],
    },
    {
      line: 4,
      source: "/d",
      target: "/news",
      statusCode: 301,
      active: true,
      note: null,
      action: "unchanged",
      errors: [],
      warnings: [],
    },
    {
      line: 5,
      source: "",
      target: "",
      statusCode: null,
      active: null,
      note: null,
      action: "error",
      errors: ["source:required", "target:required", "csv.5:quote"],
      warnings: [],
    },
  ],
};

export const CSV =
  "source,target,status,active,note\n/a,/b,301,true,=cmd()\n/c,/about-us,302,false,\n";

export const HISTORY = [
  {
    id: id(60),
    occurredAt: LATER,
    action: "seo.redirect_updated",
    actor: "Editor (fixture)",
    details: { sourcePath: "/old-1", target: "/about-us", changed: ["target", "note"] },
  },
  {
    id: id(61),
    occurredAt: AT,
    action: "seo.redirect_created",
    actor: null,
    details: {
      via: "import",
      sourcePath: "/old-1",
      sourceQuery: "x=1",
      target: "/contact",
      statusCode: 302,
      active: false,
    },
  },
  {
    id: id(62),
    occurredAt: AT,
    action: "seo.redirect_retargeted",
    actor: null,
    details: { target: "/products/new-oil", previousTarget: "/products/old-oil" },
  },
  { id: id(63), occurredAt: AT, action: "seo.redirect_retired", actor: null, details: {} },
  { id: id(64), occurredAt: AT, action: "seo.redirect_deleted", actor: "Root", details: {} },
  { id: id(65), occurredAt: AT, action: "seo.unknown_action", actor: null, details: {} },
];
