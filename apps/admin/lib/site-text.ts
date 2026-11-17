/**
 * DP-202: what the Content tab says under each of a site's own text fields — whether the site's
 * product page uses that field, or (when it is empty) the shared product content instead. Mirrors
 * the API's fallback (`listing text ?? product master`, catalog workflow and preview services);
 * an empty field is saved as null. Pure functions over saved values, unit-tested.
 */

export type SiteTextField = "title" | "summary" | "description";

const OWN: Readonly<Record<SiteTextField, (site: string) => string>> = {
  title: (site) => `Shown as the product name on ${site}.`,
  summary: (site) => `Shown on the ${site} product card and product page.`,
  description: (site) => `Shown on the ${site} product page. English only for now.`,
};

const SHARED: Readonly<Record<SiteTextField, string>> = {
  title: "name",
  summary: "summary",
  description: "description",
};

const NONE: Readonly<Record<SiteTextField, (site: string) => string>> = {
  title: (site) => `Empty: ${site} shows the shared product name.`,
  summary: (site) => `Empty: the ${site} product card and page show no summary.`,
  description: (site) => `Empty: the ${site} product page shows no description.`,
};

const filled = (v: string | null | undefined): boolean => !!v && v.trim().length > 0;

/**
 * The hint for one field, from the saved site text (`own`) and the saved shared text (`shared`).
 * One string, so a translated page updates it in place (DP-196).
 */
export function siteTextHint(
  field: SiteTextField,
  site: string,
  own: string | null | undefined,
  shared: string | null | undefined,
): string {
  if (filled(own)) return OWN[field](site);
  if (filled(shared)) {
    return `Empty: ${site} shows the shared ${SHARED[field]} from “Shared product content” below.`;
  }
  return NONE[field](site);
}
