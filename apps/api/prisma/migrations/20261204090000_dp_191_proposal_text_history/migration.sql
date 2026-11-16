-- DP-191 (ADR-022 D2 addendum): keep the proposed text of every proposal version.
--
-- Runs as dp_owner (ADR-012A). Additive: three columns on the proposal history, two CHECK
-- constraints, a stricter event guard and a verified back-fill. No other table changes; no row
-- is deleted. Until now an event kept only the SHA-256 of the text it produced, and every
-- revision overwrote the proposal's text, so earlier texts were lost.
--
--  * Every new event records the text it produced (or decided on) together with its hash; the
--    CHECK refuses a text that does not hash to the event's contentSha256, so a text can never be
--    stored with the wrong version.
--  * Back-fill: an existing event gets the proposal's current text only when that text hashes to
--    the event's contentSha256 (proof that the event produced exactly this text). Every other
--    existing event keeps textRecorded = false: its text is unknown and is never guessed.
--
-- test/integration/catalog-workflow.int.test.ts (section 10) covers the rules; the back-fill was
-- rehearsed on a copy of the DEV data (DP-191 rehearsal, outside the repository).

-- ===========================================================================================
-- Part 0: preconditions
-- ===========================================================================================

DO $$
BEGIN
  IF to_regclass('public."ProductContentProposalEvent"') IS NULL THEN
    RAISE EXCEPTION 'DP-191: the content proposals (DP-171) must be applied first';
  END IF;
END $$;

-- ===========================================================================================
-- Part 1: columns (generated)
-- ===========================================================================================

-- AlterTable
ALTER TABLE "ProductContentProposalEvent" ADD COLUMN     "description" TEXT,
ADD COLUMN     "summary" VARCHAR(500),
ADD COLUMN     "textRecorded" BOOLEAN NOT NULL DEFAULT false;

-- ===========================================================================================
-- Part 2: the recorded text belongs to the event's hash
-- ===========================================================================================

-- The same key as the application (contracts proposalContentKey): summary, a zero byte,
-- description, each null as the empty string, UTF-8.
ALTER TABLE "ProductContentProposalEvent"
  ADD CONSTRAINT "ProductContentProposalEvent_text_matches_hash" CHECK (
    NOT "textRecorded"
    OR encode(
         sha256(
           convert_to(coalesce("summary", ''), 'UTF8')
           || decode('00', 'hex')
           || convert_to(coalesce("description", ''), 'UTF8')
         ),
         'hex'
       ) = "contentSha256"
  ),
  ADD CONSTRAINT "ProductContentProposalEvent_unrecorded_text_empty" CHECK (
    "textRecorded" OR ("summary" IS NULL AND "description" IS NULL)
  ),
  ADD CONSTRAINT "ProductContentProposalEvent_description_length" CHECK (
    "description" IS NULL OR char_length("description") <= 8000
  );

-- ===========================================================================================
-- Part 3: verified back-fill of the existing history
-- ===========================================================================================

-- The history is append-only for every role; the trigger is lifted for this one statement only,
-- inside the migration's own run, and restored right after it.
ALTER TABLE "ProductContentProposalEvent" DISABLE TRIGGER "ProductContentProposalEvent_append_only";

UPDATE "ProductContentProposalEvent" e
SET "summary" = p."proposedSummary",
    "description" = p."proposedDescription",
    "textRecorded" = true
FROM "ProductContentProposal" p
WHERE p."id" = e."proposalId"
  AND NOT e."textRecorded"
  AND e."contentSha256" = encode(
        sha256(
          convert_to(coalesce(p."proposedSummary", ''), 'UTF8')
          || decode('00', 'hex')
          || convert_to(coalesce(p."proposedDescription", ''), 'UTF8')
        ),
        'hex'
      );

ALTER TABLE "ProductContentProposalEvent" ENABLE TRIGGER "ProductContentProposalEvent_append_only";

-- ===========================================================================================
-- Part 4: every new event records its text; a decision records the text it decided on
-- ===========================================================================================

CREATE OR REPLACE FUNCTION catalog_content_proposal_event_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  p RECORD;
BEGIN
  SELECT "status", "version", "authorIds", "proposedSummary", "proposedDescription" INTO p
    FROM "ProductContentProposal" WHERE "id" = NEW."proposalId";
  -- DP-191: no event without its text (the CHECK ties the text to contentSha256).
  IF NOT NEW."textRecorded" THEN
    RAISE EXCEPTION 'catalog: a proposal event records the text of its version'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."action" IN ('APPROVED', 'CHANGES_REQUESTED') THEN
    IF p."status" IS DISTINCT FROM 'REVIEW_PENDING' THEN
      RAISE EXCEPTION 'catalog: a decision needs a proposal in review'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."actorUserId" = ANY (p."authorIds") THEN
      RAISE EXCEPTION 'catalog: separation of duties: an author cannot decide on the proposal'
        USING ERRCODE = 'check_violation';
    END IF;
    -- DP-191: a decision is about the text as it is; it never records another version's text.
    IF NEW."summary" IS DISTINCT FROM p."proposedSummary"
       OR NEW."description" IS DISTINCT FROM p."proposedDescription" THEN
      RAISE EXCEPTION 'catalog: a decision records the text it decides on'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."action" = 'CREATED' AND NEW."proposalVersion" <> 1 THEN
    RAISE EXCEPTION 'catalog: the CREATED event records version 1'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."action" <> 'CREATED' AND NEW."proposalVersion" <> p."version" + 1 THEN
    RAISE EXCEPTION 'catalog: an event records the version its change produces'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
