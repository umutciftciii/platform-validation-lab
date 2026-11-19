-- DP-221 (ADR-026): contact form → CRM lead with its source, and staff e-mail notifications.
--
-- Runs as dp_owner (ADR-012A). Additive, three parts:
--   1. "Lead"."source" (first contact channel: DOCUMENT_REQUEST or CONTACT_FORM), filled for the
--      existing leads from their own evidence rows, then frozen by a guard trigger.
--   2. "LeadNotification": the outbox of staff notifications, one per contact-form message,
--      written in the message's transaction and sent afterwards by the API (bounded retries).
--      Ids and delivery state only: no address, name, message text or mail server reply.
--   3. "LeadNotificationSetting": per site, whether notifications are on and which staff users
--      get them. Changed only by staff with lead:manage on the site (row-level security); a
--      recipient must read the site's leads (lead:read), checked here and again at send time.
-- No existing column, row or function body changes, except the one-off fill of the new column
-- (step 1b). Tested in test/integration/leads.int.test.ts (DP-221) and db-roles.int.test.ts.
--
-- Part 1 of each table follows `prisma migrate diff --from-schema <main> --to-schema schema.prisma`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_lead_retention') THEN
    RAISE EXCEPTION 'DP-221: database roles missing; run infra/docker/stack.sh db-roles <dev|prod> --yes first (dp-roles.sql)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'leads_contact_message_guard')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'leads_rls_assignable_staff') THEN
    RAISE EXCEPTION 'DP-221: migrations of DP-151 and DP-125 must be applied first';
  END IF;
END $$;

-- ===========================================================================================
-- Part 1: lead source
-- ===========================================================================================
-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('DOCUMENT_REQUEST', 'CONTACT_FORM');

-- AlterTable (1a): every existing lead came from the document form unless 1b finds otherwise.
ALTER TABLE "Lead" ADD COLUMN     "source" "LeadSource" NOT NULL DEFAULT 'DOCUMENT_REQUEST';

-- 1b: a lead whose first evidence row is a contact-form message came from the contact form. This
-- reads the evidence tables only and writes this new column only. The DP-096/DP-041 guard refuses
-- any update of an anonymised lead; the source is a fact about the channel, not personal data,
-- so the guard is switched off for this one statement (inside the migration's transaction) and
-- every anonymised lead gets its true source too.
ALTER TABLE "Lead" DISABLE TRIGGER "Lead_guard";
UPDATE "Lead" l SET "source" = 'CONTACT_FORM'
WHERE EXISTS (SELECT 1 FROM "LeadContactMessage" m WHERE m."leadId" = l."id")
  AND NOT EXISTS (
    SELECT 1 FROM "LeadDocumentRequest" r
    WHERE r."leadId" = l."id"
      AND r."createdAt" <= (SELECT min(m."createdAt") FROM "LeadContactMessage" m
                            WHERE m."leadId" = l."id"));
ALTER TABLE "Lead" ENABLE TRIGGER "Lead_guard";

-- 1c: the source never changes after the row exists (any role, the owner included). dp_app has
-- no UPDATE privilege on the column anyway (DP-096/DP-041 column grants); this is the second line.
CREATE FUNCTION leads_lead_source_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  IF NEW."source" IS DISTINCT FROM OLD."source" THEN
    RAISE EXCEPTION 'leads: the source of a lead never changes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "Lead_source_guard" BEFORE UPDATE OF "source" ON "Lead"
  FOR EACH ROW EXECUTE FUNCTION leads_lead_source_guard();

-- ===========================================================================================
-- Part 2: notification outbox
-- ===========================================================================================
-- CreateEnum
CREATE TYPE "LeadNotificationStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "LeadNotification" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "contactMessageId" UUID NOT NULL,
    "status" "LeadNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMPTZ(3),
    "reason" VARCHAR(40),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadNotification_contactMessageId_key" ON "LeadNotification"("contactMessageId");

-- CreateIndex
CREATE INDEX "LeadNotification_status_nextAttemptAt_idx" ON "LeadNotification"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "LeadNotification_siteId_createdAt_idx" ON "LeadNotification"("siteId", "createdAt");

-- AddForeignKey
ALTER TABLE "LeadNotification" ADD CONSTRAINT "LeadNotification_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNotification" ADD CONSTRAINT "LeadNotification_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNotification" ADD CONSTRAINT "LeadNotification_contactMessageId_fkey" FOREIGN KEY ("contactMessageId") REFERENCES "LeadContactMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Checks: delivery state is consistent; the reason is a fixed code (never free text).
ALTER TABLE "LeadNotification"
  ADD CONSTRAINT "LeadNotification_attempts_range" CHECK ("attempts" BETWEEN 0 AND 10),
  ADD CONSTRAINT "LeadNotification_recipients_range" CHECK ("recipientCount" BETWEEN 0 AND 50),
  ADD CONSTRAINT "LeadNotification_reason_code" CHECK ("reason" IS NULL OR "reason" ~ '^[a-z_]{1,40}$'),
  ADD CONSTRAINT "LeadNotification_sent"
    CHECK (("status" = 'SENT') = ("sentAt" IS NOT NULL)
           AND ("status" <> 'SENT' OR "recipientCount" > 0)),
  ADD CONSTRAINT "LeadNotification_final_reason"
    CHECK ("status" NOT IN ('SKIPPED', 'FAILED') OR "reason" IS NOT NULL);

-- A notification belongs to its message (same lead and site); a final state never changes; the
-- identity columns never change; there is no delete.
CREATE FUNCTION leads_notification_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'leads: notifications are delivery records and are never deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' OR NEW."attempts" <> 0 OR NEW."sentAt" IS NOT NULL THEN
      RAISE EXCEPTION 'leads: a new notification starts as PENDING' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "LeadContactMessage" m
                   WHERE m."id" = NEW."contactMessageId" AND m."leadId" = NEW."leadId"
                     AND m."siteId" = NEW."siteId") THEN
      RAISE EXCEPTION 'leads: a notification must belong to a contact message of the same lead and site'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."siteId" IS DISTINCT FROM OLD."siteId"
     OR NEW."leadId" IS DISTINCT FROM OLD."leadId"
     OR NEW."contactMessageId" IS DISTINCT FROM OLD."contactMessageId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'leads: a notification keeps its message' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'leads: a % notification is final', OLD."status" USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."attempts" < OLD."attempts" THEN
    RAISE EXCEPTION 'leads: notification attempts only grow' USING ERRCODE = 'check_violation';
  END IF;
  NEW."updatedAt" := now();
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "LeadNotification_guard" BEFORE INSERT OR UPDATE OR DELETE ON "LeadNotification"
  FOR EACH ROW EXECUTE FUNCTION leads_notification_guard();

-- Privileges (ADR-012A default privileges gave dp_app full DML): no delete; updates touch the
-- delivery state only. Retention needs nothing here (no personal data).
REVOKE DELETE, UPDATE ON TABLE "LeadNotification" FROM dp_app;
GRANT UPDATE ("status", "attempts", "nextAttemptAt", "lockedUntil", "reason", "recipientCount",
              "sentAt", "updatedAt") ON TABLE "LeadNotification" TO dp_app;

-- Row-level security: the public form inserts the notification of its own new message (lead
-- context of that site and e-mail: the message subquery sees only that visitor's rows). The
-- sender and the admin read and update every row; they hold ids and states only.
ALTER TABLE "LeadNotification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_public_insert ON "LeadNotification" FOR INSERT TO dp_app
  WITH CHECK ("siteId" = (SELECT leads_rls_public_site_id())
              AND EXISTS (SELECT 1 FROM "LeadContactMessage" m
                          WHERE m."id" = "LeadNotification"."contactMessageId"
                            AND m."siteId" = "LeadNotification"."siteId"));
CREATE POLICY notification_app_read ON "LeadNotification" FOR SELECT TO dp_app USING (true);
CREATE POLICY notification_app_update ON "LeadNotification" FOR UPDATE TO dp_app
  USING (true) WITH CHECK (true);

-- ===========================================================================================
-- Part 3: notification settings
-- ===========================================================================================
-- CreateTable
CREATE TABLE "LeadNotificationSetting" (
    "siteId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "recipientUserIds" UUID[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadNotificationSetting_pkey" PRIMARY KEY ("siteId")
);

-- AddForeignKey
ALTER TABLE "LeadNotificationSetting" ADD CONSTRAINT "LeadNotificationSetting_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNotificationSetting" ADD CONSTRAINT "LeadNotificationSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LeadNotificationSetting"
  ADD CONSTRAINT "LeadNotificationSetting_recipients"
    CHECK ("recipientUserIds" IS NOT NULL AND cardinality("recipientUserIds") <= 10
           AND array_position("recipientUserIds", NULL) IS NULL),
  ADD CONSTRAINT "LeadNotificationSetting_enabled_needs_recipient"
    CHECK (NOT "enabled" OR cardinality("recipientUserIds") > 0),
  ADD CONSTRAINT "LeadNotificationSetting_version" CHECK ("version" >= 1);

-- Which of the given staff users read the leads of a site now (lead:read, the same rule as the
-- lead policies). Ids in, ids out: no lead data. For the sender (no session) and the guard below.
CREATE FUNCTION leads_notification_eligible(site_id uuid, user_ids uuid[]) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), '{}'::uuid[])
  FROM unnest(COALESCE(user_ids, '{}'::uuid[])) u
  WHERE site_id = ANY (public.leads_rls_user_lead_sites(u, 'lead:read'))
$fn$;

-- Who may be put on the list of the given sites: staff with lead:read there, answered only for
-- the sites where the session's user holds lead:manage (DP-125 pattern, ids only).
CREATE FUNCTION leads_notification_candidates(site_ids uuid[])
RETURNS TABLE (site_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  WITH managed AS (
    SELECT s AS site_id
    FROM unnest(COALESCE(site_ids, '{}'::uuid[])) s
    WHERE s = ANY (public.leads_rls_staff_manage_site_ids())
  ), candidates AS (
    SELECT DISTINCT ra."userId" AS user_id
    FROM "RoleAssignment" ra
    JOIN "User" u ON u."id" = ra."userId"
    WHERE ra."revokedAt" IS NULL AND (ra."expiresAt" IS NULL OR ra."expiresAt" > now())
      AND u."status" = 'ACTIVE' AND u."kind" = 'STAFF'
    UNION
    SELECT o."userId" FROM "SystemOwner" o
  )
  SELECT m.site_id, c.user_id
  FROM managed m CROSS JOIN candidates c
  WHERE m.site_id = ANY (public.leads_rls_user_lead_sites(c.user_id, 'lead:read'))
  ORDER BY 1, 2
$fn$;

REVOKE ALL ON FUNCTION leads_notification_eligible(uuid, uuid[]),
  leads_notification_candidates(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION leads_notification_eligible(uuid, uuid[]),
  leads_notification_candidates(uuid[]) TO dp_app;

-- Every person added to the list reads the site's leads; the version moves by one per change;
-- the site never changes; there is no delete. (A person already on the list who lost access may
-- stay: the sender skips them and the admin shows it.)
CREATE FUNCTION leads_notification_setting_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  added uuid[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'leads: notification settings are switched off, never deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."siteId" IS DISTINCT FROM OLD."siteId" THEN
      RAISE EXCEPTION 'leads: notification settings keep their site' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."version" <> OLD."version" + 1 THEN
      RAISE EXCEPTION 'leads: notification settings change one version at a time' USING ERRCODE = 'check_violation';
    END IF;
    added := ARRAY(SELECT unnest(NEW."recipientUserIds") EXCEPT SELECT unnest(OLD."recipientUserIds"));
  ELSE
    IF NEW."version" <> 1 THEN
      RAISE EXCEPTION 'leads: new notification settings start at version 1' USING ERRCODE = 'check_violation';
    END IF;
    added := ARRAY(SELECT DISTINCT unnest(NEW."recipientUserIds"));
  END IF;
  IF cardinality(ARRAY(SELECT DISTINCT unnest(NEW."recipientUserIds"))) <> cardinality(NEW."recipientUserIds") THEN
    RAISE EXCEPTION 'leads: a recipient is on the list once' USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(added) > 0
     AND cardinality(public.leads_notification_eligible(NEW."siteId", added)) <> cardinality(added) THEN
    RAISE EXCEPTION 'leads: a notification recipient needs lead:read on the site'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW."updatedAt" := now();
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "LeadNotificationSetting_guard" BEFORE INSERT OR UPDATE OR DELETE ON "LeadNotificationSetting"
  FOR EACH ROW EXECUTE FUNCTION leads_notification_setting_guard();

REVOKE DELETE ON TABLE "LeadNotificationSetting" FROM dp_app;

-- Row-level security: everyone in the API reads the settings (ids only; the sender has no
-- session); only staff with lead:manage on the site write them, as the session's own user.
ALTER TABLE "LeadNotificationSetting" ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_setting_read ON "LeadNotificationSetting" FOR SELECT TO dp_app
  USING (true);
CREATE POLICY notification_setting_insert ON "LeadNotificationSetting" FOR INSERT TO dp_app
  WITH CHECK ("siteId" = ANY (COALESCE((SELECT leads_rls_staff_manage_site_ids()), '{}'::uuid[]))
              AND "updatedById" = (SELECT leads_rls_staff_user_id()));
CREATE POLICY notification_setting_update ON "LeadNotificationSetting" FOR UPDATE TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT leads_rls_staff_manage_site_ids()), '{}'::uuid[])))
  WITH CHECK ("siteId" = ANY (COALESCE((SELECT leads_rls_staff_manage_site_ids()), '{}'::uuid[]))
              AND "updatedById" = (SELECT leads_rls_staff_user_id()));
