import Link from "next/link";
import { en } from "../../lib/i18n/messages/en";
import { localeShort } from "../../lib/translations";
import { Msg } from "../i18n/locale-provider";
import { cx } from "../ui";

type ContentLanguage = keyof typeof en.catalog.common.languages;

/** localeLabel() as a text node: shared component, so no translator here (ML-12a). */
function LocaleName({ locale }: { locale: string }) {
  return locale in en.catalog.common.languages ? (
    <Msg k={`catalog.common.languages.${locale as ContentLanguage}`} />
  ) : (
    locale.toUpperCase()
  );
}

/**
 * ML-8b: the language links of the category and specification pages (a server-rendered page per
 * language, `?lang=`); the product page uses the in-page LanguageTabs instead. The default
 * (source) language is the existing English editor.
 */
export function LanguageNav({
  locales,
  current,
  sourceLocale,
  hrefFor,
  label = en.catalog.list.language.label,
}: {
  locales: readonly string[];
  current: string;
  sourceLocale: string;
  hrefFor: (locale: string) => string;
  /** ML-12a: the nav's aria-label in the UI language (`t("catalog.list.language.label")`). */
  label?: string;
}) {
  if (locales.length <= 1) return null;
  return (
    <nav
      aria-label={label}
      className="inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface-2 p-1"
    >
      {locales.map((l) => {
        const active = l === current;
        return (
          <Link
            key={l}
            href={hrefFor(l)}
            aria-current={active ? "page" : undefined}
            data-lang-link={l}
            className={cx(
              "inline-flex h-8 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
              active
                ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-line"
                : "text-ink-3 hover:text-ink",
            )}
          >
            <span className="font-mono text-xs">{localeShort(l)}</span>
            <span>
              <LocaleName locale={l} />
            </span>
            {l === sourceLocale ? (
              <span className="text-xs font-normal text-ink-3">
                <Msg k="catalog.list.language.source" />
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
