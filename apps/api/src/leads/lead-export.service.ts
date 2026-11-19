/**
 * CSV export of the filtered leads (DP-227; owner brief "CRM CSV Export", 2026-11-19).
 *
 * Who: the existing `lead:export` permission (catalog, ADR-017): customer-data officer, platform
 * super admin and the system owner, on every site the filters select. It is a sensitive
 * permission, so the session needs a fresh MFA step-up (AUTH_STEP_UP_REQUIRED otherwise). The rows
 * themselves are read through lead:read and the session's database context (row-level security,
 * DP-103), so the database only ever hands out leads the caller may read.
 *
 * What: the same filters as the list (lead-filters.ts), newest first, at most
 * LEAD_EXPORT_MAX_ROWS leads. Columns: LEAD_EXPORT_COLUMNS. Message text, marketing consent and
 * consent evidence are never exported. An anonymised lead keeps its id, dates, source, status and
 * site; its personal fields are empty.
 *
 * Audit: `leads.exported` is written BEFORE the first byte (an export that started is always on
 * record), with the row count, the filter kinds (never the search text) and the role assignments
 * that allowed it. Refusals are DENIED events (step-up, no grant).
 *
 * Memory: the file streams in batches of LEAD_EXPORT_BATCH_SIZE (keyset pagination); nothing
 * holds the whole file. No row content is ever logged.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  LEAD_EXPORT_BATCH_SIZE,
  LEAD_EXPORT_COLUMNS,
  LEAD_EXPORT_MAX_DOCUMENTS,
  LEAD_EXPORT_MAX_ROWS,
  type LeadExportSummaryResponse,
  type LeadSource,
  type LeadStatus,
} from "@dream/contracts";
import { ApiError } from "../iam/http/api-error.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import type { SiteScopedClient } from "../iam/site-scope.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { CSV_BOM, csvDateTime, csvLine, exportFilename } from "./lead-export-csv.js";
import { resolveLeadFilter, type LeadFilterQuery, type LeadWhere } from "./lead-filters.js";

export const LEAD_EXPORT = "lead:export";

export interface LeadExport {
  filename: string;
  count: number;
  /** The file, in pieces: the BOM and header first, then one piece per batch. */
  chunks: AsyncGenerator<string, void, undefined>;
}

interface ExportLead {
  id: string;
  siteId: string;
  email: string;
  fullName: string;
  company: string;
  country: string;
  source: LeadSource;
  status: LeadStatus;
  createdAt: Date;
  lastRequestAt: Date;
  anonymisedAt: Date | null;
}

const EXPORT_SELECT = {
  id: true,
  siteId: true,
  email: true,
  fullName: true,
  company: true,
  country: true,
  source: true,
  status: true,
  createdAt: true,
  lastRequestAt: true,
  anonymisedAt: true,
} as const;

@Injectable()
export class LeadExportService {
  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** Sites of the filter where the caller holds lead:export (step-up aside). */
  private holdsExport(access: StaffAccess, siteIds: readonly string[]): boolean {
    return siteIds.every((siteId) => {
      const reason = access.refusal(LEAD_EXPORT, { scope: "site", siteId });
      return reason === null || reason === "mfa_required";
    });
  }

  private count(access: StaffAccess, siteIds: string[], where: LeadWhere): Promise<number> {
    return access.leadData({ siteIds, includePlatform: false }, (tx) => tx.lead.count({ where }));
  }

  /** How many leads the filters match, and whether the caller may export them (lead:read). */
  async summary(ctx: RequestContext, query: LeadFilterQuery): Promise<LeadExportSummaryResponse> {
    const access = await this.access.begin(ctx);
    const filter = await resolveLeadFilter(access, query);
    const count = await this.count(access, filter.siteIds, filter.where);
    return {
      count,
      maxRows: LEAD_EXPORT_MAX_ROWS,
      canExport: this.holdsExport(access, filter.siteIds),
    };
  }

  async open(ctx: RequestContext, query: LeadFilterQuery): Promise<LeadExport> {
    const access = await this.access.begin(ctx);
    const filter = await resolveLeadFilter(access, query);
    const { siteIds, where } = filter;
    for (const siteId of siteIds) {
      const reason = access.refusal(LEAD_EXPORT, { scope: "site", siteId });
      if (reason === null) continue;
      await access.denied(LEAD_EXPORT, { type: "lead", id: null }, reason, {
        scope: "site",
        siteId,
      });
      throw new ApiError(reason === "mfa_required" ? "AUTH_STEP_UP_REQUIRED" : "FORBIDDEN");
    }
    const count = await this.count(access, siteIds, where);
    const auditDb =
      siteIds.length === 1
        ? access.db({ siteIds, includePlatform: false })
        : access.db({ siteIds, includePlatform: true });
    const base = {
      action: "leads.exported",
      resourceType: "lead",
      resourceId: null,
      siteId: siteIds.length === 1 ? (siteIds[0] as string) : null,
      permission: LEAD_EXPORT,
    };
    const metadata = {
      siteIds,
      count,
      format: "csv",
      columns: LEAD_EXPORT_COLUMNS.length,
      ...filter.audit,
      accessAssignmentIds: access.grantRefs(LEAD_EXPORT, siteIds),
    };
    if (count > LEAD_EXPORT_MAX_ROWS) {
      await access.audit(auditDb, { ...base, metadata, failure: { reason: "too_many_rows" } });
      throw new ApiError("VALIDATION_FAILED", [{ path: "filters", rule: "too_many_rows" }]);
    }
    await access.audit(auditDb, { ...base, metadata });
    const keyOf = new Map(access.sites.map((s) => [s.id, s.key]));
    const label = siteIds.length === 1 ? (keyOf.get(siteIds[0] as string) ?? "site") : "all";
    return {
      filename: exportFilename(label, this.clock.now()),
      count,
      chunks: this.rows(access, siteIds, where, count, keyOf),
    };
  }

  private async *rows(
    access: StaffAccess,
    siteIds: string[],
    where: LeadWhere,
    limit: number,
    keyOf: Map<string, string>,
  ): AsyncGenerator<string, void, undefined> {
    yield CSV_BOM + csvLine(LEAD_EXPORT_COLUMNS);
    const scope = { siteIds, includePlatform: false };
    const db = access.db(scope);
    let cursor: { at: Date; id: string } | null = null;
    let written = 0;
    while (written < limit) {
      const take = Math.min(LEAD_EXPORT_BATCH_SIZE, limit - written);
      const after = cursor;
      const batch = await access.leadData(scope, async (tx) => {
        const leads: ExportLead[] = await tx.lead.findMany({
          where: {
            ...where,
            ...(after
              ? {
                  AND: [
                    {
                      OR: [
                        { lastRequestAt: { lt: after.at } },
                        { lastRequestAt: after.at, id: { lt: after.id } },
                      ],
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ lastRequestAt: "desc" }, { id: "desc" }],
          take,
          select: EXPORT_SELECT,
        });
        const ids = leads.map((l) => l.id);
        if (ids.length === 0) return { leads, messages: [], requests: [] };
        const [messages, requests] = await Promise.all([
          tx.leadContactMessage.findMany({
            where: { leadId: { in: ids } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { leadId: true, phone: true, subject: true },
          }),
          tx.leadDocumentRequest.findMany({
            where: { leadId: { in: ids } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { leadId: true, productId: true, documentId: true },
          }),
        ]);
        return { leads, messages, requests };
      });
      if (batch.leads.length === 0) break;
      const lines = await this.lines(db, batch, keyOf);
      written += batch.leads.length;
      const last = batch.leads[batch.leads.length - 1] as ExportLead;
      cursor = { at: last.lastRequestAt, id: last.id };
      yield lines;
      if (batch.leads.length < take) break;
    }
  }

  private async lines(
    db: SiteScopedClient,
    batch: {
      leads: ExportLead[];
      messages: { leadId: string; phone: string | null; subject: string | null }[];
      requests: { leadId: string; productId: string; documentId: string }[];
    },
    keyOf: Map<string, string>,
  ): Promise<string> {
    const [products, documents] = await Promise.all([
      db.product.findMany({
        where: { id: { in: [...new Set(batch.requests.map((r) => r.productId))] } },
        select: { id: true, code: true, name: true },
      }),
      db.productDocument.findMany({
        where: { id: { in: [...new Set(batch.requests.map((r) => r.documentId))] } },
        select: { id: true, title: true },
      }),
    ]);
    const productOf = new Map(products.map((p) => [p.id, p]));
    const documentOf = new Map(documents.map((d) => [d.id, d]));
    // The newest phone and subject of a lead's contact messages (rows come newest first).
    const phoneOf = new Map<string, string>();
    const subjectOf = new Map<string, string>();
    for (const m of batch.messages) {
      if (m.phone && !phoneOf.has(m.leadId)) phoneOf.set(m.leadId, m.phone);
      if (m.subject && !subjectOf.has(m.leadId)) subjectOf.set(m.leadId, m.subject);
    }
    const docsOf = new Map<string, string[]>();
    const seen = new Set<string>();
    for (const r of batch.requests) {
      const key = `${r.leadId}|${r.productId}|${r.documentId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = docsOf.get(r.leadId) ?? [];
      if (list.length >= LEAD_EXPORT_MAX_DOCUMENTS) continue;
      const p = productOf.get(r.productId);
      const d = documentOf.get(r.documentId);
      const product = p ? `${p.code} ${p.name}`.trim() : "Product";
      list.push(d?.title ? `${product}: ${d.title}` : product);
      docsOf.set(r.leadId, list);
    }
    let out = "";
    for (const l of batch.leads) {
      const anonymised = l.anonymisedAt !== null;
      out += csvLine([
        l.id,
        csvDateTime(l.createdAt),
        l.source,
        anonymised ? "" : l.fullName,
        anonymised ? "" : l.company,
        anonymised ? "" : l.email,
        anonymised ? "" : (phoneOf.get(l.id) ?? ""),
        l.country,
        anonymised ? "" : (subjectOf.get(l.id) ?? ""),
        l.status,
        keyOf.get(l.siteId) ?? "",
        (docsOf.get(l.id) ?? []).join(" | "),
      ]);
    }
    return out;
  }
}
