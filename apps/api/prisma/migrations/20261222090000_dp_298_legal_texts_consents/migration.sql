-- DP-298 (ADR-031): data processing policies.
--
--  * "LegalTextVersion": the legal and consent texts, versioned and managed in the admin (Legal
--    texts). A DRAFT may change; a PUBLISHED version never changes again (trigger): its version
--    name, text and SHA-256 are the evidence that forms store. The newest published version of a
--    document and language is the current one. Seeded below with the texts that were constants in
--    @dream/contracts (same words, versions and SHA-256), so evidence stored before DP-298 still
--    matches; the Dutch translations stay drafts (ADR-028 D12, review required).
--  * "ConsentRecord": consent, separate from information. One append-only row per grant (from a
--    form, with the consent text's version and SHA-256) or withdrawal (by staff with lead:manage,
--    with the channel it came through; no free text). The latest row per lead and purpose is the
--    state. Notices stay acknowledged on the request rows as before (version + SHA-256).
--    Backfilled from the document requests that ticked the marketing box.
--  * "AiProviderDataTerms": what the owner recorded about a provider before personal data may be
--    sent to it (DPA, transfer mechanism under the GDPR and, separately, KVKK, retention, no
--    training). Append-only; revoking stamps `revokedAt`. Read by the AI personal-data gate.

-- =============================================================================================
-- Part 1: types and tables
-- =============================================================================================

CREATE TYPE "LegalDocumentKey" AS ENUM ('PRIVACY_POLICY', 'DOCUMENT_REQUEST_NOTICE',
  'CONTACT_NOTICE', 'MARKETING_CONSENT', 'AI_PROCESSING_NOTICE', 'AI_PROCESSING_CONSENT',
  'INTERNATIONAL_TRANSFER_NOTICE', 'INTERNATIONAL_TRANSFER_CONSENT');
CREATE TYPE "LegalTextStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "LegalReviewState" AS ENUM ('REQUIRED', 'APPROVED');
CREATE TYPE "ConsentPurpose" AS ENUM ('MARKETING_EMAIL', 'AI_PERSONAL_DATA', 'INTERNATIONAL_TRANSFER');
CREATE TYPE "ConsentAction" AS ENUM ('GRANTED', 'WITHDRAWN');
CREATE TYPE "ConsentSource" AS ENUM ('DOCUMENT_REQUEST', 'CONTACT_FORM', 'STAFF', 'PUBLIC_LINK', 'MIGRATION');
CREATE TYPE "ConsentChannel" AS ENUM ('EMAIL', 'PHONE', 'WRITTEN', 'IN_PERSON', 'OTHER');
CREATE TYPE "AiTransferMechanism" AS ENUM ('EEA_ONLY', 'ADEQUACY', 'EU_US_DPF', 'SCC');
CREATE TYPE "AiKvkkTransferMechanism" AS ENUM ('NOT_APPLICABLE', 'ADEQUACY', 'STANDARD_CONTRACT_NOTIFIED', 'EXPLICIT_CONSENT');

CREATE TABLE "LegalTextVersion" (
    "id" UUID NOT NULL,
    "key" "LegalDocumentKey" NOT NULL,
    "locale" VARCHAR(8) NOT NULL,
    "version" VARCHAR(20),
    "status" "LegalTextStatus" NOT NULL DEFAULT 'DRAFT',
    "legalReview" "LegalReviewState" NOT NULL DEFAULT 'REQUIRED',
    "reviewNote" VARCHAR(2000),
    "text" TEXT NOT NULL,
    "sections" JSONB,
    "sha256" CHAR(64) NOT NULL,
    "translatesId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),
    "publishedById" UUID,
    "reviewApprovedAt" TIMESTAMPTZ(3),
    "reviewApprovedById" UUID,

    CONSTRAINT "LegalTextVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsentRecord" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "action" "ConsentAction" NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "textVersion" VARCHAR(20),
    "textSha256" CHAR(64),
    "sourceRecordId" UUID,
    "channel" "ConsentChannel",
    "actorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiProviderDataTerms" (
    "id" UUID NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "dpaReference" VARCHAR(200) NOT NULL,
    "dpaSignedOn" DATE NOT NULL,
    "transferMechanism" "AiTransferMechanism" NOT NULL,
    "kvkkTransferMechanism" "AiKvkkTransferMechanism" NOT NULL,
    "dataRegion" VARCHAR(100) NOT NULL,
    "retentionSetting" VARCHAR(200) NOT NULL,
    "noTraining" BOOLEAN NOT NULL,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedById" UUID,

    CONSTRAINT "AiProviderDataTerms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalTextVersion_key_locale_version_key" ON "LegalTextVersion"("key", "locale", "version");
CREATE UNIQUE INDEX "LegalTextVersion_one_draft" ON "LegalTextVersion"("key", "locale") WHERE "status" = 'DRAFT';
CREATE INDEX "LegalTextVersion_key_locale_status_publishedAt_idx" ON "LegalTextVersion"("key", "locale", "status", "publishedAt");
CREATE INDEX "ConsentRecord_leadId_purpose_createdAt_idx" ON "ConsentRecord"("leadId", "purpose", "createdAt");
CREATE INDEX "ConsentRecord_siteId_createdAt_idx" ON "ConsentRecord"("siteId", "createdAt");
CREATE UNIQUE INDEX "AiProviderDataTerms_active_provider_key" ON "AiProviderDataTerms"("provider") WHERE "revokedAt" IS NULL;
CREATE INDEX "AiProviderDataTerms_provider_recordedAt_idx" ON "AiProviderDataTerms"("provider", "recordedAt");

ALTER TABLE "LegalTextVersion" ADD CONSTRAINT "LegalTextVersion_translatesId_fkey" FOREIGN KEY ("translatesId") REFERENCES "LegalTextVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalTextVersion" ADD CONSTRAINT "LegalTextVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalTextVersion" ADD CONSTRAINT "LegalTextVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalTextVersion" ADD CONSTRAINT "LegalTextVersion_reviewApprovedById_fkey" FOREIGN KEY ("reviewApprovedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiProviderDataTerms" ADD CONSTRAINT "AiProviderDataTerms_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiProviderDataTerms" ADD CONSTRAINT "AiProviderDataTerms_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================================
-- Part 2: checks
-- =============================================================================================

ALTER TABLE "LegalTextVersion"
  ADD CONSTRAINT "LegalTextVersion_locale_format" CHECK ("locale" ~ '^[a-z]{2}$'),
  -- Published: named, stamped. The name ends with the language, except the 2026-11-11 English
  -- archive texts that predate the language suffix (D-T6).
  ADD CONSTRAINT "LegalTextVersion_published"
    CHECK (("status" = 'DRAFT' AND "version" IS NULL AND "publishedAt" IS NULL AND "publishedById" IS NULL)
           OR ("status" = 'PUBLISHED' AND "version" IS NOT NULL AND "publishedAt" IS NOT NULL)),
  ADD CONSTRAINT "LegalTextVersion_version_format"
    CHECK ("version" IS NULL
           OR ("version" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]+)?(\.[a-z]{2})?$'
               AND ("version" LIKE '%.' || "locale"
                    OR ("locale" = 'en' AND "version" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')))),
  ADD CONSTRAINT "LegalTextVersion_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "LegalTextVersion_text_present" CHECK (char_length(btrim("text")) > 0 AND char_length("text") <= 60000),
  -- Only the privacy policy is structured (sections); the other texts are one plain text.
  ADD CONSTRAINT "LegalTextVersion_sections"
    CHECK (("key" = 'PRIVACY_POLICY') = ("sections" IS NOT NULL)
           AND ("sections" IS NULL OR jsonb_typeof("sections") = 'array')),
  ADD CONSTRAINT "LegalTextVersion_review_stamp"
    CHECK (("legalReview" = 'APPROVED') = ("reviewApprovedAt" IS NOT NULL)),
  ADD CONSTRAINT "LegalTextVersion_translates_self" CHECK ("translatesId" IS NULL OR "translatesId" <> "id"),
  ADD CONSTRAINT "LegalTextVersion_revision" CHECK ("revision" >= 1);

ALTER TABLE "ConsentRecord"
  -- A grant names the text shown and the form that carried it; a withdrawal names its channel.
  ADD CONSTRAINT "ConsentRecord_grant"
    CHECK ("action" <> 'GRANTED'
           OR ("textVersion" IS NOT NULL AND "textSha256" IS NOT NULL AND "channel" IS NULL
               AND "source" IN ('DOCUMENT_REQUEST', 'CONTACT_FORM', 'PUBLIC_LINK', 'MIGRATION'))),
  ADD CONSTRAINT "ConsentRecord_withdrawal"
    CHECK ("action" <> 'WITHDRAWN'
           OR ("textVersion" IS NULL AND "textSha256" IS NULL AND "channel" IS NOT NULL
               AND "source" IN ('STAFF', 'PUBLIC_LINK'))),
  ADD CONSTRAINT "ConsentRecord_staff_actor" CHECK (("source" = 'STAFF') = ("actorId" IS NOT NULL)),
  ADD CONSTRAINT "ConsentRecord_version_format"
    CHECK ("textVersion" IS NULL OR "textVersion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]+)?(\.[a-z]{2})?$'),
  ADD CONSTRAINT "ConsentRecord_sha256_format" CHECK ("textSha256" IS NULL OR "textSha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "AiProviderDataTerms"
  ADD CONSTRAINT "AiProviderDataTerms_texts"
    CHECK (btrim("dpaReference") <> '' AND btrim("dataRegion") <> '' AND btrim("retentionSetting") <> ''),
  -- Personal data never goes to a provider that may train on it (ADR-031 D6).
  ADD CONSTRAINT "AiProviderDataTerms_no_training" CHECK ("noTraining"),
  ADD CONSTRAINT "AiProviderDataTerms_revoked"
    CHECK (("revokedAt" IS NULL) = ("revokedById" IS NULL));

-- =============================================================================================
-- Part 3: guards
-- =============================================================================================

-- A published version is evidence: only its legal review may still be recorded (once, REQUIRED →
-- APPROVED, nothing else changes). Drafts change freely; a published version is never deleted.
CREATE FUNCTION legal_text_version_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  review_cols text[] := ARRAY['legalReview', 'reviewApprovedAt', 'reviewApprovedById', 'updatedAt'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'PUBLISHED' THEN
      RAISE EXCEPTION 'legal texts: a published version cannot be deleted'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'PUBLISHED' THEN
    IF (to_jsonb(NEW) - review_cols) IS DISTINCT FROM (to_jsonb(OLD) - review_cols)
       OR OLD."legalReview" = 'APPROVED' THEN
      RAISE EXCEPTION 'legal texts: a published version cannot change'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."key" IS DISTINCT FROM OLD."key" OR NEW."locale" IS DISTINCT FROM OLD."locale"
     OR NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'legal texts: a draft keeps its document and language'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Publication: the text is frozen as it is now; a translation names a published source.
  IF NEW."status" = 'PUBLISHED' AND NEW."translatesId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "LegalTextVersion" s
                     WHERE s."id" = NEW."translatesId" AND s."status" = 'PUBLISHED'
                       AND s."key" = NEW."key" AND s."locale" <> NEW."locale") THEN
    RAISE EXCEPTION 'legal texts: a translation renders a published version of the same document'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "LegalTextVersion_guard" BEFORE INSERT OR UPDATE OR DELETE ON "LegalTextVersion"
  FOR EACH ROW EXECUTE FUNCTION legal_text_version_guard();

-- Consent records are evidence: insert only. A grant belongs to an active lead of the same site
-- and names a form row of that lead; a withdrawal follows a grant of the same purpose.
CREATE FUNCTION consent_record_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  latest "ConsentAction";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'consents: consent records are evidence and cannot change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Lead" l
                 WHERE l."id" = NEW."leadId" AND l."siteId" = NEW."siteId"
                   AND l."anonymisedAt" IS NULL) THEN
    RAISE EXCEPTION 'consents: a consent record belongs to an active lead of the same site'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."action" = 'GRANTED' AND NEW."source" IN ('DOCUMENT_REQUEST', 'MIGRATION')
     AND NOT EXISTS (SELECT 1 FROM "LeadDocumentRequest" r
                     WHERE r."id" = NEW."sourceRecordId" AND r."leadId" = NEW."leadId"
                       AND r."marketingConsent" AND r."marketingConsentVersion" = NEW."textVersion"
                       AND r."marketingConsentSha256" = NEW."textSha256") THEN
    RAISE EXCEPTION 'consents: a grant names the request that carried it'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."action" = 'GRANTED' AND NEW."source" = 'CONTACT_FORM'
     AND NOT EXISTS (SELECT 1 FROM "LeadContactMessage" m
                     WHERE m."id" = NEW."sourceRecordId" AND m."leadId" = NEW."leadId") THEN
    RAISE EXCEPTION 'consents: a grant names the message that carried it'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."action" = 'WITHDRAWN' THEN
    SELECT c."action" INTO latest FROM "ConsentRecord" c
    WHERE c."leadId" = NEW."leadId" AND c."purpose" = NEW."purpose"
    ORDER BY c."createdAt" DESC, c."id" DESC LIMIT 1;
    IF latest IS DISTINCT FROM 'GRANTED' THEN
      RAISE EXCEPTION 'consents: only a granted consent can be withdrawn'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."source" = 'STAFF' THEN
    IF NEW."actorId" IS DISTINCT FROM public.leads_rls_staff_user_id()
       OR NOT (NEW."siteId" = ANY (COALESCE(public.leads_rls_staff_manage_site_ids(), '{}'::uuid[]))) THEN
      RAISE EXCEPTION 'consents: a withdrawal is recorded by staff with lead:manage, as themselves'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "ConsentRecord_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ConsentRecord"
  FOR EACH ROW EXECUTE FUNCTION consent_record_guard();

-- Provider terms: insert, then at most one revocation (revokedAt/revokedById), never a deletion.
CREATE FUNCTION ai_provider_data_terms_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."revokedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'ai: new provider terms cannot be revoked' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' OR OLD."revokedAt" IS NOT NULL
     OR (to_jsonb(NEW) - ARRAY['revokedAt', 'revokedById'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['revokedAt', 'revokedById']) THEN
    RAISE EXCEPTION 'ai: provider data terms are evidence; they can only be revoked once'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "AiProviderDataTerms_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AiProviderDataTerms"
  FOR EACH ROW EXECUTE FUNCTION ai_provider_data_terms_guard();

-- =============================================================================================
-- Part 4: privileges and row-level security
-- =============================================================================================

-- Consent records: append-only for the API; retention reads them (they hold no identity field).
REVOKE UPDATE, DELETE ON TABLE "ConsentRecord" FROM dp_app;
GRANT SELECT ON TABLE "ConsentRecord" TO dp_lead_retention;
REVOKE DELETE ON TABLE "AiProviderDataTerms" FROM dp_app;

-- AI provider terms: like every AI table (DP-288), row-level security on the AI switch. Readable
-- by the AI Center (ai:read) and by AI invokers (the personal-data gate reads them); recorded and
-- revoked by the system owner only, as themselves.
ALTER TABLE "AiProviderDataTerms" ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_terms_read ON "AiProviderDataTerms" FOR SELECT TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai:read')) OR (SELECT ai_rls_staff_allows('ai:invoke')));
CREATE POLICY ai_terms_insert ON "AiProviderDataTerms" FOR INSERT TO dp_app
  WITH CHECK ((SELECT public.platform_module_enabled('ai')) AND (SELECT iam_rls_staff_is_owner())
              AND "recordedById" = (SELECT leads_rls_staff_user_id()));
CREATE POLICY ai_terms_update ON "AiProviderDataTerms" FOR UPDATE TO dp_app
  USING ((SELECT public.platform_module_enabled('ai')) AND (SELECT iam_rls_staff_is_owner()))
  WITH CHECK ("revokedById" = (SELECT leads_rls_staff_user_id()));

-- Consent records are customer data (DP-103 pattern): staff read where they read leads; staff
-- insert withdrawals where they manage leads; the public form inserts grants for the lead of its
-- own context and reads them back (RETURNING).
ALTER TABLE "ConsentRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_staff_read ON "ConsentRecord" FOR SELECT TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT leads_rls_staff_site_ids()), '{}'::uuid[])));
CREATE POLICY consent_staff_insert ON "ConsentRecord" FOR INSERT TO dp_app
  WITH CHECK ("source" = 'STAFF' AND "action" = 'WITHDRAWN'
              AND "siteId" = ANY (COALESCE((SELECT leads_rls_staff_manage_site_ids()), '{}'::uuid[])));
CREATE POLICY consent_public_read ON "ConsentRecord" FOR SELECT TO dp_app
  USING ("siteId" = (SELECT leads_rls_public_site_id())
         AND EXISTS (SELECT 1 FROM "Lead" l
                     WHERE l."id" = "ConsentRecord"."leadId" AND l."siteId" = "ConsentRecord"."siteId"));
CREATE POLICY consent_public_insert ON "ConsentRecord" FOR INSERT TO dp_app
  WITH CHECK ("action" = 'GRANTED' AND "source" IN ('DOCUMENT_REQUEST', 'CONTACT_FORM')
              AND "siteId" = (SELECT leads_rls_public_site_id())
              AND EXISTS (SELECT 1 FROM "Lead" l
                          WHERE l."id" = "ConsentRecord"."leadId" AND l."siteId" = "ConsentRecord"."siteId"));
CREATE POLICY consent_retention_read ON "ConsentRecord" FOR SELECT TO dp_lead_retention USING (true);

-- =============================================================================================
-- Part 5: backfill — the marketing consents ticked before DP-298
-- =============================================================================================
-- The migration runs as the schema owner (row-level security does not apply to it); the guard
-- accepts MIGRATION grants that name their request with the same version and SHA-256. Leads that
-- are anonymised keep no consent state (their rows are evidence only).
INSERT INTO "ConsentRecord" ("id", "leadId", "siteId", "purpose", "action", "source",
                             "textVersion", "textSha256", "sourceRecordId", "createdAt")
SELECT gen_random_uuid(), r."leadId", r."siteId", 'MARKETING_EMAIL', 'GRANTED', 'MIGRATION',
       r."marketingConsentVersion", r."marketingConsentSha256", r."id", r."createdAt"
FROM "LeadDocumentRequest" r
JOIN "Lead" l ON l."id" = r."leadId" AND l."anonymisedAt" IS NULL
WHERE r."marketingConsent" AND r."marketingConsentVersion" IS NOT NULL
  AND r."marketingConsentSha256" IS NOT NULL
ORDER BY r."createdAt";

-- =============================================================================================
-- Part 6: seed — the texts that were constants in @dream/contracts (generated, byte-exact)
-- =============================================================================================
INSERT INTO "LegalTextVersion" ("id", "key", "locale", "version", "status", "legalReview", "reviewNote", "text", "sections", "sha256", "translatesId", "createdAt", "updatedAt", "publishedAt", "reviewApprovedAt") VALUES (
  '0193d2a0-0000-7000-8000-000000000005', 'DOCUMENT_REQUEST_NOTICE', 'en', '2026-11-11', 'PUBLISHED', 'REQUIRED',
  $note$Archive text (DP-095 D-T7).$note$,
  $txt$Dream Petroleum BV uses the details in this form to send you the requested document, to keep a record of which document was provided to you, and to follow up on your request. The file you receive is marked with your name, company and a request reference. We do not sell your details. You can ask us at any time to see or delete them.$txt$,
  NULL,
  '40480d5d847367c0b09623ea929e774c025eb4b3b9294e8164e93f60e830820f', NULL, '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z', NULL);

INSERT INTO "LegalTextVersion" ("id", "key", "locale", "version", "status", "legalReview", "reviewNote", "text", "sections", "sha256", "translatesId", "createdAt", "updatedAt", "publishedAt", "reviewApprovedAt") VALUES (
  '0193d2a0-0000-7000-8000-000000000006', 'MARKETING_CONSENT', 'en', '2026-11-11', 'PUBLISHED', 'REQUIRED',
  $note$Archive text (DP-095 D-T7).$note$,
  $txt$Yes, send me occasional e-mails about Dream Petroleum products and technical updates. I can unsubscribe at any time.$txt$,
  NULL,
  'a8bf222580c421093ec8705e6c8116e586d3d3e02617ea2f2c07365f0c439c1c', NULL, '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z', NULL);

INSERT INTO "LegalTextVersion" ("id", "key", "locale", "version", "status", "legalReview", "reviewNote", "text", "sections", "sha256", "translatesId", "createdAt", "updatedAt", "publishedAt", "reviewApprovedAt") VALUES (
  '0193d2a0-0000-7000-8000-000000000002', 'DOCUMENT_REQUEST_NOTICE', 'en', '2026-11-12.en', 'PUBLISHED', 'REQUIRED',
  $note$DP-095: wording approved, not final while the D-T2 controller details are missing (was final:false).$note$,
  $txt$Dream Petroleum B.V. uses your name, company, work e-mail and country to send you this document, to keep a record of which document we provided, and to follow up on your request. We do this on the basis of our legitimate interest in answering business enquiries. The PDF you receive is marked with your name, your company and a request reference. We keep these details for 24 months after your last request or your last activity under a marketing consent, then anonymise them. You can ask to see, correct or delete them, or object to this use, as explained in our Privacy Policy.$txt$,
  NULL,
  '98b5b050663282f8f488c59bc5011f9950bc77348c27c2eb1878ff829f39f016', NULL, '2026-11-12T00:00:00Z', '2026-11-12T00:00:00Z', '2026-11-12T00:00:00Z', NULL);

INSERT INTO "LegalTextVersion" ("id", "key", "locale", "version", "status", "legalReview", "reviewNote", "text", "sections", "sha256", "translatesId", "createdAt", "updatedAt", "publishedAt", "reviewApprovedAt") VALUES (
  '0193d2a0-0000-7000-8000-000000000004', 'MARKETING_CONSENT', 'en', '2026-11-12.en', 'PUBLISHED', 'APPROVED',
  $note$DP-095 D-T4: marked final 2026-11-12.$note$,
  $txt$Yes, Dream Petroleum B.V. may e-mail me occasional news about its products and technical updates. I can withdraw this at any time with the link in every e-mail or as explained in the Privacy Policy.$txt$,
  NULL,
  '31a4c75fc2f31fc4ccb8c78d2f8acea8f9c32e0faf93764f9003aa29425d039a', NULL, '2026-11-12T00:00:00Z', '2026-11-12T00:00:00Z', '2026-11-12T00:00:00Z', '2026-11-12T00:00:00Z');

INSERT INTO "LegalTextVersion" ("id", "key", "locale", "version", "status", "legalReview", "reviewNote", "text", "sections", "sha256", "translatesId", "createdAt", "updatedAt", "publishedAt", "reviewApprovedAt") VALUES (
  '0193d2a0-0000-7000-8000-000000000003', 'CONTACT_NOTICE', 'en', '2026-11-13.en', 'PUBLISHED', 'REQUIRED',
  $note$DP-151: draft until Dream Petroleum (or its DPO) approves it.$note$,
  $txt$Dream Petroleum B.V. uses your name, company, e-mail, country, your message and, if you give it, your phone number to answer your enquiry and to keep a record of it. We do this on the basis of our legitimate interest in answering business enquiries. We keep these details for 24 months after your last message or request, then anonymise them. You can ask to see, correct or delete them, or object to this use, as explained in our Privacy Policy.$txt$,
  NULL,
  '17142526d793fabc35d587d73fa0e8f68fe8b1a10975077c376e14b751b56915', NULL, '2026-11-13T00:00:00Z', '2026-11-13T00:00:00Z', '2026-11-13T00:00:00Z', NULL);

INSERT INTO "LegalTextVersion" ("id", "key", "locale", "version", "status", "legalReview", "reviewNote", "text", "sections", "sha256", "translatesId", "createdAt", "updatedAt", "publishedAt", "reviewApprovedAt") VALUES (
  '0193d2a0-0000-7000-8000-000000000001', 'PRIVACY_POLICY', 'en', '2026-11-12.en', 'PUBLISHED', 'REQUIRED',
  $note$DP-095: open points and D-T2 values still render as [pending: …].$note$,
  $txt$## Who is responsible {#controller}

{legalName}, {registeredAddress}, registered with the Netherlands Chamber of Commerce (KvK) under number {kvkNumber}, is responsible (the controller) for the personal data described here.

Questions and requests about your data: {privacyEmail}. Data protection officer: {dpo}.

## What we collect when you request a document {#data}

Some technical documents are available after a short form. With that form we receive:

- your name, company, work e-mail and country;
- whether you agreed to marketing e-mails, and the version of the texts you were shown;
- which document you asked for, when, and when it was downloaded;
- a keyed hash of the network part of your IP address (not the address itself), used only to protect the form against abuse.

## Why we use it, and on what basis {#purposes}

We use these details to send you the document, to keep a record of which document we provided, and to follow up on your request. Our legal basis is our legitimate interest in answering business enquiries (GDPR Art. 6(1)(f)). We have weighed that interest against yours; you can ask us for that assessment.

You can object to this use at any time (GDPR Art. 21). We then stop, unless we have compelling legitimate grounds or need the data for a legal claim.

Marketing e-mails are sent only if you tick the separate, optional box (consent, GDPR Art. 6(1)(a)). It is never needed for a download, and you can withdraw it at any time. We do not send marketing e-mails yet.

## Your name on the PDF {#watermark}

The PDF you receive is marked with your name, your company and a request reference, so that a copy can be traced to its request. Copies you keep or share are outside our systems; we cannot recall them.

## How long we keep it {#retention}

We keep your details for 24 months after your last document request or your last activity under a valid marketing consent. A marketing consent alone does not keep your details indefinitely. After that period we anonymise them: your name, company and e-mail are removed.

The keyed hash of your network address is removed after 90 days.

A record of which text version was shown and accepted is kept without your name, company or e-mail, for {evidenceRetention}.

If you are a customer or we are in an open business discussion with you, our customer records policy applies instead: {customerRecords}.

Backups: {backups}.

## Who can see it {#recipients}

Only staff who need it for your request, with access that is granted per role, limited in time and logged. Service providers who host or run our systems on our behalf: {processors}. We do not sell your data.

Transfers outside the European Economic Area: {transfers}.

## Your rights {#rights}

You can ask to see your data, to correct it, to have it deleted or restricted, to receive it in a common format, and to object to its use. Write to {privacyEmail}. We answer within one month. To protect you, we confirm the request by replying to the e-mail address we hold, and we may keep data where the law requires it.

You can also complain to the {supervisoryAuthority}.

## Cookies {#cookies}

When you request a document, this site sets one strictly necessary cookie that lets your browser download it; it expires after 15 minutes. Full list: {cookies}.

## Changes {#changes}

When this policy or the form texts change, they get a new version; we keep earlier versions so we can show which text you saw.$txt$,
  $json$[{"id":"controller","title":"Who is responsible","paragraphs":["{legalName}, {registeredAddress}, registered with the Netherlands Chamber of Commerce (KvK) under number {kvkNumber}, is responsible (the controller) for the personal data described here.","Questions and requests about your data: {privacyEmail}. Data protection officer: {dpo}."]},{"id":"data","title":"What we collect when you request a document","paragraphs":["Some technical documents are available after a short form. With that form we receive:"],"list":["your name, company, work e-mail and country;","whether you agreed to marketing e-mails, and the version of the texts you were shown;","which document you asked for, when, and when it was downloaded;","a keyed hash of the network part of your IP address (not the address itself), used only to protect the form against abuse."]},{"id":"purposes","title":"Why we use it, and on what basis","paragraphs":["We use these details to send you the document, to keep a record of which document we provided, and to follow up on your request. Our legal basis is our legitimate interest in answering business enquiries (GDPR Art. 6(1)(f)). We have weighed that interest against yours; you can ask us for that assessment.","You can object to this use at any time (GDPR Art. 21). We then stop, unless we have compelling legitimate grounds or need the data for a legal claim.","Marketing e-mails are sent only if you tick the separate, optional box (consent, GDPR Art. 6(1)(a)). It is never needed for a download, and you can withdraw it at any time. We do not send marketing e-mails yet."]},{"id":"watermark","title":"Your name on the PDF","paragraphs":["The PDF you receive is marked with your name, your company and a request reference, so that a copy can be traced to its request. Copies you keep or share are outside our systems; we cannot recall them."]},{"id":"retention","title":"How long we keep it","paragraphs":["We keep your details for 24 months after your last document request or your last activity under a valid marketing consent. A marketing consent alone does not keep your details indefinitely. After that period we anonymise them: your name, company and e-mail are removed.","The keyed hash of your network address is removed after 90 days.","A record of which text version was shown and accepted is kept without your name, company or e-mail, for {evidenceRetention}.","If you are a customer or we are in an open business discussion with you, our customer records policy applies instead: {customerRecords}.","Backups: {backups}."]},{"id":"recipients","title":"Who can see it","paragraphs":["Only staff who need it for your request, with access that is granted per role, limited in time and logged. Service providers who host or run our systems on our behalf: {processors}. We do not sell your data.","Transfers outside the European Economic Area: {transfers}."]},{"id":"rights","title":"Your rights","paragraphs":["You can ask to see your data, to correct it, to have it deleted or restricted, to receive it in a common format, and to object to its use. Write to {privacyEmail}. We answer within one month. To protect you, we confirm the request by replying to the e-mail address we hold, and we may keep data where the law requires it.","You can also complain to the {supervisoryAuthority}."]},{"id":"cookies","title":"Cookies","paragraphs":["When you request a document, this site sets one strictly necessary cookie that lets your browser download it; it expires after 15 minutes. Full list: {cookies}."]},{"id":"changes","title":"Changes","paragraphs":["When this policy or the form texts change, they get a new version; we keep earlier versions so we can show which text you saw."]}]$json$::jsonb,
  '632c8c6fe35a018f9b43b921c5efed08d1523e3745672187e03589d8625821cc', NULL, '2026-11-12T00:00:00Z', '2026-11-12T00:00:00Z', '2026-11-12T00:00:00Z', NULL);

INSERT INTO "LegalTextVersion" ("id", "key", "locale", "version", "status", "legalReview", "reviewNote", "text", "sections", "sha256", "translatesId", "createdAt", "updatedAt", "publishedAt", "reviewApprovedAt") VALUES (
  '0193d2a0-0000-7000-8000-000000000012', 'DOCUMENT_REQUEST_NOTICE', 'nl', NULL, 'DRAFT', 'REQUIRED',
  $note$REVIEW REQUIRED (DP-095): see docs/i18n/legal-texts-nl-review.md.$note$,
  $txt$Dream Petroleum B.V. gebruikt uw naam, bedrijf, zakelijk e-mailadres en land om u dit document te sturen, om bij te houden welk document wij hebben verstrekt en om uw aanvraag op te volgen. Wij doen dit op grond van ons gerechtvaardigd belang bij het beantwoorden van zakelijke vragen. De pdf die u ontvangt, is voorzien van uw naam, uw bedrijf en een aanvraagreferentie. Wij bewaren deze gegevens gedurende 24 maanden na uw laatste aanvraag of uw laatste activiteit onder een marketingtoestemming en anonimiseren ze daarna. U kunt vragen om ze in te zien, te corrigeren of te verwijderen, of bezwaar maken tegen dit gebruik, zoals uitgelegd in ons privacybeleid.$txt$,
  NULL,
  'bc4cd21c84776891c2cdb372b232034dff3ee9be9905ca154cc188b1c3075557', '0193d2a0-0000-7000-8000-000000000002', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL);

INSERT INTO "LegalTextVersion" ("id", "key", "locale", "version", "status", "legalReview", "reviewNote", "text", "sections", "sha256", "translatesId", "createdAt", "updatedAt", "publishedAt", "reviewApprovedAt") VALUES (
  '0193d2a0-0000-7000-8000-000000000014', 'MARKETING_CONSENT', 'nl', NULL, 'DRAFT', 'REQUIRED',
  $note$REVIEW REQUIRED (DP-095): see docs/i18n/legal-texts-nl-review.md.$note$,
  $txt$Ja, Dream Petroleum B.V. mag mij af en toe per e-mail nieuws sturen over haar producten en technische updates. Ik kan dit op elk moment intrekken via de link in elke e-mail of zoals uitgelegd in het privacybeleid.$txt$,
  NULL,
  '7eb5f7661e2b28ecd06e17eb665d515b9087a65b2c8137a8a35b035ddd292a3d', '0193d2a0-0000-7000-8000-000000000004', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL);

INSERT INTO "LegalTextVersion" ("id", "key", "locale", "version", "status", "legalReview", "reviewNote", "text", "sections", "sha256", "translatesId", "createdAt", "updatedAt", "publishedAt", "reviewApprovedAt") VALUES (
  '0193d2a0-0000-7000-8000-000000000013', 'CONTACT_NOTICE', 'nl', NULL, 'DRAFT', 'REQUIRED',
  $note$REVIEW REQUIRED (DP-095): see docs/i18n/legal-texts-nl-review.md.$note$,
  $txt$Dream Petroleum B.V. gebruikt uw naam, bedrijf, e-mailadres, land, uw bericht en, als u dat opgeeft, uw telefoonnummer om uw vraag te beantwoorden en om daarvan een registratie bij te houden. Wij doen dit op grond van ons gerechtvaardigd belang bij het beantwoorden van zakelijke vragen. Wij bewaren deze gegevens gedurende 24 maanden na uw laatste bericht of aanvraag en anonimiseren ze daarna. U kunt vragen om ze in te zien, te corrigeren of te verwijderen, of bezwaar maken tegen dit gebruik, zoals uitgelegd in ons privacybeleid.$txt$,
  NULL,
  '1ddc701090c6e9122dc065f5d1c1ab224fd1a6ab3a49d76eb702b2252aa6a440', '0193d2a0-0000-7000-8000-000000000003', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL);

INSERT INTO "LegalTextVersion" ("id", "key", "locale", "version", "status", "legalReview", "reviewNote", "text", "sections", "sha256", "translatesId", "createdAt", "updatedAt", "publishedAt", "reviewApprovedAt") VALUES (
  '0193d2a0-0000-7000-8000-000000000011', 'PRIVACY_POLICY', 'nl', NULL, 'DRAFT', 'REQUIRED',
  $note$REVIEW REQUIRED (DP-095): see docs/i18n/legal-texts-nl-review.md.$note$,
  $txt$## Wie is verantwoordelijk {#controller}

{legalName}, {registeredAddress}, ingeschreven bij de Nederlandse Kamer van Koophandel (KvK) onder nummer {kvkNumber}, is verantwoordelijk (de verwerkingsverantwoordelijke) voor de hier beschreven persoonsgegevens.

Vragen en verzoeken over uw gegevens: {privacyEmail}. Functionaris voor gegevensbescherming: {dpo}.

## Wat wij verzamelen wanneer u een document aanvraagt {#data}

Sommige technische documenten zijn beschikbaar na een kort formulier. Via dat formulier ontvangen wij:

- uw naam, bedrijf, zakelijk e-mailadres en land;
- of u hebt ingestemd met marketing-e-mails, en de versie van de teksten die u te zien kreeg;
- welk document u hebt aangevraagd, wanneer, en wanneer het is gedownload;
- een met een sleutel berekende hash van het netwerkgedeelte van uw IP-adres (niet het adres zelf), alleen gebruikt om het formulier tegen misbruik te beschermen.

## Waarom wij ze gebruiken, en op welke grondslag {#purposes}

Wij gebruiken deze gegevens om u het document te sturen, om bij te houden welk document wij hebben verstrekt en om uw aanvraag op te volgen. Onze rechtsgrondslag is ons gerechtvaardigd belang bij het beantwoorden van zakelijke vragen (AVG art. 6 lid 1 onder f). Wij hebben dat belang afgewogen tegen het uwe; u kunt ons om die afweging vragen.

U kunt op elk moment bezwaar maken tegen dit gebruik (AVG art. 21). Wij stoppen dan, tenzij wij dwingende gerechtvaardigde gronden hebben of de gegevens nodig hebben voor een rechtsvordering.

Marketing-e-mails worden alleen verstuurd als u het aparte, optionele vakje aanvinkt (toestemming, AVG art. 6 lid 1 onder a). Dit is nooit nodig voor een download, en u kunt de toestemming op elk moment intrekken. Wij versturen nog geen marketing-e-mails.

## Uw naam op de pdf {#watermark}

De pdf die u ontvangt, is voorzien van uw naam, uw bedrijf en een aanvraagreferentie, zodat een kopie kan worden herleid tot de aanvraag. Kopieën die u bewaart of deelt, vallen buiten onze systemen; wij kunnen ze niet terughalen.

## Hoe lang wij ze bewaren {#retention}

Wij bewaren uw gegevens gedurende 24 maanden na uw laatste documentaanvraag of uw laatste activiteit onder een geldige marketingtoestemming. Een marketingtoestemming alleen zorgt er niet voor dat uw gegevens onbeperkt worden bewaard. Na die periode anonimiseren wij ze: uw naam, bedrijf en e-mailadres worden verwijderd.

De met een sleutel berekende hash van uw netwerkadres wordt na 90 dagen verwijderd.

Een registratie van welke tekstversie is getoond en geaccepteerd, wordt zonder uw naam, bedrijf of e-mailadres bewaard, gedurende {evidenceRetention}.

Als u klant bent of als wij met u in een lopend zakelijk gesprek zijn, geldt in plaats daarvan ons beleid voor klantgegevens: {customerRecords}.

Back-ups: {backups}.

## Wie ze kan zien {#recipients}

Alleen medewerkers die ze nodig hebben voor uw aanvraag, met toegang die per rol wordt verleend, in de tijd beperkt is en wordt vastgelegd. Dienstverleners die onze systemen namens ons hosten of beheren: {processors}. Wij verkopen uw gegevens niet.

Doorgiften buiten de Europese Economische Ruimte: {transfers}.

## Uw rechten {#rights}

U kunt vragen om uw gegevens in te zien, te corrigeren, te laten verwijderen of te laten beperken, om ze in een gangbaar formaat te ontvangen, en om bezwaar te maken tegen het gebruik ervan. Schrijf naar {privacyEmail}. Wij antwoorden binnen één maand. Ter bescherming van u bevestigen wij het verzoek door te antwoorden op het e-mailadres dat wij van u hebben, en wij kunnen gegevens bewaren waar de wet dat vereist.

U kunt ook een klacht indienen bij de {supervisoryAuthority}.

## Cookies {#cookies}

Wanneer u een document aanvraagt, plaatst deze site één strikt noodzakelijke cookie waarmee uw browser het document kan downloaden; deze verloopt na 15 minuten. Volledige lijst: {cookies}.

## Wijzigingen {#changes}

Wanneer dit beleid of de formulierteksten wijzigen, krijgen ze een nieuwe versie; wij bewaren eerdere versies, zodat wij kunnen laten zien welke tekst u te zien kreeg.$txt$,
  $json$[{"id":"controller","title":"Wie is verantwoordelijk","paragraphs":["{legalName}, {registeredAddress}, ingeschreven bij de Nederlandse Kamer van Koophandel (KvK) onder nummer {kvkNumber}, is verantwoordelijk (de verwerkingsverantwoordelijke) voor de hier beschreven persoonsgegevens.","Vragen en verzoeken over uw gegevens: {privacyEmail}. Functionaris voor gegevensbescherming: {dpo}."]},{"id":"data","title":"Wat wij verzamelen wanneer u een document aanvraagt","paragraphs":["Sommige technische documenten zijn beschikbaar na een kort formulier. Via dat formulier ontvangen wij:"],"list":["uw naam, bedrijf, zakelijk e-mailadres en land;","of u hebt ingestemd met marketing-e-mails, en de versie van de teksten die u te zien kreeg;","welk document u hebt aangevraagd, wanneer, en wanneer het is gedownload;","een met een sleutel berekende hash van het netwerkgedeelte van uw IP-adres (niet het adres zelf), alleen gebruikt om het formulier tegen misbruik te beschermen."]},{"id":"purposes","title":"Waarom wij ze gebruiken, en op welke grondslag","paragraphs":["Wij gebruiken deze gegevens om u het document te sturen, om bij te houden welk document wij hebben verstrekt en om uw aanvraag op te volgen. Onze rechtsgrondslag is ons gerechtvaardigd belang bij het beantwoorden van zakelijke vragen (AVG art. 6 lid 1 onder f). Wij hebben dat belang afgewogen tegen het uwe; u kunt ons om die afweging vragen.","U kunt op elk moment bezwaar maken tegen dit gebruik (AVG art. 21). Wij stoppen dan, tenzij wij dwingende gerechtvaardigde gronden hebben of de gegevens nodig hebben voor een rechtsvordering.","Marketing-e-mails worden alleen verstuurd als u het aparte, optionele vakje aanvinkt (toestemming, AVG art. 6 lid 1 onder a). Dit is nooit nodig voor een download, en u kunt de toestemming op elk moment intrekken. Wij versturen nog geen marketing-e-mails."]},{"id":"watermark","title":"Uw naam op de pdf","paragraphs":["De pdf die u ontvangt, is voorzien van uw naam, uw bedrijf en een aanvraagreferentie, zodat een kopie kan worden herleid tot de aanvraag. Kopieën die u bewaart of deelt, vallen buiten onze systemen; wij kunnen ze niet terughalen."]},{"id":"retention","title":"Hoe lang wij ze bewaren","paragraphs":["Wij bewaren uw gegevens gedurende 24 maanden na uw laatste documentaanvraag of uw laatste activiteit onder een geldige marketingtoestemming. Een marketingtoestemming alleen zorgt er niet voor dat uw gegevens onbeperkt worden bewaard. Na die periode anonimiseren wij ze: uw naam, bedrijf en e-mailadres worden verwijderd.","De met een sleutel berekende hash van uw netwerkadres wordt na 90 dagen verwijderd.","Een registratie van welke tekstversie is getoond en geaccepteerd, wordt zonder uw naam, bedrijf of e-mailadres bewaard, gedurende {evidenceRetention}.","Als u klant bent of als wij met u in een lopend zakelijk gesprek zijn, geldt in plaats daarvan ons beleid voor klantgegevens: {customerRecords}.","Back-ups: {backups}."]},{"id":"recipients","title":"Wie ze kan zien","paragraphs":["Alleen medewerkers die ze nodig hebben voor uw aanvraag, met toegang die per rol wordt verleend, in de tijd beperkt is en wordt vastgelegd. Dienstverleners die onze systemen namens ons hosten of beheren: {processors}. Wij verkopen uw gegevens niet.","Doorgiften buiten de Europese Economische Ruimte: {transfers}."]},{"id":"rights","title":"Uw rechten","paragraphs":["U kunt vragen om uw gegevens in te zien, te corrigeren, te laten verwijderen of te laten beperken, om ze in een gangbaar formaat te ontvangen, en om bezwaar te maken tegen het gebruik ervan. Schrijf naar {privacyEmail}. Wij antwoorden binnen één maand. Ter bescherming van u bevestigen wij het verzoek door te antwoorden op het e-mailadres dat wij van u hebben, en wij kunnen gegevens bewaren waar de wet dat vereist.","U kunt ook een klacht indienen bij de {supervisoryAuthority}."]},{"id":"cookies","title":"Cookies","paragraphs":["Wanneer u een document aanvraagt, plaatst deze site één strikt noodzakelijke cookie waarmee uw browser het document kan downloaden; deze verloopt na 15 minuten. Volledige lijst: {cookies}."]},{"id":"changes","title":"Wijzigingen","paragraphs":["Wanneer dit beleid of de formulierteksten wijzigen, krijgen ze een nieuwe versie; wij bewaren eerdere versies, zodat wij kunnen laten zien welke tekst u te zien kreeg."]}]$json$::jsonb,
  'a31fc6ff1ab456e0839150681091fdca86004342c9898a6d27d980894aaa3b1a', '0193d2a0-0000-7000-8000-000000000001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL);
