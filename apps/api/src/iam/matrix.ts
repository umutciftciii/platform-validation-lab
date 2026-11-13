/**
 * Renders the RBAC permission matrix as Markdown from the code catalogue. The committed copy is
 * docs/security/rbac-matrix.md; a unit test fails when it is out of date
 * (`pnpm --filter @dream/api run iam:matrix > ../../docs/security/rbac-matrix.md`, then Prettier).
 */
import {
  MODULE_BY_KEY,
  PERMISSIONS,
  ROLES,
  isAssignableRole,
  isCustomerDataRole,
} from "./catalog.js";

export function renderPermissionMatrix(): string {
  const lines: string[] = [
    "# RBAC permission matrix (K-02; F1-001A/F1-001B, DP-076 revision, DP-108)",
    "",
    "Generated from `apps/api/src/iam/catalog.ts` (ADR-011). Do not edit by hand.",
    "It applies the owner's F1-001A and F1-001B decisions as revised on 2026-11-11 (DP-076",
    "revision, ADR-017 v2); open risks are in ADR-011 section 9.",
    "",
    "- Scope `PLATFORM`: only a platform-scope role can hold it, checked without a site.",
    "- Scope `SITE`: checked for one site. A site role covers its own site (with an ACTIVE",
    "  membership), a platform role covers every site.",
    "- Step-up MFA: the session must have passed MFA recently (staff session policy).",
    "- Module: an optional module must be enabled for the site, otherwise access is denied.",
    "- Customer data: personal data of customers and leads. The super admin reads it on every",
    "  site; other staff only through a role that carries it (`sales_crm_user` for one site,",
    "  `platform_customer_data_officer` for all). Such roles are assigned directly, without a",
    "  second approver, justification or expiry (DP-076 revision); every read is audited.",
    "- Publishing: `site_admin` (own site), `content_publisher`, `product_publisher`. Editors",
    "  prepare drafts only. The super admin does not publish; it manages publisher roles",
    "  (`publisher_role:grant`).",
    "- Product masters (PM-1) are platform-wide: only `product_master:edit` (PLATFORM) creates,",
    "  edits or archives them. `product:edit` changes one site's listings and categories only.",
    "- No reciprocal or indirect self-grant: nobody in a grantor's grant chain receives a role",
    "  from that grantor.",
    "- The last active platform administrator cannot be revoked, suspended, deactivated or given",
    "  an expiry.",
    "- System owner (DP-108, ADR-018): `system_owner` is God Mode. It is never assigned; the one",
    "  designated owner (SystemOwner record) holds it. It carries every staff permission,",
    "  publishing included, and the owner-only permissions (`module:manage`,",
    "  `owner_audit:read`), which no other role may carry. A disabled optional module stays",
    "  closed for the owner too; the module switch itself is always available to it.",
    "- Anything not marked is denied (deny by default).",
    "",
    "## Roles",
    "",
    "| Role | Audience | Scope | Assignment | Description |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const r of ROLES) {
    const assignment = !isAssignableRole(r)
      ? "never (system owner record)"
      : isCustomerDataRole(r)
        ? "direct (customer data, audited)"
        : "direct";
    lines.push(
      `| \`${r.key}\` | ${r.audience} | ${r.scopeType} | ${assignment} | ${r.description} |`,
    );
  }
  lines.push("", "## Permissions", "");
  const header = [
    "Permission",
    "Module",
    "Scope",
    "MFA",
    "Customer data",
    "Owner only",
    ...ROLES.map((r) => `\`${r.key}\``),
  ];
  lines.push(`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`);
  for (const p of PERMISSIONS) {
    const mod = MODULE_BY_KEY.get(p.module);
    const cells = [
      `\`${p.key}\``,
      `${p.module}${mod?.isCore ? "" : " (optional)"}`,
      p.scopeType,
      p.sensitive ? "step-up" : "",
      p.customerData ? "yes" : "",
      p.ownerOnly ? "yes" : "",
      ...ROLES.map((r) => (r.permissions.includes(p.key) ? "✓" : "")),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Whitespace-insensitive form of a Markdown table document, so Prettier's padding is ignored. */
export function normalizeMarkdown(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/-{3,}/g, "---").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
