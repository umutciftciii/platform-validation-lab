/**
 * DP-202: what the Content tab says under each of a site's own text fields — whether the site's
 * product page uses that field, or (when it is empty) the shared product content instead. Mirrors
 * the API's fallback (`listing text ?? product master`, catalog workflow and preview services);
 * an empty field is saved as null. Pure functions over saved values, unit-tested. ML-12a: the
 * sentences are in the dictionary (catalog.common.siteText); English unchanged.
 */
import type { Translate } from "./i18n/types";

export type SiteTextField = "title" | "summary" | "description";

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
  t: Translate,
): string {
  if (filled(own)) return t(`catalog.common.siteText.own.${field}`, { site });
  if (filled(shared)) return t(`catalog.common.siteText.shared.${field}`, { site });
  return t(`catalog.common.siteText.none.${field}`, { site });
}
