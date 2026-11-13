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
import { PrismaClient } from "../../src/generated/prisma/client.js";
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
    await rejectsDb(
      asApp.roleAssignment.create({
        data: {
          userId: id,
          roleId: role.id,
          scopeType: "SITE",
          siteId: BV,
          grantedById: admin2.userId,
          reason: "x",
        },
      }),
      /no role can be assigned to the system owner/,
    );
    await rejectsDb(
      asApp.roleAssignment.updateMany({
        where: { userId: id },
        data: { revokedAt: new Date(), revokedById: admin2.userId },
      }),
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
    const scoped = dist.withSiteScope(asApp, { siteIds: [BV], includePlatform: true });
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
