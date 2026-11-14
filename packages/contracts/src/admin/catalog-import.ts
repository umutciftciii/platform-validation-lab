/**
 * DP-157: the catalogue mapping file the import reads (docs/catalog/bv-catalog-mapping.json,
 * schemaVersion 1, built by docs/catalog/tools/build_bv_mapping.py). Only the parts the import
 * acts on are validated strictly; everything else in the file (evidence, conflicts, held values,
 * documents, images, redirects) is report material and passes through untouched.
 *
 * The schema itself enforces the owner decisions the import must never break: a product is
 * created as DRAFT and listed HIDDEN, nothing else is accepted.
 */
import { z } from "zod";
import { ProductCodeSchema, SlugSchema } from "./catalog.js";
import {
  SpecDataTypeSchema,
  SpecKeySchema,
  SpecValueBasisSchema,
  SpecValueDataSchema,
  TestMethodSchema,
  UnitSchema,
} from "./catalog-specs.js";

export const MappingDefinitionSchema = z.object({
  key: SpecKeySchema,
  name: z.string().trim().min(1).max(120),
  dataType: SpecDataTypeSchema,
  units: z.array(UnitSchema).max(8),
  testMethods: z.array(TestMethodSchema).max(8),
  decimals: z.number().int().min(0).max(6).nullable(),
});
export type MappingDefinition = z.infer<typeof MappingDefinitionSchema>;

export const MappingCategorySchema = z.object({
  slug: SlugSchema,
  name: z.string().trim().min(1).max(120),
  parentSlug: SlugSchema.nullable(),
  sortOrder: z.number().int(),
});
export type MappingCategory = z.infer<typeof MappingCategorySchema>;

export const MappingSpecSchema = z.object({
  key: SpecKeySchema,
  basis: SpecValueBasisSchema,
  value: SpecValueDataSchema,
  unit: UnitSchema.nullable(),
  testMethod: TestMethodSchema.nullable(),
});
export type MappingSpec = z.infer<typeof MappingSpecSchema>;

export const MappingProductSchema = z.object({
  liveSlug: z.string(),
  sourceUrl: z.url(),
  code: ProductCodeSchema,
  slug: SlugSchema,
  name: z.string().trim().min(1).max(200),
  readiness: z.enum(["READY", "READY_NO_SPECS", "SPEC_HOLD"]),
  import: z.object({
    master: z.object({
      code: ProductCodeSchema,
      slug: SlugSchema,
      name: z.string().trim().min(1).max(200),
      status: z.literal("DRAFT"),
    }),
    listing: z.object({
      site: z.literal("BV"),
      categorySlug: SlugSchema,
      visibility: z.literal("HIDDEN"),
      sortOrder: z.number().int(),
      texts: z.object({ en: z.object({ title: z.string().trim().min(1).max(200) }) }),
    }),
    specs: z.array(MappingSpecSchema).max(200),
  }),
});
export type MappingProduct = z.infer<typeof MappingProductSchema>;

export const CatalogMappingSchema = z
  .object({
    schemaVersion: z.literal(1),
    site: z.literal("BV"),
    definitions: z.array(MappingDefinitionSchema).max(500),
    categories: z.array(MappingCategorySchema).max(1000),
    products: z.array(MappingProductSchema).max(5000),
  })
  .superRefine((m, ctx) => {
    const dup = (values: string[], path: string) => {
      const seen = new Set<string>();
      for (const v of values) {
        if (seen.has(v)) ctx.addIssue({ code: "custom", path: [path], message: `duplicate ${v}` });
        seen.add(v);
      }
    };
    dup(
      m.products.map((p) => p.code),
      "products.code",
    );
    dup(
      m.products.map((p) => p.slug),
      "products.slug",
    );
    dup(
      m.categories.map((c) => c.slug),
      "categories.slug",
    );
    dup(
      m.definitions.map((d) => d.key),
      "definitions.key",
    );
    const cats = new Set(m.categories.map((c) => c.slug));
    const defs = new Set(m.definitions.map((d) => d.key));
    m.products.forEach((p, i) => {
      const { master, listing, specs } = p.import;
      if (master.code !== p.code || master.slug !== p.slug || master.name !== p.name) {
        ctx.addIssue({ code: "custom", path: ["products", i], message: "master differs" });
      }
      if (!cats.has(listing.categorySlug)) {
        ctx.addIssue({ code: "custom", path: ["products", i], message: "unknown category" });
      }
      for (const s of specs) {
        if (!defs.has(s.key)) {
          ctx.addIssue({ code: "custom", path: ["products", i], message: `unknown spec ${s.key}` });
        }
      }
      if (p.readiness !== "READY" && specs.length > 0) {
        // held or empty technical sets never carry values into the import
        ctx.addIssue({ code: "custom", path: ["products", i], message: "specs on a held product" });
      }
    });
    m.categories.forEach((c, i) => {
      if (c.parentSlug !== null && !cats.has(c.parentSlug)) {
        ctx.addIssue({ code: "custom", path: ["categories", i], message: "unknown parent" });
      }
    });
  });
export type CatalogMapping = z.infer<typeof CatalogMappingSchema>;

/**
 * DP-158: the verified media manifest (`manifest.json` of the DP-158 download, outside the
 * repository). The media stage of the import reads only these entries. The schema enforces the
 * owner decisions: documents are OTHER (transcribed technical summaries, never TDS or COA),
 * LEAD_REQUIRED and not linked to any site.
 */
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const RelativeFileSchema = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[A-Za-z0-9._/-]+$/)
  .refine(
    (p) => !p.startsWith("/") && !p.split("/").includes(".."),
    "relative path inside the root",
  );

export const MediaImageEntrySchema = z.object({
  kind: z.literal("image"),
  code: ProductCodeSchema,
  file: RelativeFileSchema,
  bytes: z.number().int().positive(),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sha256: Sha256Schema,
  altText: z.string().trim().min(1).max(300),
});
export const MediaPdfEntrySchema = z.object({
  kind: z.literal("pdf"),
  code: ProductCodeSchema,
  file: RelativeFileSchema,
  bytes: z.number().int().positive(),
  mime: z.literal("application/pdf"),
  sha256: Sha256Schema,
  nameOnDocument: z.string().trim().min(1).max(200),
  documentType: z.literal("OTHER"),
  citedSourceDocuments: z.array(z.string().min(1).max(300)).max(20),
  plannedAccessPolicy: z.literal("LEAD_REQUIRED"),
  publishToSite: z.literal(false),
});
export const MediaManifestSchema = z
  .object({
    dp: z.literal("DP-158"),
    files: z
      .array(z.discriminatedUnion("kind", [MediaImageEntrySchema, MediaPdfEntrySchema]))
      .max(1000),
  })
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    m.files.forEach((f, i) => {
      const k = `${f.kind}:${f.code}`;
      if (seen.has(k)) ctx.addIssue({ code: "custom", path: ["files", i], message: `second ${k}` });
      seen.add(k);
    });
  });
export type MediaManifest = z.infer<typeof MediaManifestSchema>;
export type MediaImageEntry = z.infer<typeof MediaImageEntrySchema>;
export type MediaPdfEntry = z.infer<typeof MediaPdfEntrySchema>;
