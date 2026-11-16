-- DP-193 (ADR-023): direct publication of a product by one authorised administrator.
--
-- Runs as dp_owner (ADR-012A). Additive: one enum, one column with a default, one function, and
-- the publication guard replaced by a version that keeps every PM-3 rule for the APPROVED mode.
-- No row changes: the existing publications are APPROVED publications.
--
--  * ProductPublication.approvalMode records how a (re)publication was authorised:
--      APPROVED - the PM-3 path, unchanged: the master is APPROVED in exactly the published
--                 version (second-person review, separation of duties stays in its triggers);
--      DIRECT   - the current version of a DRAFT or IN_REVIEW master, published by a user who
--                 holds product:approve platform-wide AND product:publish of the site. The master
--                 status is not changed: DIRECT never produces an APPROVED master.
--  * The database checks the DIRECT publisher's rights itself (catalog_direct_publish_allowed), so
--    an API bug cannot publish an unreviewed version for a user without both rights.
--  * Both modes keep: the listing VISIBLE in exactly the published listing version, product, site
--    and listing never change, a snapshot (and now its mode) changes only with a new publishedAt,
--    archived masters are never published.
--
-- Rollback: roll forward. Removing DIRECT means a new migration that restores the PM-3 guard
-- (the APPROVED branch below is that guard) after unpublishing or republishing DIRECT rows.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_app') THEN
    RAISE EXCEPTION 'DP-193: role dp_app missing; ADR-012A must be applied first';
  END IF;
  IF to_regclass('public."SystemOwner"') IS NULL THEN
    RAISE EXCEPTION 'DP-193: migration 20261120090000_dp_108_system_owner must be applied first';
  END IF;
END $$;

CREATE TYPE "PublicationApprovalMode" AS ENUM ('APPROVED', 'DIRECT');

ALTER TABLE "ProductPublication"
  ADD COLUMN "approvalMode" "PublicationApprovalMode" NOT NULL DEFAULT 'APPROVED';

-- Whether a staff user may publish the current version of a product on a site without a
-- technical review: an ACTIVE staff user who is the system owner (DP-108: every staff
-- permission), or who holds product:approve through a PLATFORM role AND product:publish through
-- a PLATFORM role or a SITE role of that site with an ACTIVE membership there (as decide() does).
-- RoleAssignment and Membership have row-level security (DP-125); like the DP-173 helper this is a
-- narrow SECURITY DEFINER (owner dp_owner, pinned search_path) that answers one boolean.
CREATE FUNCTION catalog_direct_publish_allowed(user_id uuid, site_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  IF user_id IS NULL OR site_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "User" u WHERE u."id" = user_id AND u."status" = 'ACTIVE' AND u."kind" = 'STAFF'
  ) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Site" st WHERE st."id" = site_id) THEN
    RETURN false;
  END IF;
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
        AND p."key" = 'product:approve' AND p."audience" = 'STAFF'
        AND r."audience" = 'STAFF' AND r."scopeType" = ra."scopeType" AND r."key" <> 'system_owner'
        AND ra."scopeType" = 'PLATFORM' AND ra."siteId" IS NULL
    )
    AND EXISTS (
      SELECT 1
      FROM "RoleAssignment" ra
      JOIN "Role" r ON r."id" = ra."roleId"
      JOIN "RolePermission" rp ON rp."roleId" = r."id"
      JOIN "Permission" p ON p."id" = rp."permissionId"
      WHERE ra."userId" = user_id
        AND ra."revokedAt" IS NULL
        AND (ra."expiresAt" IS NULL OR ra."expiresAt" > now())
        AND p."key" = 'product:publish' AND p."audience" = 'STAFF'
        AND r."audience" = 'STAFF' AND r."scopeType" = ra."scopeType" AND r."key" <> 'system_owner'
        AND ((ra."scopeType" = 'PLATFORM' AND ra."siteId" IS NULL)
             OR (ra."scopeType" = 'SITE' AND ra."siteId" = site_id
                 AND EXISTS (SELECT 1 FROM "Membership" m
                             WHERE m."userId" = user_id AND m."siteId" = site_id
                               AND m."status" = 'ACTIVE')))
    );
END
$fn$;

REVOKE ALL ON FUNCTION catalog_direct_publish_allowed(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog_direct_publish_allowed(uuid, uuid) TO dp_app;

-- The PM-3 guard (20261113090100) with the DIRECT branch. A publication goes live only when,
-- whenever a row becomes PUBLISHED or its snapshot is replaced:
--  * APPROVED: the master is APPROVED in exactly the published version (unchanged);
--  * DIRECT: the master is DRAFT, IN_REVIEW or APPROVED (never ARCHIVED), in exactly the published
--    version, and the publisher may publish directly on the site;
--  * both: the listing is VISIBLE in exactly the published listing version.
-- Product, site and listing never change; the snapshot, its versions, images and mode change only
-- together with a new publishedAt (republishing).
CREATE OR REPLACE FUNCTION catalog_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  p RECORD;
  l RECORD;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."productId" IS DISTINCT FROM OLD."productId"
       OR NEW."siteId" IS DISTINCT FROM OLD."siteId"
       OR NEW."listingId" IS DISTINCT FROM OLD."listingId" THEN
      RAISE EXCEPTION 'catalog: the product, site and listing of a publication cannot change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW."snapshot" IS DISTINCT FROM OLD."snapshot"
        OR NEW."productVersion" IS DISTINCT FROM OLD."productVersion"
        OR NEW."listingVersion" IS DISTINCT FROM OLD."listingVersion"
        OR NEW."imageIds" IS DISTINCT FROM OLD."imageIds"
        OR NEW."approvalMode" IS DISTINCT FROM OLD."approvalMode")
       AND NEW."publishedAt" IS NOT DISTINCT FROM OLD."publishedAt" THEN
      RAISE EXCEPTION 'catalog: a published snapshot is replaced only by publishing again'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."status" = 'PUBLISHED' AND (
       TG_OP = 'INSERT' OR OLD."status" <> 'PUBLISHED'
       OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt") THEN
    SELECT "status", "version", "approvedVersion" INTO p FROM "Product" WHERE "id" = NEW."productId";
    IF NEW."approvalMode" = 'DIRECT' THEN
      IF p."status" IS NULL OR p."status" = 'ARCHIVED'
         OR p."version" IS DISTINCT FROM NEW."productVersion" THEN
        RAISE EXCEPTION 'catalog: only the current version of an active product can be published directly'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NOT catalog_direct_publish_allowed(NEW."publishedById", NEW."siteId") THEN
        RAISE EXCEPTION 'catalog: direct publication needs product approval and publishing rights on the site'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF p."status" IS DISTINCT FROM 'APPROVED'
       OR p."version" IS DISTINCT FROM NEW."productVersion"
       OR p."approvedVersion" IS DISTINCT FROM NEW."productVersion" THEN
      RAISE EXCEPTION 'catalog: only the approved version of a product can be published'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT "version", "visibility" INTO l FROM "ProductSiteListing" WHERE "id" = NEW."listingId";
    IF l."visibility" IS DISTINCT FROM 'VISIBLE' OR l."version" IS DISTINCT FROM NEW."listingVersion" THEN
      RAISE EXCEPTION 'catalog: only the current visible listing can be published'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
