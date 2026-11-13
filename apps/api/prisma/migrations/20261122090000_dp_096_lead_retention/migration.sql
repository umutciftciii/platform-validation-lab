-- DP-096 (owner decision 2026-11-12; ADR-003 §4-5, ADR-016 D10): lead retention, anonymisation
-- and erasure on request.
--
-- Runs as dp_owner (ADR-012A). Additive for data: no row is changed or deleted here. It adds
-- the anonymisation and hold columns, lets the two re-linkable references be cleared, and gives
-- the new least-privilege role dp_lead_retention exactly the column rights the anonymisation needs.
-- The role itself is a cluster object created by infra/docker/postgres/dp-roles.sql (NOLOGIN;
-- the operator credential dp_iam_bootstrap may SET ROLE to it, dp_app may not).
--
-- What the database enforces from here on:
--   - only dp_lead_retention clears identity fields, and only to the anonymised values;
--   - an anonymised lead never changes again; a held lead (customer, open opportunity, legal
--     hold) cannot be anonymised;
--   - evidence rows stay append-only for everyone else; download records keep their foreign keys;
--   - grants can be deleted only when they were never used and expired more than 30 days ago;
--   - dp_app can no longer change a lead's e-mail, anonymisation or hold columns.
-- Tested in test/integration/leads.int.test.ts (DP-096) and db-roles.int.test.ts.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_lead_retention') THEN
    RAISE EXCEPTION 'DP-096: database role dp_lead_retention missing; run infra/docker/stack.sh db-roles <dev|prod> --yes first (dp-roles.sql)';
  END IF;
END $$;

-- ===========================================================================================
-- Part 1: columns (follows `prisma migrate diff`)
-- ===========================================================================================
CREATE TYPE "LeadRetentionHold" AS ENUM ('CUSTOMER', 'OPEN_OPPORTUNITY', 'LEGAL_HOLD');

ALTER TABLE "Lead" ADD COLUMN "anonymisedAt" TIMESTAMPTZ(3),
ADD COLUMN "retentionHold" "LeadRetentionHold",
ADD COLUMN "retentionHoldAt" TIMESTAMPTZ(3);

ALTER TABLE "LeadDocumentRequest" ALTER COLUMN "reference" DROP NOT NULL;

ALTER TABLE "LeadDocumentDownload" ALTER COLUMN "sha256" DROP NOT NULL;

-- ===========================================================================================
-- Part 2: consistency (CHECK)
-- ===========================================================================================
-- An anonymised lead carries exactly the anonymised values; the e-mail keeps the unique key.
ALTER TABLE "Lead"
  DROP CONSTRAINT "Lead_full_name_trimmed",
  ADD CONSTRAINT "Lead_full_name_trimmed"
    CHECK ("fullName" = btrim("fullName") AND ("fullName" <> '' OR "anonymisedAt" IS NOT NULL)),
  DROP CONSTRAINT "Lead_company_trimmed",
  ADD CONSTRAINT "Lead_company_trimmed"
    CHECK ("company" = btrim("company") AND ("company" <> '' OR "anonymisedAt" IS NOT NULL)),
  ADD CONSTRAINT "Lead_anonymised" CHECK (
    "anonymisedAt" IS NULL
    OR ("email" = 'anonymised+' || "id"::text || '@anonymised.invalid'
        AND "fullName" = '' AND "company" = ''
        AND "marketingConsentAt" IS NULL AND "retentionHold" IS NULL)),
  ADD CONSTRAINT "Lead_hold" CHECK (("retentionHold" IS NULL) = ("retentionHoldAt" IS NULL));

-- A request without its reference is an anonymised one: identity and link fields are all gone.
ALTER TABLE "LeadDocumentRequest"
  DROP CONSTRAINT "LeadDocumentRequest_full_name_trimmed",
  ADD CONSTRAINT "LeadDocumentRequest_full_name_trimmed"
    CHECK ("fullName" = btrim("fullName") AND ("fullName" <> '' OR "reference" IS NULL)),
  DROP CONSTRAINT "LeadDocumentRequest_company_trimmed",
  ADD CONSTRAINT "LeadDocumentRequest_company_trimmed"
    CHECK ("company" = btrim("company") AND ("company" <> '' OR "reference" IS NULL)),
  ADD CONSTRAINT "LeadDocumentRequest_anonymised" CHECK (
    "reference" IS NOT NULL
    OR ("fullName" = '' AND "company" = '' AND "ipPrefixHmac" IS NULL AND "requestId" IS NULL));

-- ===========================================================================================
-- Part 3: guards (triggers)
-- ===========================================================================================

-- Leads: dp_app keeps updating the latest details of a live lead; only dp_lead_retention
-- anonymises or sets/clears a hold; an anonymised lead is final.
CREATE FUNCTION leads_lead_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  retention_cols text[] := ARRAY['email', 'fullName', 'company', 'marketingConsentAt',
                                 'anonymisedAt', 'retentionHold', 'retentionHoldAt', 'updatedAt'];
BEGIN
  IF OLD."anonymisedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'leads: an anonymised lead cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF current_user = 'dp_lead_retention' THEN
    IF (to_jsonb(NEW) - retention_cols) IS DISTINCT FROM (to_jsonb(OLD) - retention_cols) THEN
      RAISE EXCEPTION 'leads: retention may only anonymise a lead or set its hold'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."anonymisedAt" IS NULL AND (
         NEW."email" IS DISTINCT FROM OLD."email" OR NEW."fullName" IS DISTINCT FROM OLD."fullName"
         OR NEW."company" IS DISTINCT FROM OLD."company"
         OR NEW."marketingConsentAt" IS DISTINCT FROM OLD."marketingConsentAt") THEN
      RAISE EXCEPTION 'leads: identity fields change only by anonymisation'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."siteId" IS DISTINCT FROM OLD."siteId"
     OR NEW."email" IS DISTINCT FROM OLD."email"
     OR NEW."anonymisedAt" IS DISTINCT FROM OLD."anonymisedAt"
     OR NEW."retentionHold" IS DISTINCT FROM OLD."retentionHold"
     OR NEW."retentionHoldAt" IS DISTINCT FROM OLD."retentionHoldAt" THEN
    RAISE EXCEPTION 'leads: e-mail, anonymisation and hold are changed by retention only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "Lead_guard" BEFORE UPDATE ON "Lead"
  FOR EACH ROW EXECUTE FUNCTION leads_lead_guard();

-- Requests: still append-only, except that dp_lead_retention clears identity and link fields
-- (anonymisation) or the IP prefix HMAC (90 days, D-R2). Nothing else may change; nothing is
-- deleted.
CREATE OR REPLACE FUNCTION leads_request_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  clearable text[] := ARRAY['fullName', 'company', 'ipPrefixHmac', 'reference', 'requestId'];
BEGIN
  IF TG_OP = 'UPDATE' AND current_user = 'dp_lead_retention' THEN
    IF (to_jsonb(NEW) - clearable) IS DISTINCT FROM (to_jsonb(OLD) - clearable)
       OR (NEW."fullName" IS DISTINCT FROM OLD."fullName" AND NEW."fullName" <> '')
       OR (NEW."company" IS DISTINCT FROM OLD."company" AND NEW."company" <> '')
       OR (NEW."ipPrefixHmac" IS DISTINCT FROM OLD."ipPrefixHmac" AND NEW."ipPrefixHmac" IS NOT NULL)
       OR (NEW."reference" IS DISTINCT FROM OLD."reference" AND NEW."reference" IS NOT NULL)
       OR (NEW."requestId" IS DISTINCT FROM OLD."requestId" AND NEW."requestId" IS NOT NULL) THEN
      RAISE EXCEPTION 'leads: retention may only clear identity and link fields of a request'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
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

-- Downloads: append-only, except that dp_lead_retention clears the stamped file's hash and the
-- HTTP request id (both re-link a delivered PDF to the record, D-R5).
CREATE OR REPLACE FUNCTION leads_download_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  clearable text[] := ARRAY['sha256', 'httpRequestId'];
BEGIN
  IF TG_OP = 'UPDATE' AND current_user = 'dp_lead_retention' THEN
    IF (to_jsonb(NEW) - clearable) IS DISTINCT FROM (to_jsonb(OLD) - clearable)
       OR (NEW."sha256" IS DISTINCT FROM OLD."sha256" AND NEW."sha256" IS NOT NULL)
       OR (NEW."httpRequestId" IS DISTINCT FROM OLD."httpRequestId" AND NEW."httpRequestId" IS NOT NULL) THEN
      RAISE EXCEPTION 'leads: retention may only clear the link fields of a download'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
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

-- Grants (D-R3): a used grant is kept with its download evidence (the foreign key would refuse
-- anyway); an unused one may go 30 days after it expired. Applies to every role.
CREATE FUNCTION leads_grant_delete_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  IF OLD."downloadCount" <> 0 OR OLD."expiresAt" > now() - interval '30 days' THEN
    RAISE EXCEPTION 'leads: only an unused grant that expired more than 30 days ago can be deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END
$fn$;
CREATE TRIGGER "DocumentDownloadGrant_delete_guard" BEFORE DELETE ON "DocumentDownloadGrant"
  FOR EACH ROW EXECUTE FUNCTION leads_grant_delete_guard();

-- ===========================================================================================
-- Part 4: privileges
-- ===========================================================================================

-- dp_app: the latest details of a live lead only (lead-requests.service); never the e-mail, the
-- anonymisation or the hold.
REVOKE UPDATE ON TABLE "Lead" FROM dp_app;
GRANT UPDATE ("fullName", "company", "country", "freeMailDomain", "marketingConsentAt",
              "requestCount", "lastRequestAt", "updatedAt") ON TABLE "Lead" TO dp_app;

-- dp_lead_retention: read what it plans with, clear exactly the fields of the anonymisation,
-- delete unused expired grants and expired rate-limit buckets, and audit its runs.
GRANT USAGE ON SCHEMA public TO dp_lead_retention;
GRANT SELECT ON TABLE "Lead", "LeadDocumentRequest", "LeadDocumentDownload",
                      "DocumentDownloadGrant", "PublicRateLimit", "Site" TO dp_lead_retention;
GRANT UPDATE ("email", "fullName", "company", "marketingConsentAt", "anonymisedAt",
              "retentionHold", "retentionHoldAt", "updatedAt") ON TABLE "Lead" TO dp_lead_retention;
GRANT UPDATE ("fullName", "company", "ipPrefixHmac", "reference", "requestId")
  ON TABLE "LeadDocumentRequest" TO dp_lead_retention;
GRANT UPDATE ("sha256", "httpRequestId") ON TABLE "LeadDocumentDownload" TO dp_lead_retention;
GRANT DELETE ON TABLE "DocumentDownloadGrant", "PublicRateLimit" TO dp_lead_retention;
GRANT INSERT ON TABLE "AuditEvent" TO dp_lead_retention;
