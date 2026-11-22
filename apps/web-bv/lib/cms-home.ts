/**
 * CMS S2 (DP-134, ADR-020 D6/D7): server-side reads of CMS pages for dreampetroleumbv.com, and the
 * mapping of the validated content to the props of the home page's components.
 *
 * Contract (as lib/catalog-api.ts): only `GET /api/v1/public/cms/*` of the platform API, with this
 * site's proxy key, from the server; the API derives the site from the key. Responses are
 * validated again here against the same field descriptors the admin and API use.
 *
 * Single source: the page renders ONLY what the API returns. A page that is not published, or a
 * response that does not validate, renders the unavailable state; there is no fallback to content
 * in code. A fragment (navigation, footer) that is not published is simply not shown.
 */
import {
  BV_HOME_FIELDS,
  BV_NEWS_INDEX_FIELDS,
  BvFooterPublicSchema,
  BvNavPublicSchema,
  CmsArticleContentSchema,
  CmsPublicAlternateSchema,
  type CmsPublicAlternate,
  CmsPublicBundleSchema,
  CmsPublicNewsSchema,
  CmsTemplateContentSchema,
  PUBLIC_CMS_API,
  cmsAsset,
  cmsFieldsSchema,
  cmsIsArticle,
  type BvFooterPublic,
  type BvHomeContent,
  type BvNavPublic,
  type BvNewsIndexContent,
  type MenuPublicLink,
  type CmsLink,
  type CmsPublicArticle,
  type CmsPublicPage,
} from "@dream/contracts";

import type { ApplicationScene, ApplicationsCopy } from "@/content/applications-showcase";
import { applicationsUi } from "@/content/applications-showcase";
import type { CtlCopy, CtlStage } from "@/content/ctl-technology";
import { ctlUi } from "@/content/ctl-technology";
import type { IccsynHeroContent } from "@/content/iccsyn-hero";
import type { ProductGroup, ProductGroupsCopy } from "@/content/product-groups";
import { productGroupsUi } from "@/content/product-groups";
import type { ServiceItem, ServicesCopy } from "@/content/services-showcase";
import { servicesUi } from "@/content/services-showcase";
import type { FooterLink, SiteFooterContent } from "@/content/site-footer";
import { siteFooterUi } from "@/content/site-footer";
import type { SiteNavContent, SiteNavItem } from "@/content/site-nav";
import { siteNavUi } from "@/content/site-nav";
import { catalogConfig, type Read } from "@/lib/catalog-api";
import {
  DEFAULT_LOCALE,
  isRouteLocale,
  languageOptions,
  localePath,
  localizeHref,
  localizeLinks,
  storedAddress,
  type RouteLocale,
} from "@/lib/locale-routing";
import { dictionary } from "@/lib/i18n";
import { visibleLocales } from "@/lib/public-locales";

const TIMEOUT_MS = 5_000;

export interface HomeProps {
  hero: IccsynHeroContent;
  productGroups: { groups: ProductGroup[]; copy: ProductGroupsCopy };
  services: { services: ServiceItem[]; copy: ServicesCopy };
  ctl: { stages: CtlStage[]; copy: CtlCopy };
  applications: { scenes: ApplicationScene[]; copy: ApplicationsCopy };
}

/** A section of a TEMPLATE page, as validated by CmsTemplateContentSchema. */
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
      image: string;
      imageAlt: string;
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

export interface TemplatePageView {
  path: string;
  title: string;
  seo: CmsPublicPage["seo"];
  sections: TemplateSection[];
  nav: SiteNavContent | null;
  footer: SiteFooterContent | null;
  /** ML-5: published counterparts in the other public languages (hreflang); absent in a preview. */
  alternates?: readonly CmsPublicAlternate[];
  /** ML-3/DP-250: the page's language (a preview names its draft's language). */
  locale: RouteLocale;
  preview: boolean;
}

/** DP-020: a news article (TEMPLATE page with the article template at /news/<slug>). */
export interface ArticleView {
  path: string;
  title: string;
  seo: CmsPublicPage["seo"];
  excerpt: string;
  coverImage: string | null;
  coverAlt: string | null;
  sections: TemplateSection[];
  /** The first publication; null in a preview of a draft that was never published. */
  firstPublishedAt: string | null;
  nav: SiteNavContent | null;
  footer: SiteFooterContent | null;
  /** ML-5: published counterparts in the other public languages (hreflang); absent in a preview. */
  alternates?: readonly CmsPublicAlternate[];
  /** ML-3/DP-250: the page's language (a preview names its draft's language). */
  locale: RouteLocale;
  preview: boolean;
}

/** DP-153: the heading of the news list, from the designed page `bv.news-index`. */
export interface NewsHeading {
  title: string;
  seo: CmsPublicPage["seo"];
  copy: BvNewsIndexContent;
}

/** DP-020: the published articles, newest first, with the list heading, navigation and footer. */
export interface NewsView {
  heading: NewsHeading;
  articles: CmsPublicArticle[];
  nav: SiteNavContent | null;
  footer: SiteFooterContent | null;
  /** ML-5: published counterparts in the other public languages (hreflang); absent in a preview. */
  alternates?: readonly CmsPublicAlternate[];
  /** ML-6: the list's language (interface labels and date format). */
  locale: RouteLocale;
  preview: boolean;
}

/** DP-153: a preview of the list heading's draft (the route adds the published articles). */
export interface NewsIndexView {
  heading: NewsHeading;
  nav: SiteNavContent | null;
  footer: SiteFooterContent | null;
  /** ML-3/DP-250: the page's language (a preview names its draft's language). */
  locale: RouteLocale;
  preview: boolean;
}

export type AnyPageView =
  | ({ kind: "home" } & CmsPageView)
  | ({ kind: "template" } & TemplatePageView)
  | ({ kind: "article" } & ArticleView)
  | ({ kind: "newsIndex" } & NewsIndexView);

export interface CmsPageView {
  title: string;
  seo: CmsPublicPage["seo"];
  home: HomeProps;
  nav: SiteNavContent | null;
  footer: SiteFooterContent | null;
  /** ML-5: published counterparts in the other public languages (hreflang); absent in a preview. */
  alternates?: readonly CmsPublicAlternate[];
  /** ML-3/DP-250: the page's language (a preview names its draft's language). */
  locale: RouteLocale;
  preview: boolean;
}

const HOME = cmsFieldsSchema(BV_HOME_FIELDS);
// DP-219: the menus arrive in their public shape (references resolved, hidden links dropped).
const NAV = BvNavPublicSchema;
const FOOTER = BvFooterPublicSchema;
const NEWS_INDEX = cmsFieldsSchema(BV_NEWS_INDEX_FIELDS);

/** The list heading of a `bv.news-index` page; null when it is another page or does not validate. */
function newsHeading(page: CmsPublicPage | null): NewsHeading | null {
  if (!page || page.kind !== "DESIGN" || page.templateKey !== "bv.news-index") return null;
  const parsed = NEWS_INDEX.safeParse(page.content);
  if (!parsed.success) return null;
  return { title: page.title, seo: page.seo, copy: parsed.data as unknown as BvNewsIndexContent };
}

function size(src: string): { width: number; height: number } {
  const asset = cmsAsset(src);
  // The API accepts only registered assets, so this is a broken invariant, not a user error.
  if (!asset) throw new Error("unregistered CMS asset");
  return { width: asset.width, height: asset.height };
}

/** ML-6: `locale` gives the interface labels of the sections (the content is the CMS's). */
export function toHomeProps(c: BvHomeContent, locale: RouteLocale = DEFAULT_LOCALE): HomeProps {
  return {
    hero: {
      copy: {
        brand: c.hero.brand,
        tagline: c.hero.tagline,
        scrollCue: c.hero.scrollCue,
        cta: c.hero.cta.label,
        ctaHref: c.hero.cta.href,
        ctaDisabledNote: c.hero.cta.disabledNote,
        supply: c.hero.supply,
        legal: c.hero.legal,
        mediaAlt: c.hero.mediaAlt,
        skip: dictionary(locale).home.hero.skip,
      },
      applications: c.hero.applications.map((a) => ({
        title: a.title,
        description: a.description,
        image: { src: a.image },
      })),
    },
    productGroups: {
      copy: { ...productGroupsUi(locale), label: c.productGroups.label, disclosure: c.productGroups.disclosure },
      groups: c.productGroups.groups.map((g) => ({
        id: g.anchor,
        name: { word: g.nameWord, numeral: g.nameNumeral },
        eyebrow: g.eyebrow,
        description: g.description,
        ...(g.note ? { note: g.note } : {}),
        samples: g.samples,
        cta: g.cta,
        media: { kind: "gif" as const, src: g.animation, poster: g.poster },
        mediaAlt: g.mediaAlt,
      })),
    },
    services: {
      copy: {
        ...servicesUi(locale),
        eyebrow: c.services.eyebrow,
        title: c.services.title,
        intro: c.services.intro,
        disclosure: c.services.disclosure,
      },
      services: c.services.items.map((s) => ({
        id: s.anchor,
        title: s.title,
        description: s.description,
        shortDescription: s.shortDescription,
        cta: s.cta,
        image: {
          alt: s.imageAlt,
          desktop: { src: s.desktopImage, position: s.desktopPosition, ...size(s.desktopImage) },
          mobile: { src: s.mobileImage, position: s.mobilePosition, ...size(s.mobileImage) },
        },
      })),
    },
    ctl: {
      copy: { ...ctlUi(locale), eyebrow: c.ctl.eyebrow, title: c.ctl.title, document: c.ctl.document },
      stages: c.ctl.stages.map((s) => ({
        id: s.anchor,
        title: s.title,
        description: s.description,
        disclosure: s.disclosure,
        image: {
          src: s.image,
          ...size(s.image),
          alt: s.imageAlt,
          positionDesktop: s.positionDesktop,
          positionMobile: s.positionMobile,
        },
      })),
    },
    applications: {
      copy: {
        ...applicationsUi(locale),
        eyebrow: c.applications.eyebrow,
        title: c.applications.title,
        status: c.applications.status,
        intro: c.applications.intro,
        validation: {
          ...c.applications.validation,
          requirements: c.applications.validation.requirements.map((r) => r.text),
        },
      },
      scenes: c.applications.scenes.map((s) => ({
        id: s.anchor,
        title: s.title,
        description: s.description,
        disclosure: s.disclosure,
        cta: s.cta,
        image: {
          src: s.image,
          srcSmall: s.imageSmall,
          ...size(s.image),
          alt: s.imageAlt,
          positionDesktop: s.positionDesktop,
        },
      })),
    },
  };
}

/** DP-155: a site path link is current on that path and below it; in-page links never are. */
export function isCurrentPath(href: string | null, currentPath: string): boolean {
  if (!href || !href.startsWith("/") || href === "/" || href.includes("#")) return false;
  const path = href.split("?")[0] as string;
  return currentPath === path || currentPath.startsWith(`${path}/`);
}

export function toNavProps(
  c: BvNavPublic,
  currentPath: string,
  locale: RouteLocale = DEFAULT_LOCALE,
): SiteNavContent {
  const ui = siteNavUi(locale);
  const home = currentPath === "/";
  // The navigation's in-page links ("#top", "#services") belong to the home page: on any other
  // page they lead there ("/#services"), and the logo goes home.
  const target = (href: string | null) => (href && !home && href.startsWith("#") ? `/${href}` : href);
  // The home page marks its own item as current (an in-page link, "#top"); DP-155: any other
  // page marks the item whose path it is, or is under ("/products" on "/products/<slug>").
  const current = (href: string | null) =>
    home ? href === "#top" : isCurrentPath(href, currentPath);
  const item = (l: MenuPublicLink): SiteNavItem => ({
    label: l.label,
    href: target(l.href),
    ...(l.newTab ? { newTab: true } : {}),
    current: current(l.href),
  });
  return {
    ...ui,
    homeHref: home ? ui.homeHref : "/",
    items: c.items.map((i) => {
      const children = i.children.map(item);
      const own = item(i);
      // DP-219: an item with a submenu is current when one of its links is.
      return children.length
        ? { ...own, current: own.current || children.some((ch) => ch.current), children }
        : own;
    }),
    contact: c.contact ? { ...item(c.contact), current: false } : null,
    noScriptLinks: c.noScriptLinks
      .filter((l): l is MenuPublicLink & { href: string } => l.href !== null)
      .map((l) => ({
        label: l.label,
        href: target(l.href) as string,
        ...(l.newTab ? { newTab: true } : {}),
        current: home && l.href === "#top",
      })),
    pendingNote: c.pendingNote,
  };
}

export function toFooterProps(c: BvFooterPublic, locale: RouteLocale = DEFAULT_LOCALE): SiteFooterContent {
  const link = (l: MenuPublicLink): FooterLink => ({
    label: l.label,
    href: l.href,
    ...(l.newTab ? { newTab: true } : {}),
  });
  return {
    ...siteFooterUi(locale),
    headline: c.headline,
    cta: c.cta ? link(c.cta) : null,
    intro: c.intro,
    contact: { ...c.contact, addressLines: c.contact.addressLines.map((l) => l.text) },
    columns: c.columns.map((col) => ({ title: col.title, links: col.links.map(link) })),
    social: c.social.map((s) => ({ label: s.label, href: s.href })),
    copyright: c.copyright,
    legal: c.legal.map(link),
    pendingNote: c.pendingNote,
  };
}

function fragment<T>(
  page: CmsPublicPage | null | undefined,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } },
  map: (c: T) => unknown,
): unknown {
  if (!page) return null;
  const parsed = schema.safeParse(page.content);
  return parsed.success ? map(parsed.data as T) : null;
}

/**
 * Maps a public bundle to the view of its page; null when it does not validate. ML-3: every
 * internal link of the view (content, navigation, footer, home sections) is given the prefix of
 * `locale` (`localizeLinks`); the page's own `path` stays the stored path inside its language.
 */
export function pageView(json: unknown, locale: RouteLocale = DEFAULT_LOCALE): AnyPageView | null {
  const view = mapPage(json, locale);
  return view ? localizeLinks(view, locale) : null;
}

function mapPage(json: unknown, locale: RouteLocale): AnyPageView | null {
  const bundle = CmsPublicBundleSchema.safeParse(json);
  if (!bundle.success) return null;
  const { page, fragments, preview } = bundle.data;
  const path = page.path ?? "/";
  // The menu's links are stored addresses (ML-2: `/about-us`, `/nl/over-ons`); the current item
  // is the one whose stored address is this page's.
  const navPath = path === "/" ? "/" : storedAddress(locale, path);
  const nav = fragment<BvNavPublic>(fragments["bv.site-nav"], NAV, (c) =>
    toNavProps(c, navPath, locale),
  ) as SiteNavContent | null;
  const footer = fragment<BvFooterPublic>(fragments["bv.site-footer"], FOOTER, (c) =>
    toFooterProps(c, locale),
  ) as
    | SiteFooterContent
    | null;
  if (page.kind === "DESIGN" && page.templateKey === "bv.home") {
    const home = HOME.safeParse(page.content);
    if (!home.success) return null;
    return {
      kind: "home",
      title: page.title,
      seo: page.seo,
      home: toHomeProps(home.data as unknown as BvHomeContent, locale),
      nav,
      footer,
      locale,
      preview,
    };
  }
  if (page.kind === "DESIGN" && page.templateKey === "bv.news-index") {
    const heading = newsHeading(page);
    return heading ? { kind: "newsIndex", heading, nav, footer, locale, preview } : null;
  }
  if (cmsIsArticle(page)) {
    const content = CmsArticleContentSchema.safeParse(page.content);
    if (!content.success) return null;
    const c = content.data as Record<string, unknown>;
    return {
      kind: "article",
      path,
      title: page.title,
      seo: page.seo,
      excerpt: c["excerpt"] as string,
      coverImage: (c["coverImage"] as string | null) ?? null,
      coverAlt: (c["coverAlt"] as string | null) ?? null,
      sections: c["sections"] as TemplateSection[],
      firstPublishedAt: page.firstPublishedAt,
      nav,
      footer,
      locale,
      preview,
    };
  }
  if (page.kind === "TEMPLATE") {
    const content = CmsTemplateContentSchema.safeParse(page.content);
    if (!content.success) return null;
    return {
      kind: "template",
      path,
      title: page.title,
      seo: page.seo,
      sections: content.data.sections as TemplateSection[],
      nav,
      footer,
      locale,
      preview,
    };
  }
  return null;
}

/** The home page view of a bundle (the home route renders nothing else). */
export function homeView(json: unknown): CmsPageView | null {
  const view = pageView(json);
  return view?.kind === "home" ? view : null;
}

/** A read that can also say the page was taken off the site (DP-020). */
export type PageRead<T> = Read<T> | { ok: false; reason: "unpublished" };

/** Whether a 404 body says the page was published here and has been unpublished. */
function unpublished(body: unknown): boolean {
  const details = (body as { error?: { details?: unknown } } | null)?.error?.details;
  return (
    Array.isArray(details) &&
    details.some(
      (d) => typeof d === "object" && d !== null && (d as { rule?: unknown }).rule === "unpublished",
    )
  );
}

/**
 * ML-3 (ADR-028 D3/D7): the language selector of a page's navigation. ML-7: every language of the
 * site; a public one goes to the page's published counterpart (`alternates` of the API) or to that
 * language's home, one that is not public is listed without a link ("coming soon").
 */
async function languagesFor(
  locale: RouteLocale,
  currentPath: string,
  alternates: readonly { locale: string; path: string }[] = [],
) {
  const targets: Partial<Record<RouteLocale, string>> = { [locale]: localePath(locale, currentPath) };
  for (const a of alternates) {
    if (isRouteLocale(a.locale) && a.locale !== locale) targets[a.locale] = localePath(a.locale, a.path);
  }
  return languageOptions(locale, await visibleLocales(), targets);
}

/**
 * ML-7: the language selector for a page whose navigation is not published (the minimal frame):
 * each public language to its home, the page's own language to the page ("/404" → home).
 */
export async function siteLanguages(
  locale: RouteLocale,
  currentPath: string,
  /** ML-8c: a catalogue page's counterparts in the other languages. */
  targets: readonly { locale: string; path: string }[] = [],
) {
  return languagesFor(locale, currentPath === "/404" ? "/" : currentPath, targets);
}

async function withLanguages(
  view: AnyPageView,
  locale: RouteLocale,
  json: unknown,
): Promise<AnyPageView> {
  const raw = (json as { alternates?: unknown } | null)?.alternates;
  const parsed = CmsPublicAlternateSchema.array().max(20).safeParse(raw ?? []);
  const alternates = parsed.success ? parsed.data : [];
  // ML-5: the counterparts travel with the view for the page's hreflang (lib/seo.ts).
  const withAlternates = view.kind === "newsIndex" ? view : { ...view, alternates };
  if (!view.nav) return withAlternates;
  const path = "path" in view ? view.path : view.kind === "newsIndex" ? "/news" : "/";
  const languages = await languagesFor(locale, path, alternates);
  return { ...withAlternates, nav: { ...view.nav, languages } };
}

/**
 * ML-7: a preview shows the language selector as the page will (its own language current; a draft
 * has no published counterparts, so the other languages go to their home pages).
 */
async function withPreviewLanguages(view: AnyPageView, locale: RouteLocale): Promise<AnyPageView> {
  if (!view.nav) return view;
  const path = "path" in view ? view.path : view.kind === "newsIndex" ? "/news" : "/";
  return { ...view, nav: { ...view.nav, languages: await languagesFor(locale, path) } };
}

/** `&locale=` for a language other than the default (the default read is unchanged by ML-3). */
function localeQuery(locale: RouteLocale, first: "?" | "&"): string {
  return locale === DEFAULT_LOCALE ? "" : `${first}locale=${encodeURIComponent(locale)}`;
}

/**
 * `locale`: the language of the read; "draft" for a preview, whose response names the draft's
 * language (DP-250; the default language when it does not).
 */
async function read(path: string, wanted: RouteLocale | "draft"): Promise<PageRead<AnyPageView>> {
  const config = catalogConfig();
  if (!config) return { ok: false, reason: "unavailable" };
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${PUBLIC_CMS_API}${path}`, {
      headers: { "X-DP-Proxy-Key": config.proxyKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    console.error("public cms: request failed (network)");
    return { ok: false, reason: "unavailable" };
  }
  if (res.status === 404) {
    const body: unknown = await res.json().catch(() => null);
    return { ok: false, reason: unpublished(body) ? "unpublished" : "not_found" };
  }
  if (!res.ok) return { ok: false, reason: "unavailable" };
  const json: unknown = await res.json().catch(() => null);
  const named = (json as { locale?: unknown } | null)?.locale;
  const locale: RouteLocale =
    wanted !== "draft" ? wanted : isRouteLocale(named) ? named : DEFAULT_LOCALE;
  const mapped = pageView(json, locale);
  const view = !mapped
    ? null
    : mapped.preview
      ? await withPreviewLanguages(mapped, locale)
      : await withLanguages(mapped, locale, json);
  if (!view) {
    console.error("public cms: the response does not match the contract; not rendered");
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, data: view };
}

/** The published home page of a language with its navigation and footer. */
export async function getPublishedHome(
  locale: RouteLocale = DEFAULT_LOCALE,
): Promise<Read<CmsPageView>> {
  const res = await read(`/page?path=${encodeURIComponent("/")}${localeQuery(locale, "&")}`, locale);
  if (!res.ok) return { ok: false, reason: res.reason === "unavailable" ? "unavailable" : "not_found" };
  return res.data.kind === "home" ? { ok: true, data: res.data } : { ok: false, reason: "unavailable" };
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A published TEMPLATE page at `/<slug>` (CMS S3); anything else is not found. */
export async function getPublishedPage(
  slug: string,
  locale: RouteLocale = DEFAULT_LOCALE,
): Promise<Read<TemplatePageView>> {
  if (!SLUG.test(slug) || slug.length > 80) return { ok: false, reason: "not_found" };
  const res = await read(`/page?path=${encodeURIComponent(`/${slug}`)}${localeQuery(locale, "&")}`, locale);
  if (!res.ok) return { ok: false, reason: res.reason === "unavailable" ? "unavailable" : "not_found" };
  return res.data.kind === "template" ? { ok: true, data: res.data } : { ok: false, reason: "not_found" };
}

/**
 * DP-020: a published news article at `/news/<slug>`. Unknown: not_found; taken off the site:
 * unpublished (the page says so); anything else: unavailable.
 */
export async function getPublishedArticle(
  slug: string,
  locale: RouteLocale = DEFAULT_LOCALE,
): Promise<PageRead<ArticleView>> {
  if (!SLUG.test(slug) || slug.length > 80) return { ok: false, reason: "not_found" };
  const res = await read(
    `/page?path=${encodeURIComponent(`/news/${slug}`)}${localeQuery(locale, "&")}`,
    locale,
  );
  if (!res.ok) return res;
  return res.data.kind === "article" ? { ok: true, data: res.data } : { ok: false, reason: "not_found" };
}

/** DP-020/DP-153: one read of the public news list, before the heading is required. */
interface NewsRead {
  heading: NewsHeading | null;
  articles: CmsPublicArticle[];
  nav: SiteNavContent | null;
  footer: SiteFooterContent | null;
  /** ML-5: the list heading page's counterparts in the other public languages. */
  alternates: readonly CmsPublicAlternate[];
}

async function readNews(
  currentPath = "/news",
  locale: RouteLocale = DEFAULT_LOCALE,
  /** ML-8c: the language selector targets of a catalogue page (its published counterparts). */
  catalogueTargets: readonly { locale: string; path: string }[] = [],
): Promise<Read<NewsRead>> {
  const config = catalogConfig();
  if (!config) return { ok: false, reason: "unavailable" };
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${PUBLIC_CMS_API}/news${localeQuery(locale, "?")}`, {
      headers: { "X-DP-Proxy-Key": config.proxyKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    console.error("public cms: news request failed (network)");
    return { ok: false, reason: "unavailable" };
  }
  if (!res.ok) return { ok: false, reason: "unavailable" };
  const parsed = CmsPublicNewsSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    console.error("public cms: the news response does not match the contract; not rendered");
    return { ok: false, reason: "unavailable" };
  }
  const { page, articles, fragments, alternates = [] } = parsed.data;
  const heading = newsHeading(page);
  if (page && !heading) {
    console.error("public cms: the news heading does not match the contract; not rendered");
  }
  const nav = fragment<BvNavPublic>(fragments["bv.site-nav"], NAV, (c) =>
    toNavProps(c, currentPath, locale),
  ) as SiteNavContent | null;
  const footer = fragment<BvFooterPublic>(fragments["bv.site-footer"], FOOTER, (c) =>
    toFooterProps(c, locale),
  ) as
    | SiteFooterContent
    | null;
  // ML-3: links in the language of the list; an article's `path` is its link here. The switcher
  // goes to the same address in another language (the news list, the catalogue) or its home.
  const localized = localizeLinks(
    {
      heading,
      articles: articles.map((a) => ({ ...a, path: localizeHref(locale, a.path) })),
      nav,
      footer,
    },
    locale,
  );
  if (localized.nav) {
    // The not-found frame ("/404") has no address of its own: its language links go home.
    const here = currentPath === "/404" ? "/" : currentPath;
    localized.nav = {
      ...localized.nav,
      languages: await languagesFor(
        locale,
        here,
        here === "/news" ? alternates : catalogueTargets,
      ),
    };
  }
  return { ok: true, data: { ...localized, alternates } };
}

/**
 * DP-020: the published articles for /news (an empty list is a normal answer). DP-153: the heading
 * comes from the published `bv.news-index` page; without it the list is unavailable (no fallback
 * to text in code).
 */
export async function getNews(locale: RouteLocale = DEFAULT_LOCALE): Promise<Read<NewsView>> {
  const res = await readNews("/news", locale);
  if (!res.ok) return res;
  const { heading, articles, nav, footer, alternates } = res.data;
  if (!heading) return { ok: false, reason: "unavailable" };
  return { ok: true, data: { heading, articles, nav, footer, alternates, locale, preview: false } };
}

/** The published navigation and footer around a news page (also without a published heading). */
/**
 * DP-155: the published site navigation and footer for a page outside the CMS (the product
 * catalogue), with the navigation's current item for `path`. Both are null while unavailable;
 * the page then shows its own minimal frame.
 */
export async function getSiteChrome(
  path: string,
  locale: RouteLocale = DEFAULT_LOCALE,
  /** ML-8c: the language selector targets of a catalogue page (lib/catalog-alternates.ts). */
  targets: readonly { locale: string; path: string }[] = [],
): Promise<{
  nav: SiteNavContent | null;
  footer: SiteFooterContent | null;
}> {
  const res = await readNews(path, locale, targets);
  return res.ok ? { nav: res.data.nav, footer: res.data.footer } : { nav: null, footer: null };
}

export async function getNewsChrome(locale: RouteLocale = DEFAULT_LOCALE): Promise<{
  nav: SiteNavContent | null;
  footer: SiteFooterContent | null;
}> {
  const res = await readNews("/news", locale);
  return res.ok ? { nav: res.data.nav, footer: res.data.footer } : { nav: null, footer: null };
}

/**
 * DP-153: the preview of the list heading's draft, with the published articles under it (also
 * before the heading was ever published).
 */
export async function newsPreview(view: NewsIndexView): Promise<Read<NewsView>> {
  const res = await readNews();
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      heading: view.heading,
      articles: res.data.articles,
      nav: view.nav,
      footer: view.footer,
      locale: view.locale,
      preview: true,
    },
  };
}

const TOKEN = /^v1\.[0-9a-f-]{36}\.(BV|CORPORATE)\.\d{10,13}\.[0-9a-f]{64}$/;

/** The draft a preview link shows (the API checks the signature, expiry and site). */
export function getPreview(token: string): Promise<PageRead<AnyPageView>> {
  if (!TOKEN.test(token)) return Promise.resolve({ ok: false, reason: "not_found" });
  // ML-3/DP-250: a preview has no language in its address; it renders in its draft's language.
  return read(`/preview/${token}`, "draft");
}
