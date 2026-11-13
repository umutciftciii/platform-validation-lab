-- ADR-012A: database roles, ownership and database-level privileges. Idempotent.
--
-- Cluster and superuser work only: roles are cluster objects, and transferring the ownership of
-- objects that a superuser created needs a superuser. A Prisma migration can do neither, so this
-- file is run by infrastructure, never by the migration runner:
--
--   - empty data directory: /docker-entrypoint-initdb.d/10-dp-roles.sh (first start only);
--   - existing database:    infra/docker/stack.sh db-roles <dev|prod> (operator, after a backup);
--   - CI service database:  the integration job pipes this file into psql.
--
-- Every run converges to the same state, so running it again is safe. Table and sequence grants
-- and default privileges are schema state and live in the migration
-- 20261110230000_adr_012a_database_roles, which the migration runner applies as dp_owner.
--
-- psql variables (all required): dp_app_password, dp_migrator_password,
-- dp_iam_bootstrap_password, dp_profile (dev | prod | test). Passwords are sent to the server in
-- ALTER ROLE statements and stored as SCRAM verifiers (password_encryption = scram-sha-256).
-- Statement logging is off by default; never run this with log_statement = all.

\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = warning;

\if :{?dp_app_password}
\else
  \echo 'dp-roles: psql variable dp_app_password is missing'
  DO $$ BEGIN RAISE EXCEPTION 'dp-roles: missing psql variable dp_app_password'; END $$;
\endif
\if :{?dp_migrator_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'dp-roles: missing psql variable dp_migrator_password'; END $$;
\endif
\if :{?dp_iam_bootstrap_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'dp-roles: missing psql variable dp_iam_bootstrap_password'; END $$;
\endif
\if :{?dp_profile}
\else
  DO $$ BEGIN RAISE EXCEPTION 'dp-roles: missing psql variable dp_profile'; END $$;
\endif

-- Fail closed on weak or shared passwords and on an unknown profile, before anything changes.
SELECT
  length(:'dp_app_password') >= 16
  AND length(:'dp_migrator_password') >= 16
  AND length(:'dp_iam_bootstrap_password') >= 16
  AND :'dp_app_password' <> :'dp_migrator_password'
  AND :'dp_app_password' <> :'dp_iam_bootstrap_password'
  AND :'dp_migrator_password' <> :'dp_iam_bootstrap_password' AS dp_passwords_ok,
  :'dp_profile' IN ('dev', 'prod', 'test') AS dp_profile_ok
\gset
\if :dp_passwords_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'dp-roles: role passwords must be at least 16 characters and all different'; END $$;
\endif
\if :dp_profile_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'dp-roles: dp_profile must be dev, prod or test'; END $$;
\endif

BEGIN;

-- One run at a time (two operators, or init racing an operator).
DO $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('dp-roles')); END $$;

-- 1. Roles. Created if missing, then every attribute is set explicitly, so a hand-made change
--    (for example SUPERUSER or BYPASSRLS on dp_app) is undone by the next run.
SELECT format('CREATE ROLE %I NOLOGIN', r)
FROM unnest(ARRAY['dp_owner', 'dp_migrator', 'dp_app', 'dp_iam_bootstrap', 'dp_iam_system',
                   'dp_lead_retention']) AS r
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
\gexec

-- dp_owner owns the schema and every object in it. Nobody logs in as it. CREATEDB only in dev,
-- where `prisma migrate dev` creates its own shadow database.
SELECT format(
  'ALTER ROLE dp_owner NOLOGIN NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT %s',
  CASE WHEN :'dp_profile' = 'dev' THEN 'CREATEDB' ELSE 'NOCREATEDB' END)
\gexec
-- The migration runner. It inherits nothing; its sessions switch to dp_owner at login (below).
ALTER ROLE dp_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
-- The API. Data access only; no membership, no DDL, not an owner.
ALTER ROLE dp_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
-- Operator CLI for the one-time bootstrap of the first platform administrator (ADR-011 section 6).
-- Its credential is never given to the API (ADR-013 D14).
ALTER ROLE dp_iam_bootstrap LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
-- Owner of future SECURITY DEFINER functions with a narrow interface (ADR-013 D14, DP-039).
ALTER ROLE dp_iam_system NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
-- Lead retention and erasure (DP-096, ADR-003 §5): column-level rights to clear identity fields,
-- granted by migration 20261122090000_dp_096_lead_retention. Nobody logs in as it; the operator
-- credential dp_iam_bootstrap switches to it with SET ROLE (below). dp_app cannot.
ALTER ROLE dp_lead_retention NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

SELECT format('ALTER ROLE dp_app PASSWORD %L', :'dp_app_password') \gexec
SELECT format('ALTER ROLE dp_migrator PASSWORD %L', :'dp_migrator_password') \gexec
SELECT format('ALTER ROLE dp_iam_bootstrap PASSWORD %L', :'dp_iam_bootstrap_password') \gexec
ALTER ROLE dp_owner PASSWORD NULL;
ALTER ROLE dp_iam_system PASSWORD NULL;
ALTER ROLE dp_lead_retention PASSWORD NULL;

-- 2. Memberships. dp_migrator may SET ROLE dp_owner and dp_iam_bootstrap may SET ROLE
--    dp_lead_retention (DP-096), neither inheriting the privileges; every other membership among
--    the dp_* roles is removed.
SELECT format('REVOKE %I FROM %I', g.rolname, m.rolname)
FROM pg_auth_members am
JOIN pg_roles g ON g.oid = am.roleid
JOIN pg_roles m ON m.oid = am.member
WHERE (g.rolname LIKE 'dp\_%' OR m.rolname LIKE 'dp\_%')
  AND NOT (g.rolname = 'dp_owner' AND m.rolname = 'dp_migrator')
  AND NOT (g.rolname = 'dp_lead_retention' AND m.rolname = 'dp_iam_bootstrap')
\gexec
GRANT dp_owner TO dp_migrator WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT dp_lead_retention TO dp_iam_bootstrap WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
-- Every migrator session starts as dp_owner, so objects created by migrations are owned by
-- dp_owner and `current_user` is dp_owner while migrations run.
ALTER ROLE dp_migrator SET role = 'dp_owner';
ALTER ROLE dp_app RESET ALL;
ALTER ROLE dp_iam_bootstrap RESET ALL;

-- 3. This database: only the dp_* login roles (and superusers) may connect; no TEMP for PUBLIC.
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO dp_app, dp_migrator, dp_iam_bootstrap',
              current_database()) \gexec
SELECT format('REVOKE TEMPORARY, CREATE ON DATABASE %I FROM dp_app, dp_migrator, dp_iam_bootstrap',
              current_database()) \gexec
-- dp_owner (DDL only, reached by the migrator through SET ROLE) may create schemas. The first
-- migration runs `CREATE SCHEMA IF NOT EXISTS "public"`, and PostgreSQL checks this privilege
-- before it checks whether the schema exists. Applied migrations are immutable (ADR-010).
SELECT format('GRANT CREATE ON DATABASE %I TO dp_owner', current_database()) \gexec

-- 4. Schema public: owned by dp_owner; nobody else may create in it.
ALTER SCHEMA public OWNER TO dp_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- 5. Ownership of every existing object in public (empty on a new database). Tables first: that
--    also moves sequences owned by their columns.
SELECT format('ALTER TABLE public.%I OWNER TO dp_owner', c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'f')
  AND c.relowner <> 'dp_owner'::regrole
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
ORDER BY c.relname
\gexec
SELECT format('ALTER %s public.%I OWNER TO dp_owner',
              CASE c.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' ELSE 'MATERIALIZED VIEW' END,
              c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('S', 'v', 'm')
  AND c.relowner <> 'dp_owner'::regrole
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
ORDER BY c.relname
\gexec
SELECT format('ALTER ROUTINE %s OWNER TO dp_owner', p.oid::regprocedure)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proowner <> 'dp_owner'::regrole
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
ORDER BY 1
\gexec
SELECT format('ALTER TYPE public.%I OWNER TO dp_owner', t.typname)
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd', 'c') AND t.typowner <> 'dp_owner'::regrole
  AND (t.typtype <> 'c' OR EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c'))
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
ORDER BY t.typname
\gexec

COMMIT;

\echo 'dp-roles: roles, memberships, database privileges and ownership are in place'
