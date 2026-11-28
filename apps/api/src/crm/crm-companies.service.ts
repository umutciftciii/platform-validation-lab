/**
 * CRM 360° companies (CRM-1, ADR-032). Staff with `crm:read` on a site list and open its
 * companies; `crm:manage` there (sales_crm_user on that site, the platform super admin, the system
 * owner) creates them, edits them and sets their account owner. Companies are customer data:
 * every read and change is audited, with ids, counts and the names of changed fields only (never
 * a name, address, phone, e-mail or note).
 *
 * The CRM table has row-level security (migration 20261224090000_crm_1_companies): every query
 * runs in `access.crmData`, whose database context is the admin session itself. The database
 * opens only the sites where it finds the permission for that user, stamps creator, editor,
 * version and times, keeps names unique per site and checks the account owner again.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  CRM_COMPANIES_PAGE_SIZE,
  CRM_COMPANY_FIELDS,
  CRM_COMPANY_SEARCH_MAX,
  CountryCodeSchema,
  CrmCompanyCreateInputSchema,
  CrmCompanyUpdateInputSchema,
  CrmOwnerFilterSchema,
  UuidSchema,
  type CrmCompany,
  type CrmCompanyDetailResponse,
  type CrmCompanyField,
  type CrmCompanyListResponse,
  type CrmCompanyResponse,
  type CrmCompanySummary,
  type CrmOwnersResponse,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import type { SiteScopedClient } from "../iam/site-scope.js";
import { StaffAccessService, type AccessSite, type StaffAccess } from "../iam/staff/access.js";

export const CRM_READ = "crm:read";
export const CRM_MANAGE = "crm:manage";

const FORMER = "Former staff member";

/** A refusal of the CRM-1 guard, CHECKs or row-level security. */
const DB_REFUSAL =
  /crm: |row-level security|violates check constraint "CrmCompany|insufficient_privilege|42501|23514/;

function causes(error: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  let e: unknown = error;
  while (e && typeof e === "object" && !seen.has(e)) {
    seen.add(e);
    out.push(e);
    e = (e as { cause?: unknown }).cause;
  }
  return out;
}

function isDbRefusal(error: unknown): boolean {
  return causes(error).some((e) => {
    const msg = (e as { message?: unknown }).message;
    const meta = (e as { meta?: unknown }).meta;
    return (
      (typeof msg === "string" && DB_REFUSAL.test(msg)) ||
      (meta !== undefined && DB_REFUSAL.test(JSON.stringify(meta)))
    );
  });
}

/** The (siteId, normalizedName) unique index: another company of the site has this name. */
function isDuplicateName(error: unknown): boolean {
  return causes(error).some((e) => {
    const code = (e as { code?: unknown }).code;
    const msg = String((e as { message?: unknown }).message ?? "");
    const meta = JSON.stringify((e as { meta?: unknown }).meta ?? {});
    return (
      (code === "P2002" || /unique constraint/i.test(msg) || /23505/.test(meta + msg)) &&
      /normalizedName|CrmCompany_siteId_normalizedName_key/.test(meta + msg)
    );
  });
}

const conflict = (rule: string, path = "company") =>
  new ApiError("CONFLICT_STATE", [{ path, rule }]);
const invalid = (path: string, rule = "invalid") =>
  new ApiError("VALIDATION_FAILED", [{ path, rule }]);

const COMPANY_SELECT = {
  id: true,
  siteId: true,
  name: true,
  normalizedName: true,
  country: true,
  city: true,
  address: true,
  website: true,
  phone: true,
  email: true,
  description: true,
  internalNotes: true,
  ownerUserId: true,
  version: true,
  createdById: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface CompanyRow {
  id: string;
  siteId: string;
  name: string;
  normalizedName: string;
  country: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  description: string | null;
  internalNotes: string | null;
  ownerUserId: string | null;
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

/** What the summaries need about people: names and current owner eligibility per site. */
interface People {
  names: Map<string, string>;
  eligible: Map<string, Set<string>>;
}

export interface CrmCompanyListQuery {
  siteId?: string | undefined;
  q?: string | undefined;
  owner?: string | undefined;
  country?: string | undefined;
  cursor?: string | undefined;
}

/** Cursor: base64url of "<normalizedName>\u0000<id>" (keyset pagination, by name). */
function encodeCursor(row: CompanyRow): string {
  return Buffer.from(`${row.normalizedName}\u0000${row.id}`).toString("base64url");
}

function decodeCursor(raw: string): { name: string; id: string } {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const at = text.lastIndexOf("\u0000");
  const name = at > 0 ? text.slice(0, at) : "";
  const id = at > 0 ? text.slice(at + 1) : "";
  if (!name || !UuidSchema.safeParse(id).success) throw invalid("cursor");
  return { name, id };
}

type CompanyWhere = NonNullable<Parameters<SiteScopedClient["crmCompany"]["findMany"]>[0]>["where"];

@Injectable()
export class CrmCompaniesService {
  constructor(@Inject(StaffAccessService) private readonly access: StaffAccessService) {}

  /** Sites with crm:read; none at all is refused (403) and audited. */
  private async readableSites(access: StaffAccess): Promise<AccessSite[]> {
    const ids = access.sitesWith(CRM_READ);
    if (ids.length === 0) {
      await access.require(CRM_READ, { scope: "platform" }, { type: "crm_company", id: null });
    }
    return access.sites.filter((s) => ids.includes(s.id));
  }

  /** Sites with crm:manage; none at all is refused (403) and audited. */
  private async manageableSites(access: StaffAccess): Promise<string[]> {
    const ids = access.sitesWith(CRM_MANAGE);
    if (ids.length === 0) {
      await access.require(CRM_MANAGE, { scope: "platform" }, { type: "crm_company", id: null });
    }
    return ids;
  }

  private async people(
    access: StaffAccess,
    rows: readonly CompanyRow[],
    withAuthors = false,
  ): Promise<People> {
    const owned = rows.filter((r) => r.ownerUserId);
    const ids = [
      ...owned.map((r) => r.ownerUserId as string),
      ...(withAuthors ? rows.flatMap((r) => [r.createdById, r.updatedById]) : []),
    ];
    const [names, bySite] = await Promise.all([
      access.staffNames(ids),
      access.crmOwners([...new Set(owned.map((r) => r.siteId))]),
    ]);
    const eligible = new Map(
      [...bySite].map(([siteId, list]) => [siteId, new Set(list.map((u) => u.id))]),
    );
    return { names, eligible };
  }

  private summary(row: CompanyRow, siteKey: "BV" | "CORPORATE", people: People) {
    const owner = row.ownerUserId;
    return {
      id: row.id,
      siteId: row.siteId,
      siteKey,
      name: row.name,
      country: row.country,
      city: row.city,
      website: row.website,
      owner: owner
        ? {
            id: owner,
            displayName: people.names.get(owner) ?? FORMER,
            active: people.eligible.get(row.siteId)?.has(owner) ?? false,
          }
        : null,
      updatedAt: row.updatedAt.toISOString(),
    } satisfies CrmCompanySummary;
  }

  private company(row: CompanyRow, siteKey: "BV" | "CORPORATE", people: People): CrmCompany {
    const who = (id: string) => ({ id, displayName: people.names.get(id) ?? FORMER });
    return {
      ...this.summary(row, siteKey, people),
      address: row.address,
      phone: row.phone,
      email: row.email,
      description: row.description,
      internalNotes: row.internalNotes,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      createdBy: who(row.createdById),
      updatedBy: who(row.updatedById),
    };
  }

  private siteKey(access: StaffAccess, siteId: string): "BV" | "CORPORATE" {
    return access.sites.find((s) => s.id === siteId)?.key ?? "BV";
  }

  // --- read ------------------------------------------------------------------------------------

  async list(ctx: RequestContext, query: CrmCompanyListQuery): Promise<CrmCompanyListResponse> {
    const access = await this.access.begin(ctx);
    const sites = await this.readableSites(access);
    let siteIds = sites.map((s) => s.id);
    if (query.siteId !== undefined) {
      const wanted = query.siteId.toLowerCase();
      if (!siteIds.includes(wanted)) {
        await access.require(
          CRM_READ,
          { scope: "site", siteId: wanted },
          { type: "crm_company", id: null },
        );
      }
      siteIds = [wanted];
    }
    const q = query.q?.trim().slice(0, CRM_COMPANY_SEARCH_MAX) || undefined;
    let ownerUserId: string | null | undefined;
    let ownerFilter: "me" | "none" | "user" | undefined;
    if (query.owner !== undefined) {
      const parsed = CrmOwnerFilterSchema.safeParse(query.owner.toLowerCase());
      if (!parsed.success) throw invalid("owner");
      ownerFilter = parsed.data === "me" || parsed.data === "none" ? parsed.data : "user";
      ownerUserId =
        parsed.data === "me" ? access.userId : parsed.data === "none" ? null : parsed.data;
    }
    let country: string | undefined;
    if (query.country !== undefined) {
      const parsed = CountryCodeSchema.safeParse(query.country.toUpperCase());
      if (!parsed.success) throw invalid("country");
      country = parsed.data;
    }
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const where: CompanyWhere = {
      siteId: { in: siteIds },
      ...(ownerUserId !== undefined ? { ownerUserId } : {}),
      ...(country ? { country } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { city: { contains: q, mode: "insensitive" as const } },
              { website: { contains: q, mode: "insensitive" as const } },
              { email: { contains: q.toLowerCase() } },
            ],
          }
        : {}),
      ...(cursor
        ? {
            AND: [
              {
                OR: [
                  { normalizedName: { gt: cursor.name } },
                  { normalizedName: cursor.name, id: { gt: cursor.id } },
                ],
              },
            ],
          }
        : {}),
    };
    const scope = { siteIds, includePlatform: false };
    const rows: CompanyRow[] = await access.crmData(scope, (tx) =>
      tx.crmCompany.findMany({
        where,
        orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
        take: CRM_COMPANIES_PAGE_SIZE + 1,
        select: COMPANY_SELECT,
      }),
    );
    const page = rows.slice(0, CRM_COMPANIES_PAGE_SIZE);
    const people = await this.people(access, page);
    const auditDb =
      siteIds.length === 1 ? access.db(scope) : access.db({ siteIds, includePlatform: true });
    await access.audit(auditDb, {
      action: "crm.companies_listed",
      resourceType: "crm_company",
      resourceId: null,
      siteId: siteIds.length === 1 ? (siteIds[0] as string) : null,
      permission: CRM_READ,
      metadata: {
        siteIds,
        count: page.length,
        // Which filters were used; never the search text.
        search: Boolean(q),
        ...(ownerFilter ? { owner: ownerFilter } : {}),
        ...(country ? { country } : {}),
        paged: Boolean(cursor),
        accessAssignmentIds: access.grantRefs(CRM_READ, siteIds),
      },
    });
    const last = page[page.length - 1];
    const manageable = new Set(access.sitesWith(CRM_MANAGE));
    return {
      items: page.map((r) => this.summary(r, this.siteKey(access, r.siteId), people)),
      nextCursor: rows.length > CRM_COMPANIES_PAGE_SIZE && last ? encodeCursor(last) : null,
      sites: sites.map((s) => ({ id: s.id, key: s.key, name: s.name })),
      manageableSiteIds: sites.filter((s) => manageable.has(s.id)).map((s) => s.id),
    };
  }

  async detail(ctx: RequestContext, rawId: string): Promise<CrmCompanyDetailResponse> {
    const access = await this.access.begin(ctx);
    const sites = await this.readableSites(access);
    if (!UuidSchema.safeParse(rawId).success) throw new ApiError("NOT_FOUND");
    const id = rawId.toLowerCase();
    const siteIds = sites.map((s) => s.id);
    const scope = { siteIds, includePlatform: false };
    const row: CompanyRow | null = await access.crmData(scope, (tx) =>
      tx.crmCompany.findFirst({ where: { id, siteId: { in: siteIds } }, select: COMPANY_SELECT }),
    );
    if (!row) {
      // Unknown, or a company of a site the caller may not read (looks the same: IDOR).
      await access.denied(CRM_READ, { type: "crm_company", id }, "not_found_or_other_site");
      throw new ApiError("NOT_FOUND");
    }
    const canManage = access.allows(CRM_MANAGE, { scope: "site", siteId: row.siteId });
    const [people, owners] = await Promise.all([
      this.people(access, [row], true),
      canManage
        ? access.crmOwners([row.siteId]).then((m) => m.get(row.siteId) ?? [])
        : Promise.resolve([]),
    ]);
    await access.audit(access.db({ siteIds: [row.siteId], includePlatform: false }), {
      action: "crm.company_viewed",
      resourceType: "crm_company",
      resourceId: row.id,
      siteId: row.siteId,
      permission: CRM_READ,
      metadata: { accessAssignmentIds: access.grantRefs(CRM_READ, [row.siteId]) },
    });
    return {
      company: this.company(row, this.siteKey(access, row.siteId), people),
      canManage,
      owners,
    };
  }

  /** Possible account owners for every site where the caller may create companies. */
  async owners(ctx: RequestContext): Promise<CrmOwnersResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.manageableSites(access);
    const bySite = await access.crmOwners(siteIds);
    return {
      sites: access.sites
        .filter((s) => siteIds.includes(s.id))
        .map((s) => ({
          site: { id: s.id, key: s.key, name: s.name },
          owners: bySite.get(s.id) ?? [],
        })),
    };
  }

  // --- write -----------------------------------------------------------------------------------

  /** One CRM write in the session's context; database refusals become 409 (audited). */
  private async write<T>(
    access: StaffAccess,
    companyId: string | null,
    siteId: string,
    fn: (tx: SiteScopedClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await access.crmData({ siteIds: [siteId], includePlatform: false }, fn);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (isDuplicateName(error)) throw conflict("duplicate_name", "name");
      if (!isDbRefusal(error)) throw error;
      await access.denied(CRM_MANAGE, { type: "crm_company", id: companyId }, "db_guard", {
        scope: "site",
        siteId,
      });
      throw conflict("db_guard");
    }
  }

  /** An account owner must hold crm:manage on the company's site (the database checks again). */
  private async checkOwner(
    access: StaffAccess,
    ownerUserId: string,
    siteId: string,
    companyId: string | null,
  ): Promise<void> {
    const eligible = (await access.crmOwners([siteId])).get(siteId) ?? [];
    if (eligible.some((u) => u.id === ownerUserId)) return;
    await access.denied(CRM_MANAGE, { type: "crm_company", id: companyId }, "owner_not_eligible", {
      scope: "site",
      siteId,
    });
    throw invalid("ownerUserId", "owner_not_eligible");
  }

  async create(ctx: RequestContext, body: unknown): Promise<CrmCompanyResponse> {
    const access = await this.access.begin(ctx);
    await this.manageableSites(access);
    const input = parseBody(CrmCompanyCreateInputSchema, body);
    const { siteId: requestedSite, ...fields } = input;
    const siteId = requestedSite.toLowerCase();
    await access.require(CRM_MANAGE, { scope: "site", siteId }, { type: "crm_company", id: null });
    if (fields.ownerUserId) await this.checkOwner(access, fields.ownerUserId, siteId, null);
    const row = await this.write(access, null, siteId, async (tx) => {
      const created: CompanyRow = await tx.crmCompany.create({
        data: {
          ...fields,
          siteId,
          // The database stamps the session's user as creator and editor (guard trigger).
          createdById: access.userId,
          updatedById: access.userId,
        },
        select: COMPANY_SELECT,
      });
      await access.audit(tx, {
        action: "crm.company_created",
        resourceType: "crm_company",
        resourceId: created.id,
        siteId,
        permission: CRM_MANAGE,
        metadata: {
          // Field names only: the values are customer data.
          fields: CRM_COMPANY_FIELDS.filter((f) => fields[f] !== null),
          ownerUserId: created.ownerUserId,
          accessAssignmentIds: access.grantRefs(CRM_MANAGE, [siteId]),
        },
      });
      return created;
    });
    const people = await this.people(access, [row], true);
    return { company: this.company(row, this.siteKey(access, siteId), people) };
  }

  async update(ctx: RequestContext, rawId: string, body: unknown): Promise<CrmCompanyResponse> {
    const access = await this.access.begin(ctx);
    const siteIds = await this.manageableSites(access);
    if (!UuidSchema.safeParse(rawId).success) throw new ApiError("NOT_FOUND");
    const id = rawId.toLowerCase();
    const input = parseBody(CrmCompanyUpdateInputSchema, body);
    const current: CompanyRow | null = await access.crmData(
      { siteIds, includePlatform: false },
      (tx) =>
        tx.crmCompany.findFirst({ where: { id, siteId: { in: siteIds } }, select: COMPANY_SELECT }),
    );
    if (!current) {
      await access.denied(CRM_MANAGE, { type: "crm_company", id }, "not_found_or_other_site");
      throw new ApiError("NOT_FOUND");
    }
    if (current.version !== input.version) throw conflict("stale", "version");
    const { version, ...fields } = input;
    const changed: CrmCompanyField[] = CRM_COMPANY_FIELDS.filter(
      (f) => (fields[f] ?? null) !== current[f],
    );
    if (changed.length === 0) throw conflict("unchanged");
    if (changed.includes("ownerUserId") && fields.ownerUserId) {
      await this.checkOwner(access, fields.ownerUserId, current.siteId, id);
    }
    const data = Object.fromEntries(changed.map((f) => [f, fields[f]]));
    const row = await this.write(access, id, current.siteId, async (tx) => {
      const updated = await tx.crmCompany.updateMany({
        where: { id, siteId: current.siteId, version },
        data,
      });
      if (updated.count !== 1) throw conflict("stale", "version");
      await access.audit(tx, {
        action: "crm.company_updated",
        resourceType: "crm_company",
        resourceId: id,
        siteId: current.siteId,
        permission: CRM_MANAGE,
        metadata: {
          fields: changed,
          version: version + 1,
          ...(changed.includes("ownerUserId")
            ? { fromOwnerUserId: current.ownerUserId, toOwnerUserId: fields.ownerUserId }
            : {}),
          accessAssignmentIds: access.grantRefs(CRM_MANAGE, [current.siteId]),
        },
      });
      const fresh: CompanyRow = await tx.crmCompany.findFirstOrThrow({
        where: { id, siteId: current.siteId },
        select: COMPANY_SELECT,
      });
      return fresh;
    });
    const people = await this.people(access, [row], true);
    return { company: this.company(row, this.siteKey(access, row.siteId), people) };
  }
}
