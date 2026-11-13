-- DP-103 (ADR-012B, lead data): row-level security on the lead tables.
--
-- Runs as dp_owner (ADR-012A). Additive: no table, column or row changes. It switches row-level
-- security on for "Lead", "LeadDocumentRequest", "DocumentDownloadGrant" and "LeadDocumentDownload"
-- and gives each role explicit policies. Nothing else in the schema gets RLS here (the IAM tables
-- follow in DP-125).
--
-- Who sees what (deny by default: a role or a context without a policy sees no row):
--   dp_app, staff context    SELECT on the sites where the database itself finds `lead:read` for
--                            the user behind the presented admin session: a live ADMIN session
--                            (raw token, hashed here), an ACTIVE staff user, an active role
--                            assignment whose role carries lead:read (platform-wide, or a site
--                            role with an ACTIVE membership there), or the designated system
--                            owner (God Mode, ADR-018; an explicit branch, not a bypass). No
--                            write: lead:manage does not exist yet (DP-041 adds its policies).
--   dp_app, public context   Only the visitor's own rows: the lead of the e-mail in the form
--                            (insert/update/select) and the grant of the presented download token
--                            with its request and downloads. The site comes from the proxy key
--                            (API), so it alone opens nothing.
--   dp_lead_retention        SELECT and UPDATE everywhere, DELETE of grants; the column grants
--                            and guard triggers of DP-096 still limit what it may change.
--   dp_owner                 Table owner (migrations and the reviewed SECURITY DEFINER
--                            functions): not subject to RLS (no FORCE, ADR-012B B5).
--
-- The context is transaction-local: leads_rls_set_*_context use set_config(..., true) and stamp
-- the transaction start time; every reader checks the stamp, so a value that outlives its
-- transaction (a session-level set_config by mistake) opens nothing in the next one. Missing or
-- malformed values open nothing (fail closed).
-- Tested in test/integration/leads.int.test.ts (DP-103), owner.int.test.ts and db-roles.int.test.ts.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_lead_retention') THEN
    RAISE EXCEPTION 'DP-103: database roles missing; run infra/docker/stack.sh db-roles <dev|prod> --yes first (dp-roles.sql)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'leads_lead_guard') THEN
    RAISE EXCEPTION 'DP-103: migration 20261122090000_dp_096_lead_retention must be applied first';
  END IF;
END $$;

-- =============================================================================================
-- Part 1: the request context
-- =============================================================================================

-- Whether the context was set in THIS transaction (transaction start time stamp).
CREATE FUNCTION leads_rls_context_live() RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT COALESCE(current_setting('dp.lead_ctx_at', true), '') = now()::text
$fn$;

-- Staff: the raw admin session token from the cookie. Never the stored hash: dp_app can read
-- "Session"."tokenHash", so a hash would let the API pose as any signed-in user.
-- No SET clause on the two setters: a function-level SET would scope GUC changes to the call.
CREATE FUNCTION leads_rls_set_staff_context(session_token text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_catalog.set_config('dp.lead_staff_session', COALESCE(session_token, ''), true);
  PERFORM pg_catalog.set_config('dp.lead_public_site', '', true);
  PERFORM pg_catalog.set_config('dp.lead_public_email', '', true);
  PERFORM pg_catalog.set_config('dp.lead_public_grant', '', true);
  PERFORM pg_catalog.set_config('dp.lead_ctx_at', pg_catalog.now()::text, true);
END
$fn$;

-- Public: the site of the proxy key, the normalised e-mail of the form, the raw download token.
CREATE FUNCTION leads_rls_set_public_context(site_id uuid, lead_email text, grant_token text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_catalog.set_config('dp.lead_staff_session', '', true);
  PERFORM pg_catalog.set_config('dp.lead_public_site', COALESCE(site_id::text, ''), true);
  PERFORM pg_catalog.set_config('dp.lead_public_email', COALESCE(lead_email, ''), true);
  PERFORM pg_catalog.set_config('dp.lead_public_grant', COALESCE(grant_token, ''), true);
  PERFORM pg_catalog.set_config('dp.lead_ctx_at', pg_catalog.now()::text, true);
END
$fn$;

CREATE FUNCTION leads_rls_public_site_id() RETURNS uuid LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v text := current_setting('dp.lead_public_site', true);
BEGIN
  IF NOT public.leads_rls_context_live()
     OR v IS NULL OR v !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN v::uuid;
END
$fn$;

CREATE FUNCTION leads_rls_public_email() RETURNS text LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v text := current_setting('dp.lead_public_email', true);
BEGIN
  IF NOT public.leads_rls_context_live() OR public.leads_rls_public_site_id() IS NULL
     OR v IS NULL OR length(v) NOT BETWEEN 3 AND 254 OR position('@' IN v) = 0 THEN
    RETURN NULL;
  END IF;
  RETURN v;
END
$fn$;

-- SHA-256 of the presented download token (the stored form, ADR-016 D4).
CREATE FUNCTION leads_rls_public_grant_hash() RETURNS text LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v text := current_setting('dp.lead_public_grant', true);
BEGIN
  IF NOT public.leads_rls_context_live() OR public.leads_rls_public_site_id() IS NULL
     OR v IS NULL OR v !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN NULL;
  END IF;
  RETURN encode(sha256(convert_to(v, 'UTF8')), 'hex');
END
$fn$;

-- The sites whose leads the staff user behind the session may read. SECURITY DEFINER (owner
-- dp_owner) because it reads the IAM tables whatever role evaluates the policy; it touches no lead
-- table and returns only site ids. Mirrors decide() for lead:read (core module, not sensitive)
-- and the session checks of StaffSessionService.require; stricter where they differ (a revoked
-- assignment counts as revoked at once).
CREATE FUNCTION leads_rls_staff_site_ids() RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  token text := current_setting('dp.lead_staff_session', true);
  uid uuid;
BEGIN
  IF NOT public.leads_rls_context_live() OR token IS NULL OR token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN '{}'::uuid[];
  END IF;
  SELECT s."userId" INTO uid
  FROM "Session" s JOIN "User" u ON u."id" = s."userId"
  WHERE s."tokenHash" = encode(sha256(convert_to(token, 'UTF8')), 'hex')
    AND s."app" = 'ADMIN' AND s."kind" = 'STAFF' AND s."revokedAt" IS NULL
    AND s."idleExpiresAt" > now() AND s."absoluteExpiresAt" > now()
    AND s."securityVersion" = u."securityVersion"
    AND u."status" = 'ACTIVE' AND u."kind" = 'STAFF';
  IF uid IS NULL THEN
    RETURN '{}'::uuid[];
  END IF;
  -- God Mode (ADR-018): the designated system owner reads every site. Explicit, audited by the
  -- API (PROTECTED stream); never BYPASSRLS and never a switched-off policy.
  IF EXISTS (SELECT 1 FROM "SystemOwner" o WHERE o."userId" = uid) THEN
    RETURN ARRAY(SELECT st."id" FROM "Site" st ORDER BY st."id");
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
        AND p."key" = 'lead:read' AND p."audience" = 'STAFF'
        AND r."audience" = 'STAFF' AND r."scopeType" = ra."scopeType" AND r."key" <> 'system_owner'
        AND ((ra."scopeType" = 'PLATFORM' AND ra."siteId" IS NULL)
             OR (ra."scopeType" = 'SITE' AND ra."siteId" = st."id"
                 AND EXISTS (SELECT 1 FROM "Membership" m
                             WHERE m."userId" = uid AND m."siteId" = st."id"
                               AND m."status" = 'ACTIVE'))))
    ORDER BY st."id");
END
$fn$;

-- The scheduled DRY-RUN report of DP-096 runs in the API as dp_app, which RLS now keeps away from
-- the lead tables. It gets counts only (no row, no id) through this reviewed function; the
-- operator's run calls the same function as dp_lead_retention (one code path, retention.ts).
CREATE FUNCTION leads_retention_plan(
  cutoff_lead timestamptz, cutoff_ip_hmac timestamptz, cutoff_unused_grant timestamptz,
  at_time timestamptz)
RETURNS TABLE (leads_due bigint, leads_held bigint, ip_hmac_due bigint, unused_grants_due bigint,
               buckets_due bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT
    (SELECT count(*) FROM "Lead" l WHERE l."anonymisedAt" IS NULL AND l."retentionHold" IS NULL
       AND GREATEST(l."lastRequestAt", COALESCE(l."marketingConsentAt", l."lastRequestAt")) < cutoff_lead),
    (SELECT count(*) FROM "Lead" l WHERE l."anonymisedAt" IS NULL AND l."retentionHold" IS NOT NULL
       AND GREATEST(l."lastRequestAt", COALESCE(l."marketingConsentAt", l."lastRequestAt")) < cutoff_lead),
    (SELECT count(*) FROM "LeadDocumentRequest" r
       WHERE r."ipPrefixHmac" IS NOT NULL AND r."createdAt" < cutoff_ip_hmac),
    (SELECT count(*) FROM "DocumentDownloadGrant" g
       WHERE g."downloadCount" = 0 AND g."expiresAt" < cutoff_unused_grant),
    (SELECT count(*) FROM "PublicRateLimit" b WHERE b."expiresAt" <= at_time)
$fn$;

REVOKE ALL ON FUNCTION leads_rls_context_live(), leads_rls_set_staff_context(text),
  leads_rls_set_public_context(uuid, text, text), leads_rls_public_site_id(),
  leads_rls_public_email(), leads_rls_public_grant_hash(), leads_rls_staff_site_ids(),
  leads_retention_plan(timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION leads_rls_context_live(), leads_rls_set_staff_context(text),
  leads_rls_set_public_context(uuid, text, text), leads_rls_public_site_id(),
  leads_rls_public_email(), leads_rls_public_grant_hash(), leads_rls_staff_site_ids()
  TO dp_app;
GRANT EXECUTE ON FUNCTION leads_retention_plan(timestamptz, timestamptz, timestamptz, timestamptz)
  TO dp_app, dp_lead_retention;

-- =============================================================================================
-- Part 2: a grant only for a request the visitor's own context can see
-- =============================================================================================
-- Nothing new: the DP-042 trigger leads_grant_guard() (SECURITY INVOKER) already refuses a grant
-- whose request it cannot find. Under RLS it runs as dp_app, so the request must be visible
-- WITHOUT the new grant, i.e. through the lead of the context's e-mail. An API that learnt a
-- request id (audit metadata) therefore cannot attach its own token to someone else's request. A
-- WITH CHECK on the grant that reads the request would recurse, so the trigger is the right place.

-- =============================================================================================
-- Part 3: policies
-- =============================================================================================
-- `(SELECT f())` makes each context function an InitPlan: evaluated once per statement, not per
-- row. COALESCE turns the array subquery into an expression, so `= ANY` compares with its elements.

ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadDocumentRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentDownloadGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadDocumentDownload" ENABLE ROW LEVEL SECURITY;

-- Lead ----------------------------------------------------------------------------------------
CREATE POLICY lead_staff_read ON "Lead" FOR SELECT TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT leads_rls_staff_site_ids()), '{}'::uuid[])));
CREATE POLICY lead_public_read ON "Lead" FOR SELECT TO dp_app
  USING ("siteId" = (SELECT leads_rls_public_site_id())
         AND "email" = (SELECT leads_rls_public_email()));
CREATE POLICY lead_public_insert ON "Lead" FOR INSERT TO dp_app
  WITH CHECK ("siteId" = (SELECT leads_rls_public_site_id())
              AND "email" = (SELECT leads_rls_public_email()));
CREATE POLICY lead_public_update ON "Lead" FOR UPDATE TO dp_app
  USING ("siteId" = (SELECT leads_rls_public_site_id())
         AND "email" = (SELECT leads_rls_public_email()))
  WITH CHECK ("siteId" = (SELECT leads_rls_public_site_id())
              AND "email" = (SELECT leads_rls_public_email()));
CREATE POLICY lead_retention_read ON "Lead" FOR SELECT TO dp_lead_retention USING (true);
CREATE POLICY lead_retention_update ON "Lead" FOR UPDATE TO dp_lead_retention
  USING (true) WITH CHECK (true);

-- LeadDocumentRequest -------------------------------------------------------------------------
-- The subqueries read "Lead" and "DocumentDownloadGrant" under their own policies, which never
-- read the request back (no recursion).
CREATE POLICY request_staff_read ON "LeadDocumentRequest" FOR SELECT TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT leads_rls_staff_site_ids()), '{}'::uuid[])));
CREATE POLICY request_public_read ON "LeadDocumentRequest" FOR SELECT TO dp_app
  USING ("siteId" = (SELECT leads_rls_public_site_id())
         AND (EXISTS (SELECT 1 FROM "Lead" l
                      WHERE l."id" = "LeadDocumentRequest"."leadId"
                        AND l."siteId" = "LeadDocumentRequest"."siteId")
              OR EXISTS (SELECT 1 FROM "DocumentDownloadGrant" g
                         WHERE g."requestId" = "LeadDocumentRequest"."id"
                           AND g."siteId" = "LeadDocumentRequest"."siteId")));
CREATE POLICY request_public_insert ON "LeadDocumentRequest" FOR INSERT TO dp_app
  WITH CHECK ("siteId" = (SELECT leads_rls_public_site_id())
              AND EXISTS (SELECT 1 FROM "Lead" l
                          WHERE l."id" = "LeadDocumentRequest"."leadId"
                            AND l."siteId" = "LeadDocumentRequest"."siteId"));
CREATE POLICY request_retention_read ON "LeadDocumentRequest" FOR SELECT TO dp_lead_retention
  USING (true);
CREATE POLICY request_retention_update ON "LeadDocumentRequest" FOR UPDATE TO dp_lead_retention
  USING (true) WITH CHECK (true);

-- DocumentDownloadGrant -----------------------------------------------------------------------
CREATE POLICY grant_staff_read ON "DocumentDownloadGrant" FOR SELECT TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT leads_rls_staff_site_ids()), '{}'::uuid[])));
CREATE POLICY grant_public_read ON "DocumentDownloadGrant" FOR SELECT TO dp_app
  USING ("siteId" = (SELECT leads_rls_public_site_id())
         AND "tokenHash" = (SELECT leads_rls_public_grant_hash()));
CREATE POLICY grant_public_insert ON "DocumentDownloadGrant" FOR INSERT TO dp_app
  WITH CHECK ("siteId" = (SELECT leads_rls_public_site_id())
              AND "tokenHash" = (SELECT leads_rls_public_grant_hash()));
CREATE POLICY grant_public_update ON "DocumentDownloadGrant" FOR UPDATE TO dp_app
  USING ("siteId" = (SELECT leads_rls_public_site_id())
         AND "tokenHash" = (SELECT leads_rls_public_grant_hash()))
  WITH CHECK ("siteId" = (SELECT leads_rls_public_site_id())
              AND "tokenHash" = (SELECT leads_rls_public_grant_hash()));
CREATE POLICY grant_retention_read ON "DocumentDownloadGrant" FOR SELECT TO dp_lead_retention
  USING (true);
CREATE POLICY grant_retention_delete ON "DocumentDownloadGrant" FOR DELETE TO dp_lead_retention
  USING (true);

-- LeadDocumentDownload ------------------------------------------------------------------------
CREATE POLICY download_staff_read ON "LeadDocumentDownload" FOR SELECT TO dp_app
  USING ("siteId" = ANY (COALESCE((SELECT leads_rls_staff_site_ids()), '{}'::uuid[])));
CREATE POLICY download_public_read ON "LeadDocumentDownload" FOR SELECT TO dp_app
  USING ("siteId" = (SELECT leads_rls_public_site_id())
         AND EXISTS (SELECT 1 FROM "DocumentDownloadGrant" g
                     WHERE g."id" = "LeadDocumentDownload"."grantId"
                       AND g."siteId" = "LeadDocumentDownload"."siteId"));
CREATE POLICY download_public_insert ON "LeadDocumentDownload" FOR INSERT TO dp_app
  WITH CHECK ("siteId" = (SELECT leads_rls_public_site_id())
              AND EXISTS (SELECT 1 FROM "DocumentDownloadGrant" g
                          WHERE g."id" = "LeadDocumentDownload"."grantId"
                            AND g."siteId" = "LeadDocumentDownload"."siteId"));
CREATE POLICY download_retention_read ON "LeadDocumentDownload" FOR SELECT TO dp_lead_retention
  USING (true);
CREATE POLICY download_retention_update ON "LeadDocumentDownload" FOR UPDATE TO dp_lead_retention
  USING (true) WITH CHECK (true);
