-- DP-086 (owner decision 2026-11-11, ADR-014 D5 revised): each site pins the revision of a
-- technical document it serves. A new upload or another active revision never changes what a
-- site serves; that site's publisher (product:publish) moves the pin, and only to the active
-- revision. BV and Corporate may serve different revisions of the same document.
--
-- Existing site rows are pinned to the revision served at the moment of migration (the active
-- revision: PM-5 served the active one, and the site guard only allowed rows with one), so no
-- publication changes silently. Nothing is deleted.

-- ===========================================================================================
-- Part 1: columns (nullable first, backfilled, then NOT NULL)
-- ===========================================================================================

ALTER TABLE "ProductDocumentSite"
  ADD COLUMN "revisionId" UUID,
  ADD COLUMN "pinnedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Target of the composite foreign key below.
CREATE UNIQUE INDEX "ProductDocumentRevision_id_documentId_key" ON "ProductDocumentRevision"("id", "documentId");

-- ===========================================================================================
-- Part 2: backfill (the revision served now). Rows of archived or INTERNAL documents keep their
-- row in PM-5 (the public routes filter them), so the guard is paused for this statement only:
-- the backfill must pin every row, not apply today's showing rules to it.
-- ===========================================================================================

ALTER TABLE "ProductDocumentSite" DISABLE TRIGGER "ProductDocumentSite_guard";

UPDATE "ProductDocumentSite" s
SET "revisionId" = r."id", "pinnedAt" = s."createdAt"
FROM "ProductDocumentRevision" r
WHERE r."documentId" = s."documentId" AND r."isActive" AND s."revisionId" IS NULL;

ALTER TABLE "ProductDocumentSite" ENABLE TRIGGER "ProductDocumentSite_guard";

-- Fails the migration (nothing applied) if any row could not be pinned; never guesses.
ALTER TABLE "ProductDocumentSite" ALTER COLUMN "revisionId" SET NOT NULL;

CREATE INDEX "ProductDocumentSite_revisionId_idx" ON "ProductDocumentSite"("revisionId");

ALTER TABLE "ProductDocumentSite" ADD CONSTRAINT "ProductDocumentSite_revisionId_documentId_fkey" FOREIGN KEY ("revisionId", "documentId") REFERENCES "ProductDocumentRevision"("id", "documentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================================
-- Part 3: the site guard allows exactly one kind of change: moving the pin (with its time) to
-- the active revision of an active, non-internal document.
-- ===========================================================================================

CREATE OR REPLACE FUNCTION catalog_document_site_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  d RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."id" IS DISTINCT FROM OLD."id"
                           OR NEW."documentId" IS DISTINCT FROM OLD."documentId"
                           OR NEW."siteId" IS DISTINCT FROM OLD."siteId"
                           OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt") THEN
    RAISE EXCEPTION 'catalog: a document site row cannot change; remove and add it'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."revisionId" IS NOT DISTINCT FROM OLD."revisionId"
     AND NEW."pinnedAt" IS NOT DISTINCT FROM OLD."pinnedAt" THEN
    RETURN NEW;
  END IF;
  SELECT doc."status", doc."accessPolicy" INTO d FROM "ProductDocument" doc WHERE doc."id" = NEW."documentId";
  IF d."status" IS DISTINCT FROM 'ACTIVE' OR d."accessPolicy" = 'INTERNAL'
     OR NOT EXISTS (SELECT 1 FROM "ProductDocumentRevision" r
                    WHERE r."documentId" = NEW."documentId" AND r."isActive") THEN
    RAISE EXCEPTION 'catalog: only an active, non-internal document with a file can be shown on a site'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM "ProductDocumentRevision" r
       WHERE r."id" = NEW."revisionId" AND r."documentId" = NEW."documentId" AND r."isActive") THEN
    RAISE EXCEPTION 'catalog: a site can only pin the active revision of a document'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

-- ===========================================================================================
-- Part 4: privileges. Site rows were insert/delete only (PM-5); now the pin may move too.
-- ===========================================================================================

GRANT UPDATE ("revisionId", "pinnedAt") ON TABLE "ProductDocumentSite" TO dp_app;
