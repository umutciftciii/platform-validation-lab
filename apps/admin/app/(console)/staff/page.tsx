import type { Metadata } from "next";
import { StaffListResponseSchema, type StaffMember, type StaffSite } from "@dream/contracts";
import { PageHeader, SITE_SHORT } from "../../../components/catalog/parts";
import {
  AssignRoleForm,
  InviteForm,
  RemoveRoleButton,
} from "../../../components/staff/staff-actions";
import { EmptyState, ErrorState, Panel, StatusPill, type PillTone } from "../../../components/ui";
import { dateTimeFormat } from "../../../lib/i18n/format";
import { staff as STAFF_EN } from "../../../lib/i18n/messages/staff/en";
import { getAdminLocale, getTranslator } from "../../../lib/i18n/server";
import type { Translate } from "../../../lib/i18n/types";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("staff.page.title") };
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Amsterdam",
};

const STATUS_TONE: Record<StaffMember["status"], PillTone> = {
  ACTIVE: "success",
  PENDING: "amber",
  SUSPENDED: "danger",
  DEACTIVATED: "neutral",
};

type RoleKey = keyof typeof STAFF_EN.roles;

/**
 * The role's name in the UI language, by its key: only while the API still sends the English name
 * of the dictionary; a renamed or unknown role shows the API's own text (the key never changes).
 */
function roleName(key: string, apiName: string, t: Translate): string {
  return Object.hasOwn(STAFF_EN.roles, key) && STAFF_EN.roles[key as RoleKey].name === apiName
    ? t(`staff.roles.${key as RoleKey}.name`)
    : apiName;
}

function siteLabel(sites: readonly StaffSite[], id: string | null, t: Translate): string {
  if (!id) return t("staff.page.allSites");
  const s = sites.find((x) => x.id === id);
  return s ? SITE_SHORT[s.key] : t("staff.page.unknownSite");
}

/**
 * Staff and access (DP-076 revision, DP-107; ADR-017 v2): who works here, which roles they hold,
 * and the direct way to give or remove a role. The API decides every change; this page only
 * offers what the viewer's own roles allow.
 */
export default async function StaffPage() {
  await requireStaffSession();
  const t = await getTranslator();
  const locale = await getAdminLocale();
  const res = await serverRead("/api/v1/admin/staff", StaffListResponseSchema);
  if (!res.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="staff" title={t("staff.page.title")} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          {res.status === 403 ? (
            <EmptyState icon="shield" title={t("staff.page.forbiddenTitle")}>
              {t("staff.page.forbiddenBody")}
            </EmptyState>
          ) : (
            <ErrorState title={t("staff.page.errorTitle")}>{t("staff.page.errorBody")}</ErrorState>
          )}
        </div>
      </div>
    );
  }
  const { staff, roles, sites, viewerId } = res.data;
  const now = new Date();
  const date = dateTimeFormat(locale, DATE_OPTIONS);
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="staff"
        title={t("staff.page.title")}
        description={t("staff.page.description")}
      />

      <Panel id="assign" title={t("staff.page.assignTitle")}>
        <AssignRoleForm staff={staff} roles={roles} sites={sites} viewerId={viewerId} />
      </Panel>

      <Panel
        id="people"
        title={t("staff.page.peopleTitle")}
        description={t("staff.page.peopleCount", { count: staff.length })}
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
                  <StatusPill tone={STATUS_TONE[p.status]}>
                    {t(`staff.status.${p.status}`)}
                  </StatusPill>
                  {p.id === viewerId ? (
                    <StatusPill tone="petrol">{t("staff.page.you")}</StatusPill>
                  ) : null}
                </p>
                <p className="truncate text-sm text-ink-3">{p.email}</p>
                {p.memberships.length ? (
                  <p className="mt-1 text-xs text-ink-3">
                    {t("staff.page.sites", {
                      list: p.memberships
                        .map((m) =>
                          m.status === "ACTIVE"
                            ? siteLabel(sites, m.siteId, t)
                            : t("staff.page.membershipNotActive", {
                                site: siteLabel(sites, m.siteId, t),
                                status: t(`staff.membership.${m.status}`),
                              }),
                        )
                        .join(", "),
                    })}
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
                          <span className="font-medium text-ink">
                            {roleName(r.roleKey, r.roleName, t)}
                          </span>{" "}
                          <span className="text-ink-3">
                            {t("staff.page.roleSite", { site: siteLabel(sites, r.siteId, t) })}
                            {r.expiresAt
                              ? t("staff.page.roleUntil", {
                                  date: date.format(new Date(r.expiresAt)),
                                })
                              : ""}
                            {r.grantedBy ? t("staff.page.roleBy", { name: r.grantedBy }) : ""}
                          </span>
                          {r.expiresAt &&
                          new Date(r.expiresAt).getTime() - now.getTime() < 14 * 86_400_000 ? (
                            <span className="ml-2">
                              <StatusPill tone="amber">{t("staff.page.endsSoon")}</StatusPill>
                            </span>
                          ) : null}
                        </span>
                        {r.canRevoke && p.id !== viewerId ? (
                          <RemoveRoleButton
                            assignmentId={r.id}
                            label={t("staff.page.removeLabel", {
                              role: roleName(r.roleKey, r.roleName, t),
                              name: p.displayName,
                            })}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-3">{t("staff.page.noRoles")}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        id="invite"
        title={t("staff.page.inviteTitle")}
        description={t("staff.page.inviteDescription")}
      >
        <InviteForm sites={sites} roles={roles} />
      </Panel>
    </div>
  );
}
