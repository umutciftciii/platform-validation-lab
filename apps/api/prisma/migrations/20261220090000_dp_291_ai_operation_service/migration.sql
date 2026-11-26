-- DP-291 (ADR-030 D6–D8): the shared AI operation service. Three narrow SECURITY DEFINER readers,
-- nothing else: no table, column or policy changes, no write path (the engine of DP-290 stays the
-- only one). None of them returns a key, a prompt or a response text.
--
--  * ai_task_plan(task): what the caller needs to estimate and run a task — the task's model, its
--    provider, billing profile and limits. In the caller's staff context: AI on + ai:invoke + the
--    task enabled; no row otherwise. (dp_app reads AiTaskSetting/AiModel only with ai:read; a
--    future invoker role need not see the whole configuration.)
--  * ai_call_plan(op): what the worker needs for ONE provider call of a started operation — the
--    provider model id and the provider's ACTIVE key id (the key itself stays behind
--    ai_credential_ciphertext). Only while AI is on and the operation is IN_FLIGHT. The worker
--    runs outside any request, so this needs no staff context.
--  * ai_operation_view(op): one operation's state for its own actor (ai:invoke) or for an
--    ai_usage:read holder; no row otherwise. Counts, amounts and codes only.

CREATE FUNCTION ai_task_plan(p_task "AiTaskType")
RETURNS TABLE (model_id uuid, provider "AiProvider", provider_model_id text, billing_profile text,
  max_input_tokens integer, max_output_tokens integer, thinking_budget integer,
  temperature_milli integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT m."id", m."provider", m."modelId"::text, m."billingProfile"::text, t."maxInputTokens",
         t."maxOutputTokens", t."thinkingBudget", t."temperatureMilli"
    FROM "AiTaskSetting" t JOIN "AiModel" m ON m."id" = t."modelId"
   WHERE t."task" = p_task AND t."enabled" AND m."status" = 'ENABLED' AND m."compatible"
     AND public.platform_module_enabled('ai')
     AND public.leads_rls_staff_user_id() IS NOT NULL
     AND public.ai_rls_staff_allows('ai:invoke')
$fn$;

CREATE FUNCTION ai_call_plan(p_op uuid)
RETURNS TABLE (provider "AiProvider", provider_model_id text, credential_id uuid, project_ref text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT o."provider", m."modelId"::text, c."id", c."projectRef"::text
    FROM "AiOperation" o
    JOIN "AiModel" m ON m."id" = o."modelId"
    JOIN "AiProviderCredential" c ON c."provider" = o."provider" AND c."status" = 'ACTIVE'
   WHERE o."id" = p_op AND o."status" = 'IN_FLIGHT'
     AND public.platform_module_enabled('ai')
$fn$;

CREATE FUNCTION ai_operation_view(p_op uuid)
RETURNS TABLE (id uuid, task "AiTaskType", site_id uuid, provider "AiProvider", model_id uuid,
  status "AiOperationStatus", est_input_tokens integer, est_output_tokens integer,
  reserved_micros bigint, actual_micros bigint, cost_basis "AiCostBasis", input_tokens integer,
  cached_read_tokens integer, cache_write_tokens integer, output_tokens integer,
  reasoning_tokens integer, error_code text, reserved_at timestamptz, finished_at timestamptz,
  own boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT o."id", o."task", o."siteId", o."provider", o."modelId", o."status", o."estInputTokens",
         o."estOutputTokens", o."reservedMicros", o."actualMicros", o."costBasis",
         o."actInputTokens", o."actCachedReadTokens", o."actCacheWriteTokens", o."actOutputTokens",
         o."actReasoningTokens", o."errorCode"::text, o."reservedAt", o."finishedAt",
         o."actorUserId" IS NOT DISTINCT FROM public.leads_rls_staff_user_id()
    FROM "AiOperation" o
   WHERE o."id" = p_op
     AND public.platform_module_enabled('ai')
     AND public.leads_rls_staff_user_id() IS NOT NULL
     AND ((o."actorUserId" = public.leads_rls_staff_user_id()
           AND public.ai_rls_staff_allows('ai:invoke'))
          OR public.ai_rls_staff_allows('ai_usage:read'))
$fn$;

REVOKE ALL ON FUNCTION ai_task_plan("AiTaskType"), ai_call_plan(uuid), ai_operation_view(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_task_plan("AiTaskType"), ai_call_plan(uuid), ai_operation_view(uuid)
  TO dp_app;
