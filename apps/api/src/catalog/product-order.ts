// DP-160: the order of product names inside one listing position. Numbers compare as numbers
// ("White Oil 15#" before "White Oil 100#"), and a pack size in grams or kilograms compares by
// its mass in grams ("50 g" before "25 kg" before "165 kg"); every other number keeps its own
// natural order. The catalogue mapping tool (docs/catalog/tools/build_bv_mapping.py) applies the
// same rule when it numbers the listings.

const PACK_SIZE = /(\d+(?:\.\d+)?)\s*(kg|g)\b/gi;

/** The name with each g/kg pack size written as whole grams, for natural comparison. */
export function orderName(name: string): string {
  return name.replace(PACK_SIZE, (_m, n: string, unit: string) => {
    const grams = Number(n) * (unit.toLowerCase() === "kg" ? 1000 : 1);
    return `${Math.round(grams)} g`;
  });
}

export function compareProductNames(a: string, b: string): number {
  return (
    orderName(a).localeCompare(orderName(b), "en", { numeric: true }) ||
    a.localeCompare(b, "en", { numeric: true })
  );
}
