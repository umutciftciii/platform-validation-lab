-- DP-041 (ADR-019 D1): order of the lead history inside one transaction.
--
-- Runs as dp_owner. Function body only, no data change. The activity guard stamped every row
-- with now() (transaction start), so a status change, its assignment row and the note saved with
-- it had the same time and the history showed them in random order (random ids). clock_timestamp()
-- gives each row the moment it was written: the database trigger's status and assignment rows
-- come before the note that the API inserts after the update. Still set by the database, never
-- by the caller. Timestamps are stored to the millisecond, so rows of one change can still tie:
-- "seq" (identity order of insertion) is the tiebreaker the API sorts by.

-- AlterTable (follows `prisma migrate diff`)
ALTER TABLE "LeadActivity" ADD COLUMN "seq" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_seq_idx" ON "LeadActivity"("leadId", "seq");


CREATE OR REPLACE FUNCTION leads_activity_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND current_user = 'dp_lead_retention' THEN
    IF (to_jsonb(NEW) - ARRAY['body', 'redactedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['body', 'redactedAt'])
       OR NEW."body" IS NOT NULL OR NEW."redactedAt" IS NULL THEN
      RAISE EXCEPTION 'leads: retention may only clear the text of an activity'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'leads: lead activity is a record and cannot change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Lead" l WHERE l."id" = NEW."leadId" AND l."siteId" = NEW."siteId"
                   AND l."anonymisedAt" IS NULL) THEN
    RAISE EXCEPTION 'leads: activity needs a live lead of the same site' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."kind" IN ('STATUS_CHANGED', 'ASSIGNMENT_CHANGED') AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'leads: status and assignment history is written by the database only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."redactedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'leads: a new activity is not redacted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."contactedAt" IS NOT NULL AND NEW."contactedAt" > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'leads: a contact cannot lie in the future' USING ERRCODE = 'check_violation';
  END IF;
  NEW."createdAt" := clock_timestamp();
  RETURN NEW;
END
$fn$;
