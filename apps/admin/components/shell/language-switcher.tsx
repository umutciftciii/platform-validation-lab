"use client";

/**
 * English / Türkçe switch of the console (ML-11). Picking a language writes the `dp-admin-locale`
 * cookie and reloads the page, so every server and client text changes together (no in-place swap,
 * no hydration mismatch). Each option is named in its own language and marked with its `lang`.
 *
 * DP-269: a real ARIA radio group. It is one Tab stop (the checked option); ArrowLeft/ArrowUp and
 * ArrowRight/ArrowDown move to the other language and pick it (wrapping), Home and End pick the
 * first and last; Enter or Space on the focused option picks it as before. Picking the language
 * already shown does nothing; while a switch is running further keys are ignored.
 */
import { useRef, useState, type KeyboardEvent } from "react";
import {
  ADMIN_LOCALES,
  type AdminLocale,
  LOCALE_NAMES,
  switchAdminLocale,
} from "../../lib/i18n/config";
import { radioKeyTarget } from "../../lib/radio-keys";
import { useAdminLocale, useT } from "../i18n/locale-provider";
import { cx } from "../ui";

const SHORT: Readonly<Record<AdminLocale, string>> = { en: "EN", tr: "TR" };

export function LanguageSwitcher({ className }: { className?: string }) {
  const current = useAdminLocale();
  const t = useT();
  const [pending, setPending] = useState<AdminLocale | null>(null);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = pending ?? current;

  function choose(locale: AdminLocale) {
    if (locale === current || pending) return;
    setPending(locale);
    switchAdminLocale(locale);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const from = ADMIN_LOCALES.indexOf(
      (e.target as HTMLElement).getAttribute("lang") as AdminLocale,
    );
    const to = radioKeyTarget(e.key, from, ADMIN_LOCALES.length);
    if (to === null) return;
    e.preventDefault();
    if (pending) return;
    const locale = ADMIN_LOCALES[to];
    if (!locale) return;
    options.current[to]?.focus();
    choose(locale);
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("language.label")}
      aria-busy={pending ? true : undefined}
      title={pending ? t("language.switching") : undefined}
      onKeyDown={onKeyDown}
      className={cx("inline-flex rounded-lg border border-line bg-surface-2 p-0.5", className)}
    >
      {ADMIN_LOCALES.map((locale, i) => {
        const checked = selected === locale;
        return (
          <button
            key={locale}
            ref={(el) => {
              options.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={LOCALE_NAMES[locale]}
            lang={locale}
            title={LOCALE_NAMES[locale]}
            tabIndex={checked ? 0 : -1}
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
