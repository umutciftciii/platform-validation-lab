import Link from "next/link";
import type { CmsSite } from "@dream/contracts";
import type { AdminLocale } from "../../lib/i18n/config";
import type { Translate } from "../../lib/i18n/types";
import { cx } from "../ui";
import { languageLabel } from "./site-languages";

/**
 * ML-2 (DP-074): the content lists show one language of the site at a time (the default first).
 * Hidden on a site with one language.
 */
export function LanguageTabs({
  site,
  current,
  hrefFor,
  t,
  locale,
}: {
  site: CmsSite;
  current: string;
  hrefFor: (locale: string) => string;
  /** ML-12c: the UI language of the server page that renders the tabs. */
  t: Translate;
  locale: AdminLocale;
}) {
  const locales = site.locales.filter((l) => l.enabled);
  if (locales.length < 2) return null;
  return (
    <nav aria-label={t("content.pages.languageTabs.label")} className="flex flex-wrap gap-1">
      {locales.map((l) => (
        <Link
          key={l.locale}
          href={hrefFor(l.locale)}
          aria-current={l.locale === current ? "page" : undefined}
          className={cx(
            "rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors",
            l.locale === current
              ? "bg-petrol-soft text-petrol-strong ring-petrol/30"
              : "text-ink-3 ring-line hover:text-ink",
          )}
        >
          {l.public
            ? languageLabel(l.locale, locale)
            : t("content.pages.languageTabs.notPublic", {
                language: languageLabel(l.locale, locale),
              })}
        </Link>
      ))}
    </nav>
  );
}
