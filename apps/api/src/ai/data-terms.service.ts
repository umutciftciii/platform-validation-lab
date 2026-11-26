/**
 * DP-298 (ADR-031 D6): the data-processing terms of an AI provider, recorded by the system owner
 * before any task may send that provider personal data (personal-data-gate.ts).
 *
 * - Read: `ai:read` (the AI Center). Record and revoke: `module:manage` (system owner only, fresh
 *   step-up), like the AI switch itself; no new role or approval screen (owner decision
 *   2026-11-27: no DPO role, no approval engine).
 * - Append-only: a new record replaces the current one by revoking it in the same transaction;
 *   the database keeps at most one unrevoked record per provider and refuses any other change.
 * - Recording terms enables nothing on its own: AI-1 tasks handle no personal data, and a future
 *   task also needs an approved purpose and the data's own permission.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  AiProviderDataTermsRequestSchema,
  AiProviderKeySchema,
  type AiProviderDataTerms,
  type AiProviderDataTermsResponse,
  type AiProviderKey,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { aiAuditMetadata } from "./audit.js";

const PLATFORM = { scope: "platform" } as const;
const MANAGE = "module:manage";

interface TermsRow {
  id: string;
  provider: AiProviderKey;
  dpaReference: string;
  dpaSignedOn: Date;
  transferMechanism: AiProviderDataTerms["transferMechanism"];
  kvkkTransferMechanism: AiProviderDataTerms["kvkkTransferMechanism"];
  dataRegion: string;
  retentionSetting: string;
  noTraining: boolean;
  recordedById: string;
  recordedAt: Date;
  revokedAt: Date | null;
}

const SELECT = {
  id: true,
  provider: true,
  dpaReference: true,
  dpaSignedOn: true,
  transferMechanism: true,
  kvkkTransferMechanism: true,
  dataRegion: true,
  retentionSetting: true,
  noTraining: true,
  recordedById: true,
  recordedAt: true,
  revokedAt: true,
} as const;

@Injectable()
export class AiDataTermsService {
  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  private async allow(ctx: RequestContext, permission: string): Promise<StaffAccess> {
    const access = await this.access.begin(ctx);
    const target = { type: "ai_provider_terms", id: null };
    const refusal = access.refusal(permission, PLATFORM);
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

  private dto(r: TermsRow, names: Map<string, string>): AiProviderDataTerms {
    return {
      id: r.id,
      provider: r.provider,
      dpaReference: r.dpaReference,
      dpaSignedOn: r.dpaSignedOn.toISOString().slice(0, 10),
      transferMechanism: r.transferMechanism,
      kvkkTransferMechanism: r.kvkkTransferMechanism,
      dataRegion: r.dataRegion,
      retentionSetting: r.retentionSetting,
      noTraining: true,
      recordedAt: r.recordedAt.toISOString(),
      recordedBy: names.get(r.recordedById) ?? "Former staff member",
      revokedAt: r.revokedAt?.toISOString() ?? null,
    };
  }

  private async answer(
    access: StaffAccess,
    provider: AiProviderKey,
    rows: TermsRow[],
  ): Promise<AiProviderDataTermsResponse> {
    const names = await access.staffNames([...new Set(rows.map((r) => r.recordedById))]);
    const history = rows.map((r) => this.dto(r, names));
    return {
      provider,
      current: history.find((h) => h.revokedAt === null) ?? null,
      history,
      canManage: access.allows(MANAGE, PLATFORM),
    };
  }

  private rows(access: StaffAccess, provider: AiProviderKey): Promise<TermsRow[]> {
    return access.staffData(
      (tx) =>
        tx.aiProviderDataTerms.findMany({
          where: { provider },
          orderBy: { recordedAt: "desc" },
          take: 100,
          select: SELECT,
        }) as Promise<TermsRow[]>,
    );
  }

  async get(ctx: RequestContext, rawProvider: string): Promise<AiProviderDataTermsResponse> {
    const access = await this.allow(ctx, "ai:read");
    const provider = this.provider(rawProvider);
    return this.answer(access, provider, await this.rows(access, provider));
  }

  async record(
    ctx: RequestContext,
    rawProvider: string,
    body: unknown,
  ): Promise<AiProviderDataTermsResponse> {
    const access = await this.allow(ctx, MANAGE);
    const provider = this.provider(rawProvider);
    const input = parseBody(AiProviderDataTermsRequestSchema, body);
    const now = this.clock.now();
    await access.staffData(async (tx) => {
      const replaced = await tx.aiProviderDataTerms.updateMany({
        where: { provider, revokedAt: null },
        data: { revokedAt: now, revokedById: access.userId },
      });
      const created = await tx.aiProviderDataTerms.create({
        data: {
          provider,
          dpaReference: input.dpaReference,
          dpaSignedOn: new Date(`${input.dpaSignedOn}T00:00:00Z`),
          transferMechanism: input.transferMechanism,
          kvkkTransferMechanism: input.kvkkTransferMechanism,
          dataRegion: input.dataRegion,
          retentionSetting: input.retentionSetting,
          noTraining: true,
          recordedById: access.userId,
          recordedAt: now,
        },
        select: { id: true },
      });
      await access.audit(tx, {
        action: "ai.provider_terms.recorded",
        resourceType: "ai_provider_terms",
        resourceId: created.id,
        siteId: null,
        permission: MANAGE,
        metadata: aiAuditMetadata({
          provider,
          transferMechanism: input.transferMechanism,
          kvkkTransferMechanism: input.kvkkTransferMechanism,
          replaced: replaced.count,
        }),
      });
    });
    return this.answer(access, provider, await this.rows(access, provider));
  }

  async revoke(ctx: RequestContext, rawProvider: string): Promise<AiProviderDataTermsResponse> {
    const access = await this.allow(ctx, MANAGE);
    const provider = this.provider(rawProvider);
    const now = this.clock.now();
    await access.staffData(async (tx) => {
      const current = await tx.aiProviderDataTerms.findFirst({
        where: { provider, revokedAt: null },
        select: { id: true },
      });
      if (!current) throw new ApiError("CONFLICT_STATE", [{ path: "provider", rule: "no_terms" }]);
      await tx.aiProviderDataTerms.update({
        where: { id: current.id },
        data: { revokedAt: now, revokedById: access.userId },
      });
      await access.audit(tx, {
        action: "ai.provider_terms.revoked",
        resourceType: "ai_provider_terms",
        resourceId: current.id,
        siteId: null,
        permission: MANAGE,
        metadata: aiAuditMetadata({ provider }),
      });
    });
    return this.answer(access, provider, await this.rows(access, provider));
  }
}
