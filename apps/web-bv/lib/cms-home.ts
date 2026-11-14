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
  BV_FOOTER_FIELDS,
  BV_HOME_FIELDS,
  BV_NAV_FIELDS,
  BV_NEWS_INDEX_FIELDS,
  CmsArticleContentSchema,
  CmsPublicBundleSchema,
  CmsPublicNewsSchema,
  CmsTemplateContentSchema,
  PUBLIC_CMS_API,
  cmsAsset,
  cmsFieldsSchema,
  cmsIsArticle,
  type BvFooterContent,
  type BvHomeContent,
  type BvNavContent,
  type BvNewsIndexContent,
  type CmsLink,
  type CmsPublicArticle,
  type CmsPublicPage,
} from "@dream/contracts";

import type { ApplicationScene, ApplicationsCopy } from "@/content/applications-showcase";
import { APPLICATIONS_UI } from "@/content/applications-showcase";
import type { CtlCopy, CtlStage } from "@/content/ctl-technology";
import { CTL_UI } from "@/content/ctl-technology";
import type { IccsynHeroContent } from "@/content/iccsyn-hero";
import type { ProductGroup, ProductGroupsCopy } from "@/content/product-groups";
import { PRODUCT_GROUPS_UI } from "@/content/product-groups";
import type { ServiceItem, ServicesCopy } from "@/content/services-showcase";
import { SERVICES_UI } from "@/content/services-showcase";
import type { SiteFooterContent } from "@/content/site-footer";
import { SITE_FOOTER_UI } from "@/content/site-footer";
import type { SiteNavContent } from "@/content/site-nav";
import { SITE_NAV_UI } from "@/content/site-nav";
import { catalogConfig, type Read } from "@/lib/catalog-api";

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
  preview: boolean;
}

/** DP-153: a preview of the list heading's draft (the route adds the published articles). */
export interface NewsIndexView {
  heading: NewsHeading;
  nav: SiteNavContent | null;
  footer: SiteFooterContent | null;
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
  preview: boolean;
}

const HOME = cmsFieldsSchema(BV_HOME_FIELDS);
const NAV = cmsFieldsSchema(BV_NAV_FIELDS);
const FOOTER = cmsFieldsSchema(BV_FOOTER_FIELDS);
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

export function toHomeProps(c: BvHomeContent): HomeProps {
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
      },
      applications: c.hero.applications.map((a) => ({
        title: a.title,
        description: a.description,
        image: { src: a.image },
      })),
    },
    productGroups: {
      copy: { ...PRODUCT_GROUPS_UI, label: c.productGroups.label, disclosure: c.productGroups.disclosure },
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
        ...SERVICES_UI,
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
      copy: { ...CTL_UI, eyebrow: c.ctl.eyebrow, title: c.ctl.title, document: c.ctl.document },
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
        ...APPLICATIONS_UI,
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

export function toNavProps(c: BvNavContent, currentPath: string): SiteNavContent {
  const home = currentPath === "/";
  // The navigation's in-page links ("#top", "#services") belong to the home page: on any other
  // page they lead there ("/#services"), and the logo goes home.
  const target = (href: string | null) => (href && !home && href.startsWith("#") ? `/${href}` : href);
  return {
    ...SITE_NAV_UI,
    homeHref: home ? SITE_NAV_UI.homeHref : "/",
    // The home page marks its own item as current (an in-page link, "#top").
    items: c.items.map((i) => ({ ...i, href: target(i.href), current: home && i.href === "#top" })),
    contact: { ...c.contact, href: target(c.contact.href) },
    noScriptLinks: c.noScriptLinks
      .filter((l): l is { label: string; href: string } => l.href !== null)
      .map((l) => ({ ...l, href: target(l.href) as string, current: home && l.href === "#top" })),
    pendingNote: c.pendingNote,
  };
}

export function toFooterProps(c: BvFooterContent): SiteFooterContent {
  return {
    ...SITE_FOOTER_UI,
    headline: c.headline,
    cta: c.cta,
    intro: c.intro,
    contact: { ...c.contact, addressLines: c.contact.addressLines.map((l) => l.text) },
    columns: c.columns,
    copyright: c.copyright,
    legal: c.legal,
    pendingNote: c.pendingNote,
  };
}

function fragment<T>(
  page: CmsPublicPage | null | undefined,
  schema: typeof NAV,
  map: (c: T) => unknown,
): unknown {
  if (!page) return null;
  const parsed = schema.safeParse(page.content);
  return parsed.success ? map(parsed.data as T) : null;
}

/** Maps a public bundle to the view of its page; null when it does not validate. */
export function pageView(json: unknown): AnyPageView | null {
  const bundle = CmsPublicBundleSchema.safeParse(json);
  if (!bundle.success) return null;
  const { page, fragments, preview } = bundle.data;
  const path = page.path ?? "/";
  const nav = fragment<BvNavContent>(fragments["bv.site-nav"], NAV, (c) =>
    toNavProps(c, path),
  ) as SiteNavContent | null;
  const footer = fragment<BvFooterContent>(fragments["bv.site-footer"], FOOTER, toFooterProps) as
    | SiteFooterContent
    | null;
  if (page.kind === "DESIGN" && page.templateKey === "bv.home") {
    const home = HOME.safeParse(page.content);
    if (!home.success) return null;
    return {
      kind: "home",
      title: page.title,
      seo: page.seo,
      home: toHomeProps(home.data as unknown as BvHomeContent),
      nav,
      footer,
      preview,
    };
  }
  if (page.kind === "DESIGN" && page.templateKey === "bv.news-index") {
    const heading = newsHeading(page);
    return heading ? { kind: "newsIndex", heading, nav, footer, preview } : null;
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

async function read(path: string): Promise<PageRead<AnyPageView>> {
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
  const view = pageView(await res.json().catch(() => null));
  if (!view) {
    console.error("public cms: the response does not match the contract; not rendered");
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, data: view };
}

/** The published home page with its navigation and footer. */
export async function getPublishedHome(): Promise<Read<CmsPageView>> {
  const res = await read(`/page?path=${encodeURIComponent("/")}`);
  if (!res.ok) return { ok: false, reason: res.reason === "unavailable" ? "unavailable" : "not_found" };
  return res.data.kind === "home" ? { ok: true, data: res.data } : { ok: false, reason: "unavailable" };
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A published TEMPLATE page at `/<slug>` (CMS S3); anything else is not found. */
export async function getPublishedPage(slug: string): Promise<Read<TemplatePageView>> {
  if (!SLUG.test(slug) || slug.length > 80) return { ok: false, reason: "not_found" };
  const res = await read(`/page?path=${encodeURIComponent(`/${slug}`)}`);
  if (!res.ok) return { ok: false, reason: res.reason === "unavailable" ? "unavailable" : "not_found" };
  return res.data.kind === "template" ? { ok: true, data: res.data } : { ok: false, reason: "not_found" };
}

/**
 * DP-020: a published news article at `/news/<slug>`. Unknown: not_found; taken off the site:
 * unpublished (the page says so); anything else: unavailable.
 */
export async function getPublishedArticle(slug: string): Promise<PageRead<ArticleView>> {
  if (!SLUG.test(slug) || slug.length > 80) return { ok: false, reason: "not_found" };
  const res = await read(`/page?path=${encodeURIComponent(`/news/${slug}`)}`);
  if (!res.ok) return res;
  return res.data.kind === "article" ? { ok: true, data: res.data } : { ok: false, reason: "not_found" };
}

/** DP-020/DP-153: one read of the public news list, before the heading is required. */
interface NewsRead {
  heading: NewsHeading | null;
  articles: CmsPublicArticle[];
  nav: SiteNavContent | null;
  footer: SiteFooterContent | null;
}

async function readNews(): Promise<Read<NewsRead>> {
  const config = catalogConfig();
  if (!config) return { ok: false, reason: "unavailable" };
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${PUBLIC_CMS_API}/news`, {
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
  const { page, articles, fragments } = parsed.data;
  const heading = newsHeading(page);
  if (page && !heading) {
    console.error("public cms: the news heading does not match the contract; not rendered");
  }
  const nav = fragment<BvNavContent>(fragments["bv.site-nav"], NAV, (c) =>
    toNavProps(c, "/news"),
  ) as SiteNavContent | null;
  const footer = fragment<BvFooterContent>(fragments["bv.site-footer"], FOOTER, toFooterProps) as
    | SiteFooterContent
    | null;
  return { ok: true, data: { heading, articles, nav, footer } };
}

/**
 * DP-020: the published articles for /news (an empty list is a normal answer). DP-153: the heading
 * comes from the published `bv.news-index` page; without it the list is unavailable (no fallback
 * to text in code).
 */
export async function getNews(): Promise<Read<NewsView>> {
  const res = await readNews();
  if (!res.ok) return res;
  const { heading, articles, nav, footer } = res.data;
  if (!heading) return { ok: false, reason: "unavailable" };
  return { ok: true, data: { heading, articles, nav, footer, preview: false } };
}

/** The published navigation and footer around a news page (also without a published heading). */
export async function getNewsChrome(): Promise<{
  nav: SiteNavContent | null;
  footer: SiteFooterContent | null;
}> {
  const res = await readNews();
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
      preview: true,
    },
  };
}

const TOKEN = /^v1\.[0-9a-f-]{36}\.(BV|CORPORATE)\.\d{10,13}\.[0-9a-f]{64}$/;

/** The draft a preview link shows (the API checks the signature, expiry and site). */
export function getPreview(token: string): Promise<PageRead<AnyPageView>> {
  if (!TOKEN.test(token)) return Promise.resolve({ ok: false, reason: "not_found" });
  return read(`/preview/${token}`);
}
