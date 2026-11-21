/**
 * ML-8b (ADR-028 D8, DP-239, DP-257): the console's language tabs — pure helpers shared by the
 * server pages and the client editors, unit-tested without a browser. They only explain the
 * API's answers (translation states, missing units, the publication rules); the API decides.
 */
import {
  TRANSLATION_STATE_LABELS,
  type SiteLanguagePublication,
  type SiteLocale,
  type TranslationState,
} from "@dream/contracts";
import type { PillTone } from "../components/ui";

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: "English",
  nl: "Dutch",
};

/** "English", "Dutch"; any other tag in capitals ("DE"). */
export function localeLabel(locale: string): string {
  return LANGUAGE_NAMES[locale] ?? locale.toUpperCase();
}

/** The short tab label: "EN", "NL". */
export const localeShort = (locale: string): string => locale.toUpperCase();

export const TRANSLATION_STATE_TONES: Readonly<Record<TranslationState, PillTone>> = {
  MISSING: "danger",
  DRAFT: "petrol",
  PUBLISHED: "success",
  OUTDATED: "amber",
};

export const translationStateLabel = (s: TranslationState): string => TRANSLATION_STATE_LABELS[s];

/** What each state means, in one sentence (the pill's title and the legend). */
export const TRANSLATION_STATE_HINTS: Readonly<Record<TranslationState, string>> = {
  MISSING: "No text in this language yet.",
  DRAFT: "Saved, not published in this language yet (or changed since).",
  PUBLISHED: "Exactly what the live site carries in this language.",
  OUTDATED: "The English source changed after this text was saved: check it and save again.",
};

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
  names: {
    specs?: Readonly<Record<string, string>>;
    images?: Readonly<Record<string, string>>;
  } = {},
): string {
  if (unit === "listing") return "Product text (title, summary or description)";
  if (unit === "category" || unit === "category.name") return "Category name";
  if (unit === "category.description") return "Category description";
  if (unit === "title") return "Title";
  if (unit === "summary") return "Summary";
  if (unit === "description") return "Description";
  if (unit.startsWith("seo.")) {
    const k = unit.slice(4);
    const seo: Record<string, string> = {
      title: "SEO title",
      description: "SEO description",
      ogTitle: "Link preview title",
      ogDescription: "Link preview description",
    };
    return seo[k] ?? unit;
  }
  if (unit.startsWith("spec:")) {
    const key = unit.slice(5);
    return `Specification name: ${names.specs?.[key] ?? key}`;
  }
  if (unit.startsWith("image:")) {
    const id = unit.slice(6);
    return `Image alt text: ${names.images?.[id] ?? "image"}`;
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
): LanguagePlanOption[] {
  return languages
    .filter((l) => !l.isDefault)
    .map((l) => ({
      locale: l.locale,
      selectable: l.hasText && l.requiredMissing.length === 0,
      blockers: l.requiredMissing.map((u) => missingLabel(u)),
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
