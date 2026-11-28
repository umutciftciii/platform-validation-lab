/**
 * CRM 360° people, their leads and companies, and the CRM history (CRM-2, ADR-032 D6/D7).
 *
 * A person groups the leads of one human on one site (one Lead per site and e-mail address, so
 * a second address is a second lead) and works for at most one company of that site. The person
 * holds no personal data itself: name and e-mail come from its leads, and lead retention still
 * clears them (DP-096). Nothing is linked automatically; leads are only suggested (the typed
 * company name, or the e-mail domain of the company's website; free-mail domains never).
 *
 * Reading needs `crm:read` and `lead:read` on the site (people are shown through their leads);
 * every change needs `crm:manage` there. The database checks the same again (row-level security,
 * guard triggers, composite foreign keys: lead, person and company are always of one site) and
 * writes every change to the CRM history itself. Audit events carry ids and counts only.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  CRM_ACTIVITY_PAGE_SIZE,
  CRM_CANDIDATES_MAX,
  CRM_COMPANY_SEARCH_MAX,
  CrmAddPersonInputSchema,
  CrmLeadPersonInputSchema,
  CrmNoteInputSchema,
  CrmPersonCompanyInputSchema,
  UuidSchema,
  type CrmActivity,
  type CrmActivityKind,
  type CrmActivityListResponse,
  type CrmCompanyPeopleResponse,
  type CrmCompanyRef,
  type CrmLeadCandidate,
  type CrmLeadCandidatesResponse,
  type CrmLeadResponse,
  type CrmPerson,
  type CrmPersonResponse,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import type { SiteScopedClient } from "../iam/site-scope.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { CRM_MANAGE, CRM_READ } from "./crm-companies.service.js";

const LEAD_READ = "lead:read";
const FORMER = "Former staff member";

/** A refusal of the CRM guards, CHECKs, foreign keys or row-level security. */
const DB_REFUSAL =
  /crm: |row-level security|violates (check|foreign key) constraint "Crm|insufficient_privilege|42501|23514|23503/;

function isDbRefusal(error: unknown): boolean {
  const seen = new Set<unknown>();
  let e: unknown = error;
  while (e && typeof e === "object" && !seen.has(e)) {
    seen.add(e);
    const msg = (e as { message?: unknown }).message;
    const meta = (e as { meta?: unknown }).meta;
    if (
      (typeof msg === "string" && DB_REFUSAL.test(msg)) ||
      (meta !== undefined && DB_REFUSAL.test(JSON.stringify(meta)))
    ) {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

const conflict = (rule: string, path: string) => new ApiError("CONFLICT_STATE", [{ path, rule }]);
const invalid = (path: string, rule = "invalid") =>
  new ApiError("VALIDATION_FAILED", [{ path, rule }]);

/** Free-mail domains are never a company's domain (the lead form flags them, ADR-016 D1). */
const FREE_MAIL =
  /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|gmx|web|proton|protonmail|yandex|mail|zoho|hey|fastmail)\./;

/** The host of a company website without "www." (lower case), or null. */
export function websiteDomain(website: string | null): string | null {
  if (!website) return null;
  const m = /^https?:\/\/([^/:?#\s]+)/i.exec(website);
  const host = m?.[1]?.toLowerCase().replace(/^www\./, "") ?? "";
  return host.includes(".") && !FREE_MAIL.test(host) ? host : null;
}

/** The comparison key of a company name, as the database writes it (crm_normalize_name). */
const normalize = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();

const LEAD_SELECT = {
  id: true,
  siteId: true,
  fullName: true,
  email: true,
  company: true,
  status: true,
  requestCount: true,
  lastRequestAt: true,
  anonymisedAt: true,
  freeMailDomain: true,
} as const;

interface LeadRow {
  id: string;
  siteId: string;
  fullName: string;
  email: string;
  company: string;
  status: CrmPerson["leads"][number]["status"];
  requestCount: number;
  lastRequestAt: Date;
  anonymisedAt: Date | null;
  freeMailDomain: boolean;
}

export interface PersonRow {
  id: string;
  siteId: string;
  companyId: string | null;
  version: number;
  updatedAt: Date;
}

export const PERSON_SELECT = {
  id: true,
  siteId: true,
  companyId: true,
  version: true,
  updatedAt: true,
} as const;

/** Cursor of the history: base64url of the last row's `seq`. */
function decodeSeq(raw: string): bigint {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  if (!/^[0-9]{1,19}$/.test(text)) throw invalid("cursor");
  return BigInt(text);
}

@Injectable()
export class CrmPeopleService {
  constructor(@Inject(StaffAccessService) private readonly access: StaffAccessService) {}

  // --- access ----------------------------------------------------------------------------------

  /** Sites where the caller reads people (crm:read and lead:read); none at all is a 403. */
  async readSites(access: StaffAccess): Promise<string[]> {
    const leads = new Set(access.sitesWith(LEAD_READ));
    const ids = access.sitesWith(CRM_READ).filter((s) => leads.has(s));
    if (ids.length === 0) {
      await access.require(CRM_READ, { scope: "platform" }, { type: "crm_person", id: null });
      await access.require(LEAD_READ, { scope: "platform" }, { type: "crm_person", id: null });
    }
    return ids;
  }

  /** Sites where the caller links people (crm:manage and lead:read); none at all is a 403. */
  private async manageSites(access: StaffAccess): Promise<string[]> {
    const leads = new Set(access.sitesWith(LEAD_READ));
    const ids = access.sitesWith(CRM_MANAGE).filter((s) => leads.has(s));
    if (ids.length === 0) {
      await access.require(CRM_MANAGE, { scope: "platform" }, { type: "crm_person", id: null });
      await access.require(LEAD_READ, { scope: "platform" }, { type: "crm_person", id: null });
    }
    return ids;
  }

  canManage(access: StaffAccess, siteId: string): boolean {
    return (
      access.allows(CRM_MANAGE, { scope: "site", siteId }) &&
      access.allows(LEAD_READ, { scope: "site", siteId })
    );
  }

  id(raw: string): string {
    if (!UuidSchema.safeParse(raw).success) throw new ApiError("NOT_FOUND");
    return raw.toLowerCase();
  }

  async notFound(access: StaffAccess, type: string, id: string): Promise<never> {
    // Unknown, or a record of a site the caller may not reach (looks the same: IDOR).
    await access.denied(CRM_READ, { type, id }, "not_found_or_other_site");
    throw new ApiError("NOT_FOUND");
  }

  /** One CRM write in the session's context; database refusals become 409 (audited). */
  private async write<T>(
    access: StaffAccess,
    target: { type: string; id: string | null },
    siteId: string,
    fn: (tx: SiteScopedClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await access.crmData({ siteIds: [siteId], includePlatform: false }, fn);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (!isDbRefusal(error)) throw error;
      await access.denied(CRM_MANAGE, target, "db_guard", { scope: "site", siteId });
      throw conflict("db_guard", target.type);
    }
  }

  // --- loading ---------------------------------------------------------------------------------

  /** People with their leads (most recent first) and companies; people without leads are left out. */
  async loadPeople(
    tx: SiteScopedClient,
    siteIds: readonly string[],
    persons: readonly PersonRow[],
  ): Promise<CrmPerson[]> {
    if (persons.length === 0) return [];
    const links = await tx.crmPersonLead.findMany({
      where: { siteId: { in: [...siteIds] }, personId: { in: persons.map((p) => p.id) } },
      select: { leadId: true, personId: true },
    });
    const leads: LeadRow[] = links.length
      ? await tx.lead.findMany({
          where: { siteId: { in: [...siteIds] }, id: { in: links.map((l) => l.leadId) } },
          select: LEAD_SELECT,
          orderBy: [{ lastRequestAt: "desc" }, { id: "asc" }],
        })
      : [];
    const companyIds = [...new Set(persons.map((p) => p.companyId).filter(Boolean))] as string[];
    const companies = companyIds.length
      ? await tx.crmCompany.findMany({
          where: { siteId: { in: [...siteIds] }, id: { in: companyIds } },
          select: { id: true, name: true },
        })
      : [];
    const companyById = new Map(companies.map((c) => [c.id, c]));
    const personOf = new Map(links.map((l) => [l.leadId, l.personId]));
    const byPerson = new Map<string, LeadRow[]>();
    for (const lead of leads) {
      const pid = personOf.get(lead.id);
      if (!pid) continue;
      byPerson.set(pid, [...(byPerson.get(pid) ?? []), lead]);
    }
    return persons
      .filter((p) => (byPerson.get(p.id) ?? []).length > 0)
      .map((p) => {
        const own = byPerson.get(p.id) ?? [];
        const live = own.find((l) => !l.anonymisedAt);
        const company = p.companyId ? companyById.get(p.companyId) : undefined;
        return {
          id: p.id,
          siteId: p.siteId,
          displayName: live?.fullName ?? null,
          company: company ? { id: company.id, name: company.name } : null,
          leads: own.map((l) => ({
            id: l.id,
            fullName: l.anonymisedAt ? null : l.fullName,
            email: l.anonymisedAt ? null : l.email,
            company: l.anonymisedAt ? null : l.company || null,
            status: l.status,
            requestCount: l.requestCount,
            lastRequestAt: l.lastRequestAt.toISOString(),
            anonymised: Boolean(l.anonymisedAt),
          })),
          version: p.version,
          updatedAt: p.updatedAt.toISOString(),
        } satisfies CrmPerson;
      });
  }

  private async personOfLead(
    tx: SiteScopedClient,
    siteId: string,
    leadId: string,
  ): Promise<PersonRow | null> {
    const link = await tx.crmPersonLead.findFirst({
      where: { siteId, leadId },
      select: { personId: true },
    });
    if (!link) return null;
    return tx.crmPerson.findFirst({ where: { siteId, id: link.personId }, select: PERSON_SELECT });
  }

  private async onePerson(
    tx: SiteScopedClient,
    siteId: string,
    person: PersonRow | null,
  ): Promise<CrmPerson | null> {
    if (!person) return null;
    const fresh = await tx.crmPerson.findFirst({
      where: { siteId, id: person.id },
      select: PERSON_SELECT,
    });
    return fresh ? ((await this.loadPeople(tx, [siteId], [fresh]))[0] ?? null) : null;
  }

  // --- company people --------------------------------------------------------------------------

  async companyIn(
    access: StaffAccess,
    siteIds: readonly string[],
    rawId: string,
  ): Promise<{ id: string; siteId: string; name: string; website: string | null }> {
    const id = this.id(rawId);
    const row = await access.crmData({ siteIds: [...siteIds], includePlatform: false }, (tx) =>
      tx.crmCompany.findFirst({
        where: { id, siteId: { in: [...siteIds] } },
        select: { id: true, siteId: true, name: true, website: true },
      }),
    );
    if (!row) return this.notFound(access, "crm_company", id);
    return row;
  }

  async companyPeople(ctx: RequestContext, rawId: string): Promise<CrmCompanyPeopleResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.readSites(access);
    const company = await this.companyIn(access, siteIds, rawId);
    const scope = { siteIds: [company.siteId], includePlatform: false };
    const people = await access.crmData(scope, async (tx) => {
      const persons: PersonRow[] = await tx.crmPerson.findMany({
        where: { siteId: company.siteId, companyId: company.id },
        select: PERSON_SELECT,
      });
      return this.loadPeople(tx, [company.siteId], persons);
    });
    people.sort((a, b) =>
      (b.leads[0]?.lastRequestAt ?? "").localeCompare(a.leads[0]?.lastRequestAt ?? ""),
    );
    await access.audit(access.db(scope), {
      action: "crm.company_people_viewed",
      resourceType: "crm_company",
      resourceId: company.id,
      siteId: company.siteId,
      permission: CRM_READ,
      metadata: {
        count: people.length,
        accessAssignmentIds: access.grantRefs(CRM_READ, [company.siteId]),
      },
    });
    return { people, canManage: this.canManage(access, company.siteId) };
  }

  /** Live leads of a site matching a search, with the person and company they already have. */
  private async candidates(
    tx: SiteScopedClient,
    siteId: string,
    q: string | undefined,
    exclude: { leadIds: readonly string[] },
    suggest: { name: string; domain: string | null } | null,
  ): Promise<CrmLeadCandidate[]> {
    const base = { siteId, anonymisedAt: null, id: { notIn: [...exclude.leadIds] } };
    let rows: LeadRow[];
    if (q) {
      rows = await tx.lead.findMany({
        where: {
          ...base,
          OR: [
            { fullName: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q.toLowerCase() } },
            { company: { contains: q, mode: "insensitive" as const } },
          ],
        },
        select: LEAD_SELECT,
        orderBy: [{ lastRequestAt: "desc" }, { id: "asc" }],
        take: CRM_CANDIDATES_MAX,
      });
    } else if (suggest) {
      // Suggestions only: the typed company name, or the website's domain (never free mail).
      const words = normalize(suggest.name);
      rows = await tx.lead.findMany({
        where: {
          ...base,
          OR: [
            { company: { equals: suggest.name, mode: "insensitive" as const } },
            ...(words !== suggest.name
              ? [{ company: { equals: words, mode: "insensitive" as const } }]
              : []),
            ...(suggest.domain
              ? [{ email: { endsWith: `@${suggest.domain}` }, freeMailDomain: false }]
              : []),
          ],
        },
        select: LEAD_SELECT,
        orderBy: [{ lastRequestAt: "desc" }, { id: "asc" }],
        take: CRM_CANDIDATES_MAX,
      });
    } else {
      rows = [];
    }
    const links = rows.length
      ? await tx.crmPersonLead.findMany({
          where: { siteId, leadId: { in: rows.map((r) => r.id) } },
          select: { leadId: true, personId: true },
        })
      : [];
    const persons: PersonRow[] = links.length
      ? await tx.crmPerson.findMany({
          where: { siteId, id: { in: [...new Set(links.map((l) => l.personId))] } },
          select: PERSON_SELECT,
        })
      : [];
    const companyIds = [...new Set(persons.map((p) => p.companyId).filter(Boolean))] as string[];
    const companies = companyIds.length
      ? await tx.crmCompany.findMany({
          where: { siteId, id: { in: companyIds } },
          select: { id: true, name: true },
        })
      : [];
    const personById = new Map(persons.map((p) => [p.id, p]));
    const companyById = new Map(companies.map((c) => [c.id, c]));
    const personOf = new Map(links.map((l) => [l.leadId, l.personId]));
    return rows.map((r) => {
      const person = personById.get(personOf.get(r.id) ?? "");
      const company = person?.companyId ? companyById.get(person.companyId) : undefined;
      const reason: CrmLeadCandidate["reason"] = q
        ? null
        : suggest?.domain && r.email.endsWith(`@${suggest.domain}`) && !r.freeMailDomain
          ? "email_domain"
          : "company_name";
      return {
        id: r.id,
        fullName: r.fullName,
        email: r.email,
        company: r.company || null,
        lastRequestAt: r.lastRequestAt.toISOString(),
        reason,
        person: person
          ? { id: person.id, company: company ? { id: company.id, name: company.name } : null }
          : null,
      };
    });
  }

  async companyCandidates(
    ctx: RequestContext,
    rawId: string,
    rawQ: string | undefined,
  ): Promise<CrmLeadCandidatesResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.manageSites(access);
    const company = await this.companyIn(access, siteIds, rawId);
    const q = rawQ?.trim().slice(0, CRM_COMPANY_SEARCH_MAX) || undefined;
    const scope = { siteIds: [company.siteId], includePlatform: false };
    const items = await access.crmData(scope, async (tx) => {
      // Leads already at this company are not offered again.
      const here = await tx.crmPerson.findMany({
        where: { siteId: company.siteId, companyId: company.id },
        select: { id: true },
      });
      const linked = here.length
        ? await tx.crmPersonLead.findMany({
            where: { siteId: company.siteId, personId: { in: here.map((p) => p.id) } },
            select: { leadId: true },
          })
        : [];
      return this.candidates(
        tx,
        company.siteId,
        q,
        { leadIds: linked.map((l) => l.leadId) },
        { name: company.name, domain: websiteDomain(company.website) },
      );
    });
    await access.audit(access.db(scope), {
      action: "crm.lead_candidates_listed",
      resourceType: "crm_company",
      resourceId: company.id,
      siteId: company.siteId,
      permission: CRM_MANAGE,
      metadata: {
        count: items.length,
        search: Boolean(q),
        accessAssignmentIds: access.grantRefs(CRM_MANAGE, [company.siteId]),
      },
    });
    return { items };
  }

  /** A live lead of one of the sites (404 otherwise; anonymised leads are never linked). */
  private async liveLead(
    access: StaffAccess,
    siteIds: readonly string[],
    rawId: string,
    path: string,
  ): Promise<LeadRow> {
    const id = this.id(rawId);
    const row: LeadRow | null = await access.crmData(
      { siteIds: [...siteIds], includePlatform: false },
      (tx) =>
        tx.lead.findFirst({ where: { id, siteId: { in: [...siteIds] } }, select: LEAD_SELECT }),
    );
    if (!row) return this.notFound(access, "lead", id);
    if (row.anonymisedAt) throw conflict("lead_anonymised", path);
    return row;
  }

  async addPerson(ctx: RequestContext, rawId: string, body: unknown): Promise<CrmPersonResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.manageSites(access);
    const company = await this.companyIn(access, siteIds, rawId);
    const input = parseBody(CrmAddPersonInputSchema, body);
    const lead = await this.liveLead(access, [company.siteId], input.leadId, "leadId");
    const siteId = company.siteId;
    const person = await this.write(
      access,
      { type: "crm_company", id: company.id },
      siteId,
      async (tx) => {
        const current = await this.personOfLead(tx, siteId, lead.id);
        let personId: string;
        let fromCompanyId: string | null = null;
        if (current) {
          if (current.companyId === company.id) throw conflict("already_linked", "leadId");
          if (current.companyId && !input.confirmMove) throw conflict("other_company", "leadId");
          fromCompanyId = current.companyId;
          const updated = await tx.crmPerson.updateMany({
            where: { siteId, id: current.id, version: current.version },
            data: { companyId: company.id },
          });
          if (updated.count !== 1) throw conflict("stale", "leadId");
          personId = current.id;
        } else {
          const created = await tx.crmPerson.create({
            data: {
              siteId,
              companyId: company.id,
              // The database stamps the session's user (guard trigger).
              createdById: access.userId,
              updatedById: access.userId,
            },
            select: { id: true },
          });
          await tx.crmPersonLead.create({
            data: { leadId: lead.id, siteId, personId: created.id, linkedById: access.userId },
          });
          personId = created.id;
        }
        await access.audit(tx, {
          action: "crm.person_linked",
          resourceType: "crm_person",
          resourceId: personId,
          siteId,
          permission: CRM_MANAGE,
          metadata: {
            companyId: company.id,
            fromCompanyId,
            leadId: lead.id,
            newPerson: !current,
            accessAssignmentIds: access.grantRefs(CRM_MANAGE, [siteId]),
          },
        });
        return this.onePerson(tx, siteId, { id: personId } as PersonRow);
      },
    );
    return { person };
  }

  async setPersonCompany(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<CrmPersonResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.manageSites(access);
    const id = this.id(rawId);
    const input = parseBody(CrmPersonCompanyInputSchema, body);
    const current: PersonRow | null = await access.crmData(
      { siteIds, includePlatform: false },
      (tx) =>
        tx.crmPerson.findFirst({ where: { id, siteId: { in: siteIds } }, select: PERSON_SELECT }),
    );
    if (!current) return this.notFound(access, "crm_person", id);
    if (current.version !== input.version) throw conflict("stale", "version");
    const companyId = input.companyId?.toLowerCase() ?? null;
    if (companyId === current.companyId) throw conflict("unchanged", "companyId");
    const siteId = current.siteId;
    const person = await this.write(access, { type: "crm_person", id }, siteId, async (tx) => {
      if (companyId) {
        const company = await tx.crmCompany.findFirst({
          where: { id: companyId, siteId },
          select: { id: true },
        });
        // Only a company of the same site (the composite foreign key says the same).
        if (!company) throw invalid("companyId", "not_found");
      }
      const updated = await tx.crmPerson.updateMany({
        where: { id, siteId, version: input.version },
        data: { companyId },
      });
      if (updated.count !== 1) throw conflict("stale", "version");
      await access.audit(tx, {
        action: "crm.person_company_changed",
        resourceType: "crm_person",
        resourceId: id,
        siteId,
        permission: CRM_MANAGE,
        metadata: {
          fromCompanyId: current.companyId,
          toCompanyId: companyId,
          accessAssignmentIds: access.grantRefs(CRM_MANAGE, [siteId]),
        },
      });
      return this.onePerson(tx, siteId, current);
    });
    return { person };
  }

  // --- the CRM side of a lead ------------------------------------------------------------------

  async lead(ctx: RequestContext, rawId: string): Promise<CrmLeadResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.readSites(access);
    const id = this.id(rawId);
    const scope = { siteIds, includePlatform: false };
    const found = await access.crmData(scope, async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id, siteId: { in: siteIds } },
        select: { id: true, siteId: true, anonymisedAt: true },
      });
      if (!lead) return null;
      const person = await this.personOfLead(tx, lead.siteId, lead.id);
      return {
        lead,
        person: person ? ((await this.loadPeople(tx, [lead.siteId], [person]))[0] ?? null) : null,
      };
    });
    if (!found) return this.notFound(access, "lead", id);
    await access.audit(access.db({ siteIds: [found.lead.siteId], includePlatform: false }), {
      action: "crm.lead_person_viewed",
      resourceType: "lead",
      resourceId: id,
      siteId: found.lead.siteId,
      permission: CRM_READ,
      metadata: {
        personId: found.person?.id ?? null,
        accessAssignmentIds: access.grantRefs(CRM_READ, [found.lead.siteId]),
      },
    });
    return {
      person: found.person,
      canManage: this.canManage(access, found.lead.siteId),
      anonymised: Boolean(found.lead.anonymisedAt),
    };
  }

  async leadCandidates(
    ctx: RequestContext,
    rawId: string,
    rawQ: string | undefined,
  ): Promise<CrmLeadCandidatesResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.manageSites(access);
    const lead = await this.liveLead(access, siteIds, rawId, "lead");
    const q = rawQ?.trim().slice(0, CRM_COMPANY_SEARCH_MAX) || undefined;
    const scope = { siteIds: [lead.siteId], includePlatform: false };
    const items = q
      ? await access.crmData(scope, async (tx) => {
          // The lead itself and the other leads of its person are not offered.
          const person = await this.personOfLead(tx, lead.siteId, lead.id);
          const same = person
            ? await tx.crmPersonLead.findMany({
                where: { siteId: lead.siteId, personId: person.id },
                select: { leadId: true },
              })
            : [];
          return this.candidates(
            tx,
            lead.siteId,
            q,
            { leadIds: [lead.id, ...same.map((l) => l.leadId)] },
            null,
          );
        })
      : [];
    await access.audit(access.db(scope), {
      action: "crm.lead_candidates_listed",
      resourceType: "lead",
      resourceId: lead.id,
      siteId: lead.siteId,
      permission: CRM_MANAGE,
      metadata: {
        count: items.length,
        search: Boolean(q),
        accessAssignmentIds: access.grantRefs(CRM_MANAGE, [lead.siteId]),
      },
    });
    return { items };
  }

  /**
   * The lead is the same person as another lead of its site (it joins that lead's person; a
   * person is created for the other lead when it has none, at the company of this lead's person),
   * or a person of its own again (null: the link is removed).
   */
  async setLeadPerson(ctx: RequestContext, rawId: string, body: unknown): Promise<CrmLeadResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.manageSites(access);
    const lead = await this.liveLead(access, siteIds, rawId, "lead");
    const input = parseBody(CrmLeadPersonInputSchema, body);
    const siteId = lead.siteId;
    const otherId = input.samePersonAsLeadId?.toLowerCase() ?? null;
    if (otherId === lead.id) throw invalid("samePersonAsLeadId", "same_lead");
    const other = otherId
      ? await this.liveLead(access, [siteId], otherId, "samePersonAsLeadId")
      : null;
    const person = await this.write(access, { type: "lead", id: lead.id }, siteId, async (tx) => {
      const current = await this.personOfLead(tx, siteId, lead.id);
      if (!other) {
        if (!current) throw conflict("unchanged", "samePersonAsLeadId");
        await tx.crmPersonLead.deleteMany({ where: { siteId, leadId: lead.id } });
        await access.audit(tx, {
          action: "crm.lead_person_changed",
          resourceType: "lead",
          resourceId: lead.id,
          siteId,
          permission: CRM_MANAGE,
          metadata: {
            fromPersonId: current.id,
            toPersonId: null,
            accessAssignmentIds: access.grantRefs(CRM_MANAGE, [siteId]),
          },
        });
        return null;
      }
      let target = await this.personOfLead(tx, siteId, other.id);
      if (target && current && target.id === current.id) {
        throw conflict("unchanged", "samePersonAsLeadId");
      }
      if (!target) {
        const created = await tx.crmPerson.create({
          data: {
            siteId,
            companyId: current?.companyId ?? null,
            createdById: access.userId,
            updatedById: access.userId,
          },
          select: PERSON_SELECT,
        });
        await tx.crmPersonLead.create({
          data: { leadId: other.id, siteId, personId: created.id, linkedById: access.userId },
        });
        target = created;
      }
      if (current) {
        await tx.crmPersonLead.updateMany({
          where: { siteId, leadId: lead.id },
          data: { personId: target.id },
        });
      } else {
        await tx.crmPersonLead.create({
          data: { leadId: lead.id, siteId, personId: target.id, linkedById: access.userId },
        });
      }
      await access.audit(tx, {
        action: "crm.lead_person_changed",
        resourceType: "lead",
        resourceId: lead.id,
        siteId,
        permission: CRM_MANAGE,
        metadata: {
          fromPersonId: current?.id ?? null,
          toPersonId: target.id,
          withLeadId: other.id,
          accessAssignmentIds: access.grantRefs(CRM_MANAGE, [siteId]),
        },
      });
      return this.onePerson(tx, siteId, target);
    });
    return { person, canManage: true, anonymised: false };
  }

  // --- history ---------------------------------------------------------------------------------

  /**
   * The history of a company: its own rows (creation, owner, notes), people joining or leaving
   * it, and the lead changes of the people who work there now. Newest first.
   */
  async activities(
    ctx: RequestContext,
    rawId: string,
    rawCursor: string | undefined,
    rawKind?: string,
  ): Promise<CrmActivityListResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.readSites(access);
    const company = await this.companyIn(access, siteIds, rawId);
    const siteId = company.siteId;
    const before = rawCursor ? decodeSeq(rawCursor) : null;
    // CRM-3: the notes tab reads the notes only.
    if (rawKind !== undefined && rawKind !== "NOTE") throw invalid("kind");
    const notesOnly = rawKind === "NOTE";
    const page = await this.history(access, siteId, before, async (tx) => {
      if (notesOnly) return { kind: "NOTE" as const, companyId: company.id };
      const here = await tx.crmPerson.findMany({
        where: { siteId, companyId: company.id },
        select: { id: true },
      });
      return {
        OR: [
          { companyId: company.id },
          { fromCompanyId: company.id },
          { toCompanyId: company.id },
          ...(here.length
            ? [{ kind: "LEAD_PERSON_CHANGED" as const, personId: { in: here.map((p) => p.id) } }]
            : []),
        ],
      };
    });
    await access.audit(access.db({ siteIds: [siteId], includePlatform: false }), {
      action: "crm.company_history_viewed",
      resourceType: "crm_company",
      resourceId: company.id,
      siteId,
      permission: CRM_READ,
      metadata: {
        count: page.items.length,
        paged: before !== null,
        ...(notesOnly ? { kind: "NOTE" } : {}),
        accessAssignmentIds: access.grantRefs(CRM_READ, [siteId]),
      },
    });
    return page;
  }

  /**
   * One page of the CRM history of a site, newest first: the rows `filter` selects (CRM-2
   * company history; CRM-3 a person's history and a company's notes). Not audited here.
   */
  async history(
    access: StaffAccess,
    siteId: string,
    before: bigint | null,
    filter: (tx: SiteScopedClient) => Promise<Record<string, unknown>>,
  ): Promise<CrmActivityListResponse> {
    const scope = { siteIds: [siteId], includePlatform: false };
    const result = await access.crmData(scope, async (tx) => {
      const where = await filter(tx);
      const rows = await tx.crmActivity.findMany({
        where: {
          siteId,
          ...where,
          ...(before !== null ? { seq: { lt: before } } : {}),
        },
        orderBy: { seq: "desc" },
        take: CRM_ACTIVITY_PAGE_SIZE + 1,
      });
      const page = rows.slice(0, CRM_ACTIVITY_PAGE_SIZE);
      const personIds = [
        ...new Set(page.flatMap((r) => [r.personId, r.fromPersonId, r.toPersonId]).filter(Boolean)),
      ] as string[];
      const persons: PersonRow[] = personIds.length
        ? await tx.crmPerson.findMany({
            where: { siteId, id: { in: personIds } },
            select: PERSON_SELECT,
          })
        : [];
      const people = await this.loadPeople(tx, [siteId], persons);
      const leadIds = [...new Set(page.map((r) => r.leadId).filter(Boolean))] as string[];
      const leads = leadIds.length
        ? await tx.lead.findMany({
            where: { siteId, id: { in: leadIds } },
            select: { id: true, fullName: true, email: true, anonymisedAt: true },
          })
        : [];
      const companyIds = [
        ...new Set(page.flatMap((r) => [r.fromCompanyId, r.toCompanyId]).filter(Boolean)),
      ] as string[];
      const companies = companyIds.length
        ? await tx.crmCompany.findMany({
            where: { siteId, id: { in: companyIds } },
            select: { id: true, name: true },
          })
        : [];
      return { rows, page, people, leads, companies };
    });
    const { rows, page } = result;
    const names = await access.staffNames(
      page
        .flatMap((r) => [r.actorUserId, r.fromOwnerUserId, r.toOwnerUserId])
        .filter(Boolean) as string[],
    );
    const staff = (id: string | null) => (id ? { id, displayName: names.get(id) ?? FORMER } : null);
    const personById = new Map(result.people.map((p) => [p.id, p]));
    const leadById = new Map(result.leads.map((l) => [l.id, l]));
    const companyById = new Map<string, CrmCompanyRef>(
      result.companies.map((c) => [c.id, { id: c.id, name: c.name }]),
    );
    const personRef = (id: string | null) =>
      id ? { id, displayName: personById.get(id)?.displayName ?? null } : null;
    const companyRef = (id: string | null) => (id ? (companyById.get(id) ?? null) : null);
    const items: CrmActivity[] = page.map((r) => {
      const lead = r.leadId ? leadById.get(r.leadId) : undefined;
      return {
        id: r.id,
        kind: r.kind as CrmActivityKind,
        createdAt: r.createdAt.toISOString(),
        actor: staff(r.actorUserId) as { id: string; displayName: string },
        body: r.body,
        person: personRef(r.personId),
        lead: r.leadId
          ? {
              id: r.leadId,
              label: lead && !lead.anonymisedAt ? `${lead.fullName} <${lead.email}>` : null,
            }
          : null,
        fromCompany: companyRef(r.fromCompanyId),
        toCompany: companyRef(r.toCompanyId),
        fromPerson: personRef(r.fromPersonId),
        toPerson: personRef(r.toPersonId),
        fromOwner: staff(r.fromOwnerUserId),
        toOwner: staff(r.toOwnerUserId),
      };
    });
    const last = page[page.length - 1];
    return {
      items,
      nextCursor:
        rows.length > CRM_ACTIVITY_PAGE_SIZE && last
          ? Buffer.from(last.seq.toString()).toString("base64url")
          : null,
    };
  }

  async addNote(ctx: RequestContext, rawId: string, body: unknown): Promise<{ ok: true }> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.manageSites(access);
    const company = await this.companyIn(access, siteIds, rawId);
    const input = parseBody(CrmNoteInputSchema, body);
    const siteId = company.siteId;
    await this.write(access, { type: "crm_company", id: company.id }, siteId, async (tx) => {
      const note = await tx.crmActivity.create({
        data: {
          siteId,
          kind: "NOTE",
          companyId: company.id,
          actorUserId: access.userId,
          body: input.body,
        },
        select: { id: true },
      });
      await access.audit(tx, {
        action: "crm.note_added",
        resourceType: "crm_company",
        resourceId: company.id,
        siteId,
        permission: CRM_MANAGE,
        metadata: {
          // Never the text.
          activityId: note.id,
          length: input.body.length,
          accessAssignmentIds: access.grantRefs(CRM_MANAGE, [siteId]),
        },
      });
    });
    return { ok: true };
  }
}
