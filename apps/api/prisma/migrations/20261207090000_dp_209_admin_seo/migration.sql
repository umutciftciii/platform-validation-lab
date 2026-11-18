-- DP-209 (ADR-024 D6): admin-managed SEO of the BV site.
--
-- Runs as dp_owner (ADR-012A). Additive only: nullable columns (one boolean with a default) and
-- CHECK constraints on them. No existing row, role, grant, policy, function or trigger changes;
-- every existing page, revision and listing reads exactly as before (all new fields null/false,
-- which is the DP-207 behaviour).
--
--  * CmsPage / CmsPageRevision: canonical override and Open Graph title, description and image.
--    The revision copies them from the draft at publication; the existing immutability trigger of
--    CmsPageRevision (cms_revision_immutable, all columns) covers the new columns as well.
--  * ProductSiteListing: the product's SEO on a site (title, description, OG title/description,
--    canonical override, noindex, OG image). The API publishes them in the snapshot
--    (ProductPublication.snapshot.seo), so a listing change reaches the site only when the
--    product is published again — the PM-3 model, unchanged.
--  * The site defaults are the CMS fragment `bv.site-seo` (existing table, no change here).
--
-- A canonical override is a path of the same site, never a URL (no scheme, host, query or
-- fragment): at most three lower-case kebab-case segments, app internals refused. The API and
-- @dream/contracts (SeoCanonicalPathSchema) check the same rule; the site checks it again.
--
-- Rollback: roll forward. Dropping the columns loses only DP-209 SEO values; published product
-- snapshots keep their `seo` object, which older code ignores (it was optional from the start).

DO $$
BEGIN
  IF to_regclass('public."CmsPageRevision"') IS NULL THEN
    RAISE EXCEPTION 'DP-209: migration 20261127090000_cms_s2_publication must be applied first';
  END IF;
  IF to_regclass('public."ProductSiteListing"') IS NULL THEN
    RAISE EXCEPTION 'DP-209: migration 20261111140000_pm_1_catalog_foundation must be applied first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- CMS pages and revisions
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "CmsPage"
  ADD COLUMN "canonicalPath" VARCHAR(200),
  ADD COLUMN "ogTitle" VARCHAR(120),
  ADD COLUMN "ogDescription" VARCHAR(320),
  ADD COLUMN "ogImage" VARCHAR(300);

ALTER TABLE "CmsPageRevision"
  ADD COLUMN "canonicalPath" VARCHAR(200),
  ADD COLUMN "ogTitle" VARCHAR(120),
  ADD COLUMN "ogDescription" VARCHAR(320),
  ADD COLUMN "ogImage" VARCHAR(300);

ALTER TABLE "CmsPage"
  ADD CONSTRAINT "CmsPage_seo_canonical_path" CHECK (
    "canonicalPath" IS NULL OR (
      "canonicalPath" ~ '^/([a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*){0,2})?$'
      AND "canonicalPath" !~ '^/(api|lead-form|preview|product-documents|product-images)(/|$)'
    )
  ),
  ADD CONSTRAINT "CmsPage_seo_og_trimmed" CHECK (
    ("ogTitle" IS NULL OR ("ogTitle" = btrim("ogTitle") AND length("ogTitle") >= 1))
    AND ("ogDescription" IS NULL
      OR ("ogDescription" = btrim("ogDescription") AND length("ogDescription") >= 1))
  ),
  ADD CONSTRAINT "CmsPage_seo_og_image" CHECK (
    "ogImage" IS NULL OR "ogImage" ~ '^/media/[A-Za-z0-9._/-]+$'
  );

ALTER TABLE "CmsPageRevision"
  ADD CONSTRAINT "CmsPageRevision_seo_canonical_path" CHECK (
    "canonicalPath" IS NULL OR (
      "canonicalPath" ~ '^/([a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*){0,2})?$'
      AND "canonicalPath" !~ '^/(api|lead-form|preview|product-documents|product-images)(/|$)'
    )
  ),
  ADD CONSTRAINT "CmsPageRevision_seo_og_image" CHECK (
    "ogImage" IS NULL OR "ogImage" ~ '^/media/[A-Za-z0-9._/-]+$'
  );

-- ---------------------------------------------------------------------------------------------
-- Product listings
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "ProductSiteListing"
  ADD COLUMN "seoTitle" VARCHAR(120),
  ADD COLUMN "seoDescription" VARCHAR(320),
  ADD COLUMN "seoOgTitle" VARCHAR(120),
  ADD COLUMN "seoOgDescription" VARCHAR(320),
  ADD COLUMN "seoCanonicalPath" VARCHAR(200),
  ADD COLUMN "seoNoindex" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "seoOgImageId" UUID;

ALTER TABLE "ProductSiteListing"
  ADD CONSTRAINT "ProductSiteListing_seo_trimmed" CHECK (
    ("seoTitle" IS NULL OR ("seoTitle" = btrim("seoTitle") AND length("seoTitle") >= 1))
    AND ("seoDescription" IS NULL
      OR ("seoDescription" = btrim("seoDescription") AND length("seoDescription") >= 1))
    AND ("seoOgTitle" IS NULL OR ("seoOgTitle" = btrim("seoOgTitle") AND length("seoOgTitle") >= 1))
    AND ("seoOgDescription" IS NULL
      OR ("seoOgDescription" = btrim("seoOgDescription") AND length("seoOgDescription") >= 1))
  ),
  ADD CONSTRAINT "ProductSiteListing_seo_canonical_path" CHECK (
    "seoCanonicalPath" IS NULL OR (
      "seoCanonicalPath" ~ '^/([a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*){0,2})?$'
      AND "seoCanonicalPath" !~ '^/(api|lead-form|preview|product-documents|product-images)(/|$)'
    )
  );
