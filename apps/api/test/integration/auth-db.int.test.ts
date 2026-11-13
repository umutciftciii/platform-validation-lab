// F1-002 Group 1 (DP-011; ADR-013) against the disposable *_test database only.
//
// Every client is one database role, as in production (ADR-012A): `app` = dp_app (the API),
// `owner` = dp_migrator acting as dp_owner, `boot` = dp_iam_bootstrap. What the API must not be
// able to do is tried as dp_app.
//
// Covers AC-DB-1..4, AC-DB-6, AC-TH-1 (integration), NT-DB1, NT-DB3..13, NT-T5, NT-L3 and the
// migration precheck. NT-DB1b and NT-DB2 need the "no administrator yet" state and therefore live
// in iam.int.test.ts next to the bootstrap tests. This file never creates a lasting platform
// administrator (only inside rolled-back transactions), so the bootstrap tests see the state they
// expect whichever file runs first.
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertTestDatabaseUrl } from "@dream/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { syncCatalog } from "../../src/iam/catalog-sync.js";
import { AUTH_RETENTION, CLEANUP_LOCK_KEY, runAuthCleanup } from "../../src/iam/auth/cleanup.js";
import { encryptSecret, mfaAad, parseKeyring } from "../../src/iam/auth/secret-box.js";
import { base32Encode, generateTotpSecret } from "../../src/iam/auth/totp.js";
import {
  generateRecoveryCodes,
  generateToken,
  hashRecoveryCode,
  hashToken,
} from "../../src/iam/auth/tokens.js";
import { AuthThrottleService, throttleKeys } from "../../src/iam/auth/throttle.js";
import { SESSION_POLICIES } from "../../src/iam/session-policy.js";
import { countQualifiedPlatformAdmins, loadActTarget } from "../../src/iam/repository.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const M1 = "20261111090000_f1_002_authentication";
const urls = {
  app: assertTestDatabaseUrl(process.env["DATABASE_URL"]).toString(),
  owner: assertTestDatabaseUrl(process.env["MIGRATE_DATABASE_URL"]).toString(),
  boot: assertTestDatabaseUrl(process.env["IAM_BOOTSTRAP_DATABASE_URL"]).toString(),
};
const client = (url: string) =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
let app: PrismaClient;
let owner: PrismaClient;
let boot: PrismaClient;
let BV: string;
let COM: string;
const run = Math.random().toString(36).slice(2, 8);
let seq = 0;
const ARGON = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";
const hex64 = () => randomBytes(32).toString("hex");
const DENIED = /permission denied/i;

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

function email(label: string) {
  return `${label}.${run}.${++seq}@example.test`;
}

async function staff(label: string, status: "ACTIVE" | "PENDING" | "SUSPENDED" = "ACTIVE") {
  const e = email(label);
  const enrolled = status !== "PENDING";
  return app.user.create({
    data: {
      email: e,
      emailNormalized: e,
      kind: "STAFF",
      status,
      ...(enrolled
        ? { passwordHash: ARGON, mfaEnrolledAt: new Date(), emailVerifiedAt: new Date() }
        : {}),
    },
  });
}

async function customer(label: string) {
  const e = email(label);
  return app.user.create({
    data: {
      email: e,
      emailNormalized: e,
      kind: "CUSTOMER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
}

async function roleId(key: string) {
  return (await app.role.findUniqueOrThrow({ where: { key } })).id;
}

function sessionData(userId: string, extra: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    tokenHash: hex64(),
    userId,
    kind: "STAFF" as const,
    app: "ADMIN" as const,
    siteId: null as string | null,
    securityVersion: 0,
    lastSeenAt: now,
    idleExpiresAt: new Date(now.getTime() + 30 * 60_000),
    absoluteExpiresAt: new Date(now.getTime() + 8 * 3600_000),
    ...extra,
  };
}

function tokenData(userId: string, extra: Record<string, unknown> = {}) {
  return {
    userId,
    purpose: "ADMIN_ENROLMENT" as const,
    tokenHash: hex64(),
    securityVersion: 0,
    app: "ADMIN" as const,
    expiresAt: new Date(Date.now() + 30 * 60_000),
    createdByType: "BOOTSTRAP" as const,
    ...extra,
  };
}

const keyring = parseKeyring(`1:${randomBytes(32).toString("base64url")}`);
function factorData(userId: string, extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  return {
    id,
    userId,
    type: "TOTP" as const,
    secretCiphertext: encryptSecret(keyring, generateTotpSecret(), mfaAad(userId, id)),
    ...extra,
  };
}

async function dbEvents(resourceId: string) {
  return app.auditEvent.findMany({
    where: { resourceId, action: { startsWith: "db." } },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
}

let grantor: { id: string };

beforeAll(async () => {
  execFileSync(path.join(API_DIR, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: API_DIR,
    env: process.env,
    stdio: "pipe",
  });
  app = client(urls.app);
  owner = client(urls.owner);
  boot = client(urls.boot);
  await syncCatalog(owner);
  BV = (await app.site.findUniqueOrThrow({ where: { key: "BV" } })).id;
  COM = (await app.site.findUniqueOrThrow({ where: { key: "CORPORATE" } })).id;
  grantor = await staff("grantor");
});

afterAll(async () => {
  await Promise.all([app, owner, boot].map((c) => c?.$disconnect()));
});

describe("AC-DB-1: M1 applied as dp_migrator, exactly the planned objects", () => {
  it("is recorded once in the migration history", async () => {
    const rows = await owner.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM _prisma_migrations
      WHERE migration_name = ${M1} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it("creates the five enums with their values and the five tables, owned by dp_owner", async () => {
    const enums = await app.$queryRaw<{ name: string; labels: string[] }[]>`
      SELECT t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS labels
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN ('CredentialTokenPurpose', 'AuthApp', 'MfaFactorType', 'SessionRevokeReason', 'AuthThrottleKind')
      GROUP BY t.typname ORDER BY t.typname`;
    expect(Object.fromEntries(enums.map((e) => [e.name, e.labels]))).toEqual({
      AuthApp: ["ADMIN", "WEB_BV", "WEB_CORPORATE"],
      AuthThrottleKind: ["ACCOUNT", "ACCOUNT_IP", "IP"],
      CredentialTokenPurpose: [
        "ADMIN_ENROLMENT",
        "STAFF_INVITE",
        "MFA_REENROLMENT",
        "ADMIN_RECOVERY",
        "PASSWORD_RESET",
        "EMAIL_VERIFICATION",
        "EMAIL_CHANGE",
        "LOGIN_MFA_CHALLENGE",
      ],
      MfaFactorType: ["TOTP", "WEBAUTHN"],
      SessionRevokeReason: [
        "LOGOUT",
        "ROTATED",
        "USER_REVOKED",
        "ADMIN_REVOKED",
        "SECURITY_VERSION",
        "LIMIT_EXCEEDED",
      ],
    });
    const tables = await app.$queryRaw<{ name: string; owner: string }[]>`
      SELECT c.relname AS name, pg_get_userbyid(c.relowner) AS owner FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
        AND c.relname IN ('UserCredentialToken', 'MfaFactor', 'MfaRecoveryCode', 'Session', 'AuthThrottle')
      ORDER BY c.relname`;
    expect(tables).toEqual(
      ["AuthThrottle", "MfaFactor", "MfaRecoveryCode", "Session", "UserCredentialToken"].map(
        (name) => ({ name, owner: "dp_owner" }),
      ),
    );
  });

  it("leaves the columns of the existing tables unchanged (failedLoginCount/lockedUntil kept, Ö4)", async () => {
    const cols = await app.$queryRaw<{ t: string; c: string[] }[]>`
      SELECT table_name AS t, array_agg(column_name::text ORDER BY ordinal_position)::text[] AS c
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('User', 'RoleAssignment', 'Site')
      GROUP BY table_name`;
    expect(Object.fromEntries(cols.map((r) => [r.t, r.c]))).toEqual({
      RoleAssignment: [
        "id",
        "userId",
        "roleId",
        "scopeType",
        "siteId",
        "grantedById",
        "grantedAt",
        "expiresAt",
        "revokedAt",
        "revokedById",
        "reason",
      ],
      Site: ["id", "key", "name", "primaryDomain", "defaultLocale", "createdAt", "updatedAt"],
      User: [
        "id",
        "email",
        "emailNormalized",
        "kind",
        "status",
        "displayName",
        "emailVerifiedAt",
        "passwordHash",
        "passwordUpdatedAt",
        "mfaEnrolledAt",
        "securityVersion",
        "failedLoginCount",
        "lockedUntil",
        "lastLoginAt",
        "createdAt",
        "updatedAt",
      ],
    });
  });

  it("gives dp_app data privileges on the new tables (no TRUNCATE/TRIGGER) and the bootstrap role nothing", async () => {
    const rows = await app.$queryRaw<{ t: string; who: string; p: string[] }[]>`
      SELECT t, who, array_agg(p ORDER BY p)::text[] AS p
      FROM unnest(ARRAY['UserCredentialToken', 'MfaFactor', 'MfaRecoveryCode', 'Session', 'AuthThrottle']) AS t,
           unnest(ARRAY['dp_app', 'dp_iam_bootstrap']) AS who,
           unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES']) AS p
      WHERE has_table_privilege(who, format('public.%I', t), p)
      GROUP BY t, who`;
    for (const t of [
      "UserCredentialToken",
      "MfaFactor",
      "MfaRecoveryCode",
      "Session",
      "AuthThrottle",
    ]) {
      expect(rows.find((r) => r.t === t && r.who === "dp_app")?.p, t).toEqual([
        "DELETE",
        "INSERT",
        "SELECT",
        "UPDATE",
      ]);
    }
    expect(rows.filter((r) => r.who === "dp_iam_bootstrap")).toEqual([]);
  });

  it("names every CHECK and trigger of M1 (each one is exercised below, AC-DB-2)", async () => {
    const checks = await app.$queryRaw<{ name: string }[]>`
      SELECT conname AS name FROM pg_constraint
      WHERE contype = 'c' AND connamespace = 'public'::regnamespace
        AND conrelid::regclass::text IN ('"UserCredentialToken"', '"MfaFactor"', '"MfaRecoveryCode"', '"Session"', '"AuthThrottle"')
      ORDER BY conname`;
    expect(checks.map((c) => c.name)).toEqual([
      "AuthThrottle_failures_check",
      "AuthThrottle_key_check",
      "MfaFactor_lastUsedStep_check",
      "MfaFactor_secretCiphertext_check",
      "MfaFactor_type_check",
      "MfaRecoveryCode_codeHash_check",
      "Session_app_kind_check",
      "Session_expiry_check",
      "Session_persistent_check",
      "Session_revocation_check",
      "Session_tokenHash_check",
      "UserCredentialToken_app_site_check",
      "UserCredentialToken_createdBy_check",
      "UserCredentialToken_expiry_check",
      "UserCredentialToken_failedAttempts_check",
      "UserCredentialToken_newEmail_check",
      "UserCredentialToken_tokenHash_check",
    ]);
    const triggers = await app.$queryRaw<{ name: string }[]>`
      SELECT tgname AS name FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname`;
    expect(triggers.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "AuditEvent_db_action_guard",
        "MfaFactor_db_audit",
        "MfaFactor_immutable",
        "MfaRecoveryCode_immutable",
        "RoleAssignment_db_audit",
        "RoleAssignment_grantor_guard",
        "RoleAssignment_null_grantor_guard",
        "Session_immutable",
        "Session_site_guard",
        "Session_staff_db_audit",
        "User_deactivated_terminal",
        "User_security_db_audit",
        "UserCredentialToken_immutable",
        "UserCredentialToken_site_guard",
      ]),
    );
  });
});

describe("migration precheck (design 8.3, NT-DB9 second part)", () => {
  const sql = readFileSync(path.join(API_DIR, "prisma/migrations", M1, "migration.sql"), "utf8");
  const precheck = /-- precheck:begin[^\n]*\n([\s\S]*?)-- precheck:end/.exec(sql)?.[1] ?? "";

  it("passes on the current data", async () => {
    expect(precheck).toMatch(/DO \$\$/);
    await rolledBack(owner, async (tx) => {
      await tx.$executeRawUnsafe(precheck);
    });
  });

  it("stops with a clear error, changing nothing, when existing rows would violate a new CHECK", async () => {
    await rolledBack(owner, async (tx) => {
      // Simulate pre-M1 data: drop the constraint inside this transaction and insert a half-enrolled
      // ACTIVE staff user, then run the precheck block of the migration.
      await tx.$executeRawUnsafe(
        `ALTER TABLE "User" DROP CONSTRAINT "User_staff_active_credentials_check"`,
      );
      const e = email("precheck");
      await tx.$executeRawUnsafe(
        `INSERT INTO "User" (id, email, "emailNormalized", kind, status, "emailVerifiedAt", "updatedAt")
         VALUES (gen_random_uuid(), '${e}', '${e}', 'STAFF', 'ACTIVE', now(), now())`,
      );
      await expect(tx.$executeRawUnsafe(precheck)).rejects.toThrow(
        /User_staff_active_credentials_check: 1 row\(s\).*nothing was changed/,
      );
    });
  });
});

describe("User and RoleAssignment constraints (design 8.3)", () => {
  it("NT-DB6: an ACTIVE staff user needs password and MFA; any ACTIVE user a verified e-mail", async () => {
    const e = email("half");
    await expect(
      app.user.create({
        data: {
          email: e,
          emailNormalized: e,
          kind: "STAFF",
          status: "ACTIVE",
          passwordHash: ARGON,
          emailVerifiedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/User_staff_active_credentials_check/);
    const pending = await staff("pending", "PENDING");
    await expect(
      app.user.update({
        where: { id: pending.id },
        data: { status: "ACTIVE", passwordHash: ARGON, emailVerifiedAt: new Date() },
      }),
    ).rejects.toThrow(/User_staff_active_credentials_check/);
    await expect(
      app.user.update({
        where: { id: pending.id },
        data: { status: "ACTIVE", passwordHash: ARGON, mfaEnrolledAt: new Date() },
      }),
    ).rejects.toThrow(/User_active_verified_check/);
    const c = email("cust");
    await expect(
      app.user.create({
        data: { email: c, emailNormalized: c, kind: "CUSTOMER", status: "ACTIVE" },
      }),
    ).rejects.toThrow(/User_active_verified_check/);
    // Accept: complete enrolment in one update.
    const done = await app.user.update({
      where: { id: pending.id },
      data: {
        status: "ACTIVE",
        passwordHash: ARGON,
        mfaEnrolledAt: new Date(),
        emailVerifiedAt: new Date(),
      },
    });
    expect(done.status).toBe("ACTIVE");
  });

  it("NT-DB1/NT-DB3: dp_app can never write an assignment without grantor, for any role", async () => {
    const pending = await staff("ng-target", "PENDING");
    const cust = await customer("ng-member");
    for (const [userId, key, scopeType, siteId] of [
      [pending.id, "platform_super_admin", "PLATFORM", null],
      [pending.id, "read_only", "SITE", BV],
      [cust.id, "member", "SITE", BV],
    ] as const) {
      await expect(
        app.roleAssignment.create({
          data: { userId, roleId: await roleId(key), scopeType, siteId, reason: "attempt" },
        }),
        key,
      ).rejects.toThrow(/without grantor is allowed only for the bootstrap, as dp_iam_bootstrap/);
    }
    // RoleAssignment_null_grantor_reason_check: the owner bypasses nothing either (no reason).
    await rolledBack(owner, async (tx) => {
      await tx.$executeRawUnsafe(
        `ALTER TABLE "RoleAssignment" DISABLE TRIGGER "RoleAssignment_null_grantor_guard"`,
      );
      await expect(
        tx.roleAssignment.create({
          data: {
            userId: pending.id,
            roleId: await roleId("read_only"),
            scopeType: "SITE",
            siteId: BV,
          },
        }),
      ).rejects.toThrow(/RoleAssignment_null_grantor_reason_check/);
    });
  });

  it("NT-DB3: the bootstrap role cannot assign member, nor anything with a grantor (T14)", async () => {
    const cust = await customer("boot-member");
    const target = await staff("boot-target", "PENDING");
    await expect(
      boot.$executeRaw`INSERT INTO "RoleAssignment" (id, "userId", "roleId", "scopeType", "siteId", reason)
        VALUES (gen_random_uuid(), ${cust.id}::uuid, ${await roleId("member")}::uuid, 'SITE', ${BV}::uuid, 'x')`,
    ).rejects.toThrow(/bootstrap may only assign platform_super_admin/);
    await expect(
      boot.$executeRaw`INSERT INTO "RoleAssignment" (id, "userId", "roleId", "scopeType", "grantedById")
        VALUES (gen_random_uuid(), ${target.id}::uuid, ${await roleId("platform_super_admin")}::uuid, 'PLATFORM', ${grantor.id}::uuid)`,
    ).rejects.toThrow(/dp_iam_bootstrap may only write the bootstrap assignment/);
  });

  it("NT-DB5: the grantor must be ACTIVE, MFA-enrolled staff (K-NG2)", async () => {
    const target = await staff("ng2-target");
    const readOnly = await roleId("read_only");
    const grant = (grantedById: string) =>
      app.roleAssignment.create({
        data: { userId: target.id, roleId: readOnly, scopeType: "SITE", siteId: BV, grantedById },
      });
    for (const bad of [
      await customer("ng2-cust"),
      await staff("ng2-susp", "SUSPENDED"),
      await staff("ng2-nomfa", "PENDING"),
    ]) {
      await expect(grant(bad.id)).rejects.toThrow(/grantor must be an ACTIVE staff user with MFA/);
    }
    await expect(grant(grantor.id)).resolves.toBeTruthy();
  });

  it("NT-DB4: an assignment's grantor can be neither cleared nor changed", async () => {
    const target = await staff("ng4");
    const a = await app.roleAssignment.create({
      data: {
        userId: target.id,
        roleId: await roleId("read_only"),
        scopeType: "SITE",
        siteId: BV,
        grantedById: grantor.id,
      },
    });
    const other = await staff("ng4-other");
    for (const grantedById of [null, other.id]) {
      await expect(
        app.roleAssignment.update({ where: { id: a.id }, data: { grantedById } }),
      ).rejects.toThrow(/identity is immutable/);
    }
  });

  it("AC-DB-6/NT-DB13: DEACTIVATED is terminal", async () => {
    const u = await staff("terminal");
    await app.user.update({ where: { id: u.id }, data: { status: "DEACTIVATED" } });
    for (const status of ["ACTIVE", "SUSPENDED", "PENDING"] as const) {
      await expect(
        app.user.update({ where: { id: u.id }, data: { status } }),
        status,
      ).rejects.toThrow(/DEACTIVATED user cannot change status/);
    }
    // Other fields of a deactivated user may still change (anonymisation later, A8).
    await expect(
      app.user.update({ where: { id: u.id }, data: { displayName: "former" } }),
    ).resolves.toMatchObject({ status: "DEACTIVATED" });
    const s = await staff("suspend-ok");
    await app.user.update({ where: { id: s.id }, data: { status: "SUSPENDED" } });
    await expect(
      app.user.update({ where: { id: s.id }, data: { status: "ACTIVE" } }),
    ).resolves.toBeTruthy();
  });
});

describe("Session (NT-DB7, NT-DB8)", () => {
  it("accepts a staff admin session and a customer site session", async () => {
    const s = await staff("sess");
    const c = await customer("sess-c");
    await expect(app.session.create({ data: sessionData(s.id) })).resolves.toBeTruthy();
    await expect(
      app.session.create({
        data: sessionData(c.id, { kind: "CUSTOMER", app: "WEB_BV", siteId: BV, persistent: true }),
      }),
    ).resolves.toBeTruthy();
    await expect(
      app.session.create({
        data: sessionData(c.id, { kind: "CUSTOMER", app: "WEB_CORPORATE", siteId: COM }),
      }),
    ).resolves.toBeTruthy();
  });

  it("refuses ADMIN+CUSTOMER, a site on an admin session, a wrong site, staff persistence and a kind mismatch", async () => {
    const s = await staff("sess-bad");
    const c = await customer("sess-bad-c");
    const cases: [Record<string, unknown>, string, RegExp][] = [
      [{ kind: "CUSTOMER" }, c.id, /Session_app_kind_check/],
      [{ siteId: BV }, s.id, /Session_app_kind_check/],
      [
        { kind: "CUSTOMER", app: "WEB_BV", siteId: COM },
        c.id,
        /session app does not match its site/,
      ],
      [
        { kind: "CUSTOMER", app: "WEB_CORPORATE", siteId: BV },
        c.id,
        /session app does not match its site/,
      ],
      [{ persistent: true }, s.id, /Session_persistent_check/],
      [{ kind: "CUSTOMER", app: "WEB_BV", siteId: BV }, s.id, /Session.kind must equal/],
      [{}, c.id, /Session.kind must equal/],
      [{ tokenHash: "x".repeat(64) }, s.id, /Session_tokenHash_check/],
      [{ idleExpiresAt: new Date(Date.now() + 9 * 3600_000) }, s.id, /Session_expiry_check/],
      [{ revokedAt: new Date() }, s.id, /Session_revocation_check/],
    ];
    for (const [extra, userId, error] of cases) {
      await expect(
        app.session.create({ data: sessionData(userId, extra) }),
        JSON.stringify(extra),
      ).rejects.toThrow(error);
    }
  });

  it("sets revokedAt/revokedReason once and keeps identity and absolute expiry fixed", async () => {
    const s = await staff("sess-imm");
    const row = await app.session.create({ data: sessionData(s.id) });
    // Sliding the idle expiry and recording a step-up are allowed.
    await app.session.update({
      where: { id: row.id },
      data: {
        lastSeenAt: new Date(),
        idleExpiresAt: new Date(Date.now() + 20 * 60_000),
        mfaVerifiedAt: new Date(),
      },
    });
    await app.session.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), revokedReason: "LOGOUT" },
    });
    for (const data of [
      { revokedAt: null, revokedReason: null },
      { revokedAt: new Date(Date.now() + 1000) },
      { revokedReason: "ADMIN_REVOKED" as const },
    ]) {
      await expect(
        app.session.update({ where: { id: row.id }, data }),
        JSON.stringify(data),
      ).rejects.toThrow(/revokedAt and revokedReason are set once|Session_revocation_check/);
    }
    const live = await app.session.create({ data: sessionData(s.id) });
    for (const data of [
      { tokenHash: hex64() },
      { userId: grantor.id },
      { securityVersion: 5 },
      { absoluteExpiresAt: new Date(Date.now() + 24 * 3600_000) },
      { rotatedFromId: row.id },
    ]) {
      await expect(
        app.session.update({ where: { id: live.id }, data }),
        Object.keys(data)[0],
      ).rejects.toThrow(/identity, owner and absolute expiry of a session are immutable/);
    }
  });
});

describe("UserCredentialToken, MfaFactor, MfaRecoveryCode (NT-DB8, NT-DB9)", () => {
  it("allows one live token per user and purpose; a consumed or invalidated one frees the slot", async () => {
    const u = await staff("tok", "PENDING");
    const first = await app.userCredentialToken.create({ data: tokenData(u.id) });
    await expect(app.userCredentialToken.create({ data: tokenData(u.id) })).rejects.toThrow(
      /Unique constraint|UserCredentialToken_live_userId_purpose_key/,
    );
    await expect(
      app.userCredentialToken.create({ data: tokenData(u.id, { purpose: "PASSWORD_RESET" }) }),
    ).resolves.toBeTruthy();
    await app.userCredentialToken.update({
      where: { id: first.id },
      data: { invalidatedAt: new Date() },
    });
    await expect(app.userCredentialToken.create({ data: tokenData(u.id) })).resolves.toBeTruthy();
  });

  it("enforces the token CHECKs", async () => {
    const u = await staff("tok-chk", "PENDING");
    const c = await customer("tok-chk-c");
    const cases: [string, Record<string, unknown>, RegExp][] = [
      [u.id, { tokenHash: "Z".repeat(64) }, /UserCredentialToken_tokenHash_check/],
      [u.id, { expiresAt: new Date(Date.now() - 1000) }, /UserCredentialToken_expiry_check/],
      [u.id, { failedAttempts: 6 }, /UserCredentialToken_failedAttempts_check/],
      [u.id, { createdByType: "USER" }, /UserCredentialToken_createdBy_check/],
      [
        u.id,
        { createdByType: "SYSTEM", createdByUserId: grantor.id },
        /UserCredentialToken_createdBy_check/,
      ],
      [u.id, { purpose: "EMAIL_CHANGE" }, /UserCredentialToken_newEmail_check/],
      [
        u.id,
        { purpose: "EMAIL_CHANGE", newEmail: "Mixed@Example.test" },
        /UserCredentialToken_newEmail_check/,
      ],
      [u.id, { newEmail: "x@example.test" }, /UserCredentialToken_newEmail_check/],
      [c.id, { siteId: BV }, /UserCredentialToken_app_site_check/], // app ADMIN + site
      [u.id, { app: "WEB_BV", siteId: BV }, /only customer tokens carry a site/],
      [
        c.id,
        { app: "WEB_CORPORATE", siteId: BV, purpose: "EMAIL_VERIFICATION" },
        /token app does not match its site/,
      ],
    ];
    for (const [userId, extra, error] of cases) {
      await expect(
        app.userCredentialToken.create({ data: tokenData(userId, extra) }),
        JSON.stringify(extra),
      ).rejects.toThrow(error);
    }
    await expect(
      app.userCredentialToken.create({
        data: tokenData(c.id, {
          purpose: "EMAIL_CHANGE",
          newEmail: "new@example.test",
          app: "WEB_BV",
          siteId: BV,
        }),
      }),
    ).resolves.toBeTruthy();
    await expect(
      app.userCredentialToken.create({
        data: tokenData(u.id, {
          purpose: "STAFF_INVITE",
          createdByType: "USER",
          createdByUserId: grantor.id,
        }),
      }),
    ).resolves.toBeTruthy();
  });

  it("sets consumedAt/invalidatedAt once, never lowers failedAttempts and keeps the token's identity", async () => {
    const u = await staff("tok-imm", "PENDING");
    const t = await app.userCredentialToken.create({ data: tokenData(u.id) });
    await app.userCredentialToken.update({ where: { id: t.id }, data: { failedAttempts: 2 } });
    await expect(
      app.userCredentialToken.update({ where: { id: t.id }, data: { failedAttempts: 1 } }),
    ).rejects.toThrow(/failedAttempts never decreases/);
    await app.userCredentialToken.update({ where: { id: t.id }, data: { consumedAt: new Date() } });
    for (const data of [{ consumedAt: null }, { consumedAt: new Date(Date.now() + 5000) }]) {
      await expect(app.userCredentialToken.update({ where: { id: t.id }, data })).rejects.toThrow(
        /consumedAt and invalidatedAt are set once/,
      );
    }
    const t2 = await app.userCredentialToken.create({
      data: tokenData(u.id, { purpose: "PASSWORD_RESET" }),
    });
    await app.userCredentialToken.update({
      where: { id: t2.id },
      data: { invalidatedAt: new Date() },
    });
    await expect(
      app.userCredentialToken.update({ where: { id: t2.id }, data: { invalidatedAt: null } }),
    ).rejects.toThrow(/set once/);
    const t3 = await app.userCredentialToken.create({
      data: tokenData(u.id, { purpose: "MFA_REENROLMENT" }),
    });
    for (const data of [
      { tokenHash: hex64() },
      { expiresAt: new Date(Date.now() + 3600_000) },
      { securityVersion: 1 },
      { userId: grantor.id },
    ]) {
      await expect(
        app.userCredentialToken.update({ where: { id: t3.id }, data }),
        Object.keys(data)[0],
      ).rejects.toThrow(/credential token is immutable/);
    }
  });

  it("MfaFactor: TOTP only, ciphertext format, one confirmed factor per type, replay step never goes back", async () => {
    const u = await staff("mfa", "PENDING");
    await expect(
      app.mfaFactor.create({ data: factorData(u.id, { type: "WEBAUTHN" }) }),
    ).rejects.toThrow(/MfaFactor_type_check/);
    await expect(
      app.mfaFactor.create({
        data: factorData(u.id, { secretCiphertext: base32Encode(generateTotpSecret()) }),
      }),
    ).rejects.toThrow(/MfaFactor_secretCiphertext_check/);
    await expect(
      app.mfaFactor.create({ data: factorData(u.id, { lastUsedStep: -1n }) }),
    ).rejects.toThrow(/MfaFactor_lastUsedStep_check/);
    const f1 = await app.mfaFactor.create({ data: factorData(u.id, { confirmedAt: new Date() }) });
    const pendingSetup = await app.mfaFactor.create({ data: factorData(u.id) }); // unconfirmed: allowed
    await expect(
      app.mfaFactor.update({ where: { id: pendingSetup.id }, data: { confirmedAt: new Date() } }),
    ).rejects.toThrow(/Unique constraint|MfaFactor_confirmed_userId_type_key/);
    await app.mfaFactor.update({ where: { id: f1.id }, data: { lastUsedStep: 100n } });
    await expect(
      app.mfaFactor.update({ where: { id: f1.id }, data: { lastUsedStep: 99n } }),
    ).rejects.toThrow(/lastUsedStep never goes back/);
    await expect(
      app.mfaFactor.update({ where: { id: f1.id }, data: { lastUsedStep: null } }),
    ).rejects.toThrow(/lastUsedStep never goes back/);
    await expect(
      app.mfaFactor.update({ where: { id: f1.id }, data: { confirmedAt: null } }),
    ).rejects.toThrow(/confirmedAt is set once/);
    await expect(
      app.mfaFactor.update({ where: { id: f1.id }, data: { userId: grantor.id } }),
    ).rejects.toThrow(/owner and type of an MFA factor are immutable/);
    // The conditional replay update accepts a later step exactly once.
    const won = await app.mfaFactor.updateMany({
      where: { id: f1.id, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: 101n } }] },
      data: { lastUsedStep: 101n, lastUsedAt: new Date() },
    });
    const lost = await app.mfaFactor.updateMany({
      where: { id: f1.id, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: 101n } }] },
      data: { lastUsedStep: 101n, lastUsedAt: new Date() },
    });
    expect([won.count, lost.count]).toEqual([1, 0]);
  });

  it("MfaRecoveryCode: HMAC-shaped hash, unique per user, usedAt set once (NT-L3)", async () => {
    const u = await staff("rc", "PENDING");
    const hmacKey = randomBytes(32);
    const [code] = generateRecoveryCodes(1) as [string];
    const codeHash = hashRecoveryCode(hmacKey, code);
    const rc = await app.mfaRecoveryCode.create({ data: { userId: u.id, codeHash } });
    expect(rc.codeHash).not.toContain(code);
    await expect(app.mfaRecoveryCode.create({ data: { userId: u.id, codeHash } })).rejects.toThrow(
      /Unique constraint/,
    );
    await expect(
      app.mfaRecoveryCode.create({ data: { userId: u.id, codeHash: "Z".repeat(64) } }),
    ).rejects.toThrow(/MfaRecoveryCode_codeHash_check/);
    await app.mfaRecoveryCode.update({ where: { id: rc.id }, data: { usedAt: new Date() } });
    await expect(
      app.mfaRecoveryCode.update({ where: { id: rc.id }, data: { usedAt: null } }),
    ).rejects.toThrow(/usedAt is set once/);
    await expect(
      app.mfaRecoveryCode.update({ where: { id: rc.id }, data: { codeHash: hex64() } }),
    ).rejects.toThrow(/recovery code is immutable/);
  });

  it("NT-L3: the stored TOTP secret is ciphertext, not the secret", async () => {
    const u = await staff("l3", "PENDING");
    const id = randomUUID();
    const secret = generateTotpSecret();
    await app.mfaFactor.create({
      data: {
        id,
        userId: u.id,
        type: "TOTP",
        secretCiphertext: encryptSecret(keyring, secret, mfaAad(u.id, id)),
      },
    });
    const rows = await app.$queryRaw<
      { s: string }[]
    >`SELECT "secretCiphertext" AS s FROM "MfaFactor" WHERE id = ${id}::uuid`;
    const stored = rows[0]?.s ?? "";
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain(base32Encode(secret));
    expect(stored).not.toContain(secret.toString("hex"));
    expect(stored).not.toContain(secret.toString("base64url"));
  });

  it("AuthThrottle CHECKs: hex key, non-negative failures", async () => {
    const now = new Date();
    const base = { kind: "IP" as const, windowStartedAt: now, lastFailureAt: now, updatedAt: now };
    await expect(
      app.authThrottle.create({ data: { ...base, key: "user@example.test".padEnd(64, "x") } }),
    ).rejects.toThrow(/AuthThrottle_key_check/);
    await expect(
      app.authThrottle.create({ data: { ...base, key: hex64(), failures: -1 } }),
    ).rejects.toThrow(/AuthThrottle_failures_check/);
    await expect(
      app.authThrottle.create({ data: { ...base, key: hex64() } }),
    ).resolves.toBeTruthy();
  });
});

describe("K-NG3: database-generated audit (AC-DB-4, NT-DB10..12)", () => {
  it("NT-DB11: a forged-grantor assignment still leaves db.role_assignment_created with dbUser = dp_app", async () => {
    const target = await staff("forge");
    const a = await app.roleAssignment.create({
      data: {
        userId: target.id,
        roleId: await roleId("read_only"),
        scopeType: "SITE",
        siteId: BV,
        grantedById: grantor.id,
      },
    });
    const events = await dbEvents(a.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "db.role_assignment_created",
      actorType: "SYSTEM",
      actorUserId: null,
      resourceType: "role_assignment",
      scopeType: "SITE",
      siteId: BV,
      outcome: "SUCCESS",
      metadata: {
        dbUser: "dp_app",
        source: "database_trigger",
        operation: "insert",
        userId: target.id,
        role: "read_only",
        claimedActor: grantor.id,
        nullGrantor: false,
      },
    });
  });

  it("writes exactly one db.role_assignment_changed per revoke or expiry change, none for other updates", async () => {
    const target = await staff("ra-change");
    const a = await app.roleAssignment.create({
      data: {
        userId: target.id,
        roleId: await roleId("read_only"),
        scopeType: "SITE",
        siteId: BV,
        grantedById: grantor.id,
      },
    });
    await app.roleAssignment.update({ where: { id: a.id }, data: { reason: "note only" } });
    expect(await dbEvents(a.id)).toHaveLength(1);
    await app.roleAssignment.update({
      where: { id: a.id },
      data: { expiresAt: new Date(Date.now() + 86_400_000) },
    });
    await app.roleAssignment.update({
      where: { id: a.id },
      data: { revokedAt: new Date(), revokedById: grantor.id },
    });
    const events = await dbEvents(a.id);
    expect(events.map((e) => e.action).sort()).toEqual([
      "db.role_assignment_changed",
      "db.role_assignment_changed",
      "db.role_assignment_created",
    ]);
    const changed = (field: string) =>
      events.find(
        (e) => JSON.stringify((e.metadata as { changed?: string[] }).changed) === `["${field}"]`,
      )?.metadata;
    expect(changed("expiresAt")).toMatchObject({ operation: "update" });
    expect(changed("revokedAt")).toMatchObject({ operation: "update", claimedActor: grantor.id });
  });

  it("records security-relevant user changes by field name only, never values", async () => {
    const u = await staff("usec", "PENDING");
    await app.user.update({ where: { id: u.id }, data: { displayName: "no audit" } });
    expect(await dbEvents(u.id)).toHaveLength(0);
    await app.user.update({
      where: { id: u.id },
      data: {
        status: "ACTIVE",
        passwordHash: ARGON,
        mfaEnrolledAt: new Date(),
        emailVerifiedAt: new Date(),
        securityVersion: { increment: 1 },
      },
    });
    const events = await dbEvents(u.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "db.user_security_changed",
      resourceType: "user",
      scopeType: "PLATFORM",
      metadata: {
        dbUser: "dp_app",
        kind: "STAFF",
        changed: ["status", "passwordHash", "mfaEnrolledAt", "securityVersion"],
      },
    });
    expect(JSON.stringify(events[0]?.metadata)).not.toContain("argon2");
    expect(JSON.stringify(events[0]?.metadata)).not.toContain("ACTIVE");
  });

  it("NT-DB12: a staff session is audited, a customer session is not", async () => {
    const s = await staff("sess-audit");
    const c = await customer("sess-audit-c");
    const staffSession = await app.session.create({
      data: sessionData(s.id, { mfaVerifiedAt: new Date() }),
    });
    const custSession = await app.session.create({
      data: sessionData(c.id, { kind: "CUSTOMER", app: "WEB_BV", siteId: BV }),
    });
    const events = await dbEvents(staffSession.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "db.staff_session_created",
      metadata: { dbUser: "dp_app", claimedActor: s.id, app: "ADMIN", mfaVerified: true },
    });
    expect(JSON.stringify(events[0]?.metadata)).not.toContain(staffSession.tokenHash);
    expect(await dbEvents(custSession.id)).toHaveLength(0);
  });

  it("audits MFA factor confirmation and removal", async () => {
    const u = await staff("mfa-audit", "PENDING");
    const f = await app.mfaFactor.create({ data: factorData(u.id) });
    expect(await dbEvents(f.id)).toHaveLength(0);
    await app.mfaFactor.update({ where: { id: f.id }, data: { confirmedAt: new Date() } });
    await app.mfaFactor.update({ where: { id: f.id }, data: { lastUsedStep: 5n } }); // no event
    await app.mfaFactor.delete({ where: { id: f.id } });
    const events = await dbEvents(f.id);
    expect(events.map((e) => [e.action, (e.metadata as { change: string }).change]).sort()).toEqual(
      [
        ["db.mfa_factor_changed", "confirmed"],
        ["db.mfa_factor_changed", "deleted"],
      ],
    );
    expect(JSON.stringify(events.map((e) => e.metadata))).not.toMatch(/^v1:|secret/i);
  });

  it("NT-DB10: dp_app can neither change nor delete db.* events, nor forge one", async () => {
    const u = await staff("ndb10", "PENDING");
    await app.user.update({ where: { id: u.id }, data: { securityVersion: { increment: 1 } } });
    const [event] = await dbEvents(u.id);
    expect(event).toBeTruthy();
    await expect(
      app.auditEvent.update({ where: { id: event!.id }, data: { outcome: "FAILURE" } }),
    ).rejects.toThrow(DENIED);
    await expect(app.auditEvent.delete({ where: { id: event!.id } })).rejects.toThrow(DENIED);
    await expect(
      app.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE action LIKE 'db.%'`),
    ).rejects.toThrow(DENIED);
    await expect(
      app.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          action: "db.role_assignment_created",
          resourceType: "role_assignment",
          scopeType: "PLATFORM",
          outcome: "SUCCESS",
        },
      }),
    ).rejects.toThrow(/written only by database triggers/);
    await expect(
      app.$executeRawUnsafe(
        `SELECT iam_db_audit('db.user_security_changed', 'user', NULL, 'PLATFORM', NULL, '{}')`,
      ),
    ).rejects.toThrow(/written only by database triggers/);
    await expect(
      app.$executeRawUnsafe(
        `ALTER TABLE "RoleAssignment" DISABLE TRIGGER "RoleAssignment_db_audit"`,
      ),
    ).rejects.toThrow(/must be owner/);
    expect(await app.auditEvent.findUnique({ where: { id: event!.id } })).not.toBeNull();
  });
});

describe("loaders for canActOnUser", () => {
  it("loads a target's grants and non-revoked memberships", async () => {
    const t = await staff("act-target");
    await app.membership.create({ data: { userId: t.id, siteId: BV, status: "ACTIVE" } });
    await app.membership.create({ data: { userId: t.id, siteId: COM, status: "REVOKED" } });
    await app.roleAssignment.create({
      data: {
        userId: t.id,
        roleId: await roleId("content_editor"),
        scopeType: "SITE",
        siteId: BV,
        grantedById: grantor.id,
      },
    });
    const loaded = await loadActTarget(app, t.id);
    expect(loaded).toMatchObject({ userId: t.id, kind: "STAFF", status: "ACTIVE" });
    expect([...(loaded?.membershipSiteIds ?? [])]).toEqual([BV]);
    expect(loaded?.grants.map((g) => [g.roleKey, g.siteId])).toEqual([["content_editor", BV]]);
    expect(await loadActTarget(app, randomUUID())).toBeNull();
  });

  it("counts only ACTIVE, MFA-enrolled, non-expiring platform admins, excluding actor and target", async () => {
    await rolledBack(app, async (tx) => {
      const base = await countQualifiedPlatformAdmins(tx, []);
      const sa = await tx.role.findUniqueOrThrow({ where: { key: "platform_super_admin" } });
      const mk = async (label: string, extra: Record<string, unknown> = {}) => {
        const e = email(label);
        const u = await tx.user.create({
          data: {
            email: e,
            emailNormalized: e,
            kind: "STAFF",
            status: "ACTIVE",
            passwordHash: ARGON,
            mfaEnrolledAt: new Date(),
            emailVerifiedAt: new Date(),
          },
        });
        await tx.roleAssignment.create({
          data: {
            userId: u.id,
            roleId: sa.id,
            scopeType: "PLATFORM",
            grantedById: grantor.id,
            ...extra,
          },
        });
        return u;
      };
      const a = await mk("qa");
      await mk("qb", { expiresAt: new Date(Date.now() + 86_400_000) });
      expect(await countQualifiedPlatformAdmins(tx, [])).toBe(base + 1);
      expect(await countQualifiedPlatformAdmins(tx, [a.id])).toBe(base);
    });
  });
});

describe("last administrator: code rule and F1-001 database guards agree (design 10.5)", () => {
  it("lets one of two qualified admins deactivate the other; the database accepts it and then guards the last one", async () => {
    await rolledBack(app, async (tx) => {
      const sa = await tx.role.findUniqueOrThrow({ where: { key: "platform_super_admin" } });
      const mk = async (label: string) => {
        const e = email(label);
        const u = await tx.user.create({
          data: {
            email: e,
            emailNormalized: e,
            kind: "STAFF",
            status: "ACTIVE",
            passwordHash: ARGON,
            mfaEnrolledAt: new Date(),
            emailVerifiedAt: new Date(),
          },
        });
        const a = await tx.roleAssignment.create({
          data: { userId: u.id, roleId: sa.id, scopeType: "PLATFORM", grantedById: grantor.id },
        });
        return { userId: u.id, assignmentId: a.id };
      };
      const base = await countQualifiedPlatformAdmins(tx, []);
      // The F1-001 guard's own count (ACTIVE or PENDING, not expired) before this test's admins.
      const dbRows = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT iam_platform_admins_remaining(NULL, NULL) AS n`;
      const dbBase = Number(dbRows[0]?.n ?? -1);
      const actor = await mk("la-actor");
      const target = await mk("la-target");
      // What remains after removing the target: the actor (plus any pre-existing ones).
      expect(await countQualifiedPlatformAdmins(tx, [target.userId])).toBe(base + 1);
      // The deactivation order of design 10.5: assignments first, then the user.
      await tx.roleAssignment.update({
        where: { id: target.assignmentId },
        data: { revokedAt: new Date(), revokedById: actor.userId, reason: "deactivate" },
      });
      await tx.user.update({ where: { id: target.userId }, data: { status: "DEACTIVATED" } });
      if (dbBase === 0) {
        // Only the actor remains: the F1-001 database guard refuses removing it.
        await expect(
          tx.roleAssignment.update({
            where: { id: actor.assignmentId },
            data: { revokedAt: new Date() },
          }),
        ).rejects.toThrow(/last active platform administrator/);
      }
    });
  });
});

describe("AuthThrottle on PostgreSQL (AC-TH-1, NT-T5)", () => {
  const hmacKey = randomBytes(32);
  const policy = SESSION_POLICIES.STAFF.throttle;
  const t0 = new Date("2026-11-11T10:00:00Z");
  const at = (s: number) => new Date(t0.getTime() + s * 1000);

  it("pushes notBefore out from the 4th failure; an early check counts nothing", async () => {
    const svc = new AuthThrottleService(app);
    const keys = throttleKeys(hmacKey, email("thr"), "203.0.113.0/24");
    for (let i = 0; i < 4; i++) await svc.recordFailure(keys, policy, at(i));
    expect(await svc.check(keys, at(4))).toEqual({ allowed: false, retryAfterSec: 1 });
    const row = await app.authThrottle.findUniqueOrThrow({ where: { key: keys.accountIp } });
    expect(row).toMatchObject({ kind: "ACCOUNT_IP", failures: 4, notBefore: at(5) });
    expect(await svc.check(keys, at(5))).toEqual({ allowed: true });
    expect(
      (await app.authThrottle.findUniqueOrThrow({ where: { key: keys.accountIp } })).failures,
    ).toBe(4);
  });

  it("counts concurrent failures exactly (row lock)", async () => {
    const svc = new AuthThrottleService(app);
    const keys = throttleKeys(hmacKey, email("thr-par"), "198.51.100.0/24");
    await Promise.all(Array.from({ length: 20 }, () => svc.recordFailure(keys, policy, at(0))));
    const rows = await app.authThrottle.findMany({
      where: { key: { in: [keys.account, keys.accountIp, keys.ip] } },
    });
    expect(rows.map((r) => r.failures)).toEqual([20, 20, 20]);
  });

  it("NT-T5: success and unlock clear the account buckets; User lock columns never change", async () => {
    const u = await staff("thr-user");
    const svc = new AuthThrottleService(app);
    const k1 = throttleKeys(hmacKey, u.emailNormalized, "203.0.113.0/24");
    const k2 = throttleKeys(hmacKey, u.emailNormalized, "192.0.2.0/24");
    const other = throttleKeys(hmacKey, email("thr-other"), "203.0.113.0/24");
    for (let i = 0; i < 6; i++) {
      await svc.recordFailure(k1, policy, at(i));
      await svc.recordFailure(k2, policy, at(i));
      await svc.recordFailure(other, policy, at(i));
    }
    await svc.recordSuccess(k1);
    expect(
      await app.authThrottle.count({ where: { key: { in: [k1.account, k1.accountIp] } } }),
    ).toBe(0);
    expect(await app.authThrottle.count({ where: { key: k2.accountIp } })).toBe(1);
    for (let i = 0; i < 3; i++) await svc.recordFailure(k1, policy, at(10 + i));
    expect(await svc.unlock(k1.account)).toBe(3); // account + both account+IP buckets
    expect(
      await app.authThrottle.count({
        where: { key: { in: [k1.account, k1.accountIp, k2.accountIp] } },
      }),
    ).toBe(0);
    expect(
      await app.authThrottle.count({ where: { key: { in: [other.account, other.accountIp] } } }),
    ).toBe(2);
    expect(await app.authThrottle.count({ where: { key: k1.ip } })).toBe(1); // IP bucket untouched
    const after = await app.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });
});

describe("retention clean-up (design 8.6)", () => {
  it("removes expired rows only, and skips a round while another instance holds the lock", async () => {
    const now = new Date();
    const old = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const u = await staff("clean");
    const c = await customer("clean-c");
    const keep = await app.session.create({ data: sessionData(u.id) });
    // A revoked session from 31 days ago (written with backdated timestamps).
    const gone = await app.session.create({
      data: sessionData(u.id, {
        createdAt: old(40),
        lastSeenAt: old(40),
        idleExpiresAt: old(39),
        absoluteExpiresAt: old(39),
        revokedAt: old(31),
        revokedReason: "LOGOUT",
      }),
    });
    const child = await app.session.create({ data: sessionData(u.id, { rotatedFromId: gone.id }) });
    const oldToken = await app.userCredentialToken.create({
      data: tokenData(c.id, {
        purpose: "EMAIL_VERIFICATION",
        app: "WEB_BV",
        siteId: BV,
        createdAt: old(10),
        expiresAt: old(9),
      }),
    });
    const liveToken = await app.userCredentialToken.create({
      data: tokenData(u.id, { purpose: "PASSWORD_RESET" }),
    });
    const p = await staff("clean-mfa", "PENDING");
    const staleFactor = await app.mfaFactor.create({
      data: factorData(p.id, { createdAt: new Date(now.getTime() - 16 * 60_000) }),
    });
    const freshFactor = await app.mfaFactor.create({ data: factorData(p.id) });
    const bucketOld = hex64();
    const bucketBlocked = hex64();
    const day = 86_400_000;
    await app.authThrottle.createMany({
      data: [
        {
          key: bucketOld,
          kind: "IP",
          windowStartedAt: old(2),
          lastFailureAt: old(2),
          updatedAt: new Date(now.getTime() - day - 1000),
        },
        {
          key: bucketBlocked,
          kind: "IP",
          windowStartedAt: old(2),
          lastFailureAt: old(2),
          updatedAt: new Date(now.getTime() - day - 1000),
          notBefore: new Date(now.getTime() + 60_000),
        },
      ],
    });

    // Another instance holds the lock: this round does nothing.
    await app.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${CLEANUP_LOCK_KEY})`;
      expect(await runAuthCleanup(app, now)).toBeNull();
    });

    const result = await runAuthCleanup(app, now);
    expect(result).not.toBeNull();
    expect(result!.sessions).toBeGreaterThanOrEqual(1);
    expect(await app.session.findUnique({ where: { id: gone.id } })).toBeNull();
    expect(await app.session.findUnique({ where: { id: keep.id } })).not.toBeNull();
    expect(
      (await app.session.findUniqueOrThrow({ where: { id: child.id } })).rotatedFromId,
    ).toBeNull();
    expect(await app.userCredentialToken.findUnique({ where: { id: oldToken.id } })).toBeNull();
    expect(
      await app.userCredentialToken.findUnique({ where: { id: liveToken.id } }),
    ).not.toBeNull();
    expect(await app.mfaFactor.findUnique({ where: { id: staleFactor.id } })).toBeNull();
    expect(await app.mfaFactor.findUnique({ where: { id: freshFactor.id } })).not.toBeNull();
    expect(await app.authThrottle.findUnique({ where: { key: bucketOld } })).toBeNull();
    expect(await app.authThrottle.findUnique({ where: { key: bucketBlocked } })).not.toBeNull();
    expect(AUTH_RETENTION).toEqual({
      sessionDays: 30,
      tokenDays: 7,
      unconfirmedFactorMinutes: 15,
      throttleHours: 24,
    });
  });

  it("keeps tokens and sessions out of URLs: only digests are stored", async () => {
    const u = await staff("digest", "PENDING");
    const token = generateToken();
    const row = await app.userCredentialToken.create({
      data: tokenData(u.id, { tokenHash: hashToken(token) }),
    });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toContain(token);
  });
});
