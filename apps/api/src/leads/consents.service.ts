/**
 * DP-298 (ADR-031 D4): consent records of a lead — separate from the notices.
 *
 * - A notice (information) is acknowledged with the form and stays on the request row (version +
 *   SHA-256). A consent is optional and withdrawable: one `ConsentRecord` row per grant or
 *   withdrawal, append-only; the latest row per purpose is the state.
 * - Grants come only from the data subject through a form (`grantFromDocumentRequest`, in the
 *   form's own transaction, public row-level security context). Staff never grant on someone's
 *   behalf; they record a WITHDRAWAL that reached the company (e-mail, phone, letter, in person)
 *   with `lead:manage` on the lead's site. The channel is a code: no free text, so a record holds
 *   no personal data and stays as evidence after anonymisation.
 * - `Lead.marketingConsentAt` keeps its DP-096 meaning (when consent was last given; it extends
 *   retention); whether marketing may be sent is the state here, never that column.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  ConsentPurposeSchema,
  ConsentWithdrawRequestSchema,
  UuidSchema,
  consentStates,
  type ConsentPurpose,
  type ConsentRecord,
  type LeadConsentsResponse,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import type { SiteScopedClient } from "../iam/site-scope.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";

const READ = "lead:read";
const MANAGE = "lead:manage";
const HISTORY_LIMIT = 500;

/** A refusal of the consent guard or of row-level security: answered 409, never a 500. */
const DB_REFUSAL = /consents: |row-level security|insufficient_privilege|42501|23514/;
function isDbRefusal(error: unknown): boolean {
  const seen = new Set<unknown>();
  let e: unknown = error;
  while (e && typeof e === "object" && !seen.has(e)) {
    seen.add(e);
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string" && DB_REFUSAL.test(msg)) return true;
    const meta = (e as { meta?: unknown }).meta;
    if (meta && DB_REFUSAL.test(JSON.stringify(meta))) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

const RECORD_SELECT = {
  id: true,
  purpose: true,
  action: true,
  source: true,
  textVersion: true,
  textSha256: true,
  sourceRecordId: true,
  channel: true,
  actorId: true,
  createdAt: true,
} as const;

interface RecordRow {
  id: string;
  purpose: ConsentPurpose;
  action: ConsentRecord["action"];
  source: ConsentRecord["source"];
  textVersion: string | null;
  textSha256: string | null;
  sourceRecordId: string | null;
  channel: ConsentRecord["channel"];
  actorId: string | null;
  createdAt: Date;
}

/** What a form transaction writes for a ticked consent box (public context, same transaction). */
export interface ConsentGrant {
  leadId: string;
  siteId: string;
  purpose: ConsentPurpose;
  source: "DOCUMENT_REQUEST" | "CONTACT_FORM";
  sourceRecordId: string;
  textVersion: string;
  textSha256: string;
  at: Date;
}

/** Writes a grant inside the form's transaction (the guard checks it names its form row). */
export async function grantConsent(tx: SiteScopedClient, g: ConsentGrant): Promise<void> {
  await tx.consentRecord.create({
    data: {
      leadId: g.leadId,
      siteId: g.siteId,
      purpose: g.purpose,
      action: "GRANTED",
      source: g.source,
      textVersion: g.textVersion,
      textSha256: g.textSha256,
      sourceRecordId: g.sourceRecordId,
      createdAt: g.at,
    },
    select: { id: true },
  });
}

@Injectable()
export class LeadConsentsService {
  constructor(@Inject(StaffAccessService) private readonly access: StaffAccessService) {}

  private async sites(access: StaffAccess, permission: string): Promise<string[]> {
    const ids = access.sitesWith(permission);
    if (ids.length === 0) {
      await access.require(permission, { scope: "platform" }, { type: "lead", id: null });
    }
    return ids;
  }

  private view(row: RecordRow, names: Map<string, string>): ConsentRecord {
    return {
      id: row.id,
      purpose: row.purpose,
      action: row.action,
      source: row.source,
      textVersion: row.textVersion,
      textSha256: row.textSha256,
      sourceRecordId: row.sourceRecordId,
      channel: row.channel,
      actor: row.actorId
        ? { id: row.actorId, displayName: names.get(row.actorId) ?? "Former staff member" }
        : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async read(
    access: StaffAccess,
    tx: SiteScopedClient,
    leadId: string,
    siteIds: string[],
  ): Promise<{ lead: { siteId: string; anonymisedAt: Date | null }; rows: RecordRow[] } | null> {
    const lead = await tx.lead.findFirst({
      where: { id: leadId, siteId: { in: siteIds } },
      select: { siteId: true, anonymisedAt: true },
    });
    if (!lead) return null;
    const rows: RecordRow[] = await tx.consentRecord.findMany({
      where: { leadId, siteId: lead.siteId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: HISTORY_LIMIT,
      select: RECORD_SELECT,
    });
    return { lead, rows };
  }

  private async answer(
    access: StaffAccess,
    lead: { siteId: string; anonymisedAt: Date | null },
    rows: RecordRow[],
  ): Promise<LeadConsentsResponse> {
    const actorIds = [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
    const names = await access.staffNames(actorIds);
    const history = rows.map((r) => this.view(r, names));
    return {
      states: consentStates(history),
      history,
      canWithdraw: lead.anonymisedAt === null && access.sitesWith(MANAGE).includes(lead.siteId),
    };
  }

  /** GET /admin/leads/:id/consents (lead:read on the lead's site; audited, no personal data). */
  async list(ctx: RequestContext, rawId: string): Promise<LeadConsentsResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.sites(access, READ);
    if (!UuidSchema.safeParse(rawId).success) throw new ApiError("NOT_FOUND");
    const id = rawId.toLowerCase();
    const found = await access.leadData({ siteIds, includePlatform: false }, (tx) =>
      this.read(access, tx, id, siteIds),
    );
    if (!found) {
      await access.denied(READ, { type: "lead", id }, "not_found_or_other_site");
      throw new ApiError("NOT_FOUND");
    }
    await access.audit(access.db({ siteIds: [found.lead.siteId], includePlatform: false }), {
      action: "leads.consents_viewed",
      resourceType: "lead",
      resourceId: id,
      siteId: found.lead.siteId,
      permission: READ,
      metadata: {
        records: found.rows.length,
        accessAssignmentIds: access.grantRefs(READ, [found.lead.siteId]),
      },
    });
    return this.answer(access, found.lead, found.rows);
  }

  /**
   * POST /admin/leads/:id/consents/:purpose/withdraw (lead:manage). Only a GRANTED purpose can
   * be withdrawn (409 `not_granted` otherwise); the database checks the same and that the actor
   * is the session's own user.
   */
  async withdraw(
    ctx: RequestContext,
    rawId: string,
    rawPurpose: string,
    body: unknown,
  ): Promise<LeadConsentsResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.sites(access, MANAGE);
    if (!UuidSchema.safeParse(rawId).success) throw new ApiError("NOT_FOUND");
    const purpose = ConsentPurposeSchema.safeParse(rawPurpose);
    if (!purpose.success) throw new ApiError("NOT_FOUND");
    const input = parseBody(ConsentWithdrawRequestSchema, body);
    const id = rawId.toLowerCase();
    try {
      const out = await access.leadData({ siteIds, includePlatform: false }, async (tx) => {
        const found = await this.read(access, tx, id, siteIds);
        if (!found) return null;
        if (found.lead.anonymisedAt) {
          throw new ApiError("CONFLICT_STATE", [{ path: "lead", rule: "anonymised" }]);
        }
        const latest = found.rows.find((r) => r.purpose === purpose.data);
        if (latest?.action !== "GRANTED") {
          throw new ApiError("CONFLICT_STATE", [{ path: "purpose", rule: "not_granted" }]);
        }
        const created: RecordRow = await tx.consentRecord.create({
          data: {
            leadId: id,
            siteId: found.lead.siteId,
            purpose: purpose.data,
            action: "WITHDRAWN",
            source: "STAFF",
            channel: input.channel,
            actorId: access.userId,
          },
          select: RECORD_SELECT,
        });
        await access.audit(tx, {
          action: "leads.consent_withdrawn",
          resourceType: "lead",
          resourceId: id,
          siteId: found.lead.siteId,
          permission: MANAGE,
          metadata: {
            consentRecordId: created.id,
            purpose: purpose.data,
            channel: input.channel,
            accessAssignmentIds: access.grantRefs(MANAGE, [found.lead.siteId]),
          },
        });
        return { lead: found.lead, rows: [created, ...found.rows] };
      });
      if (!out) {
        await access.denied(MANAGE, { type: "lead", id }, "not_found_or_other_site");
        throw new ApiError("NOT_FOUND");
      }
      return this.answer(access, out.lead, out.rows);
    } catch (error) {
      if (error instanceof ApiError || !isDbRefusal(error)) throw error;
      await access.denied(MANAGE, { type: "lead", id }, "db_guard");
      throw new ApiError("CONFLICT_STATE", [{ path: "lead", rule: "db_guard" }]);
    }
  }
}
