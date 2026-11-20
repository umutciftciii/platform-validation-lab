import type { CmsSite, SiteLocale } from "@dream/contracts";
import { EmptyState, Panel, StatusPill } from "../ui";

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

/** "English (en)"; the bare tag when the runtime has no name for it. */
export function languageLabel(locale: string): string {
  let name: string | undefined;
  try {
    name = LANGUAGE_NAMES.of(locale);
  } catch {
    name = undefined;
  }
  return name && name !== locale ? `${name} (${locale})` : locale;
}

/** The site's state of one language, as short labels (one text node each, DP-196). */
export function languageStates(l: SiteLocale): string[] {
  const out: string[] = [];
  if (l.isDefault) out.push("Default");
  out.push(l.public ? "Public on the site" : "Not public");
  if (!l.enabled) out.push("Editing off");
  return out;
}

/**
 * ML-1 (DP-073, ADR-028 D2): the languages of the selected site, read only. Changing a language
 * (and opening Dutch to the public) is not an admin action in ML-1. Publication and visibility are
 * separate: published content of a language that is not public stays visible to staff only.
 */
export function SiteLanguagesPanel({ site }: { site: CmsSite }) {
  return (
    <Panel
      id="site-languages"
      title="Site languages"
      description="Read only. Content in an enabled language can be drafted, previewed and published; a language that is not public is never shown to visitors."
      bodyClassName="px-0! pb-2! pt-3!"
    >
      {site.locales.length === 0 ? (
        <EmptyState icon="content" title="No languages recorded for this site" />
      ) : (
        <ul
          className="divide-y divide-line border-t border-line"
          aria-label={`Languages of ${site.name}`}
        >
          {site.locales.map((l) => (
            <li
              key={l.locale}
              className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6"
            >
              <span className="font-medium text-ink">{languageLabel(l.locale)}</span>
              <span className="flex flex-wrap items-center gap-2">
                {languageStates(l).map((label) => (
                  <StatusPill
                    key={label}
                    tone={
                      label === "Not public" || label === "Editing off"
                        ? "amber"
                        : label === "Default"
                          ? "petrol"
                          : "success"
                    }
                  >
                    {label}
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
