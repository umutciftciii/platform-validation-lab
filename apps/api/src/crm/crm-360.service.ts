/**
 * CRM 360° views (CRM-3, ADR-032 D11): the overview, the people list, a person's profile and a
 * company's leads, requests and contact history.
 *
 * Read-only views over the CRM-1/CRM-2 records and the lead core; nothing here writes and there
 * is no table of its own. A person's name, e-mail address and phone come from their leads (the
 * newest live lead, the newest contact-form message with a phone), so lead retention still
 * clears them (DP-096). Requests are the document requests and contact-form messages of the
 * leads; notes, logged contacts and sales steps are the lead history (DP-041).
 *
 * Reading needs `crm:read` and `lead:read` on the site, like CRM-2's people; the overview's
 * company counts need `crm:read` only. Row-level security decides again from the session. Every
 * view is audited with ids and counts only (never names, addresses or search text).
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  CRM_360_LIMIT,
  CRM_COMPANY_SEARCH_MAX,
  CRM_OVERVIEW_RECENT,
  CRM_PEOPLE_PAGE_SIZE,
  CrmOwnerFilterSchema,
  CrmPeopleCompanyFilterSchema,
  LeadStatusSchema,
  UuidSchema,
  type CrmCompanyLeadsResponse,
  type CrmContactEntry,
  type CrmContactHistoryResponse,
  type CrmDocumentRequest,
  type CrmLeadEvent,
  type CrmLeadNote,
  type CrmLeadRecord,
  type CrmOverviewResponse,
  type CrmPeopleListResponse,
  type CrmPersonProfileResponse,
  type CrmPersonSummary,
} from "@dream/contracts";
import { ApiError } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import type { SiteScopedClient } from "../iam/site-scope.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { CRM_READ, CrmCompaniesService } from "./crm-companies.service.js";
import { CrmPeopleService, PERSON_SELECT, type PersonRow } from "./crm-people.service.js";

const LEAD_READ = "lead:read";

/** Filter types of the site-scoped client (the unscoped Prisma client is not imported here). */
type WhereOf<M extends "crmPerson" | "crmCompany" | "lead"> = NonNullable<
  NonNullable<Parameters<SiteScopedClient[M]["findMany"]>[0]>["where"]
>;
const FORMER = "Former staff member";

const invalid = (path: string, rule = "invalid") =>
  new ApiError("VALIDATION_FAILED", [{ path, rule }]);

export interface CrmPeopleListQuery {
  siteId?: string | undefined;
  q?: string | undefined;
  company?: string | undefined;
  owner?: string | undefined;
  status?: string | undefined;
  cursor?: string | undefined;
}

/** Cursor of the people list: base64url of the last person's id (newest people first). */
function decodeIdCursor(raw: string): string {
  const id = Buffer.from(raw, "base64url").toString("utf8");
  if (!UuidSchema.safeParse(id).success) throw invalid("cursor");
  return id.toLowerCase();
}

const RECORD_SELECT = {
  id: true,
  siteId: true,
  fullName: true,
  email: true,
  company: true,
  country: true,
  source: true,
  status: true,
  assignedToId: true,
  requestCount: true,
  firstRequestAt: true,
  lastRequestAt: true,
  anonymisedAt: true,
} as const;

interface RecordRow {
  id: string;
  siteId: string;
  fullName: string;
  email: string;
  company: string;
  country: string;
  source: CrmLeadRecord["source"];
  status: CrmLeadRecord["status"];
  assignedToId: string | null;
  requestCount: number;
  firstRequestAt: Date;
  lastRequestAt: Date;
  anonymisedAt: Date | null;
}

type PersonRef = { id: string; displayName: string | null };

/** What `collect` reads for a set of leads of one site. */
interface Collected {
  records: CrmLeadRecord[];
  recordsTruncated: boolean;
  contacts: CrmContactEntry[];
  contactsTruncated: boolean;
  notes: CrmLeadNote[];
  events: CrmLeadEvent[];
  phone: string | null;
}

const label = (l: { fullName: string; email: string; anonymisedAt: Date | null } | undefined) =>
  l && !l.anonymisedAt ? `${l.fullName} <${l.email}>` : null;

@Injectable()
export class Crm360Service {
  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(CrmPeopleService) private readonly people: CrmPeopleService,
    @Inject(CrmCompaniesService) private readonly companies: CrmCompaniesService,
  ) {}

  /** Sites where the caller reads people: crm:read and lead:read (no refusal). */
  private peopleSites(access: StaffAccess): string[] {
    const leads = new Set(access.sitesWith(LEAD_READ));
    return access.sitesWith(CRM_READ).filter((s) => leads.has(s));
  }

  private siteKey(access: StaffAccess, siteId: string): "BV" | "CORPORATE" {
    return access.sites.find((s) => s.id === siteId)?.key ?? "BV";
  }

  private auditDb(access: StaffAccess, siteIds: readonly string[]) {
    return siteIds.length === 1
      ? access.db({ siteIds: [...siteIds], includePlatform: false })
      : access.db({ siteIds: [...siteIds], includePlatform: true });
  }

  // --- overview --------------------------------------------------------------------------------

  async overview(ctx: RequestContext): Promise<CrmOverviewResponse> {
    const access = await this.access.begin(ctx);
    const crmSites = access.sitesWith(CRM_READ);
    if (crmSites.length === 0) {
      await access.require(CRM_READ, { scope: "platform" }, { type: "crm_company", id: null });
    }
    const peopleSites = this.peopleSites(access);
    const counts = await access.crmData(
      { siteIds: crmSites, includePlatform: false },
      async (tx) => {
        const inSites = { siteId: { in: crmSites } };
        const [companies, myCompanies, companiesWithoutOwner] = await Promise.all([
          tx.crmCompany.count({ where: inSites }),
          tx.crmCompany.count({ where: { ...inSites, ownerUserId: access.userId } }),
          tx.crmCompany.count({ where: { ...inSites, ownerUserId: null } }),
        ]);
        let people: number | null = null;
        let peopleWithoutCompany: number | null = null;
        if (peopleSites.length > 0) {
          // People are shown through their leads: a person without leads is not counted.
          const base = { siteId: { in: peopleSites }, leads: { some: {} } };
          [people, peopleWithoutCompany] = await Promise.all([
            tx.crmPerson.count({ where: base }),
            tx.crmPerson.count({ where: { ...base, companyId: null } }),
          ]);
        }
        return { companies, myCompanies, companiesWithoutOwner, people, peopleWithoutCompany };
      },
    );
    const recentCompanies = await this.companies.recent(access, crmSites, CRM_OVERVIEW_RECENT);
    await access.audit(this.auditDb(access, crmSites), {
      action: "crm.overview_viewed",
      resourceType: "crm_company",
      resourceId: null,
      siteId: crmSites.length === 1 ? (crmSites[0] as string) : null,
      permission: CRM_READ,
      metadata: {
        siteIds: crmSites,
        recent: recentCompanies.length,
        people: counts.people !== null,
        accessAssignmentIds: access.grantRefs(CRM_READ, crmSites),
      },
    });
    return {
      sites: access.sites
        .filter((s) => crmSites.includes(s.id))
        .map((s) => ({ id: s.id, key: s.key, name: s.name })),
      counts,
      recentCompanies,
    };
  }

  // --- people list -----------------------------------------------------------------------------

  async listPeople(ctx: RequestContext, query: CrmPeopleListQuery): Promise<CrmPeopleListResponse> {
    const access = await this.access.begin(ctx);
    const readable = await this.people.readSites(access);
    let siteIds = readable;
    if (query.siteId !== undefined) {
      const wanted = query.siteId.toLowerCase();
      if (!readable.includes(wanted)) {
        await access.require(
          CRM_READ,
          { scope: "site", siteId: wanted },
          { type: "crm_person", id: null },
        );
        await access.require(
          LEAD_READ,
          { scope: "site", siteId: wanted },
          { type: "crm_person", id: null },
        );
      }
      siteIds = [wanted];
    }
    const q = query.q?.trim().slice(0, CRM_COMPANY_SEARCH_MAX) || undefined;
    let company: "any" | "none" | string | undefined;
    if (query.company !== undefined) {
      const parsed = CrmPeopleCompanyFilterSchema.safeParse(query.company.toLowerCase());
      if (!parsed.success) throw invalid("company");
      company = parsed.data;
    }
    let ownerUserId: string | null | undefined;
    let ownerFilter: "me" | "none" | "user" | undefined;
    if (query.owner !== undefined) {
      const parsed = CrmOwnerFilterSchema.safeParse(query.owner.toLowerCase());
      if (!parsed.success) throw invalid("owner");
      ownerFilter = parsed.data === "me" || parsed.data === "none" ? parsed.data : "user";
      ownerUserId =
        parsed.data === "me" ? access.userId : parsed.data === "none" ? null : parsed.data;
    }
    let status: CrmLeadRecord["status"] | undefined;
    if (query.status !== undefined) {
      const parsed = LeadStatusSchema.safeParse(query.status.toUpperCase());
      if (!parsed.success) throw invalid("status");
      status = parsed.data;
    }
    const cursor = query.cursor ? decodeIdCursor(query.cursor) : null;
    const leadMatch: WhereOf<"lead"> = q
      ? {
          anonymisedAt: null,
          OR: [
            { fullName: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q.toLowerCase() } },
            { company: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};
    const scope = { siteIds, includePlatform: false };
    // The site-scoped client refuses to-one filters into site-bound models (lead, company), so
    // the lead and company conditions are read first, each with its own site filter.
    const filter = await access.crmData(scope, async (tx) => {
      let byLead: string[] | null = null;
      let byStatus: string[] | null = null;
      if (q || status) {
        const links = await tx.crmPersonLead.findMany({
          where: { siteId: { in: siteIds } },
          select: { leadId: true, personId: true },
        });
        const personOf = new Map(links.map((l) => [l.leadId, l.personId]));
        const leadIds = [...personOf.keys()];
        const pick = async (where: WhereOf<"lead">) =>
          leadIds.length
            ? (
                await tx.lead.findMany({
                  where: { siteId: { in: siteIds }, id: { in: leadIds }, ...where },
                  select: { id: true },
                })
              ).map((l) => personOf.get(l.id) as string)
            : [];
        if (q) byLead = await pick(leadMatch);
        if (status) byStatus = await pick({ status });
      }
      const companyWhere: WhereOf<"crmCompany"> | null =
        q || ownerUserId !== undefined
          ? {
              siteId: { in: siteIds },
              ...(ownerUserId !== undefined ? { ownerUserId } : {}),
            }
          : null;
      const byCompanyName = q
        ? (
            await tx.crmCompany.findMany({
              where: { ...companyWhere, name: { contains: q, mode: "insensitive" as const } },
              select: { id: true },
            })
          ).map((c) => c.id)
        : null;
      const byOwner =
        ownerUserId !== undefined
          ? (await tx.crmCompany.findMany({ where: companyWhere ?? {}, select: { id: true } })).map(
              (c) => c.id,
            )
          : null;
      return { byLead, byStatus, byCompanyName, byOwner };
    });
    const and: WhereOf<"crmPerson">[] = [
      // Shown through their leads: a person without leads is left out.
      { leads: { some: {} } },
    ];
    if (q) {
      and.push({
        OR: [
          { id: { in: [...new Set(filter.byLead ?? [])] } },
          { companyId: { in: filter.byCompanyName ?? [] } },
        ],
      });
    }
    if (status) and.push({ id: { in: [...new Set(filter.byStatus ?? [])] } });
    if (company === "any") and.push({ companyId: { not: null } });
    else if (company === "none") and.push({ companyId: null });
    else if (company) and.push({ companyId: company });
    if (filter.byOwner) and.push({ companyId: { in: filter.byOwner } });
    if (cursor) and.push({ id: { lt: cursor } });
    const { page, more, people } = await access.crmData(scope, async (tx) => {
      const rows: PersonRow[] = await tx.crmPerson.findMany({
        where: { siteId: { in: siteIds }, AND: and },
        orderBy: { id: "desc" },
        take: CRM_PEOPLE_PAGE_SIZE + 1,
        select: PERSON_SELECT,
      });
      const pageRows = rows.slice(0, CRM_PEOPLE_PAGE_SIZE);
      return {
        page: pageRows,
        more: rows.length > CRM_PEOPLE_PAGE_SIZE,
        people: await this.people.loadPeople(tx, siteIds, pageRows),
      };
    });
    const companyIds = [...new Set(people.map((p) => p.company?.id).filter(Boolean))] as string[];
    const summaries = await this.companies.summariesByIds(access, siteIds, companyIds);
    const items: CrmPersonSummary[] = people.map((p) => ({
      ...p,
      siteKey: this.siteKey(access, p.siteId),
      companyOwner: (p.company && summaries.get(p.company.id)?.owner) || null,
    }));
    await access.audit(this.auditDb(access, siteIds), {
      action: "crm.people_listed",
      resourceType: "crm_person",
      resourceId: null,
      siteId: siteIds.length === 1 ? (siteIds[0] as string) : null,
      permission: CRM_READ,
      metadata: {
        siteIds,
        count: items.length,
        // Which filters were used; never the search text.
        search: Boolean(q),
        ...(company ? { company: company === "any" || company === "none" ? company : "id" } : {}),
        ...(ownerFilter ? { owner: ownerFilter } : {}),
        ...(status ? { status } : {}),
        paged: Boolean(cursor),
        accessAssignmentIds: access.grantRefs(CRM_READ, siteIds),
      },
    });
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: more && last ? Buffer.from(last.id).toString("base64url") : null,
      sites: access.sites
        .filter((s) => readable.includes(s.id))
        .map((s) => ({ id: s.id, key: s.key, name: s.name })),
    };
  }

  // --- shared: leads, requests, contacts, notes ------------------------------------------------

  /**
   * The leads of one site with their requests, the contact history, notes and sales steps (each
   * newest first, at most CRM_360_LIMIT). `personOf` names the person of each lead.
   */
  private async collect(
    access: StaffAccess,
    siteId: string,
    leadIds: readonly string[],
    personOf: ReadonlyMap<string, PersonRef>,
  ): Promise<Collected> {
    const empty: Collected = {
      records: [],
      recordsTruncated: false,
      contacts: [],
      contactsTruncated: false,
      notes: [],
      events: [],
      phone: null,
    };
    if (leadIds.length === 0) return empty;
    const scope = { siteIds: [siteId], includePlatform: false };
    const read = await access.crmData(scope, async (tx: SiteScopedClient) => {
      const inLeads = { siteId, leadId: { in: [...leadIds] } };
      const leads: RecordRow[] = await tx.lead.findMany({
        where: { siteId, id: { in: [...leadIds] } },
        select: RECORD_SELECT,
        orderBy: [{ lastRequestAt: "desc" }, { id: "asc" }],
        take: CRM_360_LIMIT + 1,
      });
      const requests = await tx.leadDocumentRequest.findMany({
        where: inLeads,
        orderBy: { createdAt: "desc" },
        take: CRM_360_LIMIT + 1,
        select: { id: true, leadId: true, createdAt: true, productId: true, documentId: true },
      });
      const messages = await tx.leadContactMessage.findMany({
        where: inLeads,
        orderBy: { createdAt: "desc" },
        take: CRM_360_LIMIT + 1,
        select: {
          id: true,
          leadId: true,
          createdAt: true,
          subject: true,
          message: true,
          phone: true,
          redactedAt: true,
        },
      });
      const activity = (kinds: ("NOTE" | "CONTACT" | "STATUS_CHANGED" | "ASSIGNMENT_CHANGED")[]) =>
        tx.leadActivity.findMany({
          where: { ...inLeads, kind: { in: kinds } },
          orderBy: [{ createdAt: "desc" }, { seq: "desc" }],
          take: CRM_360_LIMIT + 1,
          select: {
            id: true,
            leadId: true,
            kind: true,
            actorUserId: true,
            body: true,
            contactChannel: true,
            contactedAt: true,
            fromStatus: true,
            toStatus: true,
            fromAssigneeId: true,
            toAssigneeId: true,
            createdAt: true,
          },
        });
      const [notes, contacts, events] = await Promise.all([
        activity(["NOTE"]),
        activity(["CONTACT"]),
        activity(["STATUS_CHANGED", "ASSIGNMENT_CHANGED"]),
      ]);
      // Labels of leads beyond the shown page (history of an older lead).
      const shown = new Set(leads.map((l) => l.id));
      const extra = [
        ...new Set(
          [...requests, ...messages, ...notes, ...contacts, ...events]
            .map((r) => r.leadId)
            .filter((id) => !shown.has(id)),
        ),
      ];
      const extraLeads = extra.length
        ? await tx.lead.findMany({
            where: { siteId, id: { in: extra } },
            select: { id: true, fullName: true, email: true, anonymisedAt: true },
          })
        : [];
      return { leads, requests, messages, notes, contacts, events, extraLeads };
    });
    const db = access.db(scope);
    const [products, documents] = await Promise.all([
      db.product.findMany({
        where: { id: { in: [...new Set(read.requests.map((r) => r.productId))] } },
        select: { id: true, code: true, name: true },
      }),
      db.productDocument.findMany({
        where: { id: { in: [...new Set(read.requests.map((r) => r.documentId))] } },
        select: { id: true, type: true, title: true },
      }),
    ]);
    const staffIds = [
      ...read.leads.map((l) => l.assignedToId),
      ...[...read.notes, ...read.contacts, ...read.events].flatMap((a) => [
        a.actorUserId,
        a.fromAssigneeId,
        a.toAssigneeId,
      ]),
    ].filter(Boolean) as string[];
    const [names, assignees] = await Promise.all([
      access.staffNames(staffIds),
      read.leads.some((l) => l.assignedToId)
        ? access
            .leadAssignees([siteId])
            .then((m) => new Set((m.get(siteId) ?? []).map((u) => u.id)))
        : Promise.resolve(new Set<string>()),
    ]);
    const who = (id: string) => ({ id, displayName: names.get(id) ?? FORMER });
    const maybeWho = (id: string | null) => (id ? who(id) : null);
    const productOf = new Map(products.map((p) => [p.id, p]));
    const documentOf = new Map(documents.map((d) => [d.id, d]));
    const leadOf = new Map<string, { fullName: string; email: string; anonymisedAt: Date | null }>([
      ...read.extraLeads.map((l) => [l.id, l] as const),
      ...read.leads.map((l) => [l.id, l] as const),
    ]);
    const leadRef = (id: string) => ({ id, label: label(leadOf.get(id)) });
    const requests = read.requests.slice(0, CRM_360_LIMIT);
    const messages = read.messages.slice(0, CRM_360_LIMIT);
    const records: CrmLeadRecord[] = read.leads.slice(0, CRM_360_LIMIT).map((l) => {
      const gone = Boolean(l.anonymisedAt);
      return {
        id: l.id,
        person: personOf.get(l.id) ?? null,
        fullName: gone ? null : l.fullName,
        email: gone ? null : l.email,
        company: gone ? null : l.company || null,
        country: gone ? null : l.country || null,
        source: l.source,
        status: l.status,
        assignedTo: l.assignedToId
          ? { ...who(l.assignedToId), active: assignees.has(l.assignedToId) }
          : null,
        requestCount: l.requestCount,
        firstRequestAt: l.firstRequestAt.toISOString(),
        lastRequestAt: l.lastRequestAt.toISOString(),
        anonymised: gone,
        documentRequests: requests
          .filter((r) => r.leadId === l.id)
          .map((r): CrmDocumentRequest => ({
            id: r.id,
            createdAt: r.createdAt.toISOString(),
            product: {
              id: r.productId,
              code: productOf.get(r.productId)?.code ?? "",
              name: productOf.get(r.productId)?.name ?? "",
            },
            document: {
              id: r.documentId,
              title: documentOf.get(r.documentId)?.title ?? "",
              type: documentOf.get(r.documentId)?.type ?? "OTHER",
            },
          })),
        contactMessages: messages
          .filter((m) => m.leadId === l.id)
          .map((m) => ({ id: m.id, createdAt: m.createdAt.toISOString(), subject: m.subject })),
      };
    });
    const allContacts: CrmContactEntry[] = [
      ...messages.map((m): CrmContactEntry => ({
        id: m.id,
        kind: "FORM_MESSAGE",
        at: m.createdAt.toISOString(),
        lead: leadRef(m.leadId),
        person: personOf.get(m.leadId) ?? null,
        actor: null,
        channel: "CONTACT_FORM",
        subject: m.subject,
        body: m.message,
        phone: m.phone,
      })),
      ...read.contacts.slice(0, CRM_360_LIMIT).map((a): CrmContactEntry => ({
        id: a.id,
        kind: "LOGGED_CONTACT",
        at: (a.contactedAt ?? a.createdAt).toISOString(),
        lead: leadRef(a.leadId),
        person: personOf.get(a.leadId) ?? null,
        actor: who(a.actorUserId),
        channel: a.contactChannel ?? "OTHER",
        subject: null,
        body: a.body,
        phone: null,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
    const phone =
      messages.find((m) => m.phone && !m.redactedAt && !leadOf.get(m.leadId)?.anonymisedAt)
        ?.phone ?? null;
    return {
      records,
      recordsTruncated:
        read.leads.length > CRM_360_LIMIT ||
        read.requests.length > CRM_360_LIMIT ||
        read.messages.length > CRM_360_LIMIT,
      contacts: allContacts.slice(0, CRM_360_LIMIT),
      contactsTruncated:
        allContacts.length > CRM_360_LIMIT ||
        read.messages.length > CRM_360_LIMIT ||
        read.contacts.length > CRM_360_LIMIT,
      notes: read.notes.slice(0, CRM_360_LIMIT).map((a) => ({
        id: a.id,
        createdAt: a.createdAt.toISOString(),
        lead: leadRef(a.leadId),
        actor: who(a.actorUserId),
        body: a.body,
      })),
      events: read.events.slice(0, CRM_360_LIMIT).map((a) => ({
        id: a.id,
        kind: a.kind as CrmLeadEvent["kind"],
        createdAt: a.createdAt.toISOString(),
        lead: leadRef(a.leadId),
        actor: who(a.actorUserId),
        fromStatus: a.fromStatus,
        toStatus: a.toStatus,
        fromAssignee: maybeWho(a.fromAssigneeId),
        toAssignee: maybeWho(a.toAssigneeId),
      })),
      phone,
    };
  }

  /** The people of a company, and the person of each of their leads. */
  private async companyLeadIds(
    access: StaffAccess,
    siteId: string,
    companyId: string,
  ): Promise<{ leadIds: string[]; personOf: Map<string, PersonRef> }> {
    const people = await access.crmData(
      { siteIds: [siteId], includePlatform: false },
      async (tx) => {
        const persons: PersonRow[] = await tx.crmPerson.findMany({
          where: { siteId, companyId },
          select: PERSON_SELECT,
        });
        return this.people.loadPeople(tx, [siteId], persons);
      },
    );
    const personOf = new Map<string, PersonRef>();
    for (const p of people) {
      for (const l of p.leads) personOf.set(l.id, { id: p.id, displayName: p.displayName });
    }
    return { leadIds: [...personOf.keys()], personOf };
  }

  // --- company: leads and requests, contact history --------------------------------------------

  async companyLeads(ctx: RequestContext, rawId: string): Promise<CrmCompanyLeadsResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.people.readSites(access);
    const company = await this.people.companyIn(access, siteIds, rawId);
    const { leadIds, personOf } = await this.companyLeadIds(access, company.siteId, company.id);
    const got = await this.collect(access, company.siteId, leadIds, personOf);
    await access.audit(access.db({ siteIds: [company.siteId], includePlatform: false }), {
      action: "crm.company_leads_viewed",
      resourceType: "crm_company",
      resourceId: company.id,
      siteId: company.siteId,
      permission: CRM_READ,
      metadata: {
        leads: got.records.length,
        requests: got.records.reduce(
          (n, r) => n + r.documentRequests.length + r.contactMessages.length,
          0,
        ),
        accessAssignmentIds: access.grantRefs(CRM_READ, [company.siteId]),
      },
    });
    return { leads: got.records, truncated: got.recordsTruncated };
  }

  async companyContacts(ctx: RequestContext, rawId: string): Promise<CrmContactHistoryResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.people.readSites(access);
    const company = await this.people.companyIn(access, siteIds, rawId);
    const { leadIds, personOf } = await this.companyLeadIds(access, company.siteId, company.id);
    const got = await this.collect(access, company.siteId, leadIds, personOf);
    await access.audit(access.db({ siteIds: [company.siteId], includePlatform: false }), {
      action: "crm.company_contacts_viewed",
      resourceType: "crm_company",
      resourceId: company.id,
      siteId: company.siteId,
      permission: CRM_READ,
      metadata: {
        count: got.contacts.length,
        accessAssignmentIds: access.grantRefs(CRM_READ, [company.siteId]),
      },
    });
    return { items: got.contacts, truncated: got.contactsTruncated };
  }

  // --- person profile --------------------------------------------------------------------------

  async personProfile(ctx: RequestContext, rawId: string): Promise<CrmPersonProfileResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.people.readSites(access);
    const id = this.people.id(rawId);
    const person = await access.crmData({ siteIds, includePlatform: false }, async (tx) => {
      const row: PersonRow | null = await tx.crmPerson.findFirst({
        where: { id, siteId: { in: siteIds } },
        select: PERSON_SELECT,
      });
      return row ? ((await this.people.loadPeople(tx, [row.siteId], [row]))[0] ?? null) : null;
    });
    // Unknown, of another site, or without leads (nothing to show): looks the same.
    if (!person) return this.people.notFound(access, "crm_person", id);
    const siteId = person.siteId;
    const ref = { id: person.id, displayName: person.displayName };
    const personOf = new Map(person.leads.map((l) => [l.id, ref]));
    const [got, company, history] = await Promise.all([
      this.collect(access, siteId, [...personOf.keys()], personOf),
      person.company
        ? this.companies
            .summariesByIds(access, [siteId], [person.company.id])
            .then((m) => m.get(person.company?.id ?? "") ?? null)
        : Promise.resolve(null),
      this.people.history(access, siteId, null, async () => ({
        OR: [{ personId: person.id }, { fromPersonId: person.id }, { toPersonId: person.id }],
      })),
    ]);
    await access.audit(access.db({ siteIds: [siteId], includePlatform: false }), {
      action: "crm.person_viewed",
      resourceType: "crm_person",
      resourceId: person.id,
      siteId,
      permission: CRM_READ,
      metadata: {
        leads: got.records.length,
        contacts: got.contacts.length,
        notes: got.notes.length,
        activities: history.items.length,
        accessAssignmentIds: access.grantRefs(CRM_READ, [siteId]),
      },
    });
    const live = person.leads.find((l) => !l.anonymised);
    return {
      person,
      siteKey: this.siteKey(access, siteId),
      company,
      email: live?.email ?? null,
      phone: got.phone,
      leads: got.records,
      contacts: got.contacts,
      notes: got.notes,
      leadEvents: got.events,
      activities: history.items,
      canManage: this.people.canManage(access, siteId),
    };
  }
}
