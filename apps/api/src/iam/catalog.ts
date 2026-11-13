/**
 * Code catalogue of sites, feature modules, permissions and roles (F1-001, ADR-011).
 *
 * This file is the source of truth. The database tables Site, FeatureModule, Permission, Role and
 * RolePermission mirror it (`syncCatalog`, run by the bootstrap and on deploy), so that grants can
 * reference roles by foreign key and reports can join on them. Authorization decisions always use
 * this catalogue, never role/permission rows edited in the database.
 *
 * The roles follow K-02 with the owner decisions of F1-001A and F1-001B (ADR-011 section 3a):
 *  - the platform super admin neither reads customer/lead data nor publishes automatically; it
 *    manages publisher roles (`publisher_role:grant`) and may additionally hold a customer-data
 *    role through a separate assignment;
 *  - every role that carries customer data needs a dual-approved, time-limited assignment with a
 *    justification (DP-076, DP-077). Until that workflow exists such assignments are refused;
 *  - site_admin publishes on its own site only; editors only write drafts;
 *  - God Mode can never disable core security modules; the last platform admin is protected.
 *  - DP-108 (ADR-018): God Mode belongs to the system owner only. `system_owner` is a code role
 *    that is never assigned (database trigger, `assignable: false`): the snapshot loader adds it
 *    for the one user recorded in SystemOwner. It carries every staff permission plus the
 *    owner-only ones (`ownerOnly`: module switches, the protected audit stream), which no other
 *    role may carry.
 * Changing the matrix is a code change with review, never an admin-app edit.
 */

export type UserKindValue = "STAFF" | "CUSTOMER";
export type UserStatusValue = "PENDING" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
export type ScopeTypeValue = "PLATFORM" | "SITE";
export type SiteKeyValue = "BV" | "CORPORATE";

export interface SiteDef {
  key: SiteKeyValue;
  name: string;
  primaryDomain: string;
  defaultLocale: string;
}

export interface ModuleDef {
  key: string;
  name: string;
  description: string;
  /** Core modules are always on for every site and can never be disabled (K-03). */
  isCore: boolean;
}

export interface PermissionDef {
  key: string;
  resource: string;
  action: string;
  description: string;
  audience: UserKindValue;
  /**
   * PLATFORM: platform administration; only a PLATFORM-scope role can hold it and it is checked
   * without a site. SITE: checked for one site; held by site roles (that site) or platform roles
   * (every site).
   */
  scopeType: ScopeTypeValue;
  module: string;
  /** Needs a fresh MFA verification (step-up) in the current staff session. */
  sensitive: boolean;
  /**
   * Gives access to personal data of customers and leads. Since the DP-076 revision (ADR-017 v2)
   * such roles are assigned directly like any other role; the flag keeps them visible (audit,
   * catalogue checks). A PLATFORM role may carry it only when marked `customerDataAccess`.
   */
  customerData: boolean;
  /**
   * A PLATFORM permission whose holder may hand this permission out without holding it, e.g. the
   * super admin manages publisher roles through `publisher_role:grant` (escalation.ts).
   * Customer-data permissions are never delegable.
   */
  delegableVia?: string;
  /** DP-108: held only by the system owner (`system_owner`); no assignable role may carry it. */
  ownerOnly?: boolean;
}

export interface RoleDef {
  key: string;
  name: string;
  description: string;
  audience: UserKindValue;
  scopeType: ScopeTypeValue;
  permissions: readonly string[];
  /** Platform-wide access to customer data of every site (super admin, customer-data officer). */
  customerDataAccess?: boolean;
  /**
   * DP-108: false only for `system_owner`, which no grantor can hand out and the database refuses
   * to assign; the system owner gets it from the SystemOwner record (repository.ts).
   */
  assignable?: boolean;
}

export const SITES: readonly SiteDef[] = [
  {
    key: "BV",
    name: "Dream Petroleum BV",
    primaryDomain: "dreampetroleumbv.com",
    defaultLocale: "en",
  },
  {
    key: "CORPORATE",
    name: "Dream Petroleum",
    primaryDomain: "dreampetroleum.com",
    defaultLocale: "en",
  },
];

export const MODULES: readonly ModuleDef[] = [
  // Security core (F1-001 rule: MFA, audit and basic RBAC are core).
  {
    key: "rbac",
    name: "Roles and access",
    description: "RBAC, site scope, users and role assignments",
    isCore: true,
  },
  { key: "audit", name: "Audit trail", description: "Append-only audit events", isCore: true },
  {
    key: "mfa",
    name: "Multi-factor authentication",
    description: "MFA enrolment, step-up and recovery",
    isCore: true,
  },
  {
    key: "platform",
    name: "Platform administration",
    description: "Sites and the God Mode module catalogue",
    isCore: true,
  },
  // Standard product core (K-03: CMS, product, lead and member core is always on).
  {
    key: "cms",
    name: "Content management",
    description: "Pages, sections, media and publishing",
    isCore: true,
  },
  {
    key: "catalog",
    name: "Product catalogue",
    description: "Products, technical data and documents",
    isCore: true,
  },
  { key: "leads", name: "Leads", description: "Contact and document-request leads", isCore: true },
  {
    key: "membership",
    name: "Membership",
    description: "Member accounts and member-only technical data",
    isCore: true,
  },
  // Optional modules, enabled per site by God Mode.
  {
    key: "crm",
    name: "CRM",
    description: "Sales pipeline on top of leads (optional)",
    isCore: false,
  },
  {
    key: "automation",
    name: "Automation",
    description: "Rule-based follow-ups and notifications (optional)",
    isCore: false,
  },
  {
    key: "integrations",
    name: "Integrations",
    description: "Outbound integrations and webhooks (optional)",
    isCore: false,
  },
  {
    key: "customer_portal",
    name: "Customer portal",
    description: "Company-level document and request history (optional)",
    isCore: false,
  },
];

function perm(
  resource: string,
  action: string,
  module: string,
  description: string,
  opts: {
    scopeType?: ScopeTypeValue;
    audience?: UserKindValue;
    sensitive?: boolean;
    customerData?: boolean;
    delegableVia?: string;
    ownerOnly?: boolean;
  } = {},
): PermissionDef {
  return {
    key: `${resource}:${action}`,
    resource,
    action,
    description,
    module,
    audience: opts.audience ?? "STAFF",
    scopeType: opts.scopeType ?? "SITE",
    sensitive: opts.sensitive ?? false,
    customerData: opts.customerData ?? false,
    ...(opts.delegableVia ? { delegableVia: opts.delegableVia } : {}),
    ...(opts.ownerOnly ? { ownerOnly: true } : {}),
  };
}

const P = "PLATFORM" as const;
const CUSTOMER = "CUSTOMER" as const;

export const PERMISSIONS: readonly PermissionDef[] = [
  // Platform administration (God Mode). Never site-scoped.
  perm("site", "read", "platform", "View sites and their settings", { scopeType: P }),
  perm("site", "manage", "platform", "Change site settings", { scopeType: P, sensitive: true }),
  perm("module", "read", "platform", "View the module catalogue and per-site states", {
    scopeType: P,
  }),
  // DP-108 (owner decision K1): module switches are the system owner's only (God Mode).
  perm("module", "manage", "platform", "Enable or disable optional modules per site (God Mode)", {
    scopeType: P,
    sensitive: true,
    ownerOnly: true,
  }),
  perm("role", "read", "rbac", "View role definitions and the permission matrix", { scopeType: P }),
  perm(
    "customer_data_access",
    "grant",
    "rbac",
    "Retired (DP-076 revision): customer-data roles are assigned directly with role_assignment:grant; grants nothing",
    { scopeType: P, sensitive: true },
  ),
  perm(
    "publisher_role",
    "grant",
    "rbac",
    "Manage publisher roles: hand out content/product publish permissions without holding them",
    { scopeType: P, sensitive: true },
  ),
  // Users and access, per site.
  perm("user", "read", "rbac", "View staff accounts that work on the site"),
  perm("user", "invite", "rbac", "Invite a user to the site"),
  perm(
    "user",
    "suspend",
    "rbac",
    "Suspend a staff user (site: membership; platform target: account)",
    {
      sensitive: true,
    },
  ),
  // F1-002 (ADR-013, design 10.1). Targets are staff only; canActOnUser adds target superiority.
  perm(
    "user",
    "reactivate",
    "rbac",
    "Reactivate a suspended staff user (never a DEACTIVATED one)",
    {
      sensitive: true,
    },
  ),
  perm("user", "unlock", "rbac", "Clear a staff user's login throttle buckets", {
    sensitive: true,
  }),
  perm("session", "revoke", "rbac", "Revoke another staff user's sessions", { sensitive: true }),
  perm("user", "deactivate", "rbac", "Close a staff account permanently (terminal state)", {
    scopeType: P,
    sensitive: true,
  }),
  perm("role_assignment", "read", "rbac", "View role assignments"),
  perm(
    "role_assignment",
    "grant",
    "rbac",
    "Grant a role (only roles within the grantor's own permissions)",
  ),
  // DP-076 revision: role changes need the MFA of the sign-in, no extra step-up.
  perm("role_assignment", "revoke", "rbac", "Revoke a role assignment"),
  perm("mfa", "reset", "mfa", "Reset another user's MFA enrolment", { sensitive: true }),
  perm("audit", "read", "audit", "Read audit events"),
  // DP-108: the PROTECTED stream (the owner's actions and everything aimed at the owner account).
  perm(
    "owner_audit",
    "read",
    "audit",
    "Read and verify the protected audit stream (system owner only)",
    { scopeType: P, sensitive: true, ownerOnly: true },
  ),
  // CMS.
  perm("content", "read", "cms", "Read pages and sections, including drafts"),
  perm("content", "edit", "cms", "Create and edit drafts"),
  perm("content", "review", "cms", "Review and comment on drafts"),
  perm("content", "publish", "cms", "Publish or unpublish content", {
    delegableVia: "publisher_role:grant",
  }),
  perm("media", "read", "cms", "Browse the media library"),
  perm("media", "upload", "cms", "Upload and replace media"),
  // Product catalogue (K-01: entry, approval and publication are separate).
  // PM-1: the product master record is platform-wide; only this PLATFORM permission changes it.
  // Site roles never get it (a platform permission cannot sit in a site role).
  perm("product_master", "edit", "catalog", "Create, edit and archive platform product masters", {
    scopeType: P,
  }),
  perm("product", "read", "catalog", "Read products, including drafts"),
  perm("product", "edit", "catalog", "Edit the site's product listings and categories"),
  perm("product", "approve", "catalog", "Approve technical product data"),
  perm("product", "publish", "catalog", "Publish products to the site", {
    delegableVia: "publisher_role:grant",
  }),
  // Leads and members (customer data stays inside its site by default, K-02).
  perm("lead", "read", "leads", "Read leads and document requests", { customerData: true }),
  perm("lead", "manage", "leads", "Update lead status and notes", { customerData: true }),
  perm("lead", "export", "leads", "Export leads (CSV)", { sensitive: true, customerData: true }),
  perm("membership", "read", "membership", "Read member accounts", { customerData: true }),
  perm("membership", "manage", "membership", "Approve, suspend or close member accounts", {
    sensitive: true,
    customerData: true,
  }),
  // Optional modules.
  perm("crm", "read", "crm", "Read the CRM pipeline", { customerData: true }),
  perm("crm", "manage", "crm", "Change CRM records", { customerData: true }),
  perm("automation", "manage", "automation", "Configure automations", { sensitive: true }),
  perm("integration", "manage", "integrations", "Configure integrations and webhooks", {
    sensitive: true,
  }),
  // Customer (member) permissions on a public site.
  perm("technical_spec", "view", "membership", "See member-only technical specifications", {
    audience: CUSTOMER,
  }),
  perm("document", "download", "membership", "Download member documents", { audience: CUSTOMER }),
  perm("portal", "access", "customer_portal", "Use the customer portal", { audience: CUSTOMER }),
];

export const PUBLISH_PERMISSIONS: readonly string[] = ["content:publish", "product:publish"];

/** Retired permissions that grant nothing; the system owner does not carry them (DP-109 cleanup). */
export const RETIRED_PERMISSIONS: readonly string[] = ["customer_data_access:grant"];

// Super admin: every staff permission except publishing (F1-001B) and the owner-only ones
// (DP-108), customer data included (DP-076 revision, owner decision 2026-11-11, ADR-017 v2: lead
// and CRM data without approval).
const superAdminPermissions = PERMISSIONS.filter(
  (p) => p.audience === "STAFF" && !PUBLISH_PERMISSIONS.includes(p.key) && !p.ownerOnly,
).map((p) => p.key);
// System owner (DP-108, K4): every staff permission, publishing included, except retired ones.
const systemOwnerPermissions = PERMISSIONS.filter(
  (p) => p.audience === "STAFF" && !RETIRED_PERMISSIONS.includes(p.key),
).map((p) => p.key);
/**
 * Site permissions a site admin does not get (owner decision Ö3, F1-002): revoking other staff
 * users' sessions stays with the platform super admin. The permission is site-scoped so that it
 * can be delegated to a site role later without a catalogue migration.
 */
export const SITE_ADMIN_EXCLUDED: readonly string[] = ["session:revoke"];
// Site admin: every staff site permission of its site, publishing included, customer data not.
const siteAdminPermissions = PERMISSIONS.filter(
  (p) =>
    p.audience === "STAFF" &&
    p.scopeType === "SITE" &&
    !p.customerData &&
    !SITE_ADMIN_EXCLUDED.includes(p.key),
).map((p) => p.key);

export const PLATFORM_SUPER_ADMIN = "platform_super_admin";
export const SYSTEM_OWNER = "system_owner";
export const PLATFORM_CUSTOMER_DATA_OFFICER = "platform_customer_data_officer";
export const PLATFORM_PRODUCT_MANAGER = "platform_product_manager";

export const ROLES: readonly RoleDef[] = [
  {
    key: SYSTEM_OWNER,
    name: "System Owner",
    description:
      "God Mode of the system owner: every module, every site, all data and administration, module switches and the protected audit stream. Never assigned; held by the one designated owner (DP-108).",
    audience: "STAFF",
    scopeType: "PLATFORM",
    permissions: systemOwnerPermissions,
    customerDataAccess: true,
    assignable: false,
  },
  {
    key: PLATFORM_SUPER_ADMIN,
    name: "Platform Super Admin",
    description:
      "Platform administration on every site: users, roles, lead and CRM data; manages publisher roles. No publishing.",
    audience: "STAFF",
    scopeType: "PLATFORM",
    permissions: superAdminPermissions,
    customerDataAccess: true,
  },
  {
    key: PLATFORM_CUSTOMER_DATA_OFFICER,
    name: "Platform Customer Data Officer",
    description: "Reads and exports customer and lead data of every site.",
    audience: "STAFF",
    scopeType: "PLATFORM",
    permissions: ["lead:read", "lead:export", "membership:read", "crm:read"],
    customerDataAccess: true,
  },
  {
    key: PLATFORM_PRODUCT_MANAGER,
    name: "Platform Product Manager",
    description:
      "Creates and edits the platform-wide product master records and reads every site's catalogue; no site listings, approval or publishing.",
    audience: "STAFF",
    scopeType: "PLATFORM",
    permissions: ["product_master:edit", "product:read"],
  },
  {
    key: "site_admin",
    name: "Site Admin",
    description:
      "Administers one site and publishes its content and products; no customer data, no other site.",
    audience: "STAFF",
    scopeType: "SITE",
    permissions: siteAdminPermissions,
  },
  {
    key: "content_editor",
    name: "Content Editor",
    description: "Writes content drafts and manages media of one site; cannot publish.",
    audience: "STAFF",
    scopeType: "SITE",
    permissions: ["content:read", "content:edit", "media:read", "media:upload", "product:read"],
  },
  {
    key: "content_publisher",
    name: "Content Publisher",
    description: "Publishes and unpublishes reviewed content of one site; does not edit drafts.",
    audience: "STAFF",
    scopeType: "SITE",
    permissions: ["content:read", "content:publish", "media:read"],
  },
  {
    key: "product_editor",
    name: "Product Editor",
    description:
      "Maintains the product listings and categories of one site; cannot change product masters, approve or publish.",
    audience: "STAFF",
    scopeType: "SITE",
    permissions: ["product:read", "product:edit", "media:read", "media:upload"],
  },
  {
    key: "product_publisher",
    name: "Product Publisher",
    description: "Publishes approved products of one site; does not edit product data.",
    audience: "STAFF",
    scopeType: "SITE",
    permissions: ["product:read", "product:publish", "media:read"],
  },
  {
    key: "technical_reviewer",
    name: "Technical Reviewer",
    description: "Approves technical product data of one site.",
    audience: "STAFF",
    scopeType: "SITE",
    permissions: ["product:read", "product:approve", "content:read"],
  },
  {
    key: "sales_crm_user",
    name: "Sales / CRM User",
    description: "Works leads and the CRM of one site.",
    audience: "STAFF",
    scopeType: "SITE",
    permissions: ["lead:read", "lead:manage", "membership:read", "crm:read", "crm:manage"],
  },
  {
    key: "compliance_reviewer",
    name: "Compliance Reviewer",
    description: "Reviews content and claims of one site and reads its audit trail.",
    audience: "STAFF",
    scopeType: "SITE",
    permissions: ["content:read", "content:review", "product:read", "audit:read"],
  },
  {
    key: "read_only",
    name: "Read-only",
    description: "Reads content and products of one site; no customer data.",
    audience: "STAFF",
    scopeType: "SITE",
    permissions: ["content:read", "media:read", "product:read"],
  },
  {
    key: "member",
    name: "Member",
    description: "A registered customer of one public site.",
    audience: "CUSTOMER",
    scopeType: "SITE",
    permissions: ["technical_spec:view", "document:download", "portal:access"],
  },
];

export const PERMISSION_BY_KEY: ReadonlyMap<string, PermissionDef> = new Map(
  PERMISSIONS.map((p) => [p.key, p]),
);
export const ROLE_BY_KEY: ReadonlyMap<string, RoleDef> = new Map(ROLES.map((r) => [r.key, r]));

/** Whether a role can be assigned at all (every role except `system_owner`, DP-108). */
export function isAssignableRole(role: RoleDef): boolean {
  return role.assignable !== false;
}

/** A role that carries any customer-data permission (dual approval, justification, expiry). */
export function isCustomerDataRole(role: RoleDef): boolean {
  return role.permissions.some((k) => PERMISSION_BY_KEY.get(k)?.customerData);
}
export const MODULE_BY_KEY: ReadonlyMap<string, ModuleDef> = new Map(
  MODULES.map((m) => [m.key, m]),
);

/** Problems in a catalogue; empty means consistent. Unit-tested on the real catalogue. */
export function catalogProblems(
  catalog: {
    modules: readonly ModuleDef[];
    permissions: readonly PermissionDef[];
    roles: readonly RoleDef[];
  } = { modules: MODULES, permissions: PERMISSIONS, roles: ROLES },
): string[] {
  const problems: string[] = [];
  const moduleKeys = new Set<string>();
  for (const m of catalog.modules) {
    if (moduleKeys.has(m.key)) problems.push(`module ${m.key}: duplicate key`);
    moduleKeys.add(m.key);
    if (!/^[a-z][a-z0-9_]*$/.test(m.key)) problems.push(`module ${m.key}: invalid key`);
  }
  for (const required of ["rbac", "audit", "mfa"]) {
    const m = catalog.modules.find((x) => x.key === required);
    if (!m?.isCore) problems.push(`module ${required}: must exist and be core`);
  }
  const perms = new Map<string, PermissionDef>();
  for (const p of catalog.permissions) {
    if (perms.has(p.key)) problems.push(`permission ${p.key}: duplicate key`);
    perms.set(p.key, p);
    if (p.key !== `${p.resource}:${p.action}` || !/^[a-z][a-z_]*:[a-z][a-z_]*$/.test(p.key)) {
      problems.push(`permission ${p.key}: key must be <resource>:<action> in snake_case`);
    }
    if (!moduleKeys.has(p.module)) problems.push(`permission ${p.key}: unknown module ${p.module}`);
    if (p.audience === "CUSTOMER" && p.scopeType !== "SITE") {
      problems.push(`permission ${p.key}: customer permissions are site-scoped`);
    }
    if (p.audience === "CUSTOMER" && p.sensitive) {
      problems.push(`permission ${p.key}: step-up MFA applies to staff permissions only`);
    }
    const mod = catalog.modules.find((m) => m.key === p.module);
    if (p.scopeType === "PLATFORM" && mod && !mod.isCore) {
      problems.push(`permission ${p.key}: platform permissions must belong to a core module`);
    }
  }
  const roleKeys = new Set<string>();
  for (const r of catalog.roles) {
    if (roleKeys.has(r.key)) problems.push(`role ${r.key}: duplicate key`);
    roleKeys.add(r.key);
    if (!/^[a-z][a-z0-9_]*$/.test(r.key)) problems.push(`role ${r.key}: invalid key`);
    if (new Set(r.permissions).size !== r.permissions.length) {
      problems.push(`role ${r.key}: duplicate permission`);
    }
    if (r.audience === "CUSTOMER" && r.scopeType !== "SITE") {
      problems.push(`role ${r.key}: customer roles are site-scoped`);
    }
    for (const key of r.permissions) {
      const p = perms.get(key);
      if (!p) {
        problems.push(`role ${r.key}: unknown permission ${key}`);
        continue;
      }
      if (p.audience !== r.audience) problems.push(`role ${r.key}: ${key} is for ${p.audience}`);
      if (p.scopeType === "PLATFORM" && r.scopeType !== "PLATFORM") {
        problems.push(`role ${r.key}: platform permission ${key} in a site role`);
      }
      if (p.customerData && r.scopeType === "PLATFORM" && !r.customerDataAccess) {
        problems.push(
          `role ${r.key}: platform role carries customer data ${key} without customerDataAccess`,
        );
      }
    }
  }
  const superAdmin = catalog.roles.find((r) => r.key === PLATFORM_SUPER_ADMIN);
  for (const key of superAdmin?.permissions ?? []) {
    if (PUBLISH_PERMISSIONS.includes(key))
      problems.push(`role ${PLATFORM_SUPER_ADMIN}: publishes (${key})`);
  }
  for (const p of catalog.permissions) {
    if (!p.delegableVia) continue;
    const via = perms.get(p.delegableVia);
    if (!via || via.scopeType !== "PLATFORM" || !via.sensitive) {
      problems.push(`permission ${p.key}: delegableVia must name a sensitive PLATFORM permission`);
    }
    if (p.customerData) problems.push(`permission ${p.key}: customer data is never delegable`);
  }
  for (const r of catalog.roles) {
    if (r.customerDataAccess && r.scopeType !== "PLATFORM") {
      problems.push(`role ${r.key}: customerDataAccess is only for platform roles`);
    }
  }
  // DP-108: exactly one non-assignable role, the system owner; owner-only permissions nowhere else.
  const unassignable = catalog.roles.filter((r) => r.assignable === false);
  if (unassignable.length !== 1 || unassignable[0]?.key !== SYSTEM_OWNER) {
    problems.push(`role ${SYSTEM_OWNER}: must be the only non-assignable role`);
  }
  const owner = catalog.roles.find((r) => r.key === SYSTEM_OWNER);
  if (owner && (owner.audience !== "STAFF" || owner.scopeType !== "PLATFORM")) {
    problems.push(`role ${SYSTEM_OWNER}: must be a STAFF PLATFORM role`);
  }
  for (const p of catalog.permissions) {
    if (!p.ownerOnly) continue;
    if (p.scopeType !== "PLATFORM" || !p.sensitive || p.audience !== "STAFF") {
      problems.push(`permission ${p.key}: owner-only permissions are sensitive STAFF PLATFORM`);
    }
    for (const r of catalog.roles) {
      if (r.key !== SYSTEM_OWNER && r.permissions.includes(p.key)) {
        problems.push(`role ${r.key}: carries owner-only permission ${p.key}`);
      }
    }
  }
  return problems;
}
