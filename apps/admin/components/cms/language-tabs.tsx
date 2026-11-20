import Link from "next/link";
import type { CmsSite } from "@dream/contracts";
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
}: {
  site: CmsSite;
  current: string;
  hrefFor: (locale: string) => string;
}) {
  const locales = site.locales.filter((l) => l.enabled);
  if (locales.length < 2) return null;
  return (
    <nav aria-label="Content language" className="flex flex-wrap gap-1">
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
          {l.public ? languageLabel(l.locale) : `${languageLabel(l.locale)} · not public`}
        </Link>
      ))}
    </nav>
  );
}
