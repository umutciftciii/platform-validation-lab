-- DP-204: the catalogue preview is open to the site's publisher as well as its company reviewer.
--
-- Runs as dp_owner (ADR-012A). Additive only: the DP-173 function is replaced by the same
-- function with one change — the permission it accepts. No table, column, row, role or grant
-- changes; the signature, owner, SECURITY DEFINER, pinned search_path and EXECUTE (dp_app only)
-- stay as they are.
--
-- Why a migration: a preview request carries a signed link, never a session token, so it cannot
-- open the row-level security of RoleAssignment and Membership (DP-125). The per-request check
-- of the issuing session and its role therefore lives in this SECURITY DEFINER function, and the
-- accepted permission is part of it. Allowing `product:publish` only in the API would issue links
-- that every preview request then refuses (404).
--
-- What changes: the session's user must hold `product_proposal:review` OR `product:publish` on
-- the site (site role with an ACTIVE membership there, a platform role, or the system owner) —
-- as decide() does for either permission. Everything else is unchanged: a live ADMIN session of
-- an ACTIVE staff user, same security version, existing site; a revoked session or role ends the
-- preview at once. A publisher can already read every product, proposal and held value of its
-- site in the admin (`product:read`), so the preview shows it nothing new. The preview never
-- writes and never publishes.
--
-- Rollback: roll forward with the DP-173 body (accepted permission `product_proposal:review`).

DO $$
BEGIN
  IF to_regprocedure('public.catalog_preview_session_allowed(uuid, uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'DP-204: migration 20261203090000_dp_173_catalog_preview_access must be applied first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION catalog_preview_session_allowed(session_id uuid, user_id uuid, site_id uuid)
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
      AND p."key" IN ('product_proposal:review', 'product:publish') AND p."audience" = 'STAFF'
      AND r."audience" = 'STAFF' AND r."scopeType" = ra."scopeType" AND r."key" <> 'system_owner'
      AND ((ra."scopeType" = 'PLATFORM' AND ra."siteId" IS NULL)
           OR (ra."scopeType" = 'SITE' AND ra."siteId" = site_id
               AND EXISTS (SELECT 1 FROM "Membership" m
                           WHERE m."userId" = user_id AND m."siteId" = site_id
                             AND m."status" = 'ACTIVE')))
  );
END
$fn$;
