/**
 * DP-157: reads the catalogue through the admin API, plans the import (plan.ts) and, only when
 * asked to apply with the confirmed count of the plan, executes it: definitions, then
 * categories (parents first), then per product the master (DRAFT), its HIDDEN BV listing and
 * its specification values. It stops at the first refused call; what was written is in the
 * report, and a re-run continues idempotently (ALREADY_IMPORTED / PARTIAL).
 */
import type {
  CatalogContextResponse,
  CatalogMapping,
  CategoryListResponse,
  CategoryResponse,
  ListingResponse,
  Product,
  ProductListResponse,
  ProductSpecsResponse,
  SpecDefinitionListResponse,
  SpecValuesSaveRequest,
} from "@dream/contracts";
import { AdminApiError, type AdminApi } from "./client.js";
import { planImport, type CatalogState, type ImportPlan } from "./plan.js";

export interface RunOptions {
  apply: boolean;
  /** Required with apply: must equal the plan's confirmCount. */
  confirm?: number;
  only?: ReadonlySet<string>;
  resumePartial?: boolean;
  log?: (line: string) => void;
}

export interface WriteRecord {
  kind: "definition" | "category" | "product" | "listing" | "specs";
  ref: string;
  id: string | null;
}

export interface ImportReport {
  mode: "dry-run" | "apply";
  site: { key: "BV"; id: string };
  plan: ImportPlan;
  written: WriteRecord[];
  error: string | null;
}

export async function readState(
  api: AdminApi,
  mapping: CatalogMapping,
  resumePartial: boolean,
): Promise<CatalogState> {
  const ctx = await api.get<CatalogContextResponse>("/context");
  const site = ctx.sites.find((s) => s.key === mapping.site);
  if (!site) throw new Error(`the session cannot read the ${mapping.site} catalogue`);
  const [defs, cats] = await Promise.all([
    api.get<SpecDefinitionListResponse>("/spec-definitions"),
    api.get<CategoryListResponse>(`/sites/${site.id}/categories`),
  ]);
  const products: CatalogState["products"] = [];
  for (let page = 1; ; page++) {
    const r = await api.get<ProductListResponse>(
      `/products?siteId=${site.id}&pageSize=100&page=${page}&sort=code`,
    );
    for (const p of r.items) {
      products.push({
        id: p.id,
        code: p.code,
        slug: p.slug,
        name: p.name,
        status: p.status,
        version: p.version,
        listed: p.listing !== null,
      });
    }
    if (page * r.pageSize >= r.total || r.items.length === 0) break;
  }
  const specCounts = new Map<string, number>();
  if (resumePartial) {
    const codes = new Set(mapping.products.map((p) => p.code));
    for (const p of products.filter((x) => codes.has(x.code) && !x.listed)) {
      const s = await api.get<ProductSpecsResponse>(`/products/${p.id}/specs`);
      specCounts.set(p.id, s.values.length);
    }
  }
  return {
    siteId: site.id,
    definitions: defs.items.map((d) => ({
      id: d.id,
      key: d.key,
      dataType: d.dataType,
      units: d.units,
      archived: d.archived,
    })),
    categories: cats.items.map((c) => ({ id: c.id, slug: c.slug, parentId: c.parentId })),
    products,
    specCounts,
  };
}

export async function runImport(
  api: AdminApi,
  mapping: CatalogMapping,
  opts: RunOptions,
): Promise<ImportReport> {
  const log = opts.log ?? (() => {});
  const state = await readState(api, mapping, opts.resumePartial === true);
  const plan = planImport(mapping, state, {
    ...(opts.only ? { only: opts.only } : {}),
    resumePartial: opts.resumePartial === true,
  });
  const report: ImportReport = {
    mode: opts.apply ? "apply" : "dry-run",
    site: { key: "BV", id: state.siteId },
    plan,
    written: [],
    error: null,
  };
  if (!opts.apply) return report;
  if (opts.confirm !== plan.confirmCount) {
    throw new Error(
      `refusing to apply: --confirm ${opts.confirm ?? "(missing)"} does not match the plan ` +
        `(${plan.confirmCount} product(s) to create or resume); run the dry run again`,
    );
  }
  try {
    // 1. definitions
    const defIds = new Map(state.definitions.map((d) => [d.key, d.id]));
    const mappingDefs = new Map(mapping.definitions.map((d) => [d.key, d]));
    for (const d of plan.definitions.filter((x) => x.action === "CREATE")) {
      const m = mappingDefs.get(d.key)!;
      const r = await api.post<{ definition: { id: string } }>("/spec-definitions", {
        key: m.key,
        name: m.name,
        dataType: m.dataType,
        units: m.units,
        testMethods: m.testMethods,
        decimals: m.decimals,
      });
      defIds.set(m.key, r.definition.id);
      report.written.push({ kind: "definition", ref: m.key, id: r.definition.id });
      log(`definition ${m.key} created`);
    }
    // 2. categories (mapping order lists parents first)
    const catIds = new Map(state.categories.map((c) => [c.slug, c.id]));
    const mappingCats = new Map(mapping.categories.map((c) => [c.slug, c]));
    for (const c of plan.categories.filter((x) => x.action === "CREATE")) {
      const m = mappingCats.get(c.slug)!;
      const r = await api.post<CategoryResponse>(`/sites/${state.siteId}/categories`, {
        name: m.name,
        slug: m.slug,
        parentId: m.parentSlug ? (catIds.get(m.parentSlug) ?? null) : null,
        sortOrder: m.sortOrder,
      });
      catIds.set(m.slug, r.category.id);
      report.written.push({ kind: "category", ref: m.slug, id: r.category.id });
      log(`category ${m.slug} created`);
    }
    // 3. products
    const mappingProducts = new Map(mapping.products.map((p) => [p.code, p]));
    for (const p of plan.products) {
      if (p.action !== "CREATE" && p.action !== "RESUME") continue;
      const m = mappingProducts.get(p.code)!;
      let id = p.existingId;
      let version = state.products.find((x) => x.id === id)?.version ?? 1;
      if (p.action === "CREATE") {
        const r = await api.post<{ product: Product }>("/products", {
          code: m.import.master.code,
          slug: m.import.master.slug,
          name: m.import.master.name,
        });
        id = r.product.id;
        version = r.product.version;
        report.written.push({ kind: "product", ref: p.code, id });
      }
      const listing = await api.post<ListingResponse>(`/products/${id}/listings/${state.siteId}`, {
        version: null,
        categoryId: catIds.get(m.import.listing.categorySlug),
        visibility: m.import.listing.visibility,
        sortOrder: m.import.listing.sortOrder,
        title: m.import.listing.texts.en.title,
      });
      report.written.push({ kind: "listing", ref: p.code, id: listing.listing.id });
      if (p.specs > 0) {
        const values: SpecValuesSaveRequest["values"] = m.import.specs.map((s) => ({
          definitionId: defIds.get(s.key)!,
          basis: s.basis,
          value: s.value,
          unit: s.unit,
          testMethod: s.testMethod,
        }));
        await api.post<ProductSpecsResponse>(`/products/${id}/specs`, { version, values });
        report.written.push({ kind: "specs", ref: p.code, id });
      }
      log(`${p.action === "CREATE" ? "created" : "resumed"} ${p.code} (${p.specs} value(s))`);
    }
  } catch (e) {
    report.error = e instanceof AdminApiError || e instanceof Error ? e.message : String(e);
  }
  return report;
}
