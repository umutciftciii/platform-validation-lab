import type { PublicProduct } from "@dream/contracts";

type Spec = PublicProduct["specs"][number];

const NUMBER = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 6 });

/** A specification value as shown on the site: "6.1 mm²/s", "−45 to −36 °C", "Yes". */
export function formatSpecValue(spec: Spec): string {
  const unit = spec.unit ? ` ${spec.unit}` : "";
  const v = spec.value;
  switch (v.type) {
    case "NUMBER":
      return `${NUMBER.format(v.number)}${unit}`;
    case "RANGE":
      return `${NUMBER.format(v.min)} to ${NUMBER.format(v.max)}${unit}`;
    case "TEXT":
      return v.text;
    case "BOOLEAN":
      return v.boolean ? "Yes" : "No";
  }
}
