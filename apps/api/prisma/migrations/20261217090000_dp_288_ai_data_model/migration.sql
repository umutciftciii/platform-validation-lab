-- DP-288 (ADR-030 D3–D7): the AI data model — providers and their separate platform API keys,
-- models and dated prices, task settings, global and per-site budgets, operations (reservation,
-- usage, cost), the money ledger and reconciliation entries. Data only: no provider call, key
-- management screen or budget engine (DP-289…DP-293).
--
-- Runs as dp_owner (ADR-012A). Additive: new types, tables, functions, triggers, policies and
-- seed rows of the new tables, plus one guard trigger on "RoleAssignment"; no existing column, row
-- or function body changes.
--
--   Part 1  tables (follows `prisma migrate diff --from-migrations … --to-schema schema.prisma`).
--   Part 2  CHECK constraints (money ≥ 0, scope/site, versions, no key text in the hint, …).
--   Part 3  triggers: config rows raise "version" by exactly one and set "updatedAt"; no row of an
--           AI table is ever deleted or truncated; prices, ledger and reconciliation entries are
--           append-only; a credential's provider, creator and fingerprint never change and REVOKED
--           is final; a budget's scope, site and period never change; usage periods start at a UTC
--           day or month; a provider's default model is a model of that provider.
--   Part 4  seed: AiSettings (id 1), one AiProviderSetting per provider (off), one AiTaskSetting
--           per task type (off).
--   Part 5  ai_rls_staff_allows(permission): the staff session may use an ai:* permission —
--           AI is ON (platform_module_enabled('ai'), DP-287) AND (system owner OR an active
--           platform role assignment whose role carries the permission in "RolePermission").
--           ai_credential_ciphertext(id): the stored ciphertext of an ACTIVE or PENDING_TEST key,
--           while AI is on; dp_app cannot SELECT the column itself.
--   Part 6  privileges and row-level security: every AI table answers a staff session only while
--           AI is on and only with its permission (reads: ai:read / ai_usage:read; writes:
--           ai_provider:manage / ai_model:manage / ai_budget:manage). Operations, usage counters
--           and ledger have no write path yet (DP-290 adds the engine's own).
--   Part 7  owner-managed roles: an "ai_administrator" assignment is created only with the system
--           owner as its grantor (owner decision 6); the code catalogue lists the same roles
--           (`ownerManaged`, unit test).
--
-- No table has a column for a prompt or response text (owner decision 11; schema unit test).
-- Tested in test/integration/ai-data.int.test.ts and db-roles.int.test.ts.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dp_app') THEN
    RAISE EXCEPTION 'DP-288: database roles missing; run infra/docker/stack.sh db-roles <dev|prod> --yes first (dp-roles.sql)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'platform_module_enabled') THEN
    RAISE EXCEPTION 'DP-288: migration 20261216090000_dp_287_platform_module_gate must be applied first';
  END IF;
END $$;

-- =============================================================================================
-- Part 1: tables
-- =============================================================================================

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI');

-- CreateEnum
CREATE TYPE "AiCredentialStatus" AS ENUM ('PENDING_TEST', 'ACTIVE', 'DISABLED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AiModelStatus" AS ENUM ('DISCOVERED', 'VERIFIED', 'ENABLED', 'DISABLED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "AiBudgetScope" AS ENUM ('PLATFORM', 'SITE');

-- CreateEnum
CREATE TYPE "AiBudgetPeriod" AS ENUM ('DAILY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AiTaskType" AS ENUM ('DIAGNOSTIC_PING', 'TRANSLATION', 'SEO_META', 'CONTENT_DRAFT');

-- CreateEnum
CREATE TYPE "AiOperationStatus" AS ENUM ('RESERVED', 'IN_FLIGHT', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RELEASED', 'EXPIRED', 'UNKNOWN', 'DISCARDED');

-- CreateEnum
CREATE TYPE "AiCostBasis" AS ENUM ('NONE', 'LOCAL_USAGE', 'ASSUMED');

-- CreateEnum
CREATE TYPE "AiLedgerKind" AS ENUM ('RESERVE', 'START', 'SETTLE', 'RELEASE', 'CANCEL', 'EXPIRE', 'ASSUME_SPENT', 'OVERRUN', 'ESTIMATE_UNDERRUN', 'ADJUST');

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "maxConcurrency" INTEGER NOT NULL DEFAULT 2,
    "reservationTtlSec" INTEGER NOT NULL DEFAULT 120,
    "safetyMarginPct" INTEGER NOT NULL DEFAULT 10,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProviderSetting" (
    "provider" "AiProvider" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultModelId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiProviderSetting_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "AiProviderCredential" (
    "id" UUID NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "status" "AiCredentialStatus" NOT NULL DEFAULT 'PENDING_TEST',
    "ciphertext" TEXT,
    "keyVersion" INTEGER,
    "keyHint" VARCHAR(32) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "projectRef" VARCHAR(200),
    "lastTestedAt" TIMESTAMPTZ(3),
    "lastTestCode" VARCHAR(40),
    "createdById" UUID NOT NULL,
    "activatedAt" TIMESTAMPTZ(3),
    "disabledAt" TIMESTAMPTZ(3),
    "disabledById" UUID,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedById" UUID,
    "replacedById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiModel" (
    "id" UUID NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "modelId" VARCHAR(200) NOT NULL,
    "displayName" VARCHAR(200) NOT NULL,
    "status" "AiModelStatus" NOT NULL DEFAULT 'DISCOVERED',
    "contextWindow" INTEGER,
    "maxOutputTokens" INTEGER,
    "billingProfile" VARCHAR(64) NOT NULL,
    "lastVerifiedAt" TIMESTAMPTZ(3),
    "verifyCode" VARCHAR(40),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiModelPrice" (
    "id" UUID NOT NULL,
    "modelId" UUID NOT NULL,
    "inputMicrosPerMTok" BIGINT NOT NULL,
    "cachedReadMicrosPerMTok" BIGINT NOT NULL,
    "cacheWriteMicrosPerMTok" BIGINT,
    "outputMicrosPerMTok" BIGINT NOT NULL,
    "longContextThreshold" INTEGER,
    "longInputMicrosPerMTok" BIGINT,
    "longOutputMicrosPerMTok" BIGINT,
    "perRequestFeeMicros" BIGINT NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "sourceNote" VARCHAR(500) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiModelPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTaskSetting" (
    "task" "AiTaskType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "modelId" UUID,
    "maxInputTokens" INTEGER NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "thinkingBudget" INTEGER NOT NULL DEFAULT 0,
    "maxCostPerOpMicros" BIGINT NOT NULL,
    "temperatureMilli" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTaskSetting_pkey" PRIMARY KEY ("task")
);

-- CreateTable
CREATE TABLE "AiBudget" (
    "id" UUID NOT NULL,
    "scope" "AiBudgetScope" NOT NULL,
    "siteId" UUID,
    "period" "AiBudgetPeriod" NOT NULL,
    "limitMicros" BIGINT NOT NULL,
    "warnPct" INTEGER NOT NULL DEFAULT 80,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiBudgetUsage" (
    "budgetId" UUID NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "reservedMicros" BIGINT NOT NULL DEFAULT 0,
    "committedMicros" BIGINT NOT NULL DEFAULT 0,
    "assumedMicros" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiBudgetUsage_pkey" PRIMARY KEY ("budgetId","periodStart")
);

-- CreateTable
CREATE TABLE "AiOperation" (
    "id" UUID NOT NULL,
    "task" "AiTaskType" NOT NULL,
    "siteId" UUID,
    "actorUserId" UUID,
    "provider" "AiProvider" NOT NULL,
    "modelId" UUID NOT NULL,
    "priceId" UUID NOT NULL,
    "status" "AiOperationStatus" NOT NULL DEFAULT 'RESERVED',
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "inputDigest" CHAR(64) NOT NULL,
    "estInputTokens" INTEGER NOT NULL,
    "estOutputTokens" INTEGER NOT NULL,
    "reservedMicros" BIGINT NOT NULL,
    "actInputTokens" INTEGER,
    "actCachedReadTokens" INTEGER,
    "actCacheWriteTokens" INTEGER,
    "actOutputTokens" INTEGER,
    "actReasoningTokens" INTEGER,
    "actualMicros" BIGINT,
    "costBasis" "AiCostBasis" NOT NULL DEFAULT 'NONE',
    "providerRequestId" VARCHAR(200),
    "errorCode" VARCHAR(40),
    "instanceId" VARCHAR(64) NOT NULL,
    "reservedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "leaseUntil" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiLedgerEntry" (
    "id" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "budgetId" UUID NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "kind" "AiLedgerKind" NOT NULL,
    "deltaReservedMicros" BIGINT NOT NULL DEFAULT 0,
    "deltaCommittedMicros" BIGINT NOT NULL DEFAULT 0,
    "deltaAssumedMicros" BIGINT NOT NULL DEFAULT 0,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiReconciliation" (
    "id" UUID NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "projectRef" VARCHAR(200) NOT NULL DEFAULT '',
    "day" DATE NOT NULL,
    "providerAmountMicros" BIGINT NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "note" VARCHAR(500),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiProviderCredential_provider_status_idx" ON "AiProviderCredential"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderCredential_active_provider_key" ON "AiProviderCredential"("provider") WHERE ("status" = 'ACTIVE'::"AiCredentialStatus");

-- CreateIndex
CREATE UNIQUE INDEX "AiModel_provider_modelId_key" ON "AiModel"("provider", "modelId");

-- CreateIndex
CREATE UNIQUE INDEX "AiModelPrice_modelId_effectiveFrom_key" ON "AiModelPrice"("modelId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "AiBudget_siteId_idx" ON "AiBudget"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "AiBudget_active_platform_period_key" ON "AiBudget"("period") WHERE ("active" AND ("scope" = 'PLATFORM'::"AiBudgetScope"));

-- CreateIndex
CREATE UNIQUE INDEX "AiBudget_active_site_period_key" ON "AiBudget"("siteId", "period") WHERE ("active" AND ("scope" = 'SITE'::"AiBudgetScope"));

-- CreateIndex
CREATE INDEX "AiOperation_status_leaseUntil_idx" ON "AiOperation"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "AiOperation_siteId_createdAt_idx" ON "AiOperation"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "AiOperation_createdAt_idx" ON "AiOperation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiOperation_actorUserId_idempotencyKey_key" ON "AiOperation"("actorUserId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AiLedgerEntry_operationId_idx" ON "AiLedgerEntry"("operationId");

-- CreateIndex
CREATE INDEX "AiLedgerEntry_budgetId_periodStart_idx" ON "AiLedgerEntry"("budgetId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "AiReconciliation_provider_projectRef_day_source_key" ON "AiReconciliation"("provider", "projectRef", "day", "source");

-- AddForeignKey
ALTER TABLE "AiProviderSetting" ADD CONSTRAINT "AiProviderSetting_defaultModelId_fkey" FOREIGN KEY ("defaultModelId") REFERENCES "AiModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProviderCredential" ADD CONSTRAINT "AiProviderCredential_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "AiProviderCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiModelPrice" ADD CONSTRAINT "AiModelPrice_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AiModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTaskSetting" ADD CONSTRAINT "AiTaskSetting_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AiModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiBudget" ADD CONSTRAINT "AiBudget_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiBudgetUsage" ADD CONSTRAINT "AiBudgetUsage_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "AiBudget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOperation" ADD CONSTRAINT "AiOperation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOperation" ADD CONSTRAINT "AiOperation_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AiModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOperation" ADD CONSTRAINT "AiOperation_priceId_fkey" FOREIGN KEY ("priceId") REFERENCES "AiModelPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiLedgerEntry" ADD CONSTRAINT "AiLedgerEntry_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "AiOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiLedgerEntry" ADD CONSTRAINT "AiLedgerEntry_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "AiBudget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================================
-- Part 2: CHECK constraints
-- =============================================================================================

ALTER TABLE "AiSettings"
  ADD CONSTRAINT "AiSettings_singleton" CHECK ("id" = 1),
  ADD CONSTRAINT "AiSettings_limits" CHECK ("maxConcurrency" BETWEEN 1 AND 20
    AND "reservationTtlSec" BETWEEN 30 AND 3600 AND "safetyMarginPct" BETWEEN 0 AND 100),
  ADD CONSTRAINT "AiSettings_version" CHECK ("version" >= 1);
ALTER TABLE "AiProviderSetting"
  ADD CONSTRAINT "AiProviderSetting_version" CHECK ("version" >= 1),
  ADD CONSTRAINT "AiProviderSetting_enabled_needs_model" CHECK (NOT "enabled" OR "defaultModelId" IS NOT NULL);
ALTER TABLE "AiProviderCredential"
  ADD CONSTRAINT "AiProviderCredential_ciphertext"
    CHECK (("status" = 'REVOKED') = ("ciphertext" IS NULL)
           AND ("ciphertext" IS NULL OR "ciphertext" ~ '^v[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$')
           AND (("ciphertext" IS NULL) = ("keyVersion" IS NULL))),
  ADD CONSTRAINT "AiProviderCredential_hint" CHECK (char_length("keyHint") BETWEEN 4 AND 16),
  ADD CONSTRAINT "AiProviderCredential_fingerprint" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "AiProviderCredential_label" CHECK (char_length(btrim("label")) >= 1),
  ADD CONSTRAINT "AiProviderCredential_states"
    CHECK (("status" <> 'ACTIVE' OR "activatedAt" IS NOT NULL)
           AND ("status" <> 'REVOKED' OR "revokedAt" IS NOT NULL)
           AND ("status" <> 'DISABLED' OR "disabledAt" IS NOT NULL)),
  ADD CONSTRAINT "AiProviderCredential_not_self" CHECK ("replacedById" IS DISTINCT FROM "id"),
  ADD CONSTRAINT "AiProviderCredential_version" CHECK ("version" >= 1);
ALTER TABLE "AiModel"
  ADD CONSTRAINT "AiModel_limits" CHECK (("contextWindow" IS NULL OR "contextWindow" > 0)
    AND ("maxOutputTokens" IS NULL OR "maxOutputTokens" > 0)),
  ADD CONSTRAINT "AiModel_names" CHECK (char_length(btrim("modelId")) >= 1
    AND char_length(btrim("billingProfile")) >= 1),
  ADD CONSTRAINT "AiModel_version" CHECK ("version" >= 1);
ALTER TABLE "AiModelPrice"
  ADD CONSTRAINT "AiModelPrice_amounts" CHECK ("inputMicrosPerMTok" >= 0 AND "cachedReadMicrosPerMTok" >= 0
    AND ("cacheWriteMicrosPerMTok" IS NULL OR "cacheWriteMicrosPerMTok" >= 0)
    AND "outputMicrosPerMTok" >= 0 AND "perRequestFeeMicros" >= 0),
  ADD CONSTRAINT "AiModelPrice_long_context"
    CHECK ((("longContextThreshold" IS NULL) = ("longInputMicrosPerMTok" IS NULL))
           AND (("longContextThreshold" IS NULL) = ("longOutputMicrosPerMTok" IS NULL))
           AND ("longContextThreshold" IS NULL OR ("longContextThreshold" > 0
                AND "longInputMicrosPerMTok" >= 0 AND "longOutputMicrosPerMTok" >= 0))),
  ADD CONSTRAINT "AiModelPrice_source" CHECK (char_length(btrim("sourceNote")) >= 3);
ALTER TABLE "AiTaskSetting"
  ADD CONSTRAINT "AiTaskSetting_enabled_needs_model" CHECK (NOT "enabled" OR "modelId" IS NOT NULL),
  ADD CONSTRAINT "AiTaskSetting_limits" CHECK ("maxInputTokens" > 0 AND "maxOutputTokens" > 0
    AND "thinkingBudget" >= 0 AND "maxCostPerOpMicros" > 0
    AND ("temperatureMilli" IS NULL OR "temperatureMilli" BETWEEN 0 AND 2000)),
  ADD CONSTRAINT "AiTaskSetting_version" CHECK ("version" >= 1);
ALTER TABLE "AiBudget"
  ADD CONSTRAINT "AiBudget_scope_site" CHECK (("scope" = 'SITE') = ("siteId" IS NOT NULL)),
  ADD CONSTRAINT "AiBudget_amounts" CHECK ("limitMicros" > 0 AND "warnPct" BETWEEN 1 AND 100),
  ADD CONSTRAINT "AiBudget_version" CHECK ("version" >= 1);
ALTER TABLE "AiBudgetUsage"
  ADD CONSTRAINT "AiBudgetUsage_amounts" CHECK ("reservedMicros" >= 0 AND "committedMicros" >= 0
    AND "assumedMicros" >= 0);
ALTER TABLE "AiOperation"
  ADD CONSTRAINT "AiOperation_amounts" CHECK ("reservedMicros" >= 0 AND "estInputTokens" >= 0
    AND "estOutputTokens" >= 0 AND ("actualMicros" IS NULL OR "actualMicros" >= 0)
    AND ("actInputTokens" IS NULL OR "actInputTokens" >= 0)
    AND ("actCachedReadTokens" IS NULL OR "actCachedReadTokens" >= 0)
    AND ("actCacheWriteTokens" IS NULL OR "actCacheWriteTokens" >= 0)
    AND ("actOutputTokens" IS NULL OR "actOutputTokens" >= 0)
    AND ("actReasoningTokens" IS NULL OR "actReasoningTokens" >= 0)),
  ADD CONSTRAINT "AiOperation_digest" CHECK ("inputDigest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "AiOperation_idempotency" CHECK (char_length("idempotencyKey") >= 8),
  ADD CONSTRAINT "AiOperation_cost_basis" CHECK (("costBasis" = 'NONE') = ("actualMicros" IS NULL));
ALTER TABLE "AiReconciliation"
  ADD CONSTRAINT "AiReconciliation_amount" CHECK ("providerAmountMicros" >= 0);

-- =============================================================================================
-- Part 3: triggers
-- =============================================================================================

-- Configuration rows: "version" rises by exactly one per change; "createdAt" stays; "updatedAt" is
-- the time of the change.
CREATE FUNCTION ai_config_row_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW."version" IS DISTINCT FROM OLD."version" + 1 THEN
    RAISE EXCEPTION 'ai: every change raises the version by one' USING ERRCODE = 'check_violation';
  END IF;
  NEW."createdAt" := OLD."createdAt";
  NEW."updatedAt" := CURRENT_TIMESTAMP;
  RETURN NEW;
END
$fn$;

-- No AI row is ever removed (budgets are deactivated, keys revoked, prices superseded).
CREATE FUNCTION ai_no_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'ai: rows of % are never removed', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END
$fn$;

-- Append-only tables: no change after the insert either.
CREATE FUNCTION ai_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'ai: % is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END
$fn$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['AiSettings', 'AiProviderSetting', 'AiProviderCredential', 'AiModel',
                           'AiTaskSetting', 'AiBudget'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION ai_config_row_guard()',
                   t || '_version', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['AiSettings', 'AiProviderSetting', 'AiProviderCredential', 'AiModel',
                           'AiModelPrice', 'AiTaskSetting', 'AiBudget', 'AiBudgetUsage',
                           'AiOperation', 'AiLedgerEntry', 'AiReconciliation'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ai_no_delete()',
                   t || '_no_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION ai_no_delete()',
                   t || '_no_truncate', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['AiModelPrice', 'AiLedgerEntry', 'AiReconciliation'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION ai_append_only()',
                   t || '_append_only', t);
  END LOOP;
END $$;

-- A key's provider, creator and fingerprint never change; REVOKED is final; ACTIVE comes only
-- from PENDING_TEST or DISABLED.
CREATE FUNCTION ai_credential_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" NOT IN ('PENDING_TEST', 'ACTIVE') THEN
      RAISE EXCEPTION 'ai: a key starts PENDING_TEST or ACTIVE' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."provider" IS DISTINCT FROM OLD."provider" OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
     OR NEW."fingerprint" IS DISTINCT FROM OLD."fingerprint" THEN
    RAISE EXCEPTION 'ai: a key''s provider, creator and fingerprint never change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'REVOKED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'ai: a revoked key never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'ACTIVE' AND OLD."status" NOT IN ('ACTIVE', 'PENDING_TEST', 'DISABLED') THEN
    RAISE EXCEPTION 'ai: a key becomes ACTIVE only from PENDING_TEST or DISABLED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "AiProviderCredential_guard" BEFORE INSERT OR UPDATE ON "AiProviderCredential"
  FOR EACH ROW EXECUTE FUNCTION ai_credential_guard();

-- A budget is replaced, not re-scoped: scope, site and period never change.
CREATE FUNCTION ai_budget_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW."scope" IS DISTINCT FROM OLD."scope" OR NEW."siteId" IS DISTINCT FROM OLD."siteId"
     OR NEW."period" IS DISTINCT FROM OLD."period" OR NEW."createdById" IS DISTINCT FROM OLD."createdById" THEN
    RAISE EXCEPTION 'ai: a budget''s scope, site, period and creator never change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "AiBudget_guard" BEFORE UPDATE ON "AiBudget"
  FOR EACH ROW EXECUTE FUNCTION ai_budget_guard();

-- Usage periods start at a UTC day (DAILY) or month (MONTHLY) of their budget.
CREATE FUNCTION ai_budget_usage_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  p "AiBudgetPeriod";
BEGIN
  SELECT b."period" INTO p FROM "AiBudget" b WHERE b."id" = NEW."budgetId";
  IF NEW."periodStart" IS DISTINCT FROM
     (date_trunc(CASE p WHEN 'DAILY' THEN 'day' ELSE 'month' END, NEW."periodStart" AT TIME ZONE 'UTC')
      AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'ai: a usage period starts at a UTC day or month of its budget' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."budgetId" IS DISTINCT FROM OLD."budgetId"
                           OR NEW."periodStart" IS DISTINCT FROM OLD."periodStart") THEN
    RAISE EXCEPTION 'ai: a usage row keeps its budget and period' USING ERRCODE = 'check_violation';
  END IF;
  NEW."updatedAt" := CURRENT_TIMESTAMP;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "AiBudgetUsage_guard" BEFORE INSERT OR UPDATE ON "AiBudgetUsage"
  FOR EACH ROW EXECUTE FUNCTION ai_budget_usage_guard();

-- A price is valid from now on, never backdated (operations keep the price they reserved with).
CREATE FUNCTION ai_model_price_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW."effectiveFrom" < CURRENT_TIMESTAMP - interval '5 minutes' THEN
    RAISE EXCEPTION 'ai: a price is never backdated' USING ERRCODE = 'check_violation';
  END IF;
  NEW."createdAt" := CURRENT_TIMESTAMP;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "AiModelPrice_guard" BEFORE INSERT ON "AiModelPrice"
  FOR EACH ROW EXECUTE FUNCTION ai_model_price_guard();

-- A provider's default model is a model of that provider; an operation's price belongs to its
-- model, and its provider is the model's.
CREATE FUNCTION ai_model_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'AiProviderSetting' THEN
    IF NEW."defaultModelId" IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM "AiModel" m WHERE m."id" = NEW."defaultModelId" AND m."provider" = NEW."provider") THEN
      RAISE EXCEPTION 'ai: the default model belongs to another provider' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM "AiModel" m JOIN "AiModelPrice" p ON p."modelId" = m."id"
                   WHERE m."id" = NEW."modelId" AND p."id" = NEW."priceId"
                     AND m."provider" = NEW."provider") THEN
      RAISE EXCEPTION 'ai: an operation''s provider, model and price must match' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "AiProviderSetting_model_guard" BEFORE INSERT OR UPDATE ON "AiProviderSetting"
  FOR EACH ROW EXECUTE FUNCTION ai_model_reference_guard();
CREATE TRIGGER "AiOperation_model_guard" BEFORE INSERT OR UPDATE ON "AiOperation"
  FOR EACH ROW EXECUTE FUNCTION ai_model_reference_guard();

-- =============================================================================================
-- Part 4: seed (all off)
-- =============================================================================================

INSERT INTO "AiSettings" ("id") VALUES (1);
INSERT INTO "AiProviderSetting" ("provider") VALUES ('OPENAI'), ('ANTHROPIC'), ('GEMINI');
INSERT INTO "AiTaskSetting" ("task", "maxInputTokens", "maxOutputTokens", "maxCostPerOpMicros")
VALUES ('DIAGNOSTIC_PING', 256, 16, 10000),
       ('TRANSLATION', 16000, 8000, 200000),
       ('SEO_META', 4000, 1000, 50000),
       ('CONTENT_DRAFT', 8000, 4000, 200000);

-- =============================================================================================
-- Part 5: permission check and the key's ciphertext
-- =============================================================================================

-- The session (leads_rls_set_staff_context, DP-103/DP-125) may use this ai:* permission now:
-- AI is on, and the user is the system owner or holds it through an active platform assignment
-- of an ACTIVE account (role permissions as synced by iam sync). Missing context = false.
CREATE FUNCTION ai_rls_staff_allows(p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT public.platform_module_enabled('ai')
     AND p_permission LIKE 'ai%'
     AND (public.iam_rls_staff_is_owner()
          OR EXISTS (
            SELECT 1
            FROM "RoleAssignment" a
            JOIN "User" u ON u."id" = a."userId"
            JOIN "RolePermission" rp ON rp."roleId" = a."roleId"
            JOIN "Permission" p ON p."id" = rp."permissionId"
            WHERE a."userId" = public.leads_rls_staff_user_id()
              AND u."status" = 'ACTIVE' AND u."kind" = 'STAFF'
              AND a."scopeType" = 'PLATFORM' AND a."revokedAt" IS NULL
              AND (a."expiresAt" IS NULL OR a."expiresAt" > now())
              AND p."key" = p_permission))
$fn$;

-- The ciphertext of a key that may be used or tested, while AI is on. Decryption happens in the
-- API (DP_AI_ENC_KEYS); the database never sees the key.
CREATE FUNCTION ai_credential_ciphertext(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
  SELECT c."ciphertext" FROM "AiProviderCredential" c
  WHERE c."id" = p_id AND c."status" IN ('ACTIVE', 'PENDING_TEST')
    AND public.platform_module_enabled('ai')
$fn$;

REVOKE ALL ON FUNCTION ai_rls_staff_allows(text), ai_credential_ciphertext(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_rls_staff_allows(text), ai_credential_ciphertext(uuid) TO dp_app;

-- =============================================================================================
-- Part 6: privileges and row-level security
-- =============================================================================================

-- Nothing is removed by the API; append-only tables are not updated; the engine's tables have no
-- write path yet (DP-290).
REVOKE DELETE ON TABLE "AiSettings", "AiProviderSetting", "AiProviderCredential", "AiModel",
  "AiModelPrice", "AiTaskSetting", "AiBudget", "AiBudgetUsage", "AiOperation", "AiLedgerEntry",
  "AiReconciliation" FROM dp_app;
REVOKE INSERT ON TABLE "AiSettings", "AiProviderSetting", "AiTaskSetting" FROM dp_app;
REVOKE UPDATE ON TABLE "AiModelPrice", "AiLedgerEntry", "AiReconciliation" FROM dp_app;
REVOKE INSERT, UPDATE ON TABLE "AiBudgetUsage", "AiOperation", "AiLedgerEntry" FROM dp_app;
-- The key's ciphertext is written, never read back through the table (ai_credential_ciphertext).
REVOKE SELECT ON TABLE "AiProviderCredential" FROM dp_app;
GRANT SELECT ("id", "provider", "label", "status", "keyVersion", "keyHint", "fingerprint",
  "projectRef", "lastTestedAt", "lastTestCode", "createdById", "activatedAt", "disabledAt",
  "disabledById", "revokedAt", "revokedById", "replacedById", "version", "createdAt", "updatedAt")
  ON TABLE "AiProviderCredential" TO dp_app;

ALTER TABLE "AiSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiProviderSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiProviderCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiModel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiModelPrice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiTaskSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiBudget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiBudgetUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiLedgerEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiReconciliation" ENABLE ROW LEVEL SECURITY;

-- `(SELECT f())` makes each check an InitPlan: evaluated once per statement.
CREATE POLICY ai_settings_read ON "AiSettings" FOR SELECT TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai:read')));
CREATE POLICY ai_settings_update ON "AiSettings" FOR UPDATE TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai_budget:manage')))
  WITH CHECK ((SELECT ai_rls_staff_allows('ai_budget:manage')));

CREATE POLICY ai_provider_setting_read ON "AiProviderSetting" FOR SELECT TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai:read')));
CREATE POLICY ai_provider_setting_update ON "AiProviderSetting" FOR UPDATE TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai_provider:manage')))
  WITH CHECK ((SELECT ai_rls_staff_allows('ai_provider:manage')));

CREATE POLICY ai_credential_read ON "AiProviderCredential" FOR SELECT TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai:read')));
CREATE POLICY ai_credential_insert ON "AiProviderCredential" FOR INSERT TO dp_app
  WITH CHECK ((SELECT ai_rls_staff_allows('ai_provider:manage')));
CREATE POLICY ai_credential_update ON "AiProviderCredential" FOR UPDATE TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai_provider:manage')))
  WITH CHECK ((SELECT ai_rls_staff_allows('ai_provider:manage')));

CREATE POLICY ai_model_read ON "AiModel" FOR SELECT TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai:read')));
CREATE POLICY ai_model_insert ON "AiModel" FOR INSERT TO dp_app
  WITH CHECK ((SELECT ai_rls_staff_allows('ai_model:manage')));
CREATE POLICY ai_model_update ON "AiModel" FOR UPDATE TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai_model:manage')))
  WITH CHECK ((SELECT ai_rls_staff_allows('ai_model:manage')));

CREATE POLICY ai_model_price_read ON "AiModelPrice" FOR SELECT TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai:read')));
CREATE POLICY ai_model_price_insert ON "AiModelPrice" FOR INSERT TO dp_app
  WITH CHECK ((SELECT ai_rls_staff_allows('ai_model:manage')));

CREATE POLICY ai_task_setting_read ON "AiTaskSetting" FOR SELECT TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai:read')));
CREATE POLICY ai_task_setting_update ON "AiTaskSetting" FOR UPDATE TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai_model:manage')))
  WITH CHECK ((SELECT ai_rls_staff_allows('ai_model:manage')));

CREATE POLICY ai_budget_read ON "AiBudget" FOR SELECT TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai:read')));
CREATE POLICY ai_budget_insert ON "AiBudget" FOR INSERT TO dp_app
  WITH CHECK ((SELECT ai_rls_staff_allows('ai_budget:manage')));
CREATE POLICY ai_budget_update ON "AiBudget" FOR UPDATE TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai_budget:manage')))
  WITH CHECK ((SELECT ai_rls_staff_allows('ai_budget:manage')));

CREATE POLICY ai_budget_usage_read ON "AiBudgetUsage" FOR SELECT TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai_usage:read')));
CREATE POLICY ai_operation_read ON "AiOperation" FOR SELECT TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai_usage:read')));
CREATE POLICY ai_ledger_read ON "AiLedgerEntry" FOR SELECT TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai_usage:read')));

CREATE POLICY ai_reconciliation_read ON "AiReconciliation" FOR SELECT TO dp_app
  USING ((SELECT ai_rls_staff_allows('ai_usage:read')));
CREATE POLICY ai_reconciliation_insert ON "AiReconciliation" FOR INSERT TO dp_app
  WITH CHECK ((SELECT ai_rls_staff_allows('ai_budget:manage')));

-- =============================================================================================
-- Part 7: owner-managed roles
-- =============================================================================================

-- The roles only the system owner assigns (src/iam/catalog.ts `ownerManaged`; a unit test keeps
-- the two lists equal). The global AI switch (module:manage) is never in them.
CREATE FUNCTION iam_owner_managed_role_keys() RETURNS text[] LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT ARRAY['ai_administrator']::text[]
$fn$;

CREATE FUNCTION iam_owner_managed_role_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $fn$
BEGIN
  IF (SELECT r."key" FROM "Role" r WHERE r."id" = NEW."roleId") = ANY (iam_owner_managed_role_keys())
     AND (NEW."grantedById" IS NULL OR NEW."grantedById" IS DISTINCT FROM iam_system_owner_id()) THEN
    RAISE EXCEPTION 'iam: this role is assigned by the system owner only (DP-288)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION iam_owner_managed_role_guard() FROM PUBLIC;
CREATE TRIGGER "RoleAssignment_owner_managed_guard" BEFORE INSERT ON "RoleAssignment"
  FOR EACH ROW EXECUTE FUNCTION iam_owner_managed_role_guard();
