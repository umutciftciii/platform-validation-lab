-- CRM-2 (ADR-032 D6/D7, DP-334 + DP-339): people and their companies, several leads of one
-- person, the base of the CRM history, and same-named legal entities.
--
-- Runs as dp_owner (ADR-012A). Nothing changes for leads but one composite unique index
-- (id, siteId), which lets CRM rows point at a lead of the same site: no lead row, lead activity,
-- lead trigger or lead policy changes. CrmCompany gets two columns (registration number, identity
-- key); the identity key of the existing companies is written once below (their names were unique
-- per site, so every existing key is unique too), and each existing company gets its "created"
-- history row.
--
-- What the database enforces from here on (the API checks the same first, ADR-011 decide):
--   - a person (CrmPerson) belongs to one site and holds no personal data: name and e-mail are
--     those of its leads, so lead retention (DP-096) still clears them;
--   - a lead belongs to at most one person (CrmPersonLead, primary key leadId), a person to at
--     most one company; lead, person and company are always of the same site (composite foreign
--     keys); a link is made or moved only for a live (not anonymised) lead;
--   - people, links and history are read with crm:read on the site and changed only with
--     crm:manage there, through the session's database context (DP-103); creator, editor,
--     version and times are stamped by the database; nobody deletes a person; a link may be
--     removed (the lead becomes a person of its own again);
--   - CrmActivity is append-only: notes come from staff with crm:manage (as themselves); company
--     creation, owner changes, a person's company changes and a lead's person changes are written
--     by the database itself, with the session's user as the actor;
--   - DP-339: two companies of a site may share a name when country, city or registration number
--     tells them apart (identity key, unique per site); a registration number is unique per site.
-- Tested in test/integration/leads.int.test.ts (CRM-2) and db-roles.int.test.ts.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'crm_company_guard')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'crm_rls_staff_manage_site_ids') THEN
    RAISE EXCEPTION 'CRM-2: migration 20261224090000_crm_1_companies must be applied first';
  END IF;
END $$;

-- =============================================================================================
-- Part 1: tables, columns and indexes (follows `prisma migrate diff`; the identity key of the
-- existing companies is written before its unique index exists)
-- =============================================================================================
-- CreateEnum
CREATE TYPE "CrmActivityKind" AS ENUM ('NOTE', 'COMPANY_CREATED', 'COMPANY_OWNER_CHANGED', 'PERSON_COMPANY_CHANGED', 'LEAD_PERSON_CHANGED');

-- DropIndex
DROP INDEX "CrmCompany_siteId_normalizedName_key";

-- AlterTable
ALTER TABLE "CrmCompany" ADD COLUMN     "identityKey" VARCHAR(400) NOT NULL DEFAULT '',
ADD COLUMN     "registrationId" VARCHAR(40);

-- The comparison key of a company's legal identity: name, country, city, registration number.
CREATE FUNCTION crm_company_identity(normalized_name text, country text, city text,
                                     registration_id text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT normalized_name || chr(31) || COALESCE(country, '') || chr(31)
         || COALESCE(public.crm_normalize_name(city), '') || chr(31) || COALESCE(registration_id, '')
$fn$;

-- Existing companies: only the new key is written (no version, editor or time change).
ALTER TABLE "CrmCompany" DISABLE TRIGGER "CrmCompany_guard";
UPDATE "CrmCompany"
SET "identityKey" = public.crm_company_identity("normalizedName", "country", "city", "registrationId");
ALTER TABLE "CrmCompany" ENABLE TRIGGER "CrmCompany_guard";

-- CreateTable
CREATE TABLE "CrmPerson" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "companyId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmPersonLead" (
    "leadId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "linkedById" UUID NOT NULL,
    "linkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmPersonLead_pkey" PRIMARY KEY ("leadId")
);

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteId" UUID NOT NULL,
    "kind" "CrmActivityKind" NOT NULL,
    "companyId" UUID,
    "personId" UUID,
    "leadId" UUID,
    "actorUserId" UUID NOT NULL,
    "body" VARCHAR(4000),
    "fromCompanyId" UUID,
    "toCompanyId" UUID,
    "fromPersonId" UUID,
    "toPersonId" UUID,
    "fromOwnerUserId" UUID,
    "toOwnerUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" BIGSERIAL NOT NULL,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmPerson_siteId_companyId_idx" ON "CrmPerson"("siteId", "companyId");

-- CreateIndex
CREATE INDEX "CrmPerson_companyId_siteId_idx" ON "CrmPerson"("companyId", "siteId");

-- CreateIndex
CREATE INDEX "CrmPerson_createdById_idx" ON "CrmPerson"("createdById");

-- CreateIndex
CREATE INDEX "CrmPerson_updatedById_idx" ON "CrmPerson"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "CrmPerson_id_siteId_key" ON "CrmPerson"("id", "siteId");

-- CreateIndex
CREATE INDEX "CrmPersonLead_personId_siteId_idx" ON "CrmPersonLead"("personId", "siteId");

-- CreateIndex
CREATE INDEX "CrmPersonLead_siteId_idx" ON "CrmPersonLead"("siteId");

-- CreateIndex
CREATE INDEX "CrmPersonLead_linkedById_idx" ON "CrmPersonLead"("linkedById");

-- CreateIndex
CREATE UNIQUE INDEX "CrmPersonLead_leadId_siteId_key" ON "CrmPersonLead"("leadId", "siteId");

-- CreateIndex
CREATE INDEX "CrmActivity_siteId_companyId_seq_idx" ON "CrmActivity"("siteId", "companyId", "seq");

-- CreateIndex
CREATE INDEX "CrmActivity_siteId_fromCompanyId_idx" ON "CrmActivity"("siteId", "fromCompanyId");

-- CreateIndex
CREATE INDEX "CrmActivity_siteId_toCompanyId_idx" ON "CrmActivity"("siteId", "toCompanyId");

-- CreateIndex
CREATE INDEX "CrmActivity_siteId_personId_seq_idx" ON "CrmActivity"("siteId", "personId", "seq");

-- CreateIndex
CREATE INDEX "CrmActivity_siteId_fromPersonId_idx" ON "CrmActivity"("siteId", "fromPersonId");

-- CreateIndex
CREATE INDEX "CrmActivity_siteId_toPersonId_idx" ON "CrmActivity"("siteId", "toPersonId");

-- CreateIndex
CREATE INDEX "CrmActivity_leadId_siteId_idx" ON "CrmActivity"("leadId", "siteId");

-- CreateIndex
CREATE INDEX "CrmActivity_actorUserId_idx" ON "CrmActivity"("actorUserId");

-- CreateIndex
CREATE INDEX "CrmActivity_fromOwnerUserId_idx" ON "CrmActivity"("fromOwnerUserId");

-- CreateIndex
CREATE INDEX "CrmActivity_toOwnerUserId_idx" ON "CrmActivity"("toOwnerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_id_siteId_key" ON "Lead"("id", "siteId");

-- CreateIndex
CREATE INDEX "CrmCompany_siteId_normalizedName_idx" ON "CrmCompany"("siteId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCompany_id_siteId_key" ON "CrmCompany"("id", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCompany_siteId_identityKey_key" ON "CrmCompany"("siteId", "identityKey");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCompany_siteId_registrationId_key" ON "CrmCompany"("siteId", "registrationId");

-- AddForeignKey
ALTER TABLE "CrmPerson" ADD CONSTRAINT "CrmPerson_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPerson" ADD CONSTRAINT "CrmPerson_companyId_siteId_fkey" FOREIGN KEY ("companyId", "siteId") REFERENCES "CrmCompany"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPerson" ADD CONSTRAINT "CrmPerson_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPerson" ADD CONSTRAINT "CrmPerson_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPersonLead" ADD CONSTRAINT "CrmPersonLead_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPersonLead" ADD CONSTRAINT "CrmPersonLead_leadId_siteId_fkey" FOREIGN KEY ("leadId", "siteId") REFERENCES "Lead"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPersonLead" ADD CONSTRAINT "CrmPersonLead_personId_siteId_fkey" FOREIGN KEY ("personId", "siteId") REFERENCES "CrmPerson"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPersonLead" ADD CONSTRAINT "CrmPersonLead_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_companyId_siteId_fkey" FOREIGN KEY ("companyId", "siteId") REFERENCES "CrmCompany"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_personId_siteId_fkey" FOREIGN KEY ("personId", "siteId") REFERENCES "CrmPerson"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_leadId_siteId_fkey" FOREIGN KEY ("leadId", "siteId") REFERENCES "Lead"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_fromCompanyId_siteId_fkey" FOREIGN KEY ("fromCompanyId", "siteId") REFERENCES "CrmCompany"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_toCompanyId_siteId_fkey" FOREIGN KEY ("toCompanyId", "siteId") REFERENCES "CrmCompany"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_fromPersonId_siteId_fkey" FOREIGN KEY ("fromPersonId", "siteId") REFERENCES "CrmPerson"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_toPersonId_siteId_fkey" FOREIGN KEY ("toPersonId", "siteId") REFERENCES "CrmPerson"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_fromOwnerUserId_fkey" FOREIGN KEY ("fromOwnerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_toOwnerUserId_fkey" FOREIGN KEY ("toOwnerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================================
-- Part 2: consistency (CHECK)
-- =============================================================================================
ALTER TABLE "CrmCompany"
  ADD CONSTRAINT "CrmCompany_registration_id"
    CHECK ("registrationId" IS NULL OR "registrationId" ~ '^[A-Z0-9]{2,40}$'),
  ADD CONSTRAINT "CrmCompany_identity_key" CHECK ("identityKey" <> '');

ALTER TABLE "CrmPerson"
  ADD CONSTRAINT "CrmPerson_version" CHECK ("version" >= 0),
  ADD CONSTRAINT "CrmPerson_times" CHECK ("updatedAt" >= "createdAt");

-- Every row is about a company or a person; each kind carries what it is about.
ALTER TABLE "CrmActivity"
  ADD CONSTRAINT "CrmActivity_subject" CHECK ("companyId" IS NOT NULL OR "personId" IS NOT NULL),
  ADD CONSTRAINT "CrmActivity_body"
    CHECK ((("kind" = 'NOTE') = ("body" IS NOT NULL))
           AND ("body" IS NULL OR ("body" = btrim("body") AND "body" <> ''))),
  ADD CONSTRAINT "CrmActivity_note" CHECK ("kind" <> 'NOTE' OR "companyId" IS NOT NULL),
  ADD CONSTRAINT "CrmActivity_owner_change"
    CHECK ("kind" <> 'COMPANY_OWNER_CHANGED'
           OR ("companyId" IS NOT NULL AND "fromOwnerUserId" IS DISTINCT FROM "toOwnerUserId")),
  ADD CONSTRAINT "CrmActivity_person_company"
    CHECK ("kind" <> 'PERSON_COMPANY_CHANGED'
           OR ("personId" IS NOT NULL AND "fromCompanyId" IS DISTINCT FROM "toCompanyId")),
  ADD CONSTRAINT "CrmActivity_lead_person"
    CHECK ("kind" <> 'LEAD_PERSON_CHANGED'
           OR ("leadId" IS NOT NULL AND "personId" IS NOT NULL
               AND "fromPersonId" IS DISTINCT FROM "toPersonId"));

-- =============================================================================================
-- Part 3: helper (SECURITY DEFINER)
-- =============================================================================================
-- Whether a lead of `site_id` exists and is live (not anonymised), answered only for sites where
-- the session's user manages CRM data (no lead data leaves the function).
CREATE FUNCTION crm_rls_lead_live(lead_id uuid, site_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT COALESCE(site_id = ANY (public.crm_rls_staff_manage_site_ids()), false)
         AND EXISTS (SELECT 1 FROM "Lead" l
                     WHERE l."id" = lead_id AND l."siteId" = site_id AND l."anonymisedAt" IS NULL)
$fn$;
REVOKE ALL ON FUNCTION crm_rls_lead_live(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_rls_lead_live(uuid, uuid) TO dp_app;

-- =============================================================================================
-- Part 4: guards and history (triggers)
-- =============================================================================================

-- Companies: CRM-1 unchanged, plus the identity key (DP-339).
CREATE OR REPLACE FUNCTION crm_company_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  actor uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'crm: a company is never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF current_user = 'dp_app' THEN
    actor := public.leads_rls_staff_user_id();
    IF actor IS NULL
       OR NOT (NEW."siteId" = ANY (COALESCE(public.crm_rls_staff_manage_site_ids(), '{}'::uuid[]))) THEN
      RAISE EXCEPTION 'crm: companies are changed by staff with crm:manage on the site only'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF actor IS NOT NULL THEN
      NEW."createdById" := actor;
    END IF;
    NEW."updatedById" := NEW."createdById";
    NEW."version" := 0;
    NEW."createdAt" := now();
    NEW."updatedAt" := NEW."createdAt";
    IF NEW."ownerUserId" IS NOT NULL
       AND NOT public.crm_rls_owner_ok(NEW."ownerUserId", NEW."siteId") THEN
      RAISE EXCEPTION 'crm: the account owner needs crm:manage on the company''s site'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."siteId" IS DISTINCT FROM OLD."siteId"
       OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'crm: a company keeps its id, site and creator'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF actor IS NOT NULL THEN
      NEW."updatedById" := actor;
    END IF;
    NEW."version" := OLD."version" + 1;
    NEW."updatedAt" := GREATEST(now(), OLD."createdAt");
    IF NEW."ownerUserId" IS NOT NULL AND NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId"
       AND NOT public.crm_rls_owner_ok(NEW."ownerUserId", NEW."siteId") THEN
      RAISE EXCEPTION 'crm: the account owner needs crm:manage on the company''s site'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  NEW."normalizedName" := public.crm_normalize_name(NEW."name");
  NEW."identityKey" := public.crm_company_identity(NEW."normalizedName", NEW."country", NEW."city",
                                                   NEW."registrationId");
  RETURN NEW;
END
$fn$;

-- Company history: creation and owner changes, written by the database (runs as the caller, so
-- for dp_app the history insert policy applies: the session's user is the actor).
CREATE FUNCTION crm_company_log() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  actor uuid := COALESCE(public.leads_rls_staff_user_id(), NEW."updatedById");
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "CrmActivity" ("siteId", "kind", "companyId", "actorUserId", "toOwnerUserId")
    VALUES (NEW."siteId", 'COMPANY_CREATED', NEW."id", actor, NEW."ownerUserId");
  ELSIF NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId" THEN
    INSERT INTO "CrmActivity" ("siteId", "kind", "companyId", "actorUserId", "fromOwnerUserId",
                               "toOwnerUserId")
    VALUES (NEW."siteId", 'COMPANY_OWNER_CHANGED', NEW."id", actor, OLD."ownerUserId",
            NEW."ownerUserId");
  END IF;
  RETURN NULL;
END
$fn$;
CREATE TRIGGER "CrmCompany_log" AFTER INSERT OR UPDATE ON "CrmCompany"
  FOR EACH ROW EXECUTE FUNCTION crm_company_log();

-- People: like companies (crm:manage on the site for dp_app; the database stamps creator, editor,
-- version and times; id, site and creator never change; never deleted).
CREATE FUNCTION crm_person_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  actor uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'crm: a person is never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF current_user = 'dp_app' THEN
    actor := public.leads_rls_staff_user_id();
    IF actor IS NULL
       OR NOT (NEW."siteId" = ANY (COALESCE(public.crm_rls_staff_manage_site_ids(), '{}'::uuid[]))) THEN
      RAISE EXCEPTION 'crm: people are changed by staff with crm:manage on the site only'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF actor IS NOT NULL THEN
      NEW."createdById" := actor;
    END IF;
    NEW."updatedById" := NEW."createdById";
    NEW."version" := 0;
    NEW."createdAt" := now();
    NEW."updatedAt" := NEW."createdAt";
  ELSE
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."siteId" IS DISTINCT FROM OLD."siteId"
       OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'crm: a person keeps its id, site and creator'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF actor IS NOT NULL THEN
      NEW."updatedById" := actor;
    END IF;
    NEW."version" := OLD."version" + 1;
    NEW."updatedAt" := GREATEST(now(), OLD."createdAt");
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "CrmPerson_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CrmPerson"
  FOR EACH ROW EXECUTE FUNCTION crm_person_guard();

-- A person's company changes (including the first company) go to the history.
CREATE FUNCTION crm_person_log() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  actor uuid := COALESCE(public.leads_rls_staff_user_id(), NEW."updatedById");
  before uuid := CASE WHEN TG_OP = 'UPDATE' THEN OLD."companyId" END;
BEGIN
  IF NEW."companyId" IS DISTINCT FROM before THEN
    INSERT INTO "CrmActivity" ("siteId", "kind", "personId", "actorUserId", "fromCompanyId",
                               "toCompanyId")
    VALUES (NEW."siteId", 'PERSON_COMPANY_CHANGED', NEW."id", actor, before, NEW."companyId");
  END IF;
  RETURN NULL;
END
$fn$;
CREATE TRIGGER "CrmPerson_log" AFTER INSERT OR UPDATE ON "CrmPerson"
  FOR EACH ROW EXECUTE FUNCTION crm_person_log();

-- Lead → person links: made, moved or removed by staff with crm:manage on the site; only a live
-- lead is linked or moved; the lead and the site of a link never change.
CREATE FUNCTION crm_person_lead_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  actor uuid;
  row_site uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD."siteId" ELSE NEW."siteId" END;
BEGIN
  IF current_user = 'dp_app' THEN
    actor := public.leads_rls_staff_user_id();
    IF actor IS NULL
       OR NOT (row_site = ANY (COALESCE(public.crm_rls_staff_manage_site_ids(), '{}'::uuid[]))) THEN
      RAISE EXCEPTION 'crm: people and their leads are linked by staff with crm:manage only'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."leadId" IS DISTINCT FROM OLD."leadId"
                           OR NEW."siteId" IS DISTINCT FROM OLD."siteId") THEN
    RAISE EXCEPTION 'crm: a link keeps its lead and site' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."personId" IS NOT DISTINCT FROM OLD."personId" THEN
    RAISE EXCEPTION 'crm: a link changes only its person' USING ERRCODE = 'check_violation';
  END IF;
  IF current_user = 'dp_app' THEN
    IF NOT public.crm_rls_lead_live(NEW."leadId", NEW."siteId") THEN
      RAISE EXCEPTION 'crm: only a live lead of the site is linked to a person'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM "Lead" l WHERE l."id" = NEW."leadId" AND l."siteId" = NEW."siteId"
                      AND l."anonymisedAt" IS NULL) THEN
    RAISE EXCEPTION 'crm: only a live lead of the site is linked to a person'
      USING ERRCODE = 'check_violation';
  END IF;
  IF actor IS NOT NULL THEN
    NEW."linkedById" := actor;
  END IF;
  NEW."linkedAt" := now();
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "CrmPersonLead_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CrmPersonLead"
  FOR EACH ROW EXECUTE FUNCTION crm_person_lead_guard();

-- Every link change goes to the history of the person it concerns (the new one when moved).
CREATE FUNCTION crm_person_lead_log() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  actor uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    actor := COALESCE(public.leads_rls_staff_user_id(), OLD."linkedById");
    INSERT INTO "CrmActivity" ("siteId", "kind", "personId", "leadId", "actorUserId",
                               "fromPersonId", "toPersonId")
    VALUES (OLD."siteId", 'LEAD_PERSON_CHANGED', OLD."personId", OLD."leadId", actor,
            OLD."personId", NULL);
    RETURN NULL;
  END IF;
  actor := COALESCE(public.leads_rls_staff_user_id(), NEW."linkedById");
  INSERT INTO "CrmActivity" ("siteId", "kind", "personId", "leadId", "actorUserId", "fromPersonId",
                             "toPersonId")
  VALUES (NEW."siteId", 'LEAD_PERSON_CHANGED', NEW."personId", NEW."leadId", actor,
          CASE WHEN TG_OP = 'UPDATE' THEN OLD."personId" END, NEW."personId");
  RETURN NULL;
END
$fn$;
CREATE TRIGGER "CrmPersonLead_log" AFTER INSERT OR UPDATE OR DELETE ON "CrmPersonLead"
  FOR EACH ROW EXECUTE FUNCTION crm_person_lead_log();

-- History: append-only. Notes come from staff; every other kind only from the triggers above.
CREATE FUNCTION crm_activity_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'crm: history is a record and cannot change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."kind" <> 'NOTE' AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'crm: only notes are written directly; the rest of the history is written by the database'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW."createdAt" := now();
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "CrmActivity_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CrmActivity"
  FOR EACH ROW EXECUTE FUNCTION crm_activity_guard();

-- The existing companies get their "created" row (time and creator of the company; the owner at
-- creation is not known, so none is named).
ALTER TABLE "CrmActivity" DISABLE TRIGGER "CrmActivity_guard";
INSERT INTO "CrmActivity" ("id", "siteId", "kind", "companyId", "actorUserId", "createdAt")
SELECT gen_random_uuid(), c."siteId", 'COMPANY_CREATED', c."id", c."createdById", c."createdAt"
FROM "CrmCompany" c
ORDER BY c."createdAt", c."id";
ALTER TABLE "CrmActivity" ENABLE TRIGGER "CrmActivity_guard";

-- =============================================================================================
-- Part 5: privileges and policies
-- =============================================================================================
-- dp_app got SELECT, INSERT, UPDATE and DELETE through the default privileges (ADR-012A): a
-- person is never deleted, the history is only appended to; links may be removed.
REVOKE DELETE ON TABLE "CrmPerson" FROM dp_app;
REVOKE UPDATE, DELETE ON TABLE "CrmActivity" FROM dp_app;

-- Deny by default; staff read where they hold crm:read, write where they hold crm:manage.
ALTER TABLE "CrmPerson" ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_person_staff_read ON "CrmPerson" FOR SELECT TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT crm_rls_staff_read_site_ids()), '{}'::uuid[])));
CREATE POLICY crm_person_staff_insert ON "CrmPerson" FOR INSERT TO dp_app
  WITH CHECK ("siteId" = ANY (COALESCE((SELECT crm_rls_staff_manage_site_ids()), '{}'::uuid[])));
CREATE POLICY crm_person_staff_update ON "CrmPerson" FOR UPDATE TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT crm_rls_staff_manage_site_ids()), '{}'::uuid[])))
  WITH CHECK ("siteId" = ANY (COALESCE((SELECT crm_rls_staff_manage_site_ids()), '{}'::uuid[])));

ALTER TABLE "CrmPersonLead" ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_person_lead_staff_read ON "CrmPersonLead" FOR SELECT TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT crm_rls_staff_read_site_ids()), '{}'::uuid[])));
CREATE POLICY crm_person_lead_staff_insert ON "CrmPersonLead" FOR INSERT TO dp_app
  WITH CHECK ("siteId" = ANY (COALESCE((SELECT crm_rls_staff_manage_site_ids()), '{}'::uuid[])));
CREATE POLICY crm_person_lead_staff_update ON "CrmPersonLead" FOR UPDATE TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT crm_rls_staff_manage_site_ids()), '{}'::uuid[])))
  WITH CHECK ("siteId" = ANY (COALESCE((SELECT crm_rls_staff_manage_site_ids()), '{}'::uuid[])));
CREATE POLICY crm_person_lead_staff_delete ON "CrmPersonLead" FOR DELETE TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT crm_rls_staff_manage_site_ids()), '{}'::uuid[])));

ALTER TABLE "CrmActivity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_activity_staff_read ON "CrmActivity" FOR SELECT TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT crm_rls_staff_read_site_ids()), '{}'::uuid[])));
CREATE POLICY crm_activity_staff_insert ON "CrmActivity" FOR INSERT TO dp_app
  WITH CHECK ("siteId" = ANY (COALESCE((SELECT crm_rls_staff_manage_site_ids()), '{}'::uuid[]))
              AND "actorUserId" = (SELECT leads_rls_staff_user_id()));
