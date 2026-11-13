-- DP-125 (ADR-012B part 2): row-level security on the IAM site tables.
--
-- Runs as dp_owner (ADR-012A). Additive: no table, column or row changes. Row-level security goes
-- on "Membership", "RoleAssignment", "ModuleConfiguration", "AuditEvent" and
-- "CustomerDataAccessRequest", with explicit policies per role (deny by default).
--
-- These tables feed the authorization decision itself, so a plain site setting is not enough
-- (ADR-012B part 2). The pattern of DP-103 is reused:
--   * the context is the RAW admin session token, set transaction-locally by
--     leads_rls_set_staff_context() (one setter for lead and IAM data, one round trip); the
--     database finds the session's user itself (leads_rls_staff_user_id());
--   * narrow SECURITY DEFINER functions (owner dp_owner, pinned search_path, no EXECUTE for
--     PUBLIC) answer with ids, counts or booleans only;
--   * a missing, stale or forged context opens nothing (fail closed);
--   * no BYPASSRLS, no FORCE (dp_owner is NOLOGIN, ADR-012B B5).
--
-- Who sees what (dp_app):
--   Membership, RoleAssignment   the session user's own rows; rows on the sites where the user
--                                holds an IAM administration permission (iam_read); platform-wide
--                                assignments of staff who work on such a site, or all of them for a
--                                platform-wide IAM administrator; the system owner sees all.
--                                Writes: sites (or the platform) of an IAM write permission.
--   ModuleConfiguration          the sites the user can reach (ACTIVE membership; every site for a
--                                platform role or the owner). Writes: the system owner only (K4).
--   AuditEvent                   STANDARD events of the sites of audit:read; PROTECTED events to the
--                                owner only. INSERT is controlled (K2, interim): see part 5.
--   CustomerDataAccessRequest    read-only history for IAM administrators of the site and the owner;
--                                no write (the sweep runs in iam_customer_data_sweep(), K3).
-- dp_iam_bootstrap reads and inserts role assignments (bootstrap) and inserts BOOTSTRAP audit
-- events; dp_lead_retention inserts BOOTSTRAP lead audit events. dp_owner is not subject to RLS.
--
-- Rollback: NOT part of the migration chain. docs/security/runbooks/DP-125-rls-emergency-disable.md
-- holds the forward-fix that switches RLS off on these five tables; it needs a separate owner
-- approval and is never applied automatically (ADR-010).
-- Tested in test/integration/owner.int.test.ts (DP-125 block), db-roles.int.test.ts and every
-- end-to-end suite (login, MFA, /enrol, recover-admin, staff, leads, owner console).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_iam_bootstrap')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_lead_retention') THEN
    RAISE EXCEPTION 'DP-125: database roles missing; run infra/docker/stack.sh db-roles <dev|prod> --yes first (dp-roles.sql)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'leads_rls_staff_user_id') THEN
    RAISE EXCEPTION 'DP-125: migration 20261124090000_dp_041_lead_sales_workflow must be applied first';
  END IF;
END $$;

-- =============================================================================================
-- Part 1: what the session's user may see and change (ids and booleans only)
-- =============================================================================================

-- The permission families of the policies. iam_read: any IAM administration permission (the staff
-- screen, role and user administration); iam_write: those that write memberships or role
-- assignments; audit_read: audit:read. Internal: called only by the functions below.
CREATE FUNCTION iam_rls_permission_set(kind text) RETURNS text[] LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT CASE kind
    WHEN 'iam_read' THEN ARRAY['user:read', 'user:invite', 'user:suspend', 'user:reactivate',
      'user:deactivate', 'user:unlock', 'session:revoke', 'mfa:reset', 'role_assignment:read',
      'role_assignment:grant', 'role_assignment:revoke', 'publisher_role:grant']
    WHEN 'iam_write' THEN ARRAY['user:invite', 'user:suspend', 'user:reactivate', 'user:deactivate',
      'role_assignment:grant', 'role_assignment:revoke', 'publisher_role:grant']
    WHEN 'audit_read' THEN ARRAY['audit:read']
    ELSE '{}'::text[]
  END
$fn$;

-- The sites where an ACTIVE staff user holds a permission of the family (as decide() does for
-- these core permissions: a platform role covers every site, a site role needs an ACTIVE
-- membership there; the system owner holds everything, explicitly). Family 'reach': the sites
-- the user works on at all (any platform role or the owner: every site). Internal.
CREATE FUNCTION iam_rls_user_sites(uid uuid, kind text) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  perms text[];
BEGIN
  IF uid IS NULL OR kind IS NULL THEN
    RETURN '{}'::uuid[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "User" u
                 WHERE u."id" = uid AND u."status" = 'ACTIVE' AND u."kind" = 'STAFF') THEN
    RETURN '{}'::uuid[];
  END IF;
  IF EXISTS (SELECT 1 FROM "SystemOwner" o WHERE o."userId" = uid) THEN
    RETURN ARRAY(SELECT st."id" FROM "Site" st ORDER BY st."id");
  END IF;
  IF kind = 'reach' THEN
    IF EXISTS (SELECT 1 FROM "RoleAssignment" ra JOIN "Role" r ON r."id" = ra."roleId"
               WHERE ra."userId" = uid AND ra."scopeType" = 'PLATFORM' AND ra."siteId" IS NULL
                 AND ra."revokedAt" IS NULL AND (ra."expiresAt" IS NULL OR ra."expiresAt" > now())
                 AND r."audience" = 'STAFF' AND r."scopeType" = 'PLATFORM'
                 AND r."key" <> 'system_owner') THEN
      RETURN ARRAY(SELECT st."id" FROM "Site" st ORDER BY st."id");
    END IF;
    RETURN ARRAY(SELECT m."siteId" FROM "Membership" m
                 WHERE m."userId" = uid AND m."status" = 'ACTIVE' ORDER BY m."siteId");
  END IF;
  perms := public.iam_rls_permission_set(kind);
  IF cardinality(perms) = 0 THEN
    RETURN '{}'::uuid[];
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
        AND p."key" = ANY (perms) AND p."audience" = 'STAFF'
        AND r."audience" = 'STAFF' AND r."scopeType" = ra."scopeType" AND r."key" <> 'system_owner'
        AND ((ra."scopeType" = 'PLATFORM' AND ra."siteId" IS NULL)
             OR (ra."scopeType" = 'SITE' AND ra."siteId" = st."id"
                 AND EXISTS (SELECT 1 FROM "Membership" m
                             WHERE m."userId" = uid AND m."siteId" = st."id"
                               AND m."status" = 'ACTIVE'))))
    ORDER BY st."id");
END
$fn$;

-- Whether the user holds a permission of the family platform-wide (a PLATFORM role, or the
-- owner). Internal.
CREATE FUNCTION iam_rls_user_platform(uid uuid, kind text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  perms text[] := public.iam_rls_permission_set(kind);
BEGIN
  IF uid IS NULL OR cardinality(perms) = 0 THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "User" u
                 WHERE u."id" = uid AND u."status" = 'ACTIVE' AND u."kind" = 'STAFF') THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM "SystemOwner" o WHERE o."userId" = uid) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM "RoleAssignment" ra
    JOIN "Role" r ON r."id" = ra."roleId"
    JOIN "RolePermission" rp ON rp."roleId" = r."id"
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE ra."userId" = uid AND ra."scopeType" = 'PLATFORM' AND ra."siteId" IS NULL
      AND ra."revokedAt" IS NULL AND (ra."expiresAt" IS NULL OR ra."expiresAt" > now())
      AND p."key" = ANY (perms) AND p."audience" = 'STAFF'
      AND r."audience" = 'STAFF' AND r."scopeType" = 'PLATFORM' AND r."key" <> 'system_owner');
END
$fn$;

-- Session-bound readers for the policies: only about the user behind the presented session.
CREATE FUNCTION iam_rls_staff_sites(kind text) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT public.iam_rls_user_sites(public.leads_rls_staff_user_id(), kind)
$fn$;

CREATE FUNCTION iam_rls_staff_platform(kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT COALESCE(public.iam_rls_user_platform(public.leads_rls_staff_user_id(), kind), false)
$fn$;

CREATE FUNCTION iam_rls_staff_is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT EXISTS (SELECT 1 FROM "SystemOwner" o
                 WHERE o."userId" = public.leads_rls_staff_user_id())
$fn$;

-- =============================================================================================
-- Part 2: the guards keep their full view (B1)
-- =============================================================================================
-- These trigger functions count or walk role assignments across users and sites (and one
-- deferred constraint trigger looks one up). As SECURITY
-- INVOKER under RLS they would see only the caller's rows: the reciprocal-grant guard could miss
-- an ancestor (privilege escalation) and the last-administrator guards would miscount. They become
-- SECURITY DEFINER with a pinned search_path; their logic is unchanged. A trigger function cannot
-- be called directly, so this opens no new read path. iam_null_grantor_guard stays INVOKER: it
-- tests current_user (only dp_iam_bootstrap may write a grantor-less row) and counts only for that
-- role, which reads every assignment (part 4).
ALTER FUNCTION iam_last_platform_admin_assignment_guard() SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION iam_last_platform_admin_user_guard() SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION iam_last_platform_admin_expiry_guard() SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION iam_reciprocal_grant_guard() SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp;
-- The deferred check that an approved legacy access request still has its role assignment runs at
-- COMMIT, as the session's role (dp_app), outside any SECURITY DEFINER caller: under RLS it would
-- not see the assignment and refuse every legacy sweep (DP-077). Same treatment.
ALTER FUNCTION iam_customer_data_approval_has_assignment() SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp;

-- =============================================================================================
-- Part 3: narrow functions for the flows that need more than the caller's rows
-- =============================================================================================

-- Platform administrators other than `exclude_user` (ACTIVE or PENDING, active assignment;
-- non-expiring only on request): input of canRevokeRole. Answered only to a platform-wide IAM
-- administrator, else NULL (the API treats an unknown count as zero: deny).
CREATE FUNCTION iam_rls_platform_admin_count(exclude_user uuid, non_expiring_only boolean)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT CASE WHEN public.iam_rls_staff_platform('iam_read') THEN (
    SELECT count(DISTINCT ra."userId")
    FROM "RoleAssignment" ra
    JOIN "Role" r ON r."id" = ra."roleId"
    JOIN "User" u ON u."id" = ra."userId"
    WHERE r."key" = 'platform_super_admin' AND ra."scopeType" = 'PLATFORM'
      AND ra."revokedAt" IS NULL
      AND (ra."expiresAt" IS NULL OR (NOT COALESCE(non_expiring_only, false) AND ra."expiresAt" > now()))
      AND u."status" IN ('ACTIVE', 'PENDING')
      AND ra."userId" IS DISTINCT FROM exclude_user)
  END
$fn$;

-- Qualified platform administrators (ACTIVE, MFA-enrolled, non-expiring) outside `exclude_users`:
-- input of canActOnUser (last administrator). Platform-wide IAM administrators only, else NULL.
CREATE FUNCTION iam_rls_qualified_admin_count(exclude_users uuid[]) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT CASE WHEN public.iam_rls_staff_platform('iam_read') THEN (
    SELECT count(DISTINCT ra."userId")
    FROM "RoleAssignment" ra
    JOIN "Role" r ON r."id" = ra."roleId"
    JOIN "User" u ON u."id" = ra."userId"
    WHERE r."key" = 'platform_super_admin' AND ra."scopeType" = 'PLATFORM'
      AND ra."revokedAt" IS NULL AND ra."expiresAt" IS NULL
      AND u."status" = 'ACTIVE' AND u."kind" = 'STAFF' AND u."mfaEnrolledAt" IS NOT NULL
      AND NOT (ra."userId" = ANY (COALESCE(exclude_users, '{}'::uuid[]))))
  END
$fn$;

-- Everyone who granted the session user's active roles, directly or through a chain (F1-001B):
-- the session's own ancestry only.
CREATE FUNCTION iam_rls_my_grant_ancestry() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT COALESCE(ARRAY(SELECT DISTINCT a.ancestor
                        FROM public.iam_grant_ancestry(public.leads_rls_staff_user_id()) a
                        WHERE a.ancestor IS NOT NULL ORDER BY 1), '{}'::uuid[])
$fn$;

-- The target of a user-administration action as canActOnUser needs it: every open role
-- assignment (with its role key) and every membership that is not REVOKED. The superiority rule
-- must see roles on other sites too, or a site administrator could act on someone who is their
-- superior elsewhere. Answered only when the target works on a site where the session user holds
-- an IAM permission (or to a platform-wide IAM administrator); otherwise no row, and the API
-- answers 404 as for any target out of scope.
CREATE FUNCTION iam_rls_admin_target(target uuid)
RETURNS TABLE (row_kind text, role_key text, scope_type "ScopeType", site_id uuid,
               expires_at timestamptz, revoked_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  sites uuid[] := public.iam_rls_staff_sites('iam_read');
BEGIN
  IF target IS NULL OR public.leads_rls_staff_user_id() IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.iam_rls_staff_platform('iam_read')
     AND NOT EXISTS (SELECT 1 FROM "Membership" m
                     WHERE m."userId" = target AND m."status" <> 'REVOKED'
                       AND m."siteId" = ANY (sites))
     AND NOT EXISTS (SELECT 1 FROM "RoleAssignment" ra
                     WHERE ra."userId" = target AND ra."revokedAt" IS NULL
                       AND ra."siteId" = ANY (sites)) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT 'grant'::text, r."key"::text, ra."scopeType", ra."siteId", ra."expiresAt", ra."revokedAt"
    FROM "RoleAssignment" ra JOIN "Role" r ON r."id" = ra."roleId"
    WHERE ra."userId" = target AND ra."revokedAt" IS NULL
    UNION ALL
    SELECT 'membership'::text, NULL::text, 'SITE'::"ScopeType", m."siteId", NULL::timestamptz,
           NULL::timestamptz
    FROM "Membership" m
    WHERE m."userId" = target AND m."status" <> 'REVOKED';
END
$fn$;

-- After a bulk change of a user's rows (deactivation), the rows still open: open role assignments
-- and memberships that are not REVOKED. A hidden row left behind makes the API abort the
-- transaction instead of a silent partial update (condition 4). Platform-wide IAM writers only,
-- else NULL.
CREATE FUNCTION iam_rls_user_open_rows(target uuid)
RETURNS TABLE (open_roles bigint, open_memberships bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT
    CASE WHEN public.iam_rls_staff_platform('iam_write') THEN
      (SELECT count(*) FROM "RoleAssignment" ra WHERE ra."userId" = target AND ra."revokedAt" IS NULL)
    END,
    CASE WHEN public.iam_rls_staff_platform('iam_write') THEN
      (SELECT count(*) FROM "Membership" m WHERE m."userId" = target AND m."status" <> 'REVOKED')
    END
$fn$;

-- Operator CLI (iam-cli enrol-link, reset-link, recover-admin; dp_app, no session, K1): the
-- platform-administrator state of one staff account, booleans and one count. Refused inside a
-- staff context: the admin API has its own, session-bound functions.
CREATE FUNCTION iam_operator_admin_state(target uuid)
RETURNS TABLE (bootstrap_grant boolean, active_admin boolean, other_qualified_admins bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  IF target IS NULL OR public.leads_rls_staff_user_id() IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = target AND u."kind" = 'STAFF') THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT
    EXISTS (SELECT 1 FROM "RoleAssignment" ra JOIN "Role" r ON r."id" = ra."roleId"
            WHERE ra."userId" = target AND ra."revokedAt" IS NULL AND ra."grantedById" IS NULL
              AND r."key" = 'platform_super_admin' AND ra."scopeType" = 'PLATFORM'),
    EXISTS (SELECT 1 FROM "RoleAssignment" ra JOIN "Role" r ON r."id" = ra."roleId"
            WHERE ra."userId" = target AND ra."revokedAt" IS NULL
              AND (ra."expiresAt" IS NULL OR ra."expiresAt" > now())
              AND r."key" = 'platform_super_admin' AND ra."scopeType" = 'PLATFORM'),
    (SELECT count(DISTINCT ra."userId")
     FROM "RoleAssignment" ra
     JOIN "Role" r ON r."id" = ra."roleId"
     JOIN "User" u ON u."id" = ra."userId"
     WHERE r."key" = 'platform_super_admin' AND ra."scopeType" = 'PLATFORM'
       AND ra."revokedAt" IS NULL AND ra."expiresAt" IS NULL
       AND u."status" = 'ACTIVE' AND u."kind" = 'STAFF' AND u."mfaEnrolledAt" IS NOT NULL
       AND ra."userId" <> target);
END
$fn$;

-- /enrol, MFA re-enrolment (B4): whether the password step of THIS live link was verified. Proof
-- of possession: the raw token (hashed here); answers only about that link.
CREATE FUNCTION iam_enrol_password_verified(raw_token text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  token_id uuid;
BEGIN
  IF raw_token IS NULL OR raw_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN false;
  END IF;
  SELECT t."id" INTO token_id
  FROM "UserCredentialToken" t JOIN "User" u ON u."id" = t."userId"
  WHERE t."tokenHash" = encode(sha256(convert_to(raw_token, 'UTF8')), 'hex')
    AND t."purpose" = 'MFA_REENROLMENT' AND t."app" = 'ADMIN'
    AND t."consumedAt" IS NULL AND t."invalidatedAt" IS NULL AND t."expiresAt" > now()
    AND t."securityVersion" = u."securityVersion" AND u."kind" = 'STAFF';
  IF token_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM "AuditEvent" e
                 WHERE e."action" = 'iam.enrol_password_verified'
                   AND e."resourceType" = 'credential_token' AND e."resourceId" = token_id::text
                   AND e."outcome" = 'SUCCESS');
END
$fn$;

-- /enrol completion (B4, condition 4): activates the INVITED memberships of the link's user, once
-- the link was consumed in THIS transaction and the account is now ACTIVE with MFA. Returns how
-- many were activated. Proof of possession: the raw token.
CREATE FUNCTION iam_enrol_activate_memberships(raw_token text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  uid uuid;
  n integer;
BEGIN
  IF raw_token IS NULL OR raw_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'iam: enrolment link required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT t."userId" INTO uid
  FROM "UserCredentialToken" t JOIN "User" u ON u."id" = t."userId"
  WHERE t."tokenHash" = encode(sha256(convert_to(raw_token, 'UTF8')), 'hex')
    AND t."purpose" IN ('ADMIN_ENROLMENT', 'STAFF_INVITE', 'MFA_REENROLMENT', 'ADMIN_RECOVERY')
    AND t."app" = 'ADMIN' AND t."consumedAt" IS NOT NULL AND t."invalidatedAt" IS NULL
    -- consumed by THIS transaction: the row version's xmin is our own (32-bit) transaction id
    AND t."xmin"::text::bigint = (pg_current_xact_id()::text::bigint % 4294967296)
    AND u."kind" = 'STAFF' AND u."status" = 'ACTIVE' AND u."mfaEnrolledAt" IS NOT NULL;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'iam: the enrolment link was not completed in this transaction'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE "Membership" SET "status" = 'ACTIVE', "updatedAt" = now()
  WHERE "userId" = uid AND "status" = 'INVITED';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

-- DP-041 lead assignment (B8): staff who may be assigned the leads of the given sites (lead:manage
-- there), for the sites whose leads the session user reads. Ids only; names come from "User".
CREATE FUNCTION leads_rls_assignable_staff(site_ids uuid[])
RETURNS TABLE (site_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  WITH readable AS (
    SELECT s AS site_id
    FROM unnest(COALESCE(site_ids, '{}'::uuid[])) s
    WHERE s = ANY (public.leads_rls_staff_site_ids())
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
  WHERE r.site_id = ANY (public.leads_rls_user_lead_sites(c.user_id, 'lead:manage'))
  ORDER BY 1, 2
$fn$;

-- DP-077 legacy sweep (K3): the two record-keeping steps of runCustomerDataAccessSweep, row by row,
-- with their audit events. The time never runs ahead of the database clock. Counts only.
CREATE FUNCTION iam_customer_data_sweep(at_time timestamptz)
RETURNS TABLE (requests_expired integer, access_expired integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  t timestamptz := LEAST(COALESCE(at_time, now()), now());
  r record;
  revoked_before boolean;
  n_req integer := 0;
  n_acc integer := 0;
BEGIN
  FOR r IN
    SELECT q."id", q."siteId", q."userId", ro."key" AS role_key
    FROM "CustomerDataAccessRequest" q JOIN "Role" ro ON ro."id" = q."roleId"
    WHERE q."status" = 'PENDING' AND q."decideBy" <= t
    ORDER BY q."id" LIMIT 200
  LOOP
    BEGIN
      UPDATE "CustomerDataAccessRequest" SET "status" = 'EXPIRED', "decidedAt" = t
      WHERE "id" = r."id" AND "status" = 'PENDING' AND "decideBy" <= t;
      IF FOUND THEN
        INSERT INTO "AuditEvent" ("id", "actorType", "action", "resourceType", "resourceId",
                                  "scopeType", "siteId", "outcome", "metadata")
        VALUES (iam_uuid_v7(), 'SYSTEM', 'iam.customer_data_access_request_expired',
                'customer_data_access_request', r."id"::text,
                CASE WHEN r."siteId" IS NULL THEN 'PLATFORM'::"ScopeType" ELSE 'SITE'::"ScopeType" END,
                r."siteId", 'SUCCESS',
                jsonb_build_object('roleKey', r.role_key, 'assigneeUserId', r."userId"));
        n_req := n_req + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- one refused row (as before: e.g. the read-only guard) skips only that row
    END;
  END LOOP;
  FOR r IN
    SELECT q."id", q."siteId", q."userId", q."assignmentId", q."accessExpiresAt", ro."key" AS role_key
    FROM "CustomerDataAccessRequest" q JOIN "Role" ro ON ro."id" = q."roleId"
    WHERE q."status" = 'APPROVED' AND q."expiryRecordedAt" IS NULL AND q."accessExpiresAt" <= t
    ORDER BY q."id" LIMIT 200
  LOOP
    BEGIN
      SELECT ra."revokedAt" IS NOT NULL AND r."accessExpiresAt" IS NOT NULL
             AND ra."revokedAt" < r."accessExpiresAt"
        INTO revoked_before
      FROM "RoleAssignment" ra WHERE ra."id" = r."assignmentId";
      UPDATE "CustomerDataAccessRequest" SET "expiryRecordedAt" = t
      WHERE "id" = r."id" AND "expiryRecordedAt" IS NULL;
      IF FOUND AND NOT COALESCE(revoked_before, false) THEN
        INSERT INTO "AuditEvent" ("id", "actorType", "action", "resourceType", "resourceId",
                                  "scopeType", "siteId", "outcome", "metadata")
        VALUES (iam_uuid_v7(), 'SYSTEM', 'iam.customer_data_access_expired', 'role_assignment',
                r."assignmentId"::text,
                CASE WHEN r."siteId" IS NULL THEN 'PLATFORM'::"ScopeType" ELSE 'SITE'::"ScopeType" END,
                r."siteId", 'SUCCESS',
                jsonb_build_object('roleKey', r.role_key, 'assigneeUserId', r."userId",
                                   'requestId', r."id",
                                   'expiredAt', to_char(r."accessExpiresAt" AT TIME ZONE 'UTC',
                                                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
        n_acc := n_acc + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
  RETURN QUERY SELECT n_req, n_acc;
END
$fn$;

-- EXECUTE: never PUBLIC (condition 1). dp_app gets the session-bound readers and the flow
-- functions; the two internal helpers and the permission families stay with dp_owner.
REVOKE ALL ON FUNCTION iam_rls_permission_set(text), iam_rls_user_sites(uuid, text),
  iam_rls_user_platform(uuid, text), iam_rls_staff_sites(text), iam_rls_staff_platform(text),
  iam_rls_staff_is_owner(), iam_rls_platform_admin_count(uuid, boolean),
  iam_rls_qualified_admin_count(uuid[]), iam_rls_my_grant_ancestry(), iam_rls_admin_target(uuid),
  iam_rls_user_open_rows(uuid), iam_operator_admin_state(uuid), iam_enrol_password_verified(text),
  iam_enrol_activate_memberships(text), leads_rls_assignable_staff(uuid[]),
  iam_customer_data_sweep(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION iam_last_platform_admin_assignment_guard(),
  iam_last_platform_admin_user_guard(), iam_last_platform_admin_expiry_guard(),
  iam_reciprocal_grant_guard(), iam_customer_data_approval_has_assignment() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam_rls_staff_sites(text), iam_rls_staff_platform(text),
  iam_rls_staff_is_owner(), iam_rls_platform_admin_count(uuid, boolean),
  iam_rls_qualified_admin_count(uuid[]), iam_rls_my_grant_ancestry(), iam_rls_admin_target(uuid),
  iam_rls_user_open_rows(uuid), iam_operator_admin_state(uuid), iam_enrol_password_verified(text),
  iam_enrol_activate_memberships(text), leads_rls_assignable_staff(uuid[]),
  iam_customer_data_sweep(timestamptz) TO dp_app;

-- =============================================================================================
-- Part 4: policies
-- =============================================================================================
-- `(SELECT f())` makes each context function an InitPlan: evaluated once per statement.

ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RoleAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ModuleConfiguration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerDataAccessRequest" ENABLE ROW LEVEL SECURITY;

-- Membership ------------------------------------------------------------------------------------
CREATE POLICY membership_staff_read ON "Membership" FOR SELECT TO dp_app
  USING ("userId" = (SELECT leads_rls_staff_user_id())
         OR "siteId" = ANY (COALESCE((SELECT iam_rls_staff_sites('iam_read')), '{}'::uuid[])));
CREATE POLICY membership_staff_insert ON "Membership" FOR INSERT TO dp_app
  WITH CHECK ("siteId" = ANY (COALESCE((SELECT iam_rls_staff_sites('iam_write')), '{}'::uuid[])));
CREATE POLICY membership_staff_update ON "Membership" FOR UPDATE TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT iam_rls_staff_sites('iam_write')), '{}'::uuid[])))
  WITH CHECK ("siteId" = ANY (COALESCE((SELECT iam_rls_staff_sites('iam_write')), '{}'::uuid[])));

-- RoleAssignment --------------------------------------------------------------------------------
-- A platform-wide assignment (no site) is visible to platform-wide IAM administrators, and to a
-- site's IAM administrators when its holder works on that site (the staff screen shows it).
CREATE POLICY role_assignment_staff_read ON "RoleAssignment" FOR SELECT TO dp_app
  USING ("userId" = (SELECT leads_rls_staff_user_id())
         OR ("siteId" IS NOT NULL
             AND "siteId" = ANY (COALESCE((SELECT iam_rls_staff_sites('iam_read')), '{}'::uuid[])))
         OR ("siteId" IS NULL
             AND ((SELECT iam_rls_staff_platform('iam_read'))
                  OR EXISTS (SELECT 1 FROM "Membership" m
                             WHERE m."userId" = "RoleAssignment"."userId"
                               AND m."status" <> 'REVOKED'
                               AND m."siteId" = ANY (COALESCE((SELECT iam_rls_staff_sites('iam_read')),
                                                              '{}'::uuid[]))))));
CREATE POLICY role_assignment_staff_insert ON "RoleAssignment" FOR INSERT TO dp_app
  WITH CHECK (("siteId" IS NOT NULL
               AND "siteId" = ANY (COALESCE((SELECT iam_rls_staff_sites('iam_write')), '{}'::uuid[])))
              OR ("siteId" IS NULL AND (SELECT iam_rls_staff_platform('iam_write'))));
CREATE POLICY role_assignment_staff_update ON "RoleAssignment" FOR UPDATE TO dp_app
  USING (("siteId" IS NOT NULL
          AND "siteId" = ANY (COALESCE((SELECT iam_rls_staff_sites('iam_write')), '{}'::uuid[])))
         OR ("siteId" IS NULL AND (SELECT iam_rls_staff_platform('iam_write'))))
  WITH CHECK (("siteId" IS NOT NULL
               AND "siteId" = ANY (COALESCE((SELECT iam_rls_staff_sites('iam_write')), '{}'::uuid[])))
              OR ("siteId" IS NULL AND (SELECT iam_rls_staff_platform('iam_write'))));
-- The one-time bootstrap (dp_iam_bootstrap: SELECT and INSERT only, ADR-012A); the guard
-- triggers limit what it may write (K-NG1).
CREATE POLICY role_assignment_bootstrap_read ON "RoleAssignment" FOR SELECT TO dp_iam_bootstrap
  USING (true);
CREATE POLICY role_assignment_bootstrap_insert ON "RoleAssignment" FOR INSERT TO dp_iam_bootstrap
  WITH CHECK (true);

-- ModuleConfiguration ---------------------------------------------------------------------------
CREATE POLICY module_configuration_staff_read ON "ModuleConfiguration" FOR SELECT TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT iam_rls_staff_sites('reach')), '{}'::uuid[])));
CREATE POLICY module_configuration_owner_insert ON "ModuleConfiguration" FOR INSERT TO dp_app
  WITH CHECK ((SELECT iam_rls_staff_is_owner()));
CREATE POLICY module_configuration_owner_update ON "ModuleConfiguration" FOR UPDATE TO dp_app
  USING ((SELECT iam_rls_staff_is_owner())) WITH CHECK ((SELECT iam_rls_staff_is_owner()));

-- CustomerDataAccessRequest (read-only history) -------------------------------------------------
CREATE POLICY customer_data_request_staff_read ON "CustomerDataAccessRequest" FOR SELECT TO dp_app
  USING ((SELECT iam_rls_staff_is_owner())
         OR ("siteId" IS NOT NULL
             AND "siteId" = ANY (COALESCE((SELECT iam_rls_staff_sites('iam_read')), '{}'::uuid[])))
         OR ("siteId" IS NULL AND (SELECT iam_rls_staff_platform('iam_read'))));

-- AuditEvent: reading ---------------------------------------------------------------------------
CREATE POLICY audit_event_staff_read ON "AuditEvent" FOR SELECT TO dp_app
  USING (("stream" = 'PROTECTED' AND (SELECT iam_rls_staff_is_owner()))
         OR ("stream" = 'STANDARD'
             AND (("siteId" IS NOT NULL
                   AND "siteId" = ANY (COALESCE((SELECT iam_rls_staff_sites('audit_read')),
                                                '{}'::uuid[])))
                  OR ("siteId" IS NULL AND (SELECT iam_rls_staff_platform('audit_read'))))));

-- =============================================================================================
-- Part 5: controlled audit writes (K2, interim; the actor-bound write path is DP-129)
-- =============================================================================================
-- Every role that writes audit events gets an INSERT policy for exactly its kind of event:
--   dp_app            USER events of a staff user; inside a staff context only as the session's own
--                     user. SYSTEM events without an actor (database triggers, jobs). BOOTSTRAP
--                     events only for the three operator CLI actions and never inside a staff
--                     context. owner.* actions only from the owner's own context, except the
--                     refusals (owner.access_denied, owner.designation_denied) that anyone's
--                     request may cause.
--   dp_iam_bootstrap  BOOTSTRAP events, and SYSTEM db.* events of its own row writes.
--   dp_lead_retention BOOTSTRAP leads.* events.
-- For every role: occurredAt is the database's time (no back- or forward-dating beyond a minute).
-- The stream and the hash chain stay with the SECURITY DEFINER trigger (DP-108); db.* actions
-- stay with the database triggers (K-NG3). What remains open (a USER event outside any context,
-- e.g. a forged login event by a compromised API) is DP-129 / R-25.
CREATE FUNCTION iam_audit_time_ok(occurred timestamptz) RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT occurred IS NOT NULL
    AND occurred >= now() - interval '1 minute'
    AND occurred <= clock_timestamp() + interval '1 minute'
$fn$;
REVOKE ALL ON FUNCTION iam_audit_time_ok(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam_audit_time_ok(timestamptz) TO dp_app, dp_iam_bootstrap,
  dp_lead_retention;

CREATE POLICY audit_event_app_insert ON "AuditEvent" FOR INSERT TO dp_app
  WITH CHECK (
    iam_audit_time_ok("occurredAt")
    AND CASE "actorType"
      WHEN 'USER' THEN "actorUserId" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "actorUserId" AND u."kind" = 'STAFF')
        AND ((SELECT leads_rls_staff_user_id()) IS NULL
             OR "actorUserId" = (SELECT leads_rls_staff_user_id()))
      WHEN 'SYSTEM' THEN "actorUserId" IS NULL
      WHEN 'BOOTSTRAP' THEN "actorUserId" IS NULL
        AND (SELECT leads_rls_staff_user_id()) IS NULL
        AND "action" IN ('iam.enrol_link_issued', 'iam.password_reset_issued',
                         'iam.admin_recovery_issued')
      ELSE false
    END
    AND ("action" NOT LIKE 'owner.%'
         OR "action" IN ('owner.access_denied', 'owner.designation_denied')
         OR ("actorType" = 'USER' AND (SELECT iam_rls_staff_is_owner()))));

CREATE POLICY audit_event_bootstrap_insert ON "AuditEvent" FOR INSERT TO dp_iam_bootstrap
  WITH CHECK (iam_audit_time_ok("occurredAt") AND "actorUserId" IS NULL
              AND ("actorType" = 'BOOTSTRAP'
                   OR ("actorType" = 'SYSTEM' AND "action" LIKE 'db.%')));

CREATE POLICY audit_event_retention_insert ON "AuditEvent" FOR INSERT TO dp_lead_retention
  WITH CHECK (iam_audit_time_ok("occurredAt") AND "actorUserId" IS NULL
              AND "actorType" = 'BOOTSTRAP' AND "action" LIKE 'leads.%');
