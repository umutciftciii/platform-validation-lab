-- F1-001A: the last platform administrator is protected (ADR-011 section 5).
-- Triggers only: no table, column or data changes, so the Prisma schema and the drift check are
-- unaffected. Additive and reversible by a later migration that drops the triggers.
--
-- A platform administrator is a user whose status is ACTIVE or PENDING (bootstrap, not yet
-- enrolled) and who has a platform_super_admin assignment that is not revoked and not expired.
-- Refused:
--   * revoking, expiring, deleting or re-pointing the last such assignment;
--   * suspending or deactivating the last such user.
-- A transaction-scoped advisory lock serialises these checks, so two concurrent removals cannot
-- both see "another administrator remains". Expiry by the passage of time cannot be blocked by a
-- trigger; recovery is the one-time bootstrap, which works again once no active administrator
-- exists (ADR-011).

-- pg_advisory_xact_lock key "IAMLAST" in ASCII.
CREATE FUNCTION iam_platform_admins_remaining(exclude_assignment uuid, exclude_user uuid)
RETURNS bigint LANGUAGE sql STABLE AS $fn$
  SELECT count(*)
  FROM "RoleAssignment" ra
  JOIN "Role" r ON r."id" = ra."roleId"
  JOIN "User" u ON u."id" = ra."userId"
  WHERE r."key" = 'platform_super_admin'
    AND ra."scopeType" = 'PLATFORM'
    AND ra."revokedAt" IS NULL
    AND (ra."expiresAt" IS NULL OR ra."expiresAt" > now())
    AND u."status" IN ('ACTIVE', 'PENDING')
    AND ra."id" IS DISTINCT FROM exclude_assignment
    AND u."id" IS DISTINCT FROM exclude_user
$fn$;

CREATE FUNCTION iam_is_active_platform_admin_assignment(a "RoleAssignment") RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT a."scopeType" = 'PLATFORM'
    AND a."revokedAt" IS NULL
    AND (a."expiresAt" IS NULL OR a."expiresAt" > now())
    AND EXISTS (SELECT 1 FROM "Role" r WHERE r."id" = a."roleId" AND r."key" = 'platform_super_admin')
    AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = a."userId" AND u."status" IN ('ACTIVE', 'PENDING'))
$fn$;

CREATE FUNCTION iam_last_platform_admin_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF iam_is_active_platform_admin_assignment(OLD)
     AND (TG_OP = 'DELETE' OR NOT iam_is_active_platform_admin_assignment(NEW)) THEN
    PERFORM pg_advisory_xact_lock(20619473547514708);
    IF iam_platform_admins_remaining(OLD."id", NULL) = 0 THEN
      RAISE EXCEPTION 'iam: the last active platform administrator cannot be removed'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "RoleAssignment_last_platform_admin" BEFORE UPDATE OR DELETE ON "RoleAssignment"
  FOR EACH ROW EXECUTE FUNCTION iam_last_platform_admin_assignment_guard();

CREATE FUNCTION iam_last_platform_admin_user_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD."status" IN ('ACTIVE', 'PENDING') AND NEW."status" NOT IN ('ACTIVE', 'PENDING')
     AND EXISTS (
       SELECT 1 FROM "RoleAssignment" ra
       WHERE ra."userId" = OLD."id" AND iam_is_active_platform_admin_assignment(ra)) THEN
    PERFORM pg_advisory_xact_lock(20619473547514708);
    IF iam_platform_admins_remaining(NULL, OLD."id") = 0 THEN
      RAISE EXCEPTION 'iam: the last active platform administrator cannot be suspended or deactivated'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "User_last_platform_admin" BEFORE UPDATE OF "status" ON "User"
  FOR EACH ROW EXECUTE FUNCTION iam_last_platform_admin_user_guard();
