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
 *  - `getSiteFrame(path, locale)`: the navigation and footer alone, for pages outside the CMS (the
 *    placeholder home, the privacy policy, the 404).
 *  - `getPreview(token)` (COM-2a, DP-321): the draft a signed preview link names, in its draft's
 *    language — a TEMPLATE page, or a fragment (navigation, footer, SEO defaults) around the home.
 */
import {
  BvFooterPublicSchema,
  BvNavPublicSchema,
  CMS_SITE_MENU_KEYS,
  CmsPublicAlternateSchema,
  CmsPublicBundleSchema,
  CmsPublicNewsSchema,
  PUBLIC_CMS_API,
  cmsIsArticle,
  cmsTemplateContentSchema,
  type CmsLink,
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

export type Read<T> = { ok: true; data: T } | { ok: false; reason: "not_found" | "unavailable" };

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

/** COM-2a (DP-321): what a preview link shows. */
export type PreviewView =
  | { kind: "template"; locale: RouteLocale; page: TemplatePageView }
  /** A fragment's draft (or the SEO defaults) around the site's home page. */
  | { kind: "home"; locale: RouteLocale; frame: SiteFrame & { languages: LanguageOption[] } };

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
  if (page.kind === "TEMPLATE") {
    // News articles are COM-3; until then their preview is not shown here.
    if (cmsIsArticle(page) || !page.path) return { ok: false, reason: "not_found" };
    const view = await templateView({ ...page, path: page.path }, fragments, locale, []);
    return view
      ? { ok: true, data: { kind: "template", locale, page: view } }
      : { ok: false, reason: "unavailable" };
  }
  // A fragment around the home page (the corporate home is not in the CMS before COM-2b).
  const frame = frameOf(fragments, "/", locale);
  const languages = await languagesFor(locale, "/");
  return {
    ok: true,
    data: {
      kind: "home",
      locale,
      frame: {
        footer: frame.footer,
        nav: frame.nav ? { ...frame.nav, languages } : null,
        languages,
      },
    },
  };
}

/**
 * The published navigation and footer of a language for a page outside the CMS. The public news
 * read carries the site's fragments (the corporate site has no news list yet: no heading, no
 * articles); both are null while the API cannot answer, and the page shows its minimal frame.
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
