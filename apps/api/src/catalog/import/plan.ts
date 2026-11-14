/**
 * DP-157: the import plan, a pure function of the mapping file and the catalogue as the admin
 * API reports it. Nothing here writes; the dry run prints this plan and the apply run executes
 * exactly it. Rules (owner decisions 2026-11-14):
 *
 *  - a product whose code or slug already exists is never changed: same code, slug and name with
 *    a BV listing is ALREADY_IMPORTED (re-running is a no-op); same code, slug and name without a
 *    listing is PARTIAL (an interrupted earlier run; only `resumePartial` completes it, and only
 *    when it has no specification values); any other match is a CONFLICT, reported and skipped;
 *  - a specification definition is reused when its key exists with the same data type, accepts
 *    every unit the mapping uses and is not archived; otherwise the whole technical set of every
 *    product using it is skipped (never a partial set) and reported;
 *  - a category is reused when its slug exists under the same parent; otherwise the products in
 *    it are skipped and reported. Missing categories are created parents first;
 *  - products are created DRAFT with a HIDDEN BV listing (the mapping schema allows nothing
 *    else); images and documents are not part of the import.
 */
import type {
  CatalogMapping,
  MappingCategory,
  MappingDefinition,
  MappingProduct,
  SpecDataType,
} from "@dream/contracts";

export interface ExistingDefinition {
  id: string;
  key: string;
  dataType: SpecDataType;
  units: string[];
  archived: boolean;
}
export interface ExistingCategory {
  id: string;
  slug: string;
  parentId: string | null;
}
export interface ExistingProduct {
  id: string;
  code: string;
  slug: string;
  name: string;
  status: string;
  version: number;
  /** The BV listing exists. */
  listed: boolean;
}
export interface CatalogState {
  siteId: string;
  definitions: ExistingDefinition[];
  categories: ExistingCategory[];
  products: ExistingProduct[];
  /** Number of specification values per existing product id (only asked for PARTIAL ones). */
  specCounts?: ReadonlyMap<string, number>;
}

export type ProductAction = "CREATE" | "RESUME" | "ALREADY_IMPORTED" | "PARTIAL" | "CONFLICT";

export interface PlannedProduct {
  code: string;
  slug: string;
  name: string;
  readiness: MappingProduct["readiness"];
  action: ProductAction;
  /** Why it is not created (CONFLICT, PARTIAL, ALREADY_IMPORTED) or why specs are skipped. */
  reasons: string[];
  existingId: string | null;
  categorySlug: string;
  /** Values that will be written (0 when skipped). */
  specs: number;
  specsSkipped: number;
}

export interface PlannedDefinition {
  key: string;
  action: "CREATE" | "REUSE" | "CONFLICT";
  reason: string | null;
  existingId: string | null;
}
export interface PlannedCategory {
  slug: string;
  action: "CREATE" | "REUSE" | "CONFLICT";
  reason: string | null;
  existingId: string | null;
}

export interface ImportPlan {
  definitions: PlannedDefinition[];
  categories: PlannedCategory[];
  products: PlannedProduct[];
  counts: {
    products: number;
    create: number;
    resume: number;
    alreadyImported: number;
    partial: number;
    conflict: number;
    specValues: number;
    specValuesSkipped: number;
    definitionsToCreate: number;
    categoriesToCreate: number;
  };
  /** The number an apply run must be confirmed with: products it will create or resume. */
  confirmCount: number;
}

function definitionPlan(
  d: MappingDefinition,
  usedUnits: ReadonlySet<string>,
  existing: ExistingDefinition | undefined,
): PlannedDefinition {
  if (!existing) return { key: d.key, action: "CREATE", reason: null, existingId: null };
  const problems: string[] = [];
  if (existing.dataType !== d.dataType) {
    problems.push(`existing data type ${existing.dataType}, mapping ${d.dataType}`);
  }
  const missing = [...usedUnits].filter((u) => !existing.units.includes(u));
  if (missing.length) problems.push(`existing units do not accept ${missing.join(", ")}`);
  if (existing.archived) problems.push("existing definition is archived");
  return problems.length
    ? { key: d.key, action: "CONFLICT", reason: problems.join("; "), existingId: existing.id }
    : { key: d.key, action: "REUSE", reason: null, existingId: existing.id };
}

function categoryPlans(
  mapping: readonly MappingCategory[],
  existing: readonly ExistingCategory[],
): PlannedCategory[] {
  const bySlug = new Map(existing.map((c) => [c.slug, c]));
  const byId = new Map(existing.map((c) => [c.id, c]));
  const out = new Map<string, PlannedCategory>();
  for (const c of mapping) {
    const have = bySlug.get(c.slug);
    const parentPlan = c.parentSlug ? out.get(c.parentSlug) : undefined;
    if (parentPlan?.action === "CONFLICT") {
      out.set(c.slug, {
        slug: c.slug,
        action: "CONFLICT",
        reason: `parent ${c.parentSlug} is in conflict`,
        existingId: have?.id ?? null,
      });
      continue;
    }
    if (!have) {
      out.set(c.slug, { slug: c.slug, action: "CREATE", reason: null, existingId: null });
      continue;
    }
    const haveParent = have.parentId ? (byId.get(have.parentId)?.slug ?? "?") : null;
    out.set(
      c.slug,
      haveParent === c.parentSlug
        ? { slug: c.slug, action: "REUSE", reason: null, existingId: have.id }
        : {
            slug: c.slug,
            action: "CONFLICT",
            reason: `existing category has parent ${haveParent ?? "(none)"}, mapping ${c.parentSlug ?? "(none)"}`,
            existingId: have.id,
          },
    );
  }
  return [...out.values()];
}

export function planImport(
  mapping: CatalogMapping,
  state: CatalogState,
  options: { only?: ReadonlySet<string>; resumePartial?: boolean } = {},
): ImportPlan {
  const products = mapping.products.filter((p) => !options.only || options.only.has(p.code));
  const usedUnits = new Map<string, Set<string>>();
  for (const p of products) {
    for (const s of p.import.specs) {
      const set = usedUnits.get(s.key) ?? new Set<string>();
      if (s.unit) set.add(s.unit);
      usedUnits.set(s.key, set);
    }
  }
  const usedKeys = new Set(usedUnits.keys());
  const existingDefs = new Map(state.definitions.map((d) => [d.key, d]));
  const definitions = mapping.definitions
    .filter((d) => usedKeys.has(d.key))
    .map((d) => definitionPlan(d, usedUnits.get(d.key) ?? new Set(), existingDefs.get(d.key)));
  const defConflict = new Map(
    definitions.filter((d) => d.action === "CONFLICT").map((d) => [d.key, d.reason]),
  );

  const neededCategories = new Set<string>();
  const parents = new Map(mapping.categories.map((c) => [c.slug, c.parentSlug]));
  for (const p of products) {
    let slug: string | null = p.import.listing.categorySlug;
    while (slug) {
      neededCategories.add(slug);
      slug = parents.get(slug) ?? null;
    }
  }
  const categories = categoryPlans(
    mapping.categories.filter((c) => neededCategories.has(c.slug)),
    state.categories,
  );
  const catPlan = new Map(categories.map((c) => [c.slug, c]));

  const byCode = new Map(state.products.map((p) => [p.code, p]));
  const bySlug = new Map(state.products.map((p) => [p.slug, p]));
  const planned: PlannedProduct[] = products.map((p) => {
    const base = {
      code: p.code,
      slug: p.slug,
      name: p.name,
      readiness: p.readiness,
      categorySlug: p.import.listing.categorySlug,
    };
    const c = byCode.get(p.code);
    const s = bySlug.get(p.slug);
    const total = p.import.specs.length;
    if (c || s) {
      const same = c && s && c.id === s.id && c.name === p.name;
      if (!same) {
        const reasons = [
          c && c.slug !== p.slug ? `code ${p.code} exists with slug ${c.slug}` : null,
          s && s.code !== p.code ? `slug ${p.slug} exists with code ${s.code}` : null,
          c && c.slug === p.slug && c.name !== p.name ? `exists with name "${c.name}"` : null,
        ].filter((r): r is string => r !== null);
        return {
          ...base,
          action: "CONFLICT",
          reasons,
          existingId: (c ?? s)!.id,
          specs: 0,
          specsSkipped: total,
        };
      }
      if (c.listed) {
        return {
          ...base,
          action: "ALREADY_IMPORTED",
          reasons: ["product and BV listing exist; left unchanged"],
          existingId: c.id,
          specs: 0,
          specsSkipped: 0,
        };
      }
      const values = state.specCounts?.get(c.id);
      const resumable = options.resumePartial === true && c.status === "DRAFT" && values === 0;
      if (!resumable) {
        return {
          ...base,
          action: "PARTIAL",
          reasons: [
            "product exists without a BV listing (interrupted earlier run?)",
            options.resumePartial
              ? `not resumable: status ${c.status}, ${values ?? "unknown"} specification value(s)`
              : "re-run with --resume-partial to add the listing and specifications",
          ],
          existingId: c.id,
          specs: 0,
          specsSkipped: total,
        };
      }
    }
    const reasons: string[] = [];
    const cat = catPlan.get(p.import.listing.categorySlug);
    if (!cat || cat.action === "CONFLICT") {
      return {
        ...base,
        action: "CONFLICT",
        reasons: [`category ${p.import.listing.categorySlug}: ${cat?.reason ?? "missing"}`],
        existingId: c?.id ?? null,
        specs: 0,
        specsSkipped: total,
      };
    }
    const blocked = [...new Set(p.import.specs.map((x) => x.key))].filter((k) =>
      defConflict.has(k),
    );
    if (blocked.length) {
      reasons.push(
        `technical set skipped: definition ${blocked.map((k) => `${k} (${defConflict.get(k)})`).join(", ")}`,
      );
    }
    const write = blocked.length ? 0 : total;
    return {
      ...base,
      action: c ? "RESUME" : "CREATE",
      reasons,
      existingId: c?.id ?? null,
      specs: write,
      specsSkipped: total - write,
    };
  });

  // Create only what the products that will be written need (a re-run creates nothing).
  const active = planned.filter((p) => p.action === "CREATE" || p.action === "RESUME");
  const byCodeMapping = new Map(products.map((p) => [p.code, p]));
  const activeKeys = new Set(
    active
      .filter((p) => p.specs > 0)
      .flatMap((p) => byCodeMapping.get(p.code)!.import.specs.map((x) => x.key)),
  );
  const activeCats = new Set<string>();
  for (const p of active) {
    let slug: string | null = p.categorySlug;
    while (slug) {
      activeCats.add(slug);
      slug = parents.get(slug) ?? null;
    }
  }
  const definitionsOut = definitions.filter((d) => d.action !== "CREATE" || activeKeys.has(d.key));
  const categoriesOut = categories.filter((c) => c.action !== "CREATE" || activeCats.has(c.slug));

  const count = (a: ProductAction) => planned.filter((p) => p.action === a).length;
  const counts = {
    products: planned.length,
    create: count("CREATE"),
    resume: count("RESUME"),
    alreadyImported: count("ALREADY_IMPORTED"),
    partial: count("PARTIAL"),
    conflict: count("CONFLICT"),
    specValues: planned.reduce((n, p) => n + p.specs, 0),
    specValuesSkipped: planned.reduce((n, p) => n + p.specsSkipped, 0),
    definitionsToCreate: definitionsOut.filter((d) => d.action === "CREATE").length,
    categoriesToCreate: categoriesOut.filter((c) => c.action === "CREATE").length,
  };
  return {
    definitions: definitionsOut,
    categories: categoriesOut,
    products: planned,
    counts,
    confirmCount: counts.create + counts.resume,
  };
}
