-- DP-041 (ADR-019): the sales workflow on leads: status, assignment, notes and contact history.
--
-- Runs as dp_owner (ADR-012A). Additive: new columns with defaults, one new table, new functions,
-- policies and triggers; no existing row changes (every lead starts as NEW, unassigned). The
-- DP-096 lead guard and the DP-103 staff read function are replaced in place (CREATE OR REPLACE)
-- with the same behaviour for every existing path plus the workflow rules.
--
-- What the database enforces from here on (the API checks the same first, ADR-011 decide):
--   - status, assignment and their bookkeeping change only in a staff context whose admin session
--     belongs to a user with `lead:manage` on the lead's site (sales_crm_user there, the platform
--     super admin, the system owner); never through the public form, never by retention;
--   - a workflow change changes nothing else on the row, follows the allowed status transitions,
--     bumps `workflowVersion` and stamps its own times;
--   - the assignee holds `lead:manage` on the lead's site (site role with an ACTIVE membership,
--     platform role, or the system owner) and is an ACTIVE staff user;
--   - every status or assignment change is written to "LeadActivity" by a trigger, with the user
--     of the admin session as the actor: the history cannot be skipped or forged by the API;
--   - notes and contact records are inserted by staff with `lead:manage`, actor = session user;
--     activity rows are append-only (no UPDATE/DELETE for dp_app);
--   - an anonymised lead takes no workflow change and no new activity (DP-096 guard); the
--     anonymisation clears activity text (`body`) as dp_lead_retention;
--   - QUALIFIED (open opportunity) and CONVERTED (customer) leads are never anonymised
--     automatically (D-R1: the CRM retention policy decides, DP-122) and an erasure request for
--     them goes to manual legal review, like an explicit retention hold.
-- Tested in test/integration/leads.int.test.ts (DP-041) and db-roles.int.test.ts.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'leads_rls_staff_site_ids') THEN
    RAISE EXCEPTION 'DP-041: migration 20261123090000_dp_103_lead_row_level_security must be applied first';
  END IF;
END $$;

-- =============================================================================================
-- Part 1: columns and table (follows `prisma migrate diff`)
-- =============================================================================================
-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "LeadActivityKind" AS ENUM ('NOTE', 'CONTACT', 'STATUS_CHANGED', 'ASSIGNMENT_CHANGED');

-- CreateEnum
CREATE TYPE "LeadContactChannel" AS ENUM ('EMAIL', 'PHONE', 'MEETING', 'OTHER');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "assignedAt" TIMESTAMPTZ(3),
ADD COLUMN     "assignedToId" UUID,
ADD COLUMN     "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "statusChangedAt" TIMESTAMPTZ(3),
ADD COLUMN     "workflowVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "kind" "LeadActivityKind" NOT NULL,
    "actorUserId" UUID NOT NULL,
    "body" VARCHAR(4000),
    "contactChannel" "LeadContactChannel",
    "contactedAt" TIMESTAMPTZ(3),
    "fromStatus" "LeadStatus",
    "toStatus" "LeadStatus",
    "fromAssigneeId" UUID,
    "toAssigneeId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redactedAt" TIMESTAMPTZ(3),

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadActivity_siteId_createdAt_idx" ON "LeadActivity"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadActivity_actorUserId_idx" ON "LeadActivity"("actorUserId");

-- CreateIndex
CREATE INDEX "LeadActivity_fromAssigneeId_idx" ON "LeadActivity"("fromAssigneeId");

-- CreateIndex
CREATE INDEX "LeadActivity_toAssigneeId_idx" ON "LeadActivity"("toAssigneeId");

-- CreateIndex
CREATE INDEX "Lead_siteId_status_lastRequestAt_idx" ON "Lead"("siteId", "status", "lastRequestAt");

-- CreateIndex
CREATE INDEX "Lead_assignedToId_idx" ON "Lead"("assignedToId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_fromAssigneeId_fkey" FOREIGN KEY ("fromAssigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_toAssigneeId_fkey" FOREIGN KEY ("toAssigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================================
-- Part 2: consistency (CHECK)
-- =============================================================================================
ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_workflow_status" CHECK (("status" = 'NEW') = ("statusChangedAt" IS NULL)),
  ADD CONSTRAINT "Lead_workflow_assignment" CHECK (("assignedToId" IS NULL) = ("assignedAt" IS NULL)),
  ADD CONSTRAINT "Lead_workflow_version" CHECK ("workflowVersion" >= 0),
  -- A customer or an open opportunity is kept (D-R1); only an explicit status change by sales
  -- staff releases it to the 24-month rule.
  ADD CONSTRAINT "Lead_anonymised_pipeline"
    CHECK ("anonymisedAt" IS NULL OR "status" NOT IN ('QUALIFIED', 'CONVERTED'));

ALTER TABLE "LeadActivity"
  ADD CONSTRAINT "LeadActivity_body"
    CHECK ("body" IS NULL OR ("body" = btrim("body") AND length("body") BETWEEN 1 AND 4000)),
  ADD CONSTRAINT "LeadActivity_redacted" CHECK ("redactedAt" IS NULL OR "body" IS NULL),
  ADD CONSTRAINT "LeadActivity_kind_fields" CHECK (
    CASE "kind"
      WHEN 'NOTE' THEN ("body" IS NOT NULL OR "redactedAt" IS NOT NULL)
        AND "contactChannel" IS NULL AND "contactedAt" IS NULL
        AND "fromStatus" IS NULL AND "toStatus" IS NULL
        AND "fromAssigneeId" IS NULL AND "toAssigneeId" IS NULL
      WHEN 'CONTACT' THEN ("body" IS NOT NULL OR "redactedAt" IS NOT NULL)
        AND "contactChannel" IS NOT NULL AND "contactedAt" IS NOT NULL
        AND "fromStatus" IS NULL AND "toStatus" IS NULL
        AND "fromAssigneeId" IS NULL AND "toAssigneeId" IS NULL
      WHEN 'STATUS_CHANGED' THEN "body" IS NULL AND "redactedAt" IS NULL
        AND "contactChannel" IS NULL AND "contactedAt" IS NULL
        AND "fromStatus" IS NOT NULL AND "toStatus" IS NOT NULL AND "fromStatus" <> "toStatus"
        AND "fromAssigneeId" IS NULL AND "toAssigneeId" IS NULL
      WHEN 'ASSIGNMENT_CHANGED' THEN "body" IS NULL AND "redactedAt" IS NULL
        AND "contactChannel" IS NULL AND "contactedAt" IS NULL
        AND "fromStatus" IS NULL AND "toStatus" IS NULL
        AND "fromAssigneeId" IS DISTINCT FROM "toAssigneeId"
    END);

-- =============================================================================================
-- Part 3: who the staff context is, and where a user may work leads
-- =============================================================================================

-- The user behind the presented admin session (DP-103 context), or NULL. SECURITY DEFINER: reads
-- the IAM tables; returns only the id of the session's own user.
CREATE FUNCTION leads_rls_staff_user_id() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  token text := current_setting('dp.lead_staff_session', true);
  uid uuid;
BEGIN
  IF NOT public.leads_rls_context_live() OR token IS NULL OR token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN NULL;
  END IF;
  SELECT s."userId" INTO uid
  FROM "Session" s JOIN "User" u ON u."id" = s."userId"
  WHERE s."tokenHash" = encode(sha256(convert_to(token, 'UTF8')), 'hex')
    AND s."app" = 'ADMIN' AND s."kind" = 'STAFF' AND s."revokedAt" IS NULL
    AND s."idleExpiresAt" > now() AND s."absoluteExpiresAt" > now()
    AND s."securityVersion" = u."securityVersion"
    AND u."status" = 'ACTIVE' AND u."kind" = 'STAFF';
  RETURN uid;
END
$fn$;

-- The sites where an ACTIVE staff user holds `lead:read` or `lead:manage` (decide() for a core,
-- non-sensitive permission): the system owner everywhere (God Mode, ADR-018, explicit branch);
-- otherwise an active platform role, or a site role with an ACTIVE membership there. Internal:
-- only the SECURITY DEFINER functions below call it (no EXECUTE for dp_app).
CREATE FUNCTION leads_rls_user_lead_sites(uid uuid, permission text) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  IF uid IS NULL OR permission IS NULL OR permission NOT IN ('lead:read', 'lead:manage') THEN
    RETURN '{}'::uuid[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "User" u
                 WHERE u."id" = uid AND u."status" = 'ACTIVE' AND u."kind" = 'STAFF') THEN
    RETURN '{}'::uuid[];
  END IF;
  IF EXISTS (SELECT 1 FROM "SystemOwner" o WHERE o."userId" = uid) THEN
    RETURN ARRAY(SELECT st."id" FROM "Site" st ORDER BY st."id");
  END IF;
  RETURN ARRAY(
    SELECT st."id" FROM "Site" st
    WHERE EXISTS (
      SELECT 1
      FROM "RoleAssignment" ra
      JOIN "Role" r ON r."id" = ra."roleId"
      JOIN "RolePermission" rp ON rp."roleId" = r."id"
      JOIN "Permission" p ON p."id" = rp."permissionId"
      WHERE ra."userId" = uid
        AND ra."revokedAt" IS NULL
        AND (ra."expiresAt" IS NULL OR ra."expiresAt" > now())
        AND p."key" = permission AND p."audience" = 'STAFF'
        AND r."audience" = 'STAFF' AND r."scopeType" = ra."scopeType" AND r."key" <> 'system_owner'
        AND ((ra."scopeType" = 'PLATFORM' AND ra."siteId" IS NULL)
             OR (ra."scopeType" = 'SITE' AND ra."siteId" = st."id"
                 AND EXISTS (SELECT 1 FROM "Membership" m
                             WHERE m."userId" = uid AND m."siteId" = st."id"
                               AND m."status" = 'ACTIVE'))))
    ORDER BY st."id");
END
$fn$;

-- DP-103's reader, now on the shared helpers (same result: lead:read of the session's user).
CREATE OR REPLACE FUNCTION leads_rls_staff_site_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT public.leads_rls_user_lead_sites(public.leads_rls_staff_user_id(), 'lead:read')
$fn$;

-- The sites where the session's user may work leads (lead:manage).
CREATE FUNCTION leads_rls_staff_manage_site_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT public.leads_rls_user_lead_sites(public.leads_rls_staff_user_id(), 'lead:manage')
$fn$;

-- Whether a lead of `site_id` may be assigned to `assignee`: lead:manage there (an answer about
-- one staff user's access, no lead data).
CREATE FUNCTION leads_rls_assignee_ok(assignee uuid, site_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT COALESCE(site_id = ANY (public.leads_rls_user_lead_sites(assignee, 'lead:manage')), false)
$fn$;

REVOKE ALL ON FUNCTION leads_rls_staff_user_id(), leads_rls_user_lead_sites(uuid, text),
  leads_rls_staff_manage_site_ids(), leads_rls_assignee_ok(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION leads_rls_staff_user_id(), leads_rls_staff_manage_site_ids(),
  leads_rls_assignee_ok(uuid, uuid) TO dp_app;

-- =============================================================================================
-- Part 4: guards (triggers)
-- =============================================================================================

-- Leads: the DP-096 rules unchanged, plus the workflow. Only staff with lead:manage on the site
-- change status or assignment; such a change touches nothing else, follows the transitions,
-- bumps the version and stamps its times. dp_app outside a workflow change is the public form.
CREATE OR REPLACE FUNCTION leads_lead_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  retention_cols text[] := ARRAY['email', 'fullName', 'company', 'marketingConsentAt',
                                 'anonymisedAt', 'retentionHold', 'retentionHoldAt', 'updatedAt'];
  workflow_cols text[] := ARRAY['status', 'statusChangedAt', 'assignedToId', 'assignedAt',
                                'workflowVersion', 'updatedAt'];
  -- Allowed status transitions (ADR-019 D2; mirrored in @dream/contracts LEAD_STATUS_TRANSITIONS).
  transitions text[] := ARRAY['NEW>CONTACTED', 'NEW>QUALIFIED', 'NEW>UNQUALIFIED',
                              'CONTACTED>QUALIFIED', 'CONTACTED>UNQUALIFIED',
                              'QUALIFIED>CONVERTED', 'QUALIFIED>UNQUALIFIED',
                              'UNQUALIFIED>CONTACTED', 'UNQUALIFIED>QUALIFIED'];
  workflow_changed boolean;
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
  workflow_changed := NEW."status" IS DISTINCT FROM OLD."status"
                      OR NEW."assignedToId" IS DISTINCT FROM OLD."assignedToId";
  IF NOT workflow_changed THEN
    IF NEW."statusChangedAt" IS DISTINCT FROM OLD."statusChangedAt"
       OR NEW."assignedAt" IS DISTINCT FROM OLD."assignedAt"
       OR NEW."workflowVersion" IS DISTINCT FROM OLD."workflowVersion" THEN
      RAISE EXCEPTION 'leads: workflow bookkeeping changes only with the workflow'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- dp_app changes a lead's details only in the public context of the form (DP-042).
    IF current_user = 'dp_app' AND public.leads_rls_public_site_id() IS NULL THEN
      RAISE EXCEPTION 'leads: lead details change only through the public form'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (NEW."siteId" = ANY (COALESCE(public.leads_rls_staff_manage_site_ids(), '{}'::uuid[]))) THEN
    RAISE EXCEPTION 'leads: status and assignment are changed by staff with lead:manage only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - workflow_cols) IS DISTINCT FROM (to_jsonb(OLD) - workflow_cols) THEN
    RAISE EXCEPTION 'leads: a workflow change cannot change the lead details'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status"
     AND NOT (OLD."status"::text || '>' || NEW."status"::text = ANY (transitions)) THEN
    RAISE EXCEPTION 'leads: status transition % to % is not allowed', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."assignedToId" IS DISTINCT FROM OLD."assignedToId" AND NEW."assignedToId" IS NOT NULL
     AND NOT public.leads_rls_assignee_ok(NEW."assignedToId", NEW."siteId") THEN
    RAISE EXCEPTION 'leads: the assignee needs lead:manage on the lead''s site'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW."workflowVersion" := OLD."workflowVersion" + 1;
  NEW."statusChangedAt" := CASE WHEN NEW."status" IS DISTINCT FROM OLD."status"
                                THEN now() ELSE OLD."statusChangedAt" END;
  NEW."assignedAt" := CASE WHEN NEW."assignedToId" IS NOT DISTINCT FROM OLD."assignedToId"
                           THEN OLD."assignedAt"
                           WHEN NEW."assignedToId" IS NULL THEN NULL ELSE now() END;
  RETURN NEW;
END
$fn$;

-- The history of every workflow change, written by the database with the session's user as the
-- actor (runs as the caller, dp_app: the activity insert policy applies).
CREATE FUNCTION leads_lead_workflow_log() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  actor uuid := public.leads_rls_staff_user_id();
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'leads: a workflow change needs a staff session' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    INSERT INTO "LeadActivity" ("siteId", "leadId", "kind", "actorUserId", "fromStatus", "toStatus")
    VALUES (NEW."siteId", NEW."id", 'STATUS_CHANGED', actor, OLD."status", NEW."status");
  END IF;
  IF NEW."assignedToId" IS DISTINCT FROM OLD."assignedToId" THEN
    INSERT INTO "LeadActivity" ("siteId", "leadId", "kind", "actorUserId", "fromAssigneeId",
                                "toAssigneeId")
    VALUES (NEW."siteId", NEW."id", 'ASSIGNMENT_CHANGED', actor, OLD."assignedToId",
            NEW."assignedToId");
  END IF;
  RETURN NULL;
END
$fn$;
CREATE TRIGGER "Lead_workflow_log" AFTER UPDATE ON "Lead" FOR EACH ROW
  WHEN (OLD."status" IS DISTINCT FROM NEW."status" OR OLD."assignedToId" IS DISTINCT FROM NEW."assignedToId")
  EXECUTE FUNCTION leads_lead_workflow_log();

-- Activity: append-only. Notes and contacts come from staff; status and assignment rows only from
-- the trigger above. Retention clears the text and nothing else.
CREATE FUNCTION leads_activity_guard() RETURNS trigger LANGUAGE plpgsql
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
  NEW."createdAt" := now();
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "LeadActivity_guard" BEFORE INSERT OR UPDATE OR DELETE ON "LeadActivity"
  FOR EACH ROW EXECUTE FUNCTION leads_activity_guard();

-- =============================================================================================
-- Part 5: retention (DP-096) knows the sales pipeline
-- =============================================================================================
-- QUALIFIED and CONVERTED count as held (open opportunity, customer) in the plan, like a hold.
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
       WHERE r."ipPrefixHmac" IS NOT NULL AND r."createdAt" < cutoff_ip_hmac),
    (SELECT count(*) FROM "DocumentDownloadGrant" g
       WHERE g."downloadCount" = 0 AND g."expiresAt" < cutoff_unused_grant),
    (SELECT count(*) FROM "PublicRateLimit" b WHERE b."expiresAt" <= at_time)
$fn$;

-- =============================================================================================
-- Part 6: privileges and policies
-- =============================================================================================

-- dp_app: the workflow columns of a lead (guarded above); activity is read and appended only.
GRANT UPDATE ("status", "statusChangedAt", "assignedToId", "assignedAt", "workflowVersion")
  ON TABLE "Lead" TO dp_app;
REVOKE UPDATE, DELETE ON TABLE "LeadActivity" FROM dp_app;
-- dp_lead_retention: reads activity and clears its text when a lead is anonymised.
GRANT SELECT ON TABLE "LeadActivity" TO dp_lead_retention;
GRANT UPDATE ("body", "redactedAt") ON TABLE "LeadActivity" TO dp_lead_retention;

-- Lead: staff with lead:manage update (the guard narrows it to the workflow columns).
CREATE POLICY lead_staff_update ON "Lead" FOR UPDATE TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT leads_rls_staff_manage_site_ids()), '{}'::uuid[])))
  WITH CHECK ("siteId" = ANY (COALESCE((SELECT leads_rls_staff_manage_site_ids()), '{}'::uuid[])));

-- LeadActivity: deny by default; staff read where they read leads, append where they manage
-- them and only as themselves; retention reads and clears text. No public access.
ALTER TABLE "LeadActivity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY activity_staff_read ON "LeadActivity" FOR SELECT TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT leads_rls_staff_site_ids()), '{}'::uuid[])));
CREATE POLICY activity_staff_insert ON "LeadActivity" FOR INSERT TO dp_app
  WITH CHECK ("siteId" = ANY (COALESCE((SELECT leads_rls_staff_manage_site_ids()), '{}'::uuid[]))
              AND "actorUserId" = (SELECT leads_rls_staff_user_id()));
CREATE POLICY activity_retention_read ON "LeadActivity" FOR SELECT TO dp_lead_retention
  USING (true);
CREATE POLICY activity_retention_update ON "LeadActivity" FOR UPDATE TO dp_lead_retention
  USING (true) WITH CHECK (true);
