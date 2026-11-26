import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { cache, Suspense, type ReactNode } from "react";

import SiteFooter from "@/components/ui/site-footer";
import LanguageSelector from "@/components/ui/language-selector";
import SiteNav from "@/components/ui/site-nav";
import { BRAND_LOGO } from "@/content/brand";
import { parseSelectorKey } from "@/lib/catalog-alternates";
import { getSiteChrome, siteLanguages } from "@/lib/cms-home";
import { dictionary } from "@/lib/i18n";
import { sitePrivacyNow } from "@/lib/legal-texts-api";
import {
  DEFAULT_LOCALE,
  localizeHref,
  type LanguageOption,
  type RouteLocale,
} from "@/lib/locale-routing";
import { privacyPolicyHref } from "@/lib/privacy";

/**
 * One read of the published navigation and footer per request (both slots use it). ML-8c: the
 * language selector targets come in as a string key (`selectorKey`), so the cache matches.
 */
const chrome = cache((path: string, locale: RouteLocale, targets = "") =>
  getSiteChrome(path, locale, parseSelectorKey(targets)),
);

/** ML-7: the same per-request read for other parts of a page in this frame (the 404 links). */
export const siteChrome = chrome;

/**
 * Frame of the product pages. DP-155: the published BV site navigation and footer (the same CMS
 * fragments as every other page), the page in the shared `tp` layout and type scale, and the
 * breadcrumb under the navigation. While the CMS cannot be read, the minimal brand header and
 * legal footer of PM-3 stand in, so the catalogue never depends on the CMS being up.
 * ML-3: the frame of the page's language (`locale`); crumbs come in with their public addresses.
 */
export function CatalogShell({
  crumbs,
  path = "/products",
  locale = DEFAULT_LOCALE,
  languages,
  children,
}: {
  crumbs: { label: string; href?: string }[];
  /** The page's stored path inside its language: marks the current navigation item. */
  path?: string;
  locale?: RouteLocale;
  /**
   * ML-8c: the page's counterparts in the other public languages (`selectorKey` of
   * lib/catalog-alternates.ts), read inside the navigation's Suspense boundary.
   */
  languages?: () => Promise<string>;
  children: ReactNode;
}) {
  return (
    <>
      <Suspense fallback={<MinimalHeader locale={locale} />}>
        <CatalogNav path={path} locale={locale} languages={languages} />
      </Suspense>
      <main id="top" className="tp catalog">
        <div className="tp-inner pb-24">
          <Breadcrumb crumbs={crumbs} label={dictionary(locale).shell.breadcrumb} />
          {children}
        </div>
      </main>
      <Suspense fallback={<MinimalFooter locale={locale} privacyHref={null} />}>
        <CatalogFooter path={path} locale={locale} languages={languages} />
      </Suspense>
    </>
  );
}

type LanguagesRead = (() => Promise<string>) | undefined;

async function CatalogNav({
  path,
  locale,
  languages,
}: {
  path: string;
  locale: RouteLocale;
  languages: LanguagesRead;
}) {
  await connection();
  const targets = languages ? await languages() : "";
  const { nav } = await chrome(path, locale, targets);
  if (nav) return <SiteNav content={nav} />;
  // ML-7: the language selector stays reachable while the published navigation is missing.
  return (
    <MinimalHeader
      locale={locale}
      languages={await siteLanguages(locale, path, parseSelectorKey(targets))}
    />
  );
}

async function CatalogFooter({
  path,
  locale,
  languages,
}: {
  path: string;
  locale: RouteLocale;
  languages: LanguagesRead;
}) {
  await connection();
  const { footer } = await chrome(path, locale, languages ? await languages() : "");
  if (footer) return <SiteFooter content={footer} />;
  const privacy = await sitePrivacyNow();
  return (
    <MinimalFooter
      locale={locale}
      privacyHref={privacy.gate.publish ? privacyPolicyHref(locale, privacy.locales) : null}
    />
  );
}

function Breadcrumb({ crumbs, label }: { crumbs: { label: string; href?: string }[]; label: string }) {
  return (
    <nav aria-label={label} className="pt-8 text-sm text-steel sm:pt-10">
      <ol className="flex flex-wrap items-center gap-2">
        {crumbs.map((c, i) => (
          <li key={c.label} className="flex min-w-0 items-center gap-2">
            {i > 0 ? <span aria-hidden="true">/</span> : null}
            {c.href ? (
              <Link href={c.href} className="truncate hover:text-glass">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="truncate text-glass">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * PM-3 frame, kept as the fallback while the published navigation cannot be read. ML-7: with the
 * language selector once the languages are known (not in the streaming placeholder).
 */
function MinimalHeader({
  locale,
  languages,
}: {
  locale: RouteLocale;
  languages?: LanguageOption[];
}) {
  const ui = dictionary(locale).nav;
  return (
    <header className="fixed inset-x-0 top-0 z-40 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
        <Link href={localizeHref(locale, "/")} aria-label={dictionary(locale).shell.homeLink} className="shrink-0">
          <Image
            src={BRAND_LOGO.src}
            alt={BRAND_LOGO.alt}
            width={BRAND_LOGO.width}
            height={BRAND_LOGO.height}
            className="h-8 w-auto sm:h-10"
            priority
          />
        </Link>
        {languages?.length ? (
          <LanguageSelector
            options={languages}
            ui={ui}
            variant="dropdown"
            className="site-nav-languages"
          />
        ) : null}
      </div>
    </header>
  );
}

/**
 * DP-095 D-T5: the legal line under every catalogue page; the policy link only where published.
 * DP-298: the link comes in from the API's snapshot; the streaming placeholder has none (it is
 * rendered before any request data, fail closed).
 */
function MinimalFooter({
  locale,
  privacyHref: href,
}: {
  locale: RouteLocale;
  privacyHref: string | null;
}) {
  const ui = dictionary(locale).shell;
  return (
    <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-glass/10 px-4 py-6 text-xs text-steel sm:px-8">
      <p>{ui.copyright}</p>
      {href ? (
        <a href={href} className="hover:text-glass">
          {ui.privacyPolicy}
        </a>
      ) : null}
    </footer>
  );
}

/** A quiet panel for empty and error states. */
export function CatalogNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-glass/10 bg-glass/[0.03] px-6 py-14 text-center">
      <p className="text-lg font-medium text-glass">{title}</p>
      <p className="mx-auto mt-2 max-w-[48ch] text-sm text-steel">{children}</p>
    </div>
  );
}
