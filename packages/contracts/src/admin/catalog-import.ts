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
