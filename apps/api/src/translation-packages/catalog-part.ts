/**
 * ML-13a (DP-244): the catalogue part of a translation package.
 *
 *  - Listing texts (title, summary, description) and their SEO texts of every listing of the site;
 *    the source is what the default-language page shows (own text, else the shared product text,
 *    as translation-state.ts `listingSource`).
 *  - Category names and descriptions of the site (source: the default language).
 *  - Specification names of the definitions the site's products use, and the alt texts of their
 *    public images (platform-wide rows; source: English, the language of those rows, ML-8a).
 *
 * Import writes the same rows as the language tabs of the admin (translations.service.ts): the
 * target language's row, the owner's version + 1, one audit event per row (field names only), and
 * for an alt text the master change the English alt text causes too. Nothing is published.
 * The recorded source revision (ML-8b `sourceHash`, which drives OUTDATED) is set to today's
 * source only when every text of the part that has a value afterwards is verified by this import
 * (or the row already matched today's source); otherwise it stays as it was.
 */
import {
  TRANSLATION_CATALOG_FIELDS,
  parseTranslationUnitKey,
  translationUnitKey,
  type TranslationPackage,
  type TranslationUnit,
  type TranslationUnitKind,
} from "@dream/contracts";
import type { StaffAccess } from "../iam/staff/access.js";
import { changeMaster, type ScopedTx } from "../catalog/master.js";
import { staleVersion } from "../catalog/errors.js";
import { LISTING_TEXT_SELECT } from "../catalog/snapshot.js";
import {
  categoryHash,
  listingSeoHash,
  listingSource,
  listingTextsHash,
  nameHash,
  PLATFORM_SOURCE_LOCALE,
} from "../catalog/translation-state.js";
import type { CmsDb } from "../cms/cms-content.js";
import {
  decideUnit,
  norm,
  normHash,
  textHash,
  textProblem,
  verified,
  writes,
  type UnitDecision,
} from "./units.js";

type Db = CmsDb;
type CatalogKind = Exclude<TranslationUnitKind, "cms">;

export interface CatalogEnv {
  siteId: string;
  defaultLocale: string;
  targetLocale: string;
}

const TEXT_FIELDS = ["title", "summary", "description"] as const;
const SEO_FIELDS = ["seo.title", "seo.description", "seo.ogTitle", "seo.ogDescription"] as const;
const LISTING_COLUMN = {
  title: "title",
  summary: "summary",
  description: "description",
  "seo.title": "seoTitle",
  "seo.description": "seoDescription",
  "seo.ogTitle": "seoOgTitle",
  "seo.ogDescription": "seoOgDescription",
} as const;
type ListingField = keyof typeof LISTING_COLUMN;
type ListingColumn = (typeof LISTING_COLUMN)[ListingField];

interface ListingTextRow {
  locale: string;
  title: string | null;
  summary: string | null;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoOgTitle: string | null;
  seoOgDescription: string | null;
  sourceHash?: string | null;
  seoSourceHash?: string | null;
}

interface ProductRow {
  id: string;
  code: string;
  name: string;
  summary: string | null;
  description: string | null;
  status: string;
}

/** Whether platform-wide names have a source distinct from the target language. */
const platformTexts = (env: CatalogEnv) => env.targetLocale !== PLATFORM_SOURCE_LOCALE;

function limit(kind: CatalogKind, field: string): number {
  return (TRANSLATION_CATALOG_FIELDS[kind] as Record<string, number>)[field] ?? 0;
}
const MULTILINE = new Set([
  "listing:summary",
  "listing:description",
  "listing:seo.description",
  "listing:seo.ogDescription",
  "category:description",
]);

function unit(
  kind: CatalogKind,
  id: string,
  field: string,
  context: string,
  sourceRaw: string | null | undefined,
  currentRaw: string | null | undefined,
): TranslationUnit | null {
  const source = norm(sourceRaw);
  if (source === null) return null;
  const current = norm(currentRaw);
  return {
    key: translationUnitKey(kind, id, field),
    kind,
    context: context.slice(0, 400),
    maxLength: limit(kind, field),
    multiline: MULTILINE.has(`${kind}:${field}`),
    source,
    sourceHash: textHash(source),
    current,
    currentHash: normHash(current),
    target: null,
  };
}

/** The source of every listing field (see the header). */
function listingSourceTexts(product: ProductRow, def: ListingTextRow | undefined) {
  const s = listingSource(product, def as never);
  return {
    title: s.title,
    summary: s.summary,
    description: s.description,
    "seo.title": def?.seoTitle ?? null,
    "seo.description": def?.seoDescription ?? null,
    "seo.ogTitle": def?.seoOgTitle ?? null,
    "seo.ogDescription": def?.seoOgDescription ?? null,
  } satisfies Record<ListingField, string | null>;
}

const byCode =
  (products: Map<string, ProductRow>) => (x: { productId: string }, y: { productId: string }) =>
    (products.get(x.productId)?.code ?? "").localeCompare(products.get(y.productId)?.code ?? "");

async function siteProducts(db: Db, env: CatalogEnv, listingIds?: string[]) {
  const listings = await db.productSiteListing.findMany({
    where: { siteId: env.siteId, ...(listingIds ? { id: { in: listingIds } } : {}) },
    select: {
      id: true,
      productId: true,
      version: true,
      texts: { select: { ...LISTING_TEXT_SELECT, sourceHash: true, seoSourceHash: true } },
    },
  });
  const products = new Map(
    (
      (await db.product.findMany({
        where: { id: { in: listings.map((l) => l.productId) } },
        select: {
          id: true,
          code: true,
          name: true,
          summary: true,
          description: true,
          status: true,
        },
      })) as ProductRow[]
    ).map((p) => [p.id, p]),
  );
  return { listings: [...listings].sort(byCode(products)), products };
}

// --- export -----------------------------------------------------------------------------------

export async function exportCatalog(db: Db, env: CatalogEnv): Promise<TranslationUnit[]> {
  const units: TranslationUnit[] = [];
  const push = (u: TranslationUnit | null) => {
    if (u) units.push(u);
  };
  const { listings, products } = await siteProducts(db, env);
  for (const l of listings) {
    const product = products.get(l.productId);
    if (!product) continue;
    const def = l.texts.find((t) => t.locale === env.defaultLocale);
    const own = l.texts.find((t) => t.locale === env.targetLocale);
    const src = listingSourceTexts(product, def);
    const context = `${product.code} · ${product.name}`;
    for (const field of [...TEXT_FIELDS, ...SEO_FIELDS]) {
      push(unit("listing", l.id, field, context, src[field], own?.[LISTING_COLUMN[field]]));
    }
  }

  const categories = await db.productCategory.findMany({
    where: { siteId: env.siteId },
    orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
    select: { id: true, slug: true },
  });
  const categoryTexts = await db.productCategoryText.findMany({
    where: { siteId: env.siteId, locale: { in: [env.defaultLocale, env.targetLocale] } },
    select: { categoryId: true, locale: true, name: true, description: true },
  });
  for (const c of categories) {
    const def = categoryTexts.find((t) => t.categoryId === c.id && t.locale === env.defaultLocale);
    const own = categoryTexts.find((t) => t.categoryId === c.id && t.locale === env.targetLocale);
    const context = `Category ${c.slug}`;
    push(unit("category", c.id, "name", context, def?.name, own?.name));
    push(unit("category", c.id, "description", context, def?.description, own?.description));
  }

  if (!platformTexts(env)) return units;
  const productIds = listings.map((l) => l.productId);
  const values = productIds.length
    ? await db.productSpecValue.findMany({
        where: { productId: { in: productIds } },
        select: { definitionId: true },
      })
    : [];
  const definitionIds = [...new Set(values.map((v) => v.definitionId))];
  const definitions = definitionIds.length
    ? await db.specDefinition.findMany({
        where: { id: { in: definitionIds } },
        orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
        select: { id: true, key: true },
      })
    : [];
  const specTexts = definitionIds.length
    ? await db.specDefinitionText.findMany({
        where: {
          definitionId: { in: definitionIds },
          locale: { in: [PLATFORM_SOURCE_LOCALE, env.targetLocale] },
        },
        select: { definitionId: true, locale: true, name: true },
      })
    : [];
  for (const d of definitions) {
    const name = (l: string) =>
      specTexts.find((t) => t.definitionId === d.id && t.locale === l)?.name;
    push(
      unit(
        "spec",
        d.id,
        "name",
        `Specification ${d.key}`,
        name(PLATFORM_SOURCE_LOCALE),
        name(env.targetLocale),
      ),
    );
  }

  const images = productIds.length
    ? await db.productImage.findMany({
        where: { productId: { in: productIds }, isPublic: true },
        orderBy: [{ productId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, productId: true, originalFilename: true },
      })
    : [];
  const imageTexts = images.length
    ? await db.productImageText.findMany({
        where: {
          imageId: { in: images.map((i) => i.id) },
          locale: { in: [PLATFORM_SOURCE_LOCALE, env.targetLocale] },
        },
        select: { imageId: true, locale: true, altText: true },
      })
    : [];
  for (const i of [...images].sort(byCode(products))) {
    const alt = (l: string) =>
      imageTexts.find((t) => t.imageId === i.id && t.locale === l)?.altText;
    const product = products.get(i.productId);
    push(
      unit(
        "image",
        i.id,
        "alt",
        `${product?.code ?? ""} · ${i.originalFilename}`,
        alt(PLATFORM_SOURCE_LOCALE),
        alt(env.targetLocale),
      ),
    );
  }
  return units;
}

// --- import plan --------------------------------------------------------------------------------

interface ListingWrite {
  id: string;
  productId: string;
  version: number;
  exists: boolean;
  data: Partial<Record<ListingColumn, string | null>> & {
    sourceHash?: string | null;
    seoSourceHash?: string | null;
  };
  changed: string[];
  checked: ("texts" | "seo")[];
}
interface CategoryWrite {
  id: string;
  version: number;
  name: string;
  description: string | null;
  sourceHash: string | null;
  changed: string[];
}
interface SpecWrite {
  id: string;
  key: string;
  version: number;
  name: string;
}
interface ImageWrite {
  id: string;
  productId: string;
  version: number;
  altText: string;
}

export interface CatalogPlan {
  decisions: Map<string, UnitDecision>;
  listings: ListingWrite[];
  categories: CategoryWrite[];
  specs: SpecWrite[];
  images: ImageWrite[];
}

interface Parsed {
  unit: TranslationUnit;
  kind: CatalogKind;
  id: string;
  field: string;
}

/** What the import of the package's catalogue units would write (reads only). */
export async function planCatalog(
  db: Db,
  env: CatalogEnv,
  pkg: TranslationPackage,
): Promise<CatalogPlan> {
  const plan: CatalogPlan = {
    decisions: new Map(),
    listings: [],
    categories: [],
    specs: [],
    images: [],
  };
  const parsed: Parsed[] = [];
  for (const u of pkg.units) {
    if (u.kind === "cms") continue;
    const k = parseTranslationUnitKey(u.key);
    if (k) parsed.push({ unit: u, kind: u.kind, id: k.id, field: k.field });
  }
  if (parsed.length === 0) return plan;
  const ids = (kind: CatalogKind) => [
    ...new Set(parsed.filter((p) => p.kind === kind).map((p) => p.id)),
  ];
  const decide = (p: Parsed, d: UnitDecision) => plan.decisions.set(p.unit.key, d);
  /** Decides every unit of one resource; `now(field)` gives today's source and target texts. */
  const decideAll = (
    list: Parsed[],
    now: (field: string) => { source: string | null; current: string | null },
  ) => {
    for (const p of list) {
      const target = norm(p.unit.target);
      const { source, current } = now(p.field);
      decide(
        p,
        decideUnit({
          sourceHash: p.unit.sourceHash,
          sourceNow: norm(source),
          target,
          problem: target === null ? null : textProblem(target, limit(p.kind, p.field)),
          currentHash: p.unit.currentHash,
          currentNow: norm(current),
        }),
      );
    }
  };
  const missing = (list: Parsed[]) =>
    list.forEach((p) => decide(p, { status: "not_found", rule: null }));
  const group = (kind: CatalogKind) => {
    const m = new Map<string, Parsed[]>();
    for (const p of parsed.filter((x) => x.kind === kind)) {
      m.set(p.id, [...(m.get(p.id) ?? []), p]);
    }
    return m;
  };
  /** The new value of a field: the translation where it is written, else today's text. */
  const valueAfter = (list: Parsed[], field: string, current: string | null): string | null => {
    const p = list.find((x) => x.field === field);
    return p && writes(plan.decisions.get(p.unit.key)) ? norm(p.unit.target) : current;
  };
  /** Every field with a value afterwards is verified by this import. */
  const allVerified = (
    list: Parsed[],
    fields: readonly string[],
    after: (f: string) => string | null,
  ) =>
    fields.every((f) => {
      if (after(f) === null) return true;
      const p = list.find((x) => x.field === f);
      return p !== undefined && verified(plan.decisions.get(p.unit.key));
    });

  // --- listings ---
  const listingUnits = group("listing");
  if (listingUnits.size) {
    const { listings, products } = await siteProducts(db, env, ids("listing"));
    for (const [id, list] of listingUnits) {
      const l = listings.find((x) => x.id === id);
      const product = l ? products.get(l.productId) : undefined;
      if (!l || !product) {
        missing(list);
        continue;
      }
      const def = l.texts.find((t) => t.locale === env.defaultLocale) as ListingTextRow | undefined;
      const own = l.texts.find((t) => t.locale === env.targetLocale) as ListingTextRow | undefined;
      const src = listingSourceTexts(product, def);
      decideAll(list, (f) => ({
        source: src[f as ListingField] ?? null,
        current: own?.[LISTING_COLUMN[f as ListingField]] ?? null,
      }));
      if (!list.some((p) => writes(plan.decisions.get(p.unit.key)))) continue;
      const data: ListingWrite["data"] = {};
      const changed: string[] = [];
      const after = (f: string) =>
        valueAfter(list, f, own?.[LISTING_COLUMN[f as ListingField]] ?? null);
      for (const f of [...TEXT_FIELDS, ...SEO_FIELDS]) {
        const column = LISTING_COLUMN[f];
        const value = after(f);
        data[column] = value;
        if ((own?.[column] ?? null) !== value) changed.push(column);
      }
      const checked: ListingWrite["checked"] = [];
      const textsHash = listingTextsHash(listingSource(product, def as never));
      if (own?.sourceHash === textsHash || allVerified(list, TEXT_FIELDS, after)) {
        data.sourceHash = textsHash;
        checked.push("texts");
      }
      const seoHash = listingSeoHash(def as never);
      if (own?.seoSourceHash === seoHash || allVerified(list, SEO_FIELDS, after)) {
        data.seoSourceHash = seoHash;
        checked.push("seo");
      }
      if (changed.length === 0) continue;
      plan.listings.push({
        id: l.id,
        productId: l.productId,
        version: l.version,
        exists: own !== undefined,
        data,
        changed,
        checked,
      });
    }
  }

  // --- categories ---
  const categoryUnits = group("category");
  if (categoryUnits.size) {
    const rows = await db.productCategory.findMany({
      where: { siteId: env.siteId, id: { in: ids("category") } },
      select: { id: true, version: true },
    });
    const texts = await db.productCategoryText.findMany({
      where: {
        siteId: env.siteId,
        categoryId: { in: rows.map((r) => r.id) },
        locale: { in: [env.defaultLocale, env.targetLocale] },
      },
      select: { categoryId: true, locale: true, name: true, description: true, sourceHash: true },
    });
    for (const [id, list] of categoryUnits) {
      const c = rows.find((r) => r.id === id);
      if (!c) {
        missing(list);
        continue;
      }
      const def = texts.find((t) => t.categoryId === id && t.locale === env.defaultLocale);
      const own = texts.find((t) => t.categoryId === id && t.locale === env.targetLocale);
      const cur = { name: own?.name ?? null, description: own?.description ?? null };
      decideAll(list, (f) => ({
        source: f === "name" ? (def?.name ?? null) : (def?.description ?? null),
        current: f === "name" ? cur.name : cur.description,
      }));
      const after = (f: string) => valueAfter(list, f, f === "name" ? cur.name : cur.description);
      // A description needs a name in the same language (as the category editor).
      if (after("name") === null && after("description") !== null) {
        for (const p of list) {
          if (p.field === "description" && writes(plan.decisions.get(p.unit.key))) {
            decide(p, { status: "invalid", rule: "name_required" });
          }
        }
      }
      if (!list.some((p) => writes(plan.decisions.get(p.unit.key)))) continue;
      const name = after("name");
      const description = after("description");
      if (name === null) continue;
      const hash = categoryHash(def ?? undefined);
      const changed = (["name", "description"] as const).filter(
        (k) => cur[k] !== (k === "name" ? name : description),
      );
      if (changed.length === 0) continue;
      plan.categories.push({
        id,
        version: c.version,
        name,
        description,
        sourceHash:
          own?.sourceHash === hash || allVerified(list, ["name", "description"], after)
            ? hash
            : (own?.sourceHash ?? null),
        changed,
      });
    }
  }

  // --- specification names ---
  const specUnits = group("spec");
  if (specUnits.size) {
    const defs = await db.specDefinition.findMany({
      where: { id: { in: ids("spec") } },
      select: { id: true, key: true, version: true },
    });
    const texts = await db.specDefinitionText.findMany({
      where: {
        definitionId: { in: defs.map((d) => d.id) },
        locale: { in: [PLATFORM_SOURCE_LOCALE, env.targetLocale] },
      },
      select: { definitionId: true, locale: true, name: true },
    });
    for (const [id, list] of specUnits) {
      const d = defs.find((x) => x.id === id);
      if (!d || !platformTexts(env)) {
        missing(list);
        continue;
      }
      const name = (l: string) =>
        texts.find((t) => t.definitionId === id && t.locale === l)?.name ?? null;
      decideAll(list, () => ({
        source: name(PLATFORM_SOURCE_LOCALE),
        current: name(env.targetLocale),
      }));
      const p = list[0];
      if (p && writes(plan.decisions.get(p.unit.key))) {
        plan.specs.push({
          id,
          key: d.key,
          version: d.version,
          name: norm(p.unit.target) as string,
        });
      }
    }
  }

  // --- image alt texts ---
  const imageUnits = group("image");
  if (imageUnits.size) {
    const images = await db.productImage.findMany({
      where: { id: { in: ids("image") } },
      select: { id: true, productId: true, version: true },
    });
    // Only images of products listed on the package's site.
    const onSite = new Set(
      (
        await db.productSiteListing.findMany({
          where: { siteId: env.siteId, productId: { in: images.map((i) => i.productId) } },
          select: { productId: true },
        })
      ).map((l) => l.productId),
    );
    const archived = new Set(
      (
        await db.product.findMany({
          where: { id: { in: [...onSite] }, status: "ARCHIVED" },
          select: { id: true },
        })
      ).map((p) => p.id),
    );
    const texts = await db.productImageText.findMany({
      where: {
        imageId: { in: images.map((i) => i.id) },
        locale: { in: [PLATFORM_SOURCE_LOCALE, env.targetLocale] },
      },
      select: { imageId: true, locale: true, altText: true },
    });
    for (const [id, list] of imageUnits) {
      const img = images.find((i) => i.id === id);
      if (!img || !onSite.has(img.productId) || !platformTexts(env)) {
        missing(list);
        continue;
      }
      const alt = (l: string) =>
        texts.find((t) => t.imageId === id && t.locale === l)?.altText ?? null;
      decideAll(list, () => ({
        source: alt(PLATFORM_SOURCE_LOCALE),
        current: alt(env.targetLocale),
      }));
      const p = list[0];
      if (!p || !writes(plan.decisions.get(p.unit.key))) continue;
      if (archived.has(img.productId)) {
        // An archived product's master cannot change (images.service.ts, changeMaster).
        decide(p, { status: "conflict", rule: "archived" });
        continue;
      }
      plan.images.push({
        id,
        productId: img.productId,
        version: img.version,
        altText: norm(p.unit.target) as string,
      });
    }
  }
  return plan;
}

// --- import -------------------------------------------------------------------------------------

export async function applyCatalog(
  tx: ScopedTx,
  a: StaffAccess,
  env: CatalogEnv,
  plan: CatalogPlan,
  o: { digest: string },
): Promise<{ listings: number; categories: number; specs: number; images: number }> {
  const origin = { origin: "translation_package", digest: o.digest };
  for (const l of plan.listings) {
    const res = await tx.productSiteListing.updateMany({
      where: { id: l.id, siteId: env.siteId, version: l.version },
      data: { version: { increment: 1 } },
    });
    if (res.count !== 1) throw staleVersion();
    if (l.exists) {
      await tx.productListingText.update({
        where: { listingId_locale: { listingId: l.id, locale: env.targetLocale } },
        data: l.data,
      });
    } else {
      await tx.productListingText.create({
        data: { listingId: l.id, siteId: env.siteId, locale: env.targetLocale, ...l.data },
      });
    }
    await a.audit(tx, {
      action: "catalog.listing_translation_updated",
      resourceType: "product_listing",
      resourceId: l.id,
      siteId: env.siteId,
      permission: "product:edit",
      metadata: {
        productId: l.productId,
        locale: env.targetLocale,
        changed: l.changed,
        checked: l.checked,
        version: l.version + 1,
        ...origin,
      },
    });
  }
  for (const c of plan.categories) {
    const res = await tx.productCategory.updateMany({
      where: { id: c.id, siteId: env.siteId, version: c.version },
      data: { version: { increment: 1 } },
    });
    if (res.count !== 1) throw staleVersion();
    const data = { name: c.name, description: c.description, sourceHash: c.sourceHash };
    await tx.productCategoryText.upsert({
      where: { categoryId_locale: { categoryId: c.id, locale: env.targetLocale } },
      create: { categoryId: c.id, siteId: env.siteId, locale: env.targetLocale, ...data },
      update: data,
    });
    await a.audit(tx, {
      action: "catalog.category_translation_updated",
      resourceType: "product_category",
      resourceId: c.id,
      siteId: env.siteId,
      permission: "product:edit",
      metadata: {
        locale: env.targetLocale,
        changed: c.changed,
        removed: false,
        version: c.version + 1,
        ...origin,
      },
    });
  }
  for (const s of plan.specs) {
    const res = await tx.specDefinition.updateMany({
      where: { id: s.id, version: s.version },
      data: { version: { increment: 1 } },
    });
    if (res.count !== 1) throw staleVersion();
    const source = await tx.specDefinitionText.findUnique({
      where: { definitionId_locale: { definitionId: s.id, locale: PLATFORM_SOURCE_LOCALE } },
      select: { name: true },
    });
    const data = { name: s.name, sourceHash: nameHash(source?.name) };
    await tx.specDefinitionText.upsert({
      where: { definitionId_locale: { definitionId: s.id, locale: env.targetLocale } },
      create: { definitionId: s.id, locale: env.targetLocale, ...data },
      update: data,
    });
    await a.audit(tx, {
      action: "catalog.spec_definition_translation_updated",
      resourceType: "spec_definition",
      resourceId: s.id,
      siteId: null,
      permission: "product_master:edit",
      metadata: {
        key: s.key,
        locale: env.targetLocale,
        changed: ["name"],
        version: s.version + 1,
        ...origin,
      },
    });
  }
  for (const i of plan.images) {
    // Like the English alt text (images.service.ts): a changed text is a master change.
    await changeMaster(tx, a, i.productId, { cause: "image_updated" });
    const res = await tx.productImage.updateMany({
      where: { id: i.id, version: i.version },
      data: { version: { increment: 1 } },
    });
    if (res.count !== 1) throw staleVersion();
    const source = await tx.productImageText.findUnique({
      where: { imageId_locale: { imageId: i.id, locale: PLATFORM_SOURCE_LOCALE } },
      select: { altText: true },
    });
    const data = { altText: i.altText, sourceHash: nameHash(source?.altText) };
    await tx.productImageText.upsert({
      where: { imageId_locale: { imageId: i.id, locale: env.targetLocale } },
      create: { imageId: i.id, locale: env.targetLocale, ...data },
      update: data,
    });
    await a.audit(tx, {
      action: "catalog.image_translation_updated",
      resourceType: "product_image",
      resourceId: i.id,
      siteId: null,
      permission: "product_master:edit",
      metadata: {
        productId: i.productId,
        locale: env.targetLocale,
        changed: ["altText"],
        version: i.version + 1,
        ...origin,
      },
    });
  }
  return {
    listings: plan.listings.length,
    categories: plan.categories.length,
    specs: plan.specs.length,
    images: plan.images.length,
  };
}
