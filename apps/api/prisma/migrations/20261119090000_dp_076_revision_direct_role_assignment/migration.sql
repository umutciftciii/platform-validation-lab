-- DP-076 revision (owner decision 2026-11-11, ADR-017 v2): direct role assignment.
--
-- The dual-approval workflow of 20261118090000_dp_076_customer_data_access is retired. Customer-
-- data roles are assigned and revoked directly by a holder of role_assignment:grant/revoke within
-- its own permissions (code: no-escalation rule); no second approver, justification or expiry.
--
-- Runs as dp_owner (ADR-012A). Additive: no table, column or row is removed.
--  1. Open (PENDING) access requests are closed as CANCELLED by their requester with a fixed note,
--     so no request can be approved any more. Decided requests stay unchanged as history.
--  2. "CustomerDataAccessRequest" becomes read-only history: no new rows, no edits, no deletes;
--     only the one-time expiry record of an approved request (sweep) may still be set.
--  3. iam_customer_data_role_guard() is replaced by a pass-through: customer-data assignments
--     follow the general rules (reciprocal-grant and last-administrator triggers stay). Existing time-limited
--     assignments keep their expiresAt: nothing becomes permanent silently. An administrator
--     replaces one explicitly with a new assignment (audited) if it should continue.
-- Tested in test/integration/leads.int.test.ts ("direct role assignment").

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'iam_customer_data_request_guard') THEN
    RAISE EXCEPTION 'DP-076 revision: migration 20261118090000_dp_076_customer_data_access must be applied first';
  END IF;
END $$;

-- 1. Close open requests (allowed by the current guard: PENDING -> CANCELLED by the requester).
UPDATE "CustomerDataAccessRequest"
SET "status" = 'CANCELLED',
    "decidedById" = "requestedById",
    "decidedAt" = now(),
    "decisionNote" = 'Closed by the DP-076 revision: roles are now assigned directly (ADR-017 v2)'
WHERE "status" = 'PENDING';

-- 2. Read-only history.
CREATE OR REPLACE FUNCTION iam_customer_data_request_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'iam: customer-data access requests are evidence and cannot be deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'iam: the access-request workflow is retired; assign roles directly (DP-076 revision)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."status" = 'APPROVED' AND NEW."status" = 'APPROVED'
     AND OLD."expiryRecordedAt" IS NULL AND NEW."expiryRecordedAt" IS NOT NULL
     AND (to_jsonb(NEW) - 'expiryRecordedAt') = (to_jsonb(OLD) - 'expiryRecordedAt') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'iam: customer-data access requests are read-only history (DP-076 revision)'
    USING ERRCODE = 'insufficient_privilege';
END
$fn$;

-- 3. Customer-data roles follow the general assignment rules (reciprocal and last-administrator
--    triggers stay). The trigger is kept so later migrations can reuse the function; it no
--    longer refuses anything. Note: platform_super_admin now carries customer data itself, and
--    its bootstrap assignment has no grantor, so no grantor rule is added here.
CREATE OR REPLACE FUNCTION iam_customer_data_role_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RETURN NEW;
END
$fn$;
