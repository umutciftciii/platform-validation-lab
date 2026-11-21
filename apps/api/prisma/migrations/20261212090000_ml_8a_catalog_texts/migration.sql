-- ML-8a (DP-239, DP-214, ADR-028 D8): catalogue texts per language.
--
-- Runs as dp_owner (ADR-012A). Additive only: three new tables, four new nullable columns, two
-- foreign keys to "SiteLocale", an English backfill and synchronisation triggers. No existing
-- column is dropped, renamed or retyped; no existing row changes in an existing column.
--
--  * "ProductCategoryText" (category, locale): name, description. Site-bound (site scope).
--  * "SpecDefinitionText" (definition, locale): name. Platform-wide.
--  * "ProductImageText" (image, locale): alt text (null: none in this language). Platform-wide.
--  * "ProductListingText" gains the SEO texts seoTitle, seoDescription, seoOgTitle,
--    seoOgDescription (DP-214). Canonical path, noindex and OG image stay on the listing.
--  * "ProductListingText" and "ProductCategoryText" reference "SiteLocale" (siteId, locale): a
--    text is written in a language of its site.
--
-- English backfill: every category, every specification definition and every image with an alt
-- text gets its "en" row from today's columns; every existing "en" listing text gets the
-- listing's SEO texts; a listing with SEO texts but no "en" text row gets one (title, summary and
-- description null, as the listing had none).
--
-- The English columns of before ML-8a ("ProductCategory".name/description,
-- "SpecDefinition".name, "ProductImage"."altText", "ProductSiteListing".seo*) are KEPT for one
-- release (DP-254 drops them). Triggers keep them equal to the "en" rows in both directions, so
-- the API of before ML-8a and a rollback to it lose nothing. "en" is the language of those
-- columns (they were English only), not a choice of the site.
--
-- Rollback (lossless for English: the English columns hold every English text; translations in
-- other languages are removed, there were none before ML-8a). English listing-text rows the
-- backfill or the SEO sync created have null title, summary and description, which the code of
-- before ML-8a treats like a missing row, so they stay:
--   DROP TRIGGER "ProductCategory_texts_en" ON "ProductCategory";
--   DROP TRIGGER "ProductCategoryText_legacy_en" ON "ProductCategoryText";
--   DROP TRIGGER "ProductCategoryText_keep_en" ON "ProductCategoryText";
--   DROP TRIGGER "SpecDefinition_texts_en" ON "SpecDefinition";
--   DROP TRIGGER "SpecDefinitionText_legacy_en" ON "SpecDefinitionText";
--   DROP TRIGGER "SpecDefinitionText_keep_en" ON "SpecDefinitionText";
--   DROP TRIGGER "ProductImage_texts_en" ON "ProductImage";
--   DROP TRIGGER "ProductImageText_legacy_en" ON "ProductImageText";
--   DROP TRIGGER "ProductImageText_keep_en" ON "ProductImageText";
--   DROP TRIGGER "ProductSiteListing_seo_en" ON "ProductSiteListing";
--   DROP TRIGGER "ProductListingText_seo_legacy_en" ON "ProductListingText";
--   DROP FUNCTION catalog_category_texts_en(), catalog_category_text_legacy_en(), catalog_spec_texts_en(), catalog_spec_text_legacy_en(), catalog_image_texts_en(), catalog_image_text_legacy_en(), catalog_listing_seo_en(), catalog_listing_text_seo_legacy_en(), catalog_text_keep_en();
--   DROP TABLE "ProductCategoryText", "SpecDefinitionText", "ProductImageText";
--   DELETE FROM "ProductListingText" WHERE "locale" <> 'en';
--   ALTER TABLE "ProductListingText" DROP CONSTRAINT "ProductListingText_siteId_locale_fkey", DROP CONSTRAINT "ProductListingText_seo_trimmed", DROP COLUMN "seoTitle", DROP COLUMN "seoDescription", DROP COLUMN "seoOgTitle", DROP COLUMN "seoOgDescription";
--   (and remove the row of this migration from "_prisma_migrations")
-- ML-2 (38) and ML-1 (37) can be rolled back only after this one (foreign keys to "SiteLocale").
-- Rehearsed on an isolated restore of DEV (apply → rollback → apply): see the ML-8a report.
--
-- Part 1 matches `prisma migrate diff --from-schema <main> --to-schema schema.prisma`; Part 2 adds
-- the rules Prisma cannot model. test/integration/catalog-workflow.int.test.ts (section 17) covers
-- each rule; cms.int.test.ts (section 21) rehearses this rollback before ML-2 and ML-1.

-- ===========================================================================================
-- Part 0: preconditions
-- ===========================================================================================

DO $$
BEGIN
  IF to_regclass('public."SiteLocale"') IS NULL THEN
    RAISE EXCEPTION 'ML-8a: SiteLocale missing; migration 20261210090000_ml_1_site_locales must be applied first';
  END IF;
  -- Every listing text is written in a language of its site (the new foreign key).
  IF EXISTS (
    SELECT 1 FROM "ProductListingText" t
    WHERE NOT EXISTS (
      SELECT 1 FROM "SiteLocale" l WHERE l."siteId" = t."siteId" AND l."locale" = t."locale"
    )
  ) THEN
    RAISE EXCEPTION 'ML-8a: a ProductListingText row has a language its site does not have';
  END IF;
  -- The English rows need the language "en" on every site that has categories or listings.
  IF EXISTS (
    SELECT 1 FROM (
      SELECT "siteId" FROM "ProductCategory" UNION SELECT "siteId" FROM "ProductSiteListing"
    ) s
    WHERE NOT EXISTS (SELECT 1 FROM "SiteLocale" l WHERE l."siteId" = s."siteId" AND l."locale" = 'en')
  ) THEN
    RAISE EXCEPTION 'ML-8a: a site with catalogue data has no language "en"';
  END IF;
END
$$;

-- ===========================================================================================
-- Part 1: schema (Prisma)
-- ===========================================================================================

-- AlterTable
ALTER TABLE "ProductListingText" ADD COLUMN     "seoDescription" VARCHAR(320),
ADD COLUMN     "seoOgDescription" VARCHAR(320),
ADD COLUMN     "seoOgTitle" VARCHAR(120),
ADD COLUMN     "seoTitle" VARCHAR(120);

-- CreateTable
CREATE TABLE "ProductCategoryText" (
    "categoryId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "locale" VARCHAR(35) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductCategoryText_pkey" PRIMARY KEY ("categoryId","locale")
);

-- CreateTable
CREATE TABLE "SpecDefinitionText" (
    "definitionId" UUID NOT NULL,
    "locale" VARCHAR(35) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SpecDefinitionText_pkey" PRIMARY KEY ("definitionId","locale")
);

-- CreateTable
CREATE TABLE "ProductImageText" (
    "imageId" UUID NOT NULL,
    "locale" VARCHAR(35) NOT NULL,
    "altText" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductImageText_pkey" PRIMARY KEY ("imageId","locale")
);

-- CreateIndex
CREATE INDEX "ProductCategoryText_siteId_locale_idx" ON "ProductCategoryText"("siteId", "locale");

-- AddForeignKey
ALTER TABLE "ProductListingText" ADD CONSTRAINT "ProductListingText_siteId_locale_fkey" FOREIGN KEY ("siteId", "locale") REFERENCES "SiteLocale"("siteId", "locale") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategoryText" ADD CONSTRAINT "ProductCategoryText_categoryId_siteId_fkey" FOREIGN KEY ("categoryId", "siteId") REFERENCES "ProductCategory"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategoryText" ADD CONSTRAINT "ProductCategoryText_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategoryText" ADD CONSTRAINT "ProductCategoryText_siteId_locale_fkey" FOREIGN KEY ("siteId", "locale") REFERENCES "SiteLocale"("siteId", "locale") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecDefinitionText" ADD CONSTRAINT "SpecDefinitionText_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "SpecDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImageText" ADD CONSTRAINT "ProductImageText_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "ProductImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================================
-- Part 2: rules Prisma cannot model
-- ===========================================================================================

ALTER TABLE "ProductListingText"
  ADD CONSTRAINT "ProductListingText_seo_trimmed" CHECK (
    ("seoTitle" IS NULL OR ("seoTitle" = btrim("seoTitle") AND length("seoTitle") >= 1))
    AND ("seoDescription" IS NULL
      OR ("seoDescription" = btrim("seoDescription") AND length("seoDescription") >= 1))
    AND ("seoOgTitle" IS NULL OR ("seoOgTitle" = btrim("seoOgTitle") AND length("seoOgTitle") >= 1))
    AND ("seoOgDescription" IS NULL
      OR ("seoOgDescription" = btrim("seoOgDescription") AND length("seoOgDescription") >= 1))
  );

ALTER TABLE "ProductCategoryText"
  ADD CONSTRAINT "ProductCategoryText_locale_format" CHECK ("locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  ADD CONSTRAINT "ProductCategoryText_name_trimmed" CHECK ("name" = btrim("name") AND "name" <> ''),
  ADD CONSTRAINT "ProductCategoryText_description_trimmed" CHECK ("description" IS NULL OR ("description" = btrim("description") AND "description" <> ''));

ALTER TABLE "SpecDefinitionText"
  ADD CONSTRAINT "SpecDefinitionText_locale_format" CHECK ("locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  ADD CONSTRAINT "SpecDefinitionText_name_trimmed" CHECK ("name" = btrim("name") AND "name" <> '');

ALTER TABLE "ProductImageText"
  ADD CONSTRAINT "ProductImageText_locale_format" CHECK ("locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  ADD CONSTRAINT "ProductImageText_alt_trimmed" CHECK ("altText" IS NULL OR ("altText" = btrim("altText") AND "altText" <> ''));

-- --- English backfill (before the triggers, so no trigger fires on it) ------------------------

INSERT INTO "ProductCategoryText" ("categoryId", "siteId", "locale", "name", "description", "createdAt", "updatedAt")
SELECT c."id", c."siteId", 'en', c."name", c."description", c."createdAt", c."updatedAt"
FROM "ProductCategory" c;

INSERT INTO "SpecDefinitionText" ("definitionId", "locale", "name", "createdAt", "updatedAt")
SELECT d."id", 'en', d."name", d."createdAt", d."updatedAt"
FROM "SpecDefinition" d;

INSERT INTO "ProductImageText" ("imageId", "locale", "altText", "createdAt", "updatedAt")
SELECT i."id", 'en', i."altText", i."createdAt", i."updatedAt"
FROM "ProductImage" i
WHERE i."altText" IS NOT NULL;

UPDATE "ProductListingText" t
SET "seoTitle" = l."seoTitle",
    "seoDescription" = l."seoDescription",
    "seoOgTitle" = l."seoOgTitle",
    "seoOgDescription" = l."seoOgDescription"
FROM "ProductSiteListing" l
WHERE t."listingId" = l."id" AND t."locale" = 'en'
  AND (l."seoTitle" IS NOT NULL OR l."seoDescription" IS NOT NULL
    OR l."seoOgTitle" IS NOT NULL OR l."seoOgDescription" IS NOT NULL);

INSERT INTO "ProductListingText" ("listingId", "siteId", "locale", "seoTitle", "seoDescription", "seoOgTitle", "seoOgDescription", "createdAt", "updatedAt")
SELECT l."id", l."siteId", 'en', l."seoTitle", l."seoDescription", l."seoOgTitle", l."seoOgDescription", l."updatedAt", l."updatedAt"
FROM "ProductSiteListing" l
WHERE (l."seoTitle" IS NOT NULL OR l."seoDescription" IS NOT NULL
    OR l."seoOgTitle" IS NOT NULL OR l."seoOgDescription" IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM "ProductListingText" t WHERE t."listingId" = l."id" AND t."locale" = 'en'
  );

-- --- synchronisation of the English columns (one release, DP-254) ---------------------------
-- Each direction skips when it is itself fired by the other direction (pg_trigger_depth), so
-- an English change is written once to each side. Values are compared first: no write when
-- equal.

-- categories: column → "en" row
CREATE FUNCTION catalog_category_texts_en() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  INSERT INTO "ProductCategoryText" ("categoryId", "siteId", "locale", "name", "description", "updatedAt")
  VALUES (NEW."id", NEW."siteId", 'en', NEW."name", NEW."description", now())
  ON CONFLICT ("categoryId", "locale") DO UPDATE
    SET "name" = EXCLUDED."name", "description" = EXCLUDED."description", "updatedAt" = now()
    WHERE "ProductCategoryText"."name" IS DISTINCT FROM EXCLUDED."name"
       OR "ProductCategoryText"."description" IS DISTINCT FROM EXCLUDED."description";
  RETURN NULL;
END
$$;
CREATE TRIGGER "ProductCategory_texts_en" AFTER INSERT OR UPDATE OF "name", "description" ON "ProductCategory"
  FOR EACH ROW EXECUTE FUNCTION catalog_category_texts_en();

-- categories: "en" row → column
CREATE FUNCTION catalog_category_text_legacy_en() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."locale" <> 'en' THEN RETURN NULL; END IF;
  UPDATE "ProductCategory" SET "name" = NEW."name", "description" = NEW."description"
  WHERE "id" = NEW."categoryId"
    AND ("name" IS DISTINCT FROM NEW."name" OR "description" IS DISTINCT FROM NEW."description");
  RETURN NULL;
END
$$;
CREATE TRIGGER "ProductCategoryText_legacy_en" AFTER INSERT OR UPDATE ON "ProductCategoryText"
  FOR EACH ROW EXECUTE FUNCTION catalog_category_text_legacy_en();

-- specification definitions
CREATE FUNCTION catalog_spec_texts_en() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  INSERT INTO "SpecDefinitionText" ("definitionId", "locale", "name", "updatedAt")
  VALUES (NEW."id", 'en', NEW."name", now())
  ON CONFLICT ("definitionId", "locale") DO UPDATE
    SET "name" = EXCLUDED."name", "updatedAt" = now()
    WHERE "SpecDefinitionText"."name" IS DISTINCT FROM EXCLUDED."name";
  RETURN NULL;
END
$$;
CREATE TRIGGER "SpecDefinition_texts_en" AFTER INSERT OR UPDATE OF "name" ON "SpecDefinition"
  FOR EACH ROW EXECUTE FUNCTION catalog_spec_texts_en();

CREATE FUNCTION catalog_spec_text_legacy_en() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."locale" <> 'en' THEN RETURN NULL; END IF;
  UPDATE "SpecDefinition" SET "name" = NEW."name"
  WHERE "id" = NEW."definitionId" AND "name" IS DISTINCT FROM NEW."name";
  RETURN NULL;
END
$$;
CREATE TRIGGER "SpecDefinitionText_legacy_en" AFTER INSERT OR UPDATE ON "SpecDefinitionText"
  FOR EACH ROW EXECUTE FUNCTION catalog_spec_text_legacy_en();

-- images (a null English alt text is an "en" row with a null alt text)
CREATE FUNCTION catalog_image_texts_en() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  IF NEW."altText" IS NULL AND NOT EXISTS (
    SELECT 1 FROM "ProductImageText" WHERE "imageId" = NEW."id" AND "locale" = 'en'
  ) THEN
    RETURN NULL;
  END IF;
  INSERT INTO "ProductImageText" ("imageId", "locale", "altText", "updatedAt")
  VALUES (NEW."id", 'en', NEW."altText", now())
  ON CONFLICT ("imageId", "locale") DO UPDATE
    SET "altText" = EXCLUDED."altText", "updatedAt" = now()
    WHERE "ProductImageText"."altText" IS DISTINCT FROM EXCLUDED."altText";
  RETURN NULL;
END
$$;
CREATE TRIGGER "ProductImage_texts_en" AFTER INSERT OR UPDATE OF "altText" ON "ProductImage"
  FOR EACH ROW EXECUTE FUNCTION catalog_image_texts_en();

CREATE FUNCTION catalog_image_text_legacy_en() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."locale" <> 'en' THEN RETURN NULL; END IF;
  UPDATE "ProductImage" SET "altText" = NEW."altText"
  WHERE "id" = NEW."imageId" AND "altText" IS DISTINCT FROM NEW."altText";
  RETURN NULL;
END
$$;
CREATE TRIGGER "ProductImageText_legacy_en" AFTER INSERT OR UPDATE ON "ProductImageText"
  FOR EACH ROW EXECUTE FUNCTION catalog_image_text_legacy_en();

-- the "en" row of a category, definition or image is removed only with its parent (cascade)
CREATE FUNCTION catalog_text_keep_en() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_exists boolean;
BEGIN
  IF OLD."locale" <> 'en' THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME = 'ProductCategoryText' THEN
    SELECT EXISTS (SELECT 1 FROM "ProductCategory" WHERE "id" = OLD."categoryId") INTO parent_exists;
  ELSIF TG_TABLE_NAME = 'SpecDefinitionText' THEN
    SELECT EXISTS (SELECT 1 FROM "SpecDefinition" WHERE "id" = OLD."definitionId") INTO parent_exists;
  ELSE
    SELECT EXISTS (SELECT 1 FROM "ProductImage" WHERE "id" = OLD."imageId") INTO parent_exists;
  END IF;
  IF parent_exists THEN
    RAISE EXCEPTION 'catalog: the English text row mirrors the English column and cannot be removed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER "ProductCategoryText_keep_en" BEFORE DELETE ON "ProductCategoryText"
  FOR EACH ROW EXECUTE FUNCTION catalog_text_keep_en();
CREATE TRIGGER "SpecDefinitionText_keep_en" BEFORE DELETE ON "SpecDefinitionText"
  FOR EACH ROW EXECUTE FUNCTION catalog_text_keep_en();
CREATE TRIGGER "ProductImageText_keep_en" BEFORE DELETE ON "ProductImageText"
  FOR EACH ROW EXECUTE FUNCTION catalog_text_keep_en();

-- listing SEO texts (DP-214): listing columns → "en" text row
CREATE FUNCTION catalog_listing_seo_en() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  IF NEW."seoTitle" IS NULL AND NEW."seoDescription" IS NULL AND NEW."seoOgTitle" IS NULL
     AND NEW."seoOgDescription" IS NULL AND NOT EXISTS (
       SELECT 1 FROM "ProductListingText" WHERE "listingId" = NEW."id" AND "locale" = 'en'
     ) THEN
    RETURN NULL;
  END IF;
  INSERT INTO "ProductListingText" ("listingId", "siteId", "locale", "seoTitle", "seoDescription", "seoOgTitle", "seoOgDescription", "updatedAt")
  VALUES (NEW."id", NEW."siteId", 'en', NEW."seoTitle", NEW."seoDescription", NEW."seoOgTitle", NEW."seoOgDescription", now())
  ON CONFLICT ("listingId", "locale") DO UPDATE
    SET "seoTitle" = EXCLUDED."seoTitle", "seoDescription" = EXCLUDED."seoDescription",
        "seoOgTitle" = EXCLUDED."seoOgTitle", "seoOgDescription" = EXCLUDED."seoOgDescription"
    WHERE "ProductListingText"."seoTitle" IS DISTINCT FROM EXCLUDED."seoTitle"
       OR "ProductListingText"."seoDescription" IS DISTINCT FROM EXCLUDED."seoDescription"
       OR "ProductListingText"."seoOgTitle" IS DISTINCT FROM EXCLUDED."seoOgTitle"
       OR "ProductListingText"."seoOgDescription" IS DISTINCT FROM EXCLUDED."seoOgDescription";
  RETURN NULL;
END
$$;
CREATE TRIGGER "ProductSiteListing_seo_en"
  AFTER INSERT OR UPDATE OF "seoTitle", "seoDescription", "seoOgTitle", "seoOgDescription" ON "ProductSiteListing"
  FOR EACH ROW EXECUTE FUNCTION catalog_listing_seo_en();

-- "en" text row → listing columns
CREATE FUNCTION catalog_listing_text_seo_legacy_en() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."locale" <> 'en' THEN RETURN NULL; END IF;
  UPDATE "ProductSiteListing"
  SET "seoTitle" = NEW."seoTitle", "seoDescription" = NEW."seoDescription",
      "seoOgTitle" = NEW."seoOgTitle", "seoOgDescription" = NEW."seoOgDescription"
  WHERE "id" = NEW."listingId"
    AND ("seoTitle" IS DISTINCT FROM NEW."seoTitle"
      OR "seoDescription" IS DISTINCT FROM NEW."seoDescription"
      OR "seoOgTitle" IS DISTINCT FROM NEW."seoOgTitle"
      OR "seoOgDescription" IS DISTINCT FROM NEW."seoOgDescription");
  RETURN NULL;
END
$$;
CREATE TRIGGER "ProductListingText_seo_legacy_en"
  AFTER INSERT OR UPDATE OF "seoTitle", "seoDescription", "seoOgTitle", "seoOgDescription" ON "ProductListingText"
  FOR EACH ROW EXECUTE FUNCTION catalog_listing_text_seo_legacy_en();

REVOKE ALL ON FUNCTION catalog_category_texts_en() FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog_category_text_legacy_en() FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog_spec_texts_en() FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog_spec_text_legacy_en() FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog_image_texts_en() FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog_image_text_legacy_en() FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog_text_keep_en() FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog_listing_seo_en() FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog_listing_text_seo_legacy_en() FROM PUBLIC;
