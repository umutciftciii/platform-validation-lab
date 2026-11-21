import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { CatalogShell, siteChrome } from "@/components/products/catalog-shell";
import { dictionary } from "@/lib/i18n";
import { DEFAULT_LOCALE, localizeHref, type RouteLocale } from "@/lib/locale-routing";
import { CATALOGUE_LOCALES } from "@/lib/proxy-routes";

const SECONDARY =
  "inline-flex items-center rounded-full border border-glass/20 px-5 py-2 text-sm text-glass transition-colors hover:border-amber hover:text-amber";

/**
 * DP-207: the site's not-found page, in the site frame (published navigation and footer). Unknown
 * addresses answer it with HTTP 404 (proxy.ts checks content addresses before rendering).
 * ML-3: in the frame and links of the address's language. ML-7: the labels in that language, and
 * only links that exist in it — the catalogue where it is translated (`CATALOGUE_LOCALES`), the
 * contact page where the language's published navigation links to one; English is unchanged.
 */
export function NotFoundView({ locale }: { locale: RouteLocale }) {
  const href = (path: string) => localizeHref(locale, path);
  const ui = dictionary(locale);
  return (
    // No navigation item is the current one here.
    <CatalogShell
      locale={locale}
      crumbs={[{ label: ui.common.home, href: href("/") }, { label: ui.notFound.title }]}
      path="/404"
    >
      <section className="mx-auto max-w-2xl pt-10 pb-8 lg:pt-16">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-amber">404</p>
        <h1 className="mt-3 text-3xl font-semibold text-glass sm:text-4xl">{ui.notFound.title}</h1>
        <p className="mt-4 text-steel">{ui.notFound.text}</p>
        <ul className="mt-8 flex flex-wrap gap-3">
          <li>
            <Link
              href={href("/")}
              className="inline-flex items-center rounded-full border border-amber/40 px-5 py-2 text-sm text-amber transition-colors hover:border-amber hover:bg-amber/10"
            >
              {ui.common.home}
            </Link>
          </li>
          {CATALOGUE_LOCALES.includes(locale) ? (
            <li>
              <Link href={href("/products")} className={SECONDARY}>
                {ui.common.products}
              </Link>
            </li>
          ) : null}
          {locale === DEFAULT_LOCALE ? (
            <li>
              <Link href={href("/contact")} className={SECONDARY}>
                {ui.common.contact}
              </Link>
            </li>
          ) : (
            <Suspense fallback={null}>
              <ContactLink locale={locale} />
            </Suspense>
          )}
        </ul>
      </section>
    </CatalogShell>
  );
}

/** ML-7: the contact page of a language, as its published navigation links to it (else none). */
async function ContactLink({ locale }: { locale: RouteLocale }) {
  await connection();
  const { nav } = await siteChrome("/404", locale);
  const target = nav?.contact?.href;
  if (!target || !target.startsWith("/")) return null;
  return (
    <li>
      <Link href={target} className={SECONDARY}>
        {dictionary(locale).common.contact}
      </Link>
    </li>
  );
}
