-- DP-287 (ADR-030 D1, D2): platform-wide module switches; the first one is the AI Center ("ai"),
-- persistent and OFF.
--
-- Runs as dp_owner (ADR-012A). Additive: one catalogue row, one table, functions, triggers and
-- policies; no existing column, row or function body changes.
--
--   1. "FeatureModule" row "ai" (optional). iam sync keeps its name and description aligned with
--      src/iam/catalog.ts; the row exists here already so the state row below can reference it.
--   2. "PlatformModuleState": one row per platform module, created OFF by its migration. A missing
--      row counts as off (fail closed). Only the system owner changes it: row-level security
--      (iam_rls_staff_is_owner(), as for "ModuleConfiguration", DP-125 K4), and the API asks for
--      module:manage (owner-only) with a fresh step-up. Never deleted or truncated (trigger); its
--      module never changes; "version" rises by exactly one per change; "updatedAt" is set here.
--   3. A platform module has no per-site switch: "ModuleConfiguration" refuses its rows.
--   4. Owner-only permissions (module:manage, owner_audit:read) can be linked to the
--      non-assignable system_owner role only, in the database as in the code catalogue (DP-108,
--      owner decision 2026-11-26: the global AI switch belongs to the system owner alone).
--   5. platform_module_enabled(key): the state as a boolean, for any staff request.
--      platform_module_hold_enabled(key): the same, holding the switch until the caller's
--      transaction ends (a SHARED transaction advisory lock of the module, then the row FOR
--      SHARE). Work that must not start once a module is off (an AI provider call, DP-290/DP-291)
--      begins inside such a transaction. platform_module_switch_lock(key): the owner's switch takes
--      the EXCLUSIVE advisory lock first, so it waits for the running holders only: the lock
--      manager queues new shared requests behind a waiting exclusive one (a row lock alone would
--      let new FOR SHARE lockers overtake a waiting UPDATE indefinitely). After the switch-off
--      COMMIT every later start sees "off". platform_modules_enabled(): the enabled keys, for the
--      authorization snapshot. SECURITY DEFINER, booleans/keys only, no EXECUTE for PUBLIC.
--
-- Tested in test/integration/owner.int.test.ts (DP-287 block) and db-roles.int.test.ts.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_iam_bootstrap') THEN
    RAISE EXCEPTION 'DP-287: database roles missing; run infra/docker/stack.sh db-roles <dev|prod> --yes first (dp-roles.sql)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'iam_rls_staff_is_owner') THEN
    RAISE EXCEPTION 'DP-287: migration 20261125090000_dp_125_iam_row_level_security must be applied first';
  END IF;
END $$;

-- =============================================================================================
-- Part 1: the module and its state
-- =============================================================================================

INSERT INTO "FeatureModule" ("id", "key", "name", "description", "isCore", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'ai', 'AI Center',
        'AI providers, models, budgets and usage (optional; switched platform-wide by the system owner)',
        false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "FeatureModule" WHERE "key" = 'ai' AND "isCore") THEN
    RAISE EXCEPTION 'DP-287: module "ai" exists as a core module';
  END IF;
END $$;

-- CreateTable
CREATE TABLE "PlatformModuleState" (
    "moduleKey" VARCHAR(64) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(1000) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformModuleState_pkey" PRIMARY KEY ("moduleKey")
);

-- AddForeignKey
ALTER TABLE "PlatformModuleState" ADD CONSTRAINT "PlatformModuleState_moduleKey_fkey" FOREIGN KEY ("moduleKey") REFERENCES "FeatureModule"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformModuleState" ADD CONSTRAINT "PlatformModuleState_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlatformModuleState"
  ADD CONSTRAINT "PlatformModuleState_reason" CHECK (char_length(btrim("reason")) >= 3),
  ADD CONSTRAINT "PlatformModuleState_version" CHECK ("version" >= 1);

CREATE FUNCTION platform_module_state_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'platform modules: a module state is never removed' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "FeatureModule" WHERE "key" = NEW."moduleKey" AND "isCore") THEN
    RAISE EXCEPTION 'platform modules: core modules are not switched' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."moduleKey" IS DISTINCT FROM OLD."moduleKey" THEN
      RAISE EXCEPTION 'platform modules: the module of a state never changes' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."version" IS DISTINCT FROM OLD."version" + 1 THEN
      RAISE EXCEPTION 'platform modules: every change raises the version by one' USING ERRCODE = 'check_violation';
    END IF;
    NEW."createdAt" := OLD."createdAt";
    NEW."updatedAt" := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "PlatformModuleState_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PlatformModuleState"
  FOR EACH ROW EXECUTE FUNCTION platform_module_state_guard();

CREATE FUNCTION platform_module_state_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'platform modules: module states are never removed' USING ERRCODE = 'check_violation';
END
$fn$;
CREATE TRIGGER "PlatformModuleState_no_truncate" BEFORE TRUNCATE ON "PlatformModuleState"
  FOR EACH STATEMENT EXECUTE FUNCTION platform_module_state_no_truncate();

-- The AI Center starts OFF (owner decision 2026-11-26).
INSERT INTO "PlatformModuleState" ("moduleKey", "enabled", "reason")
VALUES ('ai', false, 'DP-287: off by default (ADR-030 D1)');

-- =============================================================================================
-- Part 2: no per-site switch for a platform module; owner-only permissions stay with the owner
-- =============================================================================================

-- SECURITY DEFINER: the trigger runs as the writing role, which cannot read "PlatformModuleState"
-- under row-level security unless it is the owner. Answers through the exception only.
CREATE FUNCTION iam_module_configuration_platform_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM "PlatformModuleState" s
             JOIN "FeatureModule" f ON f."key" = s."moduleKey"
             WHERE f."id" = NEW."moduleId") THEN
    RAISE EXCEPTION 'iam: a platform module is switched platform-wide, not per site'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION iam_module_configuration_platform_guard() FROM PUBLIC;
CREATE TRIGGER "ModuleConfiguration_platform_guard" BEFORE INSERT OR UPDATE ON "ModuleConfiguration"
  FOR EACH ROW EXECUTE FUNCTION iam_module_configuration_platform_guard();

-- The owner-only permissions of the code catalogue (src/iam/catalog.ts, `ownerOnly`); a unit test
-- keeps the two lists equal.
CREATE FUNCTION iam_owner_only_permission_keys() RETURNS text[] LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT ARRAY['module:manage', 'owner_audit:read']::text[]
$fn$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "RolePermission" rp
             JOIN "Permission" p ON p."id" = rp."permissionId"
             JOIN "Role" r ON r."id" = rp."roleId"
             WHERE p."key" = ANY (iam_owner_only_permission_keys()) AND r."key" <> 'system_owner') THEN
    RAISE EXCEPTION 'DP-287: an owner-only permission is linked to a role other than system_owner; fix the catalogue (iam sync) first';
  END IF;
END $$;

CREATE FUNCTION iam_role_permission_owner_only_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF (SELECT p."key" FROM "Permission" p WHERE p."id" = NEW."permissionId")
       = ANY (iam_owner_only_permission_keys())
     AND (SELECT r."key" FROM "Role" r WHERE r."id" = NEW."roleId") IS DISTINCT FROM 'system_owner' THEN
    RAISE EXCEPTION 'iam: owner-only permissions belong to the system owner only (DP-108, DP-287)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "RolePermission_owner_only_guard" BEFORE INSERT OR UPDATE ON "RolePermission"
  FOR EACH ROW EXECUTE FUNCTION iam_role_permission_owner_only_guard();

-- =============================================================================================
-- Part 3: reading the state (booleans and keys only)
-- =============================================================================================

CREATE FUNCTION platform_module_enabled(p_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT COALESCE((SELECT s."enabled" FROM "PlatformModuleState" s WHERE s."moduleKey" = p_key), false)
$fn$;

-- The advisory lock space of the platform-module switches: (287, hashtext(module key)).
-- Held until the caller's transaction ends; the owner's switch waits for it.
CREATE FUNCTION platform_module_hold_enabled(p_key text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  state boolean;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(287, hashtext(p_key));
  SELECT s."enabled" INTO state FROM "PlatformModuleState" s WHERE s."moduleKey" = p_key FOR SHARE;
  RETURN COALESCE(state, false);
END
$fn$;

-- Taken by the owner's switch before its UPDATE (owner.service.ts). Returns true (no data).
CREATE FUNCTION platform_module_switch_lock(p_key text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(287, hashtext(p_key));
  RETURN true;
END
$fn$;

CREATE FUNCTION platform_modules_enabled() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT COALESCE(array_agg(s."moduleKey"::text ORDER BY s."moduleKey") FILTER (WHERE s."enabled"),
                  '{}'::text[])
  FROM "PlatformModuleState" s
$fn$;

REVOKE ALL ON FUNCTION platform_module_enabled(text), platform_module_hold_enabled(text),
  platform_module_switch_lock(text), platform_modules_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_module_enabled(text), platform_module_hold_enabled(text),
  platform_module_switch_lock(text), platform_modules_enabled() TO dp_app;
-- The authorization snapshot is also loaded by the bootstrap and operator paths.
GRANT EXECUTE ON FUNCTION platform_modules_enabled() TO dp_iam_bootstrap;

-- =============================================================================================
-- Part 4: privileges and row-level security
-- =============================================================================================

-- Rows come from migrations only; the owner changes them, nobody removes them (TRUNCATE is not
-- among the default privileges; the trigger refuses it for every role).
REVOKE INSERT, DELETE ON TABLE "PlatformModuleState" FROM dp_app;

ALTER TABLE "PlatformModuleState" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_module_state_owner_read ON "PlatformModuleState" FOR SELECT TO dp_app
  USING ((SELECT iam_rls_staff_is_owner()));
CREATE POLICY platform_module_state_owner_update ON "PlatformModuleState" FOR UPDATE TO dp_app
  USING ((SELECT iam_rls_staff_is_owner())) WITH CHECK ((SELECT iam_rls_staff_is_owner()));
