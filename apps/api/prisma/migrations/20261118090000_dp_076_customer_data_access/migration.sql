-- DP-076/DP-077 (ADR-017): dual-approved, time-limited customer-data access.
--
-- A customer-data role (any role with a lead, membership or crm permission; ADR-011 3a) is
-- assigned only through an APPROVED "CustomerDataAccessRequest": a holder of
-- customer_data_access:grant requests it with a justification and a duration, a different holder
-- approves it, and the assignee is a third person. The approval and the RoleAssignment are written
-- in one transaction; the assignment always expires (at most iam_customer_data_max_days) and is
-- never extended in place: an extension is a new request that, once approved, replaces it.
--
-- Runs as dp_owner (ADR-012A). Additive: one enum, one table, CHECK constraints, guard triggers and
-- privilege exceptions; it replaces the F1-001B function iam_customer_data_role_guard() (which so
-- far refused every customer-data assignment). No existing row changes. Tested in
-- test/integration/leads.int.test.ts ("customer-data access").
--
-- Part 1 follows `prisma migrate diff --from-schema <main> --to-schema schema.prisma`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_app') THEN
    RAISE EXCEPTION 'DP-076: database role dp_app missing; ADR-012A must be applied first';
  END IF;
END $$;

-- ===========================================================================================
-- Part 1: enum, table and indexes (generated)
-- ===========================================================================================

-- CreateEnum
CREATE TYPE "CustomerDataRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "CustomerDataAccessRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "siteId" UUID,
    "justification" VARCHAR(1000) NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "extendsAssignmentId" UUID,
    "status" "CustomerDataRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decideBy" TIMESTAMPTZ(3) NOT NULL,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" VARCHAR(1000),
    "assignmentId" UUID,
    "accessExpiresAt" TIMESTAMPTZ(3),
    "expiryRecordedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CustomerDataAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDataAccessRequest_assignmentId_key" ON "CustomerDataAccessRequest"("assignmentId");

-- CreateIndex
CREATE INDEX "CustomerDataAccessRequest_status_decideBy_idx" ON "CustomerDataAccessRequest"("status", "decideBy");

-- CreateIndex
CREATE INDEX "CustomerDataAccessRequest_userId_idx" ON "CustomerDataAccessRequest"("userId");

-- CreateIndex
CREATE INDEX "CustomerDataAccessRequest_accessExpiresAt_idx" ON "CustomerDataAccessRequest"("accessExpiresAt");

-- AddForeignKey
ALTER TABLE "CustomerDataAccessRequest" ADD CONSTRAINT "CustomerDataAccessRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDataAccessRequest" ADD CONSTRAINT "CustomerDataAccessRequest_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDataAccessRequest" ADD CONSTRAINT "CustomerDataAccessRequest_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDataAccessRequest" ADD CONSTRAINT "CustomerDataAccessRequest_extendsAssignmentId_fkey" FOREIGN KEY ("extendsAssignmentId") REFERENCES "RoleAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDataAccessRequest" ADD CONSTRAINT "CustomerDataAccessRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDataAccessRequest" ADD CONSTRAINT "CustomerDataAccessRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================================
-- Part 2: constraints
-- ===========================================================================================

ALTER TABLE "CustomerDataAccessRequest"
  ADD CONSTRAINT "CustomerDataAccessRequest_scope_site"
    CHECK (("scopeType" = 'SITE') = ("siteId" IS NOT NULL)),
  ADD CONSTRAINT "CustomerDataAccessRequest_duration" CHECK ("durationDays" BETWEEN 1 AND 90),
  ADD CONSTRAINT "CustomerDataAccessRequest_justification"
    CHECK (char_length(btrim("justification")) >= 20),
  ADD CONSTRAINT "CustomerDataAccessRequest_not_self_requested" CHECK ("requestedById" <> "userId"),
  ADD CONSTRAINT "CustomerDataAccessRequest_decide_by" CHECK ("decideBy" > "requestedAt"),
  -- Three different people: the decider is never the assignee; approver/rejecter is not the
  -- requester; only the requester cancels; nobody decides an expired request.
  ADD CONSTRAINT "CustomerDataAccessRequest_decider" CHECK (
    ("status" = 'PENDING' AND "decidedById" IS NULL AND "decidedAt" IS NULL)
    OR ("status" IN ('APPROVED', 'REJECTED') AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL
        AND "decidedById" <> "requestedById" AND "decidedById" <> "userId")
    OR ("status" = 'CANCELLED' AND "decidedById" = "requestedById" AND "decidedAt" IS NOT NULL)
    OR ("status" = 'EXPIRED' AND "decidedById" IS NULL AND "decidedAt" IS NOT NULL)),
  ADD CONSTRAINT "CustomerDataAccessRequest_approval" CHECK (
    ("status" = 'APPROVED') = ("assignmentId" IS NOT NULL)
    AND ("status" = 'APPROVED') = ("accessExpiresAt" IS NOT NULL)
    AND ("accessExpiresAt" IS NULL OR "accessExpiresAt" > "decidedAt")
    AND ("expiryRecordedAt" IS NULL OR "status" = 'APPROVED')),
  ADD CONSTRAINT "CustomerDataAccessRequest_rejection_note"
    CHECK ("status" <> 'REJECTED' OR "decisionNote" IS NOT NULL);

-- ===========================================================================================
-- Part 3: rules
-- ===========================================================================================

-- Longest assignment per customer-data role, in days. Equal to CUSTOMER_DATA_MAX_DAYS in
-- @dream/contracts (unit test). An unknown customer-data role gets 0: it cannot be assigned until
-- a migration names it here.
CREATE FUNCTION iam_customer_data_max_days(role_key text) RETURNS integer LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE role_key
    WHEN 'sales_crm_user' THEN 90
    WHEN 'platform_customer_data_officer' THEN 30
    ELSE 0
  END
$fn$;

-- The user currently holds the PLATFORM permission through an active assignment and is ACTIVE.
CREATE FUNCTION iam_holds_platform_permission(user_id uuid, permission_key text) RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM "RoleAssignment" ra
    JOIN "User" u ON u."id" = ra."userId"
    JOIN "RolePermission" rp ON rp."roleId" = ra."roleId"
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE ra."userId" = user_id AND ra."scopeType" = 'PLATFORM' AND ra."revokedAt" IS NULL
      AND (ra."expiresAt" IS NULL OR ra."expiresAt" > now())
      AND u."status" = 'ACTIVE' AND u."kind" = 'STAFF' AND p."key" = permission_key)
$fn$;

CREATE FUNCTION iam_customer_data_request_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  role_key text;
  max_days integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'iam: customer-data access requests are evidence and cannot be deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT r."key" INTO role_key FROM "Role" r WHERE r."id" = NEW."roleId";
  IF TG_OP = 'INSERT' THEN
    IF NOT iam_is_customer_data_role(NEW."roleId") THEN
      RAISE EXCEPTION 'iam: only customer-data roles go through an access request'
        USING ERRCODE = 'check_violation';
    END IF;
    max_days := iam_customer_data_max_days(role_key);
    IF NEW."durationDays" > max_days THEN
      RAISE EXCEPTION 'iam: requested duration exceeds the maximum for this role (DP-077)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."status" <> 'PENDING' OR NEW."assignmentId" IS NOT NULL OR NEW."expiryRecordedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'iam: a new access request starts PENDING' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."decideBy" > now() + interval '7 days 1 minute' THEN
      RAISE EXCEPTION 'iam: an access request is open for at most 7 days' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT iam_holds_platform_permission(NEW."requestedById", 'customer_data_access:grant') THEN
      RAISE EXCEPTION 'iam: the requester must hold customer_data_access:grant'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NEW."userId" AND u."kind" = 'STAFF'
                   AND u."status" = 'ACTIVE') THEN
      RAISE EXCEPTION 'iam: customer-data access is only for active staff'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."extendsAssignmentId" IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM "RoleAssignment" ra
         WHERE ra."id" = NEW."extendsAssignmentId" AND ra."userId" = NEW."userId"
           AND ra."roleId" = NEW."roleId" AND ra."scopeType" = NEW."scopeType"
           AND ra."siteId" IS NOT DISTINCT FROM NEW."siteId") THEN
      RAISE EXCEPTION 'iam: an extension must name the same user, role and scope'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE. What was asked never changes.
  IF NEW."id" <> OLD."id" OR NEW."userId" <> OLD."userId" OR NEW."roleId" <> OLD."roleId"
     OR NEW."scopeType" <> OLD."scopeType" OR NEW."siteId" IS DISTINCT FROM OLD."siteId"
     OR NEW."justification" <> OLD."justification" OR NEW."durationDays" <> OLD."durationDays"
     OR NEW."extendsAssignmentId" IS DISTINCT FROM OLD."extendsAssignmentId"
     OR NEW."requestedById" <> OLD."requestedById" OR NEW."requestedAt" <> OLD."requestedAt"
     OR NEW."decideBy" <> OLD."decideBy" THEN
    RAISE EXCEPTION 'iam: an access request cannot be edited' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."status" <> 'PENDING' THEN
    -- A decided request is final. Only the one-time expiry record of an approved one is set.
    IF NEW."status" = OLD."status" AND OLD."status" = 'APPROVED'
       AND NEW."decidedById" IS NOT DISTINCT FROM OLD."decidedById"
       AND NEW."decidedAt" IS NOT DISTINCT FROM OLD."decidedAt"
       AND NEW."decisionNote" IS NOT DISTINCT FROM OLD."decisionNote"
       AND NEW."assignmentId" IS NOT DISTINCT FROM OLD."assignmentId"
       AND NEW."accessExpiresAt" IS NOT DISTINCT FROM OLD."accessExpiresAt"
       AND OLD."expiryRecordedAt" IS NULL AND NEW."expiryRecordedAt" IS NOT NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'iam: a decided access request is final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."status" = 'PENDING' THEN
    RAISE EXCEPTION 'iam: an access request changes only to a final status' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'APPROVED' THEN
    IF OLD."decideBy" <= now() THEN
      RAISE EXCEPTION 'iam: the access request has expired' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT iam_holds_platform_permission(NEW."decidedById", 'customer_data_access:grant') THEN
      RAISE EXCEPTION 'iam: the approver must hold customer_data_access:grant'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    max_days := iam_customer_data_max_days(role_key);
    IF NEW."accessExpiresAt" > now() + make_interval(days => LEAST(NEW."durationDays", max_days), mins => 1) THEN
      RAISE EXCEPTION 'iam: approved access exceeds the requested or maximum duration (DP-077)'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW."status" = 'EXPIRED' THEN
    IF OLD."decideBy" > now() THEN
      RAISE EXCEPTION 'iam: an access request expires only after its deadline' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW."status" = 'REJECTED' THEN
    IF NOT iam_holds_platform_permission(NEW."decidedById", 'customer_data_access:grant') THEN
      RAISE EXCEPTION 'iam: the rejecter must hold customer_data_access:grant'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "CustomerDataAccessRequest_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "CustomerDataAccessRequest"
  FOR EACH ROW EXECUTE FUNCTION iam_customer_data_request_guard();
CREATE FUNCTION iam_customer_data_request_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'iam: customer-data access requests cannot be truncated'
    USING ERRCODE = 'insufficient_privilege';
END
$fn$;
CREATE TRIGGER "CustomerDataAccessRequest_no_truncate" BEFORE TRUNCATE ON "CustomerDataAccessRequest"
  FOR EACH STATEMENT EXECUTE FUNCTION iam_customer_data_request_no_truncate();

-- An approval is only valid together with its role assignment (same transaction, checked at
-- commit).
CREATE FUNCTION iam_customer_data_approval_has_assignment() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW."status" = 'APPROVED' AND NOT EXISTS (
       SELECT 1 FROM "RoleAssignment" ra WHERE ra."id" = NEW."assignmentId") THEN
    RAISE EXCEPTION 'iam: an approved access request needs its role assignment'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$fn$;
CREATE CONSTRAINT TRIGGER "CustomerDataAccessRequest_assignment_exists"
  AFTER UPDATE ON "CustomerDataAccessRequest" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION iam_customer_data_approval_has_assignment();

-- Replaces the F1-001B guard. A customer-data role is inserted only as the assignment of an
-- APPROVED request (same user, role, scope; the approver is the grantor; the request's expiry),
-- and an existing one is never extended or made permanent.
CREATE OR REPLACE FUNCTION iam_customer_data_role_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT iam_is_customer_data_role(NEW."roleId") THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."expiresAt" IS NULL OR NEW."revokedAt" IS NOT NULL OR NOT EXISTS (
         SELECT 1 FROM "CustomerDataAccessRequest" r
         WHERE r."assignmentId" = NEW."id" AND r."status" = 'APPROVED'
           AND r."userId" = NEW."userId" AND r."roleId" = NEW."roleId"
           AND r."scopeType" = NEW."scopeType" AND r."siteId" IS NOT DISTINCT FROM NEW."siteId"
           AND r."decidedById" = NEW."grantedById" AND r."accessExpiresAt" = NEW."expiresAt") THEN
      RAISE EXCEPTION 'iam: customer-data roles need a dual-approved, time-limited access request (DP-076)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."userId" <> OLD."userId" OR NEW."roleId" <> OLD."roleId" OR NEW."scopeType" <> OLD."scopeType"
     OR NEW."siteId" IS DISTINCT FROM OLD."siteId" OR NEW."grantedById" IS DISTINCT FROM OLD."grantedById" THEN
    RAISE EXCEPTION 'iam: a customer-data assignment cannot be moved' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     AND (NEW."expiresAt" IS NULL OR (OLD."expiresAt" IS NOT NULL AND NEW."expiresAt" > OLD."expiresAt")) THEN
    RAISE EXCEPTION 'iam: customer-data access cannot be extended without dual approval (DP-077)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;

-- ===========================================================================================
-- Part 4: privileges (ADR-012A default privileges gave dp_app full DML on the new table)
-- ===========================================================================================

-- Requests are evidence: inserted, then decided once; never deleted.
REVOKE DELETE ON TABLE "CustomerDataAccessRequest" FROM dp_app;
