import base from "@dream/config/eslint/base";

// Site isolation guardrails (F1-001A, ADR-011 section 4). Request code must use the site-scoped
// client (src/iam/site-scope.ts). Only the infrastructure folders below may hold the unscoped
// Prisma client, and raw SQL is limited to reviewed call sites.
// PM-3: the media operator CLI (orphan clean-up) reads ProductImage outside any request.
const INFRASTRUCTURE = [
  "src/prisma/**",
  "src/iam/**",
  "src/health/**",
  "src/main.ts",
  "src/media/media-cli.ts",
  // DP-096 (ADR-003 §5): lead retention is cross-site by design (every site's leads past the
  // period, an erasure request on every site) and runs outside any request: the operator CLI as
  // dp_iam_bootstrap → dp_lead_retention, the dry-run report as dp_app read only.
  "src/leads/retention.ts",
  "src/leads/leads-cli.ts",
  "src/leads/retention-report.service.ts",
  "test/**",
];
// F1-002: the throttle's row lock (SELECT … FOR UPDATE) and the clean-up's advisory lock have no
// Prisma API; both use tagged templates only (parameterised, never *Unsafe).
const RAW_SQL_ALLOWED = [
  "src/health/health.controller.ts",
  "src/iam/bootstrap.ts",
  "src/iam/auth/throttle.ts",
  "src/iam/auth/cleanup.ts",
  // DP-042 (ADR-016 D7): the public rate-limit counter is one atomic upsert (INSERT … ON CONFLICT
  // DO UPDATE … RETURNING), parameterised tagged template only.
  "src/iam/public-rate-limit.ts",
  // DP-108 (ADR-018 D5, D6): calls of the owner's SECURITY DEFINER functions
  // (iam_owner_designation_start/_confirm, iam_owner_recover) and of
  // iam_verify_protected_audit_chain(); parameterised tagged templates only, no table access.
  "src/iam/owner/operator.ts",
  "src/iam/owner/owner.service.ts",
  // DP-103 (ADR-012B): the transaction-local row-level security context of the lead tables
  // (SELECT leads_rls_set_*_context(...)); parameterised tagged templates only, no table access.
  "src/iam/lead-data.ts",
  // DP-125 (ADR-012B part 2): the staff context of the IAM tables and the calls of the narrow
  // SECURITY DEFINER functions (counts, ancestry, admin target, operator state, /enrol, lead
  // assignees, legacy sweep); parameterised tagged templates only, no table access.
  "src/iam/iam-context.ts",
  // DP-096 (ADR-003 §5): SET LOCAL ROLE dp_lead_retention, the run's advisory lock and the
  // field-by-field anonymisation (UPDATE … SET column = cleared value, = ANY(uuid[])); tagged
  // templates only, never *Unsafe. The database limits the role (migration dp_096).
  "src/leads/retention.ts",
  "test/**",
];
const RAW = "queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe|runCommandRaw|queryRawTyped";

export default [
  ...base,
  {
    // Nest resolves constructor injection from emitted decorator metadata, which needs
    // value imports. Type-only imports would silently break dependency injection.
    rules: { "@typescript-eslint/consistent-type-imports": "off" },
  },
  {
    files: ["src/**/*.ts"],
    ignores: INFRASTRUCTURE,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/prisma/prisma.service*", "**/generated/prisma/**"],
              message:
                "Use the site-scoped client (iam/site-scope.ts withSiteScope); the unscoped Prisma client is infrastructure-only (ADR-011).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: RAW_SQL_ALLOWED,
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `MemberExpression[property.name=/^\\$(${RAW})$/]`,
          message:
            "Raw SQL bypasses the site scope. Add the call site to RAW_SQL_ALLOWED in eslint.config.mjs only after review (ADR-011).",
        },
      ],
    },
  },
];
