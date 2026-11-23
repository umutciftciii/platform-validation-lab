-- ML-10 (DP-241, ADR-028 D12): the language of a public form.
--
-- Runs as dp_owner (ADR-012A). Additive and backward compatible: two NEW NULLABLE columns, two
-- foreign keys and four CHECK constraints. No existing row, value, trigger, function, privilege,
-- index or row-level security policy changes:
--
--  * "LeadDocumentRequest"."locale" and "LeadContactMessage"."locale": the language the form was
--    sent in (BCP 47, the rule of "SiteLocale"."locale"). NULL for every row stored before ML-10:
--    those are read as English and never rewritten. The API writes the form's language (English
--    when an older site sends none).
--  * Foreign key ("siteId", "locale") -> "SiteLocale": the language is one of the request's own
--    site (site isolation and SiteLocale validation by the database; NULL is not checked).
--  * The consent language is not stored a second time: the stored text versions already name
--    their language (`<date>.<locale>`, DP-095 D-T6). A CHECK keeps them equal to "locale", so a
--    row can never pair a form in one language with texts of another.
--  * Privileges: dp_app keeps table-level INSERT and SELECT (the new column is covered) and still
--    has no UPDATE/DELETE; dp_lead_retention's column-level UPDATE grants do not include "locale"
--    (it is not personal data and stays after anonymisation). The guard triggers compare whole
--    rows minus the clearable fields, so "locale" can never change after insert.
--  * Row-level security (DP-103) is per row and unchanged: the existing policies cover the new
--    column. test/integration/leads.int.test.ts checks them with locale reads and writes.
--
-- Rollback (lossless while no row has a locale; otherwise the form languages are lost). Dropping
-- the column drops its foreign key and both CHECKs with it; it must run before ML-1's rollback
-- (the foreign keys depend on "SiteLocale"):
--   ALTER TABLE "LeadContactMessage" DROP COLUMN "locale";
--   ALTER TABLE "LeadDocumentRequest" DROP COLUMN "locale";
--   (and remove the row of this migration from "_prisma_migrations")
--
-- Part 1 matches `prisma migrate diff --from-schema <main> --to-schema schema.prisma`; Part 2 adds
-- the rules Prisma cannot model.

DO $$
BEGIN
  IF to_regclass('public."SiteLocale"') IS NULL THEN
    RAISE EXCEPTION 'ML-10: SiteLocale missing; migration 20261210090000_ml_1_site_locales must be applied first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'leads_rls_public_site_id') THEN
    RAISE EXCEPTION 'ML-10: migration 20261123090000_dp_103_lead_row_level_security must be applied first';
  END IF;
END $$;

-- ===========================================================================================
-- Part 1: schema (Prisma)
-- ===========================================================================================

-- AlterTable
ALTER TABLE "LeadDocumentRequest" ADD COLUMN     "locale" VARCHAR(35);

-- AlterTable
ALTER TABLE "LeadContactMessage" ADD COLUMN     "locale" VARCHAR(35);

-- AddForeignKey
ALTER TABLE "LeadDocumentRequest" ADD CONSTRAINT "LeadDocumentRequest_siteId_locale_fkey" FOREIGN KEY ("siteId", "locale") REFERENCES "SiteLocale"("siteId", "locale") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadContactMessage" ADD CONSTRAINT "LeadContactMessage_siteId_locale_fkey" FOREIGN KEY ("siteId", "locale") REFERENCES "SiteLocale"("siteId", "locale") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================================
-- Part 2: rules Prisma cannot model
-- ===========================================================================================

-- The language tag, and the stored text versions name that same language (the consent language).
ALTER TABLE "LeadDocumentRequest"
  ADD CONSTRAINT "LeadDocumentRequest_locale_format"
    CHECK ("locale" IS NULL OR "locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  ADD CONSTRAINT "LeadDocumentRequest_text_locale"
    CHECK ("locale" IS NULL
           OR (right("privacyNoticeVersion", char_length("locale") + 1) = '.' || "locale"
               AND ("marketingConsentVersion" IS NULL
                    OR right("marketingConsentVersion", char_length("locale") + 1) = '.' || "locale")));

ALTER TABLE "LeadContactMessage"
  ADD CONSTRAINT "LeadContactMessage_locale_format"
    CHECK ("locale" IS NULL OR "locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  ADD CONSTRAINT "LeadContactMessage_text_locale"
    CHECK ("locale" IS NULL
           OR right("privacyNoticeVersion", char_length("locale") + 1) = '.' || "locale");
