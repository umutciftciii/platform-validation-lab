import type { Metadata } from "next";
import { StaffListResponseSchema, type StaffMember, type StaffSite } from "@dream/contracts";
import { PageHeader, SITE_SHORT } from "../../../components/catalog/parts";
import {
  AssignRoleForm,
  InviteForm,
  RemoveRoleButton,
} from "../../../components/staff/staff-actions";
import { EmptyState, ErrorState, Panel, StatusPill, type PillTone } from "../../../components/ui";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export const metadata: Metadata = { title: "Staff and access" };

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Amsterdam",
});

const STATUS_TONE: Record<StaffMember["status"], PillTone> = {
  ACTIVE: "success",
  PENDING: "amber",
  SUSPENDED: "danger",
  DEACTIVATED: "neutral",
};
const STATUS_LABEL: Record<StaffMember["status"], string> = {
  ACTIVE: "Active",
  PENDING: "Invited",
  SUSPENDED: "Suspended",
  DEACTIVATED: "Closed",
};

function siteLabel(sites: readonly StaffSite[], id: string | null): string {
  if (!id) return "All sites";
  const s = sites.find((x) => x.id === id);
  return s ? SITE_SHORT[s.key] : "Site";
}

/**
 * Staff and access (DP-076 revision, DP-107; ADR-017 v2): who works here, which roles they hold,
 * and the direct way to give or remove a role. The API decides every change; this page only
 * offers what the viewer's own roles allow.
 */
export default async function StaffPage() {
  await requireStaffSession();
  const res = await serverRead("/api/v1/admin/staff", StaffListResponseSchema);
  if (!res.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="staff" title="Staff and access" />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          {res.status === 403 ? (
            <EmptyState icon="shield" title="Not available for your role">
              Only administrators see staff accounts and their roles.
            </EmptyState>
          ) : (
            <ErrorState title="Staff could not be loaded">Try again in a moment.</ErrorState>
          )}
        </div>
      </div>
    );
  }
  const { staff, roles, sites, viewerId } = res.data;
  const now = new Date();
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="staff"
        title="Staff and access"
        description="Give a role in a few steps: person, role, site. Roles apply at once and stay until you remove them, unless you set an end date. Every change is recorded in the audit log."
      />

      <Panel id="assign" title="Give a role">
        <AssignRoleForm staff={staff} roles={roles} sites={sites} viewerId={viewerId} />
      </Panel>

      <Panel
        id="people"
        title="People and their roles"
        description={`${staff.length} staff account${staff.length === 1 ? "" : "s"}`}
        bodyClassName="px-0! pb-1! pt-2!"
      >
        <ul>
          {staff.map((p) => (
            <li
              key={p.id}
              className="grid gap-3 border-t border-line px-5 py-4 first:border-t-0 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-ink">{p.displayName}</span>
                  <StatusPill tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</StatusPill>
                  {p.id === viewerId ? <StatusPill tone="petrol">You</StatusPill> : null}
                </p>
                <p className="truncate text-sm text-ink-3">{p.email}</p>
                {p.memberships.length ? (
                  <p className="mt-1 text-xs text-ink-3">
                    Sites:{" "}
                    {p.memberships
                      .map(
                        (m) =>
                          `${siteLabel(sites, m.siteId)}${m.status === "ACTIVE" ? "" : ` (${m.status.toLowerCase()})`}`,
                      )
                      .join(", ")}
                  </p>
                ) : null}
              </div>
              <div>
                {p.roles.length ? (
                  <ul className="space-y-1.5">
                    {p.roles.map((r) => (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-surface-2 px-3 py-1.5 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="font-medium text-ink">{r.roleName}</span>{" "}
                          <span className="text-ink-3">
                            · {siteLabel(sites, r.siteId)}
                            {r.expiresAt ? ` · until ${DATE.format(new Date(r.expiresAt))}` : ""}
                            {r.grantedBy ? ` · by ${r.grantedBy}` : ""}
                          </span>
                          {r.expiresAt &&
                          new Date(r.expiresAt).getTime() - now.getTime() < 14 * 86_400_000 ? (
                            <span className="ml-2">
                              <StatusPill tone="amber">Ends soon</StatusPill>
                            </span>
                          ) : null}
                        </span>
                        {r.canRevoke && p.id !== viewerId ? (
                          <RemoveRoleButton
                            assignmentId={r.id}
                            label={`${r.roleName} from ${p.displayName}`}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-3">No roles.</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        id="invite"
        title="Invite a staff member"
        description="Creates the account and a one-time enrolment link (password and authenticator)."
      >
        <InviteForm sites={sites} roles={roles} />
      </Panel>
    </div>
  );
}
