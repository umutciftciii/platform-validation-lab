// ML-8a (ADR-028 D8, R-38): read-only check of the catalogue's English output on a database with
// migration 39 (a restore of DEV, later DEV itself after its own approval). Never writes: every
// query runs in one READ ONLY transaction.
//
//   cd apps/api && pnpm run build && \
//     CHECK_DATABASE_URL=postgresql://… node test/tools/ml8a-snapshot-check.mjs > report.json
//
// For every listing of every site (published or not) it builds
//   (a) the v1 snapshot exactly as WorkflowService.publish did before ML-8a (English columns,
//       listing SEO columns), and
//   (b) the v2 snapshot as the ML-8a publication builds it (per-language rows) and its view in
//       the site's default language,
// and compares them byte for byte (JSON). For every stored publication it compares the public
// output (product page and list entry) of the reader of before ML-8a with the ML-8a reader, and
// reports whether a republication now would change the English content (it must not, unless the
// master or listing moved on since the publication). Exit code 1 when any English output differs.
import { PrismaPg } from "@prisma/adapter-pg";
import {
  localizeSnapshot,
  PublishedSnapshotV1Schema,
  readSnapshot,
  toPublicProduct,
  toPublicSummary,
} from "@dream/contracts";
import { PrismaClient } from "../../dist/generated/prisma/client.js";
import { buildSnapshotV2, catalogLocales, displaySize } from "../../dist/catalog/snapshot.js";

const url = process.env.CHECK_DATABASE_URL;
if (!url) throw new Error("CHECK_DATABASE_URL is required");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const num = (d) => (d === null ? null : Number(d.toString()));
/** specs.service.ts valueData (copied: the service module needs the Nest runtime). */
function valueData(v) {
  if (v.numberValue !== null) return { type: "NUMBER", number: num(v.numberValue) };
  if (v.rangeMin !== null || v.rangeMax !== null) {
    return {
      type: "RANGE",
      min: num(v.rangeMin),
      max: num(v.rangeMax),
      minExclusive: v.rangeMinExclusive,
      maxExclusive: v.rangeMaxExclusive,
    };
  }
  if (v.textValue !== null) return { type: "TEXT", text: v.textValue };
  return { type: "BOOLEAN", boolean: v.booleanValue };
}

/** The v1 builder of WorkflowService.publish before ML-8a (0c81985). */
function legacyV1({ product, listing, text, category, values, defsById, images }) {
  return PublishedSnapshotV1Schema.parse({
    schemaVersion: 1,
    slug: product.slug,
    code: product.code,
    name: text?.title ?? product.name,
    summary: text?.summary ?? product.summary,
    description: text?.description ?? product.description,
    category: { slug: category.slug, name: category.name },
    sortOrder: listing.sortOrder,
    specs: values
      .map((v) => ({ v, d: defsById.get(v.definitionId) }))
      .filter((x) => !!x.d)
      .sort(
        (x, y) =>
          x.d.sortOrder - y.d.sortOrder ||
          x.d.name.localeCompare(y.d.name) ||
          (x.v.basis === y.v.basis ? 0 : x.v.basis === "SPECIFICATION" ? -1 : 1),
      )
      .map(({ v, d }) => ({
        key: d.key,
        name: d.name,
        basis: v.basis,
        value: valueData(v),
        unit: v.unit,
        testMethod: v.testMethod,
      })),
    images: images.map((i) => ({
      id: i.id,
      altText: i.altText,
      isCover: i.isCover,
      ...displaySize(i.variants),
    })),
    seo: {
      title: listing.seoTitle,
      description: listing.seoDescription,
      ogTitle: listing.seoOgTitle,
      ogDescription: listing.seoOgDescription,
      canonicalPath: listing.seoCanonicalPath,
      noindex: listing.seoNoindex,
      ogImageId: images.some((i) => i.id === listing.seoOgImageId) ? listing.seoOgImageId : null,
    },
  });
}

const report = { listings: [], publications: [], totals: {} };
let failures = 0;
await db.$transaction(
  async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const [
      sites,
      siteLocales,
      products,
      listings,
      categories,
      catTexts,
      defs,
      defTexts,
      values,
      images,
      imgTexts,
      pubs,
    ] = await Promise.all([
      tx.site.findMany({ select: { id: true, key: true } }),
      tx.siteLocale.findMany(),
      tx.product.findMany(),
      tx.productSiteListing.findMany({ include: { texts: true } }),
      tx.productCategory.findMany(),
      tx.productCategoryText.findMany(),
      tx.specDefinition.findMany(),
      tx.specDefinitionText.findMany(),
      tx.productSpecValue.findMany(),
      tx.productImage.findMany({
        where: { isPublic: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      tx.productImageText.findMany(),
      tx.productPublication.findMany(),
    ]);
    const defsById = new Map(defs.map((d) => [d.id, d]));
    const at = "2026-01-01T00:00:00.000Z";
    for (const l of listings) {
      const product = products.find((p) => p.id === l.productId);
      const category = categories.find((c) => c.id === l.categoryId);
      const site = sites.find((s) => s.id === l.siteId);
      const { defaultLocale, locales } = catalogLocales(
        siteLocales.filter((x) => x.siteId === l.siteId),
      );
      const text = l.texts.find((t) => t.locale === defaultLocale) ?? null;
      const vals = values.filter((v) => v.productId === product.id);
      const imgs = images.filter((i) => i.productId === product.id);
      const before = legacyV1({
        product,
        listing: l,
        text,
        category,
        values: vals,
        defsById,
        images: imgs,
      });
      const v2 = buildSnapshotV2({
        defaultLocale,
        locales,
        product,
        listing: l,
        listingTexts: l.texts,
        category,
        categoryTexts: catTexts.filter((t) => t.categoryId === category.id),
        specs: vals
          .filter((v) => defsById.has(v.definitionId))
          .map((v) => {
            const d = defsById.get(v.definitionId);
            return {
              definitionId: d.id,
              key: d.key,
              sortOrder: d.sortOrder,
              basis: v.basis,
              value: valueData(v),
              unit: v.unit,
              testMethod: v.testMethod,
            };
          }),
        specTexts: defTexts,
        images: imgs.map((i) => ({ id: i.id, isCover: i.isCover, ...displaySize(i.variants) })),
        imageTexts: imgTexts,
      });
      const after = localizeSnapshot(v2, defaultLocale);
      const same = JSON.stringify(after) === JSON.stringify(before);
      const samePublic =
        JSON.stringify(toPublicProduct(after, at)) ===
          JSON.stringify(toPublicProduct(before, at)) &&
        JSON.stringify(toPublicSummary(after, at)) === JSON.stringify(toPublicSummary(before, at));
      if (!same || !samePublic) failures++;
      report.listings.push({
        site: site.key,
        code: product.code,
        status: product.status,
        visibility: l.visibility,
        identical: same,
        publicIdentical: samePublic,
        locales: Object.keys(v2.locales),
      });
    }
    for (const p of pubs) {
      const product = products.find((x) => x.id === p.productId);
      const listing = listings.find((x) => x.id === p.listingId);
      const site = sites.find((s) => s.id === p.siteId);
      const { defaultLocale } = catalogLocales(siteLocales.filter((x) => x.siteId === p.siteId));
      const old = PublishedSnapshotV1Schema.safeParse(p.snapshot);
      const now = readSnapshot(p.snapshot, defaultLocale);
      const at2 = p.publishedAt.toISOString();
      const readerIdentical =
        old.success &&
        now !== null &&
        JSON.stringify(toPublicProduct(now, at2)) ===
          JSON.stringify(toPublicProduct(old.data, at2)) &&
        JSON.stringify(toPublicSummary(now, at2)) ===
          JSON.stringify(toPublicSummary(old.data, at2));
      if (!readerIdentical) failures++;
      const entry = report.listings.find((x) => x.site === site.key && x.code === product.code);
      const upToDate = p.productVersion === product.version && p.listingVersion === listing.version;
      // What a republication now would show in English, against what is live.
      const textNow = listing.texts.find((t) => t.locale === defaultLocale) ?? null;
      const rebuilt = legacyV1({
        product,
        listing,
        text: textNow,
        category: categories.find((c) => c.id === listing.categoryId),
        values: values.filter((v) => v.productId === product.id),
        defsById,
        images: images.filter((i) => i.productId === product.id),
      });
      report.publications.push({
        site: site.key,
        code: product.code,
        status: p.status,
        schemaVersion: p.snapshot?.schemaVersion ?? null,
        readerIdentical,
        builderIdentical: entry?.identical ?? null,
        upToDate,
        republishWouldChangeEnglish: old.success
          ? JSON.stringify(rebuilt) !== JSON.stringify(old.data)
          : null,
        // the same on the public output (product page and list entry), the visitor's view
        republishWouldChangePublicEnglish: old.success
          ? JSON.stringify(toPublicProduct(rebuilt, at2)) !==
              JSON.stringify(toPublicProduct(old.data, at2)) ||
            JSON.stringify(toPublicSummary(rebuilt, at2)) !==
              JSON.stringify(toPublicSummary(old.data, at2))
          : null,
        snapshotWithoutSeo: old.success ? old.data.seo === undefined : null,
      });
    }
  },
  { timeout: 120_000 },
);
report.totals = {
  listings: report.listings.length,
  listingsIdentical: report.listings.filter((x) => x.identical && x.publicIdentical).length,
  listingsWithOtherLocales: report.listings.filter((x) => x.locales.length > 1).length,
  publications: report.publications.length,
  publicationsReaderIdentical: report.publications.filter((x) => x.readerIdentical).length,
  publicationsUpToDate: report.publications.filter((x) => x.upToDate).length,
  republishWouldChangeEnglish: report.publications.filter((x) => x.republishWouldChangeEnglish)
    .length,
  republishWouldChangePublicEnglish: report.publications.filter(
    (x) => x.republishWouldChangePublicEnglish,
  ).length,
  publicationsWithoutSeo: report.publications.filter((x) => x.snapshotWithoutSeo).length,
  failures,
};
await db.$disconnect();
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.exitCode = failures ? 1 : 0;
