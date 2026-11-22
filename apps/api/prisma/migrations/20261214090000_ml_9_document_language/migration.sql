-- ML-9 (DP-240, ADR-028 D10): the language of a technical document.
--
-- Runs as dp_owner (ADR-012A). Additive and backward compatible: one new column with a default.
-- Files are never translated by the platform; a file in another language (supplied by the
-- company) is uploaded as its own document with its own language.
--
--  * "ProductDocument"."language": BCP 47 tag (the rule of "SiteLocale"."locale"), NOT NULL,
--    DEFAULT 'en'. Every existing document is English: ADD COLUMN ... DEFAULT fills every row with
--    'en' in the same statement (no rewrite of revisions, files, hashes or site rows).
--  * A document shown on a site (a "ProductDocumentSite" row) keeps its language: changing it
--    would silently publish the same file as another language. Hide it on every site first.
--    An archived document is frozen, its language too.
--  * A site can show a document only in a language that is enabled on that site
--    ("SiteLocale"."enabled"); whether visitors see it is decided by the public API
--    ("SiteLocale"."public", ADR-028 D2).
--
-- Rollback (lossless while every document is 'en'; otherwise the languages are lost):
--   DROP TRIGGER "ProductDocumentSite_language_guard" ON "ProductDocumentSite";
--   DROP TRIGGER "ProductDocument_language_guard" ON "ProductDocument";
--   DROP FUNCTION catalog_document_site_language_guard();
--   DROP FUNCTION catalog_document_language_guard();
--   ALTER TABLE "ProductDocument" DROP COLUMN "language";
--   (and remove the row of this migration from "_prisma_migrations")
--
-- Part 1 matches `prisma migrate diff --from-schema <main> --to-schema schema.prisma`; Part 2 adds
-- the rules Prisma cannot model. test/integration/catalog-documents.int.test.ts covers them.

-- ===========================================================================================
-- Part 1: schema (Prisma)
-- ===========================================================================================

-- AlterTable
ALTER TABLE "ProductDocument" ADD COLUMN     "language" VARCHAR(35) NOT NULL DEFAULT 'en';

-- ===========================================================================================
-- Part 2: rules Prisma cannot model
-- ===========================================================================================

ALTER TABLE "ProductDocument"
  ADD CONSTRAINT "ProductDocument_language_format" CHECK ("language" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');

CREATE FUNCTION catalog_document_language_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW."language" IS NOT DISTINCT FROM OLD."language" THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'ARCHIVED' THEN
    RAISE EXCEPTION 'catalog: an archived document cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "ProductDocumentSite" s WHERE s."documentId" = NEW."id") THEN
    RAISE EXCEPTION 'catalog: the language of a document shown on a site cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "ProductDocument_language_guard" BEFORE UPDATE OF "language" ON "ProductDocument"
  FOR EACH ROW EXECUTE FUNCTION catalog_document_language_guard();

CREATE FUNCTION catalog_document_site_language_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM "ProductDocument" d
       JOIN "SiteLocale" l ON l."siteId" = NEW."siteId" AND l."locale" = d."language"
       WHERE d."id" = NEW."documentId" AND l."enabled") THEN
    RAISE EXCEPTION 'catalog: a site can only show a document in a language enabled on it'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "ProductDocumentSite_language_guard" BEFORE INSERT ON "ProductDocumentSite"
  FOR EACH ROW EXECUTE FUNCTION catalog_document_site_language_guard();
