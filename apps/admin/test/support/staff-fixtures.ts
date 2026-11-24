// ML-12e (DP-243): fixtures of the Staff area (staff-en.test.tsx, staff-i18n.test.tsx): every
// account status, platform and site roles, the system owner, time-limited roles, memberships of
// every status and an unknown site.
import type { AssignableRole, StaffListResponse, StaffMember, StaffSite } from "@dream/contracts";

export const STAFF_API = "/api/v1/admin/staff";
export const NOW = new Date("2026-11-24T10:00:00.000Z");
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const BV = id(901);
export const CORP = id(902);
export const UNKNOWN_SITE = id(903);
export const VIEWER = id(1);

export const SITES: StaffSite[] = [
  { id: BV, key: "BV", name: "Dream Petroleum BV" },
  { id: CORP, key: "CORPORATE", name: "Dream Petroleum" },
];

export const ROLES: AssignableRole[] = [
  {
    key: "platform_super_admin",
    name: "Platform Super Admin",
    description:
      "Platform administration on every site: users, roles, lead and CRM data; manages publisher roles. No publishing.",
    scopeType: "PLATFORM",
    customerData: true,
    siteIds: [],
    platform: true,
  },
  {
    key: "platform_product_manager",
    name: "Platform Product Manager",
    description:
      "Creates and edits the platform-wide product master records and reads every site's catalogue; no site listings, approval or publishing.",
    scopeType: "PLATFORM",
    customerData: false,
    siteIds: [],
    platform: true,
  },
  {
    key: "site_admin",
    name: "Site Admin",
    description:
      "Administers one site and publishes its content and products; no customer data, no other site.",
    scopeType: "SITE",
    customerData: false,
    siteIds: [BV, CORP],
    platform: false,
  },
  {
    key: "sales_crm_user",
    name: "Sales / CRM User",
    description: "Works leads and the CRM of one site.",
    scopeType: "SITE",
    customerData: true,
    siteIds: [BV],
    platform: false,
  },
  {
    // Not usable: a site role the viewer may assign nowhere.
    key: "content_editor",
    name: "Content Editor",
    description: "Writes content drafts and manages media of one site; cannot publish.",
    scopeType: "SITE",
    customerData: false,
    siteIds: [],
    platform: false,
  },
];

export const role = (
  n: number,
  roleKey: string,
  roleName: string,
  siteId: string | null,
  extra: Partial<StaffMember["roles"][number]> = {},
): StaffMember["roles"][number] => ({
  id: id(100 + n),
  roleKey,
  roleName,
  scopeType: siteId ? "SITE" : "PLATFORM",
  siteId,
  grantedAt: "2026-01-10T09:00:00.000Z",
  expiresAt: null,
  grantedBy: "Ada Admin",
  canRevoke: true,
  ...extra,
});

export const STAFF: StaffMember[] = [
  {
    id: VIEWER,
    email: "ada.admin@fixture.invalid",
    displayName: "Ada Admin",
    status: "ACTIVE",
    mfaEnrolled: true,
    memberships: [],
    roles: [role(1, "platform_super_admin", "Platform Super Admin", null, { grantedBy: null })],
  },
  {
    id: id(2),
    email: "owner@fixture.invalid",
    displayName: "Olga Owner",
    status: "ACTIVE",
    mfaEnrolled: true,
    memberships: [],
    roles: [
      role(2, "system_owner", "System Owner", null, { grantedBy: null, canRevoke: false }),
      role(3, "platform_super_admin", "Platform Super Admin", null, { canRevoke: false }),
    ],
  },
  {
    id: id(3),
    email: "sam.sales@fixture.invalid",
    displayName: "Sam Sales",
    status: "ACTIVE",
    mfaEnrolled: true,
    memberships: [
      { siteId: BV, status: "ACTIVE" },
      { siteId: CORP, status: "SUSPENDED" },
    ],
    roles: [
      // Ends within 14 days: "Ends soon".
      role(4, "sales_crm_user", "Sales / CRM User", BV, {
        expiresAt: "2026-12-01T23:59:00.000Z",
      }),
      // Ends later.
      role(5, "site_admin", "Site Admin", CORP, { expiresAt: "2027-03-31T23:59:00.000Z" }),
      // Already past (older time-limited assignment, still listed).
      role(6, "content_editor", "Content Editor", BV, {
        expiresAt: "2026-11-01T23:59:00.000Z",
        grantedBy: null,
      }),
    ],
  },
  {
    id: id(4),
    email: "pia.pending@fixture.invalid",
    displayName: "Pia Pending",
    status: "PENDING",
    mfaEnrolled: false,
    memberships: [{ siteId: BV, status: "INVITED" }],
    roles: [role(7, "content_editor", "Content Editor", BV)],
  },
  {
    id: id(5),
    email: "sid.suspended@fixture.invalid",
    displayName: "Sid Suspended",
    status: "SUSPENDED",
    mfaEnrolled: true,
    memberships: [
      { siteId: CORP, status: "SUSPENDED" },
      { siteId: UNKNOWN_SITE, status: "ACTIVE" },
    ],
    roles: [role(8, "technical_reviewer", "Technical Reviewer", UNKNOWN_SITE)],
  },
  {
    id: id(6),
    email: "cleo.closed@fixture.invalid",
    displayName: "Cleo Closed",
    status: "DEACTIVATED",
    mfaEnrolled: false,
    memberships: [{ siteId: BV, status: "REVOKED" }],
    roles: [],
  },
  {
    id: id(7),
    email: "pete.product@fixture.invalid",
    displayName: "Pete Product",
    status: "ACTIVE",
    mfaEnrolled: true,
    memberships: [],
    roles: [
      role(9, "platform_product_manager", "Platform Product Manager", null, {
        expiresAt: "2026-12-07T12:00:00.000Z",
      }),
    ],
  },
];

export const list = (over: Partial<StaffListResponse> = {}): StaffListResponse => ({
  staff: STAFF,
  roles: ROLES,
  sites: SITES,
  viewerId: VIEWER,
  ...over,
});
