/**
 * ML-12e (DP-243): English messages of the Owner area. Moved verbatim from the components, so the
 * English console renders exactly as before ML-12e (test/owner-en.test.tsx).
 */
export const owner = {
  // Owner console (app/(console)/owner/page.tsx).
  console: {
    title: "Owner console",
    description:
      "God Mode of the system owner. Switch optional modules per site and review the protected audit trail. Only you see this page; it cannot be handed on.",
    auditLink: "Protected audit trail",
    loadError: "The owner console could not be loaded",
    loadErrorText: "Try again in a moment.",
    ownerPanel: "System owner",
    account: "Account",
    designated: "Designated",
    transfer: "Transfer",
    notTransferable: "Not transferable",
    modulesPanel: "Optional modules",
    modulesDescription:
      "A module that is off keeps its data; its functions stay closed for everyone, you included, until it is switched on again. Every change needs a reason.",
    moduleColumn: "Module",
    lastReason: "Last reason: {reason}",
    core: "Always on (core): {modules}.",
    platformPanel: "Platform modules",
    platformDescription:
      'Switched once for the whole platform, by you alone; nobody else can change them or be given the right. A module that is off is hidden from every menu and its API answers "not found"; its keys, settings and history are kept.',
    platformState: "Platform-wide",
    chainPanel: "Protected audit chain",
    chainDescription:
      "Your actions and every action aimed at your account are chained with SHA-256 and never shown on staff screens.",
  },
  // Module names and descriptions by module key; English = the API's catalogue (apps/api/src/iam/catalog.ts).
  modules: {
    rbac: { name: "Roles and access", description: "RBAC, site scope, users and role assignments" },
    audit: { name: "Audit trail", description: "Append-only audit events" },
    mfa: {
      name: "Multi-factor authentication",
      description: "MFA enrolment, step-up and recovery",
    },
    platform: {
      name: "Platform administration",
      description: "Sites and the God Mode module catalogue",
    },
    cms: { name: "Content management", description: "Pages, sections, media and publishing" },
    catalog: { name: "Product catalogue", description: "Products, technical data and documents" },
    leads: { name: "Leads", description: "Contact and document-request leads" },
    membership: {
      name: "Membership",
      description: "Member accounts and member-only technical data",
    },
    crm: { name: "CRM", description: "Sales pipeline on top of leads (optional)" },
    automation: {
      name: "Automation",
      description: "Rule-based follow-ups and notifications (optional)",
    },
    integrations: {
      name: "Integrations",
      description: "Outbound integrations and webhooks (optional)",
    },
    customer_portal: {
      name: "Customer portal",
      description: "Company-level document and request history (optional)",
    },
    ai: {
      name: "AI Center",
      description:
        "AI providers, models, budgets and usage (optional; switched platform-wide by the system owner)",
    },
  },
  // Step-up prompt (components/owner/owner-actions.tsx).
  stepUp: {
    form: "Confirm with your authenticator",
    code: "Authenticator code",
    hint: "This change needs a fresh confirmation from your authenticator app.",
    confirm: "Confirm",
    cancel: "Cancel",
  },
  // Module switch.
  switch: {
    alwaysOn: "Always on",
    on: "On",
    off: "Off",
    switchOn: "Switch on",
    switchOff: "Switch off",
    switchOnLabel: "Switch on {module} on {site}",
    switchOffLabel: "Switch off {module} on {site}",
    form: "Change {module}",
    reason: "Reason",
    hintOff: "Switching off keeps all data; the module's functions stop for everyone.",
    hintOn: "Recorded in the protected audit trail.",
    platformOnLabel: "Switch on {module} for the whole platform",
    platformOffLabel: "Switch off {module} for the whole platform",
    hintPlatformOff:
      "Hides the module everywhere and stops new work at once; nothing is retried. Keys, settings and history are kept.",
    hintPlatformOn:
      "Makes the module visible to staff who may use it. Recorded in the protected audit trail.",
    cancel: "Cancel",
  },
  // Chain verification.
  chain: {
    state: "State",
    intact: "Intact",
    broken: "Broken at #{seq}",
    events: "Protected events",
    checked: "Checked",
    headHash: "Head hash (#{seq})",
    verify: "Verify now",
  },
  // Protected audit trail (app/(console)/owner/audit/page.tsx and its list).
  audit: {
    title: "Protected audit trail",
    description:
      "Never shown on staff screens and never deleted. Each event carries its place in the hash chain.",
    back: "Owner console",
    events: "Events",
    empty: "No protected events yet.",
    load: "Load protected events",
    older: "Older events",
    outcome: { SUCCESS: "success", DENIED: "denied", FAILURE: "failure" },
    actor: { USER: "user", SYSTEM: "system", BOOTSTRAP: "bootstrap" },
  },
  // Designation confirmation (app/(console)/owner/confirm/page.tsx).
  confirm: {
    title: "Confirm owner designation",
    description:
      "You were named as the system owner. After confirmation your account holds God Mode, which cannot be transferred to anyone else.",
    panel: "Confirm with your password and authenticator",
    noLink: "This page needs the confirmation link from the operator. Open the full link again.",
    success: "You are now the system owner. The owner console is in the navigation.",
    form: "Confirm the owner designation",
    password: "Your current password",
    passwordHint:
      "Confirms that this account belongs to you. The designation cannot be undone or handed on.",
    submit: "Confirm designation",
  },
  // Browser calls (lib/owner-client.ts).
  api: {
    unreachable: "The admin API cannot be reached.",
    failed: "The request failed. Try again in a moment.",
  },
} as const;
