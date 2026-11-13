/**
 * Who can work the leads of a site (DP-041; ADR-019 D3). A lead may be assigned only to an ACTIVE
 * staff user with `lead:manage` on the lead's site: an active site role that carries it with an
 * ACTIVE membership there (sales_crm_user), an active platform role that carries it (platform
 * super admin), or the designated system owner (God Mode, ADR-018).
 *
 * This list feeds the admin console (assignee picker, "no longer has access" marker). The decision
 * on write is the database's own (`leads_rls_assignee_ok`, migration
 * 20261124090000_dp_041_lead_sales_workflow), which applies the same rule; the integration tests
 * hold the two together. IAM tables have no row-level security yet (DP-125), so this
 * infrastructure helper reads them with the unscoped client and returns staff names only.
 */
import type { PrismaClient } from "../generated/prisma/client.js";

const PERMISSION = "lead:manage";

export interface LeadStaffUser {
  id: string;
  displayName: string;
  email: string;
}

function label(u: { displayName: string | null; email: string }): string {
  return u.displayName?.trim() || u.email;
}

/** Staff users who may be assigned leads of each given site, by site id (sorted by name). */
export async function leadAssigneesBySite(
  prisma: PrismaClient,
  siteIds: readonly string[],
  now: Date,
): Promise<Map<string, LeadStaffUser[]>> {
  const out = new Map<string, LeadStaffUser[]>(siteIds.map((id) => [id, []]));
  if (siteIds.length === 0) return out;
  const activeUser = { status: "ACTIVE", kind: "STAFF" } as const;
  const [assignments, owner] = await Promise.all([
    prisma.roleAssignment.findMany({
      where: {
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        user: activeUser,
        role: {
          audience: "STAFF",
          key: { not: "system_owner" },
          permissions: { some: { permission: { key: PERMISSION, audience: "STAFF" } } },
        },
        AND: [
          {
            OR: [
              { scopeType: "PLATFORM", siteId: null },
              { scopeType: "SITE", siteId: { in: [...siteIds] } },
            ],
          },
        ],
      },
      select: {
        scopeType: true,
        siteId: true,
        role: { select: { scopeType: true } },
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            memberships: { where: { status: "ACTIVE" }, select: { siteId: true } },
          },
        },
      },
    }),
    prisma.systemOwner.findFirst({
      where: { user: activeUser },
      select: { user: { select: { id: true, email: true, displayName: true } } },
    }),
  ]);
  const add = (siteId: string, u: { id: string; email: string; displayName: string | null }) => {
    const list = out.get(siteId);
    if (list && !list.some((x) => x.id === u.id)) {
      list.push({ id: u.id, displayName: label(u), email: u.email });
    }
  };
  for (const a of assignments) {
    if (a.role.scopeType !== a.scopeType) continue;
    if (a.scopeType === "PLATFORM") {
      for (const siteId of siteIds) add(siteId, a.user);
    } else if (a.siteId && a.user.memberships.some((m) => m.siteId === a.siteId)) {
      add(a.siteId, a.user);
    }
  }
  if (owner) for (const siteId of siteIds) add(siteId, owner.user);
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
