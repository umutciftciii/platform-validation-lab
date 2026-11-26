-- DP-297 (ADR-030 D10): the AI queue and the draft answers leave the API process. The queue is the
-- database: a RESERVED operation with its encrypted input is a job; any API instance's worker
-- claims it atomically (row lock, SKIP LOCKED) together with the RESERVED → IN_FLIGHT transition.
-- The input and the answer are held encrypted (AES-256-GCM in the API; the key is never in the
-- database) for at most 15 minutes in an UNLOGGED table: no WAL, so never in a WAL archive or a
-- replica, emptied by PostgreSQL after a crash, and left out of the dumps of local-mode.sh
-- (--no-unlogged-table-data). Prompts and answers are never written to a permanent table.
--
--  * "AiTransient": one INPUT and at most one RESULT per operation. Expired, consumed, cancelled
--    and switched-off entries are WIPED (ciphertext set to NULL), never handed out again; the row
--    keeps only ids and times. Readers check the expiry themselves, so the 15 minutes hold even
--    before a wipe ran.
--  * "AiOperation"."stopRequestedAt": the actor's cancel of a running call, seen by the instance
--    that runs it (ai_stop_signals), whichever instance received the cancel.
--  * "AiOperation"."dispatchedAt" / "dispatchSwitchVersion": the ONE permission to send the paid
--    provider request (ai_dispatch), taken in a transaction that holds the AI switch (shared
--    advisory lock + the state row FOR SHARE); the worker invokes the provider request INSIDE that
--    transaction, before COMMIT. The owner's switch-off takes the switch exclusively, so it waits
--    for every such transaction: each provider request is ordered before the switch-off COMMIT,
--    and after it none can start (ai_dispatch then answers ai_disabled). The recorded switch
--    version proves it afterwards: a request that started after a switch-off would carry the
--    off version, which ai_dispatch can never record.
--  * ai_enqueue(op, ciphertext)      staff context, in the reservation's transaction: the input.
--  * ai_claim(instance, lease, n)    worker: holds the AI switch, respects maxConcurrency over all
--                                    instances, claims up to n queued jobs (oldest first), starts
--                                    them, hands out each input once and wipes it.
--  * ai_dispatch(op)                 worker, in its whileEnabled transaction: the permission to
--                                    send the provider request, once per operation.
--  * ai_stop_signals(ops)            worker: which running calls must stop, and why.
--  * ai_request_cancel(op)           staff context, own operation: queued → released (cost 0);
--                                    running → stop requested; any held text wiped.
--  * ai_store_result(op, ct)         worker, in the settlement's whileEnabled transaction.
--  * ai_result_ciphertext(op)        staff context: the encrypted draft, for its own actor only.
--  * ai_queue_depth()                worker/diagnostics: claimable jobs (a count only).
--  * ai_purge_transient()            wipes expired and orphaned entries; everything while AI is off.
--  * ai_sweep()                      as in DP-290, plus the purge.
--  * trigger on "PlatformModuleState": the owner's switch-off of `ai` cancels every queued job and
--    wipes every held text IN THE SAME TRANSACTION, so nothing is left to start or read after it.
--  * ai_call_plan(op)                as in DP-291, and no plan once a stop was requested.

-- =============================================================================================
-- Part 1: tables
-- =============================================================================================

ALTER TABLE "AiOperation" ADD COLUMN "stopRequestedAt" TIMESTAMPTZ(3),
  ADD COLUMN "dispatchedAt" TIMESTAMPTZ(3),
  ADD COLUMN "dispatchSwitchVersion" INTEGER;

ALTER TABLE "AiOperation"
  ADD CONSTRAINT "AiOperation_dispatch" CHECK (("dispatchedAt" IS NULL) = ("dispatchSwitchVersion" IS NULL));

CREATE UNLOGGED TABLE "AiTransient" (
    "operationId" UUID NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "ciphertext" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "wipedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AiTransient_pkey" PRIMARY KEY ("operationId", "kind")
);

CREATE INDEX "AiTransient_live_expiresAt_idx" ON "AiTransient"("expiresAt") WHERE (ciphertext IS NOT NULL);

ALTER TABLE "AiTransient" ADD CONSTRAINT "AiTransient_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "AiOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiTransient"
  ADD CONSTRAINT "AiTransient_kind" CHECK ("kind" IN ('INPUT', 'RESULT')),
  ADD CONSTRAINT "AiTransient_ttl" CHECK ("expiresAt" > "createdAt"
    AND "expiresAt" <= "createdAt" + interval '15 minutes'),
  ADD CONSTRAINT "AiTransient_wiped" CHECK (("ciphertext" IS NULL) = ("wipedAt" IS NOT NULL)),
  ADD CONSTRAINT "AiTransient_size" CHECK (char_length("ciphertext") <= 200000);

-- No direct access for the API role: only the SECURITY DEFINER functions below read or write it.
REVOKE ALL ON TABLE "AiTransient" FROM PUBLIC;
REVOKE ALL ON TABLE "AiTransient" FROM dp_app;
ALTER TABLE "AiTransient" ENABLE ROW LEVEL SECURITY;

-- =============================================================================================
-- Part 2: functions
-- =============================================================================================

-- Outcomes: queued | not_allowed | not_reserved | invalid.
CREATE FUNCTION ai_enqueue(p_op uuid, p_ciphertext text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  actor uuid := public.leads_rls_staff_user_id();
  o "AiOperation";
BEGIN
  IF p_ciphertext IS NULL OR char_length(p_ciphertext) NOT BETWEEN 1 AND 200000 THEN
    RETURN 'invalid';
  END IF;
  IF NOT public.platform_module_hold_enabled('ai') OR actor IS NULL
     OR NOT public.ai_rls_staff_allows('ai:invoke') THEN
    RETURN 'not_allowed';
  END IF;
  SELECT * INTO o FROM "AiOperation" WHERE "id" = p_op FOR UPDATE;
  IF NOT FOUND OR o."actorUserId" IS DISTINCT FROM actor THEN RETURN 'not_allowed'; END IF;
  IF o."status" <> 'RESERVED' OR o."leaseUntil" <= now() THEN RETURN 'not_reserved'; END IF;
  INSERT INTO "AiTransient" ("operationId", "kind", "ciphertext", "createdAt", "expiresAt")
  VALUES (p_op, 'INPUT', p_ciphertext, now(), least(o."leaseUntil", now() + interval '15 minutes'))
  ON CONFLICT ("operationId", "kind") DO NOTHING;
  IF NOT FOUND THEN RETURN 'not_reserved'; END IF;
  RETURN 'queued';
END
$fn$;

-- The jobs this instance may start now. Holds the AI switch (nothing is claimed once the owner's
-- switch-off committed) and AiSettings (the serialisation point of the reservations): never more
-- calls IN_FLIGHT on all instances together than maxConcurrency.
CREATE FUNCTION ai_claim(p_instance text, p_lease_sec integer, p_limit integer)
RETURNS TABLE (op_id uuid, op_actor uuid, op_task "AiTaskType", op_site uuid, op_payload text)
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
  FOR r IN SELECT o."id", o."actorUserId", o."task", o."siteId" FROM "AiOperation" o
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
    op_payload := c;
    RETURN NEXT;
  END LOOP;
END
$fn$;

-- Outcomes: dispatch | ai_disabled | cancelled | not_in_flight | lease_expired |
-- already_dispatched | unknown. Must run in the transaction that sends the request (whileEnabled):
-- platform_module_hold_enabled keeps the switch until that transaction ends.
CREATE FUNCTION ai_dispatch(p_op uuid) RETURNS text
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
  -- The state row is held FOR SHARE by platform_module_hold_enabled: this is the version in force
  -- until this transaction ends, and a switch-off cannot commit before it does.
  SELECT s."version" INTO v FROM "PlatformModuleState" s WHERE s."moduleKey" = 'ai';
  UPDATE "AiOperation" SET "dispatchedAt" = clock_timestamp(), "dispatchSwitchVersion" = v,
         "updatedAt" = now()
   WHERE "id" = p_op;
  RETURN 'dispatch';
END
$fn$;

-- Reasons: ai_disabled | cancelled | not_in_flight | lease_expired. Ids and codes only.
CREATE FUNCTION ai_stop_signals(p_ops uuid[])
RETURNS TABLE (op_id uuid, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT x.id, x.reason FROM (
    SELECT o."id" AS id,
           CASE WHEN NOT public.platform_module_enabled('ai') THEN 'ai_disabled'
                WHEN o."stopRequestedAt" IS NOT NULL THEN 'cancelled'
                WHEN o."status" <> 'IN_FLIGHT' THEN 'not_in_flight'
                WHEN o."leaseUntil" <= now() THEN 'lease_expired' END AS reason
      FROM "AiOperation" o
     WHERE o."id" = ANY (coalesce(p_ops, '{}'::uuid[]))) x
   WHERE x.reason IS NOT NULL
$fn$;

-- Outcomes: queued (released, cost 0) | running (stop requested) | none (already over) |
-- not_found (not the caller's, or no ai:invoke). Every held text of the operation is wiped.
CREATE FUNCTION ai_request_cancel(p_op uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  actor uuid := public.leads_rls_staff_user_id();
  o "AiOperation";
BEGIN
  IF actor IS NULL OR NOT public.ai_rls_staff_allows('ai:invoke') THEN RETURN 'not_found'; END IF;
  SELECT * INTO o FROM "AiOperation" WHERE "id" = p_op FOR UPDATE;
  IF NOT FOUND OR o."actorUserId" IS DISTINCT FROM actor THEN RETURN 'not_found'; END IF;
  UPDATE "AiTransient" t SET "ciphertext" = NULL, "wipedAt" = now()
   WHERE t."operationId" = p_op AND t."ciphertext" IS NOT NULL;
  IF o."status" = 'RESERVED' THEN
    PERFORM public.ai_release(p_op, 'cancel');
    RETURN 'queued';
  END IF;
  IF o."status" = 'IN_FLIGHT' THEN
    UPDATE "AiOperation" SET "stopRequestedAt" = coalesce("stopRequestedAt", now()), "updatedAt" = now()
     WHERE "id" = p_op;
    RETURN 'running';
  END IF;
  RETURN 'none';
END
$fn$;

-- Outcomes: stored | refused | invalid. Only for a SUCCEEDED operation with no stop requested,
-- while AI is on (held to COMMIT: the caller's settlement runs in whileEnabled('ai')).
CREATE FUNCTION ai_store_result(p_op uuid, p_ciphertext text) RETURNS text
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
  INSERT INTO "AiTransient" ("operationId", "kind", "ciphertext", "createdAt", "expiresAt")
  VALUES (p_op, 'RESULT', p_ciphertext, now(), now() + interval '15 minutes')
  ON CONFLICT ("operationId", "kind") DO NOTHING;
  IF NOT FOUND THEN RETURN 'refused'; END IF;
  RETURN 'stored';
END
$fn$;

CREATE FUNCTION ai_result_ciphertext(p_op uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT t."ciphertext"
    FROM "AiTransient" t JOIN "AiOperation" o ON o."id" = t."operationId"
   WHERE t."operationId" = p_op AND t."kind" = 'RESULT' AND t."ciphertext" IS NOT NULL
     AND t."expiresAt" > now() AND o."status" = 'SUCCEEDED' AND o."stopRequestedAt" IS NULL
     AND public.platform_module_enabled('ai')
     AND public.leads_rls_staff_user_id() IS NOT NULL
     AND o."actorUserId" = public.leads_rls_staff_user_id()
     AND public.ai_rls_staff_allows('ai:invoke')
$fn$;

CREATE FUNCTION ai_queue_depth() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT count(*)::integer FROM "AiOperation" o
   WHERE o."status" = 'RESERVED' AND o."leaseUntil" > now() AND o."stopRequestedAt" IS NULL
     AND EXISTS (SELECT 1 FROM "AiTransient" t
                  WHERE t."operationId" = o."id" AND t."kind" = 'INPUT'
                    AND t."ciphertext" IS NOT NULL AND t."expiresAt" > now())
$fn$;

-- Wipes what must not be read any more: expired texts; inputs of operations no longer queued; a
-- result whose operation was stopped; everything while AI is off. Returns the number wiped.
CREATE FUNCTION ai_purge_transient() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  n integer;
BEGIN
  IF NOT public.platform_module_enabled('ai') THEN
    UPDATE "AiTransient" t SET "ciphertext" = NULL, "wipedAt" = now() WHERE t."ciphertext" IS NOT NULL;
  ELSE
    UPDATE "AiTransient" t SET "ciphertext" = NULL, "wipedAt" = now()
      FROM "AiOperation" o
     WHERE t."ciphertext" IS NOT NULL AND o."id" = t."operationId"
       AND (t."expiresAt" <= now()
            OR (t."kind" = 'INPUT' AND o."status" <> 'RESERVED')
            OR o."stopRequestedAt" IS NOT NULL);
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

-- DP-290's sweep, plus the purge of the held texts.
CREATE OR REPLACE FUNCTION ai_sweep() RETURNS TABLE (released integer, assumed integer, cancelled integer)
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
  PERFORM public.ai_purge_transient();
  RETURN QUERY SELECT n_released, n_assumed, n_cancelled;
END
$fn$;

-- DP-291's call plan, and none once the actor asked to stop the call.
CREATE OR REPLACE FUNCTION ai_call_plan(p_op uuid)
RETURNS TABLE (provider "AiProvider", provider_model_id text, credential_id uuid, project_ref text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT o."provider", m."modelId"::text, c."id", c."projectRef"::text
    FROM "AiOperation" o
    JOIN "AiModel" m ON m."id" = o."modelId"
    JOIN "AiProviderCredential" c ON c."provider" = o."provider" AND c."status" = 'ACTIVE'
   WHERE o."id" = p_op AND o."status" = 'IN_FLIGHT' AND o."stopRequestedAt" IS NULL
     AND public.platform_module_enabled('ai')
$fn$;

-- The owner's switch-off of `ai`, in the owner's own transaction: every queued job is cancelled
-- (money back, never started later, also not after AI is switched on again) and every held text
-- is wiped. Running calls see ai_disabled through ai_stop_signals and the settlement's switch.
CREATE FUNCTION ai_module_switched_off() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE
  r record;
BEGIN
  UPDATE "AiTransient" t SET "ciphertext" = NULL, "wipedAt" = now() WHERE t."ciphertext" IS NOT NULL;
  FOR r IN SELECT "id" FROM "AiOperation" WHERE "status" = 'RESERVED' ORDER BY "id" LOOP
    PERFORM public.ai_release(r."id", 'cancel');
  END LOOP;
  RETURN NULL;
END
$fn$;

CREATE TRIGGER "PlatformModuleState_ai_switched_off" AFTER UPDATE OF "enabled" ON "PlatformModuleState"
  FOR EACH ROW WHEN (NEW."moduleKey" = 'ai' AND OLD."enabled" AND NOT NEW."enabled")
  EXECUTE FUNCTION ai_module_switched_off();

REVOKE ALL ON FUNCTION ai_enqueue(uuid, text), ai_claim(text, integer, integer),
  ai_dispatch(uuid), ai_stop_signals(uuid[]), ai_request_cancel(uuid), ai_store_result(uuid, text),
  ai_result_ciphertext(uuid), ai_queue_depth(), ai_purge_transient(), ai_module_switched_off()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_enqueue(uuid, text), ai_claim(text, integer, integer),
  ai_dispatch(uuid), ai_stop_signals(uuid[]), ai_request_cancel(uuid), ai_store_result(uuid, text),
  ai_result_ciphertext(uuid), ai_queue_depth(), ai_purge_transient()
  TO dp_app;
