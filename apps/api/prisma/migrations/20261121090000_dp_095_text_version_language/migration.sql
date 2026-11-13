-- DP-095 (D-T6, approved 2026-11-12): a lead form text version names its language, for example
-- `2026-11-12.en`; a later language is its own version and SHA-256. The DP-042 checks allowed only
-- `YYYY-MM-DD` with an optional numeric suffix and refused the new versions.
--
-- Runs as dp_owner (ADR-012A). Constraint change only: no row, column or privilege changes. Every
-- stored version still matches (the new pattern is a superset of the old one). Tested in
-- test/integration/leads.int.test.ts.

ALTER TABLE "LeadDocumentRequest"
  DROP CONSTRAINT "LeadDocumentRequest_notice_version",
  ADD CONSTRAINT "LeadDocumentRequest_notice_version"
    CHECK ("privacyNoticeVersion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]+)?(\.[a-z]{2})?$'),
  DROP CONSTRAINT "LeadDocumentRequest_marketing_evidence",
  -- Marketing evidence: version and text hash exactly when consent was given.
  ADD CONSTRAINT "LeadDocumentRequest_marketing_evidence" CHECK (
    ("marketingConsent" AND "marketingConsentVersion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]+)?(\.[a-z]{2})?$'
       AND "marketingConsentSha256" ~ '^[0-9a-f]{64}$')
    OR (NOT "marketingConsent" AND "marketingConsentVersion" IS NULL AND "marketingConsentSha256" IS NULL));
