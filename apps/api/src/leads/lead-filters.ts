/**
 * The lead filters of the admin console (DP-042, DP-041, DP-221, DP-227), shared by the list and
 * the CSV export so both always select the same leads: site, search, status, assignee, source and
 * the creation date range. Leads are customer data: only sites with lead:read are ever selected,
 * and the rows are read again through row-level security (access.leadData).
 */
import {
  LeadAssigneeFilterSchema,
  LeadDayFilterSchema,
  LeadSourceSchema,
  LeadStatusSchema,
  type LeadSource,
  type LeadStatus,
} from "@dream/contracts";
import { ApiError } from "../iam/http/api-error.js";
import type { SiteScopedClient } from "../iam/site-scope.js";
import type { AccessSite, StaffAccess } from "../iam/staff/access.js";
import { dayEnd, dayStart, isCalendarDay } from "./lead-export-csv.js";

export const LEAD_READ = "lead:read";

export type LeadWhere = NonNullable<Parameters<SiteScopedClient["lead"]["findMany"]>[0]>["where"];

export interface LeadFilterQuery {
  siteId?: string | undefined;
  q?: string | undefined;
  /** DP-041 filters. */
  status?: string | undefined;
  assignee?: string | undefined;
  /** DP-221: DOCUMENT_REQUEST or CONTACT_FORM. */
  source?: string | undefined;
  /** DP-227: creation date range, `YYYY-MM-DD` (Europe/Amsterdam), both ends inclusive. */
  from?: string | undefined;
  to?: string | undefined;
}

export interface ResolvedLeadFilter {
  /** Every site the caller may read leads of (for the site picker). */
  sites: AccessSite[];
  /** The sites this query selects (one when a site is named). */
  siteIds: string[];
  q: string | undefined;
  /** Without pagination. */
  where: LeadWhere;
  /** Which filters were used; no values that could hold personal data (the search text). */
  audit: Record<string, unknown>;
}

const invalid = (path: string, rule = "invalid") =>
  new ApiError("VALIDATION_FAILED", [{ path, rule }]);

/** Sites with lead:read; none at all is refused (403) and audited like any permission check. */
export async function readableLeadSites(access: StaffAccess): Promise<AccessSite[]> {
  const ids = access.sitesWith(LEAD_READ);
  if (ids.length === 0) {
    await access.require(LEAD_READ, { scope: "platform" }, { type: "lead", id: null });
  }
  return access.sites.filter((s) => ids.includes(s.id));
}

function day(value: string | undefined, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (!LeadDayFilterSchema.safeParse(value).success || !isCalendarDay(value)) throw invalid(path);
  return value;
}

export async function resolveLeadFilter(
  access: StaffAccess,
  query: LeadFilterQuery,
): Promise<ResolvedLeadFilter> {
  const sites = await readableLeadSites(access);
  let siteIds = sites.map((s) => s.id);
  if (query.siteId !== undefined) {
    const wanted = query.siteId.toLowerCase();
    if (!siteIds.includes(wanted)) {
      await access.require(
        LEAD_READ,
        { scope: "site", siteId: wanted },
        { type: "lead", id: null },
      );
    }
    siteIds = [wanted];
  }
  const q = query.q?.trim().slice(0, 100) || undefined;
  let status: LeadStatus | undefined;
  if (query.status !== undefined) {
    const parsed = LeadStatusSchema.safeParse(query.status);
    if (!parsed.success) throw invalid("status");
    status = parsed.data;
  }
  let source: LeadSource | undefined;
  if (query.source !== undefined) {
    const parsed = LeadSourceSchema.safeParse(query.source.toUpperCase());
    if (!parsed.success) throw invalid("source");
    source = parsed.data;
  }
  let assignedToId: string | null | undefined;
  let assigneeFilter: "me" | "none" | "user" | undefined;
  if (query.assignee !== undefined) {
    const parsed = LeadAssigneeFilterSchema.safeParse(query.assignee.toLowerCase());
    if (!parsed.success) throw invalid("assignee");
    assigneeFilter = parsed.data === "me" || parsed.data === "none" ? parsed.data : "user";
    assignedToId =
      parsed.data === "me" ? access.userId : parsed.data === "none" ? null : parsed.data;
  }
  const from = day(query.from, "from");
  const to = day(query.to, "to");
  if (from && to && from > to) throw invalid("to", "before_from");
  const createdAt =
    from || to
      ? { ...(from ? { gte: dayStart(from) } : {}), ...(to ? { lt: dayEnd(to) } : {}) }
      : undefined;
  const where: LeadWhere = {
    siteId: { in: siteIds },
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    ...(assignedToId !== undefined ? { assignedToId } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { company: { contains: q, mode: "insensitive" } },
            { fullName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  return {
    sites,
    siteIds,
    q,
    where,
    audit: {
      searched: Boolean(q),
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
      ...(assigneeFilter ? { assignee: assigneeFilter } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    },
  };
}
