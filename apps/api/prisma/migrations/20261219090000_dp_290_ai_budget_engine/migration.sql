-- DP-290 (ADR-030 D6, D7): the budget and reservation engine, in the database.
--
-- Runs as dp_owner (ADR-012A). Additive: functions only (plus one index); no table, column or row
-- changes. The API's role (dp_app) still cannot write "AiOperation", "AiBudgetUsage" or
-- "AiLedgerEntry" (migration dp_288); these SECURITY DEFINER functions are the only write path,
-- so every money movement is one of the transitions below and lands in the ledger.
--
--   ai_reserve(...)        one atomic reservation: AI switch held (FOR SHARE + shared advisory
--                          lock, DP-287), the caller may use ai:invoke (staff context), idempotent
--                          per (actor, idempotency key), task/model/provider/key/price usable,
--                          token and per-operation cost limits, concurrency limit, and EVERY
--                          applicable budget (platform daily + monthly, the site's daily/monthly)
--                          with `reserved + committed + assumed + amount <= limit` (local ceiling
--                          applied). AiSettings is locked FOR UPDATE: concurrent reservations
--                          queue, so they can never exceed a limit together. The amount is
--                          computed HERE from the pinned price (ai_upper_cost_micros): the caller
--                          gives token upper bounds only.
--   ai_start(op, …)        RESERVED → IN_FLIGHT while AI is on (a provider call may start only
--                          after this COMMIT); idempotent.
--   ai_settle(op, usage…)  IN_FLIGHT (or UNKNOWN, a late answer) → SUCCEEDED / FAILED / DISCARDED:
--                          actual cost from the pinned price (ai_actual_cost_micros), reserved (or
--                          assumed) released, actual committed; an overrun is recorded, never
--                          hidden; idempotent.
--   ai_release(op, why)    RESERVED → CANCELLED / RELEASED (no call was made): money back;
--                          idempotent.
--   ai_mark_unknown(op, …) IN_FLIGHT → UNKNOWN (outcome unknown: timeout, lost connection,
--                          switch-off): the reserved amount is counted as spent ("assumed");
--                          idempotent; never retried.
--   ai_sweep()             expired RESERVED → RELEASED, expired IN_FLIGHT → UNKNOWN; while AI is
--                          off every RESERVED → CANCELLED. Crash recovery = lease expiry.
--   ai_ledger_mismatches() usage counters that differ from the ledger sums (should be none).
--
-- Money is integer micro-USD; prices are micro-USD per 1 000 000 tokens; budget periods are UTC.
-- No function takes or stores a prompt or response text (digest, counts, codes only).
-- Tested in test/integration/owner.int.test.ts (DP-290 block) and db-roles.int.test.ts.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ai_rls_staff_allows') THEN
    RAISE EXCEPTION 'DP-290: migration 20261217090000_dp_288_ai_data_model must be applied first';
  END IF;
END $$;

CREATE INDEX "AiLedgerEntry_operationId_kind_idx" ON "AiLedgerEntry" ("operationId", "kind");

-- =============================================================================================
-- Part 1: cost (mirrored in src/ai/engine/estimate.ts; a parity test keeps them equal)
-- =============================================================================================

-- Start of the UTC day or month of a timestamp.
CREATE FUNCTION ai_period_start(p_period "AiBudgetPeriod", p_at timestamptz) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT date_trunc(CASE p_period WHEN 'DAILY' THEN 'day' ELSE 'month' END, p_at AT TIME ZONE 'UTC')
         AT TIME ZONE 'UTC'
$fn$;

-- Upper bound of an operation before it runs: every input token at the highest input-side price
-- (input, cached read, cache write), the long-context tier chosen from the input upper bound,
-- all output tokens (reasoning/thinking included) at the output price, the per-request fee, then
-- the safety margin. Rounded up.
CREATE FUNCTION ai_upper_cost_micros(p_price uuid, p_input bigint, p_output bigint, p_margin_pct int)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  p "AiModelPrice";
  long boolean;
  in_price bigint;
  out_price bigint;
  base numeric;
BEGIN
  SELECT * INTO p FROM "AiModelPrice" WHERE "id" = p_price;
  IF NOT FOUND OR p_input < 0 OR p_output < 0 OR p_margin_pct < 0 THEN RETURN NULL; END IF;
  long := p."longContextThreshold" IS NOT NULL AND p_input > p."longContextThreshold";
  in_price := greatest(CASE WHEN long THEN p."longInputMicrosPerMTok" ELSE p."inputMicrosPerMTok" END,
                       p."cachedReadMicrosPerMTok", coalesce(p."cacheWriteMicrosPerMTok", 0));
  out_price := CASE WHEN long THEN p."longOutputMicrosPerMTok" ELSE p."outputMicrosPerMTok" END;
  base := ceil((p_input::numeric * in_price + p_output::numeric * out_price) / 1000000)
          + p."perRequestFeeMicros";
  RETURN ceil(base * (100 + p_margin_pct) / 100)::bigint;
END
$fn$;

-- The cost of what the provider reported: uncached input, cached reads, cache writes and output
-- (reasoning/thinking included in output), the tier chosen from all prompt tokens. Rounded up.
CREATE FUNCTION ai_actual_cost_micros(p_price uuid, p_input bigint, p_cached bigint,
  p_cache_write bigint, p_output bigint)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  p "AiModelPrice";
  long boolean;
  in_price bigint;
  out_price bigint;
BEGIN
  SELECT * INTO p FROM "AiModelPrice" WHERE "id" = p_price;
  IF NOT FOUND OR least(p_input, p_cached, p_cache_write, p_output) < 0 THEN RETURN NULL; END IF;
  long := p."longContextThreshold" IS NOT NULL
          AND p_input + p_cached + p_cache_write > p."longContextThreshold";
  in_price := CASE WHEN long THEN p."longInputMicrosPerMTok" ELSE p."inputMicrosPerMTok" END;
  out_price := CASE WHEN long THEN p."longOutputMicrosPerMTok" ELSE p."outputMicrosPerMTok" END;
  RETURN (ceil((p_input::numeric * in_price
                + p_cached::numeric * p."cachedReadMicrosPerMTok"
                + p_cache_write::numeric * coalesce(p."cacheWriteMicrosPerMTok", in_price)
                + p_output::numeric * out_price) / 1000000)
          + p."perRequestFeeMicros")::bigint;
END
$fn$;

-- =============================================================================================
-- Part 2: moving money between the counters (internal; only the functions below call it)
-- =============================================================================================

-- Applies the same deltas to every budget period the operation reserved on, with one ledger row
-- each. The CHECKs of "AiBudgetUsage" refuse a negative counter.
CREATE FUNCTION ai_move(p_op uuid, p_kind "AiLedgerKind", p_reserved bigint, p_committed bigint,
  p_assumed bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT e."budgetId", e."periodStart" FROM "AiLedgerEntry" e
           WHERE e."operationId" = p_op AND e."kind" = 'RESERVE' ORDER BY e."budgetId" LOOP
    UPDATE "AiBudgetUsage" u
       SET "reservedMicros" = u."reservedMicros" + p_reserved,
           "committedMicros" = u."committedMicros" + p_committed,
           "assumedMicros" = u."assumedMicros" + p_assumed
     WHERE u."budgetId" = r."budgetId" AND u."periodStart" = r."periodStart";
    INSERT INTO "AiLedgerEntry" ("id", "operationId", "budgetId", "periodStart", "kind",
      "deltaReservedMicros", "deltaCommittedMicros", "deltaAssumedMicros")
    VALUES (gen_random_uuid(), p_op, r."budgetId", r."periodStart", p_kind, p_reserved,
            p_committed, p_assumed);
  END LOOP;
END
$fn$;

-- =============================================================================================
-- Part 3: the transitions
-- =============================================================================================

-- Outcomes: reserved | existing | not_allowed | ai_disabled | idempotency_conflict |
-- task_disabled | model_not_enabled | provider_disabled | no_active_credential | price_missing |
-- input_too_large | output_too_large | op_cost_limit | concurrency_limit | budget_missing |
-- budget_exceeded | invalid.
CREATE FUNCTION ai_reserve(
  p_task "AiTaskType",
  p_site uuid,
  p_idempotency text,
  p_input_digest text,
  p_est_input integer,
  p_est_output integer,
  p_instance text,
  p_cap_daily bigint,
  p_cap_monthly bigint)
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
     OR p_input_digest !~ '^[0-9a-f]{64}$' OR p_instance IS NULL OR char_length(p_instance) > 64 THEN
    RETURN QUERY SELECT NULL::uuid, 'invalid'::text, NULL::bigint; RETURN;
  END IF;
  -- The switch first (held to COMMIT), then the caller's right (AI on + ai:invoke).
  IF NOT public.platform_module_hold_enabled('ai') THEN
    RETURN QUERY SELECT NULL::uuid, 'ai_disabled'::text, NULL::bigint; RETURN;
  END IF;
  IF actor IS NULL OR NOT public.ai_rls_staff_allows('ai:invoke') THEN
    RETURN QUERY SELECT NULL::uuid, 'not_allowed'::text, NULL::bigint; RETURN;
  END IF;
  -- Serialisation point: concurrent reservations queue here.
  SELECT * INTO s FROM "AiSettings" WHERE "id" = 1 FOR UPDATE;
  SELECT * INTO existing FROM "AiOperation"
   WHERE "actorUserId" = actor AND "idempotencyKey" = p_idempotency;
  IF FOUND THEN
    IF existing."inputDigest" <> p_input_digest OR existing."task" <> p_task
       OR existing."siteId" IS DISTINCT FROM p_site THEN
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
    "instanceId", "leaseUntil")
  VALUES (op, p_task, p_site, actor, m."provider", m."id", pr."id", 'RESERVED', p_idempotency,
          p_input_digest, p_est_input, p_est_output, amount, p_instance,
          now() + make_interval(secs => s."reservationTtlSec"));
  FOR i IN 1 .. coalesce(array_length(budgets, 1), 0) LOOP
    INSERT INTO "AiLedgerEntry" ("id", "operationId", "budgetId", "periodStart", "kind",
      "deltaReservedMicros")
    VALUES (gen_random_uuid(), op, budgets[i], periods[i], 'RESERVE', amount);
  END LOOP;
  RETURN QUERY SELECT op, 'reserved'::text, amount;
END
$fn$;

-- Outcomes: started | already_started | ai_disabled | not_reserved | expired | unknown.
CREATE FUNCTION ai_start(p_op uuid, p_instance text, p_lease_sec integer) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  o "AiOperation";
BEGIN
  IF NOT public.platform_module_hold_enabled('ai') THEN RETURN 'ai_disabled'; END IF;
  SELECT * INTO o FROM "AiOperation" WHERE "id" = p_op FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF o."status" = 'IN_FLIGHT' THEN RETURN 'already_started'; END IF;
  IF o."status" <> 'RESERVED' THEN RETURN 'not_reserved'; END IF;
  IF o."leaseUntil" <= now() THEN RETURN 'expired'; END IF;
  IF p_lease_sec NOT BETWEEN 5 AND 600 THEN RETURN 'unknown'; END IF;
  UPDATE "AiOperation" SET "status" = 'IN_FLIGHT', "startedAt" = now(), "instanceId" = p_instance,
         "leaseUntil" = now() + make_interval(secs => p_lease_sec), "updatedAt" = now()
   WHERE "id" = p_op;
  PERFORM public.ai_move(p_op, 'START', 0, 0, 0);
  RETURN 'started';
END
$fn$;

-- Outcomes: settled | settled_overrun | already_settled | not_in_flight | unknown | invalid.
-- p_status: SUCCEEDED, FAILED (provider error; usage may be zero) or DISCARDED (answer after a
-- switch-off: cost settled, output never delivered). From UNKNOWN (a late answer) the assumed
-- amount is released instead of the reserved one, and the status is DISCARDED.
CREATE FUNCTION ai_settle(p_op uuid, p_status "AiOperationStatus", p_input integer, p_cached integer,
  p_cache_write integer, p_output integer, p_reasoning integer, p_provider_request text,
  p_error_code text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  o "AiOperation";
  actual bigint;
  late boolean;
BEGIN
  IF p_status NOT IN ('SUCCEEDED', 'FAILED', 'DISCARDED')
     OR least(p_input, p_cached, p_cache_write, p_output, p_reasoning) < 0
     OR char_length(coalesce(p_error_code, '')) > 40 OR char_length(coalesce(p_provider_request, '')) > 200 THEN
    RETURN 'invalid';
  END IF;
  SELECT * INTO o FROM "AiOperation" WHERE "id" = p_op FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF o."status" IN ('SUCCEEDED', 'FAILED', 'DISCARDED') THEN RETURN 'already_settled'; END IF;
  IF o."status" NOT IN ('IN_FLIGHT', 'UNKNOWN') THEN RETURN 'not_in_flight'; END IF;
  late := o."status" = 'UNKNOWN';
  actual := public.ai_actual_cost_micros(o."priceId", p_input, p_cached, p_cache_write, p_output);
  IF late THEN
    PERFORM public.ai_move(p_op, 'ADJUST', 0, actual, -o."reservedMicros");
  ELSE
    PERFORM public.ai_move(p_op, 'SETTLE', -o."reservedMicros", actual, 0);
  END IF;
  IF actual > o."reservedMicros" THEN
    PERFORM public.ai_move(p_op, 'OVERRUN', 0, 0, 0);
  END IF;
  UPDATE "AiOperation"
     SET "status" = CASE WHEN late THEN 'DISCARDED' ELSE p_status END,
         "actInputTokens" = p_input, "actCachedReadTokens" = p_cached,
         "actCacheWriteTokens" = p_cache_write, "actOutputTokens" = p_output,
         "actReasoningTokens" = p_reasoning, "actualMicros" = actual, "costBasis" = 'LOCAL_USAGE',
         "providerRequestId" = p_provider_request,
         "errorCode" = CASE WHEN actual > o."reservedMicros" THEN 'overrun' ELSE p_error_code END,
         "finishedAt" = now(), "updatedAt" = now()
   WHERE "id" = p_op;
  RETURN CASE WHEN actual > o."reservedMicros" THEN 'settled_overrun' ELSE 'settled' END;
END
$fn$;

-- Outcomes: released | already_released | in_flight | settled | unknown.
-- p_reason: 'cancel' (user or switch-off → CANCELLED, ledger CANCEL), 'release' (no call made →
-- RELEASED, ledger RELEASE) or 'expire' (lease over → EXPIRED, ledger EXPIRE).
CREATE FUNCTION ai_release(p_op uuid, p_reason text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  o "AiOperation";
BEGIN
  IF p_reason NOT IN ('cancel', 'release', 'expire') THEN RETURN 'unknown'; END IF;
  SELECT * INTO o FROM "AiOperation" WHERE "id" = p_op FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF o."status" IN ('CANCELLED', 'RELEASED', 'EXPIRED') THEN RETURN 'already_released'; END IF;
  IF o."status" = 'IN_FLIGHT' THEN RETURN 'in_flight'; END IF;
  IF o."status" <> 'RESERVED' THEN RETURN 'settled'; END IF;
  PERFORM public.ai_move(p_op, CASE p_reason WHEN 'cancel' THEN 'CANCEL' WHEN 'expire' THEN 'EXPIRE'
                                ELSE 'RELEASE' END::"AiLedgerKind", -o."reservedMicros", 0, 0);
  UPDATE "AiOperation"
     SET "status" = CASE p_reason WHEN 'cancel' THEN 'CANCELLED' WHEN 'expire' THEN 'EXPIRED'
                    ELSE 'RELEASED' END::"AiOperationStatus",
         "errorCode" = p_reason, "finishedAt" = now(), "updatedAt" = now()
   WHERE "id" = p_op;
  RETURN 'released';
END
$fn$;

-- Outcomes: assumed | already_unknown | not_in_flight | unknown.
CREATE FUNCTION ai_mark_unknown(p_op uuid, p_code text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  o "AiOperation";
BEGIN
  SELECT * INTO o FROM "AiOperation" WHERE "id" = p_op FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF o."status" = 'UNKNOWN' THEN RETURN 'already_unknown'; END IF;
  IF o."status" <> 'IN_FLIGHT' THEN RETURN 'not_in_flight'; END IF;
  -- The provider may have billed it: the reserved amount counts as spent until reconciled.
  PERFORM public.ai_move(p_op, 'ASSUME_SPENT', -o."reservedMicros", 0, o."reservedMicros");
  UPDATE "AiOperation"
     SET "status" = 'UNKNOWN', "actualMicros" = o."reservedMicros", "costBasis" = 'ASSUMED',
         "errorCode" = left(coalesce(p_code, 'unknown'), 40), "finishedAt" = now(), "updatedAt" = now()
   WHERE "id" = p_op;
  RETURN 'assumed';
END
$fn$;

-- Expired leases and the switch-off. Runs without a staff context (the sweeper of the API).
CREATE FUNCTION ai_sweep() RETURNS TABLE (released integer, assumed integer, cancelled integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  r record;
  n_released integer := 0;
  n_assumed integer := 0;
  n_cancelled integer := 0;
  off boolean := NOT public.platform_module_enabled('ai');
BEGIN
  FOR r IN SELECT "id", "status", "leaseUntil" FROM "AiOperation"
            WHERE "status" IN ('RESERVED', 'IN_FLIGHT') ORDER BY "id" LOOP
    IF r."status" = 'RESERVED' AND off THEN
      IF public.ai_release(r."id", 'cancel') = 'released' THEN n_cancelled := n_cancelled + 1; END IF;
    ELSIF r."status" = 'RESERVED' AND r."leaseUntil" <= now() THEN
      IF public.ai_release(r."id", 'expire') = 'released' THEN n_released := n_released + 1; END IF;
    ELSIF r."status" = 'IN_FLIGHT' AND r."leaseUntil" <= now() THEN
      IF public.ai_mark_unknown(r."id", 'lease_expired') = 'assumed' THEN n_assumed := n_assumed + 1; END IF;
    END IF;
  END LOOP;
  RETURN QUERY SELECT n_released, n_assumed, n_cancelled;
END
$fn$;

-- Usage rows whose counters differ from the sum of their ledger rows (none, if all is well).
CREATE FUNCTION ai_ledger_mismatches() RETURNS TABLE (budget_id uuid, period_start timestamptz,
  reserved_diff bigint, committed_diff bigint, assumed_diff bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT u."budgetId", u."periodStart",
         u."reservedMicros" - coalesce(sum(e."deltaReservedMicros"), 0),
         u."committedMicros" - coalesce(sum(e."deltaCommittedMicros"), 0),
         u."assumedMicros" - coalesce(sum(e."deltaAssumedMicros"), 0)
  FROM "AiBudgetUsage" u
  LEFT JOIN "AiLedgerEntry" e ON e."budgetId" = u."budgetId" AND e."periodStart" = u."periodStart"
  GROUP BY u."budgetId", u."periodStart", u."reservedMicros", u."committedMicros", u."assumedMicros"
  HAVING u."reservedMicros" <> coalesce(sum(e."deltaReservedMicros"), 0)
      OR u."committedMicros" <> coalesce(sum(e."deltaCommittedMicros"), 0)
      OR u."assumedMicros" <> coalesce(sum(e."deltaAssumedMicros"), 0)
$fn$;

-- =============================================================================================
-- Part 4: privileges
-- =============================================================================================

REVOKE ALL ON FUNCTION ai_period_start("AiBudgetPeriod", timestamptz),
  ai_upper_cost_micros(uuid, bigint, bigint, integer),
  ai_actual_cost_micros(uuid, bigint, bigint, bigint, bigint),
  ai_move(uuid, "AiLedgerKind", bigint, bigint, bigint),
  ai_reserve("AiTaskType", uuid, text, text, integer, integer, text, bigint, bigint),
  ai_start(uuid, text, integer),
  ai_settle(uuid, "AiOperationStatus", integer, integer, integer, integer, integer, text, text),
  ai_release(uuid, text), ai_mark_unknown(uuid, text), ai_sweep(), ai_ledger_mismatches()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_period_start("AiBudgetPeriod", timestamptz),
  ai_upper_cost_micros(uuid, bigint, bigint, integer),
  ai_actual_cost_micros(uuid, bigint, bigint, bigint, bigint),
  ai_reserve("AiTaskType", uuid, text, text, integer, integer, text, bigint, bigint),
  ai_start(uuid, text, integer),
  ai_settle(uuid, "AiOperationStatus", integer, integer, integer, integer, integer, text, text),
  ai_release(uuid, text), ai_mark_unknown(uuid, text), ai_sweep(), ai_ledger_mismatches()
  TO dp_app;
