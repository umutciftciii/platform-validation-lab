/**
 * ML-6 (DP-138): compile-time proof that a language dictionary must be complete. Not imported by
 * the site; `tsc --noEmit` (typecheck, CI Quality) checks it. Each `@ts-expect-error` below MUST
 * be an error: if a dictionary without a key ever compiled, the unused directive would fail the
 * typecheck instead.
 */
import type { Dictionary } from "./en.ts";
import { nl } from "./nl.ts";

declare const withoutSection: Omit<Dictionary, "notFound">;
declare const withoutNestedKey: Omit<Dictionary, "nav"> & { nav: Omit<Dictionary["nav"], "openMenu"> };
declare const withoutPluralForm: Omit<Dictionary, "catalogue"> & {
  catalogue: Omit<Dictionary["catalogue"], "count"> & { count: { one: string } };
};

// @ts-expect-error a dictionary without a section of the English source does not compile
export const missingSection: Dictionary = withoutSection;

// @ts-expect-error a dictionary without one key of a section does not compile
export const missingKey: Dictionary = withoutNestedKey;

// @ts-expect-error a plural without its "other" form does not compile
export const missingPluralForm: Dictionary = withoutPluralForm;

export const extraKey: Dictionary = {
  ...nl,
  // @ts-expect-error a key the English source does not have does not compile either
  notInEnglish: "x",
};
