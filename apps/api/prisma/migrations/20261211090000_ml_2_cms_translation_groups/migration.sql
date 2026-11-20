-- ML-2 (DP-074, ADR-028 D6): CMS pages per language, linked by a translation group.
--
-- Runs as dp_owner (ADR-012A). One table changes ("CmsPage"); "CmsPageRevision" and
-- "CmsPagePublication" keep their structure and rows (a revision's language is its page's).
--
--  * "translationGroupId": the id of the group's first page; backfilled with the page's own id,
--    so every existing page is the original of its own group. NOT NULL after the backfill.
--  * "translationSourceRevisionId": the revision of the group's source-language page a
--    translation was made from (DP-074 translation state "outdated"); null for every existing
--    page.
--  * Unique keys become per language: (siteId, locale, path) and the registry key
--    (siteId, locale, templateKey) of designed pages and fragments; a group holds at most one page
--    per language (translationGroupId, locale). The old keys are strictly narrower, so every
--    existing row satisfies the new ones (Part 0 checks the data anyway).
--  * Foreign keys: the page's language is a language of its site ("SiteLocale"); the group id is
--    a page; the source revision is a revision. All ON DELETE RESTRICT (nothing is deleted).
--  * Triggers: the pages of a group share site, kind and template key; a group's first page is
--    its own group (no nesting); a source revision belongs to another page of the same group.
--
-- Existing data: the UPDATE writes only the new column ("updatedAt" is set by the API, not by the
-- database, so it is unchanged). Every other column of every CMS row stays byte-identical
-- (rehearsed on an isolated restore of DEV: hash of every CmsPage column except the new ones,
-- every CmsPageRevision and CmsPagePublication row, before = after).
--
-- Part 1 matches `prisma migrate diff --from-schema <main> --to-schema schema.prisma`; Part 2 adds
-- the rules Prisma cannot model. test/integration/cms.int.test.ts (section 22) covers each rule
-- and the rollback below.
--
-- Rollback (lossless while every page is still its group's only page, i.e. before the first
-- translation is created; afterwards two pages may share a path and the old keys cannot return):
--   DROP TRIGGER "CmsPage_translation_group" ON "CmsPage";
--   DROP TRIGGER "CmsPage_translation_source" ON "CmsPage";
--   DROP FUNCTION cms_page_translation_group(), cms_page_translation_source();
--   ALTER TABLE "CmsPage" DROP CONSTRAINT "CmsPage_siteId_locale_fkey",
--     DROP CONSTRAINT "CmsPage_translationGroupId_fkey",
--     DROP CONSTRAINT "CmsPage_translationSourceRevisionId_fkey";
--   DROP INDEX "CmsPage_siteId_locale_path_key";
--   DROP INDEX "CmsPage_registry_siteId_locale_templateKey_key";
--   DROP INDEX "CmsPage_translationGroupId_locale_key";
--   DROP INDEX "CmsPage_translationSourceRevisionId_idx";
--   CREATE UNIQUE INDEX "CmsPage_siteId_path_key" ON "CmsPage"("siteId", "path");
--   CREATE UNIQUE INDEX "CmsPage_registry_siteId_templateKey_key" ON "CmsPage"("siteId", "templateKey")
--     WHERE (kind <> 'TEMPLATE'::"CmsPageKind");
--   ALTER TABLE "CmsPage" DROP COLUMN "translationSourceRevisionId", DROP COLUMN "translationGroupId";
--   (and remove the row of this migration from "_prisma_migrations")

-- ===========================================================================================
-- Part 0: preconditions
-- ===========================================================================================

DO $$
BEGIN
  IF to_regclass('public."SiteLocale"') IS NULL THEN
    RAISE EXCEPTION 'ML-2: SiteLocale missing; migration 20261210090000_ml_1_site_locales must be applied first';
  END IF;
  -- Every page is written in a language of its site (the new foreign key).
  IF EXISTS (
    SELECT 1 FROM "CmsPage" p
    WHERE NOT EXISTS (
      SELECT 1 FROM "SiteLocale" l WHERE l."siteId" = p."siteId" AND l."locale" = p."locale"
    )
  ) THEN
    RAISE EXCEPTION 'ML-2: a CMS page is written in a language its site does not have';
  END IF;
  -- The new unique keys hold (they are wider than the old ones; checked by query first).
  IF EXISTS (
    SELECT 1 FROM "CmsPage" WHERE "path" IS NOT NULL
    GROUP BY "siteId", "locale", "path" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "CmsPage" WHERE "kind" <> 'TEMPLATE'
    GROUP BY "siteId", "locale", "templateKey" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ML-2: duplicate page address or registry key per site and language';
  END IF;
END $$;

-- ===========================================================================================
-- Part 1: columns, backfill, keys (generated shape)
-- ===========================================================================================

ALTER TABLE "CmsPage" ADD COLUMN "translationGroupId" UUID,
ADD COLUMN "translationSourceRevisionId" UUID;

-- Backfill: every existing page is the original of its own group.
UPDATE "CmsPage" SET "translationGroupId" = "id" WHERE "translationGroupId" IS NULL;

ALTER TABLE "CmsPage" ALTER COLUMN "translationGroupId" SET NOT NULL;

-- DropIndex
DROP INDEX "CmsPage_registry_siteId_templateKey_key";

-- DropIndex
DROP INDEX "CmsPage_siteId_path_key";

-- CreateIndex
CREATE INDEX "CmsPage_translationSourceRevisionId_idx" ON "CmsPage"("translationSourceRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "CmsPage_siteId_locale_path_key" ON "CmsPage"("siteId", "locale", "path");

-- CreateIndex
CREATE UNIQUE INDEX "CmsPage_registry_siteId_locale_templateKey_key" ON "CmsPage"("siteId", "locale", "templateKey") WHERE (kind <> 'TEMPLATE'::"CmsPageKind");

-- CreateIndex
CREATE UNIQUE INDEX "CmsPage_translationGroupId_locale_key" ON "CmsPage"("translationGroupId", "locale");

-- AddForeignKey
ALTER TABLE "CmsPage" ADD CONSTRAINT "CmsPage_siteId_locale_fkey" FOREIGN KEY ("siteId", "locale") REFERENCES "SiteLocale"("siteId", "locale") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPage" ADD CONSTRAINT "CmsPage_translationGroupId_fkey" FOREIGN KEY ("translationGroupId") REFERENCES "CmsPage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CmsPage" ADD CONSTRAINT "CmsPage_translationSourceRevisionId_fkey" FOREIGN KEY ("translationSourceRevisionId") REFERENCES "CmsPageRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================================
-- Part 2: group consistency (triggers)
-- ===========================================================================================

-- The pages of a translation group share site, kind and template key; the group id names the
-- group's first page, which is its own group (a group is never nested in another one).
CREATE FUNCTION cms_page_translation_group() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "CmsPage" g
    WHERE g."id" = NEW."translationGroupId" AND g."translationGroupId" = g."id"
  ) THEN
    RAISE EXCEPTION 'cms: a translation group must name its first page (CmsPage_translation_group_root)';
  END IF;
  IF NEW."translationGroupId" <> NEW."id" AND EXISTS (
    SELECT 1 FROM "CmsPage" m WHERE m."translationGroupId" = NEW."id" AND m."id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'cms: the first page of a translation group cannot join another group (CmsPage_translation_group_root)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "CmsPage" m
    WHERE (m."translationGroupId" = NEW."translationGroupId" OR m."translationGroupId" = NEW."id")
      AND (m."siteId" <> NEW."siteId" OR m."kind" <> NEW."kind"
        OR m."templateKey" <> NEW."templateKey")
  ) THEN
    RAISE EXCEPTION 'cms: the pages of a translation group share site, kind and template key (CmsPage_translation_group_consistent)';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "CmsPage_translation_group"
  AFTER INSERT OR UPDATE OF "translationGroupId", "siteId", "kind", "templateKey" ON "CmsPage"
  FOR EACH ROW EXECUTE FUNCTION cms_page_translation_group();

-- A translation's source revision is a revision of another page of the same group.
CREATE FUNCTION cms_page_translation_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."translationSourceRevisionId" IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "CmsPageRevision" r JOIN "CmsPage" s ON s."id" = r."pageId"
    WHERE r."id" = NEW."translationSourceRevisionId"
      AND s."translationGroupId" = NEW."translationGroupId"
      AND s."id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'cms: a translation source is a revision of another page of its group (CmsPage_translation_source)';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "CmsPage_translation_source"
  AFTER INSERT OR UPDATE OF "translationSourceRevisionId", "translationGroupId" ON "CmsPage"
  FOR EACH ROW EXECUTE FUNCTION cms_page_translation_source();

-- Trigger functions only: nobody calls them directly (no PUBLIC EXECUTE, as in ML-1).
REVOKE ALL ON FUNCTION cms_page_translation_group() FROM PUBLIC;
REVOKE ALL ON FUNCTION cms_page_translation_source() FROM PUBLIC;
