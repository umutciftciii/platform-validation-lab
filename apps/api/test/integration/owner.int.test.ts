// DP-108 (ADR-018): the system owner (God Mode) end to end, on a database of its own
// (OWNER_*_DATABASE_URL, a *_test database that starts EMPTY). Setup as in leads.int.test.ts:
// migrations as dp_migrator, catalogue sync and bootstrap through the operator CLI, staff fixtures
// written as dp_owner, the API in-process from dist/ as dp_app.
//
// Covers: privileges of the new tables and functions per role (condition 1), the designation
// (CLI as dp_iam_bootstrap, confirmation over HTTP with token, password and step-up; one owner,
// never changed or removed), God Mode through `decide` (module switches, the step-up, 404 for
// everyone else), the owner out of reach of the super admin over HTTP and in the database
// (condition 7), the PROTECTED stream (classification, hidden from staff, hash chain, tamper
// detection; conditions 2 and 3) and the owner recovery (CLI only, ownership unchanged).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  EnrolInspectResponseSchema,
  EnrolMfaConfirmResponseSchema,
  EnrolMfaSetupResponseSchema,
  ErrorBodySchema,
  OwnerChainStatusSchema,
  OwnerModuleChangeResponseSchema,
  OwnerOverviewResponseSchema,
  ProtectedAuditListResponseSchema,
  StaffListResponseSchema,
} from "@dream/contracts";
import { assertTestDatabaseUrl } from "@dream/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type Prisma } from "../../src/generated/prisma/client.js";
import { base32Decode, totpCode } from "../../src/iam/auth/totp.js";
import { ADMIN_ORIGIN, TEST_KEYS, apiTestEnv } from "./helpers/auth-env.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(API_DIR, "dist/iam/iam-cli.js");
const PRISMA = path.join(API_DIR, "node_modules/.bin/prisma");
const appUrl = assertTestDatabaseUrl(process.env["OWNER_DATABASE_URL"]);
const DB_NAME = appUrl.pathname.slice(1);
function onThisDb(variable: string): string {
  const u = assertTestDatabaseUrl(process.env[variable]);
  u.pathname = `/${DB_NAME}`;
  return assertTestDatabaseUrl(u.toString()).toString();
}
const urls = {
  app: appUrl.toString(),
  migrate: assertTestDatabaseUrl(process.env["OWNER_MIGRATE_DATABASE_URL"]).toString(),
  boot: onThisDb("IAM_BOOTSTRAP_DATABASE_URL"),
  su: onThisDb("TEST_SUPERUSER_DATABASE_URL"),
};
for (const variable of [
  "DATABASE_URL",
  "AUTH_DATABASE_URL",
  "CATALOG_DATABASE_URL",
  "WORKFLOW_DATABASE_URL",
  "DOCUMENTS_DATABASE_URL",
  "XREFS_DATABASE_URL",
  "LEADS_DATABASE_URL",
]) {
  const shared = process.env[variable];
  if (shared && new URL(shared).pathname === appUrl.pathname) {
    throw new Error("OWNER_DATABASE_URL must be a database of its own (it starts empty)");
  }
}
const ENV_BACKUP = { ...process.env };
const PASSWORD = `owner-test-${randomBytes(12).toString("base64url")}`;

interface App {
  listen(port: number, host: string): Promise<unknown>;
  getHttpServer(): { address(): unknown };
  close(): Promise<void>;
}

let app: App;
let base: string;
let dbo: PrismaClient; // dp_migrator acting as dp_owner: fixtures and probes
let asApp: PrismaClient; // dp_app: what the API may do
let asBoot: PrismaClient; // dp_iam_bootstrap: the operator credential
let BV: string;
let root: Staff; // bootstrap administrator, designated as the system owner below
let admin2: Staff; // a second super admin, granted by root
let editor: Staff; // content_editor on BV, granted by admin2

interface Res {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function parse(res: Response): Promise<Res> {
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

class Staff {
  constructor(
    readonly name: string,
    readonly userId: string,
    private readonly token: string,
  ) {}

  async call(method: "GET" | "POST", p: string, body?: unknown): Promise<Res> {
    const headers: Record<string, string> = {
      "x-dp-proxy-key": TEST_KEYS.admin,
      "x-dp-client-ip": "10.20.30.41",
      cookie: `__Host-dp_admin_session=${this.token}`,
    };
    if (method === "POST") {
      headers["origin"] = ADMIN_ORIGIN;
      headers["content-type"] = "application/json";
    }
    return parse(
      await fetch(`${base}/api/v1/admin${p}`, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      }),
    );
  }
}

function expectError(res: Res, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(ErrorBodySchema.parse(res.body).error.code).toBe(code);
}

async function session(userId: string, mfaVerifiedAt: Date | null = new Date()): Promise<string> {
  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const user = await dbo.user.findUniqueOrThrow({ where: { id: userId } });
  await dbo.session.create({
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      userId,
      kind: "STAFF",
      app: "ADMIN",
      securityVersion: user.securityVersion,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + 30 * 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 8 * 3_600_000),
      mfaVerifiedAt,
    },
  });
  return token;
}

async function staff(
  name: string,
  passwordHash: string,
  grants: { role: string; site?: string }[],
  grantor: string | null,
  existingUserId?: string,
): Promise<Staff> {
  const now = new Date();
  const userId =
    existingUserId ??
    (
      await dbo.user.create({
        data: {
          email: `${name}@staff.dp.test`,
          emailNormalized: `${name}@staff.dp.test`,
          kind: "STAFF",
          status: "ACTIVE",
          displayName: name,
          emailVerifiedAt: now,
          passwordHash,
          passwordUpdatedAt: now,
          mfaEnrolledAt: now,
        },
      })
    ).id;
  for (const g of grants) {
    const role = await dbo.role.findUniqueOrThrow({ where: { key: g.role } });
    if (g.site) {
      await dbo.membership.upsert({
        where: { userId_siteId: { userId, siteId: g.site } },
        create: { userId, siteId: g.site, status: "ACTIVE" },
        update: { status: "ACTIVE" },
      });
    }
    await dbo.roleAssignment.create({
      data: {
        userId,
        roleId: role.id,
        scopeType: g.site ? "SITE" : "PLATFORM",
        siteId: g.site ?? null,
        grantedById: grantor,
        reason: "DP-108 owner test fixture",
      },
    });
  }
  // A confirmed TOTP factor (format only; these tests never compute a code).
  await dbo.mfaFactor.create({
    data: {
      userId,
      type: "TOTP",
      secretCiphertext: `v1:${randomBytes(12).toString("base64url")}:${randomBytes(20).toString("base64url")}:${randomBytes(16).toString("base64url")}`,
      confirmedAt: now,
    },
  });
  return new Staff(name, userId, await session(userId));
}

function cli(args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    env: { PATH: process.env["PATH"] ?? "", DP_ADMIN_BASE_URL: ADMIN_ORIGIN, ...env },
    encoding: "utf8",
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
const ownerCli = (args: string[]) =>
  cli([...args, "--confirm-database", DB_NAME], { IAM_BOOTSTRAP_DATABASE_URL: urls.boot });

async function rejectsDb(p: Promise<unknown>, pattern: RegExp): Promise<void> {
  let error: unknown;
  try {
    await p;
  } catch (e) {
    error = e;
  }
  expect(error, "expected a database refusal").toBeDefined();
  expect(JSON.stringify(error, Object.getOwnPropertyNames(error)) + String(error)).toMatch(pattern);
}

const lastAudit = (action: string) =>
  dbo.auditEvent.findFirst({
    where: { action },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
  });

let hashPassword: (password: string) => Promise<string>;

beforeAll(async () => {
  dbo = new PrismaClient({ adapter: new PrismaPg({ connectionString: urls.migrate }) });
  asApp = new PrismaClient({ adapter: new PrismaPg({ connectionString: urls.app }) });
  asBoot = new PrismaClient({ adapter: new PrismaPg({ connectionString: urls.boot }) });
  const tables = await dbo.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM pg_tables WHERE schemaname = 'public'`;
  expect(Number(tables[0]?.n), "the owner test database must start empty").toBe(0);
  execFileSync(PRISMA, ["migrate", "deploy"], {
    cwd: API_DIR,
    env: { PATH: process.env["PATH"] ?? "", MIGRATE_DATABASE_URL: urls.migrate },
    stdio: "pipe",
  });
  const sync = cli(["sync", "--confirm-database", DB_NAME], { MIGRATE_DATABASE_URL: urls.migrate });
  expect(sync.status, sync.err).toBe(0);
  const boot = cli(
    ["bootstrap", "--email", "root@staff.dp.test", "--name", "Root", "--confirm-database", DB_NAME],
    { IAM_BOOTSTRAP_DATABASE_URL: urls.boot },
  );
  expect(boot.status, boot.err).toBe(0);
  ({ hashPassword } = (await import(
    pathToFileURL(path.join(API_DIR, "dist/iam/auth/password.js")).href
  )) as { hashPassword: (password: string) => Promise<string> });
  const hash = await hashPassword(PASSWORD);
  const rootUser = await dbo.user.findUniqueOrThrow({
    where: { emailNormalized: "root@staff.dp.test" },
  });
  const now = new Date();
  await dbo.user.update({
    where: { id: rootUser.id },
    data: {
      status: "ACTIVE",
      emailVerifiedAt: now,
      passwordHash: hash,
      passwordUpdatedAt: now,
      mfaEnrolledAt: now,
    },
  });
  BV = (await dbo.site.findFirstOrThrow({ where: { key: "BV" } })).id;
  root = await staff("root", hash, [], null, rootUser.id);
  admin2 = await staff("admin2", hash, [{ role: "platform_super_admin" }], rootUser.id);
  editor = await staff("editor", hash, [{ role: "content_editor", site: BV }], admin2.userId);
  await dbo.mfaRecoveryCode.create({
    data: { userId: root.userId, codeHash: createHash("sha256").update("code").digest("hex") },
  });

  Object.assign(process.env, apiTestEnv(), {
    DATABASE_URL: urls.app,
    DB_ENV: "test",
    DB_EXPECTED_NAME: DB_NAME,
  });
  delete process.env["DP_DEPLOY_ENV"];
  const factory = (await import(pathToFileURL(path.join(API_DIR, "dist/app.factory.js")).href)) as {
    createApiApp(o: { logger: false }): Promise<App>;
  };
  app = await factory.createApiApp({ logger: false });
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as { port: number };
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
  await dbo?.$disconnect();
  await asApp?.$disconnect();
  await asBoot?.$disconnect();
  for (const k of Object.keys(process.env)) if (!(k in ENV_BACKUP)) delete process.env[k];
  Object.assign(process.env, ENV_BACKUP);
});

describe("before the designation", () => {
  it("has no owner, and the super admin holds no God Mode (K1)", async () => {
    expect(await dbo.systemOwner.count()).toBe(0);
    const res = await root.call("GET", "/owner/overview");
    expectError(res, 404, "NOT_FOUND");
    const denied = await lastAudit("owner.access_denied");
    expect(denied).toMatchObject({
      actorUserId: root.userId,
      outcome: "DENIED",
      stream: "PROTECTED",
    });
    expect(denied?.chainSeq).toBe(1n);
    expect(denied?.prevHash).toBe("0".repeat(64));
  });

  it("keeps the new tables and functions away from the API's role (condition 1)", async () => {
    await rejectsDb(
      asApp.$executeRaw`INSERT INTO "SystemOwner" ("userId", "designationId") VALUES (${root.userId}::uuid, ${root.userId}::uuid)`,
      /permission denied/,
    );
    await rejectsDb(asApp.systemOwnerDesignation.findMany(), /permission denied/);
    await rejectsDb(
      asApp.$queryRaw`SELECT iam_owner_designation_start(${root.userId}::uuid, ${"a".repeat(64)}, ${"a valid reason"})`,
      /permission denied/,
    );
    await rejectsDb(
      asApp.$queryRaw`SELECT iam_owner_recover(${root.userId}::uuid, ${"a".repeat(64)}, ${"a valid reason"})`,
      /permission denied/,
    );
    await rejectsDb(
      asBoot.$queryRaw`SELECT iam_owner_designation_confirm(${root.userId}::uuid, ${"a".repeat(64)}, ${"r"})`,
      /permission denied/,
    );
    // Even the table owner cannot insert outside the confirmation function.
    await rejectsDb(
      dbo.$executeRaw`INSERT INTO "SystemOwner" ("userId", "designationId") VALUES (${root.userId}::uuid, ${root.userId}::uuid)`,
      /designated only through iam_owner_designation_confirm/,
    );
    // The CLI refuses the API's credential for the owner commands.
    const viaApp = cli(["owner-status", "--confirm-database", DB_NAME], {
      IAM_BOOTSTRAP_DATABASE_URL: urls.app,
    });
    expect(viaApp.status).not.toBe(0);
    expect(viaApp.err).toMatch(/must run as dp_iam_bootstrap/);
    expect(ownerCli(["owner-status"]).out).toMatch(/no system owner is designated/);
  });

  it("refuses system_owner as a role for everyone, the table owner included (condition 6)", async () => {
    const role = await dbo.role.findUniqueOrThrow({ where: { key: "system_owner" } });
    await rejectsDb(
      dbo.roleAssignment.create({
        data: {
          userId: editor.userId,
          roleId: role.id,
          scopeType: "PLATFORM",
          grantedById: root.userId,
          reason: "x",
        },
      }),
      /system_owner is not an assignable role/,
    );
    const res = await root.call("POST", `/staff/${editor.userId}/roles`, {
      roleKey: "system_owner",
    });
    expectError(res, 403, "FORBIDDEN");
    const list = StaffListResponseSchema.parse((await root.call("GET", "/staff")).body);
    expect(list.roles.map((r) => r.key)).not.toContain("system_owner");
  });
});

describe("designation (CLI as dp_iam_bootstrap, confirmation with token, password and step-up)", () => {
  let token = "";

  it("refuses an unknown or ineligible account and a short reason, audited", async () => {
    const unknown = ownerCli([
      "owner-designate",
      "--email",
      "nobody@staff.dp.test",
      "--reason",
      "owner of the platform",
    ]);
    expect(unknown.status).not.toBe(0);
    expect(unknown.err).toMatch(/no staff account/);
    expect(await lastAudit("owner.designation_started")).toMatchObject({
      outcome: "DENIED",
      stream: "PROTECTED",
    });
    const short = ownerCli([
      "owner-designate",
      "--email",
      "root@staff.dp.test",
      "--reason",
      "short",
    ]);
    expect(short.status).not.toBe(0);
    expect(short.err).toMatch(/at least 10 characters/);
  });

  it("prints a single-use link and stores only the token hash", async () => {
    const r = ownerCli([
      "owner-designate",
      "--email",
      "root@staff.dp.test",
      "--reason",
      "Platform owner, confirmed in person",
    ]);
    expect(r.status, r.err).toBe(0);
    const m = /\/owner\/confirm#t=([A-Za-z0-9_-]{43})/.exec(r.out);
    expect(m, r.out).not.toBeNull();
    token = m![1]!;
    const d = await dbo.systemOwnerDesignation.findFirstOrThrow({ where: { userId: root.userId } });
    expect(d.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(r.out).not.toContain(d.tokenHash);
    expect(await dbo.systemOwner.count()).toBe(0);
  });

  it("is confirmed only by that user, with a fresh step-up, the password and the token", async () => {
    // Another administrator with the right token: the designation is not for them.
    expectError(
      await admin2.call("POST", "/owner/designation/confirm", { token, password: PASSWORD }),
      400,
      "AUTH_TOKEN_INVALID",
    );
    const stale = new Staff("root-stale", root.userId, await session(root.userId, null));
    expectError(
      await stale.call("POST", "/owner/designation/confirm", { token, password: PASSWORD }),
      403,
      "AUTH_STEP_UP_REQUIRED",
    );
    expectError(
      await root.call("POST", "/owner/designation/confirm", { token, password: "wrong password" }),
      401,
      "AUTH_INVALID_CREDENTIALS",
    );
    expectError(
      await root.call("POST", "/owner/designation/confirm", {
        token: randomBytes(32).toString("base64url"),
        password: PASSWORD,
      }),
      400,
      "AUTH_TOKEN_INVALID",
    );
    const d = await dbo.systemOwnerDesignation.findFirstOrThrow({ where: { userId: root.userId } });
    expect(d.failedAttempts).toBe(1);
    expect(await dbo.systemOwner.count()).toBe(0);

    const ok = await root.call("POST", "/owner/designation/confirm", { token, password: PASSWORD });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({ designated: true });
    const owner = await dbo.systemOwner.findFirstOrThrow();
    expect(owner.userId).toBe(root.userId);
    expect(await lastAudit("owner.designated")).toMatchObject({
      actorUserId: root.userId,
      stream: "PROTECTED",
      outcome: "SUCCESS",
    });
    expect(ownerCli(["owner-status"]).out).toMatch(/system owner: r\*\*\*@staff\.dp\.test/);
    // DP-110: the session tells each user only whether it is the owner itself.
    const sessionOf = async (token: string) =>
      (
        await fetch(`${base}/api/v1/auth/staff/session`, {
          headers: {
            "x-dp-proxy-key": TEST_KEYS.admin,
            "x-dp-client-ip": "10.20.30.41",
            cookie: `__Host-dp_admin_session=${token}`,
          },
        })
      ).json() as Promise<{ isSystemOwner?: boolean }>;
    expect((await sessionOf(await session(root.userId))).isSystemOwner).toBe(true);
    expect((await sessionOf(await session(admin2.userId))).isSystemOwner).toBe(false);
  });

  it("happens once: no second designation, no change, no removal (non-transferable)", async () => {
    const again = ownerCli([
      "owner-designate",
      "--email",
      "admin2@staff.dp.test",
      "--reason",
      "Attempt to hand the platform on",
    ]);
    expect(again.status).not.toBe(0);
    expect(again.err).toMatch(/already designated and cannot be changed/);
    expectError(
      await root.call("POST", "/owner/designation/confirm", { token, password: PASSWORD }),
      409,
      "CONFLICT_STATE",
    );
    await rejectsDb(
      dbo.$executeRaw`UPDATE "SystemOwner" SET "userId" = ${admin2.userId}::uuid`,
      /cannot be changed, handed on or removed/,
    );
    await rejectsDb(
      dbo.$executeRaw`DELETE FROM "SystemOwner"`,
      /cannot be changed, handed on or removed/,
    );
    await rejectsDb(dbo.$executeRaw`DELETE FROM "SystemOwnerDesignation"`, /evidence/);
    expect((await dbo.systemOwner.findFirstOrThrow()).userId).toBe(root.userId);
  });
});

describe("God Mode through decide (condition 5)", () => {
  it("opens the owner console to the owner only; everyone else gets 404", async () => {
    const res = await root.call("GET", "/owner/overview");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const overview = OwnerOverviewResponseSchema.parse(res.body);
    expect(overview.owner.id).toBe(root.userId);
    expect(overview.chain.intact).toBe(true);
    expect(overview.modules.find((m) => m.key === "crm")?.sites.every((s) => !s.enabled)).toBe(
      true,
    );
    for (const who of [admin2, editor]) {
      expectError(await who.call("GET", "/owner/overview"), 404, "NOT_FOUND");
      expectError(await who.call("GET", "/owner/audit"), 404, "NOT_FOUND");
      expectError(
        await who.call("POST", `/owner/modules/crm/sites/${BV}`, { enabled: true, reason: "try" }),
        404,
        "NOT_FOUND",
      );
    }
  });

  it("switches optional modules with a reason and the step-up; core modules stay on (K1, condition 4)", async () => {
    const stale = new Staff("root-stale2", root.userId, await session(root.userId, null));
    expectError(
      await stale.call("POST", `/owner/modules/crm/sites/${BV}`, {
        enabled: true,
        reason: "pilot",
      }),
      403,
      "AUTH_STEP_UP_REQUIRED",
    );
    const on = await root.call("POST", `/owner/modules/crm/sites/${BV}`, {
      enabled: true,
      reason: "CRM pilot on BV",
    });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    const changed = OwnerModuleChangeResponseSchema.parse(on.body);
    expect(changed.changed).toBe(true);
    expect(changed.module.sites.find((s) => s.siteId === BV)).toMatchObject({
      enabled: true,
      reason: "CRM pilot on BV",
    });
    const same = OwnerModuleChangeResponseSchema.parse(
      (
        await root.call("POST", `/owner/modules/crm/sites/${BV}`, {
          enabled: true,
          reason: "again",
        })
      ).body,
    );
    expect(same.changed).toBe(false);
    const off = await root.call("POST", `/owner/modules/crm/sites/${BV}`, {
      enabled: false,
      reason: "Pilot finished",
    });
    expect(OwnerModuleChangeResponseSchema.parse(off.body).changed).toBe(true);
    const core = await root.call("POST", `/owner/modules/audit/sites/${BV}`, {
      enabled: false,
      reason: "should never work",
    });
    expectError(core, 400, "VALIDATION_FAILED");
    expect(await lastAudit("owner.module_changed")).toMatchObject({
      stream: "PROTECTED",
      outcome: "DENIED",
      reason: "core_module",
    });
    expectError(
      await root.call("POST", `/owner/modules/nope/sites/${BV}`, {
        enabled: true,
        reason: "x x x",
      }),
      404,
      "NOT_FOUND",
    );
  });

  it("lets the owner give the super admin role, shown as granted by System (K2)", async () => {
    const newcomer = await staff(
      "newcomer",
      (await dbo.user.findUniqueOrThrow({ where: { id: root.userId } })).passwordHash!,
      [],
      null,
    );
    const res = await root.call("POST", `/staff/${newcomer.userId}/roles`, {
      roleKey: "platform_super_admin",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const list = StaffListResponseSchema.parse((await admin2.call("GET", "/staff")).body);
    const row = list.staff.find((s) => s.id === newcomer.userId);
    expect(row?.roles.find((r) => r.roleKey === "platform_super_admin")?.grantedBy).toBe("System");
    // The owner's role change is in the protected stream.
    expect(await lastAudit("iam.role_assigned")).toMatchObject({
      actorUserId: root.userId,
      stream: "PROTECTED",
    });
  });
});

describe("the owner account is out of the super admin's reach (condition 7)", () => {
  it("hides the owner from the staff screen", async () => {
    for (const viewer of [admin2, root]) {
      const list = StaffListResponseSchema.parse((await viewer.call("GET", "/staff")).body);
      expect(list.staff.map((s) => s.id)).not.toContain(root.userId);
      expect(list.staff.map((s) => s.id)).toContain(admin2.userId);
    }
  });

  it("answers 404 to every administration action on the owner, audited in the protected stream", async () => {
    const rootAssignment = await dbo.roleAssignment.findFirstOrThrow({
      where: { userId: root.userId, revokedAt: null },
    });
    const why = "takeover attempt by another administrator";
    const attempts: [string, unknown][] = [
      [`/users/${root.userId}/suspend`, { reason: why }],
      [`/users/${root.userId}/suspend`, { reason: why, siteId: BV }],
      [`/users/${root.userId}/deactivate`, { reason: why, confirmEmail: "root@staff.dp.test" }],
      [`/users/${root.userId}/mfa-reset`, { reason: why, verificationMethod: "in_person" }],
      [`/users/${root.userId}/sessions/revoke`, { reason: why }],
      [`/users/${root.userId}/unlock`, { reason: why }],
      [`/users/${root.userId}/reactivate`, { reason: why }],
      [`/users/${root.userId}/enrolment-link`, {}],
      [`/staff/${root.userId}/roles`, { roleKey: "content_editor", siteId: BV }],
      [`/role-assignments/${rootAssignment.id}/revoke`, { reason: why }],
    ];
    for (const [p, body] of attempts) {
      expectError(await admin2.call("POST", p, body), 404, "NOT_FOUND");
    }
    const user = await dbo.user.findUniqueOrThrow({ where: { id: root.userId } });
    expect(user.status).toBe("ACTIVE");
    expect(user.mfaEnrolledAt).not.toBeNull();
    const still = await dbo.roleAssignment.findUniqueOrThrow({ where: { id: rootAssignment.id } });
    expect(still.revokedAt).toBeNull();
    const denials = await dbo.auditEvent.findMany({
      where: {
        actorUserId: admin2.userId,
        outcome: "DENIED",
        occurredAt: { gte: new Date(Date.now() - 60_000) },
      },
    });
    expect(denials.length).toBeGreaterThan(0);
    expect(
      denials.every((e) => e.stream === "PROTECTED"),
      JSON.stringify(denials.map((e) => [e.action, e.stream])),
    ).toBe(true);
  });

  it("refuses the same changes in the database for the API's role", async () => {
    const id = root.userId;
    await rejectsDb(
      asApp.user.update({ where: { id }, data: { status: "SUSPENDED" } }),
      /cannot be suspended or closed/,
    );
    await rejectsDb(
      asApp.user.update({ where: { id }, data: { status: "DEACTIVATED" } }),
      /cannot be suspended or closed/,
    );
    await rejectsDb(
      asApp.user.update({ where: { id }, data: { status: "PENDING" } }),
      /owner recovery/,
    );
    await rejectsDb(
      asApp.user.update({ where: { id }, data: { passwordHash: null } }),
      /owner recovery/,
    );
    await rejectsDb(
      asApp.user.update({ where: { id }, data: { mfaEnrolledAt: null } }),
      /owner recovery/,
    );
    await rejectsDb(
      asApp.user.update({
        where: { id },
        data: { email: "x@staff.dp.test", emailNormalized: "x@staff.dp.test" },
      }),
      /e-mail cannot be changed/,
    );
    await rejectsDb(
      asApp.mfaFactor.deleteMany({ where: { userId: id } }),
      /MFA factor is reset only/,
    );
    for (const purpose of [
      "PASSWORD_RESET",
      "ADMIN_RECOVERY",
      "MFA_REENROLMENT",
      "ADMIN_ENROLMENT",
    ] as const) {
      await rejectsDb(
        asApp.userCredentialToken.create({
          data: {
            userId: id,
            purpose,
            tokenHash: randomBytes(32).toString("hex"),
            securityVersion: 0,
            app: "ADMIN",
            expiresAt: new Date(Date.now() + 60_000),
            createdByType: "SYSTEM",
          },
        }),
        /credential links for the system owner/,
      );
    }
    const role = await dbo.role.findUniqueOrThrow({ where: { key: "content_editor" } });
    // DP-125: dp_app writes role assignments only in a staff context (row-level security); in the
    // super admin's own context, which may write them, the owner guards still refuse.
    const adminToken = await session(admin2.userId);
    const asAdmin = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      asApp.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT leads_rls_set_staff_context(${adminToken})`;
        return fn(tx);
      });
    await rejectsDb(
      asAdmin((tx) =>
        tx.roleAssignment.create({
          data: {
            userId: id,
            roleId: role.id,
            scopeType: "SITE",
            siteId: BV,
            grantedById: admin2.userId,
            reason: "x",
          },
        }),
      ),
      /no role can be assigned to the system owner/,
    );
    await rejectsDb(
      asAdmin((tx) =>
        tx.roleAssignment.updateMany({
          where: { userId: id },
          data: { revokedAt: new Date(), revokedById: admin2.userId },
        }),
      ),
      /role assignments cannot be changed/,
    );
    await rejectsDb(
      asApp.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "ADMIN_REVOKED" },
      }),
      /cannot be revoked by an administrator/,
    );
    // The operator commands that use the API's credential refuse the owner as well.
    for (const command of [
      ["recover-admin", "--reason", "lost everything, verified in person"],
      ["reset-link"],
      ["enrol-link"],
    ]) {
      const r = cli(
        [
          command[0]!,
          "--email",
          "root@staff.dp.test",
          ...command.slice(1),
          "--confirm-database",
          DB_NAME,
        ],
        {
          DATABASE_URL: urls.app,
        },
      );
      expect(r.status, command[0]).not.toBe(0);
      expect(r.err).toMatch(/system owner account; use iam-cli owner-recover/);
    }
  });
});

describe("the PROTECTED audit stream (conditions 2 and 3)", () => {
  it("files owner events and events about the owner as PROTECTED, others as STANDARD; the caller cannot choose", async () => {
    await asApp.auditEvent.createMany({
      data: [
        {
          actorType: "USER",
          actorUserId: editor.userId,
          action: "test.unrelated",
          resourceType: "content",
          scopeType: "PLATFORM",
          outcome: "SUCCESS",
          stream: "PROTECTED",
          chainSeq: 999n,
          prevHash: "f".repeat(64),
          rowHash: "f".repeat(64),
        },
        {
          actorType: "SYSTEM",
          action: "test.about_owner",
          resourceType: "user",
          resourceId: root.userId,
          scopeType: "PLATFORM",
          outcome: "SUCCESS",
        },
      ],
    });
    const unrelated = await lastAudit("test.unrelated");
    expect(unrelated).toMatchObject({ stream: "STANDARD", chainSeq: null, rowHash: null });
    const about = await lastAudit("test.about_owner");
    expect(about?.stream).toBe("PROTECTED");
    // Database-generated events about the owner (db.*) are protected too.
    const dbEvents = await dbo.auditEvent.findMany({
      where: { action: { startsWith: "db." }, metadata: { path: ["userId"], equals: root.userId } },
    });
    expect(dbEvents.length).toBeGreaterThan(0);
    // Earlier fixture events stay as they were: nothing is reclassified.
    expect(await dbo.auditEvent.count({ where: { stream: "STANDARD" } })).toBeGreaterThan(0);
  });

  it("lists only PROTECTED events to the owner, newest first, with paging", async () => {
    const first = await root.call("GET", "/owner/audit?limit=3");
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const page = ProtectedAuditListResponseSchema.parse(first.body);
    expect(page.items).toHaveLength(3);
    expect(page.items[0]!.chainSeq).toBeGreaterThan(page.items[2]!.chainSeq);
    expect(page.nextBefore).toBe(page.items[2]!.chainSeq);
    const second = ProtectedAuditListResponseSchema.parse(
      (await root.call("GET", `/owner/audit?limit=3&before=${page.nextBefore}`)).body,
    );
    expect(second.items[0]!.chainSeq).toBeLessThan(page.items[2]!.chainSeq);
    const all = await dbo.auditEvent.count({ where: { stream: "PROTECTED" } });
    expect(all).toBeGreaterThan(5);
    const owned = page.items.filter((e) => e.actorUserId === root.userId);
    for (const e of owned) expect(e.actorLabel).toBe("System owner");
    expectError(await root.call("GET", "/owner/audit?limit=500"), 400, "VALIDATION_FAILED");
  });

  it("keeps PROTECTED events out of the site-scoped client and immutable for the API", async () => {
    const dist = (await import(
      pathToFileURL(path.join(API_DIR, "dist/iam/site-scope.js")).href
    )) as {
      withSiteScope(
        p: PrismaClient,
        s: { siteIds: string[]; includePlatform: boolean },
      ): PrismaClient;
    };
    // The first line on its own (the site scope hides the PROTECTED stream), over the owner: under
    // DP-125 dp_app sees audit rows only in a staff context (DP-125 block below).
    const scoped = dist.withSiteScope(dbo, { siteIds: [BV], includePlatform: true });
    const seen = await scoped.auditEvent.findMany({ select: { stream: true } });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((e) => e.stream === "STANDARD")).toBe(true);
    await rejectsDb(
      asApp.auditEvent.updateMany({ where: { stream: "PROTECTED" }, data: { reason: "x" } }),
      /permission denied|append-only/,
    );
    await rejectsDb(
      asApp.auditEvent.deleteMany({ where: { stream: "PROTECTED" } }),
      /permission denied|append-only/,
    );
  });

  it("verifies the hash chain and detects a tampered event", async () => {
    const ok = await root.call("GET", "/owner/audit/verify");
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const status = OwnerChainStatusSchema.parse(ok.body);
    expect(status).toMatchObject({ intact: true, firstBrokenSeq: null });
    expect(status.headHash).toMatch(/^[0-9a-f]{64}$/);

    // Only a database superuser can get past the append-only triggers; the chain still shows it.
    const su = new PrismaClient({ adapter: new PrismaPg({ connectionString: urls.su }) });
    try {
      await su.$transaction([
        su.$executeRaw`ALTER TABLE "AuditEvent" DISABLE TRIGGER "AuditEvent_append_only"`,
        su.$executeRaw`UPDATE "AuditEvent" SET "reason" = 'rewritten' WHERE "chainSeq" = 2`,
        su.$executeRaw`ALTER TABLE "AuditEvent" ENABLE TRIGGER "AuditEvent_append_only"`,
      ]);
    } finally {
      await su.$disconnect();
    }
    const broken = OwnerChainStatusSchema.parse(
      (await root.call("GET", "/owner/audit/verify")).body,
    );
    expect(broken).toMatchObject({ intact: false, firstBrokenSeq: 2 });
    expect(await lastAudit("owner.audit_chain_verified")).toMatchObject({
      outcome: "FAILURE",
      reason: "chain_broken",
    });
  });
});

describe("owner recovery (CLI as dp_iam_bootstrap only)", () => {
  it("refuses anyone but the owner", () => {
    const r = ownerCli([
      "owner-recover",
      "--email",
      "admin2@staff.dp.test",
      "--reason",
      "not the owner, must be refused",
    ]);
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/only for the system owner account/);
  });

  it("resets password and MFA, ends sessions and links, and keeps the ownership", async () => {
    const before = await dbo.user.findUniqueOrThrow({ where: { id: root.userId } });
    const r = ownerCli([
      "owner-recover",
      "--email",
      "root@staff.dp.test",
      "--reason",
      "Lost phone and password, verified in person",
    ]);
    expect(r.status, r.err).toBe(0);
    const m = /\/enrol#t=([A-Za-z0-9_-]{43})/.exec(r.out);
    expect(m, r.out).not.toBeNull();
    const user = await dbo.user.findUniqueOrThrow({ where: { id: root.userId } });
    expect(user).toMatchObject({ status: "PENDING", passwordHash: null, mfaEnrolledAt: null });
    expect(user.securityVersion).toBe(before.securityVersion + 1);
    expect(await dbo.session.count({ where: { userId: root.userId, revokedAt: null } })).toBe(0);
    expect(await dbo.mfaRecoveryCode.count({ where: { userId: root.userId, usedAt: null } })).toBe(
      0,
    );
    const link = await dbo.userCredentialToken.findUniqueOrThrow({
      where: { tokenHash: createHash("sha256").update(m![1]!).digest("hex") },
    });
    expect(link).toMatchObject({
      purpose: "ADMIN_RECOVERY",
      createdByType: "BOOTSTRAP",
      app: "ADMIN",
    });
    expect(link.securityVersion).toBe(user.securityVersion);
    expect((await dbo.systemOwner.findFirstOrThrow()).userId).toBe(root.userId);
    expect(await lastAudit("owner.recovery_issued")).toMatchObject({
      stream: "PROTECTED",
      outcome: "SUCCESS",
    });
  });

  it("DP-114: the owner re-enrols through the /enrol endpoints and signs in again; ownership stays", async () => {
    // The link of the previous test was printed once; a fresh recovery replaces it (NT-K3).
    const r = ownerCli([
      "owner-recover",
      "--email",
      "root@staff.dp.test",
      "--reason",
      "Second recovery for the enrolment page test",
    ]);
    expect(r.status, r.err).toBe(0);
    const token = /\/enrol#t=([A-Za-z0-9_-]{43})/.exec(r.out)?.[1] as string;
    expect(token).toBeDefined();

    const enrol = async (p: string, body: unknown) => {
      const res = await parse(
        await fetch(`${base}/api/v1/auth/staff/enrol/${p}`, {
          method: "POST",
          headers: {
            "x-dp-proxy-key": TEST_KEYS.admin,
            "x-dp-client-ip": "10.20.30.42",
            origin: ADMIN_ORIGIN,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
      return res;
    };

    const inspect = await enrol("inspect", { token });
    expect(inspect.status).toBe(200);
    expect(EnrolInspectResponseSchema.parse(inspect.body)).toMatchObject({
      kind: "recovery",
      emailMasked: "r***@staff.dp.test",
      steps: [
        { step: "password", done: false },
        { step: "mfa", done: false },
      ],
    });
    expect(Date.parse(inspect.body.expiresAt)).toBeGreaterThan(Date.now());

    const newPassword = `owner-recovered-${randomBytes(12).toString("base64url")}`;
    expect((await enrol("password", { token, password: newPassword })).status).toBe(204);
    const setup = await enrol("mfa/setup", { token });
    expect(setup.status).toBe(200);
    const key = base32Decode(EnrolMfaSetupResponseSchema.parse(setup.body).secret);
    const wrong = String((Number(totpCode(key, new Date())) + 500_000) % 1_000_000).padStart(
      6,
      "0",
    );
    expectError(await enrol("mfa/confirm", { token, code: wrong }), 401, "AUTH_MFA_INVALID");
    const confirm = await enrol("mfa/confirm", { token, code: totpCode(key, new Date()) });
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);
    expect(EnrolMfaConfirmResponseSchema.parse(confirm.body).recoveryCodes).toHaveLength(10);

    // Single use: the spent link is refused everywhere, also for a second confirmation.
    expectError(await enrol("inspect", { token }), 400, "AUTH_TOKEN_INVALID");
    expectError(
      await enrol("mfa/confirm", { token, code: totpCode(key, new Date()) }),
      400,
      "AUTH_TOKEN_INVALID",
    );

    const user = await dbo.user.findUniqueOrThrow({ where: { id: root.userId } });
    expect(user.status).toBe("ACTIVE");
    expect(user.mfaEnrolledAt).not.toBeNull();
    expect(await dbo.mfaFactor.count({ where: { userId: root.userId } })).toBe(1);
    expect(await dbo.mfaRecoveryCode.count({ where: { userId: root.userId, usedAt: null } })).toBe(
      10,
    );
    // Recovery does not move God Mode, and the activation reveals no secret in the audit trail.
    expect((await dbo.systemOwner.findFirstOrThrow()).userId).toBe(root.userId);
    const trail = JSON.stringify(
      await dbo.auditEvent.findMany({ where: { resourceId: root.userId } }),
      (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
    );
    for (const secret of [token, newPassword, ...confirm.body.recoveryCodes]) {
      expect(trail).not.toContain(secret);
    }

    // Normal sign-in with the new password and the new authenticator (next 30 s step).
    const login = await fetch(`${base}/api/v1/auth/staff/login`, {
      method: "POST",
      headers: {
        "x-dp-proxy-key": TEST_KEYS.admin,
        "x-dp-client-ip": "10.20.30.42",
        origin: ADMIN_ORIGIN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "root@staff.dp.test", password: newPassword }),
    });
    expect(login.status).toBe(200);
    const challenge = /__Host-dp_admin_challenge=[^;]+/.exec(
      login.headers.get("set-cookie") ?? "",
    )?.[0];
    expect(challenge).toBeDefined();
    const mfa = await fetch(`${base}/api/v1/auth/staff/login/mfa`, {
      method: "POST",
      headers: {
        "x-dp-proxy-key": TEST_KEYS.admin,
        "x-dp-client-ip": "10.20.30.42",
        origin: ADMIN_ORIGIN,
        "content-type": "application/json",
        cookie: challenge as string,
      },
      body: JSON.stringify({ code: totpCode(key, new Date(Date.now() + 30_000)) }),
    });
    expect(mfa.status, await mfa.clone().text()).toBe(204);
    expect(mfa.headers.get("set-cookie") ?? "").toMatch(/__Host-dp_admin_session=/);

    // Back to normal: the owner guards hold again.
    await rejectsDb(
      asApp.mfaFactor.deleteMany({ where: { userId: root.userId } }),
      /MFA factor is reset only/,
    );
    await rejectsDb(
      asApp.user.update({ where: { id: root.userId }, data: { status: "SUSPENDED" } }),
      /cannot be suspended or closed/,
    );
  });
});

// DP-103 (ADR-012B): God Mode reads the leads of every site through an explicit policy branch
// (the SystemOwner record), not BYPASSRLS; the database context is the owner's own session.
describe("DP-103: the owner's lead access under row-level security", () => {
  it("opens every site's leads to the owner's session, explicitly and audited", async () => {
    const COM = (await dbo.site.findFirstOrThrow({ where: { key: "CORPORATE" } })).id;
    for (const [siteId, email] of [
      [BV, "god.bv@firm.example"],
      [COM, "god.com@firm.example"],
    ] as const) {
      await dbo.lead.create({
        data: { siteId, email, fullName: "God Probe", company: "Firm", country: "NL" },
      });
    }
    const sitesOf = async (token: string) =>
      asApp.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT leads_rls_set_staff_context(${token})`;
        return (await tx.lead.findMany({ select: { siteId: true } })).map((l) => l.siteId).sort();
      });
    // Take away every role of the owner (last block of this file): the SystemOwner record alone
    // must open the leads, through the policy's explicit owner branch.
    await dbo.roleAssignment.updateMany({
      where: { userId: root.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: admin2.userId },
    });
    expect(
      await dbo.roleAssignment.count({ where: { userId: root.userId, revokedAt: null } }),
    ).toBe(0);
    expect(await sitesOf(await session(root.userId))).toEqual([BV, COM].sort());
    // The super admin reads every site through its role, a content editor nothing.
    expect(await sitesOf(await session(admin2.userId))).toEqual([BV, COM].sort());
    expect(await sitesOf(await session(editor.userId))).toEqual([]);
    // Without a context, dp_app sees nothing, owner or not.
    expect(await asApp.lead.count()).toBe(0);
    const viewer = new Staff("root", root.userId, await session(root.userId));
    const res = await viewer.call("GET", "/leads");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.items.map((l: { email: string }) => l.email).sort()).toEqual([
      "god.bv@firm.example",
      "god.com@firm.example",
    ]);
    // The owner's read is audited in the PROTECTED stream (DP-108).
    expect(await lastAudit("leads.list_viewed")).toMatchObject({
      actorUserId: root.userId,
      stream: "PROTECTED",
    });
  });
});

// DP-125 (ADR-012B part 2): row-level security on the IAM site tables. The probes run raw SQL as
// dp_app (the API's role), inside a transaction with the staff context of a real admin session,
// exactly as src/iam/iam-context.ts does it, plus the admin flows over HTTP.
describe("DP-125: row-level security on the IAM tables", () => {
  let COM: string;
  let padmin: Staff; // platform super admin granted by admin2
  let bvAdmin: Staff; // site_admin of BV granted by padmin (padmin's grant is invisible to it)
  let comAdmin: Staff; // site_admin of CORPORATE
  let dual: Staff; // content_editor on BV and site_admin on CORPORATE
  let sales: Staff; // sales_crm_user on BV
  const tok = new Map<string, string>(); // userId -> raw session token
  let su: PrismaClient;
  let hash: string;
  const ROLLBACK = new Error("rollback");

  type Tx = Prisma.TransactionClient;
  /** dp_app inside one transaction with the staff context of `token` (null: no context). */
  function inCtx<T>(token: string | null, fn: (tx: Tx) => Promise<T>, client = asApp): Promise<T> {
    return client.$transaction(async (tx) => {
      if (token !== null) await tx.$executeRaw`SELECT leads_rls_set_staff_context(${token})`;
      return fn(tx);
    });
  }
  /** Runs `fn` and rolls the transaction back; resolves to what `fn` returned. */
  async function tryInCtx<T>(token: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    let out: T | undefined;
    await inCtx(token, async (tx) => {
      out = await fn(tx);
      throw ROLLBACK;
    }).catch((e: unknown) => {
      if (e !== ROLLBACK) throw e;
    });
    return out as T;
  }
  const counts = (tx: Tx) =>
    Promise.all([
      tx.membership.count(),
      tx.roleAssignment.count(),
      tx.moduleConfiguration.count(),
      tx.auditEvent.count(),
      tx.customerDataAccessRequest.count(),
    ]);
  const t = (s: Staff) => tok.get(s.userId)!;
  const auditRow = (o: Record<string, unknown> = {}) => ({
    actorType: "SYSTEM" as const,
    action: "iam.dp125_probe",
    resourceType: "probe",
    scopeType: "PLATFORM" as const,
    outcome: "SUCCESS" as const,
    ...o,
  });

  beforeAll(async () => {
    COM = (await dbo.site.findFirstOrThrow({ where: { key: "CORPORATE" } })).id;
    su = new PrismaClient({ adapter: new PrismaPg({ connectionString: urls.su }) });
    hash = await hashPassword(PASSWORD);
    padmin = await staff("dp125-padmin", hash, [{ role: "platform_super_admin" }], admin2.userId);
    bvAdmin = await staff("dp125-bvadmin", hash, [{ role: "site_admin", site: BV }], padmin.userId);
    comAdmin = await staff(
      "dp125-comadmin",
      hash,
      [{ role: "site_admin", site: COM }],
      admin2.userId,
    );
    dual = await staff(
      "dp125-dual",
      hash,
      [
        { role: "content_editor", site: BV },
        { role: "site_admin", site: COM },
      ],
      admin2.userId,
    );
    sales = await staff("dp125-sales", hash, [{ role: "sales_crm_user", site: BV }], admin2.userId);
    for (const s of [root, admin2, editor, padmin, bvAdmin, comAdmin, dual, sales]) {
      tok.set(s.userId, await session(s.userId));
    }
    // One optional-module state per site and one STANDARD event per site.
    const crm = await dbo.featureModule.findUniqueOrThrow({ where: { key: "crm" } });
    for (const siteId of [BV, COM]) {
      await dbo.moduleConfiguration.upsert({
        where: { moduleId_siteId: { moduleId: crm.id, siteId } },
        create: { moduleId: crm.id, siteId, enabled: false, reason: "DP-125 fixture state" },
        update: {},
      });
      await dbo.auditEvent.create({
        data: auditRow({ scopeType: "SITE", siteId, action: "iam.dp125_site_event" }),
      });
    }
  });

  afterAll(async () => {
    await su?.$disconnect();
  });

  it("shows dp_app no IAM row without a live context: missing, stale, forged or dead session", async () => {
    const all = await Promise.all([
      dbo.membership.count(),
      dbo.roleAssignment.count(),
      dbo.moduleConfiguration.count(),
      dbo.auditEvent.count(),
    ]);
    expect(all.every((n) => n > 0)).toBe(true);
    // No transaction, no context, the stored hash, random and malformed tokens.
    expect(await counts(asApp as unknown as Tx)).toEqual([0, 0, 0, 0, 0]);
    expect(await inCtx(null, counts)).toEqual([0, 0, 0, 0, 0]);
    const stored = createHash("sha256").update(t(admin2)).digest("hex");
    for (const forged of [
      stored,
      randomBytes(32).toString("base64url"),
      "' OR 1=1 --",
      "",
      `${t(admin2)}x`,
    ]) {
      expect(await inCtx(forged, counts), forged).toEqual([0, 0, 0, 0, 0]);
    }
    // A revoked, an idle-expired session and a suspended user open nothing either.
    const revoked = await session(admin2.userId);
    await dbo.session.updateMany({
      where: { tokenHash: createHash("sha256").update(revoked).digest("hex") },
      data: { revokedAt: new Date(), revokedReason: "LOGOUT" },
    });
    expect(await inCtx(revoked, counts)).toEqual([0, 0, 0, 0, 0]);
    const idle = await session(admin2.userId);
    await dbo.session.updateMany({
      where: { tokenHash: createHash("sha256").update(idle).digest("hex") },
      data: { idleExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await inCtx(idle, counts)).toEqual([0, 0, 0, 0, 0]);
    // A context value that outlives its transaction (session-level set_config by mistake) is
    // stale in the next transaction of the same pooled connection.
    const single = new PrismaClient({
      adapter: new PrismaPg({ connectionString: urls.app, max: 1 }),
    });
    try {
      await single.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('dp.lead_staff_session', ${t(admin2)}, false)`;
        await tx.$executeRaw`SELECT set_config('dp.lead_ctx_at', now()::text, false)`;
      });
      expect(await inCtx(null, counts, single)).toEqual([0, 0, 0, 0, 0]);
      // The same connection with a context, then without one: nothing leaks.
      const [m] = await inCtx(t(admin2), counts, single);
      expect(m).toBeGreaterThan(0);
      expect(await inCtx(null, counts, single)).toEqual([0, 0, 0, 0, 0]);
    } finally {
      await single.$disconnect();
    }
  });

  it("shows a site administrator its own site's rows, never the other site's (cross-site)", async () => {
    const view = await inCtx(t(bvAdmin), async (tx) => ({
      memberships: await tx.membership.findMany({ select: { userId: true, siteId: true } }),
      roles: await tx.roleAssignment.findMany({
        select: { userId: true, siteId: true, scopeType: true },
      }),
      modules: await tx.moduleConfiguration.findMany({ select: { siteId: true } }),
      audit: await tx.auditEvent.findMany({ select: { siteId: true, stream: true } }),
    }));
    expect(view.memberships.length).toBeGreaterThan(0);
    for (const m of view.memberships)
      expect(m.siteId === BV || m.userId === bvAdmin.userId).toBe(true);
    expect(view.roles.some((r) => r.siteId === COM)).toBe(false);
    // dual works on BV: its BV role is visible, its CORPORATE site_admin role is not.
    expect(view.roles.filter((r) => r.userId === dual.userId)).toEqual([
      { userId: dual.userId, siteId: BV, scopeType: "SITE" },
    ]);
    // Platform roles only of staff who work on BV: padmin and admin2 do not.
    const platformHolders = view.roles.filter((r) => r.siteId === null).map((r) => r.userId);
    expect(platformHolders).not.toContain(padmin.userId);
    expect(platformHolders).not.toContain(admin2.userId);
    expect(new Set(view.modules.map((m) => m.siteId))).toEqual(new Set([BV]));
    expect(view.audit.length).toBeGreaterThan(0);
    for (const e of view.audit) expect(e).toEqual({ siteId: BV, stream: "STANDARD" });
    // The other site's administrator, symmetrically.
    const com = await inCtx(t(comAdmin), async (tx) => ({
      m: await tx.membership.findMany({ select: { siteId: true, userId: true } }),
      a: await tx.auditEvent.findMany({ select: { siteId: true } }),
    }));
    for (const m of com.m) expect(m.siteId === COM || m.userId === comAdmin.userId).toBe(true);
    for (const e of com.a) expect(e.siteId).toBe(COM);
    // A content editor administers nobody: its own rows and its site's module states only.
    const ed = await inCtx(t(editor), async (tx) => ({
      m: await tx.membership.findMany({ select: { userId: true } }),
      r: await tx.roleAssignment.findMany({ select: { userId: true } }),
      a: await tx.auditEvent.count(),
    }));
    expect(new Set([...ed.m, ...ed.r].map((x) => x.userId))).toEqual(new Set([editor.userId]));
    expect(ed.a).toBe(0);
  });

  it("gives the platform administrator every STANDARD event and the owner alone the PROTECTED stream", async () => {
    const standard = await dbo.auditEvent.count({ where: { stream: "STANDARD" } });
    const protectedCount = await dbo.auditEvent.count({ where: { stream: "PROTECTED" } });
    expect(protectedCount).toBeGreaterThan(0);
    const admin = await inCtx(t(admin2), async (tx) => ({
      s: await tx.auditEvent.count({ where: { stream: "STANDARD" } }),
      p: await tx.auditEvent.count({ where: { stream: "PROTECTED" } }),
    }));
    expect(admin).toEqual({ s: standard, p: 0 });
    const god = await inCtx(t(root), (tx) =>
      tx.auditEvent.count({ where: { stream: "PROTECTED" } }),
    );
    expect(god).toBe(protectedCount);
    // The chain check sees the stream only in the owner's context: there it finds exactly what the
    // table owner finds (the event tampered with earlier in this file included), elsewhere nothing.
    type Chain = { events: bigint; firstBrokenSeq: bigint | null };
    const chain = (token: string | null) =>
      inCtx(
        token,
        (tx) => tx.$queryRaw<Chain[]>`
          SELECT "events", "firstBrokenSeq" FROM iam_verify_protected_audit_chain()`,
      );
    const full = await dbo.$queryRaw<Chain[]>`
      SELECT "events", "firstBrokenSeq" FROM iam_verify_protected_audit_chain()`;
    expect(full[0]?.events).toBe(BigInt(protectedCount));
    expect((await chain(t(root)))[0]).toEqual(full[0]);
    expect((await chain(t(admin2)))[0]?.events).toBe(0n);
  });

  it("refuses IAM writes outside the context's own sites and without an IAM write permission", async () => {
    const newcomer = (
      await dbo.user.create({
        data: {
          email: "dp125-newcomer@staff.dp.test",
          emailNormalized: "dp125-newcomer@staff.dp.test",
          kind: "STAFF",
          status: "PENDING",
        },
      })
    ).id;
    const editorRole = await dbo.role.findUniqueOrThrow({ where: { key: "content_editor" } });
    const adminRole = await dbo.role.findUniqueOrThrow({ where: { key: "platform_super_admin" } });
    const rls = /row-level security|row level security/;
    // Another site, the platform, no IAM permission, no context: refused by the policies.
    await rejectsDb(
      inCtx(t(bvAdmin), (tx) =>
        tx.membership.create({ data: { userId: newcomer, siteId: COM, status: "INVITED" } }),
      ),
      rls,
    );
    await rejectsDb(
      inCtx(t(bvAdmin), (tx) =>
        tx.roleAssignment.create({
          data: {
            userId: newcomer,
            roleId: editorRole.id,
            scopeType: "SITE",
            siteId: COM,
            grantedById: bvAdmin.userId,
          },
        }),
      ),
      rls,
    );
    await rejectsDb(
      inCtx(t(bvAdmin), (tx) =>
        tx.roleAssignment.create({
          data: {
            userId: newcomer,
            roleId: adminRole.id,
            scopeType: "PLATFORM",
            grantedById: bvAdmin.userId,
          },
        }),
      ),
      rls,
    );
    await rejectsDb(
      inCtx(t(editor), (tx) =>
        tx.membership.create({ data: { userId: newcomer, siteId: BV, status: "INVITED" } }),
      ),
      rls,
    );
    await rejectsDb(
      inCtx(null, (tx) =>
        tx.membership.create({ data: { userId: newcomer, siteId: BV, status: "INVITED" } }),
      ),
      rls,
    );
    // Updates of rows outside the view change nothing (and the row stays as it was).
    const changed = await tryInCtx(t(bvAdmin), async (tx) => ({
      m: (
        await tx.membership.updateMany({
          where: { userId: comAdmin.userId },
          data: { status: "SUSPENDED" },
        })
      ).count,
      r: (
        await tx.roleAssignment.updateMany({
          where: { userId: comAdmin.userId },
          data: { revokedAt: new Date(), revokedById: bvAdmin.userId },
        })
      ).count,
    }));
    expect(changed).toEqual({ m: 0, r: 0 });
    expect(
      await dbo.membership.findFirstOrThrow({ where: { userId: comAdmin.userId, siteId: COM } }),
    ).toMatchObject({ status: "ACTIVE" });
    // The positive control: its own site works (rolled back).
    const own = await tryInCtx(t(bvAdmin), async (tx) => {
      await tx.membership.create({ data: { userId: newcomer, siteId: BV, status: "INVITED" } });
      return tx.membership.count({ where: { userId: newcomer } });
    });
    expect(own).toBe(1);
  });

  it("keeps module switches with the system owner in the database (K4)", async () => {
    const crm = await dbo.featureModule.findUniqueOrThrow({ where: { key: "crm" } });
    const flip = (tx: Tx) =>
      tx.moduleConfiguration.updateMany({
        where: { moduleId: crm.id, siteId: BV },
        data: { enabled: true, reason: "DP-125 probe flip" },
      });
    expect((await tryInCtx(t(admin2), flip)).count).toBe(0);
    expect((await tryInCtx(t(bvAdmin), flip)).count).toBe(0);
    const cms = await dbo.featureModule.findUniqueOrThrow({ where: { key: "automation" } });
    await rejectsDb(
      inCtx(t(admin2), (tx) =>
        tx.moduleConfiguration.create({
          data: { moduleId: cms.id, siteId: COM, enabled: true, reason: "DP-125 forged switch" },
        }),
      ),
      /row-level security|row level security/,
    );
    expect((await tryInCtx(t(root), flip)).count).toBe(1);
    expect(
      await dbo.moduleConfiguration.findFirstOrThrow({ where: { moduleId: crm.id, siteId: BV } }),
    ).toMatchObject({ enabled: false });
  });

  it("controls audit writes: actor bound to the context, operator and owner events, time (K2)", async () => {
    const rls = /row-level security|row level security/;
    const insert = (token: string | null, row: Record<string, unknown>) =>
      tryInCtx(token, (tx) =>
        tx.auditEvent.createMany({ data: [auditRow(row) as Prisma.AuditEventCreateManyInput] }),
      );
    // Inside a context: only as the session's own user.
    await rejectsDb(insert(t(editor), { actorType: "USER", actorUserId: admin2.userId }), rls);
    expect((await insert(t(editor), { actorType: "USER", actorUserId: editor.userId })).count).toBe(
      1,
    );
    // BOOTSTRAP only for the operator actions and never inside a staff context.
    await rejectsDb(insert(null, { actorType: "BOOTSTRAP", action: "iam.bootstrap_admin" }), rls);
    await rejectsDb(
      insert(t(bvAdmin), { actorType: "BOOTSTRAP", action: "iam.enrol_link_issued" }),
      rls,
    );
    expect(
      (await insert(null, { actorType: "BOOTSTRAP", action: "iam.enrol_link_issued" })).count,
    ).toBe(1);
    // owner.* only from the owner's context (refusals excepted).
    await rejectsDb(
      insert(t(admin2), {
        actorType: "USER",
        actorUserId: admin2.userId,
        action: "owner.module_changed",
      }),
      rls,
    );
    await rejectsDb(
      insert(null, { actorType: "USER", actorUserId: root.userId, action: "owner.module_changed" }),
      rls,
    );
    expect(
      (
        await insert(t(root), {
          actorType: "USER",
          actorUserId: root.userId,
          action: "owner.module_changed",
        })
      ).count,
    ).toBe(1);
    expect(
      (
        await insert(t(admin2), {
          actorType: "USER",
          actorUserId: admin2.userId,
          action: "owner.access_denied",
        })
      ).count,
    ).toBe(1);
    // No back- or forward-dating, no SYSTEM event with an actor.
    await rejectsDb(insert(null, { occurredAt: new Date(Date.now() - 86_400_000) }), rls);
    await rejectsDb(insert(null, { occurredAt: new Date(Date.now() + 3_600_000) }), rls);
    await rejectsDb(
      insert(null, { actorUserId: admin2.userId }),
      /row-level security|row level security|check/i,
    );
    // The bootstrap credential writes BOOTSTRAP events only; retention BOOTSTRAP leads.* only.
    await rejectsDb(
      asBoot.auditEvent.createMany({
        data: [
          auditRow({
            actorType: "USER",
            actorUserId: admin2.userId,
          }) as Prisma.AuditEventCreateManyInput,
        ],
      }),
      rls,
    );
    await rejectsDb(
      asBoot.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL ROLE dp_lead_retention`;
        await tx.auditEvent.createMany({
          data: [
            auditRow({
              actorType: "BOOTSTRAP",
              action: "iam.forged",
            }) as Prisma.AuditEventCreateManyInput,
          ],
        });
      }),
      rls,
    );
    // Residual risk, accepted only with DP-129 (R-25): outside any context the database cannot
    // tell a forged USER event from a real login event. The test pins the current behaviour.
    expect(
      (
        await insert(null, {
          actorType: "USER",
          actorUserId: admin2.userId,
          action: "iam.login_succeeded",
        })
      ).count,
    ).toBe(1);
  });

  it("answers the narrow functions only within their scope; dp_app cannot call the internal ones", async () => {
    for (const sql of [
      `SELECT iam_rls_user_sites('${admin2.userId}'::uuid, 'iam_read')`,
      `SELECT iam_rls_user_platform('${admin2.userId}'::uuid, 'iam_read')`,
      `SELECT iam_rls_permission_set('iam_read')`,
      `SELECT leads_rls_user_lead_sites('${admin2.userId}'::uuid, 'lead:read')`,
    ]) {
      await rejectsDb(asApp.$queryRawUnsafe(sql), /permission denied/);
    }
    const probe = (token: string | null) =>
      inCtx(token, async (tx) => {
        const [r] = await tx.$queryRaw<
          {
            sites: string[];
            platform: boolean;
            owner: boolean;
            admins: bigint | null;
            qualified: bigint | null;
            ancestry: string[];
          }[]
        >`SELECT iam_rls_staff_sites('iam_read')::text[] AS sites,
                 iam_rls_staff_platform('iam_read') AS platform, iam_rls_staff_is_owner() AS owner,
                 iam_rls_platform_admin_count(NULL, false) AS admins,
                 iam_rls_qualified_admin_count('{}'::uuid[]) AS qualified,
                 iam_rls_my_grant_ancestry()::text[] AS ancestry`;
        const target = (id: string) =>
          tx.$queryRaw<{ role_key: string | null; site_id: string | null }[]>`
            SELECT role_key, site_id::text AS site_id FROM iam_rls_admin_target(${id}::uuid)
            WHERE row_kind = 'grant' ORDER BY role_key`;
        return {
          ...r!,
          dual: await target(dual.userId),
          comAdmin: await target(comAdmin.userId),
          open: (
            await tx.$queryRaw<{ open_roles: bigint | null }[]>`
            SELECT open_roles FROM iam_rls_user_open_rows(${dual.userId}::uuid)`
          )[0]?.open_roles,
          operator: (
            await tx.$queryRaw<unknown[]>`
            SELECT * FROM iam_operator_admin_state(${admin2.userId}::uuid)`
          ).length,
          assignees: await tx.$queryRaw<{ site_id: string }[]>`
            SELECT DISTINCT site_id::text AS site_id FROM leads_rls_assignable_staff(${[BV, COM]}::uuid[])`,
        };
      });
    const none = await probe(null);
    expect(none).toMatchObject({
      sites: [],
      platform: false,
      owner: false,
      admins: null,
      qualified: null,
      ancestry: [],
      dual: [],
      comAdmin: [],
      open: null,
      operator: 1, // the operator CLI has no session: it gets its one-account answer
      assignees: [],
    });
    const site = await probe(t(bvAdmin));
    expect(site.sites).toEqual([BV]);
    expect(site).toMatchObject({
      platform: false,
      owner: false,
      admins: null,
      qualified: null,
      open: null,
    });
    // padmin granted bvAdmin, admin2 granted padmin, root (the bootstrap admin) granted admin2.
    expect(new Set(site.ancestry)).toEqual(new Set([padmin.userId, admin2.userId, root.userId]));
    // The superiority rule sees dual's role on the other site; comAdmin is out of scope.
    expect(site.dual).toEqual([
      { role_key: "content_editor", site_id: BV },
      { role_key: "site_admin", site_id: COM },
    ]);
    expect(site.comAdmin).toEqual([]);
    expect(site.operator).toBe(0); // refused inside a staff context
    const platform = await probe(t(admin2));
    expect(platform.platform).toBe(true);
    expect(Number(platform.admins)).toBeGreaterThanOrEqual(2);
    expect(Number(platform.open)).toBe(2);
    // Lead assignees only for sites whose leads the session reads.
    expect((await probe(t(sales))).assignees).toEqual([{ site_id: BV }]);
    // /enrol functions: a forged link proves nothing and activates nothing.
    expect(
      (
        await asApp.$queryRaw<{ ok: boolean }[]>`
        SELECT iam_enrol_password_verified(${randomBytes(32).toString("base64url")}) AS ok`
      )[0]?.ok,
    ).toBe(false);
    await rejectsDb(
      asApp.$queryRaw`SELECT iam_enrol_activate_memberships(${randomBytes(32).toString("base64url")})`,
      /not completed in this transaction/,
    );
  });

  it("keeps the guards' full view: a reciprocal grant through a hidden link, superiority on another site", async () => {
    const fnFlags = await su.$queryRawUnsafe<{ f: string; d: boolean }[]>(
      `SELECT proname::text AS f, prosecdef AS d FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace AND proname IN (
         'iam_last_platform_admin_assignment_guard', 'iam_last_platform_admin_user_guard',
         'iam_last_platform_admin_expiry_guard', 'iam_reciprocal_grant_guard', 'iam_null_grantor_guard',
         'iam_customer_data_approval_has_assignment')
       ORDER BY 1`,
    );
    expect(fnFlags).toEqual([
      { f: "iam_customer_data_approval_has_assignment", d: true },
      { f: "iam_last_platform_admin_assignment_guard", d: true },
      { f: "iam_last_platform_admin_expiry_guard", d: true },
      { f: "iam_last_platform_admin_user_guard", d: true },
      { f: "iam_null_grantor_guard", d: false },
      { f: "iam_reciprocal_grant_guard", d: true },
    ]);
    // admin2 -> padmin (platform, invisible to bvAdmin) -> bvAdmin. Granting admin2 a BV role as
    // bvAdmin passes the policy (BV is bvAdmin's site) and must still be refused by the trigger.
    const editorRole = await dbo.role.findUniqueOrThrow({ where: { key: "content_editor" } });
    await rejectsDb(
      inCtx(t(bvAdmin), (tx) =>
        tx.roleAssignment.create({
          data: {
            userId: admin2.userId,
            roleId: editorRole.id,
            scopeType: "SITE",
            siteId: BV,
            grantedById: bvAdmin.userId,
          },
        }),
      ),
      /reciprocal or indirect self-grant/,
    );
    // Over HTTP: bvAdmin may not suspend dual on BV, because dual is a site_admin elsewhere.
    const res = await new Staff("bvadmin", bvAdmin.userId, t(bvAdmin)).call(
      "POST",
      `/users/${dual.userId}/suspend`,
      { siteId: BV, reason: "DP-125 superiority probe" },
    );
    expectError(res, 403, "FORBIDDEN");
    expect(
      await dbo.membership.findFirstOrThrow({ where: { userId: dual.userId, siteId: BV } }),
    ).toMatchObject({ status: "ACTIVE" });
  });

  it("refuses to switch row-level security off or to rewrite policies and functions as dp_app", async () => {
    await rejectsDb(
      asApp.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL row_security = off`;
        return tx.membership.count();
      }),
      /row-level security|row level security/,
    );
    for (const sql of [
      `ALTER TABLE "Membership" DISABLE ROW LEVEL SECURITY`,
      `ALTER TABLE "AuditEvent" NO FORCE ROW LEVEL SECURITY`,
      `DROP POLICY membership_staff_read ON "Membership"`,
      `CREATE POLICY dp125_open ON "RoleAssignment" FOR SELECT TO dp_app USING (true)`,
      `CREATE OR REPLACE FUNCTION iam_rls_staff_is_owner() RETURNS boolean LANGUAGE sql AS 'SELECT true'`,
      `ALTER FUNCTION iam_reciprocal_grant_guard() SECURITY INVOKER`,
    ]) {
      await rejectsDb(asApp.$executeRawUnsafe(sql), /must be owner|permission denied/);
    }
  });

  it("runs the staff screen, role changes and deactivation end to end under row-level security", async () => {
    // The site administrator's staff screen: BV staff only, other sites' roles filtered.
    const bv = new Staff("bvadmin", bvAdmin.userId, t(bvAdmin));
    const list = await bv.call("GET", "/staff");
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const staffList = StaffListResponseSchema.parse(list.body).staff;
    const ids = staffList.map((s) => s.id);
    expect(ids).toContain(dual.userId);
    expect(ids).toContain(sales.userId);
    expect(ids).not.toContain(comAdmin.userId);
    expect(ids).not.toContain(padmin.userId);
    expect(staffList.find((s) => s.id === dual.userId)?.roles.map((r) => r.siteId)).toEqual([BV]);
    // The platform administrator sees everyone (the owner stays hidden, DP-108).
    const all = StaffListResponseSchema.parse(
      (await new Staff("admin2", admin2.userId, t(admin2)).call("GET", "/staff")).body,
    ).staff.map((s) => s.id);
    expect(all).toEqual(expect.arrayContaining([comAdmin.userId, padmin.userId, dual.userId]));
    expect(all).not.toContain(root.userId);
    // Assign and revoke a BV role as the site administrator.
    const assigned = await bv.call("POST", `/staff/${sales.userId}/roles`, {
      roleKey: "content_editor",
      siteId: BV,
    });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
    const assignmentId = assigned.body.assignment.id as string;
    const revoked = await bv.call("POST", `/role-assignments/${assignmentId}/revoke`, {});
    expect([200, 204]).toContain(revoked.status);
    // The platform administrator deactivates dual: every row on both sites closes, none is left.
    const done = await new Staff("admin2", admin2.userId, t(admin2)).call(
      "POST",
      `/users/${dual.userId}/deactivate`,
      { reason: "DP-125 end-to-end deactivation", confirmEmail: "dp125-dual@staff.dp.test" },
    );
    expect([200, 204], JSON.stringify(done.body)).toContain(done.status);
    expect(
      await dbo.roleAssignment.count({ where: { userId: dual.userId, revokedAt: null } }),
    ).toBe(0);
    expect(
      await dbo.membership.count({ where: { userId: dual.userId, status: { not: "REVOKED" } } }),
    ).toBe(0);
    // The owner console works in the owner's context: overview, module states, chain.
    const god = new Staff("root", root.userId, t(root));
    const overview = await god.call("GET", "/owner/overview");
    expect(overview.status, JSON.stringify(overview.body)).toBe(200);
    const crmStates = OwnerOverviewResponseSchema.parse(overview.body).modules.find(
      (m) => m.key === "crm",
    );
    expect(crmStates?.sites.map((s) => s.siteId).sort()).toEqual([BV, COM].sort());
    const verify = await god.call("GET", "/owner/audit/verify");
    expect(verify.status, JSON.stringify(verify.body)).toBe(200);
    // The owner's check sees the whole stream (the event tampered with earlier in this file too).
    const status = OwnerChainStatusSchema.parse(verify.body);
    expect(status.firstBrokenSeq).toBe(2);
    expect(status.events).toBeGreaterThan(2);
  });

  it("records the legacy access expiry in the database, never ahead of its clock (K3)", async () => {
    // Legacy rows (the workflow is retired; the guard refuses new ones), written as superuser.
    const role = await dbo.role.findUniqueOrThrow({ where: { key: "sales_crm_user" } });
    const assignment = await dbo.roleAssignment.findFirstOrThrow({
      where: { userId: sales.userId, revokedAt: null },
    });
    const past = new Date(Date.now() - 3_600_000);
    const requested = new Date(Date.now() - 4 * 3_600_000);
    const decideBy = new Date(Date.now() - 2 * 3_600_000);
    const decided = new Date(Date.now() - 3 * 3_600_000);
    const future = new Date(Date.now() + 86_400_000);
    const comAssignment = await dbo.roleAssignment.findFirstOrThrow({
      where: { userId: comAdmin.userId, siteId: COM },
    });
    await su.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      for (const [siteId, expires] of [
        [BV, past],
        [COM, future],
      ] as const) {
        await tx.$executeRaw`
          INSERT INTO "CustomerDataAccessRequest" ("id", "userId", "roleId", "scopeType", "siteId",
            "justification", "durationDays", "status", "requestedById", "requestedAt", "decideBy",
            "decidedById", "decidedAt", "assignmentId", "accessExpiresAt")
          VALUES (gen_random_uuid(), ${sales.userId}::uuid, ${role.id}::uuid, 'SITE', ${siteId}::uuid,
            'DP-125 legacy access request probe', 1, 'APPROVED', ${padmin.userId}::uuid,
            ${requested}, ${decideBy}, ${admin2.userId}::uuid, ${decided},
            ${siteId === BV ? assignment.id : comAssignment.id}::uuid, ${expires})`;
      }
    });
    // Visibility: the BV administrator sees the BV row only; the owner both; an editor none.
    const seen = (token: string) =>
      inCtx(token, (tx) => tx.customerDataAccessRequest.findMany({ select: { siteId: true } }));
    expect((await seen(t(bvAdmin))).map((r) => r.siteId)).toEqual([BV]);
    expect((await seen(t(root))).length).toBe(2);
    expect(await seen(t(editor))).toEqual([]);
    // dp_app cannot change the history directly, in or out of a context.
    expect(
      (
        await tryInCtx(t(root), (tx) =>
          tx.customerDataAccessRequest.updateMany({ data: { expiryRecordedAt: new Date() } }),
        )
      ).count,
    ).toBe(0);
    // A sweep "two days ahead" records only what has expired by the database clock.
    const { runCustomerDataAccessSweep } = (await import(
      pathToFileURL(path.join(API_DIR, "dist/iam/customer-data-access/sweep.js")).href
    )) as { runCustomerDataAccessSweep: (db: PrismaClient, now?: Date) => Promise<unknown> };
    expect(await runCustomerDataAccessSweep(asApp, new Date(Date.now() + 2 * 86_400_000))).toEqual({
      requestsExpired: 0,
      accessExpired: 1,
    });
    expect(await lastAudit("iam.customer_data_access_expired")).toMatchObject({
      actorType: "SYSTEM",
      siteId: BV,
      resourceId: assignment.id,
    });
    expect(await runCustomerDataAccessSweep(asApp)).toEqual({
      requestsExpired: 0,
      accessExpired: 0,
    });
  });
});
