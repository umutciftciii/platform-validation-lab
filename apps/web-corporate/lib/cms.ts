/**
 * COM-1: server-side reads of the corporate site's CMS content (ADR-020 D6/D7, the same public API
 * as web-bv: `GET /api/v1/public/cms/*` with this site's proxy key; the API derives the site from
 * the key, so BV content can never reach this site and the other way round).
 *
 * Single source: a page renders ONLY what the API returns. A page that is not published or does
 * not validate is not rendered (404 / unavailable); a fragment (navigation, footer) that is not
 * published is simply not shown. Nothing falls back to content in code.
 *
 *  - `getPublishedPage(slug, locale)`: a TEMPLATE page at `/<slug>` with the published
 *    `corporate.site-nav` and `corporate.site-footer` of its language and its counterparts.
 *  - `getPublishedHome(locale)`, `getPublishedProducts(locale)` (COM-2b): the designed pages
 *    `corporate.home` at `/` and `corporate.products` at `/products`, the same way.
 *  - `getNews(locale)`, `getPublishedArticle(slug, locale)` (COM-3): the news list at `/news` under
 *    the published heading `corporate.news-index`, and a published article at `/news/<slug>` (an
 *    article taken off the site says so: "unpublished").
 *  - `getSiteFrame(path, locale)`: the navigation and footer alone, for pages outside the CMS (the
 *    privacy policy, the 404, a home page that is not published).
 *  - `getPreview(token)` (COM-2a, DP-321): the draft a signed preview link names, in its draft's
 *    language — a content page, a designed page, or a fragment (navigation, footer, SEO defaults)
 *    on the home page as the API sends it (COM-2b: the real home page, its draft before its first
 *    publication).
 */
import {
  BvFooterPublicSchema,
  BvNavPublicSchema,
  CMS_NEWS_INDEX_KEYS,
  CMS_SITE_MENU_KEYS,
  CORPORATE_NEWS_INDEX_FIELDS,
  CORPORATE_HOME_FIELDS,
  CORPORATE_HOME_KEY,
  CORPORATE_PRODUCTS_FIELDS,
  CORPORATE_PRODUCTS_KEY,
  CORPORATE_PRODUCTS_PATH,
  CmsPublicAlternateSchema,
  CmsPublicBundleSchema,
  CmsPublicNewsSchema,
  PUBLIC_CMS_API,
  cmsArticleContentSchema,
  cmsFieldsSchema,
  cmsIsArticle,
  cmsTemplateContentSchema,
  type CmsLink,
  type CmsNewsIndexContent,
  type CmsPublicArticle,
  type CorporateHomeContent,
  type CorporateProductsContent,
  type CmsPublicAlternate,
  type CmsPublicPage,
} from "@dream/contracts";

import { apiGet } from "@/lib/api";
import { toFooter, toNav, type SiteFooter, type SiteNav } from "@/lib/menu-view";
import {
  DEFAULT_LOCALE,
  isRouteLocale,
  languageOptions,
  localePath,
  localizeHref,
  localizeLinks,
  storedAddress,
  type LanguageOption,
  type RouteLocale,
} from "@/lib/locale-routing";

export type { NavLink, SiteFooter, SiteNav } from "@/lib/menu-view";
import { visibleLocales } from "@/lib/public-locales";

const KEYS = CMS_SITE_MENU_KEYS.CORPORATE;

/**
 * A section of a TEMPLATE page, as validated by `cmsTemplateContentSchema("CORPORATE")` (COM-2a:
 * a split section's image is a corporate file or none, DP-320).
 */
export type TemplateSection =
  | {
      id: string;
      type: "hero";
      eyebrow: string | null;
      title: string;
      intro: string | null;
      cta: CmsLink | null;
    }
  | { id: string; type: "text"; title: string | null; body: string }
  | {
      id: string;
      type: "cards";
      title: string | null;
      intro: string | null;
      items: { title: string; description: string | null; link: CmsLink | null }[];
    }
  | { id: string; type: "cta"; title: string; text: string | null; button: CmsLink }
  | {
      id: string;
      type: "split";
      eyebrow: string | null;
      title: string;
      body: string;
      image: string | null;
      imageAlt: string | null;
      imageNote: string | null;
    }
  | {
      id: string;
      type: "specList";
      title: string;
      intro: string | null;
      items: { term: string; detail: string | null }[];
      link: CmsLink | null;
    }
  | { id: string; type: "quote"; text: string; source: string | null }
  | {
      id: string;
      type: "contact";
      title: string;
      intro: string | null;
      formTitle: string;
      formNote: string;
    };

export interface SiteFrame {
  nav: SiteNav | null;
  footer: SiteFooter | null;
}

export interface TemplatePageView extends SiteFrame {
  /** The stored path inside its language ("/about-us"). */
  path: string;
  title: string;
  seo: CmsPublicPage["seo"];
  sections: TemplateSection[];
  alternates: readonly CmsPublicAlternate[];
  locale: RouteLocale;
}

/** COM-2b: a designed page (home, portfolio) with its frame. */
export interface DesignPageView<T> extends SiteFrame {
  /** The stored path inside its language ("/", "/products"). */
  path: string;
  title: string;
  seo: CmsPublicPage["seo"];
  content: T;
  alternates: readonly CmsPublicAlternate[];
  locale: RouteLocale;
}
export type HomeView = DesignPageView<CorporateHomeContent>;
export type ProductsView = DesignPageView<CorporateProductsContent>;

/** The designed pages of the corporate site and the schema each is read with. */
const DESIGNS = {
  [CORPORATE_HOME_KEY]: { path: "/", schema: cmsFieldsSchema(CORPORATE_HOME_FIELDS, "CORPORATE") },
  [CORPORATE_PRODUCTS_KEY]: {
    path: CORPORATE_PRODUCTS_PATH,
    schema: cmsFieldsSchema(CORPORATE_PRODUCTS_FIELDS, "CORPORATE"),
  },
} as const;
type DesignKey = keyof typeof DESIGNS;
const isDesignKey = (key: string): key is DesignKey => Object.hasOwn(DESIGNS, key);

export type Read<T> = { ok: true; data: T } | { ok: false; reason: "not_found" | "unavailable" };
/** COM-3: a read that can also say an article was taken off the site. */
export type ArticleRead<T> = Read<T> | { ok: false; reason: "unpublished" };

/** COM-3: the heading of the news list, from the designed page `corporate.news-index`. */
export interface NewsHeading {
  title: string;
  seo: CmsPublicPage["seo"];
  copy: CmsNewsIndexContent;
}

/** COM-3: the published articles (newest first) under the list heading, with the frame. */
export interface NewsView extends SiteFrame {
  heading: NewsHeading;
  /** Each article's `path` is its public address in the list's language. */
  articles: CmsPublicArticle[];
  alternates: readonly CmsPublicAlternate[];
  locale: RouteLocale;
}

/** COM-3: a news article at `/news/<slug>` with its frame. */
export interface ArticleView extends SiteFrame {
  /** The stored path inside its language ("/news/<slug>"). */
  path: string;
  title: string;
  seo: CmsPublicPage["seo"];
  excerpt: string;
  coverImage: string | null;
  coverAlt: string | null;
  sections: TemplateSection[];
  /** Its first publication; null in the preview of an article never published. */
  firstPublishedAt: string | null;
  alternates: readonly CmsPublicAlternate[];
  locale: RouteLocale;
}

const NEWS_INDEX_KEY = CMS_NEWS_INDEX_KEYS.CORPORATE;
const NEWS_INDEX = cmsFieldsSchema(CORPORATE_NEWS_INDEX_FIELDS, "CORPORATE");

/**
 * The frame of a page from the API's fragments, every internal link given the prefix of `locale`
 * (`localizeLinks`): the menus store addresses as the API does (ML-2).
 */
export function frameOf(
  fragments: Record<string, CmsPublicPage | null>,
  currentPath: string,
  locale: RouteLocale,
): Omit<SiteFrame, "nav"> & { nav: Omit<SiteNav, "languages"> | null } {
  const navPage = fragments[KEYS.nav];
  const footerPage = fragments[KEYS.footer];
  const nav = navPage ? BvNavPublicSchema.safeParse(navPage.content) : null;
  const footer = footerPage ? BvFooterPublicSchema.safeParse(footerPage.content) : null;
  if (nav && !nav.success) console.error("public cms: the navigation does not match the contract");
  if (footer && !footer.success)
    console.error("public cms: the footer does not match the contract");
  return localizeLinks(
    {
      nav: nav?.success ? toNav(nav.data, currentPath) : null,
      footer: footer?.success ? toFooter(footer.data) : null,
    },
    locale,
  );
}

/** The language selector: the page's counterparts, else each public language's home. */
async function languagesFor(
  locale: RouteLocale,
  currentPath: string,
  alternates: readonly { locale: string; path: string }[] = [],
): Promise<LanguageOption[]> {
  const targets: Partial<Record<RouteLocale, string>> = {
    [locale]: localePath(locale, currentPath),
  };
  for (const a of alternates) {
    if (isRouteLocale(a.locale) && a.locale !== locale)
      targets[a.locale] = localePath(a.locale, a.path);
  }
  return languageOptions(locale, await visibleLocales(), targets);
}

function localeQuery(locale: RouteLocale, first: "?" | "&"): string {
  return locale === DEFAULT_LOCALE ? "" : `${first}locale=${encodeURIComponent(locale)}`;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A published TEMPLATE page at `/<slug>`; anything else (articles too) is not found here. */
export async function getPublishedPage(
  slug: string,
  locale: RouteLocale = DEFAULT_LOCALE,
): Promise<Read<TemplatePageView>> {
  if (!SLUG.test(slug) || slug.length > 80) return { ok: false, reason: "not_found" };
  const res = await apiGet(
    `${PUBLIC_CMS_API}/page?path=${encodeURIComponent(`/${slug}`)}${localeQuery(locale, "&")}`,
  );
  if (!res) return { ok: false, reason: "unavailable" };
  if (res.status === 404) return { ok: false, reason: "not_found" };
  if (!res.ok) return { ok: false, reason: "unavailable" };
  const bundle = CmsPublicBundleSchema.safeParse(await res.json().catch(() => null));
  if (!bundle.success) {
    console.error("public cms: the page response does not match the contract; not rendered");
    return { ok: false, reason: "unavailable" };
  }
  const { page, fragments } = bundle.data;
  if (page.kind !== "TEMPLATE" || cmsIsArticle(page) || !page.path) {
    return { ok: false, reason: "not_found" };
  }
  const alternates = CmsPublicAlternateSchema.array()
    .max(20)
    .safeParse(bundle.data.alternates ?? []);
  const counterparts = alternates.success ? alternates.data : [];
  const view = await templateView({ ...page, path: page.path }, fragments, locale, counterparts);
  return view ? { ok: true, data: view } : { ok: false, reason: "unavailable" };
}

/**
 * COM-2b: the published designed page at a fixed path (`/`, `/products`) in a language; another
 * kind of page at that address is not found, content that does not validate is unavailable.
 */
async function getPublishedDesign<T>(
  key: DesignKey,
  locale: RouteLocale,
): Promise<Read<DesignPageView<T>>> {
  const { path } = DESIGNS[key];
  const res = await apiGet(
    `${PUBLIC_CMS_API}/page?path=${encodeURIComponent(path)}${localeQuery(locale, "&")}`,
  );
  if (!res) return { ok: false, reason: "unavailable" };
  if (res.status === 404) return { ok: false, reason: "not_found" };
  if (!res.ok) return { ok: false, reason: "unavailable" };
  const bundle = CmsPublicBundleSchema.safeParse(await res.json().catch(() => null));
  if (!bundle.success) {
    console.error("public cms: the page response does not match the contract; not rendered");
    return { ok: false, reason: "unavailable" };
  }
  const { page, fragments } = bundle.data;
  if (page.kind !== "DESIGN" || page.templateKey !== key) return { ok: false, reason: "not_found" };
  const alternates = CmsPublicAlternateSchema.array()
    .max(20)
    .safeParse(bundle.data.alternates ?? []);
  const view = await designView<T>(
    key,
    page,
    fragments,
    locale,
    alternates.success ? alternates.data : [],
  );
  return view ? { ok: true, data: view } : { ok: false, reason: "unavailable" };
}

/** COM-2b: the published home page (`corporate.home`) of a language. */
export function getPublishedHome(locale: RouteLocale = DEFAULT_LOCALE): Promise<Read<HomeView>> {
  return getPublishedDesign<CorporateHomeContent>(CORPORATE_HOME_KEY, locale);
}

/** COM-2b: the published product portfolio (`corporate.products`) of a language. */
export function getPublishedProducts(
  locale: RouteLocale = DEFAULT_LOCALE,
): Promise<Read<ProductsView>> {
  return getPublishedDesign<CorporateProductsContent>(CORPORATE_PRODUCTS_KEY, locale);
}

/** A designed page with its frame, or null when its content does not match the contract. */
async function designView<T>(
  key: DesignKey,
  page: CmsPublicPage,
  fragments: Record<string, CmsPublicPage | null>,
  locale: RouteLocale,
  counterparts: readonly CmsPublicAlternate[],
): Promise<DesignPageView<T> | null> {
  const { path, schema } = DESIGNS[key];
  const content = schema.safeParse(page.content);
  if (!content.success) {
    console.error(`public cms: the ${key} content does not match the contract; not rendered`);
    return null;
  }
  const frame = frameOf(fragments, path === "/" ? "/" : storedAddress(locale, path), locale);
  return {
    path,
    title: page.title,
    seo: page.seo,
    content: localizeLinks(content.data as T, locale),
    alternates: counterparts,
    locale,
    footer: frame.footer,
    nav: frame.nav
      ? { ...frame.nav, languages: await languagesFor(locale, path, counterparts) }
      : null,
  };
}

/** A TEMPLATE page with its frame, or null when its content does not match the contract. */
async function templateView(
  page: CmsPublicPage & { path: string },
  fragments: Record<string, CmsPublicPage | null>,
  locale: RouteLocale,
  counterparts: readonly CmsPublicAlternate[],
): Promise<TemplatePageView | null> {
  const content = cmsTemplateContentSchema("CORPORATE").safeParse(page.content);
  if (!content.success) {
    console.error("public cms: the page content does not match the contract; not rendered");
    return null;
  }
  const frame = frameOf(fragments, storedAddress(locale, page.path), locale);
  return {
    path: page.path,
    title: page.title,
    seo: page.seo,
    sections: localizeLinks(content.data.sections as TemplateSection[], locale),
    alternates: counterparts,
    locale,
    footer: frame.footer,
    nav: frame.nav
      ? { ...frame.nav, languages: await languagesFor(locale, page.path, counterparts) }
      : null,
  };
}

/** The list heading of a `corporate.news-index` page; null for another page or invalid content. */
function newsHeading(page: CmsPublicPage | null): NewsHeading | null {
  if (!page || page.kind !== "DESIGN" || page.templateKey !== NEWS_INDEX_KEY) return null;
  const parsed = NEWS_INDEX.safeParse(page.content);
  if (!parsed.success) {
    console.error("public cms: the news heading does not match the contract; not rendered");
    return null;
  }
  return { title: page.title, seo: page.seo, copy: parsed.data as unknown as CmsNewsIndexContent };
}

/** COM-3: the site's news read of a language (articles, heading, fragments, counterparts). */
async function readNews(locale: RouteLocale): Promise<
  Read<{
    heading: NewsHeading | null;
    articles: CmsPublicArticle[];
    frame: SiteFrame;
    alternates: CmsPublicAlternate[];
  }>
> {
  const res = await apiGet(`${PUBLIC_CMS_API}/news${localeQuery(locale, "?")}`);
  if (!res) return { ok: false, reason: "unavailable" };
  if (res.status === 404) return { ok: false, reason: "not_found" };
  if (!res.ok) return { ok: false, reason: "unavailable" };
  const parsed = CmsPublicNewsSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    console.error("public cms: the news response does not match the contract; not rendered");
    return { ok: false, reason: "unavailable" };
  }
  const alternates = parsed.data.alternates ?? [];
  const frame = frameOf(parsed.data.fragments, storedAddress(locale, "/news"), locale);
  return {
    ok: true,
    data: {
      heading: newsHeading(parsed.data.page),
      articles: parsed.data.articles.map((a) => ({ ...a, path: localizeHref(locale, a.path) })),
      alternates,
      frame: {
        footer: frame.footer,
        nav: frame.nav
          ? { ...frame.nav, languages: await languagesFor(locale, "/news", alternates) }
          : null,
      },
    },
  };
}

/**
 * COM-3: the news list of a language — the published articles under the published heading
 * (`corporate.news-index`). Without a published heading the list does not exist in that language
 * (not found: the site's 404, as the proxy decides); an empty list is a normal answer.
 */
export async function getNews(locale: RouteLocale = DEFAULT_LOCALE): Promise<Read<NewsView>> {
  const res = await readNews(locale);
  if (!res.ok) return res;
  const { heading, articles, alternates, frame } = res.data;
  if (!heading) return { ok: false, reason: "not_found" };
  return { ok: true, data: { heading, articles, alternates, locale, ...frame } };
}

/** Whether a 404 body says the page was published here and has been taken off the site. */
function unpublishedBody(body: unknown): boolean {
  const details = (body as { error?: { details?: unknown } } | null)?.error?.details;
  return (
    Array.isArray(details) &&
    details.some(
      (d) =>
        typeof d === "object" && d !== null && (d as { rule?: unknown }).rule === "unpublished",
    )
  );
}

/** COM-3: a published article at `/news/<slug>` of a language. */
export async function getPublishedArticle(
  slug: string,
  locale: RouteLocale = DEFAULT_LOCALE,
): Promise<ArticleRead<ArticleView>> {
  if (!SLUG.test(slug) || slug.length > 80) return { ok: false, reason: "not_found" };
  const res = await apiGet(
    `${PUBLIC_CMS_API}/page?path=${encodeURIComponent(`/news/${slug}`)}${localeQuery(locale, "&")}`,
  );
  if (!res) return { ok: false, reason: "unavailable" };
  if (res.status === 404) {
    return unpublishedBody(await res.json().catch(() => null))
      ? { ok: false, reason: "unpublished" }
      : { ok: false, reason: "not_found" };
  }
  if (!res.ok) return { ok: false, reason: "unavailable" };
  const bundle = CmsPublicBundleSchema.safeParse(await res.json().catch(() => null));
  if (!bundle.success) {
    console.error("public cms: the article response does not match the contract; not rendered");
    return { ok: false, reason: "unavailable" };
  }
  const { page, fragments } = bundle.data;
  if (!cmsIsArticle(page) || !page.path) return { ok: false, reason: "not_found" };
  const alternates = CmsPublicAlternateSchema.array()
    .max(20)
    .safeParse(bundle.data.alternates ?? []);
  const view = await articleView(
    { ...page, path: page.path },
    fragments,
    locale,
    alternates.success ? alternates.data : [],
  );
  return view ? { ok: true, data: view } : { ok: false, reason: "unavailable" };
}

/** An article with its frame, or null when its content does not match the contract. */
async function articleView(
  page: CmsPublicPage & { path: string },
  fragments: Record<string, CmsPublicPage | null>,
  locale: RouteLocale,
  counterparts: readonly CmsPublicAlternate[],
): Promise<ArticleView | null> {
  // The corporate site's own rules (DP-320): a cover is one of its files or none.
  const content = cmsArticleContentSchema("CORPORATE").safeParse(page.content);
  if (!content.success) {
    console.error("public cms: the article content does not match the contract; not rendered");
    return null;
  }
  const c = content.data as unknown as {
    excerpt: string;
    coverImage: string | null;
    coverAlt: string | null;
    sections: TemplateSection[];
  };
  const frame = frameOf(fragments, storedAddress(locale, "/news"), locale);
  return {
    path: page.path,
    title: page.title,
    seo: page.seo,
    excerpt: c.excerpt,
    coverImage: c.coverImage,
    coverAlt: c.coverAlt,
    sections: localizeLinks(c.sections, locale),
    firstPublishedAt: page.firstPublishedAt ?? null,
    alternates: counterparts,
    locale,
    footer: frame.footer,
    nav: frame.nav
      ? { ...frame.nav, languages: await languagesFor(locale, page.path, counterparts) }
      : null,
  };
}

/** COM-2a (DP-321): what a preview link shows. */
export type PreviewView =
  | { kind: "template"; locale: RouteLocale; page: TemplatePageView }
  /** COM-2b: the home page — its draft, or the page a fragment's draft is shown on. */
  | { kind: "home"; locale: RouteLocale; page: HomeView }
  | { kind: "products"; locale: RouteLocale; page: ProductsView }
  /** COM-3: an article's draft, and the list heading's draft over the published articles. */
  | { kind: "article"; locale: RouteLocale; page: ArticleView }
  | { kind: "news"; locale: RouteLocale; page: NewsView };

const PREVIEW_TOKEN = /^v1\.[0-9a-f-]{36}\.CORPORATE\.\d{10,13}\.[0-9a-f]{64}$/;

/**
 * The draft a signed preview link names (the API checks the signature, the expiry and that the
 * link is this site's). A link of another site never matches the token form and is not even
 * asked. The address carries no language: the draft's language comes with the response.
 */
export async function getPreview(token: string): Promise<Read<PreviewView>> {
  if (!PREVIEW_TOKEN.test(token)) return { ok: false, reason: "not_found" };
  const res = await apiGet(`${PUBLIC_CMS_API}/preview/${token}`);
  if (!res) return { ok: false, reason: "unavailable" };
  if (res.status === 404) return { ok: false, reason: "not_found" };
  if (!res.ok) return { ok: false, reason: "unavailable" };
  const bundle = CmsPublicBundleSchema.safeParse(await res.json().catch(() => null));
  if (!bundle.success || !bundle.data.preview) {
    console.error("public cms: the preview response does not match the contract; not rendered");
    return { ok: false, reason: "unavailable" };
  }
  const { page, fragments } = bundle.data;
  const locale: RouteLocale = isRouteLocale(bundle.data.locale)
    ? bundle.data.locale
    : DEFAULT_LOCALE;
  if (cmsIsArticle(page)) {
    if (!page.path) return { ok: false, reason: "not_found" };
    const view = await articleView({ ...page, path: page.path }, fragments, locale, []);
    return view
      ? { ok: true, data: { kind: "article", locale, page: view } }
      : { ok: false, reason: "unavailable" };
  }
  if (page.kind === "DESIGN" && page.templateKey === NEWS_INDEX_KEY) {
    // The heading's draft over the published articles of its language (also before the heading
    // was ever published: the list read answers without a heading then).
    const heading = newsHeading(page);
    if (!heading) return { ok: false, reason: "unavailable" };
    const list = await readNews(locale);
    const frame = frameOf(fragments, storedAddress(locale, "/news"), locale);
    return {
      ok: true,
      data: {
        kind: "news",
        locale,
        page: {
          heading,
          articles: list.ok ? list.data.articles : [],
          alternates: [],
          locale,
          footer: frame.footer,
          nav: frame.nav ? { ...frame.nav, languages: await languagesFor(locale, "/news") } : null,
        },
      },
    };
  }
  if (page.kind === "TEMPLATE") {
    if (!page.path) return { ok: false, reason: "not_found" };
    const view = await templateView({ ...page, path: page.path }, fragments, locale, []);
    return view
      ? { ok: true, data: { kind: "template", locale, page: view } }
      : { ok: false, reason: "unavailable" };
  }
  // COM-2b: a designed page; a fragment's draft comes on the home page (the API sends it).
  if (page.kind !== "DESIGN" || !isDesignKey(page.templateKey)) {
    return { ok: false, reason: "not_found" };
  }
  if (page.templateKey === CORPORATE_HOME_KEY) {
    const view = await designView<CorporateHomeContent>(
      page.templateKey,
      page,
      fragments,
      locale,
      [],
    );
    return view
      ? { ok: true, data: { kind: "home", locale, page: view } }
      : { ok: false, reason: "unavailable" };
  }
  const view = await designView<CorporateProductsContent>(
    page.templateKey,
    page,
    fragments,
    locale,
    [],
  );
  return view
    ? { ok: true, data: { kind: "products", locale, page: view } }
    : { ok: false, reason: "unavailable" };
}

/**
 * The published navigation and footer of a language for a page outside the CMS. The public news
 * read carries the site's fragments; both are null while the API cannot answer, and the page shows
 * its minimal frame.
 */
export async function getSiteFrame(
  path: string,
  locale: RouteLocale = DEFAULT_LOCALE,
): Promise<SiteFrame & { languages: LanguageOption[] }> {
  const languages = await languagesFor(locale, path);
  const res = await apiGet(`${PUBLIC_CMS_API}/news${localeQuery(locale, "?")}`);
  if (!res?.ok) return { nav: null, footer: null, languages };
  const parsed = CmsPublicNewsSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    console.error("public cms: the frame response does not match the contract; not rendered");
    return { nav: null, footer: null, languages };
  }
  const frame = frameOf(
    parsed.data.fragments,
    path === "/" ? "/" : storedAddress(locale, path),
    locale,
  );
  return { footer: frame.footer, nav: frame.nav ? { ...frame.nav, languages } : null, languages };
}
