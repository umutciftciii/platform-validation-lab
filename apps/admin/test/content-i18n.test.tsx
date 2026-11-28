// ML-12c (DP-243): the Content screens (CMS pages, news, menus) in Turkish. Every screen and state
// of content-en.test.tsx is rendered twice on the server with the same fixtures — once in English,
// once with the `dp-admin-locale=tr` cookie — and compared:
//   1. no English UI text is left in Turkish: a visible text (text node, aria-label, title,
//      placeholder, alt, a read-only field's text) equal in both languages must be data from the
//      fixtures (page titles, menu labels, addresses, people) or a fixed term (SAME_IN_BOTH);
//   2. the translation changes text only: the element structure, every link, form field, value,
//      data-* attribute and API value (`?site=bv`, `id="slug"`, `/news/`) is identical;
//   3. the contract texts of the CMS (section types, fields, registry notes, menu problems) all have
//      a Turkish entry, and English shows each one word for word;
//   4. Turkish dates come from the format module; content data and the content language stay.
// English itself is covered byte for byte by the EN baseline (content-en.test.tsx).
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CMS_ARTICLE_FIELDS,
  CMS_DESIGN_TEMPLATES,
  CMS_SECTION_TYPES,
  CMS_SITE_REGISTRY,
  CMS_STATIC_ASSETS,
  CmsPageSchema,
  CmsSiteSchema,
  MENU_TARGET_PROBLEMS,
  cmsMenuSchema,
  type CmsField,
} from "@dream/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoticeProvider } from "../components/catalog/notices";
import { HistoryPanel } from "../components/cms/history-panel";
import { ImportButton } from "../components/cms/import-button";
import { MenuEditor, type MenuValue } from "../components/cms/menu-editor";
import { PageCreateForm } from "../components/cms/page-create-form";
import { ConfirmBox, PublicationPanel } from "../components/cms/publication-panel";
import { SiteLanguagesPanel } from "../components/cms/site-languages";
import { TranslationActions } from "../components/cms/translation-actions";
import { LocaleProvider } from "../components/i18n/locale-provider";
import { describePath, messageForIssues } from "../lib/cms-client";
import { cmsText, hasCmsText } from "../lib/cms-text";
import type { AdminLocale } from "../lib/i18n/config";
import { createTranslator } from "../lib/i18n/translate";
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
  emptyPage,
  seedContentReads,
  site,
} from "./support/content-fixtures";

const ui = vi.hoisted(() => ({ locale: "en" as AdminLocale }));
const reads = new Map<string, unknown>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "dp-admin-locale" ? { value: ui.locale } : undefined),
    has: () => false,
  }),
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

const contentModule = await import("../app/(console)/content/page");
const editorModule = await import("../app/(console)/content/[id]/page");
const newModule = await import("../app/(console)/content/new/page");
const newsModule = await import("../app/(console)/content/news/page");
const newArticleModule = await import("../app/(console)/content/news/new/page");

const CMS = "/api/v1/admin/cms";
beforeEach(() => seedContentReads(reads));

/** Names, codes and technical terms that are the same in English and Turkish on purpose. */
const SAME_IN_BOTH = new Set([
  "Dream Petroleum BV",
  "Dream Petroleum",
  "BV",
  "CMS",
  "SEO",
  "URL",
  "Open Graph",
  "LinkedIn",
  "X",
  "Facebook",
  "Instagram",
  "YouTube",
  "EN",
  "NL",
  "Hero (ICCSYN)",
  "noindex",
  "ICCSYN",
  "Site",
  "Corporate",
  "en",
  "nl",
]);

const decode = (s: string) =>
  s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&nbsp;", " ");

/** A `value` that reads like words (a read-only field's text), not an API value. */
const WORDY_VALUE = /\svalue="([^"]*\s[^"]*)"/g;

/** Visible texts: text nodes and the attributes people read or hear. */
function texts(html: string): string[] {
  const out: string[] = [];
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "");
  for (const m of body.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g))
    out.push(decode(m[1] as string));
  for (const m of body.matchAll(WORDY_VALUE)) out.push(decode(m[1] as string));
  for (const m of body.replace(/<[^>]+>/g, "\u0000").split("\u0000")) out.push(decode(m));
  return out.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => /[A-Za-z]{2,}/.test(t));
}

/** Every string value of the API fixtures: data that is shown as it is. */
function fixtureData(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const v of reads.values()) walk(v);
  for (const v of [NAV_CONTENT, FOOTER_CONTENT, MENU_TARGETS]) walk(v);
  // the registry's page titles and paths and the site's image files are data of the contracts
  for (const e of CMS_SITE_REGISTRY) out.push(e.title, ...(e.path ? [e.path] : []));
  for (const a of CMS_STATIC_ASSETS) out.push(a.src);
  return out;
}

function isData(text: string, data: readonly string[]): boolean {
  if (SAME_IN_BOTH.has(text)) return true;
  const unquoted = text.replace(/^[“"‘']|[”"’']$/g, "");
  if (unquoted !== text) return isData(unquoted, data);
  if (data.some((d) => d === text || (text.length > 3 && d.includes(text)))) return true;
  // a text area shows its value with the line breaks collapsed
  if (data.some((d) => d.replace(/\s+/g, " ") === text)) return true;
  // a file of a site image ("company/team-1.jpg"), an address or a public URL of the site
  if (/^[\w./-]+\.(?:webp|jpe?g|png|gif|svg|mp4)$/.test(text)) return true;
  if (/^(?:https?:\/\/|localhost:|\/)\S*(?: › \S+)*$/.test(text)) return true;
  // a composition of data and fixed tokens, e.g. "/news/market-update · Editor (fixture)"
  const rest = text
    .split(/\s*(?:·|,|\/|—|–|:|;|\(|\)|\||→|×|“|”)\s*/)
    .filter((p) => /[A-Za-z]{2,}/.test(p));
  return rest.length > 1 && rest.every((p) => isData(p, data));
}

/** The markup without any visible text: tags and every attribute people do not read. */
function structure(html: string): string {
  return html
    .replace(/\s(?:aria-label|title|placeholder|alt)="[^"]*"/g, "")
    .replace(WORDY_VALUE, "")
    .replace(/>[^<]*</g, "><")
    .replace(/<!-- -->/g, "");
}

type Render = () => Promise<ReactElement> | ReactElement;

async function render(make: Render, locale: AdminLocale): Promise<string> {
  ui.locale = locale;
  const tree = await make();
  return renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <NoticeProvider>{tree}</NoticeProvider>
    </LocaleProvider>,
  );
}

/** English left in Turkish, and whether the two renders differ in anything but text. */
async function compare(make: Render) {
  const en = await render(make, "en");
  const tr = await render(make, "tr");
  const enTexts = new Set(texts(en));
  const data = fixtureData();
  const left = [...new Set(texts(tr))].filter((t) => enTexts.has(t) && !isData(t, data));
  return { en, tr, left };
}

const page = (m: { default: (p: never) => unknown }, props: Record<string, unknown>) => () =>
  m.default(props as never) as Promise<ReactElement>;
const list = (q: Record<string, string> = {}) =>
  page(contentModule, { searchParams: Promise.resolve(q) });
const news = (q: Record<string, string> = {}) =>
  page(newsModule, { searchParams: Promise.resolve(q) });
const editor = (id: string) => page(editorModule, { params: Promise.resolve({ id }) });
const newPage = (q: Record<string, string> = {}) =>
  page(newModule, { searchParams: Promise.resolve(q) });
const newArticle = (q: Record<string, string> = {}) =>
  page(newArticleModule, { searchParams: Promise.resolve(q) });

const pageOf = (id: string) =>
  CmsPageSchema.parse((reads.get(`${CMS}/pages/${id}`) as { page: unknown }).page);
const readOnly = (id: string) => () => {
  const r = reads.get(`${CMS}/pages/${id}`) as Record<string, unknown>;
  reads.set(`${CMS}/pages/${id}`, {
    ...r,
    site: site("BV", { canEdit: false, canPublish: false, locales: LOCALES }),
  });
};
const none = () => undefined;

describe("Content in Turkish: every screen and state", () => {
  const screens: [string, () => void, Render][] = [
    ["content list", none, list()],
    ["content list, Dutch", none, list({ locale: "nl" })],
    ["content list, Corporate", none, list({ site: "corporate" })],
    [
      "content list, read only",
      () => reads.set(`${CMS}/context`, { sites: [site("BV", { canEdit: false })] }),
      list(),
    ],
    ["content list, no access", () => reads.set(`${CMS}/context`, { sites: [] }), list()],
    ["content list, load error", () => reads.set(`${CMS}/sites/${BV}/pages`, FAIL), list()],
    [
      "content list, empty",
      () => reads.set(`${CMS}/sites/${BV}/pages`, { site: site("BV"), items: [] }),
      list(),
    ],
    ["news", none, news()],
    [
      "news, heading not imported",
      () =>
        reads.set(`${CMS}/sites/${BV}/pages`, {
          site: site("BV"),
          items: [aboutPage, emptyPage],
        }),
      news(),
    ],
    ["news, load error", () => reads.set(`${CMS}/sites/${BV}/pages`, FAIL), news()],
    ["news, no access", () => reads.set(`${CMS}/context`, { sites: [] }), news()],
    [
      "news, empty and read only",
      () => {
        reads.set(`${CMS}/context`, { sites: [site("BV", { canEdit: false })] });
        reads.set(`${CMS}/sites/${BV}/pages`, { site: site("BV"), items: [] });
      },
      news(),
    ],
    ["new page", none, newPage()],
    ["new article", none, newArticle()],
    [
      "new page, refused",
      () => reads.set(`${CMS}/context`, { sites: [site("BV", { canEdit: false })] }),
      newPage(),
    ],
    [
      "new article, refused",
      () => reads.set(`${CMS}/context`, { sites: [site("BV", { canEdit: false })] }),
      newArticle(),
    ],
    ...(
      [
        ["designed home page", HOME],
        ["template page, every section type", ABOUT],
        ["Dutch translation, out of date, structure warnings", NL],
        ["unpublished page without sections, history error", EMPTY],
        ["article", ARTICLE],
        ["article without body", OLD],
        ["news page heading", NEWS],
        ["SEO defaults", SEO],
        ["Corporate page not editable yet", CORP],
        ["header menu", NAV],
        ["footer menu", FOOTER],
        ["Dutch menu with link warnings", NAV_NL],
        ["menu draft that does not parse", BROKEN],
      ] as const
    ).map(([name, id]): [string, () => void, Render] => [`editor: ${name}`, none, editor(id)]),
    ...([HOME, ABOUT, ARTICLE, NAV, FOOTER] as const).map((id): [string, () => void, Render] => [
      `editor read only: ${id.slice(-3)}`,
      readOnly(id),
      editor(id),
    ]),
    ["editor, load error", () => reads.set(`${CMS}/pages/${ABOUT}`, FAIL), editor(ABOUT)],
    [
      "menus without targets",
      () => reads.set(`${CMS}/sites/${BV}/menu-targets`, FAIL),
      editor(NAV),
    ],
    [
      "footer without targets",
      () => reads.set(`${CMS}/sites/${BV}/menu-targets`, FAIL),
      editor(FOOTER),
    ],
    [
      "publication and history panels",
      none,
      () => (
        <>
          <PublicationPanel page={pageOf(HOME)} version={4} dirty canPublish previewable />
          <PublicationPanel
            page={pageOf(HOME)}
            version={4}
            dirty={false}
            canPublish={false}
            previewable={false}
          />
          <PublicationPanel page={pageOf(EMPTY)} version={1} dirty={false} canPublish previewable />
          <ConfirmBox
            text="x"
            action="y"
            pending={false}
            onConfirm={() => undefined}
            onCancel={() => undefined}
          />
          <HistoryPanel pageId={HOME} version={4} dirty canEdit history={HISTORY as never} />
          <HistoryPanel pageId={HOME} version={4} dirty={false} canEdit history={null} />
          <HistoryPanel
            pageId={HOME}
            version={4}
            dirty={false}
            canEdit
            history={{ revisions: [] }}
          />
        </>
      ),
    ],
    [
      "import, create forms, translation actions",
      none,
      () => (
        <>
          <ImportButton siteId={BV} siteParam="bv" templateKey="bv.site-nav" title="Navigation" />
          <PageCreateForm siteId={BV} siteParam="bv" siteLabel="BV" />
          <PageCreateForm siteId={BV} siteParam="bv" siteLabel="BV" template="article" />
          <TranslationActions
            pageId={ABOUT}
            version={1}
            siteParam="bv"
            canEdit
            slugEditable
            slug="about-us"
            slugPrefix="/"
            missing={[{ locale: "nl", label: "Dutch (nl)", proposal: true }]}
            outdated={{ latest: 2 }}
          />
        </>
      ),
    ],
    [
      "menu editors, read only and editable",
      none,
      () => (
        <>
          {(["bv.site-nav", "bv.site-footer"] as const).flatMap((key) =>
            [false, true].map((ro) => (
              <MenuEditor
                key={`${key}-${ro}`}
                menuKey={key}
                value={
                  cmsMenuSchema(key).parse(
                    key === "bv.site-nav" ? NAV_CONTENT : FOOTER_CONTENT,
                  ) as MenuValue
                }
                targets={MENU_TARGETS as never}
                contentLocale="en"
                readOnly={ro}
                invalid={(p) => (p.endsWith(".label") ? true : undefined)}
                onChange={() => undefined}
              />
            )),
          )}
        </>
      ),
    ],
  ];

  it.each(screens)("%s: no English UI text, same structure", async (_name, arrange, make) => {
    arrange();
    const { en, tr, left } = await compare(make);
    expect(left).toEqual([]);
    expect(tr).not.toBe(en);
    expect(structure(tr)).toBe(structure(en));
  });

  it("site languages panel", async () => {
    const s = CmsSiteSchema.parse(site("BV", { locales: LOCALES }));
    const { en, tr, left } = await compare(() => (
      <SiteLanguagesPanel site={s} t={createTranslator(ui.locale)} locale={ui.locale} />
    ));
    expect(left).toEqual([]);
    expect(structure(tr)).toBe(structure(en));
    expect(en).toContain("Dutch (nl)");
    expect(tr).toContain("Felemenkçe (nl)");
    expect(tr).toContain("Herkese açık değil");
  });

  it("titles the pages in the console language", async () => {
    const titles = new Map<unknown, [string, string]>([
      [contentModule, ["Content", "İçerik"]],
      [newsModule, ["News", "Haberler"]],
    ]);
    for (const [m, [enTitle, trTitle]] of titles) {
      const meta = m as { generateMetadata: () => Promise<{ title: string }> };
      ui.locale = "tr";
      expect((await meta.generateMetadata()).title).toBe(trTitle);
      ui.locale = "en";
      expect((await meta.generateMetadata()).title).toBe(enTitle);
    }
    for (const m of [editorModule, newModule, newArticleModule]) {
      const meta = m as unknown as { generateMetadata: () => Promise<{ title: string }> };
      ui.locale = "tr";
      const tr = (await meta.generateMetadata()).title;
      ui.locale = "en";
      expect(tr).not.toBe((await meta.generateMetadata()).title);
    }
  });

  it("keeps content data, addresses and API values as they are", async () => {
    const nav = await render(editor(NAV), "tr");
    for (const data of ["Products", "Base oils", "Careers", "This page isn&#x27;t ready yet."])
      expect(nav).toContain(data);
    expect(nav).toContain("https://partner.example.org/");
    const about = await render(editor(ABOUT), "tr");
    for (const data of ["Who we are", "First paragraph.", "About us (fixture)", 'id="slug"'])
      expect(about).toContain(data);
    const listHtml = await render(list(), "tr");
    expect(listHtml).toContain("/content/news?site=bv");
    expect(listHtml).toContain("/about-us");
  });

  it("writes dates and the content language in Turkish", async () => {
    const home = await render(editor(HOME), "tr");
    expect(home).toContain("13 Kas 2026"); // en-GB: 13 Nov 2026
    expect(home).toContain("İngilizce (en)"); // the page's content language as a UI word
    expect(home).not.toContain("13 Nov 2026");
  });
});

describe("the contract texts of the CMS", () => {
  const all: string[] = [];
  const walk = (fields: readonly CmsField[]) => {
    for (const f of fields) {
      all.push(f.label);
      if (f.hint) all.push(f.hint);
      if ("itemLabel" in f) all.push(f.itemLabel);
      if ("fields" in f && f.fields) walk(f.fields);
    }
  };
  for (const s of CMS_SECTION_TYPES) {
    all.push(s.label, s.description);
    walk(s.fields);
  }
  walk(CMS_ARTICLE_FIELDS);
  for (const tpl of CMS_DESIGN_TEMPLATES) walk(tpl.fields);
  for (const e of CMS_SITE_REGISTRY) all.push(e.note);
  all.push(...Object.values(MENU_TARGET_PROBLEMS));
  const texts = [...new Set(all.filter((s) => s.trim()))];
  const en = createTranslator("en");
  const tr = createTranslator("tr");

  it("are all in the dictionary, English word for word", () => {
    // COM-1: +3, the notes of the corporate navigation, footer and SEO defaults. COM-2b: +31, the
    // 30 new labels and hints of the corporate home page and portfolio and the portfolio's
    // registry note (the home page's note is replaced, not added). COM-3: +1, the note of the
    // corporate news list heading (its field texts are the BV heading's). COM-4: +1, the note of
    // the corporate contact page. COM-5: +4, the two notes of the live site's pages and posts and
    // the article's original date (label and hint). COM-7: +8, the background image of a hero
    // section, the pictures' hint, the home page's activity areas (label, item, hint, tab label)
    // and the latest news heading (label and hint).
    expect(texts.length).toBe(178);
    expect(texts.filter((s) => !hasCmsText(s))).toEqual([]);
    expect(texts.filter((s) => cmsText(s, en) !== s)).toEqual([]);
  });

  it("have a Turkish text each", () => {
    expect(texts.filter((s) => cmsText(s, tr) === s)).toEqual([]);
  });

  it("an unknown text is shown as it is", () => {
    expect(cmsText("A field of a newer contract", tr)).toBe("A field of a newer contract");
    expect(cmsText(undefined, tr)).toBeUndefined();
  });
});

describe("CMS API messages in Turkish (codes unchanged)", () => {
  const en = createTranslator("en");
  const tr = createTranslator("tr");

  it("translates by rule and keeps English word for word", () => {
    const stale = [{ path: "version", rule: "stale" }];
    expect(messageForIssues("CONFLICT", stale, en)).toBe(
      "Someone else saved this page meanwhile. Reload the page to see their version.",
    );
    expect(messageForIssues("CONFLICT", stale, tr)).toContain("başka biri kaydetti");
    expect(
      messageForIssues(null, [{ path: "content.items.0", rule: "unknown_reference" }], tr),
    ).toMatch(/^Bir menü bağlantısı/);
    expect(messageForIssues(null, [], tr)).toBe(
      "Değişiklik kaydedilemedi. Biraz sonra tekrar deneyin.",
    );
  });

  it("names field paths in the UI language", () => {
    const issues = [
      { path: "content.sections.2.button.href", rule: "too_long" },
      { path: "content.items.1.children.0.target", rule: "invalid" },
      { path: "seo.canonicalPath", rule: "too_long" },
      { path: "content.excerpt", rule: "too_short" },
    ];
    expect(messageForIssues("VALIDATION_FAILED", issues, en)).toBe(
      "Check these fields: section 3 (button.href), items 2 children 1 target, SEO canonicalPath, summary.",
    );
    expect(messageForIssues("VALIDATION_FAILED", issues, tr)).toBe(
      "Şu alanları kontrol edin: 3. bölüm (düğme › bağlantı), öğe 2 alt menü bağlantısı 1 hedef, SEO kanonik yol, özet.",
    );
    expect(describePath("content.coverAlt", tr)).toBe("kapak görseli");
    expect(describePath("title", tr)).toBe("title");
  });
});
