/**
 * DP-173: presentation of the held/withheld values in the company catalogue preview.
 *
 * The research records write an empty value cell of the current site as "None" (Python). The
 * preview says what it is, never "None": `Appearance: None [no method]` becomes
 * `Appearance: no value shown [no method]`. Only that literal token right after the label
 * changes; nothing is added to a value.
 */
export function heldRawForDisplay(raw: string): string {
  return raw.replace(/^([^:]{1,200}): None(?=\s|$)/, "$1: no value shown");
}
