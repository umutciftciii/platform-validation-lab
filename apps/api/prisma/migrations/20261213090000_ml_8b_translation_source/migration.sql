-- ML-8b (DP-239, ADR-028 D8): the source revision of a translation, for the "Outdated" state.
--
-- Runs as dp_owner (ADR-012A). Additive only: five new nullable columns and their CHECKs. No
-- existing column or row changes; nothing is backfilled (a translation written before ML-8b has
-- no recorded source and is shown as "Outdated" until a translator saves or confirms it; there
-- were no translations on any environment before ML-8a).
--
-- When a text in a language other than the site's default is saved, the API stores the SHA-256
-- (hex) of the default-language source it was written against:
--  * "ProductListingText"."sourceHash": title, summary and description (the English listing text,
--    else the shared product text the site falls back to), "seoSourceHash": the four SEO texts;
--  * "ProductCategoryText"."sourceHash": category name and description;
--  * "SpecDefinitionText"."sourceHash": specification name;
--  * "ProductImageText"."sourceHash": alt text.
-- A translation is "Outdated" when the hash of today's source differs. Rows of the default
-- language keep null (they are the source). Nothing here is read by the public sites.
--
-- Rollback (lossless: the columns hold only hashes, no content):
--   ALTER TABLE "ProductListingText" DROP COLUMN "sourceHash", DROP COLUMN "seoSourceHash";
--   ALTER TABLE "ProductCategoryText" DROP COLUMN "sourceHash";
--   ALTER TABLE "SpecDefinitionText" DROP COLUMN "sourceHash";
--   ALTER TABLE "ProductImageText" DROP COLUMN "sourceHash";
--   (and remove the row of this migration from "_prisma_migrations")
-- ML-8a (39) can be rolled back only after this one (the columns live on its tables).
--
-- Part 1 matches `prisma migrate diff --from-schema <main> --to-schema schema.prisma`; Part 2 adds
-- the format CHECKs. test/integration/catalog-workflow.int.test.ts (section 18) covers them.

-- ===========================================================================================
-- Part 1: schema (Prisma)
-- ===========================================================================================

-- AlterTable
ALTER TABLE "ProductCategoryText" ADD COLUMN     "sourceHash" CHAR(64);

-- AlterTable
ALTER TABLE "ProductImageText" ADD COLUMN     "sourceHash" CHAR(64);

-- AlterTable
ALTER TABLE "ProductListingText" ADD COLUMN     "seoSourceHash" CHAR(64),
ADD COLUMN     "sourceHash" CHAR(64);

-- AlterTable
ALTER TABLE "SpecDefinitionText" ADD COLUMN     "sourceHash" CHAR(64);

-- ===========================================================================================
-- Part 2: rules Prisma cannot model
-- ===========================================================================================

ALTER TABLE "ProductListingText"
  ADD CONSTRAINT "ProductListingText_sourceHash_format" CHECK ("sourceHash" IS NULL OR "sourceHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ProductListingText_seoSourceHash_format" CHECK ("seoSourceHash" IS NULL OR "seoSourceHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ProductCategoryText"
  ADD CONSTRAINT "ProductCategoryText_sourceHash_format" CHECK ("sourceHash" IS NULL OR "sourceHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "SpecDefinitionText"
  ADD CONSTRAINT "SpecDefinitionText_sourceHash_format" CHECK ("sourceHash" IS NULL OR "sourceHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ProductImageText"
  ADD CONSTRAINT "ProductImageText_sourceHash_format" CHECK ("sourceHash" IS NULL OR "sourceHash" ~ '^[0-9a-f]{64}$');
