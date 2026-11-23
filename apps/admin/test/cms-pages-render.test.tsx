// CMS S2 regression (2026-11-13 DEV acceptance): the content list and the page editor render on
// the server with real response shapes (publication states, a designed page, a template page,
// pending registry entries with their import button). The admin API and the session are
// replaced by fixtures; the module boundary itself is checked by server-client-boundary.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = new Map<string, unknown>();

vi.mock("../lib/server-api", () => ({
  serverRead: async (path: string, schema: { parse(v: unknown): unknown }) => {
    if (!reads.has(path)) return { ok: false, status: 404, code: "NOT_FOUND" };
    return { ok: true, data: schema.parse(reads.get(path)) };
  },
}));
// ML-12c: the content pages read the admin UI language (cookie); no cookie = English.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));
vi.mock("../lib/server-session", () => ({ requireStaffSession: async () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));

const { default: ContentPage } = await import("../app/(console)/content/page");
const { default: ContentPageEditor } = await import("../app/(console)/content/[id]/page");
const { default: NewsListPage } = await import("../app/(console)/content/news/page");

const BV = "0190f2a1-0000-7000-8000-0000000000b1";
const COM = "0190f2a1-0000-7000-8000-0000000000c1";
const HOME = "0190f2a1-0000-7000-8000-000000000101";
const ABOUT = "0190f2a1-0000-7000-8000-000000000102";
const ARTICLE = "0190f2a1-0000-7000-8000-000000000103";
const USER = { id: "0190f2a1-0000-7000-8000-000000000201", name: "Editor (fixture)" };
const AT = "2026-11-13T12:00:00.000Z";

const site = (key: "BV" | "CORPORATE", id: string) => ({
  id,
  key,
  name: key === "BV" ? "Dream Petroleum BV" : "Dream Petroleum",
  locale: "en",
  canEdit: true,
  canPublish: true,
});

const summary = (over: Record<string, unknown>) => ({
  siteId: BV,
  locale: "en",
  sectionCount: 0,
  version: 1,
  updatedAt: AT,
  updatedBy: USER,
  publication: null,
  ...over,
});

const homePage = summary({
  id: HOME,
  kind: "DESIGN",
  templateKey: "bv.home",
  path: "/",
  title: "Home",
  sectionCount: 5,
  version: 3,
  publication: {
    status: "PUBLISHED",
    revisionNumber: 1,
    pageVersion: 2,
    path: "/",
    publishedAt: AT,
    publishedBy: USER,
    unpublishedAt: null,
    unpublishedBy: null,
    version: 1,
  },
});
const aboutPage = summary({
  id: ABOUT,
  kind: "TEMPLATE",
  templateKey: "standard",
  path: "/about-us",
  title: "About us (fixture)",
  sectionCount: 1,
});
const articlePage = summary({
  id: ARTICLE,
  kind: "TEMPLATE",
  templateKey: "article",
  path: "/news/market-update",
  title: "Market update (fixture)",
  sectionCount: 1,
  version: 2,
  publication: {
    status: "PUBLISHED",
    revisionNumber: 1,
    pageVersion: 2,
    // DP-210: published before the slug change of the draft.
    path: "/news/market-update-2024",
    publishedAt: AT,
    publishedBy: USER,
    unpublishedAt: null,
    unpublishedBy: null,
    version: 1,
  },
});
const detail = (s: Record<string, unknown>, content: Record<string, unknown>) => ({
  ...s,
  slug: s["kind"] === "TEMPLATE" ? String(s["path"]).replace(/^\/(news\/)?/, "") : null,
  seo: { title: null, description: null, noindex: false },
  // DP-210: the article has an older address already; the BV site keeps old addresses.
  redirectsHere: s["templateKey"] === "article" ? ["/news/q3-update"] : [],
  keepsOldAddress: s["kind"] === "TEMPLATE",
  content,
  createdAt: AT,
  createdBy: USER,
});

beforeEach(() => {
  reads.clear();
  reads.set("/api/v1/admin/cms/context", { sites: [site("BV", BV), site("CORPORATE", COM)] });
  reads.set(`/api/v1/admin/cms/sites/${BV}/pages`, {
    site: site("BV", BV),
    items: [homePage, aboutPage, articlePage],
  });
  reads.set(`/api/v1/admin/cms/pages/${ARTICLE}`, {
    page: detail(articlePage, {
      excerpt: "Prices eased in the third quarter (fixture).",
      coverImage: "/media/services-showcase/logistics-desktop.webp",
      coverAlt: "Terminal",
      sections: [{ id: "sec-0001bb", type: "text", title: null, body: "Body text." }],
    }),
    site: site("BV", BV),
  });
  reads.set(`/api/v1/admin/cms/pages/${ARTICLE}/history`, {
    revisions: [
      {
        revisionNumber: 1,
        pageVersion: 2,
        title: "Market update (fixture)",
        path: "/news/market-update",
        publishedAt: AT,
        publishedBy: USER,
        live: true,
      },
    ],
  });
  reads.set(`/api/v1/admin/cms/pages/${HOME}`, {
    page: detail(homePage, { hero: { brand: "ICCSYN BASE OILS (fixture)" } }),
    site: site("BV", BV),
  });
  reads.set(`/api/v1/admin/cms/pages/${ABOUT}`, {
    page: detail(aboutPage, {
      sections: [{ id: "sec-0001aa", type: "hero", title: "Who we are" }],
    }),
    site: site("BV", BV),
  });
});

describe("/content renders on the server", () => {
  it("lists CMS pages with their publication state and the pages still in code", async () => {
    const html = renderToStaticMarkup(
      await ContentPage({ searchParams: Promise.resolve({ site: "bv" }) } as never),
    );
    expect(html).toContain("Live, changes not published");
    expect(html).toContain("Draft, not published");
    expect(html).toContain("About us (fixture)");
    // Navigation and footer are not imported in this fixture: listed with their import button.
    expect(html).toContain("Navigation");
    expect(html).toContain("Import into CMS");
    expect(html).toContain("Legal text, versioned");
    // DP-020: articles have their own list.
    expect(html).not.toContain("Market update (fixture)");
    expect(html).toContain("/content/news?site=bv");
  });

  it("ML-1: shows the site's languages read only (Dutch not public)", async () => {
    reads.set("/api/v1/admin/cms/context", {
      sites: [
        {
          ...site("BV", BV),
          locales: [
            { locale: "nl", enabled: true, public: false, isDefault: false, sortOrder: 10 },
            { locale: "en", enabled: true, public: true, isDefault: true, sortOrder: 0 },
          ],
        },
        site("CORPORATE", COM),
      ],
    });
    const html = renderToStaticMarkup(
      await ContentPage({ searchParams: Promise.resolve({ site: "bv" }) } as never),
    );
    const panel = html.slice(html.indexOf('id="site-languages"'), html.indexOf('id="site-routes"'));
    expect(panel).toContain("Site languages");
    expect(panel).toContain("English (en)");
    expect(panel).toContain("Dutch (nl)");
    expect(panel).toContain("Default");
    expect(panel).toContain("Public on the site");
    expect(panel).toContain("Not public");
    // Read only: no control that could change a language.
    expect(panel).not.toMatch(/<(button|form|input|select|a)\b/);
  });

  it("ML-1: an API without languages shows an empty, read-only languages panel", async () => {
    const html = renderToStaticMarkup(
      await ContentPage({ searchParams: Promise.resolve({ site: "bv" }) } as never),
    );
    expect(html).toContain("No languages recorded for this site");
  });
});

describe("/content/news renders on the server (DP-020)", () => {
  it("lists only the articles, with their state and a new-article action", async () => {
    const html = renderToStaticMarkup(
      await NewsListPage({ searchParams: Promise.resolve({ site: "bv" }) } as never),
    );
    expect(html).toContain("Market update (fixture)");
    expect(html).toContain("/news/market-update");
    expect(html).toContain("Live");
    expect(html).toContain("New article");
    expect(html).not.toContain("About us (fixture)");
  });

  it("shows the empty state without articles", async () => {
    reads.set(`/api/v1/admin/cms/sites/${BV}/pages`, { site: site("BV", BV), items: [aboutPage] });
    const html = renderToStaticMarkup(
      await NewsListPage({ searchParams: Promise.resolve({ site: "bv" }) } as never),
    );
    expect(html).toContain("No articles on this site yet");
  });
});

describe("/content/[id] renders on the server", () => {
  it("renders a designed page with its fields and the publication panel", async () => {
    const html = renderToStaticMarkup(
      await ContentPageEditor({ params: Promise.resolve({ id: HOME }) } as never),
    );
    expect(html).toContain("Live, changes not published");
    expect(html).toContain("Hero (ICCSYN)");
    expect(html).toContain("ICCSYN BASE OILS (fixture)");
    expect(html).toContain("Publication");
    expect(html).toContain("Publish changes");
    expect(html).toContain("Preview draft");
  });

  it("renders a template page with its sections", async () => {
    const html = renderToStaticMarkup(
      await ContentPageEditor({ params: Promise.resolve({ id: ABOUT }) } as never),
    );
    expect(html).toContain("Draft, not published");
    expect(html).toContain("Who we are");
    expect(html).toContain("Sections");
    // CMS S3: template pages of the BV site have a preview too.
    expect(html).toContain("Preview draft");
  });

  it("renders an article with its summary, cover, body, SEO and publication history (DP-020)", async () => {
    const html = renderToStaticMarkup(
      await ContentPageEditor({ params: Promise.resolve({ id: ARTICLE }) } as never),
    );
    expect(html).toContain("News article");
    expect(html).toContain("All articles of");
    expect(html).toContain("/news/");
    expect(html).toContain("Prices eased in the third quarter (fixture).");
    expect(html).toContain("No image");
    // DP-153: the alt text is required with a cover, never labelled optional.
    expect(html).toContain("Cover image alt text");
    expect(html).not.toContain("Cover image alt text (optional)");
    expect(html).toContain('aria-required="true"');
    expect(html).toContain("Article body");
    expect(html).toContain("Body text.");
    // Only body section types can be added (no hero, no contact form).
    expect(html).not.toContain("Contact details and form");
    expect(html).toContain("Publication history");
    expect(html).toContain("Revision 1");
    expect(html).toContain("Restore into draft");
    expect(html).toContain("Hide from search engines");
    // DP-210: the live address, the draft address, the 301 note and the older addresses.
    expect(html).toContain("Live address");
    expect(html).toContain("/news/market-update-2024");
    expect(html).toContain("Address after publishing");
    expect(html).toContain("redirects permanently (301)");
    expect(html).toContain("Older addresses that redirect here (301)");
    expect(html).toContain("/news/q3-update");
  });

  it("DP-210: a never-published page shows its draft address and that it is not live", async () => {
    const html = renderToStaticMarkup(
      await ContentPageEditor({ params: Promise.resolve({ id: ABOUT }) } as never),
    );
    expect(html).toContain("Not on the site");
    expect(html).toContain("/about-us");
    expect(html).not.toContain("redirects permanently");
  });

  it("ML-2: shows the language tabs, the translation state and the create action of a missing language", async () => {
    const locales = [
      { locale: "en", enabled: true, public: true, isDefault: true, sortOrder: 0 },
      { locale: "nl", enabled: true, public: false, isDefault: false, sortOrder: 10 },
    ];
    const bv = { ...site("BV", BV), locales };
    const NL = "0190f2a1-0000-7000-8000-000000000104";
    const tr = (over: Record<string, unknown>) => ({
      title: null,
      path: null,
      isSource: false,
      outdated: false,
      sourceRevisionNumber: null,
      sourceLatestRevisionNumber: null,
      ...over,
    });
    // English source without a Dutch page yet.
    reads.set(`/api/v1/admin/cms/pages/${ABOUT}`, {
      page: detail(aboutPage, {
        sections: [{ id: "sec-0001aa", type: "hero", title: "Who we are" }],
      }),
      site: bv,
      translations: [
        tr({ locale: "en", pageId: ABOUT, isSource: true, state: "draft" }),
        tr({ locale: "nl", pageId: null, state: "missing" }),
      ],
    });
    let html = renderToStaticMarkup(
      await ContentPageEditor({ params: Promise.resolve({ id: ABOUT }) } as never),
    );
    expect(html).toContain('aria-label="Page language"');
    expect(html).toContain("English (en)");
    expect(html).toContain("Dutch (nl)");
    expect(html).toContain("Not translated");
    expect(html).toContain("Create Dutch (nl) translation");
    expect(html).toContain("Not public on the site yet: Dutch (nl)");
    // A Dutch translation that is out of date, with a structure warning.
    reads.set(`/api/v1/admin/cms/pages/${NL}`, {
      page: {
        ...detail(
          { ...aboutPage, id: NL, locale: "nl", title: "Over ons (fixture)" },
          {
            sections: [],
          },
        ),
        structureWarnings: ["sections"],
      },
      site: bv,
      translations: [
        tr({ locale: "en", pageId: ABOUT, isSource: true, state: "published" }),
        tr({
          locale: "nl",
          pageId: NL,
          state: "outdated",
          outdated: true,
          sourceRevisionNumber: 1,
          sourceLatestRevisionNumber: 2,
        }),
      ],
    });
    reads.set(`/api/v1/admin/cms/pages/${NL}/history`, { revisions: [] });
    html = renderToStaticMarkup(
      await ContentPageEditor({ params: Promise.resolve({ id: NL }) } as never),
    );
    expect(html).toContain("Published, out of date");
    expect(html).toContain("this translation was made from revision 1");
    expect(html).toContain("Mark as up to date with revision 2");
    expect(html).toContain("The structure differs from the source page (sections)");
    expect(html).not.toContain("Create Dutch (nl) translation");
  });

  it("ML-2: the page list shows one language at a time and the Dutch state of each page", async () => {
    const locales = [
      { locale: "en", enabled: true, public: true, isDefault: true, sortOrder: 0 },
      { locale: "nl", enabled: true, public: false, isDefault: false, sortOrder: 10 },
    ];
    const bv = { ...site("BV", BV), locales };
    reads.set("/api/v1/admin/cms/context", { sites: [bv, site("CORPORATE", COM)] });
    reads.set(`/api/v1/admin/cms/sites/${BV}/pages`, {
      site: bv,
      items: [
        {
          ...aboutPage,
          translations: [
            {
              locale: "nl",
              pageId: null,
              title: null,
              path: null,
              isSource: false,
              state: "missing",
              outdated: false,
              sourceRevisionNumber: null,
              sourceLatestRevisionNumber: null,
            },
          ],
        },
      ],
    });
    reads.set(`/api/v1/admin/cms/sites/${BV}/pages?locale=nl`, { site: bv, items: [] });
    let html = renderToStaticMarkup(
      await ContentPage({ searchParams: Promise.resolve({ site: "bv" }) } as never),
    );
    expect(html).toContain('aria-label="Content language"');
    expect(html).toContain("Dutch (nl) · not public");
    expect(html).toContain("NL: Not translated");
    expect(html).toContain('id="site-routes"');
    html = renderToStaticMarkup(
      await ContentPage({ searchParams: Promise.resolve({ site: "bv", locale: "nl" }) } as never),
    );
    expect(html).toContain("No CMS pages on this site yet");
    // The registry of pages in code belongs to the default language.
    expect(html).not.toContain('id="site-routes"');
  });

  it("answers 404 for a page the API does not return", async () => {
    await expect(
      ContentPageEditor({
        params: Promise.resolve({ id: "0190f2a1-0000-7000-8000-000000000999" }),
      } as never),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
