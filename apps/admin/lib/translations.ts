/**
 * ML-8b (ADR-028 D8, DP-239, DP-257): the console's language tabs — pure helpers shared by the
 * server pages and the client editors, unit-tested without a browser. They only explain the
 * API's answers (translation states, missing units, the publication rules); the API decides.
 */
import type { SiteLanguagePublication, SiteLocale, TranslationState } from "@dream/contracts";
import type { PillTone } from "../components/ui";
import { en } from "./i18n/messages/en";
import type { Translate } from "./i18n/types";

/**
 * "English", "Dutch" (TR "İngilizce", "Felemenkçe"): the content language as a word of the console
 * (ML-12a); any other tag in capitals ("DE").
 */
export function localeLabel(locale: string, t: Translate): string {
  return locale in en.catalog.common.languages
    ? t(`catalog.common.languages.${locale as keyof typeof en.catalog.common.languages}`)
    : locale.toUpperCase();
}

/** The short tab label: "EN", "NL". */
export const localeShort = (locale: string): string => locale.toUpperCase();

export const TRANSLATION_STATE_TONES: Readonly<Record<TranslationState, PillTone>> = {
  MISSING: "danger",
  DRAFT: "petrol",
  PUBLISHED: "success",
  OUTDATED: "amber",
};

/** The state's word (English = contracts TRANSLATION_STATE_LABELS). */
export const translationStateLabel = (s: TranslationState, t: Translate): string =>
  t(`catalog.common.translationState.${s}`);

/** What each state means, in one sentence (the pill's title and the legend). */
export const translationStateHint = (s: TranslationState, t: Translate): string =>
  t(`catalog.common.translationStateHint.${s}`);

/** The enabled languages of a site for the tabs, default first (the API's order). */
export function tabLocales(locales: readonly SiteLocale[]): SiteLocale[] {
  return locales.filter((l) => l.enabled);
}

/** `?lang=` of a product page: an enabled language of the site, else the default. */
export function parseLang(value: string | string[] | undefined, locales: readonly SiteLocale[]) {
  const v = Array.isArray(value) ? value[0] : value;
  const tabs = tabLocales(locales);
  return tabs.find((l) => l.locale === v)?.locale ?? tabs.find((l) => l.isDefault)?.locale ?? "en";
}

/**
 * A unit the API reports as missing, in words: "listing", "category", "spec:<key>",
 * "image:<id>", "title", "seo.title", ... `names` gives specification and image labels.
 */
export function missingLabel(
  unit: string,
  t: Translate,
  names: {
    specs?: Readonly<Record<string, string>>;
    images?: Readonly<Record<string, string>>;
  } = {},
): string {
  if (unit === "listing") return t("catalog.common.missing.listing");
  if (unit === "category" || unit === "category.name")
    return t("catalog.common.missing.categoryName");
  if (unit === "category.description") return t("catalog.common.missing.categoryDescription");
  if (unit === "title") return t("catalog.common.missing.title");
  if (unit === "summary") return t("catalog.common.missing.summary");
  if (unit === "description") return t("catalog.common.missing.description");
  if (unit.startsWith("seo.")) {
    const k = unit.slice(4);
    if (k === "title") return t("catalog.common.missing.seoTitle");
    if (k === "description") return t("catalog.common.missing.seoDescription");
    if (k === "ogTitle") return t("catalog.common.missing.ogTitle");
    if (k === "ogDescription") return t("catalog.common.missing.ogDescription");
    return unit;
  }
  if (unit.startsWith("spec:")) {
    const key = unit.slice(5);
    return t("catalog.common.missing.specName", { name: names.specs?.[key] ?? key });
  }
  if (unit.startsWith("image:")) {
    const id = unit.slice(6);
    return t("catalog.common.missing.imageAlt", {
      name: names.images?.[id] ?? t("catalog.common.missing.image"),
    });
  }
  return unit;
}

export interface LanguagePlanOption {
  locale: string;
  /** The language may be chosen for this publication (complete, enabled, not the default). */
  selectable: boolean;
  /** Why it cannot be chosen (missing units in words), empty when selectable. */
  blockers: string[];
  /** A manual claim check must be confirmed before publishing it (no reviewed word list). */
  needsManualReview: boolean;
}

/**
 * The other languages a publication may write (the default is always written): each with what
 * blocks it. A language that is already live and unchanged needs no choice (it is kept).
 */
export function languageOptions(
  languages: readonly SiteLanguagePublication[],
  t: Translate,
): LanguagePlanOption[] {
  return languages
    .filter((l) => !l.isDefault)
    .map((l) => ({
      locale: l.locale,
      selectable: l.hasText && l.requiredMissing.length === 0,
      blockers: l.requiredMissing.map((u) => missingLabel(u, t)),
      needsManualReview: l.claimScan === "MANUAL",
    }));
}

/**
 * Whether Publish may be pressed with the chosen languages: the plan without languages allows it,
 * or (an up-to-date site) at least one language is chosen; every chosen language is selectable
 * and every one without a reviewed claim check is confirmed.
 */
export function canPublishLanguages(
  plan: { canPublish: boolean; upToDate: boolean; blocking: readonly unknown[] },
  site: { canPublish: boolean; listing: unknown },
  options: readonly LanguagePlanOption[],
  chosen: readonly string[],
  checked: readonly string[],
): boolean {
  const picked = options.filter((o) => chosen.includes(o.locale));
  if (picked.some((o) => !o.selectable)) return false;
  if (picked.some((o) => o.needsManualReview && !checked.includes(o.locale))) return false;
  if (plan.canPublish) return true;
  return (
    plan.upToDate &&
    picked.length > 0 &&
    site.canPublish &&
    site.listing !== null &&
    plan.blocking.length === 0
  );
}
