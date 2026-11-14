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
  });

  it("answers 404 for a page the API does not return", async () => {
    await expect(
      ContentPageEditor({
        params: Promise.resolve({ id: "0190f2a1-0000-7000-8000-000000000999" }),
      } as never),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
