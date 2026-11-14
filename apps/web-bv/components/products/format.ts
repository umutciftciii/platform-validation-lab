import type { PublicProduct } from "@dream/contracts";

type Spec = PublicProduct["specs"][number];

const NUMBER = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 6 });

/**
 * A specification value as shown on the site: "6.1 mm²/s", "−45 to −36 °C", "≥ 200 °C",
 * "< 1,800 mPa·s", "3.8 to < 4.5 mm²/s", "Yes". DP-156: a range may have one end and open ends;
 * a range with equal ends (a typical value) is shown as one number.
 */
export function formatSpecValue(spec: Spec): string {
  const unit = spec.unit ? ` ${spec.unit}` : "";
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
        return `${from} to ${to}${unit}`;
      }
      if (lo !== null) return `${v.minExclusive ? ">" : "≥"} ${lo}${unit}`;
      return `${v.maxExclusive ? "<" : "≤"} ${hi}${unit}`;
    }
    case "TEXT":
      return v.text;
    case "BOOLEAN":
      return v.boolean ? "Yes" : "No";
  }
}
