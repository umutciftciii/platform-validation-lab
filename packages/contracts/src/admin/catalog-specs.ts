/**
 * Technical specifications and product images (PM-2). Both belong to the platform-wide product
 * master: one value per product and definition, never copied per site. Changing them needs the
 * PLATFORM permission `product_master:edit`; reading them needs `product:read` on any site.
 *
 * The validation engine at the end of this file is shared by the API (refuses value-level
 * BLOCKING problems on save, reports the rest), the admin console (shows the same result) and
 * the review/publish workflow of PM-3 (refuses to publish while BLOCKING issues remain).
 */
import { z } from "zod";
import { UuidSchema } from "../auth/common.js";

const IsoDate = z.iso.datetime({ offset: true });
const VersionSchema = z.number().int().min(1);

// --- definitions ---------------------------------------------------------------------------

export const SPEC_DATA_TYPES = ["NUMBER", "TEXT", "BOOLEAN", "RANGE"] as const;
export const SpecDataTypeSchema = z.enum(SPEC_DATA_TYPES);
export type SpecDataType = z.infer<typeof SpecDataTypeSchema>;

/** Largest magnitude a number value may have (numeric(20,6) in the database). */
export const SPEC_NUMBER_LIMIT = 1e12;
export const SPEC_TEXT_MAX = 2000;

/** snake_case key, e.g. kinematic_viscosity_100c. */
export const SpecKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{1,63}$/);

/** A unit symbol as shown: "mm²/s", "°C", "%", "kg/m³". */
export const UnitSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[^\s<>"'`]+(?: [^\s<>"'`]+)*$/);

/** A test method reference: "ASTM D445", "ISO 3104". */
export const TestMethodSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ./:()-]*$/);

const SpecNumberSchema = z.number().finite().min(-SPEC_NUMBER_LIMIT).max(SPEC_NUMBER_LIMIT);

const DefinitionFields = z.strictObject({
  key: SpecKeySchema,
  name: z.string().trim().min(1).max(120),
  dataType: SpecDataTypeSchema,
  /** Accepted units; the first is the default. Empty: the value has no unit. */
  units: z.array(UnitSchema).max(8).default([]),
  /** Recommended test methods; a value without one gets a WARNING. */
  testMethods: z.array(TestMethodSchema).max(8).default([]),
  required: z.boolean().default(false),
  /** NUMBER and RANGE: inclusive bounds. */
  minValue: SpecNumberSchema.nullable().default(null),
  maxValue: SpecNumberSchema.nullable().default(null),
  /** NUMBER and RANGE: digits after the decimal point (0..6). */
  decimals: z.number().int().min(0).max(6).nullable().default(null),
  /** TEXT: maximum length. */
  maxLength: z.number().int().min(1).max(SPEC_TEXT_MAX).nullable().default(null),
  sortOrder: z.number().int().min(-1_000_000).max(1_000_000).default(0),
});

function refineDefinition(d: z.infer<typeof DefinitionFields>, ctx: z.RefinementCtx): void {
  const numeric = d.dataType === "NUMBER" || d.dataType === "RANGE";
  if (new Set(d.units).size !== d.units.length) {
    ctx.addIssue({ code: "custom", path: ["units"], message: "duplicate" });
  }
  if (new Set(d.testMethods).size !== d.testMethods.length) {
    ctx.addIssue({ code: "custom", path: ["testMethods"], message: "duplicate" });
  }
  if (!numeric && (d.minValue !== null || d.maxValue !== null || d.decimals !== null)) {
    ctx.addIssue({ code: "custom", path: ["minValue"], message: "numeric_only" });
  }
  if (!numeric && d.units.length > 0) {
    ctx.addIssue({ code: "custom", path: ["units"], message: "numeric_only" });
  }
  if (d.dataType !== "TEXT" && d.maxLength !== null) {
    ctx.addIssue({ code: "custom", path: ["maxLength"], message: "text_only" });
  }
  if (d.minValue !== null && d.maxValue !== null && d.minValue > d.maxValue) {
    ctx.addIssue({ code: "custom", path: ["maxValue"], message: "min_above_max" });
  }
}

export const SpecDefinitionCreateRequestSchema = DefinitionFields.superRefine(refineDefinition);
export type SpecDefinitionCreateRequest = z.input<typeof SpecDefinitionCreateRequestSchema>;

/** The key and data type never change once a definition exists (values depend on them). */
export const SpecDefinitionUpdateRequestSchema = DefinitionFields.omit({ key: true })
  .extend({
    dataType: SpecDataTypeSchema,
    archived: z.boolean().default(false),
    version: VersionSchema,
  })
  .superRefine((d, ctx) => refineDefinition({ ...d, key: "x_placeholder" }, ctx));
export type SpecDefinitionUpdateRequest = z.input<typeof SpecDefinitionUpdateRequestSchema>;

export const SpecDefinitionSchema = z.strictObject({
  id: UuidSchema,
  key: z.string(),
  name: z.string(),
  dataType: SpecDataTypeSchema,
  units: z.array(z.string()),
  testMethods: z.array(z.string()),
  required: z.boolean(),
  minValue: z.number().nullable(),
  maxValue: z.number().nullable(),
  decimals: z.number().int().nullable(),
  maxLength: z.number().int().nullable(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
  version: z.number().int(),
  /** Products that hold a value for it. */
  valueCount: z.number().int(),
  updatedAt: IsoDate,
});
export type SpecDefinition = z.infer<typeof SpecDefinitionSchema>;

export const SpecDefinitionListResponseSchema = z.strictObject({
  items: z.array(SpecDefinitionSchema).max(500),
});
export type SpecDefinitionListResponse = z.infer<typeof SpecDefinitionListResponseSchema>;

export const SpecDefinitionResponseSchema = z.strictObject({ definition: SpecDefinitionSchema });

// --- values --------------------------------------------------------------------------------

export const SpecValueDataSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("NUMBER"), number: SpecNumberSchema }),
  z.strictObject({ type: z.literal("RANGE"), min: SpecNumberSchema, max: SpecNumberSchema }),
  z.strictObject({ type: z.literal("TEXT"), text: z.string().trim().min(1).max(SPEC_TEXT_MAX) }),
  z.strictObject({ type: z.literal("BOOLEAN"), boolean: z.boolean() }),
]);
export type SpecValueData = z.infer<typeof SpecValueDataSchema>;

export const SpecValueInputSchema = z.strictObject({
  definitionId: UuidSchema,
  value: SpecValueDataSchema,
  unit: UnitSchema.nullable().default(null),
  testMethod: TestMethodSchema.nullable().default(null),
});
export type SpecValueInput = z.input<typeof SpecValueInputSchema>;

/**
 * Replace the product's specification values. `version` is the product master's version: the
 * values are part of the master, so saving them bumps it (and a stale version is a conflict).
 * A definition left out has no value afterwards.
 */
export const SpecValuesSaveRequestSchema = z.strictObject({
  version: VersionSchema,
  values: z.array(SpecValueInputSchema).max(200),
});
export type SpecValuesSaveRequest = z.input<typeof SpecValuesSaveRequestSchema>;

export const SpecValueSchema = z.strictObject({
  definitionId: UuidSchema,
  value: SpecValueDataSchema,
  unit: z.string().nullable(),
  testMethod: z.string().nullable(),
  updatedAt: IsoDate,
});
export type SpecValue = z.infer<typeof SpecValueSchema>;

// --- images --------------------------------------------------------------------------------

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ImageMimeTypeSchema = z.enum(IMAGE_MIME_TYPES);
export type ImageMimeType = z.infer<typeof ImageMimeTypeSchema>;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_MIN_WIDTH = 800;
export const IMAGE_MIN_HEIGHT = 600;
/** Pixel-bomb guard: width × height above this is refused before decoding. */
export const IMAGE_MAX_PIXELS = 25_000_000;
export const IMAGE_MAX_SIDE = 10_000;
export const IMAGE_VARIANTS = ["original", "display", "thumb"] as const;
export type ImageVariant = (typeof IMAGE_VARIANTS)[number];
export const ALT_TEXT_MAX = 300;
/** Header carrying the percent-encoded original file name of an upload (display only). */
export const UPLOAD_FILENAME_HEADER = "x-dp-upload-filename";

export const ProductImageSchema = z.strictObject({
  id: UuidSchema,
  productId: UuidSchema,
  mimeType: ImageMimeTypeSchema,
  byteSize: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  sha256: z.string(),
  originalFilename: z.string(),
  altText: z.string().nullable(),
  sortOrder: z.number().int(),
  isCover: z.boolean(),
  version: z.number().int(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type ProductImage = z.infer<typeof ProductImageSchema>;

export const ProductImageListResponseSchema = z.strictObject({
  items: z.array(ProductImageSchema).max(100),
});
export type ProductImageListResponse = z.infer<typeof ProductImageListResponseSchema>;
export const ProductImageResponseSchema = z.strictObject({ image: ProductImageSchema });
export type ProductImageResponse = z.infer<typeof ProductImageResponseSchema>;
export const IMAGES_PER_PRODUCT_MAX = 40;

export const ImageUpdateRequestSchema = z.strictObject({
  altText: z
    .string()
    .trim()
    .max(ALT_TEXT_MAX)
    .nullish()
    .transform((v) => (v ? v : null)),
  version: VersionSchema,
});
export type ImageUpdateRequest = z.input<typeof ImageUpdateRequestSchema>;

export const ImageCoverRequestSchema = z.strictObject({ version: VersionSchema });

/** The full gallery order: exactly the product's image ids, each once. */
export const ImageOrderRequestSchema = z.strictObject({
  imageIds: z.array(UuidSchema).min(1).max(IMAGES_PER_PRODUCT_MAX),
});
export type ImageOrderRequest = z.infer<typeof ImageOrderRequestSchema>;

// --- validation engine ---------------------------------------------------------------------

export type IssueSeverity = "BLOCKING" | "WARNING";
export const ISSUE_CODES = [
  "required_missing",
  "invalid_type",
  "invalid_unit",
  "invalid_range",
  "out_of_bounds",
  "too_precise",
  "too_long",
  "unknown_definition",
  "optional_missing",
  "test_method_missing",
  "alt_text_missing",
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

export const ValidationIssueSchema = z.strictObject({
  severity: z.enum(["BLOCKING", "WARNING"]),
  code: z.enum(ISSUE_CODES),
  /** "spec:<definition key>" or "image:<image id>". */
  target: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ProductValidationSchema = z.strictObject({
  ok: z.boolean(),
  blocking: z.array(ValidationIssueSchema),
  warnings: z.array(ValidationIssueSchema),
});
export type ProductValidation = z.infer<typeof ProductValidationSchema>;

/** The part of a definition the engine needs. */
export interface DefinitionRule {
  id: string;
  key: string;
  name: string;
  dataType: SpecDataType;
  units: readonly string[];
  testMethods: readonly string[];
  required: boolean;
  minValue: number | null;
  maxValue: number | null;
  decimals: number | null;
  maxLength: number | null;
  archived: boolean;
}

export interface ValueForCheck {
  definitionId: string;
  value: SpecValueData;
  unit: string | null;
  testMethod: string | null;
}

const issue = (
  severity: IssueSeverity,
  code: IssueCode,
  target: string,
  message: string,
): ValidationIssue => ({ severity, code, target, message });

function decimalsOf(n: number): number {
  if (Number.isInteger(n)) return 0;
  const s = String(n);
  if (s.includes("e-"))
    return Number(s.split("e-")[1]) + (s.split(".")[1]?.split("e")[0]?.length ?? 0);
  return s.split(".")[1]?.length ?? 0;
}

/** Problems of one value against its definition (all BLOCKING except the test method). */
export function checkSpecValue(def: DefinitionRule, v: ValueForCheck): ValidationIssue[] {
  const target = `spec:${def.key}`;
  const out: ValidationIssue[] = [];
  if (v.value.type !== def.dataType) {
    return [
      issue(
        "BLOCKING",
        "invalid_type",
        target,
        `${def.name}: expected a ${def.dataType.toLowerCase()} value.`,
      ),
    ];
  }
  if (def.units.length === 0 ? v.unit !== null : v.unit === null || !def.units.includes(v.unit)) {
    out.push(
      issue(
        "BLOCKING",
        "invalid_unit",
        target,
        def.units.length
          ? `${def.name}: unit must be one of ${def.units.join(", ")}.`
          : `${def.name}: this specification has no unit.`,
      ),
    );
  }
  const numbers =
    v.value.type === "NUMBER"
      ? [v.value.number]
      : v.value.type === "RANGE"
        ? [v.value.min, v.value.max]
        : [];
  if (v.value.type === "RANGE" && v.value.min > v.value.max) {
    out.push(issue("BLOCKING", "invalid_range", target, `${def.name}: minimum is above maximum.`));
  }
  if (
    numbers.some(
      (n) =>
        (def.minValue !== null && n < def.minValue) || (def.maxValue !== null && n > def.maxValue),
    )
  ) {
    out.push(
      issue(
        "BLOCKING",
        "out_of_bounds",
        target,
        `${def.name}: allowed range is ${def.minValue ?? "−∞"} to ${def.maxValue ?? "∞"}.`,
      ),
    );
  }
  if (def.decimals !== null && numbers.some((n) => decimalsOf(n) > (def.decimals as number))) {
    out.push(
      issue("BLOCKING", "too_precise", target, `${def.name}: at most ${def.decimals} decimals.`),
    );
  }
  if (v.value.type === "TEXT" && def.maxLength !== null && v.value.text.length > def.maxLength) {
    out.push(
      issue("BLOCKING", "too_long", target, `${def.name}: at most ${def.maxLength} characters.`),
    );
  }
  if (def.testMethods.length > 0 && !v.testMethod) {
    out.push(
      issue(
        "WARNING",
        "test_method_missing",
        target,
        `${def.name}: no test method (recommended: ${def.testMethods.join(", ")}).`,
      ),
    );
  }
  return out;
}

/**
 * The publishing-relevant validation of a product master's technical data and images.
 * BLOCKING: a required specification missing, or a value with the wrong type, unit, range,
 * bounds or precision. WARNING: optional data missing, a recommended test method missing,
 * an image without alt text. Archived definitions are ignored unless a value uses them.
 */
export function validateProductData(input: {
  definitions: readonly DefinitionRule[];
  values: readonly ValueForCheck[];
  images: readonly { id: string; altText: string | null }[];
}): ProductValidation {
  const byId = new Map(input.definitions.map((d) => [d.id, d]));
  const valued = new Set(input.values.map((v) => v.definitionId));
  const all: ValidationIssue[] = [];
  for (const d of input.definitions) {
    if (d.archived || valued.has(d.id)) continue;
    all.push(
      d.required
        ? issue("BLOCKING", "required_missing", `spec:${d.key}`, `${d.name} is required.`)
        : issue("WARNING", "optional_missing", `spec:${d.key}`, `${d.name} has no value.`),
    );
  }
  for (const v of input.values) {
    const d = byId.get(v.definitionId);
    if (!d) {
      all.push(
        issue("BLOCKING", "unknown_definition", `spec:${v.definitionId}`, "Unknown specification."),
      );
      continue;
    }
    all.push(...checkSpecValue(d, v));
  }
  for (const img of input.images) {
    if (!img.altText) {
      all.push(
        issue("WARNING", "alt_text_missing", `image:${img.id}`, "An image has no alt text."),
      );
    }
  }
  const blocking = all.filter((i) => i.severity === "BLOCKING");
  return {
    ok: blocking.length === 0,
    blocking,
    warnings: all.filter((i) => i.severity === "WARNING"),
  };
}

export const ProductSpecsResponseSchema = z.strictObject({
  productVersion: z.number().int(),
  definitions: z.array(SpecDefinitionSchema).max(500),
  values: z.array(SpecValueSchema).max(500),
  validation: ProductValidationSchema,
});
export type ProductSpecsResponse = z.infer<typeof ProductSpecsResponseSchema>;
