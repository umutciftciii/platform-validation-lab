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
 * - DP-307: revoking (and renewing, which revokes) first takes the provider's EXCLUSIVE terms gate
 *   (ai_provider_terms_lock; the guard trigger refuses a revocation without it). It waits for the
 *   dispatches that hold the gate (each at most until its request was handed to the transport,
 *   DP-297, DISPATCH_HANDOFF_MS), bounded by TERMS_LOCK_TIMEOUT_MS (then 409 `terms_busy`, nothing
 *   changed); every dispatch after the COMMIT sees the record revoked and sends nothing.
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
import { transientDbRule } from "../iam/bounded-transaction.js";
import { aiAuditMetadata } from "./audit.js";
import { sqlProviderTermsLock } from "./ledger-sql.js";
import type { Db } from "../iam/db.js";

const PLATFORM = { scope: "platform" } as const;
const MANAGE = "module:manage";

/**
 * DP-307: the longest wait for the terms gate. A dispatch holds it until its request is with the
 * transport (≤ DISPATCH_HANDOFF_MS = 2 s, then rolled back); the bound stays below Prisma's 5 s
 * interactive-transaction limit of staffData, so the wait ends as a lock timeout (55P03), not as
 * an expired transaction.
 */
export const TERMS_LOCK_TIMEOUT_MS = 4_000;

/** DP-307: the provider's exclusive terms gate, before any revocation in this transaction. */
const lockTerms = (tx: unknown, provider: AiProviderKey) =>
  sqlProviderTermsLock(tx as Db, provider, TERMS_LOCK_TIMEOUT_MS);

/** A lock wait over the bound (dispatches holding the gate): 409, nothing changed; retry later. */
function busy(error: unknown): never {
  if (transientDbRule(error) === "locked") {
    throw new ApiError("CONFLICT_STATE", [{ path: "provider", rule: "terms_busy" }]);
  }
  throw error;
}

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
    await access
      .staffData(async (tx) => {
        await lockTerms(tx, provider);
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
      })
      .catch(busy);
    return this.answer(access, provider, await this.rows(access, provider));
  }

  async revoke(ctx: RequestContext, rawProvider: string): Promise<AiProviderDataTermsResponse> {
    const access = await this.allow(ctx, MANAGE);
    const provider = this.provider(rawProvider);
    const now = this.clock.now();
    await access
      .staffData(async (tx) => {
        await lockTerms(tx, provider);
        const current = await tx.aiProviderDataTerms.findFirst({
          where: { provider, revokedAt: null },
          select: { id: true },
        });
        if (!current)
          throw new ApiError("CONFLICT_STATE", [{ path: "provider", rule: "no_terms" }]);
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
      })
      .catch(busy);
    return this.answer(access, provider, await this.rows(access, provider));
  }
}
