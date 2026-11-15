-- DP-173 (ADR-022 D5): access check of the company catalogue preview.
--
-- Runs as dp_owner (ADR-012A). Additive only: one function, no table, column or row changes.
--
-- The BV catalogue preview is opened with a short-lived signed link that names the staff
-- session that issued it (never the session token). On EVERY preview request the API asks this
-- function whether that session is still a live admin session of an ACTIVE staff user (not
-- revoked, idle or absolute timeout not passed, same security version) and whether the user
-- still holds `product_proposal:review` on the site (a SITE role with an ACTIVE membership
-- there, a PLATFORM role, or the system owner) — as decide() does for this permission. Revoking
-- the session or the role ends the preview at once.
--
-- RoleAssignment and Membership have row-level security (DP-125) that opens only in a staff
-- context set with the raw session token, which a preview request does not carry. Like the
-- DP-125 helpers, this function is a narrow SECURITY DEFINER (owner dp_owner, pinned search_path)
-- that answers one boolean about one session; EXECUTE is never PUBLIC, only dp_app.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_app') THEN
    RAISE EXCEPTION 'DP-173: role dp_app missing; ADR-012A must be applied first';
  END IF;
  IF to_regclass('public."ProductContentProposal"') IS NULL THEN
    RAISE EXCEPTION 'DP-173: migration 20261202090000_dp_171_content_proposals must be applied first';
  END IF;
END $$;

CREATE FUNCTION catalog_preview_session_allowed(session_id uuid, user_id uuid, site_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  IF session_id IS NULL OR user_id IS NULL OR site_id IS NULL THEN
    RETURN false;
  END IF;
  -- A live admin session of this ACTIVE staff user.
  IF NOT EXISTS (
    SELECT 1
    FROM "Session" s
    JOIN "User" u ON u."id" = s."userId"
    WHERE s."id" = session_id AND s."userId" = user_id
      AND s."kind" = 'STAFF' AND s."app" = 'ADMIN'
      AND s."revokedAt" IS NULL
      AND s."idleExpiresAt" > now() AND s."absoluteExpiresAt" > now()
      AND s."securityVersion" = u."securityVersion"
      AND u."status" = 'ACTIVE' AND u."kind" = 'STAFF'
  ) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Site" st WHERE st."id" = site_id) THEN
    RETURN false;
  END IF;
  -- The system owner holds every staff permission (DP-108).
  IF EXISTS (SELECT 1 FROM "SystemOwner" o WHERE o."userId" = user_id) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM "RoleAssignment" ra
    JOIN "Role" r ON r."id" = ra."roleId"
    JOIN "RolePermission" rp ON rp."roleId" = r."id"
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE ra."userId" = user_id
      AND ra."revokedAt" IS NULL
      AND (ra."expiresAt" IS NULL OR ra."expiresAt" > now())
      AND p."key" = 'product_proposal:review' AND p."audience" = 'STAFF'
      AND r."audience" = 'STAFF' AND r."scopeType" = ra."scopeType" AND r."key" <> 'system_owner'
      AND ((ra."scopeType" = 'PLATFORM' AND ra."siteId" IS NULL)
           OR (ra."scopeType" = 'SITE' AND ra."siteId" = site_id
               AND EXISTS (SELECT 1 FROM "Membership" m
                           WHERE m."userId" = user_id AND m."siteId" = site_id
                             AND m."status" = 'ACTIVE')))
  );
END
$fn$;

REVOKE ALL ON FUNCTION catalog_preview_session_allowed(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog_preview_session_allowed(uuid, uuid, uuid) TO dp_app;
