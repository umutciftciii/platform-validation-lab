/**
 * ML-12a (DP-243): the console's text for a validation or publication-readiness issue in the UI
 * language. The API sends every issue with a stable `code` and an English `message` built from the
 * shared contract (packages/contracts: checkSpecValue, validateProductData, checkPublication); the
 * API contract does not change. The console matches the message against the English template of
 * its code (lib/i18n/messages/catalog/en/issues.ts — the contract's own wording), takes the values
 * out (specification name, units, limits) and renders the same template in the UI language. In
 * English that reproduces the message character for character (test/catalog-issues.test.ts).
 *
 * Values are data and stay as they are: specification names, units, test methods and numbers. A
 * code or a message this module does not know falls back to the API's English message, so the
 * console never shows an empty line or a raw code.
 */
import { en } from "./i18n/messages/en";
import type { MessageKey, Translate } from "./i18n/types";

export interface IssueLike {
  code: string;
  target: string;
  message: string;
}

type Spec = typeof en.catalog.issues.spec;
type Pub = typeof en.catalog.issues.publication;

/** Templates per code, tried in order (a code may have several wordings). */
const SPEC_TEMPLATES: Readonly<Record<string, readonly (keyof Spec)[]>> = {
  required_missing: ["required_missing"],
  invalid_type: ["invalid_type", "enter_value", "enter_number"],
  invalid_unit: ["invalid_unit", "invalid_unit_none"],
  invalid_range: ["invalid_range"],
  out_of_bounds: ["out_of_bounds"],
  too_precise: ["too_precise"],
  too_long: ["too_long"],
  test_method_missing: ["test_method_missing"],
  unknown_definition: ["unknown_definition"],
  specs_missing: ["specs_missing"],
  alt_text_missing: ["alt_text_missing"],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const compiled = new Map<string, { re: RegExp; names: string[] }>();

/** The English template as a pattern: every `{param}` captures (lazily) what stood there. */
function pattern(template: string): { re: RegExp; names: string[] } {
  let hit = compiled.get(template);
  if (!hit) {
    const names: string[] = [];
    const source = template
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (!m) return escape(part);
        names.push(m[1] as string);
        return "([\\s\\S]+?)";
      })
      .join("");
    hit = { re: new RegExp(`^${source}$`), names };
    compiled.set(template, hit);
  }
  return hit;
}

function match(template: string, message: string): Record<string, string> | null {
  const { re, names } = pattern(template);
  const m = re.exec(message);
  if (!m) return null;
  return Object.fromEntries(names.map((n, i) => [n, m[i + 1] as string]));
}

/** "Viscosity (typical)" — the console's own suffix for a typical value (lib/spec-validation). */
function translateName(name: string, t: Translate): string {
  const typical = match(en.catalog.issues.typical, name);
  return typical ? t("catalog.issues.typical", { name: typical["name"] as string }) : name;
}

function findKey<T extends Record<string, string>>(table: T, value: string): keyof T | null {
  for (const [k, v] of Object.entries(table)) if (v === value) return k as keyof T;
  return null;
}

function specText(issue: IssueLike, t: Translate): string | null {
  for (const key of SPEC_TEMPLATES[issue.code] ?? []) {
    const params = match(en.catalog.issues.spec[key], issue.message);
    if (!params) continue;
    if (params["name"] !== undefined) params["name"] = translateName(params["name"], t);
    if (params["type"] !== undefined) {
      const type = findKey(en.catalog.issues.types, params["type"]);
      if (!type) return null;
      params["type"] = t(`catalog.issues.types.${type}`);
    }
    if (params["problem"] !== undefined) {
      const problem = findKey(en.catalog.issues.range, params["problem"]);
      if (!problem) return null;
      params["problem"] = t(`catalog.issues.range.${problem}`);
    }
    return (t as (k: MessageKey, p?: Record<string, string>) => string)(
      `catalog.issues.spec.${key}` as MessageKey,
      params,
    );
  }
  return null;
}

function publicationText(issue: IssueLike, t: Translate): string | null {
  const code = issue.code as keyof Pub;
  if (!(code in en.catalog.issues.publication)) return null;
  if (code === "sensitive_claim") {
    const params = match(en.catalog.issues.publication.sensitive_claim, issue.message);
    const key = issue.target.startsWith("text:") ? issue.target.slice(5) : "";
    if (!params || !(key in en.catalog.issues.claims)) return null;
    const claim = t(`catalog.issues.claims.${key as keyof typeof en.catalog.issues.claims}`);
    return t("catalog.issues.publication.sensitive_claim", { claim });
  }
  // DP-198: the console's plain wording of the two listing codes (lib/publication-status plain()).
  if (code === "listing_shown_on_publish" || code === "listing_hidden") {
    if (issue.message === en.catalog.issues.plain[code]) return t(`catalog.issues.plain.${code}`);
  }
  if (issue.message !== en.catalog.issues.publication[code]) return null;
  return t(`catalog.issues.publication.${code}`);
}

/** The issue's text in the UI language; the API's message when the code or wording is unknown. */
export function issueText(issue: IssueLike, t: Translate): string {
  return specText(issue, t) ?? publicationText(issue, t) ?? issue.message;
}

/**
 * ML-5 SEO length notes (contracts seoLengthWarning, English) in the UI language; unknown wording
 * stays as it is.
 */
export function seoLengthText(text: string, t: Translate): string {
  const long = match(en.catalog.common.seoLength.long, text);
  if (long) return t("catalog.common.seoLength.long", long as { n: string; recommended: string });
  const short = match(en.catalog.common.seoLength.short, text);
  if (short)
    return t(
      "catalog.common.seoLength.short",
      short as { n: string; short: string; recommended: string },
    );
  return text;
}
