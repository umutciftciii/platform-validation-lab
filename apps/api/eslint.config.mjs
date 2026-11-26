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
  // DP-221 (ADR-026 D4): the notification sender works the outbox of every site outside any
  // request; it reads only the notification rows, settings, sites and staff e-mail addresses
  // (no lead table).
  "src/leads/lead-notification-sender.service.ts",
  // DP-289 (ADR-030 D5): the one reader of a provider key's ciphertext (a SECURITY DEFINER call in
  // the caller's staff transaction); no table query.
  "src/ai/credential-store.ts",
  // DP-290 (ADR-030 D6): the budget engine — the calls of its SECURITY DEFINER functions (the only
  // write path to operations, usage and ledger) and the sweeper, which runs outside any request.
  "src/ai/ledger-sql.ts",
  "src/ai/ledger.service.ts",
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
  // DP-285: the transaction-local lock_timeout / statement_timeout / transaction_read_only of a
  // bounded transaction (SELECT set_config(..., true)); parameterised tagged templates only, no
  // table access.
  "src/iam/bounded-transaction.ts",
  // DP-287 (ADR-030 D1): calls of the platform-module SECURITY DEFINER functions
  // (platform_module_enabled, platform_module_hold_enabled, platform_modules_enabled) and the
  // transaction-local lock_timeout of `whileEnabled`; tagged templates only, no table access.
  "src/iam/platform-modules.ts",
  // DP-289 (ADR-030 D5): the call of ai_credential_ciphertext(id), the only way to the stored key
  // (dp_app cannot SELECT the column); tagged template only, no table access.
  "src/ai/credential-store.ts",
  // DP-290 (ADR-030 D6): the engine's SECURITY DEFINER calls (ai_reserve, ai_start, ai_settle,
  // ai_release, ai_mark_unknown, ai_sweep, ai_ledger_mismatches); tagged templates only.
  "src/ai/ledger-sql.ts",
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
