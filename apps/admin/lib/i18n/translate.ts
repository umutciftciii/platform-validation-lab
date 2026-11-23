/**
 * The translation function (ML-11). Plain module: no React, no "use client", no Next imports, so
 * server components, client components and tests share it. `t()` always returns ONE string, which
 * keeps the DP-196/DP-199 translate-safe JSX rules (R1–R3) intact: a translated text is a single
 * text node, updated in place.
 */
import { type AdminLocale, INTL_LOCALE } from "./config";
import { en } from "./messages/en";
import { tr } from "./messages/tr";
import type { MessageKey, Messages, ParamValue, PluralForms, Translate } from "./types";

export const DICTIONARIES: Readonly<Record<AdminLocale, Messages>> = { en, tr };

const PLACEHOLDER = /\{(\w+)\}/g;

function isPlural(value: unknown): value is PluralForms {
  return typeof value === "object" && value !== null && "one" in value && "other" in value;
}

/** The raw message (string or plural forms) at a dotted key, or undefined. */
export function lookup(messages: Messages, key: string): string | PluralForms | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" || isPlural(node) ? node : undefined;
}

/** Fills `{name}` placeholders; a missing parameter stays visible as `{name}`. */
export function interpolate(text: string, params: Readonly<Record<string, ParamValue>>): string {
  return text.replace(PLACEHOLDER, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

const pluralRules = new Map<AdminLocale, Intl.PluralRules>();

/** "one" or "other" for a count in a language (Turkish uses both, like English). */
export function pluralCategory(locale: AdminLocale, count: number): "one" | "other" {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(INTL_LOCALE[locale]);
    pluralRules.set(locale, rules);
  }
  return rules.select(count) === "one" ? "one" : "other";
}

/**
 * A `t()` bound to one language. A key missing at run time (impossible for typed callers) falls
 * back to English and then to the key itself, so a screen never renders empty.
 */
export function createTranslator(locale: AdminLocale): Translate {
  const messages = DICTIONARIES[locale];
  return ((key: MessageKey, params?: Record<string, ParamValue>) => {
    const value = lookup(messages, key) ?? lookup(en, key) ?? key;
    if (typeof value === "string") return params ? interpolate(value, params) : value;
    const count = Number(params?.["count"] ?? 0);
    return interpolate(value[pluralCategory(locale, count)], params ?? {});
  }) as Translate;
}
