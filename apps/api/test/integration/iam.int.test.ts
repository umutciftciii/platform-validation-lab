// IAM integration tests (F1-001) on the disposable *_test database only. They prove the first real
// migration applies through `prisma migrate deploy`, and that the database itself enforces the IAM
// invariants (CHECK constraints and triggers), the bootstrap rules and the site boundary.
//
// ADR-012A: every client below is one database role, as in production. `prisma` is the API's
// dp_app; `owner` is the migration runner (dp_migrator acting as dp_owner), used only for what the
// API may not do (catalogue sync, migration history, proving a trigger also stops the owner);
// `bootstrapDb` is dp_iam_bootstrap.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertTestDatabaseUrl } from "@dream/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { accessibleScope, decide } from "../../src/iam/authorization.js";
import { BootstrapRefusedError, bootstrapPlatformAdmin } from "../../src/iam/bootstrap.js";
import { MODULES, PERMISSIONS, ROLES } from "../../src/iam/catalog.js";
import { catalogProblems, syncCatalog } from "../../src/iam/catalog-sync.js";
import {
  countOtherPlatformAdmins,
  loadAuthorizationSnapshot,
  loadGrantAncestry,
} from "../../src/iam/repository.js";
import { SiteScopeViolationError, withSiteScope } from "../../src/iam/site-scope.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = [
  "20261110120000_f1_001_identity_authorization",
  "20261110180000_f1_001a_last_platform_admin_guard",
  "20261110210000_f1_001b_rbac_guards",
  "20261110230000_adr_012a_database_roles",
  "20261111090000_f1_002_authentication",
];
const url = assertTestDatabaseUrl(process.env["DATABASE_URL"]).toString();
const ownerUrl = assertTestDatabaseUrl(process.env["MIGRATE_DATABASE_URL"]).toString();
const bootstrapUrl = assertTestDatabaseUrl(process.env["IAM_BOOTSTRAP_DATABASE_URL"]).toString();

let prisma: PrismaClient;
let owner: PrismaClient;
let bootstrapDb: PrismaClient;
let BV: string;
let COM: string;
/** An ACTIVE, MFA-enrolled staff user: a valid grantor for test assignments (F1-002 K-NG2). */
let grantorId: string;
const run = Math.random().toString(36).slice(2, 8);
// Placeholder Argon2id PHC string: ACTIVE staff need a password and MFA (F1-002, M1 CHECK).
const ARGON = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";

/** Staff user; an ACTIVE one is fully enrolled, as M1 requires (User_staff_active_credentials_check). */
async function staff(label: string, status: "ACTIVE" | "PENDING" = "ACTIVE") {
  const email = `${label}.${run}@example.test`;
  const enrolled =
    status === "ACTIVE"
      ? { passwordHash: ARGON, mfaEnrolledAt: new Date(), emailVerifiedAt: new Date() }
      : {};
  return prisma.user.create({
    data: { email, emailNormalized: email, kind: "STAFF", status, ...enrolled },
  });
}

async function customer(label: string) {
  const email = `${label}.${run}@example.test`;
  return prisma.user.create({
    data: {
      email,
      emailNormalized: email,
      kind: "CUSTOMER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
}

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

async function roleId(key: string): Promise<string> {
  return (await prisma.role.findUniqueOrThrow({ where: { key } })).id;
}

beforeAll(async () => {
  // Idempotent: applies the committed migrations if the suite runs on its own.
  execFileSync(path.join(API_DIR, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: API_DIR,
    env: process.env,
    stdio: "pipe",
  });
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerUrl }) });
  bootstrapDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: bootstrapUrl }) });
  await syncCatalog(owner);
  BV = (await prisma.site.findUniqueOrThrow({ where: { key: "BV" } })).id;
  COM = (await prisma.site.findUniqueOrThrow({ where: { key: "CORPORATE" } })).id;
  grantorId = (await staff("grantor")).id;
});

afterAll(async () => {
  await prisma?.$disconnect();
  await owner?.$disconnect();
  await bootstrapDb?.$disconnect();
});

describe("first real migration", () => {
  it("records each migration as applied exactly once", async () => {
    for (const name of MIGRATIONS) {
      const rows = await owner.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM _prisma_migrations
        WHERE migration_name = ${name} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      expect(Number(rows[0]?.n), name).toBe(1);
    }
    const status = execFileSync(
      path.join(API_DIR, "node_modules/.bin/prisma"),
      ["migrate", "status"],
      {
        cwd: API_DIR,
        env: process.env,
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    expect(status).toMatch(/up to date/i);
  });

  it("creates the guard triggers", async () => {
    const rows = await prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname`;
    expect(rows.map((r) => r.tgname)).toEqual(
      expect.arrayContaining([
        "AuditEvent_append_only",
        "AuditEvent_no_truncate",
        "FeatureModule_core_guard",
        "ModuleConfiguration_guard",
        "RoleAssignment_guard",
        "RoleAssignment_last_platform_admin",
        "User_kind_immutable",
        "User_last_platform_admin",
        "RoleAssignment_customer_data_guard",
        "RoleAssignment_reciprocal_guard",
        "RoleAssignment_last_platform_admin_expiry",
        "RoleAssignment_null_grantor_guard",
        "RoleAssignment_grantor_guard",
        "RoleAssignment_db_audit",
        "User_deactivated_terminal",
        "User_security_db_audit",
      ]),
    );
  });
});

describe("catalogue sync", () => {
  it("mirrors the code catalogue and is idempotent", async () => {
    const again = await syncCatalog(owner);
    expect(again.rolePermissionsAdded).toBe(0);
    expect(again.rolePermissionsRemoved).toBe(0);
    expect(await prisma.featureModule.count()).toBe(MODULES.length);
    expect(await prisma.permission.count()).toBe(PERMISSIONS.length);
    expect(await prisma.role.count()).toBe(ROLES.length);
    expect(await prisma.rolePermission.count()).toBe(
      ROLES.reduce((n, r) => n + r.permissions.length, 0),
    );
    expect(await prisma.site.count()).toBe(2);
  });

  it("restores a role permission removed or added in the database", async () => {
    const editor = await roleId("content_editor");
    const publish = await prisma.permission.findUniqueOrThrow({
      where: { key: "content:publish" },
    });
    await owner.rolePermission.create({ data: { roleId: editor, permissionId: publish.id } });
    const res = await syncCatalog(owner);
    expect(res.rolePermissionsRemoved).toBe(1);
  });

  it("cannot be changed by the API's role (ADR-012A)", async () => {
    const editor = await roleId("content_editor");
    const publish = await prisma.permission.findUniqueOrThrow({
      where: { key: "content:publish" },
    });
    await expect(
      prisma.rolePermission.create({ data: { roleId: editor, permissionId: publish.id } }),
    ).rejects.toThrow(/permission denied/i);
    await expect(syncCatalog(prisma)).rejects.toThrow(/permission denied/i);
    expect(await catalogProblems(prisma)).toEqual([]);
  });
});

describe("database-enforced invariants", () => {
  it("rejects a non-normalised e-mail and a non-Argon2id password hash", async () => {
    await expect(
      prisma.user.create({
        data: { email: "A@x.test", emailNormalized: "A@x.test", kind: "STAFF" },
      }),
    ).rejects.toThrow(/User_emailNormalized_check/);
    await expect(
      prisma.user.create({
        data: {
          email: `p.${run}@x.test`,
          emailNormalized: `p.${run}@x.test`,
          kind: "STAFF",
          passwordHash: "plaintext",
        },
      }),
    ).rejects.toThrow(/User_passwordHash_argon2id_check/);
  });

  it("rejects a duplicate e-mail regardless of case", async () => {
    const u = await staff("dup");
    await expect(
      prisma.user.create({
        data: { email: u.email.toUpperCase(), emailNormalized: u.emailNormalized, kind: "STAFF" },
      }),
    ).rejects.toThrow();
  });

  it("never changes a user's kind", async () => {
    const c = await customer("kind");
    await expect(
      prisma.user.update({ where: { id: c.id }, data: { kind: "STAFF" } }),
    ).rejects.toThrow(/User.kind is immutable/);
  });

  it("keeps the role assignment scope consistent", async () => {
    const u = await staff("scope");
    const siteAdmin = await roleId("site_admin");
    await expect(
      prisma.roleAssignment.create({
        data: {
          userId: u.id,
          roleId: siteAdmin,
          scopeType: "SITE",
          siteId: null,
          grantedById: grantorId,
        },
      }),
    ).rejects.toThrow(/RoleAssignment_scope_check/);
    const superAdmin = await roleId("platform_super_admin");
    await expect(
      prisma.roleAssignment.create({
        data: {
          userId: u.id,
          roleId: superAdmin,
          scopeType: "PLATFORM",
          siteId: BV,
          grantedById: grantorId,
        },
      }),
    ).rejects.toThrow(/RoleAssignment_scope_check/);
  });

  it("refuses self-grants, staff roles for customers and roles at the wrong scope type", async () => {
    const u = await staff("self");
    const c = await customer("esc");
    const siteAdmin = await roleId("site_admin");
    await expect(
      prisma.roleAssignment.create({
        data: { userId: u.id, roleId: siteAdmin, scopeType: "SITE", siteId: BV, grantedById: u.id },
      }),
    ).rejects.toThrow(/RoleAssignment_no_self_grant_check/);
    await expect(
      prisma.roleAssignment.create({
        data: { userId: c.id, roleId: siteAdmin, scopeType: "SITE", siteId: BV },
      }),
    ).rejects.toThrow(/role audience does not match/);
    await expect(
      prisma.roleAssignment.create({
        data: { userId: u.id, roleId: siteAdmin, scopeType: "PLATFORM" },
      }),
    ).rejects.toThrow(/cannot be assigned at this scope type/);
  });

  it("does not let an assignment be turned into another role or site", async () => {
    const u = await staff("mutate");
    const a = await prisma.roleAssignment.create({
      data: {
        userId: u.id,
        roleId: await roleId("read_only"),
        scopeType: "SITE",
        siteId: BV,
        grantedById: grantorId,
      },
    });
    await expect(
      prisma.roleAssignment.update({
        where: { id: a.id },
        data: { roleId: await roleId("site_admin") },
      }),
    ).rejects.toThrow(/identity is immutable/);
    await expect(
      prisma.roleAssignment.update({ where: { id: a.id }, data: { siteId: COM } }),
    ).rejects.toThrow(/identity is immutable/);
    const revoked = await prisma.roleAssignment.update({
      where: { id: a.id },
      data: { revokedAt: new Date() },
    });
    expect(revoked.revokedAt).not.toBeNull();
  });

  it("never disables, downgrades or deletes a core module (God Mode limit)", async () => {
    for (const key of ["mfa", "audit", "rbac"]) {
      const mod = await prisma.featureModule.findUniqueOrThrow({ where: { key } });
      await expect(
        prisma.moduleConfiguration.create({
          data: { moduleId: mod.id, siteId: BV, enabled: false, reason: "test" },
        }),
      ).rejects.toThrow(/core modules cannot be disabled/);
      // The owner has the privileges, so the trigger is what stops it; the API lacks them.
      await expect(
        owner.featureModule.update({ where: { key }, data: { isCore: false } }),
      ).rejects.toThrow(/core modules cannot be removed or downgraded/);
      await expect(owner.featureModule.delete({ where: { key } })).rejects.toThrow(
        /core modules cannot be removed or downgraded/,
      );
      await expect(
        prisma.featureModule.update({ where: { key }, data: { isCore: false } }),
      ).rejects.toThrow(/permission denied/i);
    }
    const crm = await prisma.featureModule.findUniqueOrThrow({ where: { key: "crm" } });
    const cfg = await prisma.moduleConfiguration.create({
      data: { moduleId: crm.id, siteId: COM, enabled: false, reason: "optional module off" },
    });
    expect(cfg.enabled).toBe(false);
    await expect(
      prisma.moduleConfiguration.update({ where: { id: cfg.id }, data: { reason: " " } }),
    ).rejects.toThrow(/ModuleConfiguration_reason_check/);
  });

  it("keeps audit events append-only (no UPDATE, DELETE or TRUNCATE)", async () => {
    const e = await prisma.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        action: "iam.test_event",
        resourceType: "test",
        scopeType: "SITE",
        siteId: BV,
        outcome: "SUCCESS",
      },
    });
    // Two independent layers (ADR-012A): the API's role has no privilege to change rows, and
    // the trigger refuses even the owner, who has every privilege.
    await expect(
      prisma.auditEvent.update({ where: { id: e.id }, data: { outcome: "FAILURE" } }),
    ).rejects.toThrow(/permission denied/i);
    await expect(prisma.auditEvent.delete({ where: { id: e.id } })).rejects.toThrow(
      /permission denied/i,
    );
    await expect(prisma.$executeRawUnsafe('TRUNCATE "AuditEvent"')).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      owner.auditEvent.update({ where: { id: e.id }, data: { outcome: "FAILURE" } }),
    ).rejects.toThrow(/append-only/);
    await expect(owner.auditEvent.delete({ where: { id: e.id } })).rejects.toThrow(/append-only/);
    await expect(owner.$executeRawUnsafe('TRUNCATE "AuditEvent"')).rejects.toThrow(/append-only/);
    expect(await prisma.auditEvent.findUnique({ where: { id: e.id } })).not.toBeNull();
    await expect(
      prisma.auditEvent.create({
        data: {
          actorType: "USER",
          action: "x.y",
          resourceType: "t",
          scopeType: "PLATFORM",
          outcome: "SUCCESS",
        },
      }),
    ).rejects.toThrow(/AuditEvent_actor_check/);
  });
});

describe("secure bootstrap of the first platform administrator", () => {
  it("refuses while the catalogue in the database differs from the code (ADR-012A)", async () => {
    const editor = await roleId("content_editor");
    const publish = await prisma.permission.findUniqueOrThrow({
      where: { key: "content:publish" },
    });
    await owner.rolePermission.create({ data: { roleId: editor, permissionId: publish.id } });
    try {
      await expect(
        bootstrapPlatformAdmin(bootstrapDb, { email: `drift.${run}@example.test` }),
      ).rejects.toThrow(/role content_editor permission set differs.*run iam:sync first/);
      expect(
        await prisma.roleAssignment.count({ where: { role: { key: "platform_super_admin" } } }),
      ).toBe(0);
    } finally {
      await syncCatalog(owner);
    }
  });

  it("K-NG1 (NT-DB1, NT-DB1b): no NULL grantor outside the bootstrap shape, even before any admin exists", async () => {
    expect(
      await prisma.roleAssignment.count({
        where: { role: { key: "platform_super_admin" }, revokedAt: null },
      }),
    ).toBe(0);
    const superAdmin = await roleId("platform_super_admin");
    // Raw SQL with fixed test literals only; [column, SQL value] pairs add optional columns.
    const insertUser = (tx: PrismaClient, email: string, extra?: [string, string]) =>
      tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO "User" (id, email, "emailNormalized", kind, status, "updatedAt"${extra ? `, ${extra[0]}` : ""})
         VALUES (gen_random_uuid(), '${email}', '${email}', 'STAFF', 'PENDING', now()${extra ? `, ${extra[1]}` : ""})
         RETURNING id`,
      );
    const assign = (
      tx: PrismaClient,
      userId: string,
      role: string,
      scope = "'PLATFORM', NULL",
      extra?: [string, string],
    ) =>
      tx.$executeRawUnsafe(
        `INSERT INTO "RoleAssignment" (id, "userId", "roleId", "scopeType", "siteId", reason${extra ? `, ${extra[0]}` : ""})
         VALUES (gen_random_uuid(), '${userId}', '${role}', ${scope}, 'bootstrap test'${extra ? `, ${extra[1]}` : ""})`,
      );
    // NT-DB1: the API's role, even with the exact bootstrap shape and no administrator.
    const apiTarget = await staff("ng1-api", "PENDING");
    await expect(assign(prisma, apiTarget.id, superAdmin)).rejects.toThrow(
      /allowed only for the bootstrap, as dp_iam_bootstrap/,
    );
    // NT-DB1b: the bootstrap role, wrong role / scope, expiry, or a target that is not a fresh
    // PENDING staff account.
    const cases: [string, (tx: PrismaClient) => Promise<unknown>, RegExp][] = [
      [
        "site_admin",
        async (tx) => {
          const [u] = await insertUser(tx, `ng1-sa.${run}@example.test`);
          return assign(tx, u!.id, await roleId("site_admin"), `'SITE', '${BV}'`);
        },
        /may only assign platform_super_admin/,
      ],
      [
        "with expiry",
        async (tx) => {
          const [u] = await insertUser(tx, `ng1-exp.${run}@example.test`);
          return assign(tx, u!.id, superAdmin, "'PLATFORM', NULL", [
            `"expiresAt"`,
            `now() + interval '1 day'`,
          ]);
        },
        /may only assign platform_super_admin/,
      ],
      [
        "target with a password",
        async (tx) => {
          const [u] = await insertUser(tx, `ng1-pw.${run}@example.test`, [
            `"passwordHash"`,
            `'${ARGON}'`,
          ]);
          return assign(tx, u!.id, superAdmin);
        },
        /PENDING staff user without password or MFA/,
      ],
      [
        "ACTIVE target",
        async (tx) => {
          const e = `ng1-act.${run}@example.test`;
          const [u] = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO "User" (id, email, "emailNormalized", kind, status, "passwordHash", "mfaEnrolledAt", "emailVerifiedAt", "updatedAt")
             VALUES (gen_random_uuid(), '${e}', '${e}', 'STAFF', 'ACTIVE', '${ARGON}', now(), now(), now()) RETURNING id`,
          );
          return assign(tx, u!.id, superAdmin);
        },
        /PENDING staff user without password or MFA/,
      ],
    ];
    for (const [what, fn, error] of cases) {
      await expect(
        bootstrapDb.$transaction(async (tx) => fn(tx as unknown as PrismaClient)),
        what,
      ).rejects.toThrow(error);
    }
    // The exact bootstrap shape as dp_iam_bootstrap passes the guard (rolled back here; the real
    // bootstrap below keeps its row).
    await rolledBack(bootstrapDb, async (tx) => {
      const [u] = await insertUser(tx, `ng1-ok.${run}@example.test`);
      await assign(tx, u!.id, superAdmin);
    });
  });

  it("creates exactly one administrator even when two runs race, without a password", async () => {
    const results = await Promise.allSettled([
      bootstrapPlatformAdmin(bootstrapDb, { email: `Root.A.${run}@Example.test` }),
      bootstrapPlatformAdmin(bootstrapDb, { email: `root.b.${run}@example.test` }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failures = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason)] : []));
    expect(ok, failures.join("\n")).toHaveLength(1);
    const { userId } = (ok[0] as PromiseFulfilledResult<{ userId: string }>).value;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({
      kind: "STAFF",
      status: "PENDING",
      passwordHash: null,
      mfaEnrolledAt: null,
    });
    expect(user.emailNormalized).toBe(user.email.toLowerCase());
    const active = await prisma.roleAssignment.count({
      where: { role: { key: "platform_super_admin" }, revokedAt: null },
    });
    expect(active).toBe(1);
    // NT-DB2: the database wrote its own record, attributing the row to dp_iam_bootstrap.
    const assignment = await prisma.roleAssignment.findFirstOrThrow({
      where: { userId, role: { key: "platform_super_admin" } },
    });
    const dbEvents = await prisma.auditEvent.findMany({
      where: { resourceId: assignment.id, action: "db.role_assignment_created" },
    });
    expect(dbEvents).toHaveLength(1);
    expect(dbEvents[0]).toMatchObject({
      actorType: "SYSTEM",
      scopeType: "PLATFORM",
      metadata: {
        dbUser: "dp_iam_bootstrap",
        role: "platform_super_admin",
        nullGrantor: true,
        userId,
      },
    });
  });

  it("refuses every later run and audits both outcomes with masked e-mail", async () => {
    await expect(
      bootstrapPlatformAdmin(bootstrapDb, { email: `late.${run}@example.test` }),
    ).rejects.toBeInstanceOf(BootstrapRefusedError);
    // NT-DB1b: with an administrator present, the database refuses a direct bootstrap row too,
    // so the bootstrap credential is useless after the first run (T14).
    const superAdmin = await roleId("platform_super_admin");
    await expect(
      bootstrapDb.$transaction(async (tx) => {
        const e = `late-raw.${run}@example.test`;
        const [u] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO "User" (id, email, "emailNormalized", kind, status, "updatedAt")
           VALUES (gen_random_uuid(), '${e}', '${e}', 'STAFF', 'PENDING', now()) RETURNING id`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "RoleAssignment" (id, "userId", "roleId", "scopeType", reason)
           VALUES (gen_random_uuid(), '${u!.id}', '${superAdmin}', 'PLATFORM', 'late')`,
        );
      }),
    ).rejects.toThrow(/a platform administrator already exists \(K-NG1\)/);
    const events = await prisma.auditEvent.findMany({ where: { action: "iam.bootstrap_admin" } });
    expect(events.filter((e) => e.outcome === "SUCCESS")).toHaveLength(1);
    expect(events.filter((e) => e.outcome === "DENIED").length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(events.map((e) => e.metadata))).not.toContain(`late.${run}@`);
  });

  it("gives the pending administrator no access until enrolment (DP-011)", async () => {
    const assignment = await prisma.roleAssignment.findFirstOrThrow({
      where: { role: { key: "platform_super_admin" }, revokedAt: null },
    });
    const snap = await loadAuthorizationSnapshot(prisma, assignment.userId, { mfaVerified: true });
    expect(snap && decide(snap, "module:manage", { scope: "platform" })).toEqual({
      allowed: false,
      reason: "principal_inactive",
    });
  });
});

describe("last platform administrator protection (database triggers, F1-001A)", () => {
  // State from the bootstrap tests: exactly one PENDING platform administrator.
  let firstAdmin: { id: string; userId: string };
  const superAdminAssignments = () =>
    prisma.roleAssignment.findMany({
      where: { role: { key: "platform_super_admin" }, revokedAt: null },
      select: { id: true, userId: true },
    });

  beforeAll(async () => {
    const rows = await superAdminAssignments();
    expect(rows).toHaveLength(1);
    firstAdmin = rows[0]!;
    // Complete the bootstrap administrator's enrolment (what DP-011's enrolment does), so it can
    // act as a grantor: K-NG2 accepts only ACTIVE, MFA-enrolled staff as grantors.
    await prisma.user.update({
      where: { id: firstAdmin.userId },
      data: {
        status: "ACTIVE",
        passwordHash: ARGON,
        mfaEnrolledAt: new Date(),
        emailVerifiedAt: new Date(),
      },
    });
  });

  async function addAdmin(label: string) {
    const u = await staff(label);
    const a = await prisma.roleAssignment.create({
      data: {
        userId: u.id,
        roleId: await roleId("platform_super_admin"),
        scopeType: "PLATFORM",
        grantedById: firstAdmin.userId,
      },
    });
    return { id: a.id, userId: u.id };
  }

  it("refuses to revoke, expire, delete, suspend or deactivate the only administrator", async () => {
    const { id, userId } = firstAdmin;
    const last = /last active platform administrator/;
    await expect(
      prisma.roleAssignment.update({ where: { id }, data: { revokedAt: new Date() } }),
    ).rejects.toThrow(last);
    const assignment = await prisma.roleAssignment.findUniqueOrThrow({ where: { id } });
    await expect(
      prisma.roleAssignment.update({
        where: { id },
        data: { expiresAt: new Date(assignment.grantedAt.getTime() + 1) },
      }),
    ).rejects.toThrow(last);
    await expect(prisma.roleAssignment.delete({ where: { id } })).rejects.toThrow(last);
    for (const status of ["SUSPENDED", "DEACTIVATED"] as const) {
      await expect(prisma.user.update({ where: { id: userId }, data: { status } })).rejects.toThrow(
        last,
      );
    }
    expect(await superAdminAssignments()).toHaveLength(1);
    expect(await countOtherPlatformAdmins(prisma, userId)).toBe(0);
  });

  it("allows removing an administrator while another remains", async () => {
    const second = await addAdmin("admin-two");
    expect(await countOtherPlatformAdmins(prisma, firstAdmin.userId)).toBe(1);
    await prisma.roleAssignment.update({
      where: { id: firstAdmin.id },
      data: { revokedAt: new Date(), revokedById: second.userId },
    });
    // Now `second` is the last one.
    await expect(
      prisma.roleAssignment.update({ where: { id: second.id }, data: { revokedAt: new Date() } }),
    ).rejects.toThrow(/last active platform administrator/);
    firstAdmin = second;
  });

  it("lets only one of two concurrent removals succeed", async () => {
    const third = await addAdmin("admin-three");
    const results = await Promise.allSettled([
      prisma.roleAssignment.update({
        where: { id: firstAdmin.id },
        data: { revokedAt: new Date() },
      }),
      prisma.user.update({ where: { id: third.userId }, data: { status: "SUSPENDED" } }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const remaining = await prisma.roleAssignment.count({
      where: {
        role: { key: "platform_super_admin" },
        revokedAt: null,
        user: { status: { in: ["ACTIVE", "PENDING"] } },
      },
    });
    expect(remaining).toBe(1);
  });

  it("refuses an expiry on the last non-expiring administrator (F1-001B)", async () => {
    const [last] = await prisma.roleAssignment.findMany({
      where: {
        role: { key: "platform_super_admin" },
        revokedAt: null,
        user: { status: { in: ["ACTIVE", "PENDING"] } },
      },
    });
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await expect(
      prisma.roleAssignment.update({ where: { id: last!.id }, data: { expiresAt: future } }),
    ).rejects.toThrow(/cannot get an expiry/);
    expect(
      await countOtherPlatformAdmins(prisma, last!.userId, new Date(), { nonExpiringOnly: true }),
    ).toBe(0);

    firstAdmin = { id: last!.id, userId: last!.userId };
    const backup = await addAdmin("admin-backup");
    await prisma.roleAssignment.update({ where: { id: last!.id }, data: { expiresAt: future } });
    // Now `backup` is the only one without expiry; it cannot get one either.
    await expect(
      prisma.roleAssignment.update({ where: { id: backup.id }, data: { expiresAt: future } }),
    ).rejects.toThrow(/cannot get an expiry/);
  });
});

describe("final RBAC guards in the database (F1-001B)", () => {
  it("accepts customer-data roles like any other role since the DP-076 revision", async () => {
    // ADR-017 v2: no second approver, justification or expiry. Who may grant them is decided in
    // code (no-escalation); the database keeps only the general guards.
    const u = await staff("cd-target");
    const grantor = await staff("cd-grantor");
    for (const [key, scopeType, siteId] of [
      ["sales_crm_user", "SITE", BV],
      ["platform_customer_data_officer", "PLATFORM", null],
    ] as const) {
      await prisma.roleAssignment.create({
        data: {
          userId: u.id,
          roleId: await roleId(key),
          scopeType,
          siteId,
          grantedById: grantor.id,
        },
      });
    }
    expect(await prisma.roleAssignment.count({ where: { userId: u.id, expiresAt: null } })).toBe(2);
  });

  it("refuses reciprocal and indirect self-grants", async () => {
    const a = await staff("chain-a");
    const b = await staff("chain-b");
    const c = await staff("chain-c");
    const readOnly = await roleId("read_only");
    const editor = await roleId("content_editor");
    const grantRole = (userId: string, grantedById: string, role = readOnly) =>
      prisma.roleAssignment.create({
        data: { userId, roleId: role, scopeType: "SITE", siteId: BV, grantedById },
      });
    await grantRole(b.id, a.id); // A -> B
    await grantRole(c.id, b.id); // B -> C
    await expect(grantRole(a.id, b.id)).rejects.toThrow(/reciprocal or indirect self-grant/); // B -> A
    await expect(grantRole(a.id, c.id)).rejects.toThrow(/reciprocal or indirect self-grant/); // C -> A
    await expect(grantRole(b.id, c.id, editor)).rejects.toThrow(
      /reciprocal or indirect self-grant/,
    ); // C -> B
    expect([...(await loadGrantAncestry(prisma, c.id))].sort()).toEqual([a.id, b.id].sort());
    // An unrelated user is still fine.
    const d = await staff("chain-d");
    await expect(grantRole(d.id, c.id)).resolves.toBeTruthy();
  });

  it("lets publishers be assigned without the grantor publishing itself", async () => {
    const pub = await staff("publisher");
    const admin = await staff("pub-admin");
    const created = await prisma.roleAssignment.create({
      data: {
        userId: pub.id,
        roleId: await roleId("content_publisher"),
        scopeType: "SITE",
        siteId: BV,
        grantedById: admin.id,
      },
    });
    expect(created.revokedAt).toBeNull();
  });
});

describe("site isolation against the database", () => {
  let editorId: string;
  let comMembershipId: string;

  beforeAll(async () => {
    const editor = await staff("bv-editor");
    editorId = editor.id;
    const comUser = await customer("com-member");
    const bvUser = await customer("bv-member");
    await prisma.membership.create({ data: { userId: editor.id, siteId: BV, status: "ACTIVE" } });
    await prisma.membership.create({ data: { userId: bvUser.id, siteId: BV, status: "ACTIVE" } });
    comMembershipId = (
      await prisma.membership.create({
        data: { userId: comUser.id, siteId: COM, status: "ACTIVE" },
      })
    ).id;
    await prisma.roleAssignment.create({
      data: {
        userId: editor.id,
        roleId: await roleId("compliance_reviewer"),
        scopeType: "SITE",
        siteId: BV,
        grantedById: grantorId,
      },
    });
    for (const siteId of [BV, COM]) {
      await prisma.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          action: "iam.isolation_probe",
          resourceType: "test",
          scopeType: "SITE",
          siteId,
          outcome: "SUCCESS",
        },
      });
    }
    await prisma.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        action: "iam.isolation_probe",
        resourceType: "test",
        scopeType: "PLATFORM",
        outcome: "SUCCESS",
      },
    });
  });

  it("allows the BV reviewer on BV and denies it on COM, from database state", async () => {
    const snap = await loadAuthorizationSnapshot(prisma, editorId, { mfaVerified: false });
    expect(snap).not.toBeNull();
    expect(decide(snap!, "audit:read", { scope: "site", siteId: BV }).allowed).toBe(true);
    expect(decide(snap!, "audit:read", { scope: "site", siteId: COM }).allowed).toBe(false);
    expect(
      await loadAuthorizationSnapshot(prisma, "00000000-0000-7000-8000-000000000000", {
        mfaVerified: true,
      }),
    ).toBeNull();
  });

  it("returns only BV rows and treats a COM id like a missing record (IDOR)", async () => {
    const snap = (await loadAuthorizationSnapshot(prisma, editorId, { mfaVerified: false }))!;
    const scope = accessibleScope(snap, "audit:read", [BV, COM]);
    expect(scope).toEqual({ siteIds: [BV], includePlatform: false });
    const db = withSiteScope(prisma, scope);

    const audit = await db.auditEvent.findMany({ where: { action: "iam.isolation_probe" } });
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((e) => e.siteId === BV)).toBe(true);
    // Even an explicit filter for another site cannot widen the scope.
    expect(await db.auditEvent.count({ where: { siteId: COM } })).toBe(0);
    expect(await db.membership.count({ where: { siteId: COM } })).toBe(0);
    expect(await db.membership.findUnique({ where: { id: comMembershipId } })).toBeNull();
    await expect(
      db.membership.update({ where: { id: comMembershipId }, data: { status: "SUSPENDED" } }),
    ).rejects.toThrow();
    expect(
      (
        await db.membership.updateMany({
          where: { id: comMembershipId },
          data: { status: "SUSPENDED" },
        })
      ).count,
    ).toBe(0);
    expect(
      (await prisma.membership.findUniqueOrThrow({ where: { id: comMembershipId } })).status,
    ).toBe("ACTIVE");
  });

  it("refuses writes into another site and moving rows across sites", async () => {
    const db = withSiteScope(prisma, { siteIds: [BV], includePlatform: false });
    const u = await customer("x-site");
    await expect(
      db.membership.create({ data: { userId: u.id, siteId: COM } }),
    ).rejects.toBeInstanceOf(SiteScopeViolationError);
    const own = await db.membership.create({ data: { userId: u.id, siteId: BV } });
    await expect(
      db.membership.update({ where: { id: own.id }, data: { siteId: COM } }),
    ).rejects.toBeInstanceOf(SiteScopeViolationError);
  });

  it("sees nothing with an empty scope, and platform rows only for platform grants", async () => {
    const none = withSiteScope(prisma, { siteIds: [], includePlatform: false });
    expect(await none.auditEvent.count()).toBe(0);
    expect(await none.membership.count()).toBe(0);
    const platform = withSiteScope(prisma, { siteIds: [BV, COM], includePlatform: true });
    const probes = await platform.auditEvent.findMany({ where: { action: "iam.isolation_probe" } });
    expect(new Set(probes.map((e) => e.siteId ?? "platform"))).toEqual(
      new Set([BV, COM, "platform"]),
    );
  });
  it("filters relations reached from models that are not site-bound (F1-001A)", async () => {
    const db = withSiteScope(prisma, { siteIds: [BV], includePlatform: false });
    const com = await prisma.membership.findUniqueOrThrow({ where: { id: comMembershipId } });

    const viaUser = await db.user.findUnique({
      where: { id: com.userId },
      include: { memberships: true, _count: { select: { memberships: true } } },
    });
    expect(viaUser?.memberships).toEqual([]);
    expect(viaUser?._count.memberships).toBe(0);

    const viaSite = await db.site.findUniqueOrThrow({
      where: { id: COM },
      include: { memberships: true, auditEvents: true },
    });
    expect(viaSite.memberships).toEqual([]);
    expect(viaSite.auditEvents).toEqual([]);

    // Fluent API.
    expect(await db.user.findUnique({ where: { id: com.userId } }).memberships()).toEqual([]);

    // Relation filters cannot be used as an existence oracle for another site.
    expect(await db.user.count({ where: { id: com.userId, memberships: { some: {} } } })).toBe(0);
    expect(
      await db.user.count({ where: { id: editorId, memberships: { some: { siteId: BV } } } }),
    ).toBe(1);

    // Deep traversal: BV membership -> user -> that user's memberships on other sites.
    const deep = await db.membership.findMany({
      where: { userId: editorId },
      include: { user: { include: { memberships: true, roleAssignments: true } } },
    });
    for (const m of deep) {
      expect(m.user.memberships.every((x) => x.siteId === BV)).toBe(true);
      expect(m.user.roleAssignments.every((x) => x.siteId === BV)).toBe(true);
    }
  });

  it("refuses nested writes, bare relation counts and relation-count ordering", async () => {
    const db = withSiteScope(prisma, { siteIds: [BV], includePlatform: false });
    await expect(
      db.user.create({
        data: {
          email: `nested.${run}@example.test`,
          emailNormalized: `nested.${run}@example.test`,
          kind: "CUSTOMER",
          memberships: { create: { siteId: COM } },
        },
      }),
    ).rejects.toBeInstanceOf(SiteScopeViolationError);
    await expect(db.user.findMany({ include: { _count: true } })).rejects.toBeInstanceOf(
      SiteScopeViolationError,
    );
    await expect(
      db.user.findMany({ orderBy: { memberships: { _count: "desc" } } }),
    ).rejects.toBeInstanceOf(SiteScopeViolationError);
    await expect(
      db.site.update({ where: { id: COM }, data: { memberships: { deleteMany: {} } } }),
    ).rejects.toBeInstanceOf(SiteScopeViolationError);
    expect(await prisma.membership.count({ where: { siteId: COM } })).toBeGreaterThan(0);
  });

  it("refuses raw SQL on the scoped client, also inside transactions", async () => {
    const db = withSiteScope(prisma, { siteIds: [BV], includePlatform: false });
    expect(() => db.$queryRawUnsafe('SELECT * FROM "Membership"')).toThrow(SiteScopeViolationError);
    expect(() => db.$executeRawUnsafe('DELETE FROM "Membership"')).toThrow(SiteScopeViolationError);
    await expect(
      db.$transaction(async (tx) => tx.$queryRawUnsafe('SELECT * FROM "Membership"')),
    ).rejects.toBeInstanceOf(SiteScopeViolationError);
    // The transaction client keeps the scope.
    const inTx = await db.$transaction(async (tx) =>
      tx.membership.count({ where: { siteId: COM } }),
    );
    expect(inTx).toBe(0);
  });
});
