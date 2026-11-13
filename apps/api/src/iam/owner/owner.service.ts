/**
 * System owner (God Mode) console API (DP-108, ADR-018).
 *
 * - Every route except the designation confirmation answers 404 unless the signed-in staff user is
 *   the system owner (SystemOwner record). The refusal is audited as `owner.access_denied`, which
 *   the database files in the PROTECTED stream.
 * - Authorization still goes through `decide` (condition 5): the owner's snapshot carries the
 *   non-assignable `system_owner` grant, so module switches (`module:manage`) and the protected
 *   audit stream (`owner_audit:read`) need a fresh MFA step-up like any sensitive permission.
 * - Module switches (K1, condition 4): only optional modules are switched, always with a reason; a
 *   core module is never disabled (here, and by the ModuleConfiguration trigger). Switching never
 *   deletes data (K-03).
 * - Designation confirmation: the staff user who received the operator's link proves the account
 *   with the current password and a fresh step-up; the SECURITY DEFINER function
 *   iam_owner_designation_confirm checks the token and writes the SystemOwner row. dp_app itself
 *   cannot write that table.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  OwnerDesignationConfirmRequestSchema,
  OwnerModuleChangeRequestSchema,
  type OwnerChainStatus,
  type OwnerDesignationConfirmResponse,
  type OwnerModule,
  type OwnerModuleChangeResponse,
  type OwnerOverviewResponse,
  type ProtectedAuditListResponse,
} from "@dream/contracts";
import { PrismaService } from "../../prisma/prisma.service.js";
import { decide, type AuthorizationSnapshot, type Target } from "../authorization.js";
import { verifyPassword } from "../auth/password.js";
import { AuthThrottleService, STEP_UP_RULE, stepUpThrottleKey } from "../auth/throttle.js";
import { hashToken, isWellFormedToken } from "../auth/tokens.js";
import { MODULES, MODULE_BY_KEY } from "../catalog.js";
import { API_CONFIG, type ApiConfig } from "../http/api-config.js";
import { ApiError, parseBody } from "../http/api-error.js";
import { Clock } from "../http/clock.js";
import type { RequestContext } from "../http/request-context.js";
import { moduleChangeProblem } from "../modules.js";
import { loadAuthorizationSnapshot } from "../repository.js";
import { writeAudit } from "../staff/audit-writer.js";
import { StaffSessionService, isStepUpFresh, type ActiveSession } from "../staff/sessions.js";

const PLATFORM: Target = { scope: "platform" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How the protected stream names the owner as an actor. */
export const OWNER_ACTOR_LABEL = "System owner";
const MAX_PAGE = 100;

interface OwnerContext {
  session: ActiveSession;
  snapshot: AuthorizationSnapshot;
  now: Date;
}

interface ChainRow {
  events: bigint;
  firstBrokenSeq: bigint | null;
  headSeq: bigint;
  headHash: string | null;
}

@Injectable()
export class OwnerService {
  private readonly throttle: AuthThrottleService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(StaffSessionService) private readonly sessions: StaffSessionService,
  ) {
    this.throttle = new AuthThrottleService(prisma);
  }

  // --- access -------------------------------------------------------------------------------

  /** The owner's context, or 404 (audited) for anyone else. */
  private async owner(ctx: RequestContext, area: string): Promise<OwnerContext> {
    const session = await this.sessions.require(ctx);
    const now = this.clock.now();
    const snapshot = await loadAuthorizationSnapshot(this.prisma, session.userId, {
      mfaVerified: isStepUpFresh(session.mfaVerifiedAt, now),
    });
    if (!snapshot?.isSystemOwner || snapshot.principal.status !== "ACTIVE") {
      await writeAudit(this.prisma, {
        actorType: "USER",
        actorUserId: session.userId,
        action: "owner.access_denied",
        resourceType: "owner_console",
        resourceId: area,
        scopeType: "PLATFORM",
        outcome: "DENIED",
        reason: "not_system_owner",
        requestId: ctx.requestId,
      });
      throw new ApiError("NOT_FOUND");
    }
    return { session, snapshot, now };
  }

  /** `decide` for a platform permission; the step-up refusal is distinguishable for the UI. */
  private async require(ctx: RequestContext, owner: OwnerContext, permission: string) {
    const decision = decide(owner.snapshot, permission, PLATFORM, owner.now);
    if (decision.allowed) return;
    await writeAudit(this.prisma, {
      actorType: "USER",
      actorUserId: owner.session.userId,
      action: "owner.access_denied",
      resourceType: "owner_console",
      resourceId: permission,
      scopeType: "PLATFORM",
      outcome: "DENIED",
      reason: decision.reason,
      metadata: { permission },
      requestId: ctx.requestId,
    });
    throw new ApiError(decision.reason === "mfa_required" ? "AUTH_STEP_UP_REQUIRED" : "FORBIDDEN");
  }

  // --- overview -----------------------------------------------------------------------------

  async overview(ctx: RequestContext): Promise<OwnerOverviewResponse> {
    const owner = await this.owner(ctx, "overview");
    await this.require(ctx, owner, "module:read");
    const [record, sites, modules, chain] = await Promise.all([
      this.prisma.systemOwner.findFirstOrThrow({
        select: {
          designatedAt: true,
          user: { select: { id: true, email: true, displayName: true } },
        },
      }),
      this.sites(),
      this.modules(),
      this.chain(owner.now),
    ]);
    return {
      owner: { ...record.user, designatedAt: record.designatedAt.toISOString() },
      sites,
      modules,
      chain,
    };
  }

  private sites() {
    return this.prisma.site.findMany({
      select: { id: true, key: true, name: true },
      orderBy: { key: "asc" },
    });
  }

  private async modules(only?: string): Promise<OwnerModule[]> {
    const sites = await this.sites();
    const configs = await this.prisma.moduleConfiguration.findMany({
      where: only ? { module: { key: only } } : {},
      select: {
        siteId: true,
        enabled: true,
        reason: true,
        updatedAt: true,
        module: { select: { key: true } },
      },
    });
    return MODULES.filter((m) => !only || m.key === only).map((m) => ({
      key: m.key,
      name: m.name,
      description: m.description,
      isCore: m.isCore,
      sites: sites.map((s) => {
        const c = configs.find((x) => x.module.key === m.key && x.siteId === s.id);
        return {
          siteId: s.id,
          enabled: m.isCore || (c?.enabled ?? false),
          reason: c?.reason ?? null,
          updatedAt: c?.updatedAt.toISOString() ?? null,
        };
      }),
    }));
  }

  // --- module switches ----------------------------------------------------------------------

  async changeModule(
    ctx: RequestContext,
    rawModuleKey: string,
    rawSiteId: string,
    body: unknown,
  ): Promise<OwnerModuleChangeResponse> {
    const owner = await this.owner(ctx, "modules");
    await this.require(ctx, owner, "module:manage");
    const req = parseBody(OwnerModuleChangeRequestSchema, body);
    const mod = MODULE_BY_KEY.get(rawModuleKey);
    const siteId = UUID.test(rawSiteId) ? rawSiteId.toLowerCase() : null;
    const site = siteId
      ? await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true } })
      : null;
    if (!mod || !site) throw new ApiError("NOT_FOUND");
    const problem = moduleChangeProblem({
      moduleKey: mod.key,
      enabled: req.enabled,
      reason: req.reason,
    });
    if (problem) {
      await writeAudit(this.prisma, {
        actorType: "USER",
        actorUserId: owner.session.userId,
        action: "owner.module_changed",
        resourceType: "feature_module",
        resourceId: mod.key,
        scopeType: "SITE",
        siteId: site.id,
        outcome: "DENIED",
        reason: problem,
        metadata: { permission: "module:manage", enabled: req.enabled },
        requestId: ctx.requestId,
      });
      throw new ApiError("VALIDATION_FAILED", [{ path: "enabled", rule: problem }]);
    }
    if (mod.isCore) {
      // Enabling a core module changes nothing: it is always on.
      return { module: (await this.modules(mod.key))[0]!, changed: false };
    }
    const moduleRow = await this.prisma.featureModule.findUniqueOrThrow({
      where: { key: mod.key },
      select: { id: true },
    });
    const current = await this.prisma.moduleConfiguration.findUnique({
      where: { moduleId_siteId: { moduleId: moduleRow.id, siteId: site.id } },
      select: { enabled: true },
    });
    const previous = current?.enabled ?? false;
    const changed = previous !== req.enabled;
    if (changed) {
      await this.prisma.$transaction(async (tx) => {
        await tx.moduleConfiguration.upsert({
          where: { moduleId_siteId: { moduleId: moduleRow.id, siteId: site.id } },
          create: {
            moduleId: moduleRow.id,
            siteId: site.id,
            enabled: req.enabled,
            reason: req.reason,
            updatedById: owner.session.userId,
          },
          update: { enabled: req.enabled, reason: req.reason, updatedById: owner.session.userId },
        });
        await writeAudit(tx, {
          actorType: "USER",
          actorUserId: owner.session.userId,
          action: "owner.module_changed",
          resourceType: "feature_module",
          resourceId: mod.key,
          scopeType: "SITE",
          siteId: site.id,
          outcome: "SUCCESS",
          reason: req.reason,
          metadata: { permission: "module:manage", enabled: req.enabled, previous },
          requestId: ctx.requestId,
        });
      });
    }
    return { module: (await this.modules(mod.key))[0]!, changed };
  }

  // --- protected audit stream ---------------------------------------------------------------

  async audit(
    ctx: RequestContext,
    query: { before?: string; limit?: string },
  ): Promise<ProtectedAuditListResponse> {
    const owner = await this.owner(ctx, "audit");
    await this.require(ctx, owner, "owner_audit:read");
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    const before = query.before === undefined ? null : Number(query.before);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
      throw new ApiError("VALIDATION_FAILED", [{ path: "limit", rule: "range" }]);
    }
    if (before !== null && (!Number.isInteger(before) || before < 1)) {
      throw new ApiError("VALIDATION_FAILED", [{ path: "before", rule: "range" }]);
    }
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        stream: "PROTECTED",
        ...(before !== null ? { chainSeq: { lt: BigInt(before) } } : {}),
      },
      orderBy: { chainSeq: "desc" },
      take: limit + 1,
      select: {
        id: true,
        chainSeq: true,
        occurredAt: true,
        actorType: true,
        actorUserId: true,
        action: true,
        resourceType: true,
        resourceId: true,
        scopeType: true,
        siteId: true,
        outcome: true,
        reason: true,
        metadata: true,
        rowHash: true,
        actor: { select: { displayName: true, email: true } },
      },
    });
    const page = rows.slice(0, limit);
    const ownerId = owner.session.userId;
    return {
      items: page.map((e) => ({
        id: e.id,
        chainSeq: Number(e.chainSeq),
        occurredAt: e.occurredAt.toISOString(),
        actorType: e.actorType,
        actorUserId: e.actorUserId,
        actorLabel:
          e.actorUserId === ownerId
            ? OWNER_ACTOR_LABEL
            : e.actor
              ? (e.actor.displayName ?? e.actor.email)
              : null,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        scopeType: e.scopeType,
        siteId: e.siteId,
        outcome: e.outcome,
        reason: e.reason,
        metadata:
          e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata)
            ? (e.metadata as Record<string, unknown>)
            : {},
        rowHash: e.rowHash ?? "",
      })),
      nextBefore:
        rows.length > limit && page.length ? Number(page[page.length - 1]!.chainSeq) : null,
    };
  }

  async verify(ctx: RequestContext): Promise<OwnerChainStatus> {
    const owner = await this.owner(ctx, "audit_verify");
    await this.require(ctx, owner, "owner_audit:read");
    const status = await this.chain(owner.now);
    await writeAudit(this.prisma, {
      actorType: "USER",
      actorUserId: owner.session.userId,
      action: "owner.audit_chain_verified",
      resourceType: "audit_chain",
      scopeType: "PLATFORM",
      outcome: status.intact ? "SUCCESS" : "FAILURE",
      ...(status.intact ? {} : { reason: "chain_broken" }),
      metadata: {
        events: status.events,
        headSeq: status.headSeq,
        headHash: status.headHash,
        firstBrokenSeq: status.firstBrokenSeq,
      },
      requestId: ctx.requestId,
    });
    return status;
  }

  private async chain(now: Date): Promise<OwnerChainStatus> {
    const rows = await this.prisma.$queryRaw<ChainRow[]>`
      SELECT "events", "firstBrokenSeq", "headSeq", "headHash" FROM iam_verify_protected_audit_chain()`;
    const r = rows[0];
    if (!r) throw new Error("iam_verify_protected_audit_chain returned no row");
    return {
      events: Number(r.events),
      intact: r.firstBrokenSeq === null,
      firstBrokenSeq: r.firstBrokenSeq === null ? null : Number(r.firstBrokenSeq),
      headSeq: Number(r.headSeq),
      headHash: r.headHash,
      checkedAt: now.toISOString(),
    };
  }

  // --- designation confirmation -------------------------------------------------------------

  async confirmDesignation(
    ctx: RequestContext,
    body: unknown,
  ): Promise<OwnerDesignationConfirmResponse> {
    const session = await this.sessions.require(ctx);
    const now = this.clock.now();
    if (!isStepUpFresh(session.mfaVerifiedAt, now)) throw new ApiError("AUTH_STEP_UP_REQUIRED");
    const req = parseBody(OwnerDesignationConfirmRequestSchema, body);
    const key = stepUpThrottleKey(this.config.secrets.hmacKey, session.userId);
    const gate = await this.throttle.checkKeys([key], now);
    if (!gate.allowed) {
      throw new ApiError("RATE_LIMITED", [], { "Retry-After": String(gate.retryAfterSec) });
    }
    const deny = (reason: string) =>
      writeAudit(this.prisma, {
        actorType: "USER",
        actorUserId: session.userId,
        action: "owner.designation_denied",
        resourceType: "user",
        resourceId: session.userId,
        scopeType: "PLATFORM",
        outcome: "DENIED",
        reason,
        requestId: ctx.requestId,
      });
    const password = session.user.passwordHash
      ? await verifyPassword(session.user.passwordHash, req.password)
      : { ok: false };
    if (!password.ok) {
      await this.throttle.recordSingleFailure(key, STEP_UP_RULE, now);
      await deny("wrong_password");
      throw new ApiError("AUTH_INVALID_CREDENTIALS");
    }
    if (!isWellFormedToken(req.token)) {
      await deny("token_invalid");
      throw new ApiError("AUTH_TOKEN_INVALID");
    }
    const rows = await this.prisma.$queryRaw<{ result: string }[]>`
      SELECT iam_owner_designation_confirm(${session.userId}::uuid, ${hashToken(req.token)}, ${ctx.requestId}) AS result`;
    const result = rows[0]?.result;
    if (result === "designated") return { designated: true };
    await deny(result === "invalid" ? "token_invalid" : (result ?? "unknown"));
    if (result === "invalid") throw new ApiError("AUTH_TOKEN_INVALID");
    throw new ApiError("CONFLICT_STATE", [{ path: "(root)", rule: result ?? "unknown" }]);
  }
}
