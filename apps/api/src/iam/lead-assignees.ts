/**
 * Who can work the leads of a site (DP-041; ADR-019 D3). A lead may be assigned only to an ACTIVE
 * staff user with `lead:manage` on the lead's site: an active site role that carries it with an
 * ACTIVE membership there (sales_crm_user), an active platform role that carries it (platform
 * super admin), or the designated system owner (God Mode, ADR-018).
 *
 * This list feeds the admin console (assignee picker, "no longer has access" marker). The decision
 * on write is the database's own (`leads_rls_assignee_ok`, migration
 * 20261124090000_dp_041_lead_sales_workflow), which applies the same rule; the integration tests
 * hold the two together. DP-125: the IAM tables have row-level security; the list comes from the
 * database's own rule (leads_rls_assignable_staff) and is answered only for sites whose leads
 * the session reads.
 */
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Db } from "./db.js";
import { assignableStaff } from "./iam-context.js";

export interface LeadStaffUser {
  id: string;
  displayName: string;
  email: string;
}

function label(u: { displayName: string | null; email: string }): string {
  return u.displayName?.trim() || u.email;
}

/**
 * Staff users who may be assigned leads of each given site, by site id (sorted by name). Run in
 * the caller's staff context (`inStaffContext`): the database answers only for sites whose leads
 * the session reads, and with user ids only (leads_rls_assignable_staff, DP-125).
 */
export async function leadAssigneesBySite(
  tx: Db,
  siteIds: readonly string[],
): Promise<Map<string, LeadStaffUser[]>> {
  const out = new Map<string, LeadStaffUser[]>(siteIds.map((id) => [id, []]));
  if (siteIds.length === 0) return out;
  const pairs = await assignableStaff(tx, siteIds);
  const users = await tx.user.findMany({
    where: { id: { in: [...new Set(pairs.map((p) => p.user_id))] } },
    select: { id: true, email: true, displayName: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  for (const p of pairs) {
    const u = byId.get(p.user_id);
    const list = out.get(p.site_id);
    if (u && list && !list.some((x) => x.id === u.id)) {
      list.push({ id: u.id, displayName: label(u), email: u.email });
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return out;
}

/** Display names of staff users (actors and assignees in the lead history). */
export async function staffNames(
  prisma: PrismaClient,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, email: true, displayName: true },
  });
  return new Map(users.map((u) => [u.id, label(u)]));
}
