-- DP-307 (ADR-031 D6, ADR-030 D10): the provider's data-processing terms hold not only when a
-- personal-data operation is reserved but at the moment its paid request is sent.
--
--  * "AiOperation"."personalData" / "dataTermsId": an operation that sends personal data names the
--    exact "AiProviderDataTerms" record it relies on (CHECK: both or neither). A renewal of the
--    terms is a NEW record (the old one is revoked), so an operation queued under the old record
--    is refused like one under revoked terms.
--  * The terms gate is a SHARED transaction advisory lock of the provider (class 307), taken after
--    the AI switch (DP-287/DP-297 order: switch → operation row → terms), then the record's
--    revokedAt is read. The owner's revocation (and a renewal, which revokes) takes the EXCLUSIVE
--    lock first (ai_provider_terms_lock, called by data-terms.service.ts before its UPDATE; the
--    guard trigger refuses an UPDATE without it): it waits only for the holders already running,
--    and the lock manager queues new holders behind it (a row lock alone would let new FOR SHARE
--    lockers overtake a waiting UPDATE). After the revocation COMMIT every check sees "revoked".
--  * ai_reserve: a personal-data reservation needs a valid record of the task's provider:
--    provider_terms_missing (none given / other provider) or provider_terms_revoked. The record is
--    stored on the operation. Idempotent replays must name the same flag and record.
--  * ai_dispatch: runs in the worker's whileEnabled('ai') transaction that also starts the
--    provider request and hands it to the transport before COMMIT (DP-297). It checks the record
--    again under the shared lock: a revoked record answers provider_terms_revoked — no dispatch
--    stamp, no request, settled FAILED with cost 0. A revocation that commits after a dispatch
--    waited for that transaction: the request was handed to the transport before it.
--  * ai_terms_hold(op): the same check for the settlement transaction (switch → op → terms): an
--    answer to a request whose terms were revoked meanwhile is DISCARDED, never stored.
--  * ai_stop_signals: provider_terms_revoked stops a running call at the next poll (fast path).
--  * ai_store_result, ai_call_plan: no stored draft and no call plan under revoked terms.
--
-- Tested in test/integration/owner.int.test.ts (DP-307 block), test/unit/ai/dp307-*.test.ts.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'AiProviderDataTerms')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ai_dispatch') THEN
    RAISE EXCEPTION 'DP-307: migrations 20261221090000_dp_297_ai_durable_queue and 20261222090000_dp_298_legal_texts_consents must be applied first';
  END IF;
END $$;

-- =============================================================================================
-- Part 1: the operation's terms
-- =============================================================================================

ALTER TABLE "AiOperation" ADD COLUMN "personalData" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dataTermsId" UUID;

ALTER TABLE "AiOperation" ADD CONSTRAINT "AiOperation_dataTermsId_fkey" FOREIGN KEY ("dataTermsId") REFERENCES "AiProviderDataTerms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiOperation"
  ADD CONSTRAINT "AiOperation_personal_terms" CHECK ("personalData" = ("dataTermsId" IS NOT NULL));

CREATE INDEX "AiOperation_dataTermsId_idx" ON "AiOperation"("dataTermsId") WHERE ("dataTermsId" IS NOT NULL);

-- =============================================================================================
-- Part 2: the terms gate
-- =============================================================================================

-- Internal (no EXECUTE for dp_app): holds the provider's terms gate (shared) until the caller's
-- transaction ends, then answers whether the record is still in force. A record's provider never
-- changes (guard), so it is read before the lock.
CREATE FUNCTION ai_terms_hold_valid(p_terms uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  prov "AiProvider";
  revoked timestamptz;
BEGIN
  IF p_terms IS NULL THEN RETURN false; END IF;
  SELECT t."provider" INTO prov FROM "AiProviderDataTerms" t WHERE t."id" = p_terms;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock_shared(307, hashtext(prov::text));
  SELECT t."revokedAt" INTO revoked FROM "AiProviderDataTerms" t WHERE t."id" = p_terms;
  RETURN revoked IS NULL;
END
$fn$;

-- Taken by the owner's record/revoke before its UPDATE (data-terms.service.ts). Returns true.
CREATE FUNCTION ai_provider_terms_lock(p_provider "AiProvider") RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(307, hashtext(p_provider::text));
  RETURN true;
END
$fn$;

-- DP-298's guard, and a revocation only under the exclusive terms gate (no path can skip it).
CREATE OR REPLACE FUNCTION ai_provider_data_terms_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."revokedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'ai: new provider terms cannot be revoked' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' OR OLD."revokedAt" IS NOT NULL
     OR (to_jsonb(NEW) - ARRAY['revokedAt', 'revokedById'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['revokedAt', 'revokedById']) THEN
    RAISE EXCEPTION 'ai: provider data terms are evidence; they can only be revoked once'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_locks l
                  WHERE l.locktype = 'advisory' AND l.pid = pg_catalog.pg_backend_pid()
                    AND l.granted AND l.mode = 'ExclusiveLock' AND l.objsubid = 2
                    AND l.classid = 307::oid
                    AND l.objid = (hashtext(OLD."provider"::text)::bigint & 4294967295)::oid) THEN
    RAISE EXCEPTION 'ai: revoking provider terms requires ai_provider_terms_lock first'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$fn$;

-- =============================================================================================
-- Part 3: reservation (DP-290's ai_reserve with the personal-data flag and the terms record)
-- =============================================================================================

DROP FUNCTION ai_reserve("AiTaskType", uuid, text, text, integer, integer, text, bigint, bigint);

-- Outcomes: as DP-290, plus provider_terms_missing | provider_terms_revoked.
CREATE FUNCTION ai_reserve(
  p_task "AiTaskType",
  p_site uuid,
  p_idempotency text,
  p_input_digest text,
  p_est_input integer,
  p_est_output integer,
  p_instance text,
  p_cap_daily bigint,
  p_cap_monthly bigint,
  p_personal boolean,
  p_terms uuid)
RETURNS TABLE (operation_id uuid, outcome text, reserved_micros bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  actor uuid := public.leads_rls_staff_user_id();
  t "AiTaskSetting";
  m "AiModel";
  pr "AiModelPrice";
  s "AiSettings";
  existing "AiOperation";
  amount bigint;
  n_active integer;
  b record;
  lim bigint;
  ps timestamptz;
  op uuid := gen_random_uuid();
  daily_ok boolean := false;
  monthly_ok boolean := false;
  budgets uuid[] := '{}';
  periods timestamptz[] := '{}';
  i integer;
BEGIN
  IF p_est_input IS NULL OR p_est_output IS NULL OR p_est_input < 0 OR p_est_output < 0
     OR p_idempotency IS NULL OR char_length(p_idempotency) NOT BETWEEN 8 AND 100
     OR p_input_digest !~ '^[0-9a-f]{64}$' OR p_instance IS NULL OR char_length(p_instance) > 64
     OR p_personal IS NULL OR (NOT p_personal AND p_terms IS NOT NULL) THEN
    RETURN QUERY SELECT NULL::uuid, 'invalid'::text, NULL::bigint; RETURN;
  END IF;
  -- The switch first (held to COMMIT), then the caller's right (AI on + ai:invoke).
  IF NOT public.platform_module_hold_enabled('ai') THEN
    RETURN QUERY SELECT NULL::uuid, 'ai_disabled'::text, NULL::bigint; RETURN;
  END IF;
  IF actor IS NULL OR NOT public.ai_rls_staff_allows('ai:invoke') THEN
    RETURN QUERY SELECT NULL::uuid, 'not_allowed'::text, NULL::bigint; RETURN;
  END IF;
  -- DP-307: the terms gate after the switch, before the serialisation point (held to COMMIT).
  IF p_personal THEN
    IF p_terms IS NULL OR NOT EXISTS (SELECT 1 FROM "AiProviderDataTerms" x WHERE x."id" = p_terms) THEN
      RETURN QUERY SELECT NULL::uuid, 'provider_terms_missing'::text, NULL::bigint; RETURN;
    END IF;
    IF NOT public.ai_terms_hold_valid(p_terms) THEN
      RETURN QUERY SELECT NULL::uuid, 'provider_terms_revoked'::text, NULL::bigint; RETURN;
    END IF;
  END IF;
  -- Serialisation point: concurrent reservations queue here.
  SELECT * INTO s FROM "AiSettings" WHERE "id" = 1 FOR UPDATE;
  SELECT * INTO existing FROM "AiOperation"
   WHERE "actorUserId" = actor AND "idempotencyKey" = p_idempotency;
  IF FOUND THEN
    IF existing."inputDigest" <> p_input_digest OR existing."task" <> p_task
       OR existing."siteId" IS DISTINCT FROM p_site
       OR existing."personalData" <> p_personal
       OR existing."dataTermsId" IS DISTINCT FROM p_terms THEN
      RETURN QUERY SELECT existing."id", 'idempotency_conflict'::text, existing."reservedMicros"; RETURN;
    END IF;
    RETURN QUERY SELECT existing."id", 'existing'::text, existing."reservedMicros"; RETURN;
  END IF;
  SELECT * INTO t FROM "AiTaskSetting" WHERE "task" = p_task;
  IF NOT FOUND OR NOT t."enabled" OR t."modelId" IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'task_disabled'::text, NULL::bigint; RETURN;
  END IF;
  SELECT * INTO m FROM "AiModel" WHERE "id" = t."modelId";
  IF m."status" <> 'ENABLED' OR NOT m."compatible" THEN
    RETURN QUERY SELECT NULL::uuid, 'model_not_enabled'::text, NULL::bigint; RETURN;
  END IF;
  -- DP-307: the record must be the terms of the provider that will receive the data.
  IF p_personal AND NOT EXISTS (SELECT 1 FROM "AiProviderDataTerms" x
                                 WHERE x."id" = p_terms AND x."provider" = m."provider") THEN
    RETURN QUERY SELECT NULL::uuid, 'provider_terms_missing'::text, NULL::bigint; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "AiProviderSetting" WHERE "provider" = m."provider" AND "enabled") THEN
    RETURN QUERY SELECT NULL::uuid, 'provider_disabled'::text, NULL::bigint; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "AiProviderCredential" WHERE "provider" = m."provider" AND "status" = 'ACTIVE') THEN
    RETURN QUERY SELECT NULL::uuid, 'no_active_credential'::text, NULL::bigint; RETURN;
  END IF;
  SELECT * INTO pr FROM "AiModelPrice" WHERE "modelId" = m."id" AND "effectiveFrom" <= now()
   ORDER BY "effectiveFrom" DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, 'price_missing'::text, NULL::bigint; RETURN;
  END IF;
  IF p_est_input > t."maxInputTokens" THEN
    RETURN QUERY SELECT NULL::uuid, 'input_too_large'::text, NULL::bigint; RETURN;
  END IF;
  IF p_est_output > t."maxOutputTokens" + t."thinkingBudget" THEN
    RETURN QUERY SELECT NULL::uuid, 'output_too_large'::text, NULL::bigint; RETURN;
  END IF;
  amount := public.ai_upper_cost_micros(pr."id", p_est_input, p_est_output, s."safetyMarginPct");
  IF amount IS NULL OR amount > t."maxCostPerOpMicros" THEN
    RETURN QUERY SELECT NULL::uuid, 'op_cost_limit'::text, amount; RETURN;
  END IF;
  SELECT count(*) INTO n_active FROM "AiOperation"
   WHERE "status" IN ('RESERVED', 'IN_FLIGHT') AND "leaseUntil" > now();
  IF n_active >= s."maxConcurrency" THEN
    RETURN QUERY SELECT NULL::uuid, 'concurrency_limit'::text, amount; RETURN;
  END IF;
  -- Both platform budgets must exist; the site's budgets apply when the operation has a site.
  FOR b IN SELECT * FROM "AiBudget" WHERE "active"
             AND ("scope" = 'PLATFORM' OR ("scope" = 'SITE' AND "siteId" = p_site)) LOOP
    IF b."scope" = 'PLATFORM' AND b."period" = 'DAILY' THEN daily_ok := true; END IF;
    IF b."scope" = 'PLATFORM' AND b."period" = 'MONTHLY' THEN monthly_ok := true; END IF;
  END LOOP;
  IF NOT (daily_ok AND monthly_ok) THEN
    RETURN QUERY SELECT NULL::uuid, 'budget_missing'::text, amount; RETURN;
  END IF;
  -- Every budget first (in id order, no deadlock between reservations): if one has no room, the
  -- sub-block is rolled back and no counter changes.
  BEGIN
    FOR b IN SELECT * FROM "AiBudget" WHERE "active"
               AND ("scope" = 'PLATFORM' OR ("scope" = 'SITE' AND "siteId" = p_site))
             ORDER BY "id" LOOP
      ps := public.ai_period_start(b."period", now());
      lim := CASE b."period" WHEN 'DAILY' THEN least(b."limitMicros", coalesce(p_cap_daily, b."limitMicros"))
                             ELSE least(b."limitMicros", coalesce(p_cap_monthly, b."limitMicros")) END;
      INSERT INTO "AiBudgetUsage" ("budgetId", "periodStart") VALUES (b."id", ps)
        ON CONFLICT ("budgetId", "periodStart") DO NOTHING;
      UPDATE "AiBudgetUsage" u SET "reservedMicros" = u."reservedMicros" + amount
       WHERE u."budgetId" = b."id" AND u."periodStart" = ps
         AND u."reservedMicros" + u."committedMicros" + u."assumedMicros" + amount <= lim;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ai: budget exceeded' USING ERRCODE = 'P0420';
      END IF;
      budgets := budgets || b."id";
      periods := periods || ps;
    END LOOP;
  EXCEPTION WHEN SQLSTATE 'P0420' THEN
    RETURN QUERY SELECT NULL::uuid, 'budget_exceeded'::text, amount; RETURN;
  END;
  INSERT INTO "AiOperation" ("id", "task", "siteId", "actorUserId", "provider", "modelId", "priceId",
    "status", "idempotencyKey", "inputDigest", "estInputTokens", "estOutputTokens", "reservedMicros",
    "instanceId", "leaseUntil", "personalData", "dataTermsId")
  VALUES (op, p_task, p_site, actor, m."provider", m."id", pr."id", 'RESERVED', p_idempotency,
          p_input_digest, p_est_input, p_est_output, amount, p_instance,
          now() + make_interval(secs => s."reservationTtlSec"), p_personal, p_terms);
  FOR i IN 1 .. coalesce(array_length(budgets, 1), 0) LOOP
    INSERT INTO "AiLedgerEntry" ("id", "operationId", "budgetId", "periodStart", "kind",
      "deltaReservedMicros")
    VALUES (gen_random_uuid(), op, budgets[i], periods[i], 'RESERVE', amount);
  END LOOP;
  RETURN QUERY SELECT op, 'reserved'::text, amount;
END
$fn$;

-- =============================================================================================
-- Part 4: the worker (DP-297's functions with the terms check)
-- =============================================================================================

-- DP-297's claim; each job also names its terms record (audit). Revoked terms are not filtered
-- here: the job is claimed and refused by ai_dispatch (FAILED, cost 0, provider_terms_revoked).
DROP FUNCTION ai_claim(text, integer, integer);

CREATE FUNCTION ai_claim(p_instance text, p_lease_sec integer, p_limit integer)
RETURNS TABLE (op_id uuid, op_actor uuid, op_task "AiTaskType", op_site uuid, op_payload text,
  op_terms uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  s "AiSettings";
  n_flight integer;
  slots integer;
  r record;
  c text;
BEGIN
  IF p_instance IS NULL OR char_length(p_instance) NOT BETWEEN 1 AND 64
     OR p_lease_sec IS NULL OR p_lease_sec NOT BETWEEN 5 AND 600
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 16 THEN
    RETURN;
  END IF;
  PERFORM public.ai_purge_transient();
  -- Nothing queued: no lock taken (every instance polls).
  IF public.ai_queue_depth() = 0 THEN RETURN; END IF;
  IF NOT public.platform_module_hold_enabled('ai') THEN RETURN; END IF;
  SELECT * INTO s FROM "AiSettings" WHERE "id" = 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*) INTO n_flight FROM "AiOperation" x
   WHERE x."status" = 'IN_FLIGHT' AND x."leaseUntil" > now();
  slots := least(p_limit, s."maxConcurrency" - n_flight);
  IF slots <= 0 THEN RETURN; END IF;
  FOR r IN SELECT o."id", o."actorUserId", o."task", o."siteId", o."dataTermsId" FROM "AiOperation" o
            WHERE o."status" = 'RESERVED' AND o."leaseUntil" > now() AND o."stopRequestedAt" IS NULL
              AND EXISTS (SELECT 1 FROM "AiTransient" t
                           WHERE t."operationId" = o."id" AND t."kind" = 'INPUT'
                             AND t."ciphertext" IS NOT NULL AND t."expiresAt" > now())
            ORDER BY o."reservedAt", o."id"
            LIMIT slots
            FOR UPDATE OF o SKIP LOCKED LOOP
    SELECT t."ciphertext" INTO c FROM "AiTransient" t
     WHERE t."operationId" = r."id" AND t."kind" = 'INPUT' FOR UPDATE;
    CONTINUE WHEN c IS NULL;
    UPDATE "AiTransient" t SET "ciphertext" = NULL, "wipedAt" = now()
     WHERE t."operationId" = r."id" AND t."kind" = 'INPUT';
    UPDATE "AiOperation" o SET "status" = 'IN_FLIGHT', "startedAt" = now(), "instanceId" = p_instance,
           "leaseUntil" = now() + make_interval(secs => p_lease_sec), "updatedAt" = now()
     WHERE o."id" = r."id";
    PERFORM public.ai_move(r."id", 'START', 0, 0, 0);
    op_id := r."id"; op_actor := r."actorUserId"; op_task := r."task"; op_site := r."siteId";
    op_payload := c; op_terms := r."dataTermsId";
    RETURN NEXT;
  END LOOP;
END
$fn$;

-- Outcomes: dispatch | ai_disabled | cancelled | not_in_flight | lease_expired |
-- already_dispatched | provider_terms_revoked | unknown. Lock order: switch → operation → terms.
CREATE OR REPLACE FUNCTION ai_dispatch(p_op uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  o "AiOperation";
  v integer;
BEGIN
  IF NOT public.platform_module_hold_enabled('ai') THEN RETURN 'ai_disabled'; END IF;
  SELECT * INTO o FROM "AiOperation" WHERE "id" = p_op FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF o."status" <> 'IN_FLIGHT' THEN RETURN 'not_in_flight'; END IF;
  IF o."dispatchedAt" IS NOT NULL THEN RETURN 'already_dispatched'; END IF;
  IF o."stopRequestedAt" IS NOT NULL THEN RETURN 'cancelled'; END IF;
  IF o."leaseUntil" <= now() THEN RETURN 'lease_expired'; END IF;
  -- DP-307: the terms gate is held (shared) to COMMIT, i.e. until the request was handed to the
  -- transport; a revocation waits for it, and after the revocation COMMIT this answers revoked.
  IF o."personalData" AND NOT public.ai_terms_hold_valid(o."dataTermsId") THEN
    RETURN 'provider_terms_revoked';
  END IF;
  -- The state row is held FOR SHARE by platform_module_hold_enabled: this is the version in force
  -- until this transaction ends, and a switch-off cannot commit before it does.
  SELECT s."version" INTO v FROM "PlatformModuleState" s WHERE s."moduleKey" = 'ai';
  UPDATE "AiOperation" SET "dispatchedAt" = clock_timestamp(), "dispatchSwitchVersion" = v,
         "updatedAt" = now()
   WHERE "id" = p_op;
  RETURN 'dispatch';
END
$fn$;

-- Outcomes: ok | provider_terms_revoked | unknown. For the settlement transaction (whileEnabled):
-- holds the operation row, then the terms gate, until COMMIT.
CREATE FUNCTION ai_terms_hold(p_op uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  o "AiOperation";
BEGIN
  SELECT * INTO o FROM "AiOperation" WHERE "id" = p_op FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF o."personalData" AND NOT public.ai_terms_hold_valid(o."dataTermsId") THEN
    RETURN 'provider_terms_revoked';
  END IF;
  RETURN 'ok';
END
$fn$;

-- Reasons: ai_disabled | cancelled | provider_terms_revoked | not_in_flight | lease_expired.
CREATE OR REPLACE FUNCTION ai_stop_signals(p_ops uuid[])
RETURNS TABLE (op_id uuid, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT x.id, x.reason FROM (
    SELECT o."id" AS id,
           CASE WHEN NOT public.platform_module_enabled('ai') THEN 'ai_disabled'
                WHEN o."stopRequestedAt" IS NOT NULL THEN 'cancelled'
                WHEN o."personalData" AND NOT EXISTS (
                  SELECT 1 FROM "AiProviderDataTerms" t
                   WHERE t."id" = o."dataTermsId" AND t."revokedAt" IS NULL)
                  THEN 'provider_terms_revoked'
                WHEN o."status" <> 'IN_FLIGHT' THEN 'not_in_flight'
                WHEN o."leaseUntil" <= now() THEN 'lease_expired' END AS reason
      FROM "AiOperation" o
     WHERE o."id" = ANY (coalesce(p_ops, '{}'::uuid[]))) x
   WHERE x.reason IS NOT NULL
$fn$;

-- DP-297's store, and never under revoked terms (switch → operation → terms, held to COMMIT).
CREATE OR REPLACE FUNCTION ai_store_result(p_op uuid, p_ciphertext text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  o "AiOperation";
BEGIN
  IF p_ciphertext IS NULL OR char_length(p_ciphertext) NOT BETWEEN 1 AND 200000 THEN
    RETURN 'invalid';
  END IF;
  IF NOT public.platform_module_hold_enabled('ai') THEN RETURN 'refused'; END IF;
  SELECT * INTO o FROM "AiOperation" WHERE "id" = p_op FOR UPDATE;
  IF NOT FOUND OR o."status" <> 'SUCCEEDED' OR o."stopRequestedAt" IS NOT NULL THEN
    RETURN 'refused';
  END IF;
  IF o."personalData" AND NOT public.ai_terms_hold_valid(o."dataTermsId") THEN
    RETURN 'refused';
  END IF;
  INSERT INTO "AiTransient" ("operationId", "kind", "ciphertext", "createdAt", "expiresAt")
  VALUES (p_op, 'RESULT', p_ciphertext, now(), now() + interval '15 minutes')
  ON CONFLICT ("operationId", "kind") DO NOTHING;
  IF NOT FOUND THEN RETURN 'refused'; END IF;
  RETURN 'stored';
END
$fn$;

-- DP-297's call plan, and none under revoked terms.
CREATE OR REPLACE FUNCTION ai_call_plan(p_op uuid)
RETURNS TABLE (provider "AiProvider", provider_model_id text, credential_id uuid, project_ref text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT o."provider", m."modelId"::text, c."id", c."projectRef"::text
    FROM "AiOperation" o
    JOIN "AiModel" m ON m."id" = o."modelId"
    JOIN "AiProviderCredential" c ON c."provider" = o."provider" AND c."status" = 'ACTIVE'
   WHERE o."id" = p_op AND o."status" = 'IN_FLIGHT' AND o."stopRequestedAt" IS NULL
     AND public.platform_module_enabled('ai')
     AND (NOT o."personalData" OR EXISTS (
           SELECT 1 FROM "AiProviderDataTerms" t
            WHERE t."id" = o."dataTermsId" AND t."revokedAt" IS NULL))
$fn$;

-- =============================================================================================
-- Part 5: privileges
-- =============================================================================================

REVOKE ALL ON FUNCTION ai_terms_hold_valid(uuid), ai_provider_terms_lock("AiProvider"),
  ai_reserve("AiTaskType", uuid, text, text, integer, integer, text, bigint, bigint, boolean, uuid),
  ai_claim(text, integer, integer), ai_terms_hold(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_provider_terms_lock("AiProvider"),
  ai_reserve("AiTaskType", uuid, text, text, integer, integer, text, bigint, bigint, boolean, uuid),
  ai_claim(text, integer, integer), ai_terms_hold(uuid)
  TO dp_app;
