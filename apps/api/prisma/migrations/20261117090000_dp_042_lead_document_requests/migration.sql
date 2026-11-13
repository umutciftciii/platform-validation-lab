-- DP-042/DP-043 (ADR-016): lead-gated document downloads — short form with consent evidence,
-- short-lived download grants, stamped download records and public rate-limit counters.
--
-- Runs as dp_owner (ADR-012A). Additive only: five new tables, CHECK constraints, guard triggers
-- and privilege exceptions; no existing table, column or row changes. Personal data lives in
-- "Lead" and "LeadDocumentRequest" (customer data: lead:read on the site, ADR-011 K-02). Tokens
-- are stored as SHA-256 only, IP addresses never (HMAC of the prefix). Tested in
-- test/integration/leads.int.test.ts.
--
-- Part 1 follows `prisma migrate diff --from-schema <main> --to-schema schema.prisma`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_app') THEN
    RAISE EXCEPTION 'DP-042: database role dp_app missing; ADR-012A must be applied first';
  END IF;
END $$;

-- ===========================================================================================
-- Part 1: tables and indexes (generated)
-- ===========================================================================================
-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "company" VARCHAR(160) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "freeMailDomain" BOOLEAN NOT NULL DEFAULT false,
    "marketingConsentAt" TIMESTAMPTZ(3),
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "firstRequestAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRequestAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadDocumentRequest" (
    "id" UUID NOT NULL,
    "reference" CHAR(8) NOT NULL,
    "leadId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "company" VARCHAR(160) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "privacyNoticeVersion" VARCHAR(20) NOT NULL,
    "privacyNoticeSha256" CHAR(64) NOT NULL,
    "marketingConsent" BOOLEAN NOT NULL,
    "marketingConsentVersion" VARCHAR(20),
    "marketingConsentSha256" CHAR(64),
    "ipPrefixHmac" CHAR(64),
    "requestId" VARCHAR(100),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadDocumentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentDownloadGrant" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "lastDownloadAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentDownloadGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadDocumentDownload" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "httpRequestId" VARCHAR(100),
    "deliveredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadDocumentDownload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicRateLimit" (
    "key" CHAR(64) NOT NULL,
    "windowStartedAt" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PublicRateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Lead_siteId_lastRequestAt_idx" ON "Lead"("siteId", "lastRequestAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_siteId_email_key" ON "Lead"("siteId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "LeadDocumentRequest_reference_key" ON "LeadDocumentRequest"("reference");

-- CreateIndex
CREATE INDEX "LeadDocumentRequest_siteId_createdAt_idx" ON "LeadDocumentRequest"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadDocumentRequest_leadId_createdAt_idx" ON "LeadDocumentRequest"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadDocumentRequest_documentId_idx" ON "LeadDocumentRequest"("documentId");

-- CreateIndex
CREATE INDEX "LeadDocumentRequest_revisionId_documentId_idx" ON "LeadDocumentRequest"("revisionId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentDownloadGrant_requestId_key" ON "DocumentDownloadGrant"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentDownloadGrant_tokenHash_key" ON "DocumentDownloadGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "DocumentDownloadGrant_siteId_expiresAt_idx" ON "DocumentDownloadGrant"("siteId", "expiresAt");

-- CreateIndex
CREATE INDEX "LeadDocumentDownload_requestId_deliveredAt_idx" ON "LeadDocumentDownload"("requestId", "deliveredAt");

-- CreateIndex
CREATE INDEX "LeadDocumentDownload_siteId_deliveredAt_idx" ON "LeadDocumentDownload"("siteId", "deliveredAt");

-- CreateIndex
CREATE INDEX "PublicRateLimit_expiresAt_idx" ON "PublicRateLimit"("expiresAt");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDocumentRequest" ADD CONSTRAINT "LeadDocumentRequest_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDocumentRequest" ADD CONSTRAINT "LeadDocumentRequest_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDocumentRequest" ADD CONSTRAINT "LeadDocumentRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDocumentRequest" ADD CONSTRAINT "LeadDocumentRequest_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProductDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDocumentRequest" ADD CONSTRAINT "LeadDocumentRequest_revisionId_documentId_fkey" FOREIGN KEY ("revisionId", "documentId") REFERENCES "ProductDocumentRevision"("id", "documentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDownloadGrant" ADD CONSTRAINT "DocumentDownloadGrant_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LeadDocumentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDownloadGrant" ADD CONSTRAINT "DocumentDownloadGrant_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDocumentDownload" ADD CONSTRAINT "LeadDocumentDownload_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LeadDocumentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDocumentDownload" ADD CONSTRAINT "LeadDocumentDownload_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "DocumentDownloadGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDocumentDownload" ADD CONSTRAINT "LeadDocumentDownload_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================================
-- Part 2: rules Prisma cannot model
-- ===========================================================================================

ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_email_normalised" CHECK ("email" = lower(btrim("email")) AND "email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  ADD CONSTRAINT "Lead_full_name_trimmed" CHECK ("fullName" = btrim("fullName") AND "fullName" <> ''),
  ADD CONSTRAINT "Lead_company_trimmed" CHECK ("company" = btrim("company") AND "company" <> ''),
  ADD CONSTRAINT "Lead_country_format" CHECK ("country" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "Lead_request_count" CHECK ("requestCount" >= 0),
  ADD CONSTRAINT "Lead_request_times" CHECK ("lastRequestAt" >= "firstRequestAt");

ALTER TABLE "LeadDocumentRequest"
  ADD CONSTRAINT "LeadDocumentRequest_reference_format" CHECK ("reference" ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  ADD CONSTRAINT "LeadDocumentRequest_full_name_trimmed" CHECK ("fullName" = btrim("fullName") AND "fullName" <> ''),
  ADD CONSTRAINT "LeadDocumentRequest_company_trimmed" CHECK ("company" = btrim("company") AND "company" <> ''),
  ADD CONSTRAINT "LeadDocumentRequest_country_format" CHECK ("country" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "LeadDocumentRequest_notice_version" CHECK ("privacyNoticeVersion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]+)?$'),
  ADD CONSTRAINT "LeadDocumentRequest_notice_sha256" CHECK ("privacyNoticeSha256" ~ '^[0-9a-f]{64}$'),
  -- Marketing evidence: version and text hash exactly when consent was given.
  ADD CONSTRAINT "LeadDocumentRequest_marketing_evidence" CHECK (
    ("marketingConsent" AND "marketingConsentVersion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]+)?$'
       AND "marketingConsentSha256" ~ '^[0-9a-f]{64}$')
    OR (NOT "marketingConsent" AND "marketingConsentVersion" IS NULL AND "marketingConsentSha256" IS NULL)),
  ADD CONSTRAINT "LeadDocumentRequest_ip_hmac_format" CHECK ("ipPrefixHmac" IS NULL OR "ipPrefixHmac" ~ '^[0-9a-f]{64}$');

ALTER TABLE "DocumentDownloadGrant"
  ADD CONSTRAINT "DocumentDownloadGrant_token_hash_format" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  -- ADR-016 D4: at most 3 downloads, valid at most 15 minutes.
  ADD CONSTRAINT "DocumentDownloadGrant_download_count" CHECK ("downloadCount" BETWEEN 0 AND 3),
  ADD CONSTRAINT "DocumentDownloadGrant_lifetime" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '15 minutes'),
  ADD CONSTRAINT "DocumentDownloadGrant_last_download" CHECK (("downloadCount" = 0) = ("lastDownloadAt" IS NULL));

ALTER TABLE "LeadDocumentDownload"
  ADD CONSTRAINT "LeadDocumentDownload_byte_size" CHECK ("byteSize" >= 1),
  ADD CONSTRAINT "LeadDocumentDownload_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "PublicRateLimit"
  ADD CONSTRAINT "PublicRateLimit_key_format" CHECK ("key" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "PublicRateLimit_count" CHECK ("count" >= 1),
  ADD CONSTRAINT "PublicRateLimit_window" CHECK ("expiresAt" > "windowStartedAt");

-- A request belongs to its lead's site, and the grant and downloads to the request's site.
CREATE FUNCTION leads_request_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'leads: document requests are evidence and cannot change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Lead" l WHERE l."id" = NEW."leadId" AND l."siteId" = NEW."siteId") THEN
    RAISE EXCEPTION 'leads: a request must belong to a lead of the same site'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "ProductDocument" d
                 WHERE d."id" = NEW."documentId" AND d."productId" = NEW."productId"
                   AND d."accessPolicy" = 'LEAD_REQUIRED' AND d."status" = 'ACTIVE') THEN
    RAISE EXCEPTION 'leads: only an active lead-gated document of the product can be requested'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "LeadDocumentRequest_guard" BEFORE INSERT OR UPDATE OR DELETE ON "LeadDocumentRequest"
  FOR EACH ROW EXECUTE FUNCTION leads_request_guard();

CREATE FUNCTION leads_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM "LeadDocumentRequest" r
                   WHERE r."id" = NEW."requestId" AND r."siteId" = NEW."siteId") THEN
      RAISE EXCEPTION 'leads: a grant must belong to a request of the same site'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."downloadCount" <> 0 THEN
      RAISE EXCEPTION 'leads: a new grant has no downloads' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: only the counter moves, by one, before expiry.
  IF NEW."id" <> OLD."id" OR NEW."requestId" <> OLD."requestId" OR NEW."siteId" <> OLD."siteId"
     OR NEW."tokenHash" <> OLD."tokenHash" OR NEW."expiresAt" <> OLD."expiresAt"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'leads: a grant cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."downloadCount" <> OLD."downloadCount" + 1 OR OLD."expiresAt" <= now() THEN
    RAISE EXCEPTION 'leads: a grant is used once per download and only before it expires'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "DocumentDownloadGrant_guard" BEFORE INSERT OR UPDATE ON "DocumentDownloadGrant"
  FOR EACH ROW EXECUTE FUNCTION leads_grant_guard();

CREATE FUNCTION leads_download_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'leads: download records cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "DocumentDownloadGrant" g
                 WHERE g."id" = NEW."grantId" AND g."requestId" = NEW."requestId"
                   AND g."siteId" = NEW."siteId") THEN
    RAISE EXCEPTION 'leads: a download must match its grant, request and site'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "LeadDocumentDownload_guard" BEFORE INSERT OR UPDATE OR DELETE ON "LeadDocumentDownload"
  FOR EACH ROW EXECUTE FUNCTION leads_download_guard();

-- ===========================================================================================
-- Part 3: privileges (ADR-012A default privileges gave dp_app full DML on the new tables)
-- ===========================================================================================

-- Leads are updated with the latest details, never deleted by the API (erasure: DP-096).
REVOKE DELETE ON TABLE "Lead" FROM dp_app;
-- Requests and downloads are append-only evidence (plus the triggers above).
REVOKE UPDATE, DELETE ON TABLE "LeadDocumentRequest" FROM dp_app;
REVOKE UPDATE, DELETE ON TABLE "LeadDocumentDownload" FROM dp_app;
-- Grants: only the counter and the last download time move (plus the trigger).
REVOKE UPDATE, DELETE ON TABLE "DocumentDownloadGrant" FROM dp_app;
GRANT UPDATE ("downloadCount", "lastDownloadAt") ON TABLE "DocumentDownloadGrant" TO dp_app;
-- PublicRateLimit keeps the default DML: buckets are upserted and expired buckets deleted.
