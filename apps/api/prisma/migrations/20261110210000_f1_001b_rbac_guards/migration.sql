-- F1-001B: final RBAC guards (ADR-011 sections 3a and 5). Triggers and functions only: no table,
-- column or data change, so the Prisma schema and the drift check are unaffected. The earlier
-- migrations are not edited.
--
-- 1. Customer-data roles (any role with a lead, membership or crm permission) need a dual-approved,
--    justified, time-limited assignment (DP-076, DP-077). That workflow does not exist yet, so new
--    assignments of such roles are refused, and existing ones can be shortened or revoked but never
--    extended. The resource list must match the catalogue's customerData permissions; a unit test
--    compares them. DP-076 replaces this function when the workflow lands.
-- 2. No reciprocal or indirect self-grant: a role cannot be granted to anyone who, directly or
--    through a chain of active grants, granted the grantor's own roles.
-- 3. The last active platform administrator's assignment cannot get an expiry: setting expiresAt
--    on a platform_super_admin assignment needs another active administrator without expiry.

CREATE FUNCTION iam_customer_data_resources() RETURNS text[] LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ARRAY['crm', 'lead', 'membership']
$fn$;

CREATE FUNCTION iam_is_customer_data_role(role_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM "RolePermission" rp
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE rp."roleId" = role_id AND p."resource" = ANY (iam_customer_data_resources()))
$fn$;

CREATE FUNCTION iam_customer_data_role_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT iam_is_customer_data_role(NEW."roleId") THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'iam: customer-data roles need a dual-approved, time-limited assignment (DP-076); not available yet'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     AND (NEW."expiresAt" IS NULL OR (OLD."expiresAt" IS NOT NULL AND NEW."expiresAt" > OLD."expiresAt")) THEN
    RAISE EXCEPTION 'iam: customer-data access cannot be extended without dual approval (DP-077)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "RoleAssignment_customer_data_guard" BEFORE INSERT OR UPDATE ON "RoleAssignment"
  FOR EACH ROW EXECUTE FUNCTION iam_customer_data_role_guard();

CREATE FUNCTION iam_grant_ancestry(user_id uuid) RETURNS TABLE (ancestor uuid)
LANGUAGE sql STABLE AS $fn$
  WITH RECURSIVE chain(id) AS (
    SELECT ra."grantedById" FROM "RoleAssignment" ra
    WHERE ra."userId" = user_id AND ra."grantedById" IS NOT NULL AND ra."revokedAt" IS NULL
      AND (ra."expiresAt" IS NULL OR ra."expiresAt" > now())
    UNION
    SELECT ra."grantedById" FROM "RoleAssignment" ra JOIN chain c ON ra."userId" = c.id
    WHERE ra."grantedById" IS NOT NULL AND ra."revokedAt" IS NULL
      AND (ra."expiresAt" IS NULL OR ra."expiresAt" > now())
  )
  SELECT id FROM chain
$fn$;

CREATE FUNCTION iam_reciprocal_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW."grantedById" IS NOT NULL
     AND EXISTS (SELECT 1 FROM iam_grant_ancestry(NEW."grantedById") a WHERE a.ancestor = NEW."userId") THEN
    RAISE EXCEPTION 'iam: reciprocal or indirect self-grant refused'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "RoleAssignment_reciprocal_guard" BEFORE INSERT ON "RoleAssignment"
  FOR EACH ROW EXECUTE FUNCTION iam_reciprocal_grant_guard();

CREATE FUNCTION iam_last_platform_admin_expiry_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW."expiresAt" IS NOT NULL AND NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     AND iam_is_active_platform_admin_assignment(OLD) THEN
    PERFORM pg_advisory_xact_lock(20619473547514708);
    IF NOT EXISTS (
      SELECT 1 FROM "RoleAssignment" ra
      JOIN "Role" r ON r."id" = ra."roleId"
      JOIN "User" u ON u."id" = ra."userId"
      WHERE r."key" = 'platform_super_admin' AND ra."scopeType" = 'PLATFORM'
        AND ra."revokedAt" IS NULL AND ra."expiresAt" IS NULL
        AND u."status" IN ('ACTIVE', 'PENDING') AND ra."id" <> OLD."id") THEN
      RAISE EXCEPTION 'iam: the last active platform administrator cannot get an expiry'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "RoleAssignment_last_platform_admin_expiry" BEFORE UPDATE OF "expiresAt" ON "RoleAssignment"
  FOR EACH ROW EXECUTE FUNCTION iam_last_platform_admin_expiry_guard();
