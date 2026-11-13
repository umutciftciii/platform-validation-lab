// ADR-012A role separation (F1-002 Group 0, DP-078), against the disposable *_test database only.
//
// Proves on a real PostgreSQL what the design relies on:
//   - the five roles exist with exactly the intended attributes and memberships;
//   - every object in schema public is owned by dp_owner, and later objects get the dp_app grants
//     through DEFAULT PRIVILEGES;
//   - the API's role (dp_app) cannot run DDL, disable or drop a trigger, change or truncate the
//     audit trail, rewrite the IAM catalogue, read the migration history or switch role;
//   - the migrator works only as dp_owner (SET ROLE at login, current_user = dp_owner);
//   - the bootstrap role can do only what the bootstrap needs;
//   - SECURITY DEFINER runs with the function owner's identity, SECURITY INVOKER with the caller's;
//   - the migration runner and iam:sync work only with their own credential.
//
// TEST_SUPERUSER_DATABASE_URL (the test cluster's superuser) is used only to read catalogs and to
// set up the SECURITY DEFINER probe in its own schema, which is dropped afterwards.
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertTestDatabaseUrl } from "@dream/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { databaseIdentity } from "../../src/iam/bootstrap.js";
import { syncCatalog } from "../../src/iam/catalog-sync.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const urls = {
  app: assertTestDatabaseUrl(process.env["DATABASE_URL"]).toString(),
  owner: assertTestDatabaseUrl(process.env["MIGRATE_DATABASE_URL"]).toString(),
  boot: assertTestDatabaseUrl(process.env["IAM_BOOTSTRAP_DATABASE_URL"]).toString(),
  su: assertTestDatabaseUrl(process.env["TEST_SUPERUSER_DATABASE_URL"]).toString(),
};
const DB_NAME = new URL(urls.app).pathname.slice(1);
const ROLES = [
  "dp_owner",
  "dp_migrator",
  "dp_app",
  "dp_iam_bootstrap",
  "dp_iam_system",
  "dp_lead_retention",
] as const;
const run = Math.random().toString(36).slice(2, 8);
const PROBE_SCHEMA = `dp_g0_probe_${run}`;

const client = (url: string) =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
let app: PrismaClient;
let owner: PrismaClient;
let boot: PrismaClient;
let su: PrismaClient;

class Rollback extends Error {}
/** Runs `fn` in a transaction that is always rolled back. */
async function rolledBack(db: PrismaClient, fn: (tx: PrismaClient) => Promise<void>) {
  await expect(
    db.$transaction(async (tx) => {
      await fn(tx as unknown as PrismaClient);
      throw new Rollback("rollback");
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

const DENIED =
  /permission denied|must be owner|must be superuser|not allowed|insufficient privilege/i;

beforeAll(async () => {
  // Idempotent: applies the committed migrations (as dp_migrator) if this file runs on its own.
  execFileSync(path.join(API_DIR, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: API_DIR,
    env: process.env,
    stdio: "pipe",
  });
  app = client(urls.app);
  owner = client(urls.owner);
  boot = client(urls.boot);
  su = client(urls.su);
  await syncCatalog(owner);
});

afterAll(async () => {
  await su?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${PROBE_SCHEMA} CASCADE`).catch(() => {});
  await Promise.all([app, owner, boot, su].map((c) => c?.$disconnect()));
});

describe("roles, attributes and memberships", () => {
  it("creates exactly the five roles with least-privilege attributes", async () => {
    const rows = await su.$queryRawUnsafe<
      {
        rolname: string;
        rolsuper: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
        rolreplication: boolean;
        rolbypassrls: boolean;
        rolcanlogin: boolean;
        rolinherit: boolean;
      }[]
    >(
      `SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls,
              rolcanlogin, rolinherit
       FROM pg_roles WHERE rolname LIKE 'dp\\_%' ORDER BY rolname`,
    );
    expect(rows.map((r) => r.rolname).sort()).toEqual([...ROLES].sort());
    for (const r of rows) {
      expect(r, r.rolname).toMatchObject({
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false, // test profile; only the dev profile lets dp_owner create databases
        rolreplication: false,
        rolbypassrls: false,
      });
    }
    const login = Object.fromEntries(rows.map((r) => [r.rolname, r.rolcanlogin]));
    expect(login).toEqual({
      dp_app: true,
      dp_iam_bootstrap: true,
      dp_iam_system: false,
      dp_lead_retention: false,
      dp_migrator: true,
      dp_owner: false,
    });
    const inherit = Object.fromEntries(rows.map((r) => [r.rolname, r.rolinherit]));
    expect(inherit).toMatchObject({ dp_app: false, dp_iam_bootstrap: false, dp_migrator: false });
  });

  it("has two memberships only, both SET without inheritance: migrator→owner, operator→retention", async () => {
    const rows = await su.$queryRawUnsafe<
      { granted: string; member: string; inherit: boolean; set: boolean; admin: boolean }[]
    >(
      `SELECT g.rolname AS granted, m.rolname AS member, am.inherit_option AS inherit,
              am.set_option AS set, am.admin_option AS admin
       FROM pg_auth_members am
       JOIN pg_roles g ON g.oid = am.roleid JOIN pg_roles m ON m.oid = am.member
       WHERE g.rolname LIKE 'dp\\_%' OR m.rolname LIKE 'dp\\_%'`,
    );
    const key = (r: { granted: string }) => r.granted;
    expect(rows.sort((a, b) => key(a).localeCompare(key(b)))).toEqual([
      // DP-096: the operator credential switches to the least-privilege retention role.
      {
        granted: "dp_lead_retention",
        member: "dp_iam_bootstrap",
        inherit: false,
        set: true,
        admin: false,
      },
      { granted: "dp_owner", member: "dp_migrator", inherit: false, set: true, admin: false },
    ]);
  });

  it("starts migrator sessions as dp_owner and sets nothing for the other roles", async () => {
    const rows = await su.$queryRawUnsafe<{ rolname: string; setconfig: string[] }[]>(
      `SELECT r.rolname, s.setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
       WHERE r.rolname LIKE 'dp\\_%'`,
    );
    expect(rows).toEqual([{ rolname: "dp_migrator", setconfig: ["role=dp_owner"] }]);
  });

  it("gives every connection the identity of its own role", async () => {
    expect(await databaseIdentity(app)).toEqual({ currentUser: "dp_app", sessionUser: "dp_app" });
    expect(await databaseIdentity(owner)).toEqual({
      currentUser: "dp_owner",
      sessionUser: "dp_migrator",
    });
    expect(await databaseIdentity(boot)).toEqual({
      currentUser: "dp_iam_bootstrap",
      sessionUser: "dp_iam_bootstrap",
    });
  });

  it("lets only the dp_* login roles connect; only dp_owner may create schemas", async () => {
    const rows = await su.$queryRawUnsafe<
      { who: string; connect: boolean; temp: boolean; create: boolean }[]
    >(
      `SELECT w AS who, has_database_privilege(w, current_database(), 'CONNECT') AS connect,
              has_database_privilege(w, current_database(), 'TEMP') AS temp,
              has_database_privilege(w, current_database(), 'CREATE') AS create
       FROM unnest(ARRAY['public', 'dp_app', 'dp_migrator', 'dp_iam_bootstrap', 'dp_iam_system',
                         'dp_lead_retention', 'dp_owner']) AS w`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.who, [r.connect, r.temp, r.create]]))).toEqual({
      public: [false, false, false],
      dp_app: [true, false, false],
      dp_migrator: [true, false, false],
      dp_iam_bootstrap: [true, false, false],
      dp_iam_system: [false, false, false],
      dp_lead_retention: [false, false, false],
      dp_owner: [false, false, true],
    });
  });
});

describe("ownership and default privileges", () => {
  it("has dp_owner own the schema and every object in it", async () => {
    const rows = await su.$queryRawUnsafe<{ kind: string; name: string; owner: string }[]>(
      `SELECT 'relation' AS kind, c.relname AS name, pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
       UNION ALL
       SELECT 'routine', p.oid::regprocedure::text, pg_get_userbyid(p.proowner)
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
       UNION ALL
       SELECT 'type', t.typname, pg_get_userbyid(t.typowner)
         FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typtype IN ('e', 'd')
       UNION ALL
       SELECT 'schema', n.nspname, pg_get_userbyid(n.nspowner)
         FROM pg_namespace n WHERE n.nspname = 'public'`,
    );
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.filter((r) => r.owner !== "dp_owner")).toEqual([]);
  });

  it("gives tables created by later migrations the dp_app data privileges, nothing more", async () => {
    await rolledBack(owner, async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE "DpG0Probe_${run}" (id int PRIMARY KEY)`);
      const rows = await tx.$queryRawUnsafe<Record<string, boolean | string>[]>(
        `SELECT pg_get_userbyid(c.relowner) AS owner,
                has_table_privilege('dp_app', c.oid, 'SELECT') AS app_select,
                has_table_privilege('dp_app', c.oid, 'INSERT') AS app_insert,
                has_table_privilege('dp_app', c.oid, 'UPDATE') AS app_update,
                has_table_privilege('dp_app', c.oid, 'DELETE') AS app_delete,
                has_table_privilege('dp_app', c.oid, 'TRUNCATE') AS app_truncate,
                has_table_privilege('dp_app', c.oid, 'TRIGGER') AS app_trigger,
                has_table_privilege('dp_iam_bootstrap', c.oid, 'SELECT') AS boot_select
         FROM pg_class c WHERE c.relname = 'DpG0Probe_${run}'`,
      );
      expect(rows[0]).toEqual({
        owner: "dp_owner",
        app_select: true,
        app_insert: true,
        app_update: true,
        app_delete: true,
        app_truncate: false,
        app_trigger: false,
        boot_select: false,
      });
    });
  });

  it("keeps the explicit exceptions of the existing tables", async () => {
    const rows = await su.$queryRawUnsafe<{ t: string; p: string; has: boolean }[]>(
      `SELECT t, p, has_table_privilege('dp_app', format('public.%I', t), p) AS has
       FROM unnest(ARRAY['AuditEvent', 'FeatureModule', 'Permission', 'Role', 'RolePermission',
                         'SystemOwner', 'SystemOwnerDesignation', '_prisma_migrations']) AS t,
            unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p`,
    );
    const got = Object.fromEntries(
      Object.entries(
        rows.reduce<Record<string, string[]>>((acc, r) => {
          if (r.has) (acc[r.t] ??= []).push(r.p);
          return acc;
        }, {}),
      ).map(([k, v]) => [k, v.sort()]),
    );
    expect(got).toEqual({
      AuditEvent: ["INSERT", "SELECT"],
      FeatureModule: ["SELECT"],
      Permission: ["SELECT"],
      Role: ["SELECT"],
      RolePermission: ["SELECT"],
      // DP-108 (ADR-018): the API reads the owner record and never sees pending designations.
      SystemOwner: ["SELECT"],
    });
  });
});

describe("the API's role (dp_app) cannot change the schema or the guards", () => {
  const forbidden: [string, string][] = [
    ["create a table", `CREATE TABLE dp_g0_x_${run} (id int)`],
    [
      "create a function",
      `CREATE FUNCTION public.dp_g0_f_${run}() RETURNS int LANGUAGE sql AS 'select 1'`,
    ],
    ["create a schema", `CREATE SCHEMA dp_g0_s_${run}`],
    ["create a temporary table", `CREATE TEMP TABLE dp_g0_t_${run} (id int)`],
    ["disable every audit trigger", `ALTER TABLE "AuditEvent" DISABLE TRIGGER ALL`],
    ["disable one guard trigger", `ALTER TABLE "User" DISABLE TRIGGER "User_kind_immutable"`],
    ["drop the append-only trigger", `DROP TRIGGER "AuditEvent_append_only" ON "AuditEvent"`],
    ["bypass triggers via replication role", `SET session_replication_role = replica`],
    ["drop a table", `DROP TABLE "AuditEvent"`],
    ["truncate the audit trail", `TRUNCATE "AuditEvent"`],
    ["truncate users", `TRUNCATE "User" CASCADE`],
    ["take ownership", `ALTER TABLE "User" OWNER TO dp_app`],
    ["update an audit event", `UPDATE "AuditEvent" SET reason = 'x'`],
    ["delete audit events", `DELETE FROM "AuditEvent"`],
    ["read the migration history", `SELECT count(*) FROM _prisma_migrations`],
    ["write the role catalogue", `UPDATE "Role" SET name = name`],
    ["write a role permission", `DELETE FROM "RolePermission"`],
    ["write the permission catalogue", `UPDATE "Permission" SET sensitive = false`],
    ["downgrade a module", `UPDATE "FeatureModule" SET "isCore" = false`],
    ["switch to the owner", `SET ROLE dp_owner`],
    ["switch to the migrator", `SET ROLE dp_migrator`],
    ["switch to the bootstrap role", `SET ROLE dp_iam_bootstrap`],
    ["switch to the system role", `SET ROLE dp_iam_system`],
    ["switch to the lead retention role", `SET ROLE dp_lead_retention`],
    ["create a role", `CREATE ROLE dp_g0_r_${run}`],
    ["grant itself superuser", `ALTER ROLE dp_app SUPERUSER`],
    ["run a server program", `COPY (SELECT 1) TO PROGRAM 'true'`],
    ["read a server file", `SELECT pg_read_file('/etc/hostname')`],
  ];
  for (const [what, sql] of forbidden) {
    it(`cannot ${what}`, async () => {
      await expect(app.$executeRawUnsafe(sql)).rejects.toThrow(DENIED);
    });
  }

  it("still reads and writes application data and appends audit events", async () => {
    expect(await app.role.count()).toBeGreaterThan(0);
    // DP-125: audit rows are appended without RETURNING (writeAudit uses createMany); outside a
    // staff context dp_app cannot read them back (row-level security).
    const e = await app.auditEvent.createMany({
      data: [
        {
          actorType: "SYSTEM",
          action: "test.db_roles",
          resourceType: "test",
          scopeType: "PLATFORM",
          outcome: "SUCCESS",
        },
      ],
    });
    expect(e.count).toBe(1);
    const email = `dbroles.${run}@example.test`;
    const u = await app.user.create({ data: { email, emailNormalized: email, kind: "STAFF" } });
    await app.user.update({ where: { id: u.id }, data: { displayName: "x" } });
  });
});

describe("the migrator works only as dp_owner", () => {
  it("cannot create anything as itself (SET ROLE NONE)", async () => {
    // RESET ROLE would return to the login default, which is dp_owner; NONE drops to the
    // session user itself.
    await rolledBack(owner, async (tx) => {
      await tx.$executeRawUnsafe("SET ROLE NONE");
      expect(await databaseIdentity(tx)).toEqual({
        currentUser: "dp_migrator",
        sessionUser: "dp_migrator",
      });
      await expect(
        tx.$executeRawUnsafe(`CREATE TABLE public.dp_g0_m_${run} (id int)`),
      ).rejects.toThrow(DENIED);
    });
  });

  it("cannot switch to the API, bootstrap or system role", async () => {
    for (const role of ["dp_app", "dp_iam_bootstrap", "dp_iam_system", "dp_lead_retention"]) {
      await expect(owner.$executeRawUnsafe(`SET ROLE ${role}`), role).rejects.toThrow(DENIED);
    }
  });

  it("runs migrations: `prisma migrate status` succeeds as dp_migrator and fails as dp_app", () => {
    const prisma = path.join(API_DIR, "node_modules/.bin/prisma");
    const status = (migrateUrl: string) =>
      spawnSync(prisma, ["migrate", "status"], {
        cwd: API_DIR,
        env: { ...process.env, MIGRATE_DATABASE_URL: migrateUrl },
        encoding: "utf8",
      });
    const asMigrator = status(urls.owner);
    expect(asMigrator.status, asMigrator.stderr).toBe(0);
    expect(asMigrator.stdout).toMatch(/up to date/i);
    const asApp = status(urls.app);
    expect(asApp.status).not.toBe(0);
  });
});

describe("the bootstrap role (dp_iam_bootstrap) holds only what the bootstrap needs", () => {
  const forbidden: [string, string][] = [
    ["update a user", `UPDATE "User" SET "displayName" = 'x'`],
    ["delete a role assignment", `DELETE FROM "RoleAssignment"`],
    ["revoke a role assignment", `UPDATE "RoleAssignment" SET "revokedAt" = now()`],
    ["read memberships", `SELECT count(*) FROM "Membership"`],
    ["write a module configuration", `DELETE FROM "ModuleConfiguration"`],
    ["update an audit event", `UPDATE "AuditEvent" SET reason = 'x'`],
    ["write the catalogue", `DELETE FROM "RolePermission"`],
    ["read the migration history", `SELECT count(*) FROM _prisma_migrations`],
    ["create a table", `CREATE TABLE dp_g0_b_${run} (id int)`],
    ["switch to the owner", `SET ROLE dp_owner`],
    ["switch to the API role", `SET ROLE dp_app`],
  ];
  for (const [what, sql] of forbidden) {
    it(`cannot ${what}`, async () => {
      await expect(boot.$executeRawUnsafe(sql)).rejects.toThrow(DENIED);
    });
  }
});

describe("SECURITY DEFINER and SECURITY INVOKER (basis for ADR-013 K-NG4)", () => {
  beforeAll(async () => {
    const s = PROBE_SCHEMA;
    for (const sql of [
      `CREATE SCHEMA ${s}`,
      `CREATE FUNCTION ${s}.definer_whoami() RETURNS text LANGUAGE sql SECURITY DEFINER
         SET search_path = pg_catalog AS 'SELECT current_user::text'`,
      `CREATE FUNCTION ${s}.invoker_whoami() RETURNS text LANGUAGE sql SECURITY INVOKER
         SET search_path = pg_catalog AS 'SELECT current_user::text'`,
      `ALTER FUNCTION ${s}.definer_whoami() OWNER TO dp_iam_system`,
      `ALTER FUNCTION ${s}.invoker_whoami() OWNER TO dp_iam_system`,
      `REVOKE ALL ON FUNCTION ${s}.definer_whoami(), ${s}.invoker_whoami() FROM PUBLIC`,
      `GRANT USAGE ON SCHEMA ${s} TO dp_app, dp_iam_bootstrap`,
      `GRANT EXECUTE ON FUNCTION ${s}.definer_whoami(), ${s}.invoker_whoami() TO dp_app`,
    ]) {
      await su.$executeRawUnsafe(sql);
    }
  });

  it("runs a SECURITY DEFINER function as its owner, then returns to the caller", async () => {
    const rows = await app.$queryRawUnsafe<{ inside: string; after: string }[]>(
      `SELECT ${PROBE_SCHEMA}.definer_whoami() AS inside, current_user::text AS after`,
    );
    expect(rows[0]).toEqual({ inside: "dp_iam_system", after: "dp_app" });
  });

  it("runs a SECURITY INVOKER function as the caller", async () => {
    const rows = await app.$queryRawUnsafe<{ inside: string }[]>(
      `SELECT ${PROBE_SCHEMA}.invoker_whoami() AS inside`,
    );
    expect(rows[0]?.inside).toBe("dp_app");
  });

  it("lets only granted roles execute it", async () => {
    await expect(boot.$queryRawUnsafe(`SELECT ${PROBE_SCHEMA}.definer_whoami()`)).rejects.toThrow(
      DENIED,
    );
  });
});

describe("IAM CLI uses only its own credential", () => {
  const cli = (args: string[], env: Record<string, string | undefined>) =>
    spawnSync("node", [path.join(API_DIR, "dist/iam/iam-cli.js"), ...args], {
      cwd: API_DIR,
      env: { PATH: process.env["PATH"], ...env },
      encoding: "utf8",
    });

  it("syncs the catalogue as dp_migrator", () => {
    const res = cli(["sync", "--confirm-database", DB_NAME], { MIGRATE_DATABASE_URL: urls.owner });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/"rolePermissionsAdded":0/);
  });

  it("refuses sync with any other credential, including the API's and a superuser's", () => {
    for (const url of [urls.app, urls.su, urls.boot]) {
      const res = cli(["sync", "--confirm-database", DB_NAME], { MIGRATE_DATABASE_URL: url });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/refusing: sync must run as dp_migrator/);
    }
    const none = cli(["sync", "--confirm-database", DB_NAME], { DATABASE_URL: urls.owner });
    expect(none.stderr).toMatch(/MIGRATE_DATABASE_URL is not set/);
  });

  it("refuses bootstrap with any credential but dp_iam_bootstrap", () => {
    for (const url of [urls.app, urls.owner, urls.su]) {
      const res = cli(
        ["bootstrap", "--email", `cli.${run}@example.test`, "--confirm-database", DB_NAME],
        {
          IAM_BOOTSTRAP_DATABASE_URL: url,
        },
      );
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/refusing: bootstrap must run as dp_iam_bootstrap/);
    }
  });
});

// DP-103 (ADR-012B B5, B6): row-level security depends on who may step around it. No role but
// the cluster superuser has BYPASSRLS, the API's role owns nothing, and every SECURITY DEFINER
// function (which runs as dp_owner, the table owner, outside RLS) is on this reviewed list. Only
// two of them read the lead tables, and both return no lead row.
describe("DP-103: what can step around row-level security", () => {
  it("gives BYPASSRLS to no dp_* role and no table to dp_app", async () => {
    const rows = await su.$queryRawUnsafe<{ r: string }[]>(
      `SELECT rolname::text AS r FROM pg_roles WHERE rolbypassrls AND NOT rolsuper ORDER BY 1`,
    );
    expect(rows).toEqual([]);
    const owned = await su.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM pg_class WHERE relowner = 'dp_app'::regrole`,
    );
    expect(owned[0]?.n).toBe(0n);
  });

  it("keeps the SECURITY DEFINER functions to a reviewed list, all owned by dp_owner", async () => {
    const rows = await su.$queryRawUnsafe<{ f: string; owner: string; lead: boolean }[]>(
      `SELECT p.proname::text AS f, pg_get_userbyid(p.proowner)::text AS owner,
              p.prosrc ~ '"(Lead|LeadDocumentRequest|LeadContactMessage|DocumentDownloadGrant|LeadDocumentDownload)"' AS lead
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef ORDER BY 1`,
    );
    expect(rows).toEqual([
      { f: "iam_audit_event_protected_stream", owner: "dp_owner", lead: false },
      // DP-125 (ADR-012B part 2): the legacy sweep (K3), /enrol by raw token, the guards that
      // need every assignment (B1), the operator CLI (K1), the session-bound IAM readers.
      { f: "iam_customer_data_approval_has_assignment", owner: "dp_owner", lead: false },
      { f: "iam_customer_data_sweep", owner: "dp_owner", lead: false },
      { f: "iam_enrol_activate_memberships", owner: "dp_owner", lead: false },
      { f: "iam_enrol_password_verified", owner: "dp_owner", lead: false },
      { f: "iam_last_platform_admin_assignment_guard", owner: "dp_owner", lead: false },
      { f: "iam_last_platform_admin_expiry_guard", owner: "dp_owner", lead: false },
      { f: "iam_last_platform_admin_user_guard", owner: "dp_owner", lead: false },
      { f: "iam_operator_admin_state", owner: "dp_owner", lead: false },
      { f: "iam_owner_designation_confirm", owner: "dp_owner", lead: false },
      { f: "iam_owner_designation_start", owner: "dp_owner", lead: false },
      { f: "iam_owner_recover", owner: "dp_owner", lead: false },
      { f: "iam_reciprocal_grant_guard", owner: "dp_owner", lead: false },
      { f: "iam_rls_admin_target", owner: "dp_owner", lead: false },
      { f: "iam_rls_my_grant_ancestry", owner: "dp_owner", lead: false },
      { f: "iam_rls_platform_admin_count", owner: "dp_owner", lead: false },
      { f: "iam_rls_qualified_admin_count", owner: "dp_owner", lead: false },
      { f: "iam_rls_staff_is_owner", owner: "dp_owner", lead: false },
      { f: "iam_rls_staff_platform", owner: "dp_owner", lead: false },
      { f: "iam_rls_staff_sites", owner: "dp_owner", lead: false },
      { f: "iam_rls_user_open_rows", owner: "dp_owner", lead: false },
      { f: "iam_rls_user_platform", owner: "dp_owner", lead: false },
      { f: "iam_rls_user_sites", owner: "dp_owner", lead: false },
      { f: "iam_system_owner_id", owner: "dp_owner", lead: false },
      // Counts only (DP-096 dry-run report); sites only (the staff context).
      { f: "leads_retention_plan", owner: "dp_owner", lead: true },
      // DP-125: (site, user) ids of possible lead assignees.
      { f: "leads_rls_assignable_staff", owner: "dp_owner", lead: false },
      // DP-041: assignability of one staff user, the session's user, sites with lead:manage.
      { f: "leads_rls_assignee_ok", owner: "dp_owner", lead: false },
      { f: "leads_rls_staff_manage_site_ids", owner: "dp_owner", lead: false },
      { f: "leads_rls_staff_site_ids", owner: "dp_owner", lead: false },
      { f: "leads_rls_staff_user_id", owner: "dp_owner", lead: false },
      { f: "leads_rls_user_lead_sites", owner: "dp_owner", lead: false },
    ]);
    // Every one pins its search_path (no shadowing through a schema the caller controls).
    const unpinned = await su.$queryRawUnsafe<{ f: string }[]>(
      `SELECT proname::text AS f FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace AND prosecdef
         AND NOT EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%')`,
    );
    expect(unpinned).toEqual([]);
  });

  it("lets only dp_app set the lead context and only dp_app/retention run the plan", async () => {
    const rows = await su.$queryRawUnsafe<{ f: string; who: string }[]>(
      `SELECT p.proname::text AS f,
              string_agg(r.rolname, ',' ORDER BY r.rolname) FILTER (
                WHERE has_function_privilege(r.oid, p.oid, 'EXECUTE')) AS who
       FROM pg_proc p CROSS JOIN pg_roles r
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname ~ '^leads_(rls_|retention_plan)'
         AND r.rolname IN ('dp_app', 'dp_iam_bootstrap', 'dp_iam_system', 'dp_lead_retention',
                           'dp_migrator')
       GROUP BY p.proname ORDER BY 1`,
    );
    const app = "dp_app";
    expect(rows).toEqual([
      { f: "leads_retention_plan", who: "dp_app,dp_lead_retention" },
      { f: "leads_rls_assignable_staff", who: app },
      { f: "leads_rls_assignee_ok", who: app },
      { f: "leads_rls_context_live", who: app },
      { f: "leads_rls_public_email", who: app },
      { f: "leads_rls_public_grant_hash", who: app },
      { f: "leads_rls_public_site_id", who: app },
      { f: "leads_rls_set_public_context", who: app },
      { f: "leads_rls_set_staff_context", who: app },
      { f: "leads_rls_staff_manage_site_ids", who: app },
      { f: "leads_rls_staff_site_ids", who: app },
      { f: "leads_rls_staff_user_id", who: app },
      // Internal (DP-041): only the SECURITY DEFINER functions above call it.
      { f: "leads_rls_user_lead_sites", who: null },
    ]);
  });
  it("DP-125: grants EXECUTE on the IAM row-level security functions to no one but their callers", async () => {
    const rows = await su.$queryRawUnsafe<{ f: string; who: string | null }[]>(
      `SELECT p.proname::text AS f,
              string_agg(r.rolname, ',' ORDER BY r.rolname) FILTER (
                WHERE has_function_privilege(r.oid, p.oid, 'EXECUTE')) AS who
       FROM pg_proc p CROSS JOIN pg_roles r
       WHERE p.pronamespace = 'public'::regnamespace
         AND (p.proname ~ '^iam_(rls_|operator_|enrol_|customer_data_sweep|audit_time_ok)'
              OR p.proname IN ('iam_customer_data_approval_has_assignment',
                               'iam_last_platform_admin_assignment_guard',
                               'iam_last_platform_admin_user_guard',
                               'iam_last_platform_admin_expiry_guard', 'iam_reciprocal_grant_guard'))
         AND r.rolname IN ('dp_app', 'dp_iam_bootstrap', 'dp_iam_system', 'dp_lead_retention',
                           'dp_migrator')
       GROUP BY p.proname ORDER BY 1`,
    );
    const app = "dp_app";
    expect(rows).toEqual([
      { f: "iam_audit_time_ok", who: "dp_app,dp_iam_bootstrap,dp_lead_retention" },
      { f: "iam_customer_data_approval_has_assignment", who: null },
      { f: "iam_customer_data_sweep", who: app },
      { f: "iam_enrol_activate_memberships", who: app },
      { f: "iam_enrol_password_verified", who: app },
      // Trigger functions: never called directly, by anyone.
      { f: "iam_last_platform_admin_assignment_guard", who: null },
      { f: "iam_last_platform_admin_expiry_guard", who: null },
      { f: "iam_last_platform_admin_user_guard", who: null },
      { f: "iam_operator_admin_state", who: app },
      { f: "iam_reciprocal_grant_guard", who: null },
      { f: "iam_rls_admin_target", who: app },
      { f: "iam_rls_my_grant_ancestry", who: app },
      // Internal: only the SECURITY DEFINER functions call them.
      { f: "iam_rls_permission_set", who: null },
      { f: "iam_rls_platform_admin_count", who: app },
      { f: "iam_rls_qualified_admin_count", who: app },
      { f: "iam_rls_staff_is_owner", who: app },
      { f: "iam_rls_staff_platform", who: app },
      { f: "iam_rls_staff_sites", who: app },
      { f: "iam_rls_user_open_rows", who: app },
      { f: "iam_rls_user_platform", who: null },
      { f: "iam_rls_user_sites", who: null },
    ]);
  });

  it("DP-125: keeps row-level security on the five IAM tables, without FORCE", async () => {
    const rows = await su.$queryRawUnsafe<{ t: string; rls: boolean; force: boolean }[]>(
      `SELECT relname::text AS t, relrowsecurity AS rls, relforcerowsecurity AS force FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relname IN ('Membership', 'RoleAssignment',
         'ModuleConfiguration', 'AuditEvent', 'CustomerDataAccessRequest') ORDER BY 1`,
    );
    expect(rows).toEqual(
      [
        "AuditEvent",
        "CustomerDataAccessRequest",
        "Membership",
        "ModuleConfiguration",
        "RoleAssignment",
      ].map((t) => ({ t, rls: true, force: false })),
    );
  });
});
