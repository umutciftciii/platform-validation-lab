/**
 * DP-289 (ADR-030 D4, D5): providers, their separate platform API keys and their models.
 *
 * Every route sits behind AiGateGuard (404 while AI is off) and authorises again here: reading
 * with ai:read, keys and provider settings with ai_provider:manage, models with ai_model:manage
 * (both sensitive: a stale step-up answers AUTH_STEP_UP_REQUIRED). All reads and writes run in the
 * caller's database context, where row-level security decides once more (AI on + permission).
 *
 * Keys: the plaintext arrives once (POST body), is checked for the provider's format, encrypted
 * with DP_AI_ENC_KEYS (additional data: row id and provider) and stored with a hint and an HMAC
 * fingerprint. It is never returned, logged or audited; provider calls receive it in a header.
 * A key is tested at once; a working key replaces the provider's ACTIVE one (the old one becomes
 * DISABLED, `replacedById`). Revoking erases the ciphertext.
 *
 * Provider calls (list/retrieve models only, no cost) run inside
 * `PlatformModuleService.whileEnabled('ai')`: none starts once the owner has switched AI off, and a
 * switch-off waits for the running ones (deadline PROVIDER_DEADLINE_MS). With DP_AI_TRANSPORT=off
 * every call is refused (CONFLICT_STATE, rule `transport_off`). A failed call is a result code,
 * never the provider's text.
 */
import { createHmac, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  AiCredentialAddRequestSchema,
  AiModelEnableRequestSchema,
  AiProviderKeySchema,
  AiProviderSettingRequestSchema,
  type AiCredentialResult,
  type AiCredentialSummary,
  type AiModelCapabilities,
  type AiModelRefreshResponse,
  type AiModelSummary,
  type AiModelsResponse,
  type AiProviderKey,
  type AiProviderResultCode,
  type AiProvidersResponse,
  type AiProviderSummary,
} from "@dream/contracts";
import { aiCredentialAad, encryptSecret } from "../iam/auth/secret-box.js";
import { API_CONFIG, type ApiConfig } from "../iam/http/api-config.js";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import {
  AI_MODULE,
  PlatformModuleDisabledError,
  PlatformModuleService,
} from "../iam/platform-modules.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { aiAuditMetadata } from "./audit.js";
import { AI_CONFIG, AI_ADAPTERS } from "./config/ai-config.provider.js";
import type { AiConfig } from "./config/ai-config.js";
import { readCredentialKey } from "./credential-store.js";
import { keyFormatProblem, keyHint } from "./providers/key-format.js";
import type { AdapterRegistry } from "./providers/registry.js";
import {
  ProviderCallError,
  type AiProviderAdapter,
  type ProviderModel,
} from "./providers/types.js";

type Tx = Parameters<Parameters<StaffAccess["staffData"]>[0]>[0];
const PLATFORM = { scope: "platform" } as const;
/** One provider call, retries included; below the admin proxy's 10 s and whileEnabled's 10 s. */
export const PROVIDER_DEADLINE_MS = 7_000;
/** At most this many models of one provider are stored per refresh. */
export const MAX_MODELS_PER_PROVIDER = 500;

const CREDENTIAL_SELECT = {
  id: true,
  provider: true,
  label: true,
  status: true,
  keyHint: true,
  projectRef: true,
  lastTestedAt: true,
  lastTestCode: true,
  createdAt: true,
  activatedAt: true,
  disabledAt: true,
  revokedAt: true,
  version: true,
} as const;
interface CredentialRow {
  id: string;
  provider: AiProviderKey;
  label: string;
  status: AiCredentialSummary["status"];
  keyHint: string;
  projectRef: string | null;
  lastTestedAt: Date | null;
  lastTestCode: string | null;
  createdAt: Date;
  activatedAt: Date | null;
  disabledAt: Date | null;
  revokedAt: Date | null;
  version: number;
}

const MODEL_SELECT = {
  id: true,
  provider: true,
  modelId: true,
  displayName: true,
  status: true,
  compatible: true,
  capabilities: true,
  contextWindow: true,
  maxOutputTokens: true,
  lastVerifiedAt: true,
  verifyCode: true,
  version: true,
} as const;
interface ModelRow {
  id: string;
  provider: AiProviderKey;
  modelId: string;
  displayName: string;
  status: AiModelSummary["status"];
  compatible: boolean;
  capabilities: unknown;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  lastVerifiedAt: Date | null;
  verifyCode: string | null;
  version: number;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function credentialSummary(c: CredentialRow): AiCredentialSummary {
  return {
    id: c.id,
    provider: c.provider,
    label: c.label,
    status: c.status,
    keyHint: c.keyHint,
    projectRef: c.projectRef,
    lastTestedAt: iso(c.lastTestedAt),
    lastTestCode: c.lastTestCode,
    createdAt: c.createdAt.toISOString(),
    activatedAt: iso(c.activatedAt),
    disabledAt: iso(c.disabledAt),
    revokedAt: iso(c.revokedAt),
    version: c.version,
  };
}

function capabilitiesOf(raw: unknown): AiModelCapabilities {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const flag = (v: unknown) => (typeof v === "boolean" ? v : null);
  const lifecycle = o["lifecycle"];
  return {
    textGeneration: flag(o["textGeneration"]),
    structuredOutput: flag(o["structuredOutput"]),
    thinking: flag(o["thinking"]),
    lifecycle:
      lifecycle === "active" || lifecycle === "deprecated" || lifecycle === "retired"
        ? lifecycle
        : null,
  };
}

/** Capabilities the provider does not report, and no administrator has confirmed yet. */
function needsConfirmation(compatible: boolean, caps: AiModelCapabilities): boolean {
  return !compatible && caps.textGeneration === null && caps.lifecycle !== "retired";
}

/**
 * The status and compatibility after a provider answer. Known capabilities decide; unknown ones
 * (null) keep what the administrator confirmed before (`compatible`), never guess.
 */
function nextState(
  before: { status: ModelRow["status"]; compatible: boolean } | null,
  m: ProviderModel,
): { status: ModelRow["status"]; compatible: boolean } {
  const known = m.capabilities.textGeneration !== null;
  const retired = m.capabilities.lifecycle === "retired";
  const compatible = retired ? false : known ? m.compatible : (before?.compatible ?? false);
  if (retired || m.capabilities.textGeneration === false)
    return { status: "UNAVAILABLE", compatible: false };
  if (!before || before.status === "UNAVAILABLE") return { status: "DISCOVERED", compatible };
  // ENABLED needs compatible (database CHECK): a model that lost it falls back to VERIFIED.
  if (before.status === "ENABLED" && !compatible) return { status: "VERIFIED", compatible };
  return { status: before.status, compatible };
}

function modelSummary(m: ModelRow): AiModelSummary {
  const capabilities = capabilitiesOf(m.capabilities);
  return {
    id: m.id,
    provider: m.provider,
    modelId: m.modelId,
    displayName: m.displayName,
    status: m.status,
    compatible: m.compatible,
    requiresConfirmation: needsConfirmation(m.compatible, capabilities),
    capabilities,
    contextWindow: m.contextWindow,
    maxOutputTokens: m.maxOutputTokens,
    lastVerifiedAt: iso(m.lastVerifiedAt),
    verifyCode: m.verifyCode,
    version: m.version,
  };
}

const conflict = (rule: string, path = "(root)") =>
  new ApiError("CONFLICT_STATE", [{ path, rule }]);

@Injectable()
export class AiProvidersService {
  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(PlatformModuleService) private readonly modules: PlatformModuleService,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
    @Inject(AI_ADAPTERS) private readonly adapters: AdapterRegistry,
    @Inject(API_CONFIG) private readonly api: ApiConfig,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  // --- access -------------------------------------------------------------------------------

  /** The permission, with "AI is off" as 404 and a stale step-up as AUTH_STEP_UP_REQUIRED. */
  private async allow(
    ctx: RequestContext,
    permission: string,
    resource: string,
  ): Promise<StaffAccess> {
    const access = await this.access.begin(ctx);
    const refusal = access.refusal(permission, PLATFORM);
    const target = { type: resource, id: null };
    if (refusal === "module_disabled") {
      await access.denied(permission, target, "ai_disabled");
      throw new ApiError("NOT_FOUND");
    }
    if (refusal === "mfa_required") {
      await access.denied(permission, target, "mfa_required");
      throw new ApiError("AUTH_STEP_UP_REQUIRED");
    }
    await access.require(permission, PLATFORM, target);
    return access;
  }

  private provider(raw: string): AiProviderKey {
    const p = AiProviderKeySchema.safeParse(raw.toUpperCase());
    if (!p.success) throw new ApiError("NOT_FOUND");
    return p.data;
  }

  private adapter(provider: AiProviderKey): AiProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw conflict("transport_off");
    return adapter;
  }

  /**
   * One provider call inside the AI switch (no call starts after a switch-off), with a deadline.
   * Returns the value or the failure code; never the provider's text.
   */
  private async call<T>(
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<{ code: AiProviderResultCode; value: T | null }> {
    try {
      const value = await this.modules.whileEnabled(AI_MODULE, () =>
        fn(AbortSignal.timeout(PROVIDER_DEADLINE_MS)),
      );
      return { code: "ok", value };
    } catch (error) {
      if (error instanceof PlatformModuleDisabledError) throw new ApiError("NOT_FOUND");
      if (error instanceof ProviderCallError) return { code: error.code, value: null };
      throw error;
    }
  }

  private audit(
    access: StaffAccess,
    tx: Tx,
    action: string,
    permission: string,
    resource: string,
    id: string | null,
    metadata: Record<string, unknown>,
    failure?: string,
  ) {
    return access.audit(tx, {
      action,
      resourceType: resource,
      resourceId: id,
      siteId: null,
      permission,
      metadata: aiAuditMetadata(metadata),
      ...(failure ? { failure: { reason: failure } } : {}),
    });
  }

  // --- providers and keys ---------------------------------------------------------------------

  async providers(ctx: RequestContext): Promise<AiProvidersResponse> {
    const access = await this.allow(ctx, "ai:read", "ai_provider");
    const { settings, credentials } = await access.staffData(async (tx) => ({
      settings: await tx.aiProviderSetting.findMany({
        select: { provider: true, enabled: true, defaultModelId: true, version: true },
      }),
      credentials: await tx.aiProviderCredential.findMany({
        select: CREDENTIAL_SELECT,
        orderBy: { createdAt: "desc" },
      }),
    }));
    const order: AiProviderKey[] = ["OPENAI", "ANTHROPIC", "GEMINI"];
    const providers: AiProviderSummary[] = order.map((p) => {
      const s = settings.find((x) => x.provider === p);
      return {
        provider: p,
        enabled: s?.enabled ?? false,
        defaultModelId: s?.defaultModelId ?? null,
        version: s?.version ?? 1,
        credentials: credentials.filter((c) => c.provider === p).map(credentialSummary),
      };
    });
    return { transport: this.config.transport, providers };
  }

  async addCredential(
    ctx: RequestContext,
    rawProvider: string,
    body: unknown,
  ): Promise<AiCredentialResult> {
    const access = await this.allow(ctx, "ai_provider:manage", "ai_credential");
    const provider = this.provider(rawProvider);
    const req = parseBody(AiCredentialAddRequestSchema, body);
    const apiKey = req.apiKey.trim();
    if (keyFormatProblem(provider, apiKey)) {
      throw new ApiError("VALIDATION_FAILED", [{ path: "apiKey", rule: "key_format" }]);
    }
    const keyring = this.config.keyring;
    const adapter = this.adapter(provider);
    if (!keyring) throw conflict("transport_off");
    const fingerprint = createHmac("sha256", this.api.secrets.hmacKey)
      .update(`ai-credential|${provider}|${apiKey}`)
      .digest("hex");
    const id = randomUUID();
    const created = await access.staffData(async (tx) => {
      const twin = await tx.aiProviderCredential.findFirst({
        where: { provider, fingerprint, status: { not: "REVOKED" } },
        select: { id: true },
      });
      if (twin) throw conflict("duplicate_key", "apiKey");
      const row = await tx.aiProviderCredential.create({
        data: {
          id,
          provider,
          label: req.label,
          status: "PENDING_TEST",
          ciphertext: encryptSecret(
            keyring,
            Buffer.from(apiKey, "utf8"),
            aiCredentialAad(id, provider),
          ),
          keyVersion: keyring.current,
          keyHint: keyHint(provider, apiKey),
          fingerprint,
          projectRef: req.projectRef ?? null,
          createdById: access.userId,
        },
        select: CREDENTIAL_SELECT,
      });
      await this.audit(access, tx, "ai.credential.add", "ai_provider:manage", "ai_credential", id, {
        provider,
        credentialId: id,
        keyHint: row.keyHint,
      });
      return row;
    });
    const test = await this.call((signal) =>
      adapter.listModels(apiKey, { projectRef: created.projectRef, signal }),
    );
    return this.afterTest(access, created, test, req.activate !== false);
  }

  /** Records a test; with `activate`, a working key replaces the provider's ACTIVE one. */
  private async afterTest(
    access: StaffAccess,
    credential: CredentialRow,
    test: { code: AiProviderResultCode; value: ProviderModel[] | null },
    activate: boolean,
  ): Promise<AiCredentialResult> {
    const now = this.clock.now();
    const row = await access.staffData(async (tx) => {
      let replacedId: string | null = null;
      const doActivate = activate && test.code === "ok" && credential.status !== "ACTIVE";
      if (doActivate) {
        const current = await tx.aiProviderCredential.findFirst({
          where: { provider: credential.provider, status: "ACTIVE", id: { not: credential.id } },
          select: { id: true, version: true },
        });
        if (current) {
          replacedId = current.id;
          await tx.aiProviderCredential.update({
            where: { id: current.id },
            data: {
              status: "DISABLED",
              disabledAt: now,
              disabledById: access.userId,
              replacedById: credential.id,
              version: current.version + 1,
            },
            select: { id: true },
          });
        }
      }
      const updated = await tx.aiProviderCredential.update({
        where: { id: credential.id, version: credential.version },
        data: {
          lastTestedAt: now,
          lastTestCode: test.code,
          version: credential.version + 1,
          ...(doActivate ? { status: "ACTIVE" as const, activatedAt: now } : {}),
        },
        select: CREDENTIAL_SELECT,
      });
      await this.audit(
        access,
        tx,
        "ai.credential.test",
        "ai_provider:manage",
        "ai_credential",
        credential.id,
        {
          provider: credential.provider,
          credentialId: credential.id,
          code: test.code,
          models: test.value?.length ?? 0,
        },
        test.code === "ok" ? undefined : test.code,
      );
      if (doActivate) {
        await this.audit(
          access,
          tx,
          "ai.credential.activate",
          "ai_provider:manage",
          "ai_credential",
          credential.id,
          {
            provider: credential.provider,
            credentialId: credential.id,
            replacedId,
          },
        );
      }
      return updated;
    });
    return {
      credential: credentialSummary(row),
      test: { code: test.code, models: test.value?.length ?? 0 },
    };
  }

  private async credential(access: StaffAccess, id: string): Promise<CredentialRow> {
    const row = await access.staffData((tx) =>
      tx.aiProviderCredential.findUnique({ where: { id }, select: CREDENTIAL_SELECT }),
    );
    if (!row) throw new ApiError("NOT_FOUND");
    return row;
  }

  /** Tests a key; `activate` also makes a working key the provider's ACTIVE one. */
  async testCredential(
    ctx: RequestContext,
    rawId: string,
    activate: boolean,
  ): Promise<AiCredentialResult> {
    const access = await this.allow(ctx, "ai_provider:manage", "ai_credential");
    const id = this.uuid(rawId);
    const credential = await this.credential(access, id);
    if (credential.status === "REVOKED") throw conflict("revoked");
    const adapter = this.adapter(credential.provider);
    const keyring = this.config.keyring;
    if (!keyring) throw conflict("transport_off");
    const apiKey = await access.staffData((tx) =>
      readCredentialKey(tx, keyring, credential.id, credential.provider),
    );
    if (apiKey === null) throw new ApiError("NOT_FOUND");
    const test = await this.call((signal) =>
      adapter.listModels(apiKey, { projectRef: credential.projectRef, signal }),
    );
    return this.afterTest(access, credential, test, activate);
  }

  async disableCredential(ctx: RequestContext, rawId: string): Promise<AiCredentialSummary> {
    const access = await this.allow(ctx, "ai_provider:manage", "ai_credential");
    const credential = await this.credential(access, this.uuid(rawId));
    if (credential.status === "REVOKED") throw conflict("revoked");
    if (credential.status === "DISABLED") return credentialSummary(credential);
    const row = await access.staffData(async (tx) => {
      const updated = await tx.aiProviderCredential.update({
        where: { id: credential.id, version: credential.version },
        data: {
          status: "DISABLED",
          disabledAt: this.clock.now(),
          disabledById: access.userId,
          version: credential.version + 1,
        },
        select: CREDENTIAL_SELECT,
      });
      await this.audit(
        access,
        tx,
        "ai.credential.disable",
        "ai_provider:manage",
        "ai_credential",
        credential.id,
        {
          provider: credential.provider,
          credentialId: credential.id,
          previousStatus: credential.status,
        },
      );
      return updated;
    });
    return credentialSummary(row);
  }

  async revokeCredential(ctx: RequestContext, rawId: string): Promise<AiCredentialSummary> {
    const access = await this.allow(ctx, "ai_provider:manage", "ai_credential");
    const credential = await this.credential(access, this.uuid(rawId));
    if (credential.status === "REVOKED") return credentialSummary(credential);
    const row = await access.staffData(async (tx) => {
      const updated = await tx.aiProviderCredential.update({
        where: { id: credential.id, version: credential.version },
        data: {
          status: "REVOKED",
          ciphertext: null,
          keyVersion: null,
          revokedAt: this.clock.now(),
          revokedById: access.userId,
          version: credential.version + 1,
        },
        select: CREDENTIAL_SELECT,
      });
      await this.audit(
        access,
        tx,
        "ai.credential.revoke",
        "ai_provider:manage",
        "ai_credential",
        credential.id,
        {
          provider: credential.provider,
          credentialId: credential.id,
          previousStatus: credential.status,
        },
      );
      return updated;
    });
    return credentialSummary(row);
  }

  async updateProvider(
    ctx: RequestContext,
    rawProvider: string,
    body: unknown,
  ): Promise<AiProviderSummary> {
    const access = await this.allow(ctx, "ai_provider:manage", "ai_provider");
    const provider = this.provider(rawProvider);
    const req = parseBody(AiProviderSettingRequestSchema, body);
    await access.staffData(async (tx) => {
      if (req.defaultModelId) {
        const model = await tx.aiModel.findUnique({
          where: { id: req.defaultModelId },
          select: { provider: true, status: true },
        });
        if (!model || model.provider !== provider)
          throw conflict("model_of_other_provider", "defaultModelId");
        if (req.enabled && model.status !== "ENABLED")
          throw conflict("model_not_enabled", "defaultModelId");
      }
      if (req.enabled) {
        if (!req.defaultModelId) throw conflict("default_model_required", "defaultModelId");
        const active = await tx.aiProviderCredential.count({
          where: { provider, status: "ACTIVE" },
        });
        if (active === 0) throw conflict("no_active_credential");
      }
      const res = await tx.aiProviderSetting.updateMany({
        where: { provider, version: req.version },
        data: {
          enabled: req.enabled,
          defaultModelId: req.defaultModelId,
          version: req.version + 1,
          updatedById: access.userId,
        },
      });
      if (res.count !== 1) throw conflict("stale_version", "version");
      await this.audit(
        access,
        tx,
        "ai.provider.update",
        "ai_provider:manage",
        "ai_provider",
        provider,
        {
          provider,
          enabled: req.enabled,
          defaultModelId: req.defaultModelId,
          version: req.version + 1,
        },
      );
    });
    return (await this.providers(ctx)).providers.find((p) => p.provider === provider)!;
  }

  // --- models ---------------------------------------------------------------------------------

  async models(ctx: RequestContext, rawProvider: string | undefined): Promise<AiModelsResponse> {
    const access = await this.allow(ctx, "ai:read", "ai_model");
    const provider = rawProvider ? this.provider(rawProvider) : undefined;
    const rows = await access.staffData((tx) =>
      tx.aiModel.findMany({
        where: provider ? { provider } : {},
        select: MODEL_SELECT,
        orderBy: [{ provider: "asc" }, { modelId: "asc" }],
      }),
    );
    return { items: rows.map(modelSummary) };
  }

  /** The provider's ACTIVE key, decrypted for one call. */
  private async activeKey(
    access: StaffAccess,
    provider: AiProviderKey,
  ): Promise<{ key: string; projectRef: string | null }> {
    const keyring = this.config.keyring;
    if (!keyring) throw conflict("transport_off");
    const found = await access.staffData(async (tx) => {
      const c = await tx.aiProviderCredential.findFirst({
        where: { provider, status: "ACTIVE" },
        select: { id: true, projectRef: true },
      });
      if (!c) return null;
      const key = await readCredentialKey(tx, keyring, c.id, provider);
      return key === null ? null : { key, projectRef: c.projectRef };
    });
    if (!found) throw conflict("no_active_credential");
    return found;
  }

  async refreshModels(ctx: RequestContext, rawProvider: string): Promise<AiModelRefreshResponse> {
    const access = await this.allow(ctx, "ai_model:manage", "ai_model");
    const provider = this.provider(rawProvider);
    const adapter = this.adapter(provider);
    const { key, projectRef } = await this.activeKey(access, provider);
    const listed = await this.call((signal) => adapter.listModels(key, { projectRef, signal }));
    if (listed.code !== "ok" || !listed.value) {
      await access.staffData((tx) =>
        this.audit(
          access,
          tx,
          "ai.model.discover",
          "ai_model:manage",
          "ai_provider",
          provider,
          { provider, code: listed.code },
          listed.code,
        ),
      );
      return { code: listed.code, added: 0, updated: 0, unavailable: 0 };
    }
    const models = listed.value
      .filter((m) => m.modelId.length <= 200)
      .slice(0, MAX_MODELS_PER_PROVIDER);
    const counts = await access.staffData(async (tx) => {
      const existing = await tx.aiModel.findMany({
        where: { provider },
        select: { ...MODEL_SELECT, billingProfile: true },
      });
      const byId = new Map(existing.map((m) => [m.modelId, m]));
      let added = 0;
      let updated = 0;
      let unavailable = 0;
      for (const m of models) {
        const before = byId.get(m.modelId);
        const next = nextState(before ?? null, m);
        const data = {
          displayName: m.displayName.slice(0, 200),
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          capabilities: m.capabilities as never,
          compatible: next.compatible,
        };
        if (!before) {
          await tx.aiModel.create({
            data: {
              provider,
              modelId: m.modelId,
              billingProfile: adapter.billingProfile,
              status: next.status,
              ...data,
            },
            select: { id: true },
          });
          added += 1;
          continue;
        }
        const status = next.status;
        const same =
          before.displayName === data.displayName &&
          before.contextWindow === data.contextWindow &&
          before.maxOutputTokens === data.maxOutputTokens &&
          before.compatible === data.compatible &&
          before.status === status &&
          JSON.stringify(capabilitiesOf(before.capabilities)) ===
            JSON.stringify(capabilitiesOf(m.capabilities));
        if (same) continue;
        await tx.aiModel.update({
          where: { id: before.id },
          data: { ...data, status, version: before.version + 1 },
          select: { id: true },
        });
        updated += 1;
        if (status === "UNAVAILABLE" && before.status !== "UNAVAILABLE") unavailable += 1;
      }
      const listedIds = new Set(models.map((m) => m.modelId));
      for (const before of existing) {
        if (listedIds.has(before.modelId) || before.status === "UNAVAILABLE") continue;
        await tx.aiModel.update({
          where: { id: before.id },
          data: {
            status: "UNAVAILABLE",
            compatible: false,
            verifyCode: "model_not_found",
            version: before.version + 1,
          },
          select: { id: true },
        });
        unavailable += 1;
      }
      await this.audit(
        access,
        tx,
        "ai.model.discover",
        "ai_model:manage",
        "ai_provider",
        provider,
        {
          provider,
          code: "ok",
          added,
          updated,
          unavailable,
        },
      );
      return { added, updated, unavailable };
    });
    return { code: "ok", ...counts };
  }

  private async model(access: StaffAccess, id: string): Promise<ModelRow> {
    const row = await access.staffData((tx) =>
      tx.aiModel.findUnique({ where: { id }, select: MODEL_SELECT }),
    );
    if (!row) throw new ApiError("NOT_FOUND");
    return row;
  }

  /** Retrieves the model from its provider and records what it can do (compatibility check). */
  async verifyModel(ctx: RequestContext, rawId: string): Promise<AiModelSummary> {
    const access = await this.allow(ctx, "ai_model:manage", "ai_model");
    const model = await this.model(access, this.uuid(rawId));
    const adapter = this.adapter(model.provider);
    const { key, projectRef } = await this.activeKey(access, model.provider);
    const got = await this.call((signal) =>
      adapter.getModel(key, model.modelId, { projectRef, signal }),
    );
    const now = this.clock.now();
    const row = await access.staffData(async (tx) => {
      let data: Record<string, unknown>;
      let code: string = got.code;
      if (got.code === "ok" && got.value === null) code = "model_not_found";
      if (got.code === "ok" && got.value) {
        const m = got.value;
        const next = nextState(model, m);
        // The model exists at the provider: VERIFIED (ENABLED stays), unless it cannot be used.
        const status =
          next.status === "UNAVAILABLE"
            ? "UNAVAILABLE"
            : model.status === "ENABLED" && next.compatible
              ? "ENABLED"
              : "VERIFIED";
        code =
          next.status === "UNAVAILABLE"
            ? "incompatible"
            : needsConfirmation(next.compatible, m.capabilities)
              ? "capabilities_unknown"
              : "ok";
        data = {
          displayName: m.displayName.slice(0, 200),
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          capabilities: m.capabilities as never,
          compatible: next.compatible,
          status,
          lastVerifiedAt: now,
          verifyCode: code,
        };
      } else if (code === "model_not_found") {
        data = { status: "UNAVAILABLE", compatible: false, lastVerifiedAt: now, verifyCode: code };
      } else {
        // A provider failure says nothing about the model: only the attempt is recorded.
        data = { verifyCode: code };
      }
      const updated = await tx.aiModel.update({
        where: { id: model.id, version: model.version },
        data: { ...data, version: model.version + 1 } as never,
        select: MODEL_SELECT,
      });
      await this.audit(
        access,
        tx,
        "ai.model.verify",
        "ai_model:manage",
        "ai_model",
        model.id,
        {
          provider: model.provider,
          modelId: model.id,
          modelKey: model.modelId,
          code,
          status: updated.status,
        },
        code === "ok" || code === "capabilities_unknown" ? undefined : code,
      );
      return updated;
    });
    return modelSummary(row);
  }

  /**
   * Enables or disables a model. Enabling needs a successful verification; a model whose
   * capabilities the provider does not report needs the administrator's explicit confirmation
   * (`confirmUnknownCapabilities`), which is recorded (compatible, audit code `admin_confirmed`).
   * Nothing is ever enabled automatically.
   */
  async setModelEnabled(
    ctx: RequestContext,
    rawId: string,
    enabled: boolean,
    body: unknown = {},
  ): Promise<AiModelSummary> {
    const access = await this.allow(ctx, "ai_model:manage", "ai_model");
    const confirm = enabled
      ? parseBody(AiModelEnableRequestSchema, body).confirmUnknownCapabilities === true
      : false;
    const model = await this.model(access, this.uuid(rawId));
    let confirmed = false;
    if (enabled) {
      if (model.status === "ENABLED") return modelSummary(model);
      if (model.status !== "VERIFIED" && model.status !== "DISABLED")
        throw conflict("not_verified");
      if (!model.lastVerifiedAt) throw conflict("not_verified");
      if (!model.compatible) {
        if (!needsConfirmation(model.compatible, capabilitiesOf(model.capabilities))) {
          throw conflict("incompatible");
        }
        if (!confirm) throw conflict("capabilities_unknown", "confirmUnknownCapabilities");
        confirmed = true;
      }
    } else if (model.status === "DISABLED") {
      return modelSummary(model);
    }
    const row = await access.staffData(async (tx) => {
      const updated = await tx.aiModel.update({
        where: { id: model.id, version: model.version },
        data: {
          status: enabled ? "ENABLED" : "DISABLED",
          ...(confirmed ? { compatible: true } : {}),
          version: model.version + 1,
        },
        select: MODEL_SELECT,
      });
      await this.audit(
        access,
        tx,
        enabled ? "ai.model.enable" : "ai.model.disable",
        "ai_model:manage",
        "ai_model",
        model.id,
        {
          provider: model.provider,
          modelId: model.id,
          modelKey: model.modelId,
          previousStatus: model.status,
          status: updated.status,
          ...(confirmed ? { code: "admin_confirmed" } : {}),
        },
      );
      return updated;
    });
    return modelSummary(row);
  }

  private uuid(raw: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
      throw new ApiError("NOT_FOUND");
    }
    return raw.toLowerCase();
  }
}
