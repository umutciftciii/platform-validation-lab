-- DP-289 (ADR-030 D4): what a provider reports about a model, and whether the platform can use it.
-- Additive: two columns with defaults; no row changes meaning.
--   "capabilities"  {textGeneration, structuredOutput, thinking, lifecycle} (contracts
--                   AiModelCapabilities); never a text of the provider beyond these flags.
--   "compatible"    text generation and not retired; a model is ENABLED only when compatible
--                   (CHECK below; the API refuses earlier with a reason code).
-- Tested in test/integration/owner.int.test.ts (DP-289 block).

ALTER TABLE "AiModel" ADD COLUMN "capabilities" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "compatible" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "AiModel"
  ADD CONSTRAINT "AiModel_capabilities_object" CHECK (jsonb_typeof("capabilities") = 'object'),
  ADD CONSTRAINT "AiModel_enabled_needs_compatible" CHECK ("status" <> 'ENABLED' OR "compatible");

-- A DISABLED key may be tested again and re-activated by an AI administrator, so its ciphertext is
-- handed out too (still only while AI is on). Calls themselves use the ACTIVE key only (DP-291).
-- A REVOKED key has no ciphertext at all.
CREATE OR REPLACE FUNCTION ai_credential_ciphertext(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT c."ciphertext" FROM "AiProviderCredential" c
  WHERE c."id" = p_id AND c."status" IN ('ACTIVE', 'PENDING_TEST', 'DISABLED')
    AND public.platform_module_enabled('ai')
$fn$;
