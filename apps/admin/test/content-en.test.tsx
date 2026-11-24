// ML-12c (DP-243) EN regression of the Content area: CMS pages, news, the menu editors (header and
// footer), publication, history, translations and site languages. Every render below goes through
// support/en-baseline-render: it is compared with the HTML recorded on private main a7b140f (before
// ML-12c) in fixtures/catalog-en/content-en.json.gz (record with ML12C_RECORD_EN=1, this file only).
// Covered beyond cms-pages-render.test.tsx: no access, load errors, empty and read-only states,
// every section type, the BV designed page, both menus with every target kind and problem, the
// menu draft that no longer parses, the SEO defaults fragment, unpublished pages, every
// translation state, menu link warnings, the create forms, and the client panels in the states
// their props select (preview, publish, history, import, translation actions).
import type { CmsPage, CmsSite } from "@dream/contracts";
import { CmsPageSchema, CmsSiteSchema, cmsMenuSchema } from "@dream/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoticeProvider } from "../components/catalog/notices";
import { HistoryPanel } from "../components/cms/history-panel";
import { ImportButton } from "../components/cms/import-button";
import { MenuEditor, type MenuValue } from "../components/cms/menu-editor";
import { PageCreateForm } from "../components/cms/page-create-form";
import { ConfirmBox, PublicationPanel } from "../components/cms/publication-panel";
import { SiteLanguagesPanel, languageStates } from "../components/cms/site-languages";
import { TranslationActions } from "../components/cms/translation-actions";
import { createTranslator } from "../lib/i18n/translate";
import { renderToStaticMarkup } from "./support/en-baseline-render";
import {
  ABOUT,
  ARTICLE,
  BROKEN,
  BV,
  CORP,
  EMPTY,
  FAIL,
  FOOTER,
  FOOTER_CONTENT,
  HISTORY,
  HOME,
  LOCALES,
  MENU_TARGETS,
  NAV,
  NAV_CONTENT,
  NAV_NL,
  NEWS,
  NL,
  OLD,
  SEO,
  aboutPage,
  detail,
  emptyPage,
  homePage,
  navPage,
  publication,
  seedContentReads,
  site,
} from "./support/content-fixtures";

const reads = new Map<string, unknown>();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));
vi.mock("../lib/server-api", () => ({
  serverRead: async (path: string, schema: { parse(v: unknown): unknown }) => {
    if (!reads.has(path)) return { ok: false, status: 404, code: "NOT_FOUND" };
    const v = reads.get(path);
    if (v === FAIL) return { ok: false, status: 500, code: "INTERNAL_ERROR" };
    return { ok: true, data: schema.parse(v) };
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
const { default: EditorPage } = await import("../app/(console)/content/[id]/page");
const { default: NewPage } = await import("../app/(console)/content/new/page");
const { default: NewsPage } = await import("../app/(console)/content/news/page");
const { default: NewArticlePage } = await import("../app/(console)/content/news/new/page");

const CMS = "/api/v1/admin/cms";
const EN = createTranslator("en");
beforeEach(() => seedContentReads(reads));

const render = async (node: Promise<React.ReactNode>) => renderToStaticMarkup(await node);
const list = (query: Record<string, string> = {}) =>
  render(ContentPage({ searchParams: Promise.resolve(query) } as never));
const news = (query: Record<string, string> = {}) =>
  render(NewsPage({ searchParams: Promise.resolve(query) } as never));
const editor = (id: string) => render(EditorPage({ params: Promise.resolve({ id }) } as never));
const newPage = (query: Record<string, string> = {}) =>
  render(NewPage({ searchParams: Promise.resolve(query) } as never));
const newArticle = (query: Record<string, string> = {}) =>
  render(NewArticlePage({ searchParams: Promise.resolve(query) } as never));

const pageOf = (id: string): CmsPage =>
  CmsPageSchema.parse((reads.get(`${CMS}/pages/${id}`) as { page: unknown }).page);
const bvSite = (over: Record<string, unknown> = {}): CmsSite =>
  CmsSiteSchema.parse(site("BV", { locales: LOCALES, ...over }));

describe("content list (EN)", () => {
  it("lists the pages, their states, translations and the routes still in code", async () => {
    const html = await list();
    expect(html).toContain("CMS pages");
    expect(html).toContain("Existing site pages");
  });

  it("shows another language, the Corporate site and read-only access", async () => {
    await list({ locale: "nl" });
    await list({ site: "corporate" });
    reads.set(`${CMS}/context`, { sites: [site("BV", { canEdit: false, canPublish: false })] });
    await list();
  });

  it("shows no access, a load error and an empty site", async () => {
    reads.set(`${CMS}/context`, { sites: [] });
    expect(await list()).toContain("No access to site content");
    seedContentReads(reads);
    reads.set(`${CMS}/sites/${BV}/pages`, FAIL);
    expect(await list()).toContain("The page list could not be loaded");
    reads.set(`${CMS}/sites/${BV}/pages`, { site: site("BV"), items: [] });
    expect(await list()).toContain("No CMS pages on this site yet");
    reads.set(`${CMS}/context`, { sites: [site("BV", { canEdit: false })] });
    await list();
  });
});

describe("news list (EN)", () => {
  it("lists the articles with the news page heading", async () => {
    expect(await news()).toContain("Market update (fixture)");
  });

  it("shows the news page not imported, empty, error, no access and read only", async () => {
    reads.set(`${CMS}/sites/${BV}/pages`, {
      site: site("BV"),
      items: [aboutPage, emptyPage],
    });
    await news();
    reads.set(`${CMS}/sites/${BV}/pages`, FAIL);
    await news();
    reads.set(`${CMS}/context`, { sites: [] });
    await news();
    reads.set(`${CMS}/context`, { sites: [site("BV", { canEdit: false })] });
    reads.set(`${CMS}/sites/${BV}/pages`, { site: site("BV"), items: [] });
    await news();
    await news({ site: "corporate" });
  });
});

describe("new page and new article (EN)", () => {
  it("shows the forms and the refusal without content:edit", async () => {
    await newPage();
    await newArticle();
    await newPage({ site: "corporate" });
    reads.set(`${CMS}/context`, { sites: [site("BV", { canEdit: false })] });
    await newPage();
    await newArticle();
    reads.set(`${CMS}/context`, FAIL);
    await newPage();
  });
});

describe("page editor (EN)", () => {
  it("renders every kind of page", async () => {
    for (const id of [HOME, ABOUT, NL, EMPTY, ARTICLE, OLD, NEWS, SEO, CORP]) await editor(id);
  });

  it("renders both menu editors, a translated menu and a draft that does not parse", async () => {
    expect(await editor(NAV)).toContain("Header menu");
    expect(await editor(FOOTER)).toContain("Link columns");
    await editor(NAV_NL);
    expect(await editor(BROKEN)).toContain("does not match the menu fields");
  });

  it("renders read-only pages and the load error", async () => {
    const ro = site("BV", { canEdit: false, canPublish: false, locales: LOCALES });
    for (const id of [HOME, ABOUT, ARTICLE, NAV, FOOTER]) {
      const r = reads.get(`${CMS}/pages/${id}`) as Record<string, unknown>;
      reads.set(`${CMS}/pages/${id}`, { ...r, site: ro });
      await editor(id);
    }
    reads.set(`${CMS}/pages/${ABOUT}`, FAIL);
    expect(await editor(ABOUT)).toContain("The page could not be loaded");
  });

  it("renders the menus without targets (could not be loaded)", async () => {
    reads.set(`${CMS}/sites/${BV}/menu-targets`, FAIL);
    await editor(NAV);
    await editor(FOOTER);
  });
});

describe("client panels in the states their props select (EN)", () => {
  const wrap = (node: React.ReactNode) =>
    renderToStaticMarkup(<NoticeProvider>{node}</NoticeProvider>);

  it("publication panel", () => {
    const home = pageOf(HOME);
    for (const [dirty, canPublish, previewable, version] of [
      [false, true, true, home.version],
      [true, true, true, home.version],
      [false, false, false, home.version],
      [false, true, true, 3],
    ] as const)
      wrap(
        <PublicationPanel
          page={home}
          version={version}
          dirty={dirty}
          canPublish={canPublish}
          previewable={previewable}
        />,
      );
    const unpublished = pageOf(EMPTY);
    wrap(<PublicationPanel page={unpublished} version={1} dirty={false} canPublish previewable />);
    const draft = CmsPageSchema.parse(detail({ ...homePage, publication: null }, {}));
    wrap(<PublicationPanel page={draft} version={1} dirty={false} canPublish previewable />);
    const fragment = CmsPageSchema.parse(detail({ ...navPage, publication: publication() }, {}));
    wrap(<PublicationPanel page={fragment} version={3} dirty={false} canPublish previewable />);
  });

  it("confirm box", () => {
    wrap(
      <ConfirmBox
        text="Publish draft version 4 to the live site?"
        action="Publish"
        pending={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
  });

  it("history panel", () => {
    for (const [history, dirty, canEdit] of [
      [HISTORY, false, true],
      [HISTORY, true, true],
      [HISTORY, false, false],
      [{ revisions: [] }, false, true],
      [null, false, true],
    ] as const)
      wrap(
        <HistoryPanel
          pageId={HOME}
          version={4}
          dirty={dirty}
          canEdit={canEdit}
          history={history as never}
        />,
      );
  });

  it("import button, create forms and translation actions", () => {
    wrap(<ImportButton siteId={BV} siteParam="bv" templateKey="bv.site-nav" title="Navigation" />);
    wrap(<PageCreateForm siteId={BV} siteParam="bv" siteLabel="BV" />);
    wrap(<PageCreateForm siteId={BV} siteParam="bv" siteLabel="BV" template="article" />);
    const base = {
      pageId: ABOUT,
      version: 1,
      siteParam: "bv",
      slug: "about-us",
      slugPrefix: "/",
    };
    for (const over of [
      { canEdit: true, slugEditable: true, missing: [{ locale: "nl", label: "Dutch (nl)" }] },
      {
        canEdit: true,
        slugEditable: false,
        missing: [{ locale: "nl", label: "Dutch (nl)", proposal: true }],
      },
      { canEdit: true, slugEditable: true, missing: [], outdated: { latest: 2 } },
      { canEdit: false, slugEditable: true, missing: [{ locale: "nl", label: "Dutch (nl)" }] },
    ])
      wrap(
        <TranslationActions
          {...base}
          outdated={null}
          {...(over as Pick<
            Parameters<typeof TranslationActions>[0],
            "canEdit" | "slugEditable" | "missing"
          >)}
        />,
      );
  });

  it("site languages", () => {
    wrap(<SiteLanguagesPanel site={bvSite()} t={EN} locale="en" />);
    wrap(
      <SiteLanguagesPanel
        site={bvSite({
          locales: [
            ...LOCALES,
            { locale: "de", enabled: false, public: false, isDefault: false, sortOrder: 20 },
          ],
        })}
        t={EN}
        locale="en"
      />,
    );
    wrap(<SiteLanguagesPanel site={bvSite({ locales: [] })} t={EN} locale="en" />);
    expect(
      languageStates(
        {
          locale: "de",
          enabled: false,
          public: false,
          isDefault: true,
          sortOrder: 0,
        },
        EN,
      ),
    ).toEqual(["Default", "Not public", "Editing off"]);
  });

  it("menu editors read only and with every target kind", () => {
    for (const [key, content] of [
      ["bv.site-nav", NAV_CONTENT],
      ["bv.site-footer", FOOTER_CONTENT],
    ] as const) {
      const value = cmsMenuSchema(key).parse(content) as MenuValue;
      for (const readOnly of [false, true])
        for (const targets of [MENU_TARGETS, null])
          wrap(
            <MenuEditor
              menuKey={key}
              value={value}
              contentLocale="en"
              targets={targets as never}
              readOnly={readOnly}
              invalid={(p) => (p.endsWith(".label") || p === "content.headline" ? true : undefined)}
              onChange={() => undefined}
            />,
          );
    }
  });
});
