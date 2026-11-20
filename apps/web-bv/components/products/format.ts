import type { PublicProduct } from "@dream/contracts";

import { dictionary, intlLocale, interpolate } from "../../lib/i18n/index.ts";

type Spec = PublicProduct["specs"][number];

/** ML-6: number formats per language (`en-GB` 1,800.5 · `nl-NL` 1.800,5); cached per locale. */
const FORMATS = new Map<string, { plain: Intl.NumberFormat; signed: Intl.NumberFormat }>();

function formats(locale: string) {
  const tag = intlLocale(locale);
  let f = FORMATS.get(tag);
  if (!f) {
    f = {
      plain: new Intl.NumberFormat(tag, { maximumFractionDigits: 6 }),
      signed: new Intl.NumberFormat(tag, { maximumFractionDigits: 6, signDisplay: "exceptZero" }),
    };
    FORMATS.set(tag, f);
  }
  return f;
}

/**
 * Scales whose values are written with their sign: the Saybolt colour runs from −16 to +30 and
 * "+30" is the value as specified and certified, so it is never shown as "30".
 */
const SIGNED_SCALES = new Set(["color_saybolt"]);

/**
 * A specification value as shown on the site: "6.1 mm²/s", "−45 to −36 °C", "≥ 200 °C",
 * "< 1,800 mPa·s", "3.8 to < 4.5 mm²/s", "≥ +30" (Saybolt), "Yes". DP-156: a range may have one end and open ends;
 * a range with equal ends (a typical value) is shown as one number.
 * ML-6: words and number format in the page's language ("6,1 mm²/s", "3,8 tot < 4,5 mm²/s",
 * "Ja" in Dutch); units, signs, symbols and text values are never translated.
 */
export function formatSpecValue(spec: Spec, locale = "en"): string {
  const ui = dictionary(locale).spec;
  const unit = spec.unit ? ` ${spec.unit}` : "";
  const { plain, signed } = formats(locale);
  const NUMBER = SIGNED_SCALES.has(spec.key) ? signed : plain;
  const v = spec.value;
  switch (v.type) {
    case "NUMBER":
      return `${NUMBER.format(v.number)}${unit}`;
    case "RANGE": {
      const lo = v.min === null ? null : NUMBER.format(v.min);
      const hi = v.max === null ? null : NUMBER.format(v.max);
      if (lo !== null && hi !== null) {
        if (v.min === v.max) return `${lo}${unit}`;
        const from = v.minExclusive ? `> ${lo}` : lo;
        const to = v.maxExclusive ? `< ${hi}` : hi;
        return `${interpolate(ui.range, { from, to })}${unit}`;
      }
      if (lo !== null) return `${v.minExclusive ? ">" : "≥"} ${lo}${unit}`;
      return `${v.maxExclusive ? "<" : "≤"} ${hi}${unit}`;
    }
    case "TEXT":
      return v.text;
    case "BOOLEAN":
      return v.boolean ? ui.yes : ui.no;
  }
}
