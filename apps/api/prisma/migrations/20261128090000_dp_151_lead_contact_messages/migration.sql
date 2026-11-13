-- DP-151: contact-form messages. One message per form sent, attached to the sender's lead on the
-- site, with the version and SHA-256 of the notice shown next to the form (information, not
-- consent; the form has no consent boxes, owner decision 2026-11-13). Same protection and lifecycle as "LeadDocumentRequest":
-- append-only for dp_app, cleared (never deleted) by dp_lead_retention when the lead is
-- anonymised (DP-096), row-level security like the other lead tables (DP-103).
--
-- Runs as dp_owner (ADR-012A). Additive: one new table, CHECK constraints, a guard trigger,
-- privilege exceptions and policies. One existing function body changes: the retention plan also
-- counts the messages' IP prefix HMACs due after 90 days (same signature and grants). No existing
-- table, column or row changes. The
-- table, its privileges and its policies are created together, so dp_app never sees the table
-- without row-level security. Tested in test/integration/leads.int.test.ts.
--
-- Part 1 follows `prisma migrate diff --from-schema <main> --to-schema schema.prisma`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_lead_retention') THEN
    RAISE EXCEPTION 'DP-151: database roles missing; run infra/docker/stack.sh db-roles <dev|prod> --yes first (dp-roles.sql)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'leads_rls_public_site_id') THEN
    RAISE EXCEPTION 'DP-151: migration 20261123090000_dp_103_lead_row_level_security must be applied first';
  END IF;
END $$;

-- ===========================================================================================
-- Part 1: table and indexes (generated)
-- ===========================================================================================
-- CreateTable
CREATE TABLE "LeadContactMessage" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "company" VARCHAR(160) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "phone" VARCHAR(40),
    "subject" VARCHAR(160),
    "message" VARCHAR(4000),
    "privacyNoticeVersion" VARCHAR(20) NOT NULL,
    "privacyNoticeSha256" CHAR(64) NOT NULL,
    "ipPrefixHmac" CHAR(64),
    "requestId" VARCHAR(100),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redactedAt" TIMESTAMPTZ(3),

    CONSTRAINT "LeadContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadContactMessage_siteId_createdAt_idx" ON "LeadContactMessage"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadContactMessage_leadId_createdAt_idx" ON "LeadContactMessage"("leadId", "createdAt");

-- AddForeignKey
ALTER TABLE "LeadContactMessage" ADD CONSTRAINT "LeadContactMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadContactMessage" ADD CONSTRAINT "LeadContactMessage_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================================
-- Part 2: checks and the guard trigger
-- ===========================================================================================

-- Until redaction every text is trimmed and present; after it, name and company are '' and
-- phone, subject, message and the links are null.
ALTER TABLE "LeadContactMessage"
  ADD CONSTRAINT "LeadContactMessage_full_name_trimmed"
    CHECK ("fullName" = btrim("fullName") AND ("fullName" <> '' OR "redactedAt" IS NOT NULL)),
  ADD CONSTRAINT "LeadContactMessage_company_trimmed"
    CHECK ("company" = btrim("company") AND ("company" <> '' OR "redactedAt" IS NOT NULL)),
  ADD CONSTRAINT "LeadContactMessage_country_format" CHECK ("country" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "LeadContactMessage_phone_format"
    CHECK ("phone" IS NULL OR ("phone" = btrim("phone") AND "phone" ~ '^[+0-9 ()./-]{1,40}$')),
  ADD CONSTRAINT "LeadContactMessage_subject_trimmed"
    CHECK ("subject" IS NULL OR ("subject" = btrim("subject") AND "subject" <> '')),
  ADD CONSTRAINT "LeadContactMessage_message_present"
    CHECK (("message" IS NOT NULL AND "message" = btrim("message") AND char_length("message") >= 10)
           OR ("message" IS NULL AND "redactedAt" IS NOT NULL)),
  ADD CONSTRAINT "LeadContactMessage_redacted"
    CHECK ("redactedAt" IS NULL
           OR ("fullName" = '' AND "company" = '' AND "phone" IS NULL AND "subject" IS NULL
               AND "message" IS NULL AND "ipPrefixHmac" IS NULL AND "requestId" IS NULL)),
  ADD CONSTRAINT "LeadContactMessage_notice_version"
    CHECK ("privacyNoticeVersion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]+)?(\.[a-z]{2})?$'),
  ADD CONSTRAINT "LeadContactMessage_notice_sha256" CHECK ("privacyNoticeSha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "LeadContactMessage_ip_hmac_format"
    CHECK ("ipPrefixHmac" IS NULL OR "ipPrefixHmac" ~ '^[0-9a-f]{64}$');

-- Append-only evidence. dp_lead_retention may only redact: clear the identity and text fields
-- and set "redactedAt" once. A message belongs to a lead of the same site that is not anonymised
-- (an anonymised lead never changes again; the same e-mail then starts a new lead).
CREATE FUNCTION leads_contact_message_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  clearable text[] := ARRAY['fullName', 'company', 'phone', 'subject', 'message',
                            'ipPrefixHmac', 'requestId', 'redactedAt'];
BEGIN
  IF TG_OP = 'UPDATE' AND current_user = 'dp_lead_retention' THEN
    IF (to_jsonb(NEW) - clearable) IS DISTINCT FROM (to_jsonb(OLD) - clearable)
       OR (NEW."fullName" IS DISTINCT FROM OLD."fullName" AND NEW."fullName" <> '')
       OR (NEW."company" IS DISTINCT FROM OLD."company" AND NEW."company" <> '')
       OR (NEW."phone" IS DISTINCT FROM OLD."phone" AND NEW."phone" IS NOT NULL)
       OR (NEW."subject" IS DISTINCT FROM OLD."subject" AND NEW."subject" IS NOT NULL)
       OR (NEW."message" IS DISTINCT FROM OLD."message" AND NEW."message" IS NOT NULL)
       OR (NEW."ipPrefixHmac" IS DISTINCT FROM OLD."ipPrefixHmac" AND NEW."ipPrefixHmac" IS NOT NULL)
       OR (NEW."requestId" IS DISTINCT FROM OLD."requestId" AND NEW."requestId" IS NOT NULL)
       OR (OLD."redactedAt" IS NOT NULL AND NEW."redactedAt" IS DISTINCT FROM OLD."redactedAt") THEN
      RAISE EXCEPTION 'leads: retention may only clear the identity and text fields of a contact message'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'leads: contact messages are evidence and cannot change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."redactedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'leads: a new contact message cannot be redacted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Lead" l
                 WHERE l."id" = NEW."leadId" AND l."siteId" = NEW."siteId"
                   AND l."anonymisedAt" IS NULL) THEN
    RAISE EXCEPTION 'leads: a contact message must belong to an active lead of the same site'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "LeadContactMessage_guard" BEFORE INSERT OR UPDATE OR DELETE ON "LeadContactMessage"
  FOR EACH ROW EXECUTE FUNCTION leads_contact_message_guard();

-- ===========================================================================================
-- Part 3: privileges (ADR-012A default privileges gave dp_app full DML on the new table)
-- ===========================================================================================

-- Messages are append-only evidence for the API.
REVOKE UPDATE, DELETE ON TABLE "LeadContactMessage" FROM dp_app;
-- Retention reads and clears exactly the redaction fields; it never deletes.
GRANT SELECT ON TABLE "LeadContactMessage" TO dp_lead_retention;
GRANT UPDATE ("fullName", "company", "phone", "subject", "message", "ipPrefixHmac", "requestId",
              "redactedAt") ON TABLE "LeadContactMessage" TO dp_lead_retention;

-- ===========================================================================================
-- Part 4: row-level security (DP-103 pattern)
-- ===========================================================================================
-- Staff read where they read leads (lead:read on the site). The public site writes a message for
-- the lead of its own context (site and e-mail) and reads it back once (RETURNING). Retention
-- reads and redacts. No policy deletes.
ALTER TABLE "LeadContactMessage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_staff_read ON "LeadContactMessage" FOR SELECT TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT leads_rls_staff_site_ids()), '{}'::uuid[])));
CREATE POLICY contact_public_read ON "LeadContactMessage" FOR SELECT TO dp_app
  USING ("siteId" = (SELECT leads_rls_public_site_id())
         AND EXISTS (SELECT 1 FROM "Lead" l
                     WHERE l."id" = "LeadContactMessage"."leadId"
                       AND l."siteId" = "LeadContactMessage"."siteId"));
CREATE POLICY contact_public_insert ON "LeadContactMessage" FOR INSERT TO dp_app
  WITH CHECK ("siteId" = (SELECT leads_rls_public_site_id())
              AND EXISTS (SELECT 1 FROM "Lead" l
                          WHERE l."id" = "LeadContactMessage"."leadId"
                            AND l."siteId" = "LeadContactMessage"."siteId"));
CREATE POLICY contact_retention_read ON "LeadContactMessage" FOR SELECT TO dp_lead_retention
  USING (true);
CREATE POLICY contact_retention_update ON "LeadContactMessage" FOR UPDATE TO dp_lead_retention
  USING (true) WITH CHECK (true);

-- ===========================================================================================
-- Part 5: retention plan (DP-096 D-R2) also counts the messages' IP prefix HMACs
-- ===========================================================================================
-- Same signature, return columns and privileges (CREATE OR REPLACE keeps the grants); only the
-- third count adds the contact messages, which the run clears after 90 days like requests.
CREATE OR REPLACE FUNCTION leads_retention_plan(
  cutoff_lead timestamptz, cutoff_ip_hmac timestamptz, cutoff_unused_grant timestamptz,
  at_time timestamptz)
RETURNS TABLE (leads_due bigint, leads_held bigint, ip_hmac_due bigint, unused_grants_due bigint,
               buckets_due bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT
    (SELECT count(*) FROM "Lead" l WHERE l."anonymisedAt" IS NULL AND l."retentionHold" IS NULL
       AND l."status" NOT IN ('QUALIFIED', 'CONVERTED')
       AND GREATEST(l."lastRequestAt", COALESCE(l."marketingConsentAt", l."lastRequestAt")) < cutoff_lead),
    (SELECT count(*) FROM "Lead" l WHERE l."anonymisedAt" IS NULL
       AND (l."retentionHold" IS NOT NULL OR l."status" IN ('QUALIFIED', 'CONVERTED'))
       AND GREATEST(l."lastRequestAt", COALESCE(l."marketingConsentAt", l."lastRequestAt")) < cutoff_lead),
    (SELECT count(*) FROM "LeadDocumentRequest" r
       WHERE r."ipPrefixHmac" IS NOT NULL AND r."createdAt" < cutoff_ip_hmac)
    + (SELECT count(*) FROM "LeadContactMessage" m
       WHERE m."ipPrefixHmac" IS NOT NULL AND m."createdAt" < cutoff_ip_hmac),
    (SELECT count(*) FROM "DocumentDownloadGrant" g
       WHERE g."downloadCount" = 0 AND g."expiresAt" < cutoff_unused_grant),
    (SELECT count(*) FROM "PublicRateLimit" b WHERE b."expiresAt" <= at_time)
$fn$;
