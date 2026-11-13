-- PM-5 (DP-035): technical documents (TDS, SDS, COA, other PDFs) of a product master.
--
-- Runs as dp_owner (ADR-012A). Additive only: three enums, three new tables, CHECK constraints,
-- guard triggers and privilege exceptions; no existing table, column or row changes. PDF bytes
-- are NOT stored here: the media storage holds them under random keys (documents/<id>/...),
-- this database only the metadata. Prisma's drift check sees the tables and the partial unique
-- index (one active revision per document); the CHECK constraints and triggers are tested in
-- test/integration/catalog-documents.int.test.ts. Access model: ADR-014.
--
-- Part 1 follows `prisma migrate diff --from-migrations --to-schema schema.prisma`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_app') THEN
    RAISE EXCEPTION 'PM-5: database role dp_app missing; ADR-012A must be applied first';
  END IF;
END $$;

-- ===========================================================================================
-- Part 1: tables and indexes (generated)
-- ===========================================================================================
-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('TDS', 'SDS', 'COA', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentAccessPolicy" AS ENUM ('PUBLIC', 'MEMBERS_ONLY', 'LEAD_REQUIRED', 'INTERNAL');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "ProductDocument" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "accessPolicy" "DocumentAccessPolicy" NOT NULL DEFAULT 'INTERNAL',
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductDocumentRevision" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "storageKey" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(32) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "originalFilename" VARCHAR(255) NOT NULL,
    "pageCount" INTEGER,
    "pdfVersion" VARCHAR(8),
    "changeNote" VARCHAR(1000),
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductDocumentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductDocumentSite" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductDocumentSite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductDocument_productId_status_type_idx" ON "ProductDocument"("productId", "status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDocumentRevision_storageKey_key" ON "ProductDocumentRevision"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDocumentRevision_documentId_revisionNumber_key" ON "ProductDocumentRevision"("documentId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDocumentRevision_active_documentId_key" ON "ProductDocumentRevision"("documentId") WHERE ("isActive");

-- CreateIndex
CREATE INDEX "ProductDocumentSite_siteId_idx" ON "ProductDocumentSite"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDocumentSite_documentId_siteId_key" ON "ProductDocumentSite"("documentId", "siteId");

-- AddForeignKey
ALTER TABLE "ProductDocument" ADD CONSTRAINT "ProductDocument_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDocumentRevision" ADD CONSTRAINT "ProductDocumentRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProductDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDocumentRevision" ADD CONSTRAINT "ProductDocumentRevision_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDocumentSite" ADD CONSTRAINT "ProductDocumentSite_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProductDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDocumentSite" ADD CONSTRAINT "ProductDocumentSite_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================================
-- Part 2: rules Prisma cannot model
-- ===========================================================================================

ALTER TABLE "ProductDocument"
  ADD CONSTRAINT "ProductDocument_title_trimmed" CHECK ("title" = btrim("title") AND "title" <> ''),
  ADD CONSTRAINT "ProductDocument_description_trimmed" CHECK ("description" IS NULL OR ("description" = btrim("description") AND "description" <> '')),
  ADD CONSTRAINT "ProductDocument_revision_count" CHECK ("revisionCount" BETWEEN 0 AND 100),
  ADD CONSTRAINT "ProductDocument_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "ProductDocument_archived_at" CHECK (("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL));

ALTER TABLE "ProductDocumentRevision"
  ADD CONSTRAINT "ProductDocumentRevision_storage_key_format" CHECK ("storageKey" ~ '^documents/[0-9a-f]{32}/document\.pdf$'),
  ADD CONSTRAINT "ProductDocumentRevision_mime_type" CHECK ("mimeType" = 'application/pdf'),
  ADD CONSTRAINT "ProductDocumentRevision_byte_size" CHECK ("byteSize" BETWEEN 1 AND 20971520),
  ADD CONSTRAINT "ProductDocumentRevision_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ProductDocumentRevision_filename_safe" CHECK ("originalFilename" <> '' AND "originalFilename" !~ '[/\\[:cntrl:]]'),
  ADD CONSTRAINT "ProductDocumentRevision_number_positive" CHECK ("revisionNumber" >= 1),
  ADD CONSTRAINT "ProductDocumentRevision_page_count" CHECK ("pageCount" IS NULL OR "pageCount" >= 1),
  ADD CONSTRAINT "ProductDocumentRevision_pdf_version" CHECK ("pdfVersion" IS NULL OR "pdfVersion" ~ '^[12]\.[0-9]$'),
  ADD CONSTRAINT "ProductDocumentRevision_note_trimmed" CHECK ("changeNote" IS NULL OR ("changeNote" = btrim("changeNote") AND "changeNote" <> ''));

-- Documents of an archived product master are frozen (as its images and values are). An archived
-- document is frozen too: the only change is restoring it (status back to ACTIVE).
CREATE FUNCTION catalog_document_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."productId" IS DISTINCT FROM OLD."productId" THEN
    RAISE EXCEPTION 'catalog: the product of a document cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "Product" p WHERE p."id" = NEW."productId" AND p."status" = 'ARCHIVED') THEN
    RAISE EXCEPTION 'catalog: documents of an archived product cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'ARCHIVED' AND NEW."status" = 'ARCHIVED'
     AND (NEW."type" IS DISTINCT FROM OLD."type"
          OR NEW."title" IS DISTINCT FROM OLD."title"
          OR NEW."description" IS DISTINCT FROM OLD."description"
          OR NEW."accessPolicy" IS DISTINCT FROM OLD."accessPolicy"
          OR NEW."revisionCount" IS DISTINCT FROM OLD."revisionCount") THEN
    RAISE EXCEPTION 'catalog: an archived document cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "ProductDocument_guard" BEFORE INSERT OR UPDATE ON "ProductDocument"
  FOR EACH ROW EXECUTE FUNCTION catalog_document_guard();

-- A revision gets the document's next number (the API raises revisionCount first, in the same
-- transaction) and only while the document can change. Revisions are immutable: the file facts,
-- number, note and uploader never change; only the active flag moves, and only while the
-- document is not archived. Revisions are never deleted (privileges below are the first line).
CREATE FUNCTION catalog_document_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  d RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'catalog: document revisions are immutable and cannot be deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT doc."status", doc."revisionCount", p."status" AS "productStatus" INTO d
  FROM "ProductDocument" doc JOIN "Product" p ON p."id" = doc."productId"
  WHERE doc."id" = NEW."documentId";
  IF d."status" IS DISTINCT FROM 'ACTIVE' OR d."productStatus" = 'ARCHIVED' THEN
    RAISE EXCEPTION 'catalog: revisions of an archived document cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."revisionNumber" IS DISTINCT FROM d."revisionCount" THEN
      RAISE EXCEPTION 'catalog: a revision must take the next revision number'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."documentId" IS DISTINCT FROM OLD."documentId"
     OR NEW."revisionNumber" IS DISTINCT FROM OLD."revisionNumber"
     OR NEW."storageKey" IS DISTINCT FROM OLD."storageKey"
     OR NEW."mimeType" IS DISTINCT FROM OLD."mimeType"
     OR NEW."byteSize" IS DISTINCT FROM OLD."byteSize"
     OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
     OR NEW."originalFilename" IS DISTINCT FROM OLD."originalFilename"
     OR NEW."pageCount" IS DISTINCT FROM OLD."pageCount"
     OR NEW."pdfVersion" IS DISTINCT FROM OLD."pdfVersion"
     OR NEW."changeNote" IS DISTINCT FROM OLD."changeNote"
     OR NEW."uploadedById" IS DISTINCT FROM OLD."uploadedById"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'catalog: document revisions are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "ProductDocumentRevision_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProductDocumentRevision"
  FOR EACH ROW EXECUTE FUNCTION catalog_document_revision_guard();

CREATE FUNCTION catalog_document_revision_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'catalog: document revisions are immutable and cannot be deleted'
    USING ERRCODE = 'insufficient_privilege';
END
$fn$;
CREATE TRIGGER "ProductDocumentRevision_no_truncate" BEFORE TRUNCATE ON "ProductDocumentRevision"
  FOR EACH STATEMENT EXECUTE FUNCTION catalog_document_revision_no_truncate();

-- A site may show a document only while it is active, has an active revision and is not
-- INTERNAL. The site row never moves to another document or site (hide = delete the row).
CREATE FUNCTION catalog_document_site_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  d RECORD;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'catalog: a document site row cannot change; remove and add it'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT doc."status", doc."accessPolicy" INTO d FROM "ProductDocument" doc WHERE doc."id" = NEW."documentId";
  IF d."status" IS DISTINCT FROM 'ACTIVE' OR d."accessPolicy" = 'INTERNAL'
     OR NOT EXISTS (SELECT 1 FROM "ProductDocumentRevision" r
                    WHERE r."documentId" = NEW."documentId" AND r."isActive") THEN
    RAISE EXCEPTION 'catalog: only an active, non-internal document with a file can be shown on a site'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "ProductDocumentSite_guard" BEFORE INSERT OR UPDATE ON "ProductDocumentSite"
  FOR EACH ROW EXECUTE FUNCTION catalog_document_site_guard();

-- ===========================================================================================
-- Part 3: privileges (ADR-012A default privileges gave dp_app full DML on the new tables)
-- ===========================================================================================

-- Revisions: insert, read and the active flag only. Documents are archived, never deleted.
-- Site rows are added and removed, never changed (hiding a document on a site removes its row).
REVOKE DELETE ON TABLE "ProductDocumentRevision" FROM dp_app;
REVOKE DELETE ON TABLE "ProductDocument" FROM dp_app;
REVOKE UPDATE ON TABLE "ProductDocumentSite" FROM dp_app;
-- Revisions: only the active flag may be written after insert (column privilege, plus trigger).
REVOKE UPDATE ON TABLE "ProductDocumentRevision" FROM dp_app;
GRANT UPDATE ("isActive") ON TABLE "ProductDocumentRevision" TO dp_app;
