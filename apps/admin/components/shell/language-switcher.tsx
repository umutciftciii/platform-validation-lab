"use client";

/**
 * English / Türkçe switch of the console (ML-11). A radio group like the theme switch: Tab reaches
 * it, Enter or Space picks a language. Picking one writes the `dp-admin-locale` cookie and reloads
 * the page, so every server and client text changes together (no in-place swap, no hydration
 * mismatch). Each option is named in its own language and marked with its `lang`.
 */
import { useState } from "react";
import {
  ADMIN_LOCALES,
  type AdminLocale,
  LOCALE_NAMES,
  switchAdminLocale,
} from "../../lib/i18n/config";
import { useAdminLocale, useT } from "../i18n/locale-provider";
import { cx } from "../ui";

const SHORT: Readonly<Record<AdminLocale, string>> = { en: "EN", tr: "TR" };

export function LanguageSwitcher({ className }: { className?: string }) {
  const current = useAdminLocale();
  const t = useT();
  const [pending, setPending] = useState<AdminLocale | null>(null);

  function choose(locale: AdminLocale) {
    if (locale === current || pending) return;
    setPending(locale);
    switchAdminLocale(locale);
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("language.label")}
      aria-busy={pending ? true : undefined}
      title={pending ? t("language.switching") : undefined}
      className={cx("inline-flex rounded-lg border border-line bg-surface-2 p-0.5", className)}
    >
      {ADMIN_LOCALES.map((locale) => {
        const checked = (pending ?? current) === locale;
        return (
          <button
            key={locale}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={LOCALE_NAMES[locale]}
            lang={locale}
            title={LOCALE_NAMES[locale]}
            onClick={() => choose(locale)}
            className={cx(
              "inline-flex h-7 min-w-8 items-center justify-center rounded-md px-1.5 text-xs font-semibold tracking-wide transition-colors duration-150",
              checked
                ? "bg-surface text-ink shadow-sm ring-1 ring-line-strong"
                : "text-ink-3 hover:text-ink",
            )}
          >
            {SHORT[locale]}
          </button>
        );
      })}
    </div>
  );
}
