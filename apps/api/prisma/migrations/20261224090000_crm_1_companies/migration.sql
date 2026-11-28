-- CRM-1 (ADR-032): CRM 360° companies and their account owners.
--
-- Runs as dp_owner (ADR-012A). Additive: one new table with its functions, policies and trigger;
-- the DP-041 permission helper `leads_rls_user_lead_sites` is replaced in place (CREATE OR
-- REPLACE) with the same answer for lead:read and lead:manage, and now also for crm:read and
-- crm:manage; the "crm" feature module becomes core (CRM 360° is standard scope, ADR-032 D1;
-- a core module can never be downgraded again, F1-001 trigger). No existing row changes besides
-- that catalogue row.
--
-- What the database enforces from here on (the API checks the same first, ADR-011 decide):
--   - a company is read by staff with crm:read on its site and created or changed only by staff
--     with crm:manage there (sales_crm_user on that site, the platform super admin, the system
--     owner), through the session's database context (DP-103); without that context dp_app sees
--     and writes no row;
--   - the creator, the last editor, the version and the times are stamped by the database (the
--     API cannot forge them); `normalizedName` is derived from the name and unique per site;
--   - the account owner, when set or changed, is an ACTIVE staff user with crm:manage on the
--     company's site (site role with an ACTIVE membership, platform role, or the system owner);
--   - id, site, creator and creation time never change; nobody deletes a company (dp_app has no
--     DELETE, the trigger refuses it for everyone else too).
-- Tested in test/integration/leads.int.test.ts (CRM-1) and db-roles.int.test.ts.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'leads_rls_user_lead_sites')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'leads_rls_staff_user_id') THEN
    RAISE EXCEPTION 'CRM-1: migration 20261124090000_dp_041_lead_sales_workflow must be applied first';
  END IF;
END $$;

-- =============================================================================================
-- Part 1: table (follows `prisma migrate diff`)
-- =============================================================================================
-- CreateTable
CREATE TABLE "CrmCompany" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "normalizedName" VARCHAR(200) NOT NULL DEFAULT '',
    "country" CHAR(2),
    "city" VARCHAR(120),
    "address" VARCHAR(500),
    "website" VARCHAR(300),
    "phone" VARCHAR(40),
    "email" VARCHAR(254),
    "description" VARCHAR(2000),
    "internalNotes" VARCHAR(4000),
    "ownerUserId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmCompany_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmCompany_siteId_updatedAt_idx" ON "CrmCompany"("siteId", "updatedAt");

-- CreateIndex
CREATE INDEX "CrmCompany_ownerUserId_idx" ON "CrmCompany"("ownerUserId");

-- CreateIndex
CREATE INDEX "CrmCompany_createdById_idx" ON "CrmCompany"("createdById");

-- CreateIndex
CREATE INDEX "CrmCompany_updatedById_idx" ON "CrmCompany"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCompany_siteId_normalizedName_key" ON "CrmCompany"("siteId", "normalizedName");

-- AddForeignKey
ALTER TABLE "CrmCompany" ADD CONSTRAINT "CrmCompany_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCompany" ADD CONSTRAINT "CrmCompany_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCompany" ADD CONSTRAINT "CrmCompany_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCompany" ADD CONSTRAINT "CrmCompany_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================================
-- Part 2: consistency (CHECK)
-- =============================================================================================
-- Single-line texts: trimmed, not empty, no control characters. Multi-line texts: trimmed, not
-- empty (line breaks allowed). Optional fields are NULL rather than "".
ALTER TABLE "CrmCompany"
  ADD CONSTRAINT "CrmCompany_name"
    CHECK ("name" = btrim("name") AND length("name") BETWEEN 1 AND 200 AND "name" !~ '[[:cntrl:]]'),
  ADD CONSTRAINT "CrmCompany_normalized_name" CHECK ("normalizedName" <> ''),
  ADD CONSTRAINT "CrmCompany_country" CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "CrmCompany_city"
    CHECK ("city" IS NULL OR ("city" = btrim("city") AND "city" <> '' AND "city" !~ '[[:cntrl:]]')),
  ADD CONSTRAINT "CrmCompany_address"
    CHECK ("address" IS NULL OR ("address" = btrim("address") AND "address" <> '')),
  ADD CONSTRAINT "CrmCompany_website"
    CHECK ("website" IS NULL OR "website" ~* '^https?://[^[:space:]]+$'),
  ADD CONSTRAINT "CrmCompany_phone"
    CHECK ("phone" IS NULL OR "phone" ~ '^[+0-9(][0-9 ()./-]{2,39}$'),
  ADD CONSTRAINT "CrmCompany_email"
    CHECK ("email" IS NULL OR ("email" = lower("email")
                               AND "email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  ADD CONSTRAINT "CrmCompany_description"
    CHECK ("description" IS NULL OR ("description" = btrim("description") AND "description" <> '')),
  ADD CONSTRAINT "CrmCompany_internal_notes"
    CHECK ("internalNotes" IS NULL OR ("internalNotes" = btrim("internalNotes") AND "internalNotes" <> '')),
  ADD CONSTRAINT "CrmCompany_version" CHECK ("version" >= 0),
  ADD CONSTRAINT "CrmCompany_times" CHECK ("updatedAt" >= "createdAt");

-- =============================================================================================
-- Part 3: who may read and change companies
-- =============================================================================================

-- DP-041's helper, now also for the CRM permissions (same rule: decide() for a core,
-- non-sensitive site permission; the system owner everywhere). Body unchanged otherwise.
CREATE OR REPLACE FUNCTION leads_rls_user_lead_sites(uid uuid, permission text) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  IF uid IS NULL OR permission IS NULL
     OR permission NOT IN ('lead:read', 'lead:manage', 'crm:read', 'crm:manage') THEN
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

-- The sites where the session's user reads CRM companies (crm:read).
CREATE FUNCTION crm_rls_staff_read_site_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT public.leads_rls_user_lead_sites(public.leads_rls_staff_user_id(), 'crm:read')
$fn$;

-- The sites where the session's user creates and changes CRM companies (crm:manage).
CREATE FUNCTION crm_rls_staff_manage_site_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT public.leads_rls_user_lead_sites(public.leads_rls_staff_user_id(), 'crm:manage')
$fn$;

-- Whether `candidate` may own the companies of `site_id`: crm:manage there (an answer about one
-- staff user's access, no CRM data).
CREATE FUNCTION crm_rls_owner_ok(candidate uuid, site_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT COALESCE(site_id = ANY (public.leads_rls_user_lead_sites(candidate, 'crm:manage')), false)
$fn$;

-- (site, user) ids of the staff who may own the companies of the given sites (crm:manage there),
-- answered only for the sites whose companies the session's user reads. Names come from "User".
CREATE FUNCTION crm_rls_assignable_owners(site_ids uuid[])
RETURNS TABLE (site_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  WITH readable AS (
    SELECT s AS site_id
    FROM unnest(COALESCE(site_ids, '{}'::uuid[])) s
    WHERE s = ANY (public.leads_rls_user_lead_sites(public.leads_rls_staff_user_id(), 'crm:read'))
  ), candidates AS (
    SELECT DISTINCT ra."userId" AS user_id
    FROM "RoleAssignment" ra
    JOIN "User" u ON u."id" = ra."userId"
    WHERE ra."revokedAt" IS NULL AND (ra."expiresAt" IS NULL OR ra."expiresAt" > now())
      AND u."status" = 'ACTIVE' AND u."kind" = 'STAFF'
    UNION
    SELECT o."userId" FROM "SystemOwner" o
  )
  SELECT r.site_id, c.user_id
  FROM readable r CROSS JOIN candidates c
  WHERE r.site_id = ANY (public.leads_rls_user_lead_sites(c.user_id, 'crm:manage'))
  ORDER BY 1, 2
$fn$;

REVOKE ALL ON FUNCTION crm_rls_staff_read_site_ids(), crm_rls_staff_manage_site_ids(),
  crm_rls_owner_ok(uuid, uuid), crm_rls_assignable_owners(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_rls_staff_read_site_ids(), crm_rls_staff_manage_site_ids(),
  crm_rls_owner_ok(uuid, uuid), crm_rls_assignable_owners(uuid[]) TO dp_app;

-- The comparison key of a company name: trimmed, inner white space collapsed, lower case.
CREATE FUNCTION crm_normalize_name(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT lower(regexp_replace(btrim(value), '[[:space:]]+', ' ', 'g'))
$fn$;

-- =============================================================================================
-- Part 4: guard (trigger)
-- =============================================================================================
-- Runs as the caller. For dp_app (the API) the session's user must hold crm:manage on the site
-- (as the policies say) and becomes the creator / last editor. The database also writes the
-- comparison key, the version and the times, and checks a new account owner. Other roles
-- (dp_owner: migrations, fixtures) name the creator themselves but get the same bookkeeping.
CREATE FUNCTION crm_company_guard() RETURNS trigger LANGUAGE plpgsql
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
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "CrmCompany_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CrmCompany"
  FOR EACH ROW EXECUTE FUNCTION crm_company_guard();

-- =============================================================================================
-- Part 5: privileges and policies
-- =============================================================================================
-- dp_app got SELECT, INSERT, UPDATE and DELETE through the default privileges (ADR-012A); a
-- company is never deleted.
REVOKE DELETE ON TABLE "CrmCompany" FROM dp_app;

-- Deny by default; staff read where they hold crm:read, write where they hold crm:manage.
-- `(SELECT f())` makes each context function an InitPlan: evaluated once per statement.
ALTER TABLE "CrmCompany" ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_company_staff_read ON "CrmCompany" FOR SELECT TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT crm_rls_staff_read_site_ids()), '{}'::uuid[])));
CREATE POLICY crm_company_staff_insert ON "CrmCompany" FOR INSERT TO dp_app
  WITH CHECK ("siteId" = ANY (COALESCE((SELECT crm_rls_staff_manage_site_ids()), '{}'::uuid[])));
CREATE POLICY crm_company_staff_update ON "CrmCompany" FOR UPDATE TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT crm_rls_staff_manage_site_ids()), '{}'::uuid[])))
  WITH CHECK ("siteId" = ANY (COALESCE((SELECT crm_rls_staff_manage_site_ids()), '{}'::uuid[])));

-- =============================================================================================
-- Part 6: the catalogue row of the module (the code catalogue says the same; `iam sync` would
-- write it too). Upgrading to core is allowed; downgrading never is (F1-001 trigger).
-- =============================================================================================
UPDATE "FeatureModule"
SET "isCore" = true, "name" = 'CRM 360°',
    "description" = 'Companies, contacts, account owners and contact history',
    "updatedAt" = now()
WHERE "key" = 'crm' AND NOT "isCore";
