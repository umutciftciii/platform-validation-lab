"use client";

/**
 * Client side of the admin UI language (ML-11). The root layout reads the language on the server
 * and passes it here, so the server HTML and the first client render use the same language (no
 * hydration mismatch). A language change writes the cookie and reloads the page; nothing is
 * re-rendered in place.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { type AdminLocale, DEFAULT_ADMIN_LOCALE } from "../../lib/i18n/config";
import { createTranslator } from "../../lib/i18n/translate";
import type { PlainKey, Translate } from "../../lib/i18n/types";

const LocaleContext = createContext<AdminLocale>(DEFAULT_ADMIN_LOCALE);

export function LocaleProvider({ locale, children }: { locale: AdminLocale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useAdminLocale(): AdminLocale {
  return useContext(LocaleContext);
}

export function useT(): Translate {
  const locale = useContext(LocaleContext);
  return useMemo(() => createTranslator(locale), [locale]);
}

/**
 * One translated message without parameters, for shared components that render on the server and
 * in the browser alike (components/ui.tsx). Renders a single text node.
 */
export function Msg({ k }: { k: PlainKey }) {
  return useT()(k);
}
