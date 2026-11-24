/**
 * ML-12e (DP-243): English messages of the Staff area. Moved verbatim from the components, so the
 * English console renders exactly as before ML-12e (test/staff-en.test.tsx).
 */
export const staff = {
  /**
   * lib/staff-client.ts (shared with the owner console and the lead workflow): messages of the
   * admin API's answers, by rule (error detail `rule`) and code.
   */
  api: {
    unreachable: "The admin API cannot be reached.",
    forbidden:
      "You may not make this change (it needs permissions you do not hold, or another site).",
    saveFailed: "The change could not be saved. Try again in a moment.",
    rules: {
      already_assigned: "This person already has this role there.",
      self_grant: "You cannot change your own roles.",
      reciprocal_grant: "You cannot give a role to someone who gave you yours.",
      membership_inactive: "This person's access to that site is suspended. Reactivate it first.",
      scope_mismatch: "Choose a site for a site role, none for a platform role.",
      expiry_in_past: "The end date must be in the future.",
      already_ended: "This role has already ended. Reload the page.",
      assignee_inactive: "This account is closed.",
      unknown_role: "Unknown role.",
      db_guard: "The database refused this change. Reload the page and try again.",
      core_module: "Core modules are always on and cannot be switched off.",
      reason_required: "Give a reason for the change.",
      already_designated: "A system owner is already designated. It cannot be changed.",
      not_eligible:
        "This account cannot become the owner (it needs a password and an authenticator).",
      stale: "Someone else changed this lead meanwhile. Reload the page and try again.",
      transition: "This status change is not allowed from the current status.",
      unchanged: "Nothing to change.",
      anonymised: "This lead is anonymised and cannot change.",
      assignee_not_eligible: "This person cannot work leads of this site.",
      future: "The contact cannot be in the future.",
    },
  },
  /**
   * Role names and descriptions by role key (EN = the API's text, apps/api/src/iam/catalog.ts).
   * Shown only while the API still sends that English text; any other or unknown role shows the
   * API's own text (see roleName/roleDescription in the Staff page and staff-actions).
   */
  roles: {
    system_owner: {
      name: "System Owner",
      description:
        "God Mode of the system owner: every module, every site, all data and administration, module switches and the protected audit stream. Never assigned; held by the one designated owner (DP-108).",
    },
    platform_super_admin: {
      name: "Platform Super Admin",
      description:
        "Platform administration on every site: users, roles, lead and CRM data; manages publisher roles. No publishing.",
    },
    platform_customer_data_officer: {
      name: "Platform Customer Data Officer",
      description: "Reads and exports customer and lead data of every site.",
    },
    platform_product_manager: {
      name: "Platform Product Manager",
      description:
        "Creates and edits the platform-wide product master records and reads every site's catalogue; no site listings, approval or publishing.",
    },
    site_admin: {
      name: "Site Admin",
      description:
        "Administers one site and publishes its content and products; no customer data, no other site.",
    },
    content_editor: {
      name: "Content Editor",
      description: "Writes content drafts and manages media of one site; cannot publish.",
    },
    content_publisher: {
      name: "Content Publisher",
      description: "Publishes and unpublishes reviewed content of one site; does not edit drafts.",
    },
    product_editor: {
      name: "Product Editor",
      description:
        "Maintains the product listings and categories of one site; cannot change product masters, approve or publish.",
    },
    product_publisher: {
      name: "Product Publisher",
      description: "Publishes approved products of one site; does not edit product data.",
    },
    technical_reviewer: {
      name: "Technical Reviewer",
      description: "Approves technical product data of one site.",
    },
    sales_crm_user: {
      name: "Sales / CRM User",
      description: "Works leads and the CRM of one site.",
    },
    compliance_reviewer: {
      name: "Compliance Reviewer",
      description: "Reviews content and claims of one site and reads its audit trail.",
    },
    company_content_reviewer: {
      name: "Company Content Reviewer",
      description:
        "Reads one site's products and approves or requests changes on proposed content; cannot edit, approve technical data or publish.",
    },
    read_only: {
      name: "Read-only",
      description: "Reads content and products of one site; no customer data.",
    },
    member: {
      name: "Member",
      description: "A registered customer of one public site.",
    },
  },
  /** Account status pills (API status codes). */
  status: {
    ACTIVE: "Active",
    PENDING: "Invited",
    SUSPENDED: "Suspended",
    DEACTIVATED: "Closed",
  },
  /** A site membership that is not active, in the "Sites:" line: "Corporate (suspended)". */
  membership: {
    ACTIVE: "active",
    INVITED: "invited",
    SUSPENDED: "suspended",
    REVOKED: "revoked",
  },
  /** app/(console)/staff/page.tsx */
  page: {
    title: "Staff and access",
    description:
      "Give a role in a few steps: person, role, site. Roles apply at once and stay until you remove them, unless you set an end date. Every change is recorded in the audit log.",
    forbiddenTitle: "Not available for your role",
    forbiddenBody: "Only administrators see staff accounts and their roles.",
    errorTitle: "Staff could not be loaded",
    errorBody: "Try again in a moment.",
    assignTitle: "Give a role",
    peopleTitle: "People and their roles",
    peopleCount: { one: "{count} staff account", other: "{count} staff accounts" },
    you: "You",
    sites: "Sites: {list}",
    membershipNotActive: "{site} ({status})",
    allSites: "All sites",
    unknownSite: "Site",
    roleSite: "· {site}",
    roleUntil: " · until {date}",
    roleBy: " · by {name}",
    endsSoon: "Ends soon",
    removeLabel: "{role} from {name}",
    noRoles: "No roles.",
    inviteTitle: "Invite a staff member",
    inviteDescription:
      "Creates the account and a one-time enrolment link (password and authenticator).",
  },
  /** components/staff/staff-actions.tsx: AssignRoleForm */
  assign: {
    form: "Give a role",
    noRoles: "Your roles do not allow you to give roles to others.",
    person: "Staff member",
    choosePerson: "Choose a person…",
    role: "Role",
    chooseRole: "Choose a role…",
    leadData: " · lead data",
    site: "Site",
    end: "Ends on (optional)",
    endHint: "Empty: no end date.",
    submit: "Give role",
    success: "{name} now has the role {role}.",
    someone: "The person",
  },
  /** components/staff/staff-actions.tsx: RemoveRoleButton ({label} = "<role> from <person>") */
  remove: {
    remove: "Remove",
    removeLabel: "Remove {label}",
    confirmLabel: "Confirm removing {label}",
    keep: "Keep",
  },
  /** components/staff/staff-actions.tsx: InviteForm */
  invite: {
    form: "Invite a staff member",
    email: "E-mail",
    name: "Name",
    site: "Site",
    role: "Role (optional)",
    noRole: "No role yet",
    code: "Authenticator code",
    codeHint: "Inviting someone needs a fresh confirmation.",
    created:
      "Invitation created. Send this one-time enrolment link to the person (it is shown only once): ",
    submit: "Invite",
    confirmSubmit: "Confirm and invite",
  },
} as const;
