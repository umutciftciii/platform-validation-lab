-- ADR-012A: table privileges of the separated database roles (F1-002 Group 0, DP-078).
--
-- Runs as dp_owner (the migrator's sessions start as dp_owner) and only changes privileges: no
-- table, column, constraint or row changes. The roles themselves, the database privileges and the
-- ownership of existing objects are infrastructure work (infra/docker/postgres/dp-roles.sql),
-- because roles are cluster objects and only a superuser can take over objects it created.
--
-- Least privilege:
--   dp_app            DML on application tables; SELECT/INSERT only on AuditEvent; SELECT only
--                     on the IAM catalogue (FeatureModule, Permission, Role, RolePermission),
--                     which the guard triggers read; nothing on _prisma_migrations; no DDL,
--                     TRUNCATE, ownership or role switch.
--   dp_iam_bootstrap  what the one-time bootstrap needs: read the catalogue and admin state, insert
--                     the user, the assignment and the audit event. No UPDATE, DELETE or DDL.
--   dp_migrator       nothing directly; it acts as dp_owner (SET ROLE), which owns everything.
--   dp_iam_system     nothing yet; it will own SECURITY DEFINER functions (DP-039).

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(r, ', ')
  INTO missing
  FROM unnest(ARRAY['dp_owner', 'dp_migrator', 'dp_app', 'dp_iam_bootstrap', 'dp_iam_system']) AS r
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'ADR-012A: database roles missing (%); apply infra/docker/postgres/dp-roles.sql first (stack.sh db-roles)', missing;
  END IF;
END $$;

-- dp_app: application data.
GRANT USAGE ON SCHEMA public TO dp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dp_app;

-- Exceptions. AuditEvent is append-only: no privilege to change rows, in addition to the trigger.
REVOKE UPDATE, DELETE ON TABLE "AuditEvent" FROM dp_app;
-- The catalogue is written only by iam:sync (dp_owner). The customer-data and role guards read it,
-- so the API must not be able to change what they see.
REVOKE INSERT, UPDATE, DELETE
  ON TABLE "FeatureModule", "Permission", "Role", "RolePermission" FROM dp_app;
-- Prisma's migration history belongs to the runner. It does not exist in a shadow database.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public._prisma_migrations FROM dp_app, dp_iam_bootstrap';
  END IF;
END $$;

-- dp_iam_bootstrap: the bootstrap transaction and the triggers it fires (role guard, customer-data
-- guard, reciprocal guard) read these tables as the invoking role.
GRANT USAGE ON SCHEMA public TO dp_iam_bootstrap;
GRANT SELECT ON TABLE "FeatureModule", "Permission", "Role", "RolePermission", "RoleAssignment", "User"
  TO dp_iam_bootstrap;
GRANT INSERT ON TABLE "User", "RoleAssignment", "AuditEvent" TO dp_iam_bootstrap;

-- Tables and sequences created by later migrations (always as dp_owner) get the dp_app data
-- privileges automatically. Exceptions are revoked in the migration that creates the table.
ALTER DEFAULT PRIVILEGES FOR ROLE dp_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dp_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO dp_app;
