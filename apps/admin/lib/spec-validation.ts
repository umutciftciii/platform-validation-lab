/**
 * Live validation of the specification form (PM-3 validation review). The form, its field
 * messages and its summary all use the shared engine of @dream/contracts (`checkSpecValue`,
 * `validateProductData`, PM-2) on the values AS TYPED, so a test method entered but not yet
 * saved clears its warning everywhere at once, and a cleared required value shows as BLOCKING
 * before the save. There is no second validation system: only the two shape problems the engine
 * cannot see (an empty or non-numeric input) are added here, as BLOCKING `invalid_type`.
 *
 * Image issues (alt text) are not part of this form; they are taken from the server's report.
 */
import {
  validateProductData,
  type ProductValidation,
  type SpecDefinition,
  type SpecValueData,
  type ValidationIssue,
  type ValueForCheck,
} from "@dream/contracts";

/** Editable state of one definition's value; strings as typed. */
export interface Draft {
  on: boolean;
  number: string;
  min: string;
  max: string;
  text: string;
  bool: "" | "true" | "false";
  unit: string;
  testMethod: string;
}

/** The value a draft stands for, or a client-side shape problem (empty / not a number). */
export function draftValue(
  def: SpecDefinition,
  d: Draft,
): SpecValueData | "empty" | "not_a_number" {
  const n = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".")));
  switch (def.dataType) {
    case "NUMBER": {
      if (d.number.trim() === "") return "empty";
      const v = n(d.number);
      return Number.isFinite(v) ? { type: "NUMBER", number: v } : "not_a_number";
    }
    case "RANGE": {
      if (d.min.trim() === "" || d.max.trim() === "") return "empty";
      const a = n(d.min);
      const b = n(d.max);
      return Number.isFinite(a) && Number.isFinite(b)
        ? { type: "RANGE", min: a, max: b }
        : "not_a_number";
    }
    case "TEXT":
      return d.text.trim() === "" ? "empty" : { type: "TEXT", text: d.text.trim() };
    case "BOOLEAN":
      return d.bool === "" ? "empty" : { type: "BOOLEAN", boolean: d.bool === "true" };
  }
}

/** The value as it would be saved (same unit and test-method normalisation as the request). */
export function draftForCheck(
  def: SpecDefinition,
  d: Draft,
): ValueForCheck | "empty" | "not_a_number" {
  const v = draftValue(def, d);
  if (v === "empty" || v === "not_a_number") return v;
  return {
    definitionId: def.id,
    value: v,
    unit: def.units.length ? d.unit || null : null,
    testMethod: d.testMethod.trim() || null,
  };
}

/**
 * The product's validation report for the values as typed: the shared engine over every value
 * that is switched on, plus BLOCKING for inputs that are not a value yet, plus the server's
 * image issues.
 */
export function liveValidation(
  definitions: readonly SpecDefinition[],
  drafts: Readonly<Record<string, Draft>>,
  server: ProductValidation,
): ProductValidation {
  const values: ValueForCheck[] = [];
  const shape: ValidationIssue[] = [];
  for (const def of definitions) {
    const d = drafts[def.id];
    if (!d?.on) continue;
    const v = draftForCheck(def, d);
    if (v === "empty" || v === "not_a_number") {
      shape.push({
        severity: "BLOCKING",
        code: "invalid_type",
        target: `spec:${def.key}`,
        message: `${def.name}: ${v === "empty" ? "enter a value or remove it" : "enter a number"}.`,
      });
      continue;
    }
    values.push(v);
  }
  // Inputs that are not a value yet must not also count as "required missing".
  const typedButInvalid = new Set(shape.map((i) => i.target));
  const engine = validateProductData({ definitions, values, images: [] });
  const imageIssues = (list: ValidationIssue[]) =>
    list.filter((i) => i.target.startsWith("image:"));
  const blocking = [
    ...shape,
    ...engine.blocking.filter((i) => !typedButInvalid.has(i.target)),
    ...imageIssues(server.blocking),
  ];
  const warnings = [
    ...engine.warnings.filter((i) => !typedButInvalid.has(i.target)),
    ...imageIssues(server.warnings),
  ];
  return { ok: blocking.length === 0, blocking, warnings };
}

/** Whether the drafts differ from the saved values (the summary then says it is unsaved). */
export function draftsDiffer(
  a: Readonly<Record<string, Draft>>,
  b: Readonly<Record<string, Draft>>,
): boolean {
  const norm = (r: Readonly<Record<string, Draft>>) =>
    JSON.stringify(
      Object.keys(r)
        .sort()
        .map((k) => {
          const d = r[k] as Draft;
          return d.on ? [k, d] : [k, false];
        }),
    );
  return norm(a) !== norm(b);
}
