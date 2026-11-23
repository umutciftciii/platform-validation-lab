import type { CmsSite, SiteLocale } from "@dream/contracts";
import { type AdminLocale, INTL_LOCALE } from "../../lib/i18n/config";
import type { Translate } from "../../lib/i18n/types";
import { EmptyState, Panel, StatusPill } from "../ui";

const LANGUAGE_NAMES = new Map<AdminLocale, Intl.DisplayNames>();

/**
 * "English (en)"; the bare tag when the runtime has no name for it. ML-12c: the name is in the
 * admin UI language ("İngilizce (en)", glossary rule 3: the language of content is a UI word);
 * English is the en formatter of before.
 */
export function languageLabel(locale: string, ui: AdminLocale = "en"): string {
  let names = LANGUAGE_NAMES.get(ui);
  if (!names) {
    names = new Intl.DisplayNames([ui === "en" ? "en" : INTL_LOCALE[ui]], { type: "language" });
    LANGUAGE_NAMES.set(ui, names);
  }
  let name: string | undefined;
  try {
    name = names.of(locale);
  } catch {
    name = undefined;
  }
  return name && name !== locale ? `${name} (${locale})` : locale;
}

type LanguageState = "default" | "public" | "notPublic" | "editingOff";
const STATE_TONE = {
  default: "petrol",
  public: "success",
  notPublic: "amber",
  editingOff: "amber",
} as const;

/** The site's state of one language, as short labels (one text node each, DP-196). */
export function languageStates(l: SiteLocale, t: Translate): string[] {
  return languageStateKeys(l).map((k) => t(`content.common.siteLanguages.${k}`));
}

function languageStateKeys(l: SiteLocale): LanguageState[] {
  const out: LanguageState[] = [];
  if (l.isDefault) out.push("default");
  out.push(l.public ? "public" : "notPublic");
  if (!l.enabled) out.push("editingOff");
  return out;
}

/**
 * ML-1 (DP-073, ADR-028 D2): the languages of the selected site, read only. Changing a language
 * (and opening Dutch to the public) is not an admin action in ML-1. Publication and visibility are
 * separate: published content of a language that is not public stays visible to staff only.
 */
export function SiteLanguagesPanel({
  site,
  t,
  locale,
}: {
  site: CmsSite;
  /** ML-12c: the UI language of the server page that renders the panel. */
  t: Translate;
  locale: AdminLocale;
}) {
  return (
    <Panel
      id="site-languages"
      title={t("content.common.siteLanguages.title")}
      description={t("content.common.siteLanguages.description")}
      bodyClassName="px-0! pb-2! pt-3!"
    >
      {site.locales.length === 0 ? (
        <EmptyState icon="content" title={t("content.common.siteLanguages.empty")} />
      ) : (
        <ul
          className="divide-y divide-line border-t border-line"
          aria-label={t("content.common.siteLanguages.list", { site: site.name })}
        >
          {site.locales.map((l) => (
            <li
              key={l.locale}
              className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6"
            >
              <span className="font-medium text-ink">{languageLabel(l.locale, locale)}</span>
              <span className="flex flex-wrap items-center gap-2">
                {languageStateKeys(l).map((k) => (
                  <StatusPill key={k} tone={STATE_TONE[k]}>
                    {t(`content.common.siteLanguages.${k}`)}
                  </StatusPill>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
