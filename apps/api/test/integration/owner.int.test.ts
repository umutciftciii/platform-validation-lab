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
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  AiAlertsResponseSchema,
  AiAuditResponseSchema,
  AiOperationCreatedSchema,
  AiOperationDetailSchema,
  AiOperationHistorySchema,
  AiPriceListResponseSchema,
  AiUsageReportSchema,
  AiBudgetSchema,
  AiBudgetsResponseSchema,
  AiOperationsResponseSchema,
  AiReconciliationResponseSchema,
  AiTasksResponseSchema,
  AiCredentialResultSchema,
  AiModelRefreshResponseSchema,
  AiModelsResponseSchema,
  AiOverviewResponseSchema,
  AiProvidersResponseSchema,
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
/** The AI keyring of the DP-289…DP-291 blocks (keys stored by one block are read by the next). */
const AI_ENC_KEYS = `1:${randomBytes(32).toString("base64url")}`;

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

  call(method: "GET" | "POST", p: string, body?: unknown): Promise<Res> {
    return this.callAt(base, method, p, body);
  }

  /** DP-297: the same call through another API instance (base URL). */
  async callAt(at: string, method: "GET" | "POST", p: string, body?: unknown): Promise<Res> {
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
      await fetch(`${at}/api/v1/admin${p}`, {
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

// DP-287 (ADR-030 D1, D2): the global AI switch. Only the system owner switches it, in the Owner
// Console, platform-wide; it starts OFF; while it is off every AI route is a 404; it survives an
// API restart; the database keeps it with the owner (row-level security, triggers, owner-only
// permissions); and once the switch-off COMMITs no new work can start (whileEnabled).
describe("DP-287: the global AI switch", () => {
  const AI = "/owner/modules/ai/platform";
  let factory: { createApiApp(o: { logger: false }): Promise<App> };
  interface Gate {
    whileEnabled<T>(key: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  }
  let gate: Gate;
  let ownerNow: Staff; // the owner with a fresh step-up

  async function sessionOf(who: Staff): Promise<Res> {
    const token = (who as unknown as { token: string }).token;
    return parse(
      await fetch(`${base}/api/v1/auth/staff/session`, {
        headers: {
          "x-dp-proxy-key": TEST_KEYS.admin,
          "x-dp-client-ip": "10.20.30.41",
          cookie: `__Host-dp_admin_session=${token}`,
        },
      }),
    );
  }
  const aiCenter = async (who: Staff) =>
    ((await sessionOf(who)).body as { features?: { aiCenter: boolean } }).features?.aiCenter;
  const state = () => dbo.platformModuleState.findUniqueOrThrow({ where: { moduleKey: "ai" } });
  async function restart() {
    await app.close();
    app = await factory.createApiApp({ logger: false });
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    factory = (await import(pathToFileURL(path.join(API_DIR, "dist/app.factory.js")).href)) as {
      createApiApp(o: { logger: false }): Promise<App>;
    };
    const mod = (await import(
      pathToFileURL(path.join(API_DIR, "dist/iam/platform-modules.js")).href
    )) as { PlatformModuleService: new (prisma: PrismaClient) => Gate };
    gate = new mod.PlatformModuleService(asApp);
    ownerNow = new Staff("root-ai", root.userId, await session(root.userId));
  });

  it("starts OFF: the migration's row, an optional module, no per-site switch", async () => {
    expect(await state()).toMatchObject({ enabled: false, version: 1, updatedById: null });
    expect(await dbo.featureModule.findUniqueOrThrow({ where: { key: "ai" } })).toMatchObject({
      isCore: false,
      name: "AI Center",
    });
    const overview = OwnerOverviewResponseSchema.parse(
      (await ownerNow.call("GET", "/owner/overview")).body,
    );
    expect(overview.modules.find((m) => m.key === "ai")).toMatchObject({
      scope: "PLATFORM",
      sites: [],
      platform: { enabled: false, version: 1 },
    });
  });

  it("is a 404 on every AI route for everyone while off, the owner included, audited", async () => {
    for (const who of [ownerNow, admin2, editor]) {
      expectError(await who.call("GET", "/ai/overview"), 404, "NOT_FOUND");
      expect(await aiCenter(who)).toBe(false);
    }
    expect(await lastAudit("ai.access_denied")).toMatchObject({
      actorUserId: editor.userId,
      outcome: "DENIED",
      reason: "ai_disabled",
    });
    // Unknown AI routes look the same; a signed-out caller still gets 401 first.
    expectError(await admin2.call("GET", "/ai/nothing-here"), 404, "NOT_FOUND");
    const anon = await parse(
      await fetch(`${base}/api/v1/admin/ai/overview`, {
        headers: { "x-dp-proxy-key": TEST_KEYS.admin, "x-dp-client-ip": "10.20.30.41" },
      }),
    );
    expect(anon.status).toBe(401);
  });

  it("cannot be switched by anyone but the owner, over HTTP or in the database", async () => {
    for (const who of [admin2, editor]) {
      expectError(
        await who.call("POST", AI, { enabled: true, reason: "try to switch it on" }),
        404,
        "NOT_FOUND",
      );
    }
    expect(await lastAudit("owner.access_denied")).toMatchObject({
      actorUserId: editor.userId,
      stream: "PROTECTED",
    });
    // dp_app in the super admin's own context: no row to read or change (row-level security),
    // no insert or delete at all.
    const adminToken = (admin2 as unknown as { token: string }).token;
    const flipped = await asApp.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT leads_rls_set_staff_context(${adminToken})`;
      const seen = await tx.platformModuleState.count();
      const res = await tx.platformModuleState.updateMany({
        where: { moduleKey: "ai" },
        data: { enabled: true, reason: "forged by the super admin", version: 2 },
      });
      return { seen, count: res.count };
    });
    expect(flipped).toEqual({ seen: 0, count: 0 });
    await rejectsDb(
      asApp.$executeRaw`INSERT INTO "PlatformModuleState" ("moduleKey", "reason") VALUES ('crm', 'forged state')`,
      /permission denied/,
    );
    await rejectsDb(
      asApp.$executeRaw`DELETE FROM "PlatformModuleState" WHERE "moduleKey" = 'ai'`,
      /permission denied/,
    );
    // Booleans for everyone through the narrow functions.
    const probe = await asApp.$queryRaw<
      { on: boolean }[]
    >`SELECT platform_module_enabled('ai') AS "on"`;
    expect(probe).toEqual([{ on: false }]);
    expect((await state()).enabled).toBe(false);
  });

  it("keeps the owner-only permissions and the platform switch out of every other place, even for the table owner", async () => {
    await rejectsDb(
      dbo.$executeRaw`DELETE FROM "PlatformModuleState" WHERE "moduleKey" = 'ai'`,
      /a module state is never removed/,
    );
    await rejectsDb(
      dbo.$executeRaw`TRUNCATE "PlatformModuleState"`,
      /module states are never removed|permission denied/,
    );
    await rejectsDb(
      dbo.platformModuleState.update({
        where: { moduleKey: "ai" },
        data: { enabled: true, reason: "skips a version", version: 5 },
      }),
      /raises the version by one/,
    );
    const ai = await dbo.featureModule.findUniqueOrThrow({ where: { key: "ai" } });
    await rejectsDb(
      dbo.moduleConfiguration.create({
        data: { moduleId: ai.id, siteId: BV, enabled: true, reason: "per-site AI switch" },
      }),
      /switched platform-wide, not per site/,
    );
    const manage = await dbo.permission.findUniqueOrThrow({ where: { key: "module:manage" } });
    for (const roleKey of ["platform_super_admin", "site_admin", "read_only"]) {
      const role = await dbo.role.findUniqueOrThrow({ where: { key: roleKey } });
      await rejectsDb(
        dbo.rolePermission.create({ data: { roleId: role.id, permissionId: manage.id } }),
        /owner-only permissions belong to the system owner only/,
      );
    }
    const holders = await dbo.rolePermission.findMany({
      where: { permission: { key: { in: ["module:manage", "owner_audit:read"] } } },
      select: { role: { select: { key: true } } },
    });
    expect(new Set(holders.map((h) => h.role.key))).toEqual(new Set(["system_owner"]));
    // The site route refuses the platform module, the platform route a site module.
    expectError(
      await ownerNow.call("POST", `/owner/modules/ai/sites/${BV}`, {
        enabled: true,
        reason: "per-site AI",
      }),
      400,
      "VALIDATION_FAILED",
    );
    expect(await lastAudit("owner.module_changed")).toMatchObject({
      reason: "scope_mismatch",
      stream: "PROTECTED",
    });
    expectError(
      await ownerNow.call("POST", "/owner/modules/crm/platform", {
        enabled: true,
        reason: "platform CRM",
      }),
      400,
      "VALIDATION_FAILED",
    );
    expect((await state()).enabled).toBe(false);
  });

  it("is switched on by the owner alone, with a reason and the step-up, PROTECTED", async () => {
    const stale = new Staff("root-ai-stale", root.userId, await session(root.userId, null));
    expectError(
      await stale.call("POST", AI, { enabled: true, reason: "AI pilot" }),
      403,
      "AUTH_STEP_UP_REQUIRED",
    );
    expectError(
      await ownerNow.call("POST", AI, { enabled: true, reason: "" }),
      400,
      "VALIDATION_FAILED",
    );
    const on = await ownerNow.call("POST", AI, { enabled: true, reason: "AI pilot approved" });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    const body = OwnerModuleChangeResponseSchema.parse(on.body);
    expect(body).toMatchObject({
      changed: true,
      module: { key: "ai", platform: { enabled: true, version: 2, reason: "AI pilot approved" } },
    });
    expect(await state()).toMatchObject({ enabled: true, version: 2, updatedById: root.userId });
    expect(await lastAudit("owner.module_changed")).toMatchObject({
      actorUserId: root.userId,
      outcome: "SUCCESS",
      scopeType: "PLATFORM",
      siteId: null,
      resourceId: "ai",
      stream: "PROTECTED",
      reason: "AI pilot approved",
    });
    const again = OwnerModuleChangeResponseSchema.parse(
      (await ownerNow.call("POST", AI, { enabled: true, reason: "AI pilot again" })).body,
    );
    expect(again.changed).toBe(false);
    expect((await state()).version).toBe(2);
  });

  it("shows the AI Center while on to those who may read it; nothing else changes", async () => {
    expect(await aiCenter(ownerNow)).toBe(true);
    expect(await aiCenter(admin2)).toBe(true);
    expect(await aiCenter(editor)).toBe(false);
    // DP-292: the caller's permissions — the owner manages everything; a super admin reads.
    const manageAll = {
      usageRead: true,
      providerManage: true,
      modelManage: true,
      budgetManage: true,
      invoke: true,
      auditRead: true,
    };
    const readOnly = {
      usageRead: true,
      providerManage: false,
      modelManage: false,
      budgetManage: false,
      invoke: false,
      auditRead: true,
    };
    for (const [who, permissions] of [
      [ownerNow, manageAll],
      [admin2, readOnly],
    ] as const) {
      const res = await who.call("GET", "/ai/overview");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(AiOverviewResponseSchema.parse(res.body)).toEqual({
        enabled: true,
        callsPossible: false,
        blockers: [
          "transport_off",
          "no_provider_key",
          "no_enabled_model",
          "no_budget",
          "no_enabled_task",
        ],
        transport: "off",
        permissions,
        // DP-293: the sites the caller knows (names for site budgets and per-site usage).
        sites: expect.arrayContaining(
          (await dbo.site.findMany({ select: { id: true, key: true, name: true } })).map((s) =>
            expect.objectContaining({ id: s.id, key: s.key }),
          ),
        ),
      });
    }
    expectError(await editor.call("GET", "/ai/overview"), 403, "FORBIDDEN");
    // The other modules answer as before.
    expect((await editor.call("GET", "/cms/context")).status).toBe(200);
    expect((await admin2.call("GET", "/staff")).status).toBe(200);
  });

  it("keeps its state across an API restart", async () => {
    await restart();
    expect((await state()).enabled).toBe(true);
    expect(await aiCenter(admin2)).toBe(true);
    expect((await admin2.call("GET", "/ai/overview")).status).toBe(200);
  });

  it("waits for running work to end and lets no new work start after the switch-off COMMIT", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const holder = gate.whileEnabled("ai", async () => {
      await held;
      return "started";
    });
    await sleep(150);
    let switched = false;
    const off = ownerNow
      .call("POST", AI, { enabled: false, reason: "Stop AI now" })
      .then((res) => ((switched = true), res));
    await sleep(500);
    expect(switched, "the switch waits for the running holder").toBe(false);
    // A start that arrives while the switch waits queues behind it and is then refused.
    const queued = gate
      .whileEnabled("ai", async () => "late")
      .then(
        (v) => v,
        (e: unknown) => String(e),
      );
    await sleep(150);
    release();
    expect(await holder).toBe("started");
    const res = await off;
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(OwnerModuleChangeResponseSchema.parse(res.body).changed).toBe(true);
    expect(await queued).toMatch(/platform module ai is off/);
    await expect(gate.whileEnabled("ai", async () => "after")).rejects.toThrow(
      /platform module ai is off/,
    );
    expect(await state()).toMatchObject({ enabled: false, version: 3 });
  });

  it("is never starved: under a stream of work the switch-off commits, and no work starts after it", async () => {
    expect(
      (await ownerNow.call("POST", AI, { enabled: true, reason: "Second pilot round" })).status,
    ).toBe(200);
    const started: number[] = [];
    let refused = 0;
    let stop = false;
    const workers = Array.from({ length: 8 }, async () => {
      while (!stop) {
        try {
          await gate.whileEnabled("ai", async () => {
            started.push(Date.now());
            await sleep(40);
          });
        } catch (e) {
          if (!/platform module ai is off/.test(String(e))) throw e;
          refused += 1;
          await sleep(5);
        }
      }
    });
    await sleep(300);
    const t0 = Date.now();
    const res = await ownerNow.call("POST", AI, { enabled: false, reason: "Stop under load" });
    const committedBy = Date.now();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(committedBy - t0, "the switch-off is not starved").toBeLessThan(5_000);
    await sleep(300);
    stop = true;
    await Promise.all(workers);
    expect(started.length).toBeGreaterThan(5);
    expect(refused).toBeGreaterThan(0);
    // Every start ran before the switch-off answered; none after.
    expect(started.filter((t) => t > committedBy)).toEqual([]);
    expect((await state()).enabled).toBe(false);
    // Off again: every route is a 404 again, the state survives a restart, data is kept.
    expectError(await admin2.call("GET", "/ai/overview"), 404, "NOT_FOUND");
    await restart();
    expect(await aiCenter(ownerNow)).toBe(false);
    expect(await state()).toMatchObject({ enabled: false, version: 5 });
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
    // DP-287: only this test's refusals (database clock), not the super admin's earlier ones.
    const since = (await dbo.$queryRaw<{ since: Date }[]>`SELECT now() AS "since"`)[0]!.since;
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
        occurredAt: { gte: since },
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

// DP-288 (ADR-030 D3–D7): the AI data model in the database — seed rows, row-level security that
// opens the AI tables only while AI is on and only with the matching ai:* permission, the
// owner-managed ai_administrator role, separate keys per provider, the key's ciphertext out of
// reach of plain SELECTs, append-only and never-deleted rows, and the data kept while AI is off.
// Runs last, with users of its own, so the DP-125 counts above stay as they are.
describe("DP-288: the AI data model", () => {
  type Tx = Prisma.TransactionClient;
  const AI = "/owner/modules/ai/platform";
  const CIPHER = () =>
    `v1:${randomBytes(12).toString("base64url")}:${randomBytes(24).toString("base64url")}:${randomBytes(16).toString("base64url")}`;
  const FP = () => randomBytes(32).toString("hex");
  let owner: Staff; // the system owner, fresh step-up
  let aiAdmin: Staff; // platform super admin; gets ai_administrator from the owner
  let viewer: Staff; // content editor on BV; gets ai_viewer from aiAdmin
  const tokenOf = (s: Staff) => (s as unknown as { token: string }).token;
  /** dp_app inside one transaction with the staff context of `who`. */
  function inCtx<T>(who: Staff, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return asApp.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT leads_rls_set_staff_context(${tokenOf(who)})`;
      return fn(tx);
    });
  }
  const allows = (who: Staff, permission: string) =>
    inCtx(who, async (tx) => {
      const r = await tx.$queryRaw<
        { ok: boolean }[]
      >`SELECT ai_rls_staff_allows(${permission}) AS "ok"`;
      return r[0]!.ok;
    });
  const credential = (createdById: string, o: Record<string, unknown> = {}) => ({
    provider: "OPENAI" as const,
    label: "Platform OpenAI key",
    status: "PENDING_TEST" as const,
    ciphertext: CIPHER(),
    keyVersion: 1,
    keyHint: "sk-…ab12",
    fingerprint: FP(),
    createdById,
    ...o,
  });
  const SAFE = {
    id: true,
    provider: true,
    status: true,
    keyHint: true,
    version: true,
  } as const;

  beforeAll(async () => {
    const pw = (await dbo.user.findUniqueOrThrow({ where: { id: root.userId } })).passwordHash!;
    owner = new Staff("root-288", root.userId, await session(root.userId));
    aiAdmin = await staff("ai-admin", pw, [{ role: "platform_super_admin" }], root.userId);
    viewer = await staff("ai-viewer", pw, [{ role: "content_editor", site: BV }], root.userId);
    expect(
      (await dbo.platformModuleState.findUniqueOrThrow({ where: { moduleKey: "ai" } })).enabled,
    ).toBe(false);
  });

  it("creates the tables with their seed rows, all off, and row-level security on each", async () => {
    expect(await dbo.aiSettings.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({
      maxConcurrency: 2,
      reservationTtlSec: 120,
      safetyMarginPct: 10,
    });
    const providers = await dbo.aiProviderSetting.findMany({ orderBy: { provider: "asc" } });
    expect(providers.map((p) => [p.provider, p.enabled, p.defaultModelId])).toEqual([
      ["OPENAI", false, null],
      ["ANTHROPIC", false, null],
      ["GEMINI", false, null],
    ]);
    const tasks = await dbo.aiTaskSetting.findMany({ orderBy: { task: "asc" } });
    expect(tasks.map((t) => [t.task, t.enabled])).toEqual([
      ["DIAGNOSTIC_PING", false],
      ["TRANSLATION", false],
      ["SEO_META", false],
      ["CONTENT_DRAFT", false],
    ]);
    const rls = await dbo.$queryRaw<{ t: string; rls: boolean }[]>`
      SELECT relname::text AS t, relrowsecurity AS rls FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'Ai%' AND relkind = 'r' ORDER BY 1`;
    expect(rls).toHaveLength(13); // DP-297: AiTransient; DP-298: AiProviderDataTerms
    expect(rls.every((r) => r.rls)).toBe(true);
  });

  it("opens nothing while AI is off, not even to the owner", async () => {
    for (const who of [owner, aiAdmin, viewer]) {
      expect(await allows(who, "ai:read")).toBe(false);
      expect(await inCtx(who, (tx) => tx.aiSettings.count())).toBe(0);
      expect(await inCtx(who, (tx) => tx.aiTaskSetting.count())).toBe(0);
    }
    await rejectsDb(
      inCtx(owner, (tx) =>
        tx.aiProviderCredential.create({ data: credential(root.userId), select: SAFE }),
      ),
      /row-level security|row level security/,
    );
  });

  it("gives ai_administrator only through the owner, and never the global switch", async () => {
    expect(
      (await owner.call("POST", AI, { enabled: true, reason: "DP-288 data model test" })).status,
    ).toBe(200);
    // The super admin reads but does not manage, and cannot hand out ai_administrator.
    expect(await allows(aiAdmin, "ai:read")).toBe(true);
    expect(await allows(aiAdmin, "ai_provider:manage")).toBe(false);
    expectError(
      await aiAdmin.call("POST", `/staff/${viewer.userId}/roles`, { roleKey: "ai_administrator" }),
      403,
      "FORBIDDEN",
    );
    const res = await owner.call("POST", `/staff/${aiAdmin.userId}/roles`, {
      roleKey: "ai_administrator",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    for (const p of [
      "ai:read",
      "ai_usage:read",
      "ai_provider:manage",
      "ai_model:manage",
      "ai_budget:manage",
    ]) {
      expect(await allows(aiAdmin, p), p).toBe(true);
    }
    expect(await allows(aiAdmin, "module:manage")).toBe(false);
    // Holding the role does not let it pass the role on, nor take it away.
    expectError(
      await aiAdmin.call("POST", `/staff/${viewer.userId}/roles`, { roleKey: "ai_administrator" }),
      403,
      "FORBIDDEN",
    );
    // …and the database refuses another grantor too, even for the table owner.
    const role = await dbo.role.findUniqueOrThrow({ where: { key: "ai_administrator" } });
    await rejectsDb(
      dbo.roleAssignment.create({
        data: {
          userId: viewer.userId,
          roleId: role.id,
          scopeType: "PLATFORM",
          grantedById: aiAdmin.userId,
          reason: "x",
        },
      }),
      /assigned by the system owner only/,
    );
    // ai_viewer is an ordinary read role: the AI administrator (a super admin) may give it.
    const v = await aiAdmin.call("POST", `/staff/${viewer.userId}/roles`, { roleKey: "ai_viewer" });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    expect(await allows(viewer, "ai_usage:read")).toBe(true);
    expect(await allows(viewer, "ai_budget:manage")).toBe(false);
    // Nobody but the owner switches AI, whatever AI role they hold.
    for (const who of [aiAdmin, viewer]) {
      expectError(
        await who.call("POST", AI, { enabled: false, reason: "not mine" }),
        404,
        "NOT_FOUND",
      );
    }
  });

  it("keeps one ACTIVE key per provider, separate keys for OpenAI, Claude and Gemini, ciphertext out of SELECT", async () => {
    const ids: string[] = [];
    for (const provider of ["OPENAI", "ANTHROPIC", "GEMINI"] as const) {
      const c = await inCtx(aiAdmin, (tx) =>
        tx.aiProviderCredential.create({
          data: credential(aiAdmin.userId, { provider, status: "ACTIVE", activatedAt: new Date() }),
          select: SAFE,
        }),
      );
      ids.push(c.id);
    }
    await rejectsDb(
      inCtx(aiAdmin, (tx) =>
        tx.aiProviderCredential.create({
          data: credential(aiAdmin.userId, { status: "ACTIVE", activatedAt: new Date() }),
          select: SAFE,
        }),
      ),
      /AiProviderCredential_active_provider_key|Unique constraint/,
    );
    // The column itself is never selectable by the API's role; the narrow function hands it out.
    await rejectsDb(
      inCtx(aiAdmin, (tx) => tx.$queryRaw`SELECT "ciphertext" FROM "AiProviderCredential" LIMIT 1`),
      /permission denied/,
    );
    const viaFn = await inCtx(
      aiAdmin,
      (tx) =>
        tx.$queryRaw<
          { c: string | null }[]
        >`SELECT ai_credential_ciphertext(${ids[0]}::uuid) AS "c"`,
    );
    expect(viaFn[0]!.c).toMatch(/^v1:/);
    // The viewer sees the key's metadata, never manages it.
    expect(await inCtx(viewer, (tx) => tx.aiProviderCredential.count())).toBe(3);
    expect(
      await inCtx(viewer, (tx) =>
        tx.aiProviderCredential.updateMany({
          where: { id: ids[0] },
          data: { label: "renamed", version: 2 },
        }),
      ),
    ).toEqual({ count: 0 });
    // A key in clear text is refused; REVOKED erases the ciphertext and is final.
    await rejectsDb(
      dbo.aiProviderCredential.create({
        data: credential(aiAdmin.userId, { provider: "GEMINI", ciphertext: "AIza-plain-key" }),
      }),
      /AiProviderCredential_ciphertext/,
    );
    await dbo.aiProviderCredential.update({
      where: { id: ids[2] },
      data: {
        status: "REVOKED",
        ciphertext: null,
        keyVersion: null,
        revokedAt: new Date(),
        revokedById: aiAdmin.userId,
        version: 2,
      },
    });
    await rejectsDb(
      dbo.aiProviderCredential.update({
        where: { id: ids[2] },
        data: { status: "DISABLED", disabledAt: new Date(), version: 3 },
      }),
      /a revoked key never changes/,
    );
    await rejectsDb(
      dbo.aiProviderCredential.update({
        where: { id: ids[1] },
        data: { provider: "OPENAI", version: 2 },
      }),
      /never change/,
    );
    expect(
      (
        await inCtx(
          aiAdmin,
          (tx) =>
            tx.$queryRaw<
              { c: string | null }[]
            >`SELECT ai_credential_ciphertext(${ids[2]}::uuid) AS "c"`,
        )
      )[0]!.c,
    ).toBeNull();
  });

  it("keeps prices append-only and dated, tasks and budgets versioned, nothing deleted", async () => {
    const model = await inCtx(aiAdmin, (tx) =>
      tx.aiModel.create({
        data: {
          provider: "OPENAI",
          modelId: "dp288-test-model",
          displayName: "Test model",
          billingProfile: "openai.responses",
        },
      }),
    );
    const price = await inCtx(aiAdmin, (tx) =>
      tx.aiModelPrice.create({
        data: {
          modelId: model.id,
          inputMicrosPerMTok: 400_000n,
          cachedReadMicrosPerMTok: 100_000n,
          outputMicrosPerMTok: 1_600_000n,
          effectiveFrom: new Date(),
          sourceNote: "DP-288 test price",
          createdById: aiAdmin.userId,
        },
      }),
    );
    await rejectsDb(
      dbo.aiModelPrice.create({
        data: {
          modelId: model.id,
          inputMicrosPerMTok: 1n,
          cachedReadMicrosPerMTok: 1n,
          outputMicrosPerMTok: 1n,
          effectiveFrom: new Date(Date.now() - 86_400_000),
          sourceNote: "backdated",
          createdById: aiAdmin.userId,
        },
      }),
      /never backdated/,
    );
    await rejectsDb(
      dbo.aiModelPrice.update({ where: { id: price.id }, data: { outputMicrosPerMTok: 1n } }),
      /append-only/,
    );
    // Task settings: versioned, enabled needs a model.
    await rejectsDb(
      inCtx(aiAdmin, (tx) =>
        tx.aiTaskSetting.update({
          where: { task: "TRANSLATION" },
          data: { enabled: true, version: 2 },
        }),
      ),
      /AiTaskSetting_enabled_needs_model/,
    );
    await rejectsDb(
      inCtx(aiAdmin, (tx) =>
        tx.aiTaskSetting.update({
          where: { task: "TRANSLATION" },
          data: { modelId: model.id, version: 5 },
        }),
      ),
      /raises the version by one/,
    );
    await inCtx(aiAdmin, (tx) =>
      tx.aiTaskSetting.update({
        where: { task: "TRANSLATION" },
        data: { modelId: model.id, version: 2 },
      }),
    );
    // A provider's default model must be its own.
    await rejectsDb(
      inCtx(aiAdmin, (tx) =>
        tx.aiProviderSetting.update({
          where: { provider: "GEMINI" },
          data: { defaultModelId: model.id, version: 2 },
        }),
      ),
      /default model belongs to another provider/,
    );
    // Budgets: one active per scope/site/period; scope and period never change.
    const daily = await inCtx(aiAdmin, (tx) =>
      tx.aiBudget.create({
        data: {
          scope: "PLATFORM",
          period: "DAILY",
          limitMicros: 2_000_000n,
          createdById: aiAdmin.userId,
        },
      }),
    );
    await rejectsDb(
      inCtx(aiAdmin, (tx) =>
        tx.aiBudget.create({
          data: {
            scope: "PLATFORM",
            period: "DAILY",
            limitMicros: 1n,
            createdById: aiAdmin.userId,
          },
        }),
      ),
      /AiBudget_active_platform_period_key|Unique constraint/,
    );
    await inCtx(aiAdmin, (tx) =>
      tx.aiBudget.create({
        data: {
          scope: "SITE",
          siteId: BV,
          period: "MONTHLY",
          limitMicros: 5_000_000n,
          createdById: aiAdmin.userId,
        },
      }),
    );
    await rejectsDb(
      dbo.aiBudget.create({
        data: { scope: "SITE", period: "DAILY", limitMicros: 1n, createdById: aiAdmin.userId },
      }),
      /AiBudget_scope_site/,
    );
    await rejectsDb(
      inCtx(aiAdmin, (tx) =>
        tx.aiBudget.update({ where: { id: daily.id }, data: { period: "MONTHLY", version: 2 } }),
      ),
      /scope, site, period and creator never change/,
    );
    // The viewer reads budgets and usage, changes nothing.
    expect(await inCtx(viewer, (tx) => tx.aiBudget.count())).toBe(2);
    await rejectsDb(
      inCtx(viewer, (tx) =>
        tx.aiBudget.create({
          data: {
            scope: "PLATFORM",
            period: "MONTHLY",
            limitMicros: 1n,
            createdById: viewer.userId,
          },
        }),
      ),
      /row-level security|row level security/,
    );
    // Usage, operations and ledger: no write path for the API yet (DP-290).
    await rejectsDb(
      asApp.aiBudgetUsage.create({
        data: { budgetId: daily.id, periodStart: new Date("2026-11-26T00:00:00Z") },
      }),
      /permission denied/,
    );
    await rejectsDb(
      dbo.aiBudgetUsage.create({
        data: { budgetId: daily.id, periodStart: new Date("2026-11-26T05:00:00Z") },
      }),
      /starts at a UTC day or month/,
    );
    await dbo.aiBudgetUsage.create({
      data: { budgetId: daily.id, periodStart: new Date("2026-11-26T00:00:00Z") },
    });
    await rejectsDb(
      dbo.aiOperation.create({
        data: {
          task: "TRANSLATION",
          provider: "GEMINI",
          modelId: model.id,
          priceId: price.id,
          idempotencyKey: "dp288-probe-1",
          inputDigest: "a".repeat(64),
          estInputTokens: 10,
          estOutputTokens: 10,
          reservedMicros: 100n,
          instanceId: "probe",
          leaseUntil: new Date(Date.now() + 60_000),
        },
      }),
      /provider, model and price must match/,
    );
    for (const p of [
      dbo.$executeRaw`DELETE FROM "AiSettings"`,
      dbo.$executeRaw`DELETE FROM "AiBudget" WHERE "id" = ${daily.id}::uuid`,
      dbo.$executeRaw`DELETE FROM "AiModelPrice" WHERE "id" = ${price.id}::uuid`,
    ]) {
      await rejectsDb(p, /are never removed/);
    }
  });

  it("closes every AI table again when the owner switches AI off, and keeps the data", async () => {
    const before = await Promise.all([
      dbo.aiProviderCredential.count(),
      dbo.aiModel.count(),
      dbo.aiModelPrice.count(),
      dbo.aiBudget.count(),
      dbo.aiBudgetUsage.count(),
    ]);
    expect(await aiCenterOf(viewer)).toBe(true);
    expect(
      (await owner.call("POST", AI, { enabled: false, reason: "DP-288 test done" })).status,
    ).toBe(200);
    for (const who of [owner, aiAdmin, viewer]) {
      expect(await inCtx(who, (tx) => tx.aiProviderCredential.count())).toBe(0);
      expect(await inCtx(who, (tx) => tx.aiBudget.count())).toBe(0);
    }
    const ids = await dbo.aiProviderCredential.findMany({
      where: { status: "ACTIVE" },
      select: { id: true },
    });
    expect(ids.length).toBe(2);
    expect(
      (
        await inCtx(
          aiAdmin,
          (tx) =>
            tx.$queryRaw<
              { c: string | null }[]
            >`SELECT ai_credential_ciphertext(${ids[0]!.id}::uuid) AS "c"`,
        )
      )[0]!.c,
    ).toBeNull();
    expect(await aiCenterOf(viewer)).toBe(false);
    expect(
      await Promise.all([
        dbo.aiProviderCredential.count(),
        dbo.aiModel.count(),
        dbo.aiModelPrice.count(),
        dbo.aiBudget.count(),
        dbo.aiBudgetUsage.count(),
      ]),
    ).toEqual(before);
  });

  async function aiCenterOf(who: Staff): Promise<boolean | undefined> {
    const res = await fetch(`${base}/api/v1/auth/staff/session`, {
      headers: {
        "x-dp-proxy-key": TEST_KEYS.admin,
        "x-dp-client-ip": "10.20.30.41",
        cookie: `__Host-dp_admin_session=${tokenOf(who)}`,
      },
    });
    return ((await res.json()) as { features?: { aiCenter: boolean } }).features?.aiCenter;
  }
});

// DP-289 (ADR-030 D4, D5): providers, their separate API keys and their models, end to end with
// the deterministic fake provider (DP_AI_TRANSPORT=fake: no network, no paid call). Covers the
// gate (404 while AI is off), permissions and step-up, a key that never comes back (responses,
// database, audit), format and duplicate checks, testing, replacement, disabling, revoking, the
// model list with compatibility, verification and enabling, provider settings, and transport off.
describe("DP-289: providers, keys and models", () => {
  const AI = "/owner/modules/ai/platform";
  const hex = (n: number) => randomBytes(n).toString("hex");
  // Hex only: the fake provider reads words like "invalid" or "down" in a key as an outcome.
  const OPENAI_1 = `sk-proj-${hex(20)}`;
  const OPENAI_2 = `sk-proj-${hex(20)}`;
  const ANTHROPIC = `sk-ant-api03-${hex(20)}`;
  const GEMINI = ["AI", "za", hex(18)].join("");
  let factory: { createApiApp(o: { logger: false }): Promise<App> };
  let owner: Staff;
  let admin: Staff; // super admin + ai_administrator (from the owner)
  let viewer: Staff; // ai_viewer
  let staleAdmin: Staff; // the same administrator without a fresh step-up
  const ids: Record<string, string> = {};

  async function restart(env: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await app.close();
    app = await factory.createApiApp({ logger: false });
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }
  async function noKeyAnywhere(text: string) {
    for (const k of [OPENAI_1, OPENAI_2, ANTHROPIC, GEMINI]) expect(text).not.toContain(k);
  }
  const call = async (who: Staff, method: "GET" | "POST", p: string, body?: unknown) => {
    const res = await who.call(method, p, body);
    await noKeyAnywhere(JSON.stringify(res.body));
    return res;
  };
  async function del(who: Staff, p: string): Promise<Res> {
    const res = await fetch(`${base}/api/v1/admin${p}`, {
      method: "DELETE",
      headers: {
        "x-dp-proxy-key": TEST_KEYS.admin,
        "x-dp-client-ip": "10.20.30.41",
        origin: ADMIN_ORIGIN,
        cookie: `__Host-dp_admin_session=${(who as unknown as { token: string }).token}`,
      },
    });
    return parse(res);
  }

  beforeAll(async () => {
    factory = (await import(pathToFileURL(path.join(API_DIR, "dist/app.factory.js")).href)) as {
      createApiApp(o: { logger: false }): Promise<App>;
    };
    await restart({
      DP_AI_TRANSPORT: "fake",
      DP_AI_ENC_KEYS: AI_ENC_KEYS,
    });
    const pw = (await dbo.user.findUniqueOrThrow({ where: { id: root.userId } })).passwordHash!;
    owner = new Staff("root-289", root.userId, await session(root.userId));
    admin = await staff("ai-admin-289", pw, [{ role: "platform_super_admin" }], root.userId);
    viewer = await staff("ai-viewer-289", pw, [], root.userId);
    staleAdmin = new Staff("ai-admin-289-stale", admin.userId, await session(admin.userId, null));
  });

  afterAll(async () => {
    await restart({ DP_AI_TRANSPORT: undefined, DP_AI_ENC_KEYS: undefined });
  });

  it("is a 404 while AI is off, for the owner too", async () => {
    expect(
      (await dbo.platformModuleState.findUniqueOrThrow({ where: { moduleKey: "ai" } })).enabled,
    ).toBe(false);
    expectError(await owner.call("GET", "/ai/providers"), 404, "NOT_FOUND");
    expectError(
      await owner.call("POST", "/ai/providers/openai/credentials", {
        apiKey: OPENAI_1,
        label: "x",
      }),
      404,
      "NOT_FOUND",
    );
  });

  it("lists the three providers to readers; only AI administrators manage, with a fresh step-up", async () => {
    expect(
      (await owner.call("POST", AI, { enabled: true, reason: "DP-289 providers test" })).status,
    ).toBe(200);
    expect(
      (await owner.call("POST", `/staff/${admin.userId}/roles`, { roleKey: "ai_administrator" }))
        .status,
    ).toBe(201);
    expect(
      (await owner.call("POST", `/staff/${viewer.userId}/roles`, { roleKey: "ai_viewer" })).status,
    ).toBe(201);
    const list = AiProvidersResponseSchema.parse((await call(viewer, "GET", "/ai/providers")).body);
    expect(list.transport).toBe("fake");
    // The DP-288 block above left keys of its own; the list shows every one of them.
    const counts = await Promise.all(
      (["OPENAI", "ANTHROPIC", "GEMINI"] as const).map((provider) =>
        dbo.aiProviderCredential.count({ where: { provider } }),
      ),
    );
    expect(list.providers.map((p) => [p.provider, p.enabled, p.credentials.length])).toEqual([
      ["OPENAI", false, counts[0]],
      ["ANTHROPIC", false, counts[1]],
      ["GEMINI", false, counts[2]],
    ]);
    expectError(
      await call(viewer, "POST", "/ai/providers/openai/credentials", {
        apiKey: OPENAI_1,
        label: "x",
      }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await call(staleAdmin, "POST", "/ai/providers/openai/credentials", {
        apiKey: OPENAI_1,
        label: "x",
      }),
      403,
      "AUTH_STEP_UP_REQUIRED",
    );
    expectError(
      await call(admin, "POST", "/ai/providers/mistral/credentials", {
        apiKey: OPENAI_1,
        label: "x",
      }),
      404,
      "NOT_FOUND",
    );
  });

  it("stores a key encrypted, tests it, makes it ACTIVE and never shows it again", async () => {
    const res = await call(admin, "POST", "/ai/providers/openai/credentials", {
      apiKey: OPENAI_1,
      label: "OpenAI platform",
      projectRef: "proj_dp289",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const r = AiCredentialResultSchema.parse(res.body);
    expect(r.test).toEqual({ code: "ok", models: 2 });
    expect(r.credential).toMatchObject({
      provider: "OPENAI",
      status: "ACTIVE",
      keyHint: `sk-proj-…${OPENAI_1.slice(-4)}`,
    });
    ids["openai1"] = r.credential.id;
    const row = await dbo.aiProviderCredential.findUniqueOrThrow({
      where: { id: r.credential.id },
    });
    expect(row.ciphertext).toMatch(/^v1:/);
    expect(row.ciphertext).not.toContain(OPENAI_1.slice(8, 20));
    expect(row.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const audits = await dbo.auditEvent.findMany({
      where: { action: { startsWith: "ai.credential." } },
      select: { action: true, metadata: true, reason: true },
    });
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(["ai.credential.add", "ai.credential.test", "ai.credential.activate"]),
    );
    await noKeyAnywhere(JSON.stringify(audits));
  });

  it("refuses a malformed key, another provider's key and the same key twice, without echoing them", async () => {
    const bad = await call(admin, "POST", "/ai/providers/anthropic/credentials", {
      apiKey: OPENAI_2,
      label: "wrong provider",
    });
    expectError(bad, 400, "VALIDATION_FAILED");
    expect(bad.body.error.details).toEqual([{ path: "apiKey", rule: "key_format" }]);
    const twice = await call(admin, "POST", "/ai/providers/openai/credentials", {
      apiKey: OPENAI_1,
      label: "again",
    });
    expectError(twice, 409, "CONFLICT_STATE");
    expect(twice.body.error.details).toEqual([{ path: "apiKey", rule: "duplicate_key" }]);
  });

  it("keeps a failing key PENDING_TEST with its code and the ACTIVE key untouched", async () => {
    const res = await call(admin, "POST", "/ai/providers/openai/credentials", {
      apiKey: `sk-proj-invalid${hex(10)}`,
      label: "broken",
    });
    const r = AiCredentialResultSchema.parse(res.body);
    expect(r.test.code).toBe("credential_invalid");
    expect(r.credential.status).toBe("PENDING_TEST");
    expect(
      (await dbo.aiProviderCredential.findUniqueOrThrow({ where: { id: ids["openai1"]! } })).status,
    ).toBe("ACTIVE");
    const rl = AiCredentialResultSchema.parse(
      (
        await call(admin, "POST", "/ai/providers/openai/credentials", {
          apiKey: `sk-proj-ratelimit${hex(10)}`,
          label: "busy",
        })
      ).body,
    );
    expect(rl.test.code).toBe("rate_limited");
    expect(
      await dbo.auditEvent.count({ where: { action: "ai.credential.test", outcome: "FAILURE" } }),
    ).toBeGreaterThanOrEqual(2);
  });

  it("replaces the ACTIVE key with a working new one; each provider keeps its own key", async () => {
    const r = AiCredentialResultSchema.parse(
      (
        await call(admin, "POST", "/ai/providers/openai/credentials", {
          apiKey: OPENAI_2,
          label: "OpenAI rotated",
        })
      ).body,
    );
    expect(r.credential.status).toBe("ACTIVE");
    ids["openai2"] = r.credential.id;
    expect(
      await dbo.aiProviderCredential.findUniqueOrThrow({ where: { id: ids["openai1"]! } }),
    ).toMatchObject({
      status: "DISABLED",
      replacedById: r.credential.id,
    });
    for (const [provider, key] of [
      ["anthropic", ANTHROPIC],
      ["gemini", GEMINI],
    ] as const) {
      const c = AiCredentialResultSchema.parse(
        (
          await call(admin, "POST", `/ai/providers/${provider}/credentials`, {
            apiKey: key,
            label: provider,
          })
        ).body,
      );
      expect([c.credential.status, c.test.code]).toEqual(["ACTIVE", "ok"]);
      ids[provider] = c.credential.id;
    }
    const active = await dbo.aiProviderCredential.findMany({
      where: { status: "ACTIVE" },
      select: { provider: true },
    });
    expect(active.map((a) => a.provider).sort()).toEqual(["ANTHROPIC", "GEMINI", "OPENAI"]);
  });

  it("tests, re-activates, disables and revokes keys", async () => {
    const t = AiCredentialResultSchema.parse(
      (await call(admin, "POST", `/ai/credentials/${ids["openai1"]}/test`)).body,
    );
    expect([t.test.code, t.credential.status]).toEqual(["ok", "DISABLED"]);
    const a = AiCredentialResultSchema.parse(
      (await call(admin, "POST", `/ai/credentials/${ids["openai1"]}/activate`)).body,
    );
    expect(a.credential.status).toBe("ACTIVE");
    expect(
      (await dbo.aiProviderCredential.findUniqueOrThrow({ where: { id: ids["openai2"]! } })).status,
    ).toBe("DISABLED");
    expect((await call(admin, "POST", `/ai/credentials/${ids["gemini"]}/disable`)).status).toBe(
      200,
    );
    const revoked = await del(admin, `/ai/credentials/${ids["gemini"]}`);
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
    expect(
      await dbo.aiProviderCredential.findUniqueOrThrow({ where: { id: ids["gemini"]! } }),
    ).toMatchObject({
      status: "REVOKED",
      ciphertext: null,
    });
    expectError(
      await call(admin, "POST", `/ai/credentials/${ids["gemini"]}/test`),
      409,
      "CONFLICT_STATE",
    );
  });

  it("lists models with compatibility; unknown capabilities need verification and an explicit confirmation", async () => {
    // OpenAI reports no capabilities: both fake models stay unknown, nothing is enabled by itself.
    const refresh = AiModelRefreshResponseSchema.parse(
      (await call(admin, "POST", "/ai/providers/openai/models/refresh")).body,
    );
    // The DP-288 block's test model is not in the provider's list: it becomes UNAVAILABLE.
    expect(refresh).toEqual({ code: "ok", added: 2, updated: 0, unavailable: 1 });
    expect(
      await dbo.aiModel.findFirstOrThrow({ where: { modelId: "dp288-test-model" } }),
    ).toMatchObject({
      status: "UNAVAILABLE",
      compatible: false,
    });
    const openai = AiModelsResponseSchema.parse(
      (await call(viewer, "GET", "/ai/models?provider=openai")).body,
    ).items;
    const mini = openai.find((m) => m.modelId === "gpt-fake-mini")!;
    for (const m of openai.filter((x) => x.modelId !== "dp288-test-model")) {
      expect([
        m.status,
        m.compatible,
        m.requiresConfirmation,
        m.capabilities.textGeneration,
      ]).toEqual(["DISCOVERED", false, true, null]);
    }
    expect(await dbo.aiModel.count({ where: { status: "ENABLED" } })).toBe(0);
    let r = await call(admin, "POST", `/ai/models/${mini.id}/enable`, {
      confirmUnknownCapabilities: true,
    });
    expectError(r, 409, "CONFLICT_STATE");
    expect(r.body.error.details).toEqual([{ path: "(root)", rule: "not_verified" }]);
    expect((await call(admin, "POST", `/ai/models/${mini.id}/verify`)).body).toMatchObject({
      status: "VERIFIED",
      verifyCode: "capabilities_unknown",
      requiresConfirmation: true,
    });
    r = await call(admin, "POST", `/ai/models/${mini.id}/enable`, {});
    expectError(r, 409, "CONFLICT_STATE");
    expect(r.body.error.details).toEqual([
      { path: "confirmUnknownCapabilities", rule: "capabilities_unknown" },
    ]);
    r = await call(admin, "POST", `/ai/models/${mini.id}/enable`, {
      confirmUnknownCapabilities: true,
    });
    expect(r.body).toMatchObject({
      status: "ENABLED",
      compatible: true,
      requiresConfirmation: false,
    });
    expect(await lastAudit("ai.model.enable")).toMatchObject({
      actorUserId: admin.userId,
      metadata: expect.objectContaining({ code: "admin_confirmed" }),
    });
    // A later refresh keeps the confirmation (unknown stays unknown; nothing changes).
    expect(
      AiModelRefreshResponseSchema.parse(
        (await call(admin, "POST", "/ai/providers/openai/models/refresh")).body,
      ),
    ).toEqual({ code: "ok", added: 0, updated: 0, unavailable: 0 });
    expect((await dbo.aiModel.findUniqueOrThrow({ where: { id: mini.id } })).status).toBe(
      "ENABLED",
    );
    // Claude reports what its models are: the retired one is UNAVAILABLE and cannot be enabled,
    // the active one is enabled after verification without any confirmation.
    expect(
      AiModelRefreshResponseSchema.parse(
        (await call(admin, "POST", "/ai/providers/anthropic/models/refresh")).body,
      ),
    ).toEqual({ code: "ok", added: 2, updated: 0, unavailable: 0 });
    const claude = AiModelsResponseSchema.parse(
      (await call(viewer, "GET", "/ai/models?provider=anthropic")).body,
    ).items;
    const sonnet = claude.find((m) => m.modelId === "claude-fake-sonnet")!;
    const retired = claude.find((m) => m.modelId === "claude-fake-retired")!;
    expect([sonnet.status, sonnet.compatible, sonnet.requiresConfirmation]).toEqual([
      "DISCOVERED",
      true,
      false,
    ]);
    expect([retired.status, retired.compatible, retired.requiresConfirmation]).toEqual([
      "UNAVAILABLE",
      false,
      false,
    ]);
    r = await call(admin, "POST", `/ai/models/${retired.id}/enable`, {
      confirmUnknownCapabilities: true,
    });
    expectError(r, 409, "CONFLICT_STATE");
    expect((await call(admin, "POST", `/ai/models/${sonnet.id}/verify`)).body).toMatchObject({
      status: "VERIFIED",
      verifyCode: "ok",
    });
    expect((await call(admin, "POST", `/ai/models/${sonnet.id}/enable`)).body).toMatchObject({
      status: "ENABLED",
    });
    expectError(
      await call(viewer, "POST", "/ai/providers/openai/models/refresh"),
      403,
      "FORBIDDEN",
    );
    expectError(
      await call(admin, "POST", "/ai/providers/gemini/models/refresh"),
      409,
      "CONFLICT_STATE",
    );
    // Provider settings: on only with an ACTIVE key and an ENABLED default model of the provider.
    const setting = await dbo.aiProviderSetting.findUniqueOrThrow({
      where: { provider: "OPENAI" },
    });
    const on = await call(admin, "POST", "/ai/providers/openai/settings", {
      enabled: true,
      defaultModelId: mini.id,
      version: setting.version,
    });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body).toMatchObject({ provider: "OPENAI", enabled: true, defaultModelId: mini.id });
    const otherProvider = await call(admin, "POST", "/ai/providers/anthropic/settings", {
      enabled: true,
      defaultModelId: mini.id,
      version: 1,
    });
    expectError(otherProvider, 409, "CONFLICT_STATE");
    const overview = AiOverviewResponseSchema.parse(
      (await call(viewer, "GET", "/ai/overview")).body,
    );
    expect(overview.blockers).not.toContain("no_provider_key");
  });

  it("closes every provider route when the owner switches AI off, keeping the data", async () => {
    const before = await dbo.aiProviderCredential.count();
    expect(
      (await owner.call("POST", AI, { enabled: false, reason: "DP-289 test done" })).status,
    ).toBe(200);
    for (const [m, p] of [
      ["GET", "/ai/providers"],
      ["GET", "/ai/models"],
      ["POST", "/ai/providers/openai/models/refresh"],
      ["POST", `/ai/credentials/${ids["openai1"]}/test`],
    ] as const) {
      expectError(await call(admin, m, p), 404, "NOT_FOUND");
    }
    expect(await dbo.aiProviderCredential.count()).toBe(before);
  });

  it("refuses provider calls and new keys while the transport is off", async () => {
    await restart({ DP_AI_TRANSPORT: undefined, DP_AI_ENC_KEYS: undefined });
    expect(
      (await owner.call("POST", AI, { enabled: true, reason: "DP-289 transport off" })).status,
    ).toBe(200);
    const list = AiProvidersResponseSchema.parse((await call(admin, "GET", "/ai/providers")).body);
    expect(list.transport).toBe("off");
    const add = await call(admin, "POST", "/ai/providers/openai/credentials", {
      apiKey: `sk-proj-${hex(20)}`,
      label: "off",
    });
    expectError(add, 409, "CONFLICT_STATE");
    expect(add.body.error.details).toEqual([{ path: "(root)", rule: "transport_off" }]);
    expectError(
      await call(admin, "POST", `/ai/credentials/${ids["openai1"]}/test`),
      409,
      "CONFLICT_STATE",
    );
    expect((await owner.call("POST", AI, { enabled: false, reason: "DP-289 done" })).status).toBe(
      200,
    );
  });
});

// DP-290 (ADR-030 D6, D7): the budget and reservation engine. The money moves only through the
// database functions (ai_reserve / ai_start / ai_settle / ai_release / ai_mark_unknown / ai_sweep);
// these tests call them as the API does (dp_app, staff context for reservations) and drive the
// configuration over HTTP. No provider is called: the engine is provider-agnostic.
describe("DP-290: budgets, reservations and settlement", () => {
  type Tx = Prisma.TransactionClient;
  const AI = "/owner/modules/ai/platform";
  let owner: Staff;
  let admin: Staff; // super admin + ai_administrator (ai:invoke)
  let viewer: Staff; // ai_viewer
  let modelId = "";
  let priceId = "";
  let dailyId = "";
  let est: typeof import("../../src/ai/engine/estimate.js");
  const token = (s: Staff) => (s as unknown as { token: string }).token;
  const digest = (n: number) => createHash("sha256").update(`input-${n}`).digest("hex");
  let seq = 0;
  const key = () => `dp290-${Date.now()}-${seq++}`;

  function inCtx<T>(who: Staff | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return asApp.$transaction(async (tx) => {
      if (who) await tx.$executeRaw`SELECT leads_rls_set_staff_context(${token(who)})`;
      return fn(tx);
    });
  }
  interface Reserved {
    operation_id: string | null;
    outcome: string;
    reserved_micros: bigint | null;
  }
  function reserve(
    who: Staff | null,
    o: {
      site?: string | null;
      in?: number;
      out?: number;
      key?: string;
      digest?: string;
      capDaily?: bigint | null;
    } = {},
  ): Promise<Reserved> {
    return inCtx(who, async (tx) => {
      const r = await tx.$queryRaw<Reserved[]>`
        SELECT operation_id, outcome, reserved_micros FROM ai_reserve('DIAGNOSTIC_PING'::"AiTaskType",
          ${o.site ?? null}::uuid, ${o.key ?? key()}, ${o.digest ?? digest(1)}, ${o.in ?? 100}::integer,
          ${o.out ?? 16}::integer, 'int-test', ${o.capDaily ?? null}::bigint, NULL::bigint)`;
      return r[0]!;
    });
  }
  const fn1 = async (sql: Promise<{ r: string }[]>) => (await sql)[0]!.r;
  const start = (id: string) =>
    fn1(asApp.$queryRaw<{ r: string }[]>`SELECT ai_start(${id}::uuid, 'int-test', 60) AS "r"`);
  const settle = (id: string, status: string, inT: number, out: number) =>
    fn1(
      asApp.$queryRaw<
        { r: string }[]
      >`SELECT ai_settle(${id}::uuid, ${status}::"AiOperationStatus", ${inT}::integer, 0, 0, ${out}::integer, 0, NULL, NULL) AS "r"`,
    );
  const release = (id: string, why: string) =>
    fn1(asApp.$queryRaw<{ r: string }[]>`SELECT ai_release(${id}::uuid, ${why}) AS "r"`);
  const unknown = (id: string) =>
    fn1(asApp.$queryRaw<{ r: string }[]>`SELECT ai_mark_unknown(${id}::uuid, 'timeout') AS "r"`);
  const sweep = async () =>
    (
      await asApp.$queryRaw<
        { released: number; assumed: number; cancelled: number }[]
      >`SELECT released, assumed, cancelled FROM ai_sweep()`
    )[0]!;
  const mismatches = async () =>
    Number(
      (
        await asApp.$queryRaw<
          { n: bigint }[]
        >`SELECT count(*)::bigint AS "n" FROM ai_ledger_mismatches()`
      )[0]!.n,
    );
  const amountFor = async (inT: number, out: number) => {
    // The margin from the table owner's view (AiSettings is behind row-level security for dp_app).
    const margin = (await dbo.aiSettings.findUniqueOrThrow({ where: { id: 1 } })).safetyMarginPct;
    return (
      await asApp.$queryRaw<
        { a: bigint }[]
      >`SELECT ai_upper_cost_micros(${priceId}::uuid, ${inT}::bigint, ${out}::bigint, ${margin}::integer) AS "a"`
    )[0]!.a;
  };
  async function today(budgetId: string) {
    const u = await dbo.aiBudgetUsage.findFirst({
      where: { budgetId },
      orderBy: { periodStart: "desc" },
    });
    return {
      reserved: u?.reservedMicros ?? 0n,
      committed: u?.committedMicros ?? 0n,
      assumed: u?.assumedMicros ?? 0n,
    };
  }
  async function setDailyLimit(limit: bigint) {
    const b = await dbo.aiBudget.findUniqueOrThrow({ where: { id: dailyId } });
    const res = await admin.call("POST", `/ai/budgets/${dailyId}`, {
      limitMicros: limit.toString(),
      warnPct: b.warnPct,
      active: true,
      version: b.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  async function setConcurrency(n: number) {
    const s = await admin.call("GET", "/ai/settings");
    const res = await admin.call("POST", "/ai/settings", { ...s.body, maxConcurrency: n });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  async function clearActive() {
    for (const o of await dbo.aiOperation.findMany({
      where: { status: { in: ["RESERVED", "IN_FLIGHT"] } },
    })) {
      if (o.status === "RESERVED") await release(o.id, "release");
      else await settle(o.id, "FAILED", 0, 0);
    }
  }

  beforeAll(async () => {
    est = (await import(
      pathToFileURL(path.join(API_DIR, "dist/ai/engine/estimate.js")).href
    )) as typeof est;
    const pw = (await dbo.user.findUniqueOrThrow({ where: { id: root.userId } })).passwordHash!;
    owner = new Staff("root-290", root.userId, await session(root.userId));
    admin = await staff("ai-admin-290", pw, [{ role: "platform_super_admin" }], root.userId);
    viewer = await staff("ai-viewer-290", pw, [], root.userId);
    // Earlier blocks leave an ENABLED OpenAI model, an ACTIVE OpenAI key and the provider on.
    const model = await dbo.aiModel.findFirstOrThrow({
      where: { modelId: "gpt-fake-mini", status: "ENABLED" },
    });
    modelId = model.id;
    expect(
      await dbo.aiProviderCredential.count({ where: { provider: "OPENAI", status: "ACTIVE" } }),
    ).toBe(1);
    expect(
      (await dbo.aiProviderSetting.findUniqueOrThrow({ where: { provider: "OPENAI" } })).enabled,
    ).toBe(true);
  });

  it("refuses every reservation while AI is off", async () => {
    expect(
      (await dbo.platformModuleState.findUniqueOrThrow({ where: { moduleKey: "ai" } })).enabled,
    ).toBe(false);
    expect((await reserve(owner)).outcome).toBe("ai_disabled");
  });

  it("is configured over HTTP: dated prices, task limits, settings and budgets, by AI administrators only", async () => {
    expect(
      (await owner.call("POST", AI, { enabled: true, reason: "DP-290 engine test" })).status,
    ).toBe(200);
    expect(
      (await owner.call("POST", `/staff/${admin.userId}/roles`, { roleKey: "ai_administrator" }))
        .status,
    ).toBe(201);
    expect(
      (await owner.call("POST", `/staff/${viewer.userId}/roles`, { roleKey: "ai_viewer" })).status,
    ).toBe(201);
    const price = await admin.call("POST", `/ai/models/${modelId}/prices`, {
      inputMicrosPerMTok: "400000",
      cachedReadMicrosPerMTok: "100000",
      outputMicrosPerMTok: "1600000",
      sourceNote: "DP-290 test price (fake)",
    });
    expect(price.status, JSON.stringify(price.body)).toBe(201);
    priceId = price.body.id;
    const back = await admin.call("POST", `/ai/models/${modelId}/prices`, {
      inputMicrosPerMTok: "1",
      cachedReadMicrosPerMTok: "1",
      outputMicrosPerMTok: "1",
      effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
      sourceNote: "backdated",
    });
    expectError(back, 400, "VALIDATION_FAILED");
    expectError(
      await viewer.call("POST", `/ai/models/${modelId}/prices`, {
        inputMicrosPerMTok: "1",
        cachedReadMicrosPerMTok: "1",
        outputMicrosPerMTok: "1",
        sourceNote: "no",
      }),
      403,
      "FORBIDDEN",
    );
    const tasks = AiTasksResponseSchema.parse((await viewer.call("GET", "/ai/tasks")).body).items;
    const ping = tasks.find((t) => t.task === "DIAGNOSTIC_PING")!;
    const t = await admin.call("POST", "/ai/tasks/diagnostic_ping", {
      enabled: true,
      modelId,
      maxInputTokens: 2000,
      maxOutputTokens: 64,
      thinkingBudget: 0,
      maxCostPerOpMicros: "50000",
      temperatureMilli: null,
      version: ping.version,
    });
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    await setConcurrency(20);
    // Budgets: the platform daily budget of the DP-288 block, a new platform monthly one, BV's site
    // monthly budget of the DP-288 block.
    const list = AiBudgetsResponseSchema.parse((await viewer.call("GET", "/ai/budgets")).body);
    dailyId = list.items.find(
      (b) => b.scope === "PLATFORM" && b.period === "DAILY" && b.active,
    )!.id;
    const monthly = await admin.call("POST", "/ai/budgets", {
      scope: "PLATFORM",
      period: "MONTHLY",
      limitMicros: "100000000",
    });
    expect(monthly.status, JSON.stringify(monthly.body)).toBe(201);
    AiBudgetSchema.parse(monthly.body);
    expectError(
      await admin.call("POST", "/ai/budgets", {
        scope: "PLATFORM",
        period: "MONTHLY",
        limitMicros: "1",
      }),
      409,
      "CONFLICT_STATE",
    );
    expectError(
      await viewer.call("POST", "/ai/budgets", {
        scope: "PLATFORM",
        period: "MONTHLY",
        limitMicros: "1",
      }),
      403,
      "FORBIDDEN",
    );
    await setDailyLimit(50_000_000n);
  });

  it("reserves only for ai:invoke holders, with the amount computed in the database (parity with the API's formula)", async () => {
    expect((await reserve(viewer)).outcome).toBe("not_allowed");
    expect((await reserve(null)).outcome).toBe("not_allowed");
    const before = await today(dailyId);
    const r = await reserve(admin, { in: 1000, out: 64 });
    expect(r.outcome).toBe("reserved");
    const price = await dbo.aiModelPrice.findUniqueOrThrow({ where: { id: priceId } });
    const settings = await dbo.aiSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(r.reserved_micros).toBe(est.upperCostMicros(price, 1000, 64, settings.safetyMarginPct));
    for (const [i, o] of [
      [123, 45],
      [0, 0],
      [99_999, 1],
      [2000, 64],
    ] as const) {
      expect(await amountFor(i, o)).toBe(
        est.upperCostMicros(price, i, o, settings.safetyMarginPct),
      );
      const actual = await asApp.$queryRaw<
        { a: bigint }[]
      >`SELECT ai_actual_cost_micros(${priceId}::uuid, ${i}::bigint, 7::bigint, 0::bigint, ${o}::bigint) AS "a"`;
      expect(actual[0]!.a).toBe(
        est.actualCostMicros(price, {
          inputTokens: i,
          cachedReadTokens: 7,
          cacheWriteTokens: 0,
          outputTokens: o,
        }),
      );
    }
    expect((await today(dailyId)).reserved).toBe(before.reserved + r.reserved_micros!);
    expect(
      await dbo.aiLedgerEntry.count({ where: { operationId: r.operation_id!, kind: "RESERVE" } }),
    ).toBe(2);
    expect(await release(r.operation_id!, "release")).toBe("released");
    expect(await mismatches()).toBe(0);
  });

  it("is idempotent per key, and refuses what breaks a limit", async () => {
    const k = key();
    const a = await reserve(admin, { key: k });
    const b = await reserve(admin, { key: k });
    expect([a.outcome, b.outcome, b.operation_id]).toEqual([
      "reserved",
      "existing",
      a.operation_id,
    ]);
    expect((await reserve(admin, { key: k, digest: digest(2) })).outcome).toBe(
      "idempotency_conflict",
    );
    expect(await dbo.aiOperation.count({ where: { idempotencyKey: k } })).toBe(1);
    expect((await reserve(admin, { in: 2001 })).outcome).toBe("input_too_large");
    expect((await reserve(admin, { out: 65 })).outcome).toBe("output_too_large");
    expect(await release(a.operation_id!, "release")).toBe("released");
    expect(await release(a.operation_id!, "release")).toBe("already_released");
    expect(await mismatches()).toBe(0);
  });

  it("starts, settles (idempotently) and records an overrun", async () => {
    const before = await today(dailyId);
    const r = await reserve(admin, { in: 100, out: 16 });
    expect(await start(r.operation_id!)).toBe("started");
    expect(await start(r.operation_id!)).toBe("already_started");
    expect(await release(r.operation_id!, "cancel")).toBe("in_flight");
    expect(await settle(r.operation_id!, "SUCCEEDED", 50, 10)).toBe("settled");
    expect(await settle(r.operation_id!, "SUCCEEDED", 50, 10)).toBe("already_settled");
    const op = await dbo.aiOperation.findUniqueOrThrow({ where: { id: r.operation_id! } });
    expect(op).toMatchObject({
      status: "SUCCEEDED",
      costBasis: "LOCAL_USAGE",
      actInputTokens: 50,
      actOutputTokens: 10,
    });
    const after = await today(dailyId);
    expect(after.reserved).toBe(before.reserved);
    expect(after.committed).toBe(before.committed + op.actualMicros!);
    // A provider that reports more than the bound: the money is committed, the overrun recorded.
    const o = await reserve(admin, { in: 10, out: 1 });
    await start(o.operation_id!);
    expect(await settle(o.operation_id!, "SUCCEEDED", 5_000_000, 1)).toBe("settled_overrun");
    expect(
      await dbo.aiOperation.findUniqueOrThrow({ where: { id: o.operation_id! } }),
    ).toMatchObject({ errorCode: "overrun" });
    expect(
      await dbo.aiLedgerEntry.count({ where: { operationId: o.operation_id!, kind: "OVERRUN" } }),
    ).toBe(2);
    expect(await mismatches()).toBe(0);
  });

  it("counts an unknown outcome as spent, never retries, and settles a late answer", async () => {
    const before = await today(dailyId);
    const r = await reserve(admin);
    await start(r.operation_id!);
    expect(await unknown(r.operation_id!)).toBe("assumed");
    expect(await unknown(r.operation_id!)).toBe("already_unknown");
    expect((await today(dailyId)).assumed).toBe(before.assumed + r.reserved_micros!);
    expect(await start(r.operation_id!)).toBe("not_reserved");
    expect(await settle(r.operation_id!, "SUCCEEDED", 40, 4)).toBe("settled");
    const op = await dbo.aiOperation.findUniqueOrThrow({ where: { id: r.operation_id! } });
    expect(op.status).toBe("DISCARDED");
    const after = await today(dailyId);
    expect(after.assumed).toBe(before.assumed);
    expect(after.committed).toBe(before.committed + op.actualMicros!);
    expect(await mismatches()).toBe(0);
  });

  it("reconciles expired leases (a crashed worker): reservations released, calls counted as spent", async () => {
    const a = await reserve(admin);
    const b = await reserve(admin);
    await start(b.operation_id!);
    await dbo.aiOperation.updateMany({
      where: { id: { in: [a.operation_id!, b.operation_id!] } },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });
    const r = await sweep();
    expect(r.released).toBeGreaterThanOrEqual(1);
    expect(r.assumed).toBeGreaterThanOrEqual(1);
    expect(
      (await dbo.aiOperation.findUniqueOrThrow({ where: { id: a.operation_id! } })).status,
    ).toBe("EXPIRED");
    expect(
      (await dbo.aiOperation.findUniqueOrThrow({ where: { id: b.operation_id! } })).status,
    ).toBe("UNKNOWN");
    expect(await mismatches()).toBe(0);
  });

  it("never lets concurrent reservations exceed the budget together", async () => {
    await clearActive();
    const amount = await amountFor(100, 16);
    const used = await today(dailyId);
    const limit = used.reserved + used.committed + used.assumed + amount * 5n + amount / 2n;
    await setDailyLimit(limit);
    const results = await Promise.all(Array.from({ length: 30 }, () => reserve(admin)));
    const ok = results.filter((r) => r.outcome === "reserved");
    expect(ok).toHaveLength(5);
    expect(new Set(results.filter((r) => r.outcome !== "reserved").map((r) => r.outcome))).toEqual(
      new Set(["budget_exceeded"]),
    );
    const now = await today(dailyId);
    expect(now.reserved + now.committed + now.assumed).toBeLessThanOrEqual(limit);
    expect(await mismatches()).toBe(0);
    // The concurrency limit counts running and reserved operations.
    await setDailyLimit(50_000_000n);
    await setConcurrency(5);
    expect((await reserve(admin)).outcome).toBe("concurrency_limit");
    await clearActive();
    await setConcurrency(20);
  });

  it("applies the site's budget and the local ceiling on top of the platform budgets", async () => {
    const site = await dbo.aiBudget.findFirstOrThrow({
      where: { scope: "SITE", siteId: BV, active: true },
    });
    const amount = await amountFor(100, 16);
    const siteBefore = await today(site.id);
    const r = await reserve(admin, { site: BV });
    expect(r.outcome).toBe("reserved");
    expect((await today(site.id)).reserved).toBe(siteBefore.reserved + amount);
    expect(
      await dbo.aiLedgerEntry.count({ where: { operationId: r.operation_id!, kind: "RESERVE" } }),
    ).toBe(3);
    await release(r.operation_id!, "release");
    // A site budget with no room refuses even with platform room left.
    const s = await admin.call("POST", `/ai/budgets/${site.id}`, {
      limitMicros: (
        siteBefore.reserved +
        siteBefore.committed +
        siteBefore.assumed +
        1n
      ).toString(),
      warnPct: 80,
      active: true,
      version: site.version,
    });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect((await reserve(admin, { site: BV })).outcome).toBe("budget_exceeded");
    expect((await reserve(admin)).outcome).toBe("reserved");
    // The local ceiling (live in the local deployment) lowers the daily limit.
    const used = await today(dailyId);
    expect(
      (
        await reserve(admin, {
          capDaily: used.reserved + used.committed + used.assumed + amount - 1n,
        })
      ).outcome,
    ).toBe("budget_exceeded");
    await clearActive();
    expect(await mismatches()).toBe(0);
  });

  it("shows operations without any text, and reports the provider difference separately", async () => {
    const ops = AiOperationsResponseSchema.parse(
      (await viewer.call("GET", "/ai/operations?limit=100")).body,
    );
    expect(ops.items.length).toBeGreaterThan(5);
    for (const o of ops.items) {
      expect(
        Object.keys(o).filter((k) => /prompt|response|text|content|input$|output$/i.test(k)),
      ).toEqual([]);
    }
    const day = new Date().toISOString().slice(0, 10);
    const before = AiReconciliationResponseSchema.parse(
      (await viewer.call("GET", `/ai/reconciliation?from=${day}&to=${day}`)).body,
    );
    const local = before.items.find((r) => r.provider === "OPENAI");
    expect(local?.providerMicros).toBeNull();
    const add = await admin.call("POST", "/ai/reconciliation", {
      provider: "OPENAI",
      day,
      providerAmountMicros: "1234",
    });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expectError(
      await admin.call("POST", "/ai/reconciliation", {
        provider: "OPENAI",
        day,
        providerAmountMicros: "1",
      }),
      409,
      "CONFLICT_STATE",
    );
    const after = AiReconciliationResponseSchema.parse(
      (await viewer.call("GET", `/ai/reconciliation?from=${day}&to=${day}`)).body,
    );
    const row = after.items.find((r) => r.provider === "OPENAI")!;
    expect(row.providerMicros).toBe("1234");
    expect(BigInt(row.differenceMicros!)).toBe(
      1234n - BigInt(row.localMicros) - BigInt(row.assumedMicros),
    );
    const audits = await dbo.auditEvent.findMany({
      where: { action: { startsWith: "ai." } },
      select: { metadata: true },
    });
    expect(JSON.stringify(audits)).not.toMatch(/prompt|response/i);
  });

  it("cancels queued reservations when the owner switches AI off; running calls end by settlement or lease; data kept", async () => {
    const queued = await reserve(admin);
    const running = await reserve(admin);
    await start(running.operation_id!);
    expect((await owner.call("POST", AI, { enabled: false, reason: "DP-290 done" })).status).toBe(
      200,
    );
    // The switch listener sweeps at once; sweep again to be independent of timing.
    await sweep();
    expect(
      (await dbo.aiOperation.findUniqueOrThrow({ where: { id: queued.operation_id! } })).status,
    ).toBe("CANCELLED");
    expect(await start(queued.operation_id!)).toBe("ai_disabled");
    expect((await reserve(admin)).outcome).toBe("ai_disabled");
    // The running call's answer arrives after the switch-off: cost settled, output discarded.
    expect(await settle(running.operation_id!, "DISCARDED", 10, 2)).toBe("settled");
    expect(await mismatches()).toBe(0);
    for (const p of ["/ai/budgets", "/ai/operations", "/ai/tasks", "/ai/settings"]) {
      expectError(await admin.call("GET", p), 404, "NOT_FOUND");
    }
    expect(await dbo.aiOperation.count()).toBeGreaterThanOrEqual(10);
  });
});

// DP-291 (ADR-030 D6–D8): the shared operation service end to end over HTTP with the fake
// provider (DP_AI_TRANSPORT=fake: no network, no paid call) — permission → switch → task → input
// checks → estimate → reservation → queue → one call → settlement; drafts for their actor only;
// cancel; the owner's switch-off with calls queued and running; nothing of a text stored.
describe("DP-291: the AI operation service", () => {
  const AI = "/owner/modules/ai/platform";
  let factory: { createApiApp(o: { logger: false }): Promise<App> };
  let owner: Staff;
  let admin: Staff; // ai_administrator (ai:invoke)
  let other: Staff; // another ai_administrator
  let viewer: Staff; // ai_viewer: no ai:invoke
  let runner: { whenIdle(): Promise<void>; state(id: string): string };
  let fake: { generateCalls: number };
  let seq = 0;
  const key = () => `dp291-${Date.now()}-${seq++}`;
  const CANARY = `canary-${randomBytes(6).toString("hex")}`;

  async function restart(env: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await app.close();
    app = await factory.createApiApp({ logger: false });
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const mod = (await import(
      pathToFileURL(path.join(API_DIR, "dist/ai/runner/runner.service.js")).href
    )) as { AiRunnerService: abstract new (...a: never[]) => unknown };
    runner = (app as unknown as { get(t: unknown): typeof runner }).get(mod.AiRunnerService);
  }
  const run = (who: Staff, input: string, k = key(), task = "DIAGNOSTIC_PING") =>
    who.call("POST", "/ai/operations", { task, input, idempotencyKey: k });
  const detail = async (who: Staff, id: string) => {
    const res = await who.call("GET", `/ai/operations/${id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return AiOperationDetailSchema.parse(res.body);
  };
  const row = (id: string) => dbo.aiOperation.findUniqueOrThrow({ where: { id } });
  const mismatches = async () =>
    Number(
      (
        await asApp.$queryRaw<
          { n: bigint }[]
        >`SELECT count(*)::bigint AS "n" FROM ai_ledger_mismatches()`
      )[0]!.n,
    );
  async function started(input: string, who = admin) {
    const res = await run(who, input);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    return AiOperationCreatedSchema.parse(res.body).operationId;
  }
  async function until(fn: () => Promise<boolean> | boolean, ms = 5_000) {
    const end = Date.now() + ms;
    while (!(await fn())) {
      if (Date.now() > end) throw new Error("condition not reached");
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  beforeAll(async () => {
    factory = (await import(
      pathToFileURL(path.join(API_DIR, "dist/app.factory.js")).href
    )) as typeof factory;
    fake = (
      (await import(pathToFileURL(path.join(API_DIR, "dist/ai/providers/fake.js")).href)) as {
        FakeAdapter: { generateCalls: number };
      }
    ).FakeAdapter;
    await restart({
      DP_AI_TRANSPORT: "fake",
      DP_AI_ENC_KEYS: AI_ENC_KEYS,
      AI_SWEEP_INTERVAL_SECONDS: "0",
    });
    const pw = (await dbo.user.findUniqueOrThrow({ where: { id: root.userId } })).passwordHash!;
    owner = new Staff("root-291", root.userId, await session(root.userId));
    admin = await staff("ai-admin-291", pw, [{ role: "platform_super_admin" }], root.userId);
    other = await staff("ai-other-291", pw, [{ role: "platform_super_admin" }], root.userId);
    viewer = await staff("ai-viewer-291", pw, [], root.userId);
  });

  afterAll(async () => {
    await restart({
      DP_AI_TRANSPORT: undefined,
      DP_AI_ENC_KEYS: undefined,
      AI_SWEEP_INTERVAL_SECONDS: undefined,
    });
  });

  it("is a 404 while AI is off, and no provider call is made", async () => {
    const calls = fake.generateCalls;
    expectError(await run(owner, "ping"), 404, "NOT_FOUND");
    expect(fake.generateCalls).toBe(calls);
  });

  it("runs a ping end to end: reservation, one call, settlement, a draft for its actor only", async () => {
    expect((await owner.call("POST", AI, { enabled: true, reason: "DP-291 test" })).status).toBe(
      200,
    );
    for (const [who, roleKey] of [
      [admin, "ai_administrator"],
      [other, "ai_administrator"],
      [viewer, "ai_viewer"],
    ] as const) {
      expect((await owner.call("POST", `/staff/${who.userId}/roles`, { roleKey })).status).toBe(
        201,
      );
    }
    // Room in the budgets left by the DP-290 block; nothing active from it.
    for (const b of await dbo.aiBudget.findMany({ where: { active: true, scope: "PLATFORM" } })) {
      const res = await admin.call("POST", `/ai/budgets/${b.id}`, {
        limitMicros: "100000000",
        warnPct: b.warnPct,
        active: true,
        version: b.version,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    expect(
      await dbo.aiOperation.count({ where: { status: { in: ["RESERVED", "IN_FLIGHT"] } } }),
    ).toBe(0);
    const settings = await admin.call("GET", "/ai/settings");
    expect(
      (await admin.call("POST", "/ai/settings", { ...settings.body, maxConcurrency: 20 })).status,
    ).toBe(200);

    // DP-292: the overview tells the admin what each user may do; with the fake transport and the
    // configuration of the earlier blocks nothing is missing for a call.
    const ov = (who: Staff) =>
      who.call("GET", "/ai/overview").then((r) => AiOverviewResponseSchema.parse(r.body));
    expect(await ov(admin)).toMatchObject({
      callsPossible: true,
      blockers: [],
      transport: "fake",
      permissions: {
        usageRead: true,
        providerManage: true,
        modelManage: true,
        budgetManage: true,
        invoke: true,
        auditRead: true,
      },
    });
    expect((await ov(viewer)).permissions).toEqual({
      usageRead: true,
      providerManage: false,
      modelManage: false,
      budgetManage: false,
      invoke: false,
      auditRead: false,
    });

    const calls = fake.generateCalls;
    const k = key();
    const res = await run(admin, `ping ${CANARY}`, k);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const created = AiOperationCreatedSchema.parse(res.body);
    expect(created.existing).toBe(false);
    await runner.whenIdle();
    expect(fake.generateCalls).toBe(calls + 1);
    const d = await detail(admin, created.operationId);
    expect(d).toMatchObject({ own: true, runner: "none", result: { draft: true, text: "pong" } });
    expect(d.operation).toMatchObject({
      status: "SUCCEEDED",
      costBasis: "LOCAL_USAGE",
      errorCode: null,
    });
    expect(d.operation.inputTokens).toBeGreaterThan(0);
    expect(BigInt(d.operation.actualMicros!)).toBeLessThanOrEqual(
      BigInt(d.operation.reservedMicros),
    );
    // The estimate is an upper bound of what the provider reported.
    expect(d.operation.estInputTokens).toBeGreaterThanOrEqual(d.operation.inputTokens!);
    expect(d.operation.estOutputTokens).toBeGreaterThanOrEqual(d.operation.outputTokens!);

    // Another invoker sees the operation (ai_usage:read) but never its draft.
    const seen = await detail(other, created.operationId);
    expect(seen).toMatchObject({ own: false, result: null });
    expectError(
      await viewer.call("GET", `/ai/operations/${created.operationId}`),
      403,
      "FORBIDDEN",
    );
    expectError(
      await viewer.call("POST", "/ai/operations", {
        task: "DIAGNOSTIC_PING",
        input: "ping",
        idempotencyKey: key(),
      }),
      403,
      "FORBIDDEN",
    );

    // Idempotent: the same key and input → the same operation, no second call.
    const again = AiOperationCreatedSchema.parse((await run(admin, `ping ${CANARY}`, k)).body);
    expect(again).toMatchObject({ operationId: created.operationId, existing: true });
    await runner.whenIdle();
    expect(fake.generateCalls).toBe(calls + 1);
    expectError(await run(admin, "ping changed", k), 409, "CONFLICT_STATE");

    // Nothing of the input or the answer is stored: a digest, counts, amounts and codes.
    const stored = await row(created.operationId);
    expect(stored.inputDigest).toMatch(/^[0-9a-f]{64}$/);
    const everything = JSON.stringify(
      [
        stored,
        await dbo.aiLedgerEntry.findMany({ where: { operationId: created.operationId } }),
        await dbo.auditEvent.findMany({ where: { action: { startsWith: "ai." } } }),
        // DP-297: the held texts are ciphertexts; the input was wiped when the job was claimed.
        await dbo.aiTransient.findMany({ where: { operationId: created.operationId } }),
      ],
      (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
    );
    expect(everything).not.toContain(CANARY);
    expect(everything).not.toContain("pong");
    const held = await dbo.aiTransient.findMany({ where: { operationId: created.operationId } });
    expect(held.find((t) => t.kind === "INPUT")).toMatchObject({ ciphertext: null });
    expect(held.find((t) => t.kind === "RESULT")?.ciphertext).toMatch(/^v1:/);
    expect(await mismatches()).toBe(0);
  });

  it("refuses before any reservation: personal data, input length, unavailable task, budget", async () => {
    const calls = fake.generateCalls;
    const ops = await dbo.aiOperation.count();
    const pd = await run(admin, `mail ${CANARY}@example.nl`);
    expectError(pd, 400, "VALIDATION_FAILED");
    expect(JSON.stringify(pd.body)).toContain("input_rejected_personal_data:email");
    expect(JSON.stringify(pd.body)).not.toContain(CANARY);
    expectError(await run(admin, "x".repeat(501)), 400, "VALIDATION_FAILED");
    expectError(await run(admin, "translate this", key(), "TRANSLATION"), 409, "CONFLICT_STATE");
    const daily = await dbo.aiBudget.findFirstOrThrow({
      where: { active: true, scope: "PLATFORM", period: "DAILY" },
    });
    const tight = await admin.call("POST", `/ai/budgets/${daily.id}`, {
      limitMicros: "1",
      warnPct: daily.warnPct,
      active: true,
      version: daily.version,
    });
    expect(tight.status).toBe(200);
    const over = await run(admin, "ping");
    expectError(over, 409, "CONFLICT_STATE");
    expect(JSON.stringify(over.body)).toContain("budget_exceeded");
    const d2 = await dbo.aiBudget.findUniqueOrThrow({ where: { id: daily.id } });
    expect(
      (
        await admin.call("POST", `/ai/budgets/${daily.id}`, {
          limitMicros: "100000000",
          warnPct: d2.warnPct,
          active: true,
          version: d2.version,
        })
      ).status,
    ).toBe(200);
    expect(await dbo.aiOperation.count()).toBe(ops);
    expect(fake.generateCalls).toBe(calls);
    const denied = await dbo.auditEvent.findMany({
      where: { action: "ai.operation.denied" },
      select: { reason: true, metadata: true },
    });
    expect(denied.map((a) => a.reason)).toEqual(
      expect.arrayContaining([
        "input_rejected_personal_data",
        "input_too_large",
        "task_not_available",
        "budget_exceeded",
      ]),
    );
    expect(JSON.stringify(denied)).not.toContain(CANARY);
  });

  it("settles a provider refusal at cost 0 and an uncertain outcome as spent; never repeats a call", async () => {
    const calls = fake.generateCalls;
    const refused = await started("[fake:error=provider_unavailable] ping");
    const lost = await started("[fake:error=timeout] ping");
    await runner.whenIdle();
    expect(fake.generateCalls).toBe(calls + 2);
    expect(await row(refused)).toMatchObject({
      status: "FAILED",
      errorCode: "provider_unavailable",
      actualMicros: 0n,
    });
    const u = await row(lost);
    expect(u).toMatchObject({ status: "UNKNOWN", errorCode: "timeout", costBasis: "ASSUMED" });
    expect((await detail(admin, lost)).result).toBeNull();
    await new Promise((r) => setTimeout(r, 200));
    expect(fake.generateCalls).toBe(calls + 2);
    expect(
      await dbo.auditEvent.count({ where: { action: "ai.operation.unknown", resourceId: lost } }),
    ).toBe(1);
    expect(await mismatches()).toBe(0);
  });

  it("lets the actor cancel: a queued job costs nothing, a running call ends UNKNOWN; others cannot", async () => {
    const calls = fake.generateCalls;
    const a = await started("[fake:delay=3000] a");
    const b = await started("[fake:delay=3000] b");
    const c = await started("[fake:delay=3000] c");
    // DP-297: the database says what runs; both calls have reached the provider.
    await until(() => fake.generateCalls === calls + 2);
    expect(runner.state(a)).toBe("running");
    expect(runner.state(b)).toBe("running");
    expect((await detail(admin, c)).runner).toBe("queued");
    expect((await detail(admin, a)).runner).toBe("running");
    expectError(await other.call("POST", `/ai/operations/${c}/cancel`), 404, "NOT_FOUND");
    expect((await admin.call("POST", `/ai/operations/${c}/cancel`)).body).toEqual({
      operationId: c,
      stopped: "queued",
    });
    expect((await admin.call("POST", `/ai/operations/${a}/cancel`)).body).toEqual({
      operationId: a,
      stopped: "running",
    });
    expect((await admin.call("POST", `/ai/operations/${b}/cancel`)).body).toEqual({
      operationId: b,
      stopped: "running",
    });
    await runner.whenIdle();
    expect(await row(c)).toMatchObject({ status: "CANCELLED", startedAt: null });
    for (const id of [a, b])
      expect(await row(id)).toMatchObject({ status: "UNKNOWN", errorCode: "cancelled" });
    expect(await mismatches()).toBe(0);
  });

  it("owner switch-off with calls queued and running: queue cancelled, calls aborted, no new call, nothing delivered", async () => {
    const done = await started("ping before the switch-off");
    await runner.whenIdle();
    expect((await detail(admin, done)).result).not.toBeNull();
    const ids = [] as string[];
    const callsBefore = fake.generateCalls;
    for (let i = 0; i < 5; i++) ids.push(await started(`[fake:delay=4000] job ${i}`));
    await until(() => fake.generateCalls === callsBefore + 2);
    const callsAtSwitch = fake.generateCalls;
    expect(
      (await owner.call("POST", AI, { enabled: false, reason: "DP-291 switch-off" })).status,
    ).toBe(200);
    await runner.whenIdle();
    expect(fake.generateCalls).toBe(callsAtSwitch);
    const rows = await dbo.aiOperation.findMany({ where: { id: { in: ids } } });
    expect(rows.filter((r) => r.status === "CANCELLED")).toHaveLength(3);
    const aborted = rows.filter((r) => r.status === "UNKNOWN");
    expect(aborted).toHaveLength(2);
    for (const r of aborted) expect(r.errorCode).toBe("ai_disabled");
    expectError(await run(admin, "ping"), 404, "NOT_FOUND");
    expectError(await admin.call("GET", `/ai/operations/${done}`), 404, "NOT_FOUND");
    expect(await mismatches()).toBe(0);
    // Switched on again: nothing restarts by itself, and no answer from before is handed out.
    expect((await owner.call("POST", AI, { enabled: true, reason: "DP-291 back on" })).status).toBe(
      200,
    );
    await new Promise((r) => setTimeout(r, 200));
    await runner.whenIdle();
    expect(fake.generateCalls).toBe(callsAtSwitch);
    expect((await detail(admin, done)).result).toBeNull();
    for (const r of await dbo.aiOperation.findMany({ where: { id: { in: ids } } })) {
      expect(["CANCELLED", "UNKNOWN"]).toContain(r.status);
    }
  });

  it("refuses every operation with the transport off", async () => {
    await restart({ DP_AI_TRANSPORT: undefined, DP_AI_ENC_KEYS: undefined });
    const calls = fake.generateCalls;
    const res = await run(admin, "ping");
    expectError(res, 409, "CONFLICT_STATE");
    expect(JSON.stringify(res.body)).toContain("transport_off");
    expect(fake.generateCalls).toBe(calls);
    expect((await owner.call("POST", AI, { enabled: false, reason: "DP-291 done" })).status).toBe(
      200,
    );
  });
});

// DP-293 (ADR-030 D6, D7): the AI Center's reports over HTTP with the fake provider — usage by
// provider/model/task/site/outcome and UTC day, filters, every dated price, alerts, the AI audit
// trail and one operation's ledger. Read-only; no prompt, response or key in any answer; 404 while
// AI is off; who reads what (ai_usage:read, audit:read); management stays behind the step-up.
describe("DP-293: AI budget, usage and reporting", () => {
  const AI = "/owner/modules/ai/platform";
  let factory: { createApiApp(o: { logger: false }): Promise<App> };
  let runner: { whenIdle(): Promise<void> };
  let owner: Staff;
  let admin: Staff; // ai_administrator only (no audit:read)
  let superAdmin: Staff; // platform super admin: ai:read + ai_usage:read + audit:read
  let viewer: Staff; // ai_viewer
  let nobody: Staff; // no AI permission
  let succeeded = "";
  let lost = "";
  let seq = 0;
  const key = () => `dp293-${Date.now()}-${seq++}`;
  const CANARY = `canary293-${randomBytes(6).toString("hex")}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const usage = (who: Staff, q = "") =>
    who.call("GET", `/ai/usage?from=${today()}&to=${today()}${q}`);

  async function restart(env: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await app.close();
    app = await factory.createApiApp({ logger: false });
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const mod = (await import(
      pathToFileURL(path.join(API_DIR, "dist/ai/runner/runner.service.js")).href
    )) as { AiRunnerService: abstract new (...a: never[]) => unknown };
    runner = (app as unknown as { get(t: unknown): typeof runner }).get(mod.AiRunnerService);
  }
  async function started(who: Staff, input: string) {
    const res = await who.call("POST", "/ai/operations", {
      task: "DIAGNOSTIC_PING",
      input,
      idempotencyKey: key(),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    return AiOperationCreatedSchema.parse(res.body).operationId;
  }

  beforeAll(async () => {
    factory = (await import(
      pathToFileURL(path.join(API_DIR, "dist/app.factory.js")).href
    )) as typeof factory;
    await restart({
      DP_AI_TRANSPORT: "fake",
      DP_AI_ENC_KEYS: AI_ENC_KEYS,
      AI_SWEEP_INTERVAL_SECONDS: "0",
    });
    const pw = (await dbo.user.findUniqueOrThrow({ where: { id: root.userId } })).passwordHash!;
    owner = new Staff("root-293", root.userId, await session(root.userId));
    admin = await staff("ai-admin-293", pw, [], root.userId);
    superAdmin = await staff("ai-super-293", pw, [{ role: "platform_super_admin" }], root.userId);
    viewer = await staff("ai-viewer-293", pw, [], root.userId);
    nobody = await staff("ai-nobody-293", pw, [], root.userId);
  });

  afterAll(async () => {
    await restart({
      DP_AI_TRANSPORT: undefined,
      DP_AI_ENC_KEYS: undefined,
      AI_SWEEP_INTERVAL_SECONDS: undefined,
    });
  });

  it("every report route is a 404 while AI is off — for the owner too", async () => {
    for (const p of [
      `/ai/usage?from=${today()}&to=${today()}`,
      "/ai/prices",
      "/ai/alerts",
      "/ai/audit",
      "/ai/operations?outcome=unknown",
      "/ai/operations/0190f0a0-0000-7000-8000-000000000001/history",
    ]) {
      expectError(await owner.call("GET", p), 404, "NOT_FOUND");
      expectError(await superAdmin.call("GET", p), 404, "NOT_FOUND");
    }
  });

  it("reports usage with actual, assumed, reserved and estimated apart; sums equal the rows", async () => {
    expect((await owner.call("POST", AI, { enabled: true, reason: "DP-293 test" })).status).toBe(
      200,
    );
    for (const [who, roleKey] of [
      [admin, "ai_administrator"],
      [viewer, "ai_viewer"],
    ] as const) {
      expect((await owner.call("POST", `/staff/${who.userId}/roles`, { roleKey })).status).toBe(
        201,
      );
    }
    succeeded = await started(admin, `ping ${CANARY}`);
    lost = await started(admin, `[fake:error=timeout] ping ${CANARY}`);
    await runner.whenIdle();

    const res = await usage(viewer);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = AiUsageReportSchema.parse(res.body);
    const start = new Date(`${today()}T00:00:00Z`);
    const rows = await dbo.aiOperation.findMany({
      where: { reservedAt: { gte: start, lt: new Date(start.getTime() + 86_400_000) } },
    });
    const sum = (pick: (o: (typeof rows)[number]) => bigint) =>
      rows.reduce((a, o) => a + pick(o), 0n).toString();
    expect(r.totals.operations).toBe(rows.length);
    expect(r.totals.actualMicros).toBe(
      sum((o) => (o.costBasis === "LOCAL_USAGE" ? (o.actualMicros ?? 0n) : 0n)),
    );
    expect(r.totals.assumedMicros).toBe(
      sum((o) => (o.costBasis === "ASSUMED" ? (o.actualMicros ?? 0n) : 0n)),
    );
    expect(r.totals.estimatedMicros).toBe(sum((o) => o.reservedMicros));
    expect(r.totals.reservedMicros).toBe(
      sum((o) => (["RESERVED", "IN_FLIGHT"].includes(o.status) ? o.reservedMicros : 0n)),
    );
    expect(r.totals.outcomes.unknown).toBe(rows.filter((o) => o.status === "UNKNOWN").length);
    expect(r.series).toHaveLength(1);
    expect(r.series[0]!.bucket).toBe(today());
    expect(r.series[0]!.totals).toEqual(r.totals);
    expect(r.byProvider.reduce((a, p) => a + p.totals.operations, 0)).toBe(rows.length);
    expect(r.byModel.every((m) => m.modelKey.length > 0)).toBe(true);
    expect(JSON.stringify(r)).not.toContain(CANARY);

    // Filters narrow the same rows; the outcome class maps to its statuses.
    const unknown = AiUsageReportSchema.parse((await usage(viewer, "&outcome=unknown")).body);
    expect(unknown.totals.operations).toBe(r.totals.outcomes.unknown);
    expect(unknown.totals.actualMicros).toBe("0");
    expect(unknown.totals.assumedMicros).toBe(r.totals.assumedMicros);
    const platform = AiUsageReportSchema.parse((await usage(viewer, "&siteId=platform")).body);
    expect(platform.bySite.every((s) => s.siteId === null)).toBe(true);
    const month = AiUsageReportSchema.parse(
      (
        await viewer.call(
          "GET",
          `/ai/usage?from=${today().slice(0, 8)}01&to=${today()}&granularity=month`,
        )
      ).body,
    );
    expect(month.series.map((s) => s.bucket)).toEqual([today().slice(0, 7)]);

    // Invalid queries are refused, never guessed.
    for (const q of [
      "/ai/usage",
      `/ai/usage?from=${today()}&to=2020-01-01`,
      "/ai/usage?from=2026-01-01&to=2027-06-01",
      `/ai/usage?from=${today()}&to=${today()}&provider=mistral`,
      `/ai/usage?from=${today()}&to=${today()}&outcome=SUCCEEDED`,
      `/ai/usage?from=${today()}&to=${today()}&granularity=week`,
      "/ai/operations?siteId=everything",
      "/ai/operations?from=2026-13-01&to=2026-13-02",
    ]) {
      expectError(await viewer.call("GET", q), 400, "VALIDATION_FAILED");
    }
  });

  it("filters the operations list and keeps the cursor", async () => {
    const list = AiOperationsResponseSchema.parse(
      (await viewer.call("GET", "/ai/operations?outcome=unknown&limit=100")).body,
    );
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every((o) => o.status === "UNKNOWN")).toBe(true);
    expect(list.items.map((o) => o.id)).toContain(lost);
    const byProvider = AiOperationsResponseSchema.parse(
      (await viewer.call("GET", `/ai/operations?provider=gemini&from=${today()}&to=${today()}`))
        .body,
    );
    expect(byProvider.items.every((o) => o.provider === "GEMINI")).toBe(true);
    const page1 = AiOperationsResponseSchema.parse(
      (await viewer.call("GET", "/ai/operations?limit=1")).body,
    );
    expect(page1.items).toHaveLength(1);
    expect(page1.nextBefore).not.toBeNull();
  });

  it("lists every dated price with its state, and reports models without a price in force", async () => {
    const res = await viewer.call("GET", "/ai/prices");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const list = AiPriceListResponseSchema.parse(res.body);
    expect(list.items.length).toBe(await dbo.aiModelPrice.count());
    const now = Date.now();
    for (const i of list.items) {
      if (i.state === "scheduled") expect(Date.parse(i.price.effectiveFrom)).toBeGreaterThan(now);
      else expect(Date.parse(i.price.effectiveFrom)).toBeLessThanOrEqual(now);
    }
    const inForce = list.items.filter((i) => i.state === "in_force");
    expect(new Set(inForce.map((i) => i.price.modelId)).size).toBe(inForce.length);

    // An enabled model without a price (written directly: the API itself never enables one
    // without verification) is reported as missing, in the price list and in the alerts.
    const bare = await dbo.aiModel.create({
      data: {
        provider: "OPENAI",
        modelId: `dp293-bare-${seq++}`,
        displayName: "DP-293 bare model",
        status: "ENABLED",
        billingProfile: "openai.responses",
        compatible: true,
      },
    });
    const again = AiPriceListResponseSchema.parse((await viewer.call("GET", "/ai/prices")).body);
    expect(again.missing.map((m) => m.modelId)).toContain(bare.id);
    const alerts = AiAlertsResponseSchema.parse((await viewer.call("GET", "/ai/alerts")).body);
    expect(alerts.items).toContainEqual(
      expect.objectContaining({ code: "price_missing", modelId: bare.id, provider: "OPENAI" }),
    );
    await dbo.aiModel.update({
      where: { id: bare.id },
      data: { status: "DISABLED", version: { increment: 1 } },
    });
  });

  it("alerts: unknown outcomes, an exceeded budget and a reconciliation difference; no ledger mismatch", async () => {
    const a = AiAlertsResponseSchema.parse((await viewer.call("GET", "/ai/alerts")).body);
    expect(a.dayStart).toBe(`${today()}T00:00:00.000Z`);
    expect(a.items).toContainEqual(expect.objectContaining({ code: "unknown_operations" }));
    expect(a.items.some((i) => i.code === "ledger_mismatch")).toBe(false);

    // The daily platform budget at 1 µ$ is exceeded by what was spent today.
    const daily = await dbo.aiBudget.findFirstOrThrow({
      where: { active: true, scope: "PLATFORM", period: "DAILY" },
    });
    const set = (limitMicros: string, version: number) =>
      admin.call("POST", `/ai/budgets/${daily.id}`, {
        limitMicros,
        warnPct: daily.warnPct,
        active: true,
        version,
      });
    expect((await set("1", daily.version)).status).toBe(200);
    const exceeded = AiAlertsResponseSchema.parse((await viewer.call("GET", "/ai/alerts")).body);
    const alert = exceeded.items.find(
      (i) => i.code === "budget_exceeded" && i.budgetId === daily.id,
    );
    expect(alert).toMatchObject({ severity: "critical", period: "DAILY", limitMicros: "1" });
    expect(exceeded.items[0]!.severity).toBe("critical");
    expect((await set("100000000", daily.version + 1)).status).toBe(200);

    // The provider says far more than the local calculation for today.
    const rec = await admin.call("POST", "/ai/reconciliation", {
      provider: "GEMINI",
      day: today(),
      providerAmountMicros: "5000000",
      projectRef: `dp293-${seq++}`,
    });
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    const after = AiAlertsResponseSchema.parse((await viewer.call("GET", "/ai/alerts")).body);
    expect(after.items).toContainEqual(
      expect.objectContaining({
        code: "reconciliation_difference",
        provider: "GEMINI",
        day: today(),
      }),
    );
  });

  it("shows one operation's ledger; its audit events only with audit:read", async () => {
    const h = AiOperationHistorySchema.parse(
      (await superAdmin.call("GET", `/ai/operations/${succeeded}/history`)).body,
    );
    expect(h.ledger.map((l) => l.kind)).toEqual(expect.arrayContaining(["RESERVE", "SETTLE"]));
    // Reserved money comes back to zero for every budget the operation touched.
    const perBudget = new Map<string, bigint>();
    for (const l of h.ledger)
      perBudget.set(l.budgetId, (perBudget.get(l.budgetId) ?? 0n) + BigInt(l.deltaReservedMicros));
    expect([...perBudget.values()].every((v) => v === 0n)).toBe(true);
    expect(h.audit?.map((e) => e.action)).toContain("ai.operation.create");
    const lostH = AiOperationHistorySchema.parse(
      (await viewer.call("GET", `/ai/operations/${lost}/history`)).body,
    );
    expect(lostH.ledger.map((l) => l.kind)).toContain("ASSUME_SPENT");
    expect(lostH.audit).toBeNull(); // ai_viewer has no audit:read
    expectError(
      await viewer.call("GET", "/ai/operations/0190f0a0-0000-7000-8000-000000000001/history"),
      404,
      "NOT_FOUND",
    );
    expect(JSON.stringify([h, lostH])).not.toContain(CANARY);
  });

  it("the AI audit trail: AI events only, allowlisted details, no text; audit:read required", async () => {
    const res = await superAdmin.call("GET", "/ai/audit?limit=100");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const a = AiAuditResponseSchema.parse(res.body);
    expect(a.items.length).toBeGreaterThan(0);
    expect(a.items.every((e) => e.action.startsWith("ai."))).toBe(true);
    expect(a.items.some((e) => "permission" in e.details)).toBe(false);
    const body = JSON.stringify(a);
    expect(body).not.toContain(CANARY);
    expect(body).not.toMatch(/ciphertext|fingerprint|BEGIN/);
    // Only allowlisted keys (ids, codes, counts, amounts, a key's hint) leave the API.
    const { AI_AUDIT_METADATA_KEYS } = await import("../../src/ai/audit.js");
    for (const e of a.items)
      for (const k of Object.keys(e.details))
        expect(AI_AUDIT_METADATA_KEYS as readonly string[]).toContain(k);
    const denied = AiAuditResponseSchema.parse(
      (await superAdmin.call("GET", "/ai/audit?action=ai.operation.create&limit=1")).body,
    );
    expect(denied.items).toHaveLength(1);
    expect(denied.items[0]!.action).toBe("ai.operation.create");
    expect(denied.nextBefore).not.toBeNull();
    expectError(
      await superAdmin.call("GET", "/ai/audit?action=leads.export"),
      400,
      "VALIDATION_FAILED",
    );
    // ai_administrator and ai_viewer read usage but not the audit trail.
    expectError(await admin.call("GET", "/ai/audit"), 403, "FORBIDDEN");
    expectError(await viewer.call("GET", "/ai/audit"), 403, "FORBIDDEN");
  });

  it("who reads what: no AI permission → 403; reports need no step-up, changes do", async () => {
    for (const p of [`/ai/usage?from=${today()}&to=${today()}`, "/ai/prices", "/ai/alerts"]) {
      expectError(await nobody.call("GET", p), 403, "FORBIDDEN");
      expect((await superAdmin.call("GET", p)).status).toBe(200);
    }
    const stale = new Staff("ai-admin-293-stale", admin.userId, await session(admin.userId, null));
    expect((await stale.call("GET", "/ai/alerts")).status).toBe(200);
    expect((await stale.call("GET", `/ai/usage?from=${today()}&to=${today()}`)).status).toBe(200);
    const daily = await dbo.aiBudget.findFirstOrThrow({
      where: { active: true, scope: "PLATFORM", period: "DAILY" },
    });
    const before = daily.version;
    expectError(
      await stale.call("POST", `/ai/budgets/${daily.id}`, {
        limitMicros: "1",
        warnPct: daily.warnPct,
        active: true,
        version: daily.version,
      }),
      403,
      "AUTH_STEP_UP_REQUIRED",
    );
    expectError(
      await stale.call("POST", "/ai/reconciliation", {
        provider: "OPENAI",
        day: today(),
        providerAmountMicros: "1",
      }),
      403,
      "AUTH_STEP_UP_REQUIRED",
    );
    expect((await dbo.aiBudget.findUniqueOrThrow({ where: { id: daily.id } })).version).toBe(
      before,
    );
    // A reader cannot change a budget, step-up or not.
    expectError(
      await viewer.call("POST", `/ai/budgets/${daily.id}`, {
        limitMicros: "1",
        warnPct: daily.warnPct,
        active: true,
        version: daily.version,
      }),
      403,
      "FORBIDDEN",
    );
    expect((await owner.call("POST", AI, { enabled: false, reason: "DP-293 done" })).status).toBe(
      200,
    );
    expectError(await superAdmin.call("GET", "/ai/alerts"), 404, "NOT_FOUND");
  });
});

// DP-297 (ADR-030 D10): the AI queue and the draft answers in the database, with TWO API
// PROCESSES (`node dist/main.js`, separate memory) on this database and the fake provider (no
// network, no paid call). The in-process API runs with the transport off (no worker): it serves
// the owner's switch only. Every generation of a child appends the SHA-256 of its input to a call
// log (DP_AI_FAKE_CALL_LOG), so a call made twice anywhere is seen. Covered: no job runs twice;
// maxConcurrency and the budget over both processes; queue capacity; a result read through the
// other process; cancel through the other process (queued and running); a crash (SIGKILL) — the
// running call never repeated (UNKNOWN at lease end), the queued job run by the other process; a
// graceful shutdown (SIGTERM); the call deadline; the owner's switch-off with calls running on
// both processes and queued; nothing restarts when AI is back on; the held texts — encrypted,
// UNLOGGED, 15-minute bound, wiped, for their actor only, never in a log or an audit event.
describe("DP-297: the AI queue over two API processes", () => {
  const AI = "/owner/modules/ai/platform";
  const MAIN = path.join(API_DIR, "dist/main.js");
  const CALL_LOG = path.join(tmpdir(), `dp297-calls-${randomBytes(4).toString("hex")}.log`);
  const CANARY = `canary297-${randomBytes(6).toString("hex")}`;
  let factory: { createApiApp(o: { logger: false }): Promise<App> };
  let owner: Staff;
  let admin: Staff; // ai_administrator
  let other: Staff; // another ai_administrator
  let viewer: Staff; // ai_viewer
  let seq = 0;
  const key = () => `dp297-${Date.now()}-${seq++}`;
  const sha = (t: string) => createHash("sha256").update(t).digest("hex");
  const calls = (input?: string) => {
    if (!existsSync(CALL_LOG)) return 0;
    const lines = readFileSync(CALL_LOG, "utf8").split("\n").filter(Boolean);
    return input === undefined ? lines.length : lines.filter((l) => l === sha(input)).length;
  };

  interface Proc {
    name: string;
    url: string;
    child: ChildProcess;
    output: string[];
    exited: Promise<number | null>;
  }
  const procs: Proc[] = [];

  async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = createServer();
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const { port } = srv.address() as { port: number };
        srv.close(() => resolve(port));
      });
    });
  }

  async function launch(name: string, env: Record<string, string> = {}): Promise<Proc> {
    const port = await freePort();
    const child = spawn(process.execPath, [MAIN], {
      cwd: API_DIR,
      env: {
        ...process.env,
        PORT: String(port),
        DP_AI_TRANSPORT: "fake",
        DP_AI_ENC_KEYS: AI_ENC_KEYS,
        DP_AI_FAKE_CALL_LOG: CALL_LOG,
        AI_WORKER_POLL_MS: "200",
        AI_WORKER_CONCURRENCY: "1",
        AI_SWEEP_INTERVAL_SECONDS: "1",
        AI_CALL_TIMEOUT_SECONDS: "5",
        NODE_OPTIONS: "--max-old-space-size=384",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: string[] = [];
    child.stdout?.on("data", (d: Buffer) => output.push(d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => output.push(d.toString("utf8")));
    const exited = new Promise<number | null>((resolve) => child.once("exit", (c) => resolve(c)));
    const p: Proc = { name, url: `http://127.0.0.1:${port}`, child, output, exited };
    procs.push(p);
    const end = Date.now() + 30_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`${name} exited: ${output.join("")}`);
      try {
        if ((await fetch(`${p.url}/health/ready`)).status === 200) return p;
      } catch {
        // not listening yet
      }
      if (Date.now() > end) throw new Error(`${name} not ready`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async function stop(p: Proc, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    if (p.child.exitCode === null && p.child.signalCode === null) p.child.kill(signal);
    await p.exited;
  }

  const run = (who: Staff, via: Proc, input: string, k = key()) =>
    who.callAt(via.url, "POST", "/ai/operations", {
      task: "DIAGNOSTIC_PING",
      input,
      idempotencyKey: k,
    });
  async function started(via: Proc, input: string, who = admin): Promise<string> {
    const res = await run(who, via, input);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    return AiOperationCreatedSchema.parse(res.body).operationId;
  }
  const row = (id: string) => dbo.aiOperation.findUniqueOrThrow({ where: { id } });
  const status = async (id: string) => (await row(id)).status;
  const detailAt = async (who: Staff, via: Proc, id: string) => {
    const res = await who.callAt(via.url, "GET", `/ai/operations/${id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return AiOperationDetailSchema.parse(res.body);
  };
  async function until(fn: () => Promise<boolean> | boolean, ms = 15_000) {
    const end = Date.now() + ms;
    while (!(await fn())) {
      if (Date.now() > end) throw new Error("condition not reached");
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  const TERMINAL = [
    "SUCCEEDED",
    "FAILED",
    "UNKNOWN",
    "DISCARDED",
    "CANCELLED",
    "RELEASED",
    "EXPIRED",
  ];
  const settledAll = (ids: string[], ms?: number) =>
    until(async () => {
      const rows = await dbo.aiOperation.findMany({ where: { id: { in: ids } } });
      return rows.every((r) => TERMINAL.includes(r.status));
    }, ms);
  const mismatches = async () =>
    Number(
      (
        await asApp.$queryRaw<
          { n: bigint }[]
        >`SELECT count(*)::bigint AS "n" FROM ai_ledger_mismatches()`
      )[0]!.n,
    );
  async function settings(patch: Record<string, unknown>) {
    const cur = await admin.call("GET", "/ai/settings");
    const res = await admin.call("POST", "/ai/settings", { ...cur.body, ...patch });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  async function setDaily(limitMicros: bigint) {
    const daily = await dbo.aiBudget.findFirstOrThrow({
      where: { active: true, scope: "PLATFORM", period: "DAILY" },
    });
    const res = await admin.call("POST", `/ai/budgets/${daily.id}`, {
      limitMicros: limitMicros.toString(),
      warnPct: daily.warnPct,
      active: true,
      version: daily.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return daily.id;
  }
  async function restartInProcess(env: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await app.close();
    app = await factory.createApiApp({ logger: false });
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }
  const noActive = async () =>
    (await dbo.aiOperation.count({ where: { status: { in: ["RESERVED", "IN_FLIGHT"] } } })) === 0;

  let A: Proc;
  let B: Proc;
  let Q: Proc; // API-only (AI_WORKER_CONCURRENCY=0)

  beforeAll(async () => {
    factory = (await import(
      pathToFileURL(path.join(API_DIR, "dist/app.factory.js")).href
    )) as typeof factory;
    rmSync(CALL_LOG, { force: true });
    // The in-process API: transport off (no worker), the owner's switch and the settings.
    await restartInProcess({
      DP_AI_TRANSPORT: undefined,
      DP_AI_ENC_KEYS: undefined,
      AI_SWEEP_INTERVAL_SECONDS: "0",
    });
    const pw = (await dbo.user.findUniqueOrThrow({ where: { id: root.userId } })).passwordHash!;
    owner = new Staff("root-297", root.userId, await session(root.userId));
    admin = await staff("ai-admin-297", pw, [], root.userId);
    other = await staff("ai-other-297", pw, [], root.userId);
    viewer = await staff("ai-viewer-297", pw, [], root.userId);
    expect((await owner.call("POST", AI, { enabled: true, reason: "DP-297 test" })).status).toBe(
      200,
    );
    for (const [who, roleKey] of [
      [admin, "ai_administrator"],
      [other, "ai_administrator"],
      [viewer, "ai_viewer"],
    ] as const) {
      expect((await owner.call("POST", `/staff/${who.userId}/roles`, { roleKey })).status).toBe(
        201,
      );
    }
    for (const b of await dbo.aiBudget.findMany({ where: { active: true, scope: "PLATFORM" } })) {
      const res = await admin.call("POST", `/ai/budgets/${b.id}`, {
        limitMicros: "100000000",
        warnPct: b.warnPct,
        active: true,
        version: b.version,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    await settings({ maxConcurrency: 20 });
    [A, B, Q] = await Promise.all([
      launch("api-a"),
      launch("api-b"),
      launch("api-q", { AI_WORKER_CONCURRENCY: "0" }),
    ]);
  }, 90_000);

  afterAll(async () => {
    for (const p of procs) await stop(p);
    // Nothing of a text in any process output (logs).
    for (const p of procs) {
      const out = p.output.join("");
      expect(out, p.name).not.toContain(CANARY);
      expect(out, p.name).not.toContain("pong");
    }
    rmSync(CALL_LOG, { force: true });
    await restartInProcess({ AI_SWEEP_INTERVAL_SECONDS: undefined });
  }, 60_000);

  it("keeps the held texts in an UNLOGGED table that dp_app cannot read", async () => {
    const rel = await dbo.$queryRaw<{ relpersistence: string }[]>`
      SELECT relpersistence::text AS relpersistence FROM pg_class WHERE relname = 'AiTransient'`;
    expect(rel[0]?.relpersistence).toBe("u");
    await rejectsDb(asApp.$queryRaw`SELECT * FROM "AiTransient"`, /permission denied/);
    await rejectsDb(
      asApp.$executeRaw`UPDATE "AiTransient" SET "ciphertext" = NULL`,
      /permission denied/,
    );
  });

  it("runs each job exactly once over two processes, within maxConcurrency; any process reads the draft", async () => {
    // Twelve jobs queued through the API-only process Q while no worker runs; then the global
    // limit is lowered to 3 and two worker processes with 2 workers each (4 > 3) start together.
    await stop(A);
    await stop(B);
    const jobs: { id: string; via: Proc; input: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const input = `[fake:delay=300] job ${i} ${CANARY}`;
      jobs.push({ id: await started(Q, input), via: Q, input });
    }
    expect(
      await dbo.aiOperation.count({
        where: { id: { in: jobs.map((j) => j.id) }, status: "RESERVED" },
      }),
    ).toBe(12);
    await settings({ maxConcurrency: 3 });
    [A, B] = await Promise.all([
      launch("api-a-wide", { AI_WORKER_CONCURRENCY: "2" }),
      launch("api-b-wide", { AI_WORKER_CONCURRENCY: "2" }),
    ]);
    try {
      jobs.forEach((j, n) => (j.via = n % 2 === 0 ? A : B));
      await settledAll(
        jobs.map((j) => j.id),
        30_000,
      );
      const rows = await dbo.aiOperation.findMany({ where: { id: { in: jobs.map((j) => j.id) } } });
      expect(rows.map((r) => r.status)).toEqual(rows.map(() => "SUCCEEDED"));
      for (const j of jobs) expect(calls(j.input), j.input).toBe(1);
      // Both processes worked; never more than 3 calls in flight together.
      expect(new Set(rows.map((r) => r.instanceId)).size).toBe(2);
      const events = rows.flatMap((r) => [
        { t: r.startedAt!.getTime(), d: 1 },
        { t: r.finishedAt!.getTime(), d: -1 },
      ]);
      events.sort((x, y) => x.t - y.t || x.d - y.d);
      let flying = 0;
      let peak = 0;
      for (const e of events) peak = Math.max(peak, (flying += e.d));
      expect(peak).toBeLessThanOrEqual(3);
      // The ledger: no second start anywhere.
      const starts = await dbo.aiLedgerEntry.groupBy({
        by: ["operationId"],
        where: { operationId: { in: jobs.map((j) => j.id) }, kind: "START" },
        _count: true,
      });
      expect(starts).toHaveLength(jobs.length);
      // One START per budget (daily + monthly platform budgets) — a second start would double it.
      const budgets = await dbo.aiBudget.count({ where: { active: true, scope: "PLATFORM" } });
      for (const g of starts) expect(g._count, g.operationId).toBe(budgets);
      // The draft through the process that did NOT take the request, for its actor only.
      for (const j of jobs) {
        const otherProc = j.via === A ? B : A;
        expect(await detailAt(admin, otherProc, j.id)).toMatchObject({
          own: true,
          runner: "none",
          result: { draft: true, text: "pong" },
        });
        expect((await detailAt(other, otherProc, j.id)).result).toBeNull();
      }
      expectError(
        await viewer.callAt(A.url, "GET", `/ai/operations/${jobs[0]!.id}`),
        403,
        "FORBIDDEN",
      );
      // The API-only process ran nothing and still serves the draft.
      expect((await detailAt(admin, Q, jobs[0]!.id)).result).toEqual({ draft: true, text: "pong" });
      expect(await mismatches()).toBe(0);
    } finally {
      await settings({ maxConcurrency: 20 });
      await stop(A);
      await stop(B);
      [A, B] = await Promise.all([launch("api-a"), launch("api-b")]);
    }
  }, 90_000);

  it("refuses beyond the capacity and the budget, counted over both processes", async () => {
    // Capacity: maxConcurrency counts queued + running on every instance.
    await settings({ maxConcurrency: 2 });
    const burst = await Promise.all(
      Array.from({ length: 6 }, (_, i) => run(admin, i % 2 ? A : B, `[fake:delay=1500] cap ${i}`)),
    );
    const accepted = burst.filter((r) => r.status === 202);
    expect(accepted).toHaveLength(2);
    for (const r of burst.filter((x) => x.status !== 202)) {
      expectError(r, 409, "CONFLICT_STATE");
      expect(JSON.stringify(r.body)).toContain("concurrency_limit");
    }
    await settledAll(accepted.map((r) => AiOperationCreatedSchema.parse(r.body).operationId));
    await settings({ maxConcurrency: 20 });

    // Budget: room for exactly three reservations of this size, whoever reserves.
    const probe = await started(A, "[fake:delay=2000] budget p"); // same size as the burst
    await settledAll([probe]);
    const amount = (await row(probe)).reservedMicros;
    const daily = await dbo.aiBudget.findFirstOrThrow({
      where: { active: true, scope: "PLATFORM", period: "DAILY" },
    });
    const usage = await dbo.aiBudgetUsage.findFirstOrThrow({
      where: { budgetId: daily.id },
      orderBy: { periodStart: "desc" },
    });
    const used = usage.reservedMicros + usage.committedMicros + usage.assumedMicros;
    await setDaily(used + amount * 3n + amount / 2n);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        run(admin, i % 2 ? A : B, `[fake:delay=2000] budget ${i}`),
      ),
    );
    const ok = results.filter((r) => r.status === 202);
    expect(ok).toHaveLength(3);
    for (const r of results.filter((x) => x.status !== 202)) {
      expect(JSON.stringify(r.body)).toContain("budget_exceeded");
    }
    await settledAll(ok.map((r) => AiOperationCreatedSchema.parse(r.body).operationId));
    const after = await dbo.aiBudgetUsage.findFirstOrThrow({
      where: { budgetId: daily.id },
      orderBy: { periodStart: "desc" },
    });
    expect(after.reservedMicros).toBe(0n);
    expect(after.committedMicros + after.assumedMicros).toBeLessThanOrEqual(
      used + amount * 3n + amount / 2n,
    );
    await setDaily(100_000_000n);
    expect(await mismatches()).toBe(0);
  }, 60_000);

  it("cancels through the other process: a queued job costs nothing, a running call stops there", async () => {
    // Both processes busy (one worker each), then a third job waits in the queue.
    const busyA = await started(A, "[fake:delay=4000] busy a");
    const busyB = await started(B, "[fake:delay=4000] busy b");
    await until(
      () => calls("[fake:delay=4000] busy a") === 1 && calls("[fake:delay=4000] busy b") === 1,
    );
    const queued = await started(A, `[fake:delay=4000] queued ${CANARY}`);
    expect((await detailAt(admin, B, queued)).runner).toBe("queued");
    const before = await dbo.aiTransient.findUniqueOrThrow({
      where: { operationId_kind: { operationId: queued, kind: "INPUT" } },
    });
    expect(before.ciphertext).toMatch(/^v1:/);
    expect(before.ciphertext).not.toContain(CANARY);
    expect(before.expiresAt.getTime() - before.createdAt.getTime()).toBeLessThanOrEqual(900_000);
    // Another user cannot cancel it; the actor can, through B.
    expectError(
      await other.callAt(B.url, "POST", `/ai/operations/${queued}/cancel`),
      404,
      "NOT_FOUND",
    );
    expect((await admin.callAt(B.url, "POST", `/ai/operations/${queued}/cancel`)).body).toEqual({
      operationId: queued,
      stopped: "queued",
    });
    expect(await row(queued)).toMatchObject({ status: "CANCELLED", startedAt: null });
    expect(
      (
        await dbo.aiTransient.findUniqueOrThrow({
          where: { operationId_kind: { operationId: queued, kind: "INPUT" } },
        })
      ).ciphertext,
    ).toBeNull();
    // The call running on A, cancelled through B: A sees the stop at its next poll.
    const runningOn = (await row(busyA)).instanceId;
    expect((await admin.callAt(B.url, "POST", `/ai/operations/${busyA}/cancel`)).body).toEqual({
      operationId: busyA,
      stopped: "running",
    });
    await until(async () => (await status(busyA)) === "UNKNOWN", 3_000);
    expect(await row(busyA)).toMatchObject({ errorCode: "cancelled", instanceId: runningOn });
    await settledAll([busyB]);
    expect(await status(busyB)).toBe("SUCCEEDED");
    await new Promise((r) => setTimeout(r, 600));
    expect(calls(`[fake:delay=4000] queued ${CANARY}`)).toBe(0);
    expect(calls("[fake:delay=4000] busy a")).toBe(1);
    expect(await mismatches()).toBe(0);
  }, 60_000);

  it("a crashed process (SIGKILL): its call is never repeated (UNKNOWN at lease end), its queue runs elsewhere", async () => {
    await stop(B);
    const running = "[fake:delay=4000] crash running";
    const waiting = `crash waiting ${CANARY}`;
    const r = await started(A, running);
    await until(() => calls(running) === 1);
    const w = await started(A, waiting); // A has one worker: it waits in the queue
    expect(await status(w)).toBe("RESERVED");
    await stop(A, "SIGKILL");
    expect(await status(r)).toBe("IN_FLIGHT");
    // A new process takes the queued job; the crashed call is counted as spent at lease end.
    B = await launch("api-b2");
    await until(async () => (await status(w)) === "SUCCEEDED");
    expect((await detailAt(admin, B, w)).result).toEqual({ draft: true, text: "pong" });
    await until(async () => (await status(r)) === "UNKNOWN", 30_000);
    expect(await row(r)).toMatchObject({ errorCode: "lease_expired", costBasis: "ASSUMED" });
    A = await launch("api-a2");
    await new Promise((res) => setTimeout(res, 1_000));
    expect(calls(running)).toBe(1);
    expect(calls(waiting)).toBe(1);
    expect(await mismatches()).toBe(0);
  }, 90_000);

  it("a graceful shutdown (SIGTERM) ends the running call UNKNOWN and leaves the queue to the other process", async () => {
    await stop(B);
    const running = "[fake:delay=4000] term running";
    const waiting = "term waiting";
    const r = await started(A, running);
    await until(() => calls(running) === 1);
    const w = await started(A, waiting);
    await stop(A, "SIGTERM");
    expect(await row(r)).toMatchObject({ status: "UNKNOWN", errorCode: "shutdown" });
    expect(await status(w)).toBe("RESERVED");
    B = await launch("api-b3");
    await until(async () => (await status(w)) === "SUCCEEDED");
    A = await launch("api-a3");
    expect(calls(running)).toBe(1);
    expect(calls(waiting)).toBe(1);
  }, 60_000);

  it("ends a call at its deadline as UNKNOWN (counted as spent), never repeated", async () => {
    const slow = "[fake:delay=9000] past the deadline";
    const id = await started(A, slow);
    await until(async () => (await status(id)) === "UNKNOWN", 15_000);
    expect(await row(id)).toMatchObject({ errorCode: "timeout", costBasis: "ASSUMED" });
    await new Promise((r) => setTimeout(r, 600));
    expect(calls(slow)).toBe(1);
  }, 30_000);

  it("the held draft: 15 minutes at most, unreadable once expired, wiped, never after a cancel", async () => {
    const id = await started(A, "ttl ping");
    await settledAll([id]);
    expect((await detailAt(admin, B, id)).result).toEqual({ draft: true, text: "pong" });
    // The database refuses a lifetime above 15 minutes.
    await rejectsDb(
      dbo.$executeRaw`UPDATE "AiTransient" SET "expiresAt" = "createdAt" + interval '16 minutes'
                       WHERE "operationId" = ${id}::uuid AND "kind" = 'RESULT'`,
      /AiTransient_ttl/,
    );
    // Expired: no longer handed out, then wiped by the next poll.
    await dbo.$executeRaw`UPDATE "AiTransient" SET "createdAt" = now() - interval '20 minutes',
                            "expiresAt" = now() - interval '5 minutes'
                           WHERE "operationId" = ${id}::uuid AND "kind" = 'RESULT'`;
    expect((await detailAt(admin, A, id)).result).toBeNull();
    await until(async () => {
      const t = await dbo.aiTransient.findUniqueOrThrow({
        where: { operationId_kind: { operationId: id, kind: "RESULT" } },
      });
      return t.ciphertext === null && t.wipedAt !== null;
    }, 5_000);
    // A cancel after success wipes the draft at once.
    const id2 = await started(B, "cancel after success");
    await settledAll([id2]);
    expect((await detailAt(admin, A, id2)).result).not.toBeNull();
    expect((await admin.callAt(A.url, "POST", `/ai/operations/${id2}/cancel`)).body).toEqual({
      operationId: id2,
      stopped: "none",
    });
    expect((await detailAt(admin, B, id2)).result).toBeNull();
    // A draft copied to another operation does not decrypt (bound to operation and actor).
    const id3 = await started(A, "copy target");
    await settledAll([id3]);
    const src = await dbo.aiTransient.findUniqueOrThrow({
      where: { operationId_kind: { operationId: id2, kind: "RESULT" } },
    });
    expect(src.ciphertext).toBeNull();
    const own = await dbo.aiTransient.findUniqueOrThrow({
      where: { operationId_kind: { operationId: id3, kind: "RESULT" } },
    });
    const id4 = await started(A, "copy source");
    await settledAll([id4]);
    await dbo.$executeRaw`UPDATE "AiTransient" SET "ciphertext" = ${own.ciphertext}
                           WHERE "operationId" = ${id4}::uuid AND "kind" = 'RESULT'`;
    expect((await detailAt(admin, B, id4)).result).toBeNull();
    // Nothing of a text in audit events.
    const audits = JSON.stringify(
      await dbo.auditEvent.findMany({ where: { action: { startsWith: "ai." } } }),
      (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
    );
    expect(audits).not.toContain(CANARY);
    expect(audits).not.toContain("pong");
  }, 60_000);

  const aiVersion = async () =>
    (await dbo.platformModuleState.findUniqueOrThrow({ where: { moduleKey: "ai" } })).version;

  it("the switch-off waits for a provider request being started under the switch; after its COMMIT none can start", async () => {
    // No worker process: the test is the worker (dp_app), so the order is under its control.
    await stop(A);
    await stop(B);
    const first = await started(Q, "dispatch order 1");
    const second = await started(Q, "dispatch order 2");
    const claimed = await asApp.$queryRaw<{ op_id: string }[]>`
      SELECT op_id FROM ai_claim('int-probe', 60, 2)`;
    expect(claimed.map((c) => c.op_id).sort()).toEqual([first, second].sort());
    const vOn = await aiVersion();
    let switchedAt = 0;
    let committedAt = 0;
    let switching: Promise<Res> | null = null;
    await asApp.$transaction(
      async (tx) => {
        const r = await tx.$queryRaw<{ r: string }[]>`SELECT ai_dispatch(${first}::uuid) AS "r"`;
        expect(r[0]!.r).toBe("dispatch");
        // The provider request would be sent here. The owner switches AI off meanwhile.
        switching = owner.call("POST", AI, { enabled: false, reason: "DP-297 dispatch order" });
        void switching.then(() => (switchedAt = Date.now()));
        await new Promise((res) => setTimeout(res, 1_500));
        expect(switchedAt, "the switch-off must wait for the dispatching transaction").toBe(0);
        committedAt = Date.now();
      },
      { timeout: 15_000, maxWait: 5_000 },
    );
    expect((await switching!).status).toBe(200);
    expect(switchedAt).toBeGreaterThanOrEqual(committedAt);
    const vOff = await aiVersion();
    expect(vOff).toBe(vOn + 1);
    // After the COMMIT of the switch-off: no permission for the other claimed call.
    const late = await asApp.$queryRaw<{ r: string }[]>`SELECT ai_dispatch(${second}::uuid) AS "r"`;
    expect(late[0]!.r).toBe("ai_disabled");
    expect(await row(first)).toMatchObject({ dispatchSwitchVersion: vOn });
    expect((await row(first)).dispatchedAt).not.toBeNull();
    expect(await row(second)).toMatchObject({ dispatchedAt: null, dispatchSwitchVersion: null });
    // The database refuses a dispatch record without its version (and the reverse).
    await rejectsDb(
      dbo.$executeRaw`UPDATE "AiOperation" SET "dispatchSwitchVersion" = NULL WHERE "id" = ${first}::uuid`,
      /AiOperation_dispatch/,
    );
    // Clean up the probe's calls (no request was sent): counted as spent at lease end otherwise.
    for (const id of [first, second]) {
      await asApp.$queryRaw`SELECT ai_mark_unknown(${id}::uuid, 'int_probe') AS "r"`;
    }
    expect((await owner.call("POST", AI, { enabled: true, reason: "DP-297 back on" })).status).toBe(
      200,
    );
    [A, B] = await Promise.all([launch("api-a4"), launch("api-b4")]);
    expect(await mismatches()).toBe(0);
  }, 60_000);

  it("switch-off races against two busy worker processes: zero provider requests start after the COMMIT", async () => {
    await stop(A);
    await stop(B);
    [A, B] = await Promise.all([
      launch("api-a-race", { AI_WORKER_CONCURRENCY: "4", AI_WORKER_POLL_MS: "100" }),
      launch("api-b-race", { AI_WORKER_CONCURRENCY: "4", AI_WORKER_POLL_MS: "100" }),
    ]);
    const totals = { dispatched: 0, refusedAtDispatch: 0, aborted: 0, cancelledQueued: 0 };
    try {
      for (let round = 0; round < 5; round++) {
        const vOn = await aiVersion();
        const inputs: string[] = [];
        const ids: string[] = [];
        // A stream of short jobs: claims and dispatches are happening on both processes.
        const feeding = (async () => {
          for (let i = 0; i < 24; i++) {
            const input = `[fake:delay=${80 + ((i * 37) % 120)}] race ${round} ${i} ${CANARY}`;
            const res = await run(admin, Q, input);
            if (res.status !== 202) break; // AI is off now
            inputs.push(input);
            ids.push(AiOperationCreatedSchema.parse(res.body).operationId);
            await new Promise((r) => setTimeout(r, 15));
          }
        })();
        await new Promise((r) => setTimeout(r, 150 + round * 90));
        const off = await owner.call("POST", AI, {
          enabled: false,
          reason: `DP-297 race ${round}`,
        });
        expect(off.status).toBe(200);
        // The switch-off has COMMITTED (the answer comes after it): from here, no new request.
        const atCommit = new Map(inputs.map((t) => [t, calls(t)]));
        const vOff = await aiVersion();
        expect(vOff).toBeGreaterThan(vOn);
        await feeding;
        await new Promise((r) => setTimeout(r, 1_200));
        // Inputs accepted while the switch-off ran (reserved before it, cancelled by it) count 0.
        for (const t of inputs) {
          expect(calls(t), `round ${round}: a provider request started after the switch-off`).toBe(
            atCommit.get(t) ?? 0,
          );
        }
        await settledAll(ids, 15_000);
        const rows = await dbo.aiOperation.findMany({ where: { id: { in: ids } } });
        for (const r of rows) {
          // Every recorded dispatch was granted under the version in force BEFORE the switch-off.
          if (r.dispatchedAt) expect(r.dispatchSwitchVersion, r.id).toBe(vOn);
          expect(r.dispatchSwitchVersion ?? 0).toBeLessThan(vOff);
        }
        // Each provider request has its dispatch record, and no request was made twice.
        for (const [n, r] of ids.map((id, n) => [n, rows.find((x) => x.id === id)!] as const)) {
          expect(calls(inputs[n]!), r.id).toBe(r.dispatchedAt ? 1 : 0);
        }
        totals.dispatched += rows.filter((r) => r.dispatchedAt).length;
        totals.refusedAtDispatch += rows.filter(
          (r) => r.startedAt && !r.dispatchedAt && r.errorCode === "ai_disabled",
        ).length;
        totals.aborted += rows.filter(
          (r) => r.dispatchedAt && r.status !== "SUCCEEDED" && r.errorCode === "ai_disabled",
        ).length;
        totals.cancelledQueued += rows.filter((r) => r.status === "CANCELLED").length;
        // Nothing of this round is handed out after the switch-off.
        expect(await dbo.aiTransient.count({ where: { ciphertext: { not: null } } })).toBe(0);
        expect(await noActive()).toBe(true);
        expect(
          (await owner.call("POST", AI, { enabled: true, reason: `DP-297 race ${round} on` }))
            .status,
        ).toBe(200);
      }
      console.info(`DP-297 race totals ${JSON.stringify(totals)}`);
      expect(totals.dispatched).toBeGreaterThan(0);
      expect(totals.cancelledQueued + totals.refusedAtDispatch + totals.aborted).toBeGreaterThan(0);
      expect(await mismatches()).toBe(0);
    } finally {
      if (
        (await dbo.platformModuleState.findUniqueOrThrow({ where: { moduleKey: "ai" } }))
          .enabled === false
      ) {
        await owner.call("POST", AI, { enabled: true, reason: "DP-297 race cleanup" });
      }
      await stop(A);
      await stop(B);
      [A, B] = await Promise.all([launch("api-a5"), launch("api-b5")]);
    }
  }, 120_000);

  it("the owner's switch-off with calls running on both processes and queued: nothing starts, nothing is kept or delivered", async () => {
    expect(await noActive()).toBe(true);
    const done = await started(A, "before the switch-off");
    await settledAll([done]);
    const ra = "[fake:delay=4000] off running a";
    const rb = "[fake:delay=4000] off running b";
    const runningIds = [await started(A, ra), await started(B, rb)];
    await until(() => calls(ra) + calls(rb) === 2);
    const queuedIds = [
      await started(A, "[fake:delay=4000] off queued 1"),
      await started(B, "[fake:delay=4000] off queued 2"),
    ];
    const total = calls();
    expect(
      (await owner.call("POST", AI, { enabled: false, reason: "DP-297 switch-off" })).status,
    ).toBe(200);
    // In the owner's transaction: the queue is cancelled and every held text wiped.
    for (const id of queuedIds) expect(await status(id)).toBe("CANCELLED");
    expect(await dbo.aiTransient.count({ where: { ciphertext: { not: null } } })).toBe(0);
    // The calls on both processes stop at their next poll.
    await until(async () => {
      const rows = await dbo.aiOperation.findMany({ where: { id: { in: runningIds } } });
      return rows.every((r) => r.status === "UNKNOWN" && r.errorCode === "ai_disabled");
    }, 3_000);
    expectError(await run(admin, A, "ping while off"), 404, "NOT_FOUND");
    expectError(await admin.callAt(B.url, "GET", `/ai/operations/${done}`), 404, "NOT_FOUND");
    // Switched on again: nothing restarts by itself, nothing from before is handed out.
    expect((await owner.call("POST", AI, { enabled: true, reason: "DP-297 back on" })).status).toBe(
      200,
    );
    await new Promise((r) => setTimeout(r, 1_500));
    expect(calls()).toBe(total);
    expect((await detailAt(admin, A, done)).result).toBeNull();
    for (const id of [...runningIds, ...queuedIds]) {
      expect(["CANCELLED", "UNKNOWN"]).toContain(await status(id));
    }
    expect(await noActive()).toBe(true);
    expect(await mismatches()).toBe(0);
    expect((await owner.call("POST", AI, { enabled: false, reason: "DP-297 done" })).status).toBe(
      200,
    );
  }, 60_000);
});
