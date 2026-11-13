// F1-002 Group 2 (DP-011): staff authentication end to end, over HTTP and the operator CLI, on a
// database of its own (AUTH_*_DATABASE_URL, a *_test database that starts EMPTY: no schema, no
// catalogue, no administrator). Nothing here touches the shared integration database, so the
// bootstrap tests in iam.int.test.ts keep their "no administrator yet" state.
//
// The API runs in-process from dist/ through createApiApp (the production wiring: proxy key,
// CSRF, body limit, error envelope), connected as dp_app. Requests carry the admin proxy key as
// the admin Route Handler would. The CLI runs as a child process with exactly one database URL,
// as an operator would run it. The API clock is moved forward for timeouts; TOTP codes follow it.
//
// Order matters: the first block is the owner's end-to-end scenario (empty DB -> catalogue sync
// -> bootstrap -> activation -> TOTP -> login -> MFA -> step-up -> second administrator ->
// deactivation); later blocks reuse its administrator.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  EnrolInspectResponseSchema,
  EnrolMfaConfirmResponseSchema,
  EnrolMfaSetupResponseSchema,
  ErrorBodySchema,
  InviteUserResponseSchema,
  MfaResetResponseSchema,
  RecoveryCodesResponseSchema,
  StaffLoginResponseSchema,
  StaffSessionListResponseSchema,
  StaffSessionResponseSchema,
} from "@dream/contracts";
import { assertTestDatabaseUrl } from "@dream/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { AuthThrottleService, throttleKeys } from "../../src/iam/auth/throttle.js";
import { base32Decode, hotp, totpStep } from "../../src/iam/auth/totp.js";
import { SESSION_POLICIES } from "../../src/iam/session-policy.js";
import { ADMIN_ORIGIN, TEST_KEYS, apiTestEnv } from "./helpers/auth-env.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(API_DIR, "dist/iam/iam-cli.js");
const PRISMA = path.join(API_DIR, "node_modules/.bin/prisma");
const urls = {
  app: assertTestDatabaseUrl(process.env["AUTH_DATABASE_URL"]).toString(),
  migrate: assertTestDatabaseUrl(process.env["AUTH_MIGRATE_DATABASE_URL"]).toString(),
  boot: assertTestDatabaseUrl(process.env["AUTH_IAM_BOOTSTRAP_DATABASE_URL"]).toString(),
};
const DB_NAME = new URL(urls.app).pathname.slice(1);
const SHARED_DB = process.env["DATABASE_URL"];
const ENV_BACKUP = { ...process.env };
if (SHARED_DB && new URL(SHARED_DB).pathname === new URL(urls.app).pathname) {
  throw new Error("AUTH_DATABASE_URL must be a database of its own (it starts empty)");
}

/**
 * Test passwords, generated per run: none is stored in the repository (gitleaks), and each is long
 * enough for the staff policy, not on the breached list and free of names and e-mail parts.
 */
const pw = (tag: string) => `${tag}-${randomBytes(12).toString("hex")}`; // hex: no name or e-mail part fits
const PW = {
  admin_chosen_password_1: pw("Admin"),
  another_long_pass_77: pw("Another"),
  granite_orchid_compass_55: pw("Granite"),
  guessing_the_password_1: pw("Guessing"),
  harbour_glacier_mosaic_61: pw("Harbour"),
  kestrel_harbour_lantern_27: pw("Kestrel"),
  lighthouse_tundra_pepper_31: pw("Lighthouse"),
  nightjar_copper_basin_90: pw("Nightjar"),
  not_my_password_1: pw("Not"),
  not_the_password_1: pw("Not"),
  quartz_meadow_violin_0418: pw("Quartz"),
  spray_password_1: pw("Spray"),
  whatever_long_enough_1: pw("Whatever"),
  wrong_password_123: pw("Wrong"),
};

const PASSWORD = {
  admin: PW.kestrel_harbour_lantern_27,
  second: PW.quartz_meadow_violin_0418,
  staff: PW.granite_orchid_compass_55,
};

// ------------------------------------------------------------------------------------------
// Harness
// ------------------------------------------------------------------------------------------

interface TestClock {
  now(): Date;
  advance(ms: number): void;
}
interface Faults {
  armed: string | null;
}
interface Metrics {
  rejected: number;
  accepted: Record<string, { current: number; next: number }>;
}
interface App {
  listen(port: number, host: string): Promise<unknown>;
  getHttpServer(): { address(): unknown };
  get<T>(token: unknown): T;
  close(): Promise<void>;
}
interface Factory {
  createApiApp(o: { logger: unknown }): Promise<App>;
  Clock: unknown;
  FaultInjector: unknown;
  ProxyKeyMetrics: unknown;
}

const logLines: string[] = [];
const captureLogger = {
  log: (m: unknown) => logLines.push(String(m)),
  error: (m: unknown, ...rest: unknown[]) => logLines.push([m, ...rest].map(String).join(" ")),
  warn: (m: unknown) => logLines.push(String(m)),
  debug: (m: unknown) => logLines.push(String(m)),
  verbose: (m: unknown) => logLines.push(String(m)),
  fatal: (m: unknown) => logLines.push(String(m)),
};

let factory: Factory;
let app: App;
let base: string;
let clock: TestClock;
let faults: Faults;
let db: PrismaClient;
let BV: string;
let CORPORATE: string;
/** Every secret value seen in this run: none may appear in logs or audit metadata (NT-L1/L2). */
const secrets = new Set<string>([
  TEST_KEYS.admin,
  TEST_KEYS.adminNext,
  TEST_KEYS.webBv,
  TEST_KEYS.mfa,
  TEST_KEYS.hmac,
]);

async function loadFactory(): Promise<Factory> {
  return (await import(pathToFileURL(path.join(API_DIR, "dist/app.factory.js")).href)) as Factory;
}

async function start(
  extraEnv: Record<string, string | undefined> = {},
): Promise<{ app: App; base: string }> {
  const env: Record<string, string | undefined> = {
    ...apiTestEnv(),
    DP_DEPLOY_ENV: undefined,
    DP_PROXY_KEY_ADMIN_NEXT: undefined,
    DATABASE_URL: urls.app,
    DB_ENV: "test",
    DB_EXPECTED_NAME: DB_NAME,
    ...extraEnv,
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const a = await factory.createApiApp({ logger: captureLogger });
  await a.listen(0, "127.0.0.1");
  const { port } = a.getHttpServer().address() as { port: number };
  return { app: a, base: `http://127.0.0.1:${port}` };
}

function cli(
  args: string[],
  env: Record<string, string>,
): { status: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    env: { PATH: process.env["PATH"] ?? "", DP_ADMIN_BASE_URL: ADMIN_ORIGIN, ...env },
    encoding: "utf8",
  });
  logLines.push(r.stdout.replace(/#t=[A-Za-z0-9_-]{43}/g, "#t=<link>"), r.stderr);
  return { status: r.status, out: r.stdout, err: r.stderr };
}
const linkFrom = (out: string) => {
  const m = /(http:\/\/\S+#t=([A-Za-z0-9_-]{43}))/.exec(out);
  if (!m) throw new Error("no link in the CLI output");
  secrets.add(m[2] as string);
  return m[1] as string;
};
const tokenOf = (link: string) => link.split("#t=")[1] as string;

interface Res {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Headers;
}

let browserSeq = 0;
/** Each browser gets its own address unless a test names one: the per-IP bucket stays local. */
const nextIp = () => {
  browserSeq++;
  // A /24 of its own: buckets and Session.ipPrefix use the prefix, not the address.
  return `10.${(browserSeq >> 8) & 255}.${browserSeq & 255}.7`;
};

class Browser {
  readonly jar = new Map<string, string>();
  constructor(
    public key: string = TEST_KEYS.admin,
    public ip = nextIp(),
    public origin: string | null = ADMIN_ORIGIN,
  ) {}

  async call(
    method: string,
    p: string,
    body?: unknown,
    opts: { headers?: Record<string, string>; base?: string; raw?: string } = {},
  ): Promise<Res> {
    const headers: Record<string, string> = {
      "x-dp-proxy-key": this.key,
      "x-dp-client-ip": this.ip,
      "user-agent": "vitest-browser",
    };
    if (method !== "GET" && this.origin) headers["origin"] = this.origin;
    if (method === "POST") headers["content-type"] = "application/json";
    if (this.jar.size) headers["cookie"] = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    Object.assign(headers, opts.headers);
    const res = await fetch(`${opts.base ?? base}${p}`, {
      method,
      headers,
      body: opts.raw ?? (method === "POST" ? JSON.stringify(body ?? {}) : undefined),
    });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(";")[0] as string;
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (/Max-Age=0/i.test(c) || value === "") this.jar.delete(name);
      else {
        this.jar.set(name, value);
        secrets.add(value);
      }
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
  }
  post(p: string, body?: unknown, opts?: Parameters<Browser["call"]>[3]) {
    return this.call("POST", `/api/v1${p}`, body, opts);
  }
  get(p: string) {
    return this.call("GET", `/api/v1${p}`);
  }
  get session() {
    return this.jar.get("__Host-dp_admin_session");
  }
}

interface Staff {
  id: string;
  email: string;
  password: string;
  secret: Buffer;
  recovery: string[];
  lastStep?: bigint;
}

/**
 * A TOTP code for a step after the user's last accepted one (the API refuses replays). The API
 * accepts the next step as clock skew, so this moves the test clock only when that is used up.
 */
function codeFor(s: Pick<Staff, "secret" | "lastStep">, mark = true): string {
  let step = totpStep(clock.now());
  while (s.lastStep !== undefined && step <= s.lastStep) {
    if (step === s.lastStep) {
      step += 1n;
      break;
    }
    clock.advance(30_000);
    step = totpStep(clock.now());
  }
  if (mark) s.lastStep = step;
  return hotp(s.secret, step);
}

const expectError = (r: Res, status: number, code: string) => {
  expect({ status: r.status, code: r.body?.error?.code }).toEqual({ status, code });
  expect(ErrorBodySchema.safeParse(r.body).success).toBe(true);
};

async function enrol(
  link: string,
  password: string,
  step: "password" | "current_password" = "password",
) {
  const token = tokenOf(link);
  const b = new Browser();
  const pw = step === "password" ? { token, password } : { token, currentPassword: password };
  expect((await b.post("/auth/staff/enrol/password", pw)).status).toBe(204);
  const setup = await b.post("/auth/staff/enrol/mfa/setup", { token });
  expect(setup.status).toBe(200);
  expect(EnrolMfaSetupResponseSchema.parse(setup.body)).toBeTruthy();
  secrets.add(setup.body.secret);
  const s = { secret: base32Decode(setup.body.secret) } as Staff;
  const confirm = await b.post("/auth/staff/enrol/mfa/confirm", { token, code: codeFor(s) });
  expect(confirm.status).toBe(200);
  const codes = EnrolMfaConfirmResponseSchema.parse(confirm.body).recoveryCodes;
  for (const c of codes) secrets.add(c);
  return { secret: s.secret, recovery: codes, lastStep: s.lastStep };
}

async function signIn(s: Staff, b = new Browser()): Promise<Browser> {
  const r1 = await b.post("/auth/staff/login", { email: s.email, password: s.password });
  expect(r1.status, JSON.stringify(r1.body)).toBe(200);
  const r2 = await b.post("/auth/staff/login/mfa", { code: codeFor(s) });
  expect(r2.status, JSON.stringify(r2.body)).toBe(204);
  return b;
}

let seq = 0;
const email = (label: string) => `${label}.${++seq}@staff.dp.test`;

let admin: Staff;

/** Invites (admin, fresh login) and enrols a staff user over HTTP. */
async function newStaff(
  label: string,
  opts: { siteId?: string; roleKey?: string; by?: Staff } = {},
): Promise<Staff> {
  const by = await signIn(opts.by ?? admin);
  const e = email(label);
  const inv = await by.post("/admin/users/invite", {
    email: e,
    displayName: `${label} Person`,
    siteId: opts.siteId ?? BV,
    ...(opts.roleKey ? { roleKey: opts.roleKey } : {}),
  });
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  const { userId, enrolmentLink } = InviteUserResponseSchema.parse(inv.body);
  secrets.add(tokenOf(enrolmentLink));
  const enrolled = await enrol(enrolmentLink, PASSWORD.staff);
  return { id: userId, email: e, password: PASSWORD.staff, ...enrolled };
}

beforeAll(async () => {
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: urls.app }) });
  factory = await loadFactory();
});

afterAll(async () => {
  await app?.close();
  await db?.$disconnect();
  for (const k of Object.keys(process.env)) if (!(k in ENV_BACKUP)) delete process.env[k];
  Object.assign(process.env, ENV_BACKUP);
});

// ------------------------------------------------------------------------------------------
// 1. The owner's end-to-end scenario (AC-AU-1, AC-AU-2, AC-AU-3, AC-DA-1)
// ------------------------------------------------------------------------------------------

describe("end to end on an empty database: bootstrap -> activation -> login -> MFA -> step-up -> second admin -> deactivate", () => {
  const ADMIN_EMAIL = "first.admin@staff.dp.test";
  let enrolLink: string;
  let second: Staff;

  it("starts from an empty database and applies the migrations as dp_migrator", async () => {
    const migrator = new PrismaClient({
      adapter: new PrismaPg({ connectionString: urls.migrate }),
    });
    try {
      const rows = await migrator.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM pg_tables WHERE schemaname = 'public'`;
      expect(Number(rows[0]?.n)).toBe(0);
    } finally {
      await migrator.$disconnect();
    }
    execFileSync(PRISMA, ["migrate", "deploy"], {
      cwd: API_DIR,
      env: { PATH: process.env["PATH"] ?? "", MIGRATE_DATABASE_URL: urls.migrate },
      stdio: "pipe",
    });
    expect(await db.user.count()).toBe(0);
  });

  it("refuses to bootstrap before the catalogue sync, then syncs it (CLI, dp_migrator)", () => {
    const early = cli(["bootstrap", "--email", ADMIN_EMAIL, "--confirm-database", DB_NAME], {
      IAM_BOOTSTRAP_DATABASE_URL: urls.boot,
    });
    expect(early.status).toBe(1);
    expect(early.err).toMatch(/run iam:sync first/);
    const sync = cli(["sync", "--confirm-database", DB_NAME], {
      MIGRATE_DATABASE_URL: urls.migrate,
    });
    expect(sync.status, sync.err).toBe(0);
  });

  it("bootstraps the first administrator as dp_iam_bootstrap; the CLI refuses another identity", async () => {
    const wrong = cli(["bootstrap", "--email", ADMIN_EMAIL, "--confirm-database", DB_NAME], {
      IAM_BOOTSTRAP_DATABASE_URL: urls.app,
    });
    expect(wrong.status).toBe(1);
    expect(wrong.err).toMatch(/must run as dp_iam_bootstrap/);
    const ok = cli(
      ["bootstrap", "--email", ADMIN_EMAIL, "--name", "First Admin", "--confirm-database", DB_NAME],
      {
        IAM_BOOTSTRAP_DATABASE_URL: urls.boot,
      },
    );
    expect(ok.status, ok.err).toBe(0);
    const user = await db.user.findUniqueOrThrow({ where: { emailNormalized: ADMIN_EMAIL } });
    expect(user).toMatchObject({ status: "PENDING", passwordHash: null, mfaEnrolledAt: null });
    const sites = await db.site.findMany();
    BV = sites.find((s) => s.key === "BV")!.id;
    CORPORATE = sites.find((s) => s.key === "CORPORATE")!.id;
  });

  it("issues the activation link with the CLI as dp_app, and only for the bootstrap administrator", () => {
    const wrong = cli(["enrol-link", "--email", ADMIN_EMAIL, "--confirm-database", "other_test"], {
      DATABASE_URL: urls.app,
    });
    expect(wrong.status).toBe(1);
    expect(wrong.err).toMatch(/--confirm-database/);
    const asBoot = cli(["enrol-link", "--email", ADMIN_EMAIL, "--confirm-database", DB_NAME], {
      DATABASE_URL: urls.boot,
    });
    expect(asBoot.err).toMatch(/must run as dp_app/);
    const r = cli(["enrol-link", "--email", ADMIN_EMAIL, "--confirm-database", DB_NAME], {
      DATABASE_URL: urls.app,
    });
    expect(r.status, r.err).toBe(0);
    enrolLink = linkFrom(r.out);
    expect(enrolLink.startsWith(`${ADMIN_ORIGIN}/enrol#t=`)).toBe(true);
  });

  it("starts the API with the proxy key and IAM secrets, without the bootstrap credential", async () => {
    ({ app, base } = await start({
      IAM_BOOTSTRAP_DATABASE_URL: undefined,
      MIGRATE_DATABASE_URL: undefined,
    }));
    clock = app.get<TestClock>(factory.Clock);
    faults = app.get<Faults>(factory.FaultInjector);
    const health = await fetch(`${base}/health/ready`);
    expect(health.status).toBe(200);
  });

  it("activation: inspect, password policy, password, TOTP setup, wrong code, confirm (no half activation)", async () => {
    const token = tokenOf(enrolLink);
    const b = new Browser();
    const inspect = await b.post("/auth/staff/enrol/inspect", { token });
    expect(inspect.status).toBe(200);
    expect(EnrolInspectResponseSchema.parse(inspect.body)).toEqual({
      kind: "activation",
      emailMasked: "f***@staff.dp.test",
      expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      steps: [
        { step: "password", done: false },
        { step: "mfa", done: false },
      ],
    });
    // MFA before the password step: refused.
    expectError(await b.post("/auth/staff/enrol/mfa/setup", { token }), 409, "CONFLICT_STATE");
    // NT-W1, NT-W2: policy, reported by rule, never echoing the value.
    const short = await b.post("/auth/staff/enrol/password", { token, password: "Elevenchars" });
    expectError(short, 422, "AUTH_PASSWORD_POLICY");
    expect(short.body.error.details).toEqual(["too_short"]);
    const breached = await b.post("/auth/staff/enrol/password", {
      token,
      password: "password1234",
    });
    expect(breached.body.error.details).toContain("breached");
    const identity = await b.post("/auth/staff/enrol/password", {
      token,
      password: "first.admin-is-me-2026",
    });
    expect(identity.body.error.details).toContain("contains_identity");
    // Folded comparison: case, accents, dotted capital I and separators do not hide the identity
    // ("First Admin" / first.admin@: first, firstadmin).
    for (const variant of ["FİRST-mavi-dalga-77", "Fïrst_Ádmin#2026", "f.i.r.s.t-ocean-2026"]) {
      const folded = await b.post("/auth/staff/enrol/password", { token, password: variant });
      expectError(folded, 422, "AUTH_PASSWORD_POLICY");
      expect(folded.body.error.details).toEqual(["contains_identity"]);
    }
    expect(
      (await b.post("/auth/staff/enrol/password", { token, password: PASSWORD.admin })).status,
    ).toBe(204);
    secrets.add(PASSWORD.admin);
    // Half way: the account is still PENDING and cannot sign in.
    const pending = await db.user.findUniqueOrThrow({ where: { emailNormalized: ADMIN_EMAIL } });
    expect(pending.status).toBe("PENDING");
    expectError(
      await new Browser().post("/auth/staff/login", {
        email: ADMIN_EMAIL,
        password: PASSWORD.admin,
      }),
      401,
      "AUTH_INVALID_CREDENTIALS",
    );
    const setup = await b.post("/auth/staff/enrol/mfa/setup", { token });
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/Dream%20Petroleum%3Afirst\.admin/);
    secrets.add(setup.body.secret);
    const secret = base32Decode(setup.body.secret);
    expectError(
      await b.post("/auth/staff/enrol/mfa/confirm", { token, code: "000000" }),
      401,
      "AUTH_MFA_INVALID",
    );
    const s = { secret } as Staff;
    const confirm = await b.post("/auth/staff/enrol/mfa/confirm", { token, code: codeFor(s) });
    expect(confirm.status).toBe(200);
    const recovery = EnrolMfaConfirmResponseSchema.parse(confirm.body).recoveryCodes;
    recovery.forEach((c) => secrets.add(c));
    // No session from enrolment.
    expect(b.session).toBeUndefined();
    const user = await db.user.findUniqueOrThrow({ where: { emailNormalized: ADMIN_EMAIL } });
    expect(user.status).toBe("ACTIVE");
    expect(user.mfaEnrolledAt).not.toBeNull();
    expect(user.emailVerifiedAt).not.toBeNull();
    admin = {
      id: user.id,
      email: ADMIN_EMAIL,
      password: PASSWORD.admin,
      secret,
      recovery,
      lastStep: s.lastStep!,
    };
    // NT-K1: the consumed token is dead for every step.
    expectError(await b.post("/auth/staff/enrol/inspect", { token }), 400, "AUTH_TOKEN_INVALID");
    // The database writes its own trail of the activation (K-NG3).
    const dbAudit = await db.auditEvent.findMany({
      where: { action: "db.user_security_changed", resourceId: user.id },
    });
    expect(dbAudit.length).toBeGreaterThan(0);
  });

  it("login needs the second factor; the session id is new; MFA counts as step-up for 10 minutes", async () => {
    const b = new Browser();
    b.jar.set("__Host-dp_admin_session", "A".repeat(43)); // a planted value (fixation attempt)
    const r1 = await b.post("/auth/staff/login", { email: admin.email, password: admin.password });
    expect(r1.status).toBe(200);
    expect(StaffLoginResponseSchema.parse(r1.body)).toEqual({ next: "mfa" });
    expect(b.jar.get("__Host-dp_admin_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Without the second factor there is no session (AC-AU-2).
    expectError(await b.get("/auth/staff/session"), 401, "AUTH_SESSION_REQUIRED");
    const r2 = await b.post("/auth/staff/login/mfa", { code: codeFor(admin) });
    expect(r2.status).toBe(204);
    expect(b.session).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b.session).not.toBe("A".repeat(43));
    expect(b.jar.has("__Host-dp_admin_challenge")).toBe(false);
    const s = await b.get("/auth/staff/session");
    expect(s.status).toBe(200);
    const parsed = StaffSessionResponseSchema.parse(s.body);
    expect(parsed.user.email).toBe(admin.email);
    expect(parsed.stepUpValidUntil).not.toBeNull();
  });

  it("step-up: after 10 minutes a sensitive action needs it; the step-up rotates the session (AC-AU-3)", async () => {
    const b = await signIn(admin);
    clock.advance(10 * 60_000 + 1_000);
    const denied = await b.post("/admin/users/invite", {
      email: email("x"),
      displayName: "X",
      siteId: BV,
    });
    expectError(denied, 403, "AUTH_STEP_UP_REQUIRED");
    const before = b.session;
    expect((await b.post("/auth/staff/step-up", { code: codeFor(admin) })).status).toBe(204);
    expect(b.session).not.toBe(before);
    // NT-S2: the pre-step-up cookie is dead.
    const old = new Browser();
    old.jar.set("__Host-dp_admin_session", before!);
    expectError(await old.get("/auth/staff/session"), 401, "AUTH_SESSION_REQUIRED");
    expect((await b.get("/auth/staff/session")).body.stepUpValidUntil).not.toBeNull();
  });

  it("invites a second platform administrator, who activates and signs in", async () => {
    const b = await signIn(admin);
    const e = "second.admin@staff.dp.test";
    const inv = await b.post("/admin/users/invite", {
      email: e,
      displayName: "Second Admin",
      siteId: BV,
      roleKey: "platform_super_admin",
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const { userId, enrolmentLink } = InviteUserResponseSchema.parse(inv.body);
    secrets.add(tokenOf(enrolmentLink));
    const enrolled = await enrol(enrolmentLink, PASSWORD.second);
    second = { id: userId, email: e, password: PASSWORD.second, ...enrolled };
    secrets.add(PASSWORD.second);
    const sb = await signIn(second);
    expect((await sb.get("/auth/staff/session")).status).toBe(200);
    const assignment = await db.roleAssignment.findFirstOrThrow({ where: { userId } });
    expect(assignment.grantedById).toBe(admin.id);
  });

  it("the second administrator cannot act on the one who granted their role (ancestry)", async () => {
    const sb = await signIn(second);
    const r = await sb.post(`/admin/users/${admin.id}/deactivate`, {
      reason: "trying to remove my grantor",
      confirmEmail: admin.email,
    });
    expectError(r, 403, "FORBIDDEN");
  });

  it("deactivates the second administrator safely: confirm e-mail, terminal state, sessions end", async () => {
    const sb = await signIn(second);
    const ab = await signIn(admin);
    const wrong = await ab.post(`/admin/users/${second.id}/deactivate`, {
      reason: "left the company, end of contract",
      confirmEmail: "someone.else@staff.dp.test",
    });
    expectError(wrong, 422, "CONFIRMATION_MISMATCH");
    expect((await db.user.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("ACTIVE");
    const ok = await ab.post(`/admin/users/${second.id}/deactivate`, {
      reason: "left the company, end of contract",
      confirmEmail: second.email,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(204);
    expectError(await sb.get("/auth/staff/session"), 401, "AUTH_SESSION_REQUIRED");
    const user = await db.user.findUniqueOrThrow({ where: { id: second.id } });
    expect(user.status).toBe("DEACTIVATED");
    expect(await db.roleAssignment.count({ where: { userId: second.id, revokedAt: null } })).toBe(
      0,
    );
    expect(
      await db.membership.count({ where: { userId: second.id, status: { not: "REVOKED" } } }),
    ).toBe(0);
    // NT-D6: a deactivated account gets the generic login failure.
    expectError(
      await new Browser().post("/auth/staff/login", {
        email: second.email,
        password: second.password,
      }),
      401,
      "AUTH_INVALID_CREDENTIALS",
    );
    // NT-D5: terminal.
    const again = await ab.post(`/admin/users/${second.id}/deactivate`, {
      reason: "second attempt on the same user",
      confirmEmail: second.email,
    });
    expectError(again, 409, "CONFLICT_STATE");
    const back = await ab.post(`/admin/users/${second.id}/reactivate`, {
      reason: "bring them back again",
    });
    expectError(back, 409, "CONFLICT_STATE");
  });

  it("the last administrator cannot deactivate themselves or be left without a peer", async () => {
    const ab = await signIn(admin);
    const self = await ab.post(`/admin/users/${admin.id}/deactivate`, {
      reason: "removing myself as the last one",
      confirmEmail: admin.email,
    });
    expectError(self, 403, "FORBIDDEN");
  });
});

// ------------------------------------------------------------------------------------------
// 2. Proxy trust boundary (AC-PX-1, -2, -3, -4, -5, -7; NT-P1, P2, P7, P8, P9, P10, P12; NT-L4)
// ------------------------------------------------------------------------------------------

describe("proxy trust boundary", () => {
  it("AC-PX-1 / NT-P1: no or unknown key -> 404 on /api/v1; /health without a key -> 200", async () => {
    const metrics = app.get<Metrics>(factory.ProxyKeyMetrics);
    const before = metrics.rejected;
    const none = await fetch(`${base}/api/v1/auth/staff/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ADMIN_ORIGIN },
      body: "{}",
    });
    expect(none.status).toBe(404);
    expectError(await new Browser("x".repeat(43)).post("/auth/staff/login", {}), 404, "NOT_FOUND");
    expect(metrics.rejected).toBe(before + 2);
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/health/ready`)).status).toBe(200);
    // NT-P12: the metrics count slots, never values.
    const m = await (await fetch(`${base}/health/metrics`)).text();
    expect(m).toContain('"rejected"');
    for (const s of [TEST_KEYS.admin, TEST_KEYS.webBv, "x".repeat(43)]) expect(m).not.toContain(s);
    // Other paths are not served at all.
    expect((await new Browser().call("GET", "/api/v2/anything")).status).toBe(404);
    expect((await new Browser().call("GET", "/")).status).toBe(404);
  });

  it("DP-014 clickjacking: every response refuses to be framed (health, 404, 401, 403, 200)", async () => {
    const frameHeaders = (h: Headers) => ({
      csp: h.get("content-security-policy"),
      xfo: h.get("x-frame-options"),
    });
    const expected = { csp: "default-src 'none'; frame-ancestors 'none'", xfo: "DENY" };
    const responses: Headers[] = [
      (await fetch(`${base}/health`)).headers,
      (await fetch(`${base}/health/ready`)).headers,
      (await fetch(`${base}/api/v1/auth/staff/session`)).headers, // no key: 404
      (await new Browser().call("GET", "/api/v1/auth/staff/session")).headers, // no session: 401
      // CSRF refusal (foreign Origin): 403
      (
        await new Browser(TEST_KEYS.admin, "203.0.113.10", "https://evil.example").post(
          "/auth/staff/login",
          {},
        )
      ).headers,
    ];
    for (const h of responses) expect(frameHeaders(h)).toEqual(expected);
  });

  it("AC-PX-2 / NT-P2: the app comes from the key; site keys cannot reach staff or admin routes", async () => {
    for (const key of [TEST_KEYS.webBv, TEST_KEYS.webCorporate]) {
      const site = new Browser(key, "203.0.113.10", "https://dreampetroleumbv.com");
      expectError(
        await site.post("/auth/staff/login", { email: admin.email, password: admin.password }),
        404,
        "NOT_FOUND",
      );
      expectError(
        await site.post(`/admin/users/${admin.id}/unlock`, { reason: "site key on admin" }),
        404,
        "NOT_FOUND",
      );
      // An "app" header changes nothing.
      expectError(
        await site.post("/auth/staff/login", {}, { headers: { "x-dp-app": "ADMIN" } }),
        404,
        "NOT_FOUND",
      );
    }
    // The admin key does not open member routes.
    expectError(await new Browser().post("/auth/member/login", {}), 404, "NOT_FOUND");
  });

  it("NT-P8: a valid admin key with a site Origin is a CSRF rejection", async () => {
    const b = new Browser(TEST_KEYS.admin, "203.0.113.10", "https://dreampetroleumbv.com");
    expectError(
      await b.post("/auth/staff/login", { email: admin.email, password: admin.password }),
      403,
      "AUTH_CSRF_REJECTED",
    );
  });

  it("NT-C1..3: foreign origin, cross-site without origin, non-JSON bodies -> 403", async () => {
    expectError(
      await new Browser(TEST_KEYS.admin, "203.0.113.10", "https://evil.example").post(
        "/auth/staff/login",
        {},
      ),
      403,
      "AUTH_CSRF_REJECTED",
    );
    const noOrigin = new Browser(TEST_KEYS.admin, "203.0.113.10", null);
    expectError(
      await noOrigin.post("/auth/staff/login", {}, { headers: { "sec-fetch-site": "cross-site" } }),
      403,
      "AUTH_CSRF_REJECTED",
    );
    expect(
      (
        await noOrigin.post(
          "/auth/staff/login",
          { email: "a@b.cd", password: "x" },
          { headers: { "sec-fetch-site": "same-origin" } },
        )
      ).status,
    ).not.toBe(403);
    for (const type of ["text/plain", "application/x-www-form-urlencoded"]) {
      expectError(
        await new Browser().post("/auth/staff/login", undefined, {
          headers: { "content-type": type },
          raw: "email=a",
        }),
        403,
        "AUTH_CSRF_REJECTED",
      );
    }
  });

  it("body limits: > 16 KB -> 413; invalid JSON -> 400; unknown keys -> 400 without echo", async () => {
    const big = JSON.stringify({ email: "a@b.cd", password: "x".repeat(17 * 1024) });
    expectError(
      await new Browser().post("/auth/staff/login", undefined, { raw: big }),
      413,
      "PAYLOAD_TOO_LARGE",
    );
    expectError(
      await new Browser().post("/auth/staff/login", undefined, { raw: "{not json" }),
      400,
      "VALIDATION_FAILED",
    );
    const extra = await new Browser().post("/auth/staff/login", {
      email: "a@b.cd",
      password: "p",
      sneaky: "VALUE-123",
    });
    expectError(extra, 400, "VALIDATION_FAILED");
    expect(JSON.stringify(extra.body)).not.toContain("VALUE-123");
  });

  it("NT-K4: no query string on state-changing requests (tokens never in a URL)", async () => {
    const r = await new Browser().post(`/auth/staff/enrol/inspect?token=${"a".repeat(43)}`, {});
    expectError(r, 400, "VALIDATION_FAILED");
  });

  it("NT-P7 / AC-PX-5: forwarding headers and Host are ignored; the IP comes only from X-DP-Client-IP", async () => {
    const b = new Browser(TEST_KEYS.admin, "198.51.100.23");
    await b.post(
      "/auth/staff/login",
      { email: admin.email, password: admin.password },
      {
        headers: {
          "x-forwarded-for": "192.0.2.99",
          forwarded: "for=192.0.2.98;host=evil.example",
          "x-real-ip": "192.0.2.97",
        },
      },
    );
    await b.post("/auth/staff/login/mfa", { code: codeFor(admin) });
    const sessions = StaffSessionListResponseSchema.parse(
      (await b.get("/auth/staff/sessions")).body,
    );
    expect(sessions.items.find((s) => s.current)?.ipPrefix).toBe("198.51.100.0/24");
    // The throttle buckets follow X-DP-Client-IP too: failures behind a spoofed XFF still count
    // on the real (proxy-reported) address.
    const victim = email("ip");
    const tk = throttleKeys(Buffer.from(TEST_KEYS.hmac, "base64url"), victim, "198.51.100.0/24");
    await b.post(
      "/auth/staff/login",
      { email: victim, password: "wrong-password-1" },
      { headers: { "x-forwarded-for": "10.9.9.9" } },
    );
    expect(await db.authThrottle.count({ where: { key: { in: [tk.accountIp, tk.ip] } } })).toBe(2);
  });

  it("AC-PX-3 / NT-P9 / NT-L4: the API does not start with weak, shared or missing secrets", async () => {
    const bad: Record<string, string | undefined>[] = [
      { DP_PROXY_KEY_WEB_BV: TEST_KEYS.admin },
      { DP_PROXY_KEY_ADMIN: "short" },
      { DP_PROXY_KEY_ADMIN_NEXT: TEST_KEYS.admin },
      { IAM_HMAC_KEY: undefined },
      { IAM_MFA_ENC_KEYS: "1:tooshort" },
      { DP_DEPLOY_ENV: "production" },
    ];
    for (const env of bad) {
      await expect(start(env)).rejects.toThrow();
    }
  });

  it("AC-PX-4 / NT-P10: rotation accepts current and next; after promotion the old key is 404", async () => {
    const withNext = await start({ DP_PROXY_KEY_ADMIN_NEXT: TEST_KEYS.adminNext });
    try {
      for (const key of [TEST_KEYS.admin, TEST_KEYS.adminNext]) {
        const r = await new Browser(key).post(
          "/auth/staff/enrol/inspect",
          { token: "a".repeat(43) },
          { base: withNext.base },
        );
        expectError(r, 400, "AUTH_TOKEN_INVALID");
      }
      const m = withNext.app.get<Metrics>(factory.ProxyKeyMetrics);
      expect(m.accepted["ADMIN"]).toEqual({ current: 1, next: 1 });
    } finally {
      await withNext.app.close();
    }
    const promoted = await start({
      DP_PROXY_KEY_ADMIN: TEST_KEYS.adminNext,
      DP_PROXY_KEY_ADMIN_NEXT: undefined,
    });
    try {
      expectError(
        await new Browser(TEST_KEYS.admin).post(
          "/auth/staff/enrol/inspect",
          { token: "a".repeat(43) },
          { base: promoted.base },
        ),
        404,
        "NOT_FOUND",
      );
      expectError(
        await new Browser(TEST_KEYS.adminNext).post(
          "/auth/staff/enrol/inspect",
          { token: "a".repeat(43) },
          { base: promoted.base },
        ),
        400,
        "AUTH_TOKEN_INVALID",
      );
    } finally {
      await promoted.app.close();
    }
  });
});

// The CLI issues its links with the real time while the API runs on the test clock, so the
// blocks that redeem CLI links (2a, 2b) run before the blocks that move the clock far ahead.

// ------------------------------------------------------------------------------------------
// 2a. Operator recovery (design 4.4 last resort) and cleanup
// ------------------------------------------------------------------------------------------

describe("operator CLI: recover-admin and cleanup", () => {
  it("recover-admin is refused while another qualified administrator exists", async () => {
    const peer = await newStaff("recpeer", { roleKey: "platform_super_admin" });
    const r = cli(
      [
        "recover-admin",
        "--email",
        admin.email,
        "--reason",
        "lost phone and password",
        "--confirm-database",
        DB_NAME,
      ],
      { DATABASE_URL: urls.app },
    );
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/use mfa-reset/);
    const b = await signIn(admin);
    expect(
      (
        await b.post(`/admin/users/${peer.id}/deactivate`, {
          reason: "back to a single admin",
          confirmEmail: peer.email,
        })
      ).status,
    ).toBe(204);
  });

  it("recover-admin clears password and MFA of the only administrator and gives a recovery link", async () => {
    const device = await signIn(admin);
    const r = cli(
      [
        "recover-admin",
        "--email",
        admin.email,
        "--reason",
        "lost phone and password",
        "--confirm-database",
        DB_NAME,
      ],
      { DATABASE_URL: urls.app },
    );
    expect(r.status, r.err).toBe(0);
    const link = linkFrom(r.out);
    expectError(await device.get("/auth/staff/session"), 401, "AUTH_SESSION_REQUIRED");
    const user = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(user).toMatchObject({ status: "PENDING", passwordHash: null, mfaEnrolledAt: null });
    const next = PW.harbour_glacier_mosaic_61;
    secrets.add(next);
    const enrolled = await enrol(link, next);
    Object.assign(admin, enrolled, { password: next });
    expect((await signIn(admin)).session).toBeDefined();
    expect(
      await db.auditEvent.count({
        where: { action: "iam.admin_recovery_issued", outcome: "SUCCESS" },
      }),
    ).toBe(1);
  });

  it("cleanup runs as dp_app", () => {
    const r = cli(["cleanup", "--confirm-database", DB_NAME], { DATABASE_URL: urls.app });
    expect(r.status, r.err).toBe(0);
    expect(JSON.parse(r.out)).toHaveProperty("sessions");
  });
});

// ------------------------------------------------------------------------------------------
// 2b. Password reset and tokens (NT-M5, NT-K1..K3)
// ------------------------------------------------------------------------------------------

describe("password reset with an operator link", () => {
  let user: Staff;
  beforeAll(async () => {
    user = await newStaff("reset");
  });

  const resetLinkFor = (e: string) => {
    const r = cli(["reset-link", "--email", e, "--confirm-database", DB_NAME], {
      DATABASE_URL: urls.app,
    });
    expect(r.status, r.err).toBe(0);
    return linkFrom(r.out);
  };

  it("NT-M5: needs a TOTP or recovery code; five failures kill the link (NT-K2)", async () => {
    const link = resetLinkFor(user.email);
    expect(link).toContain("/reset#t=");
    const token = tokenOf(link);
    const b = new Browser();
    const without = await b.post("/auth/staff/password/reset", {
      token,
      newPassword: PW.nightjar_copper_basin_90,
    });
    expectError(without, 401, "AUTH_MFA_INVALID");
    for (let i = 0; i < 4; i++) {
      expectError(
        await b.post("/auth/staff/password/reset", {
          token,
          newPassword: PW.nightjar_copper_basin_90,
          code: "111111",
        }),
        401,
        "AUTH_MFA_INVALID",
      );
    }
    expectError(
      await b.post("/auth/staff/password/reset", {
        token,
        newPassword: PW.nightjar_copper_basin_90,
        code: codeFor(user, false),
      }),
      400,
      "AUTH_TOKEN_INVALID",
    );
  });

  it("NT-K3: a new link invalidates the old one; a reset ends every session (AC-AU-4)", async () => {
    const first = tokenOf(resetLinkFor(user.email));
    const second = tokenOf(resetLinkFor(user.email));
    const device = await signIn(user);
    const next = PW.nightjar_copper_basin_90;
    secrets.add(next);
    expectError(
      await new Browser().post("/auth/staff/password/reset", {
        token: first,
        newPassword: next,
        code: codeFor(user, false),
      }),
      400,
      "AUTH_TOKEN_INVALID",
    );
    const ok = await new Browser().post("/auth/staff/password/reset", {
      token: second,
      newPassword: next,
      recoveryCode: user.recovery[0],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(204);
    user.password = next;
    expectError(await device.get("/auth/staff/session"), 401, "AUTH_SESSION_REQUIRED");
    expect((await signIn(user)).session).toBeDefined();
    // NT-K1: consumed.
    expectError(
      await new Browser().post("/auth/staff/password/reset", {
        token: second,
        newPassword: next,
        code: codeFor(user, false),
      }),
      400,
      "AUTH_TOKEN_INVALID",
    );
  });

  it("NT-K1: an expired link is refused", async () => {
    const token = tokenOf(resetLinkFor(user.email));
    clock.advance(31 * 60_000);
    expectError(
      await new Browser().post("/auth/staff/password/reset", {
        token,
        newPassword: PW.whatever_long_enough_1,
        code: codeFor(user, false),
      }),
      400,
      "AUTH_TOKEN_INVALID",
    );
  });

  it("the CLI refuses reset links for accounts that are not ACTIVE staff", () => {
    const r = cli(
      ["reset-link", "--email", "second.admin@staff.dp.test", "--confirm-database", DB_NAME],
      { DATABASE_URL: urls.app },
    );
    expect(r.status).toBe(1);
    expect(r.out).not.toMatch(/#t=/);
  });
});

// ------------------------------------------------------------------------------------------
// 3. Login, throttle and enumeration (NT-E1, NT-E2, NT-T1..T5)
// ------------------------------------------------------------------------------------------

describe("login failures look the same and slow down", () => {
  it("NT-E1: unknown, wrong password, PENDING, SUSPENDED, DEACTIVATED and customer -> identical 401", async () => {
    const pending = email("pending");
    const ab = await signIn(admin);
    const inv = await ab.post("/admin/users/invite", {
      email: pending,
      displayName: "Pending One",
      siteId: BV,
    });
    secrets.add(tokenOf(inv.body.enrolmentLink));
    await new Browser().post("/auth/staff/enrol/password", {
      token: tokenOf(inv.body.enrolmentLink),
      password: PASSWORD.staff,
    });
    const suspended = await newStaff("suspended");
    expect(
      (
        await (
          await signIn(admin)
        ).post(`/admin/users/${suspended.id}/suspend`, {
          reason: "suspended for the enumeration test",
        })
      ).status,
    ).toBe(204);
    const custEmail = email("customer");
    // Customers have no admin path; their row is created directly (DP-039 is not built yet).
    await db.user.create({
      data: {
        email: custEmail,
        emailNormalized: custEmail,
        kind: "CUSTOMER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
    const cases = [
      { email: email("nobody"), password: PASSWORD.staff },
      { email: admin.email, password: PW.not_the_password_1 },
      { email: pending, password: PASSWORD.staff },
      { email: suspended.email, password: suspended.password },
      { email: "second.admin@staff.dp.test", password: PASSWORD.second },
      { email: custEmail, password: PASSWORD.staff },
    ];
    const shapes = [];
    for (const [i, c] of cases.entries()) {
      const r = await new Browser(TEST_KEYS.admin, `203.0.113.${100 + i}`).post(
        "/auth/staff/login",
        c,
      );
      const headers = [...r.headers.keys()]
        .filter((h) => !["date", "content-length"].includes(h))
        .sort();
      shapes.push({
        status: r.status,
        code: r.body.error.code,
        message: r.body.error.message,
        details: r.body.error.details,
        headers,
      });
    }
    for (const s of shapes) expect(s).toEqual(shapes[0]);
    expect(shapes[0]?.status).toBe(401);
  });

  it("NT-T1 / NT-T2: from the 4th failure per account+IP the next attempt is 429, for existing and unknown accounts alike", async () => {
    await db.authThrottle.deleteMany({});
    for (const target of [admin.email, email("ghost")]) {
      const b = new Browser(TEST_KEYS.admin, "192.0.2.50");
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        statuses.push(
          (await b.post("/auth/staff/login", { email: target, password: `wrong-${i}-password` }))
            .status,
        );
      }
      expect(statuses).toEqual([401, 401, 401, 401, 429]);
      const throttled = await b.post("/auth/staff/login", {
        email: target,
        password: `wrong-x-password`,
      });
      expectError(throttled, 429, "RATE_LIMITED");
      expect(Number(throttled.headers.get("retry-after"))).toBeGreaterThan(0);
      clock.advance(3_000);
    }
    await db.authThrottle.deleteMany({});
  });

  it("NT-T1: an early request is not evaluated and not counted", async () => {
    const b = new Browser(TEST_KEYS.admin, "192.0.2.51");
    for (let i = 0; i < 4; i++)
      await b.post("/auth/staff/login", { email: admin.email, password: `wrong-${i}-pw` });
    const keys = throttleKeys(
      Buffer.from(TEST_KEYS.hmac, "base64url"),
      admin.email,
      "192.0.2.0/24",
    );
    const before = await db.authThrottle.findUniqueOrThrow({ where: { key: keys.accountIp } });
    // Even the correct password gets 429 before notBefore: no evaluation at all.
    expectError(
      await b.post("/auth/staff/login", { email: admin.email, password: admin.password }),
      429,
      "RATE_LIMITED",
    );
    const after = await db.authThrottle.findUniqueOrThrow({ where: { key: keys.accountIp } });
    expect(after.failures).toBe(before.failures);
    await db.authThrottle.deleteMany({});
  });

  it("NT-T3: the 31st failure from one IP (different accounts) blocks the IP for 10 minutes", async () => {
    const b = new Browser(TEST_KEYS.admin, "192.0.2.77");
    for (let i = 0; i < 31; i++) {
      expect(
        (
          await b.post("/auth/staff/login", {
            email: email("spray"),
            password: PW.spray_password_1,
          })
        ).status,
      ).toBe(401);
    }
    const blocked = await b.post("/auth/staff/login", {
      email: email("spray"),
      password: PW.spray_password_1,
    });
    expectError(blocked, 429, "RATE_LIMITED");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(500);
    await db.authThrottle.deleteMany({});
  });

  it("NT-T4: after 1000 distributed failures the right password works within 60 s (no lasting lockout)", async () => {
    const store = new AuthThrottleService(db);
    const hmac = Buffer.from(TEST_KEYS.hmac, "base64url");
    const now = clock.now();
    for (let i = 0; i < 1000; i++) {
      await store.recordFailure(
        throttleKeys(hmac, admin.email, `10.${i >> 8}.${i & 255}.0/24`),
        SESSION_POLICIES.STAFF.throttle,
        now,
      );
    }
    const b = new Browser(TEST_KEYS.admin, "198.18.0.1");
    const early = await b.post("/auth/staff/login", {
      email: admin.email,
      password: admin.password,
    });
    expectError(early, 429, "RATE_LIMITED");
    const wait = Number(early.headers.get("retry-after"));
    expect(wait).toBeLessThanOrEqual(60);
    clock.advance(wait * 1000);
    expect(
      (await b.post("/auth/staff/login", { email: admin.email, password: admin.password })).status,
    ).toBe(200);
    expect((await b.post("/auth/staff/login/mfa", { code: codeFor(admin) })).status).toBe(204);
    await db.authThrottle.deleteMany({});
  });

  it("NT-T5: success resets the account buckets; unlock removes them; lockout columns stay untouched", async () => {
    const victim = await newStaff("unlock");
    const b = new Browser(TEST_KEYS.admin, "192.0.2.90");
    for (let i = 0; i < 4; i++)
      await b.post("/auth/staff/login", { email: victim.email, password: `wrong-${i}-pw` });
    const hmac = Buffer.from(TEST_KEYS.hmac, "base64url");
    const keys = throttleKeys(hmac, victim.email, "192.0.2.0/24");
    expect(
      await db.authThrottle.count({ where: { key: { in: [keys.account, keys.accountIp] } } }),
    ).toBe(2);
    const ab = await signIn(admin);
    expect(
      (
        await ab.post(`/admin/users/${victim.id}/unlock`, {
          reason: "user called the service desk",
        })
      ).status,
    ).toBe(204);
    expect(
      await db.authThrottle.count({ where: { key: { in: [keys.account, keys.accountIp] } } }),
    ).toBe(0);
    expect(
      (await b.post("/auth/staff/login", { email: victim.email, password: victim.password }))
        .status,
    ).toBe(200);
    const row = await db.user.findUniqueOrThrow({ where: { id: victim.id } });
    expect({ failedLoginCount: row.failedLoginCount, lockedUntil: row.lockedUntil }).toEqual({
      failedLoginCount: 0,
      lockedUntil: null,
    });
    await db.authThrottle.deleteMany({});
  });
});

// ------------------------------------------------------------------------------------------
// 4. MFA (NT-M1..M7)
// ------------------------------------------------------------------------------------------

describe("second factor", () => {
  let user: Staff;
  beforeAll(async () => {
    user = await newStaff("mfa");
  });

  it("NT-M1: no challenge, an expired one, or one from an older security version -> 401", async () => {
    const none = await new Browser().post("/auth/staff/login/mfa", { code: "123456" });
    expectError(none, 401, "AUTH_CHALLENGE_EXPIRED");
    // DP-119: a missing cookie (browser refused it) is told apart from an expired attempt.
    expect(none.body.error.details).toEqual([{ path: "cookie", rule: "missing" }]);
    const b = new Browser();
    await b.post("/auth/staff/login", { email: user.email, password: user.password });
    clock.advance(5 * 60_000 + 1_000);
    expectError(
      await b.post("/auth/staff/login/mfa", { code: codeFor(user, false) }),
      401,
      "AUTH_CHALLENGE_EXPIRED",
    );
    expect(b.jar.has("__Host-dp_admin_challenge")).toBe(false);
  });

  it("DP-119: an expired challenge that was presented carries no cookie detail", async () => {
    const b = new Browser();
    await b.post("/auth/staff/login", { email: user.email, password: user.password });
    clock.advance(5 * 60_000 + 1_000);
    const res = await b.post("/auth/staff/login/mfa", { code: codeFor(user, false) });
    expectError(res, 401, "AUTH_CHALLENGE_EXPIRED");
    expect(res.body.error.details).toEqual([]);
  });

  it("NT-M2: the same TOTP code is accepted once, also in parallel", async () => {
    const code = codeFor(user);
    const [a, b] = [new Browser(), new Browser()];
    await a.post("/auth/staff/login", { email: user.email, password: user.password });
    await b.post("/auth/staff/login", { email: user.email, password: user.password });
    // Only one challenge per user is live: the second login replaced the first.
    expectError(await a.post("/auth/staff/login/mfa", { code }), 401, "AUTH_CHALLENGE_EXPIRED");
    const c1 = new Browser();
    const c2 = new Browser();
    await c1.post("/auth/staff/login", { email: user.email, password: user.password });
    const challenge = c1.jar.get("__Host-dp_admin_challenge")!;
    c2.jar.set("__Host-dp_admin_challenge", challenge);
    const results = await Promise.all([
      c1.post("/auth/staff/login/mfa", { code }),
      c2.post("/auth/staff/login/mfa", { code }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 401]);
    // Sequential replay on a fresh challenge.
    const d = new Browser();
    await d.post("/auth/staff/login", { email: user.email, password: user.password });
    expectError(await d.post("/auth/staff/login/mfa", { code }), 401, "AUTH_MFA_INVALID");
  });

  it("NT-M3: five wrong codes kill the challenge; the sixth attempt is CHALLENGE_EXPIRED", async () => {
    const b = new Browser();
    await b.post("/auth/staff/login", { email: user.email, password: user.password });
    for (let i = 0; i < 5; i++) {
      expectError(
        await b.post("/auth/staff/login/mfa", { code: "000000" }),
        401,
        "AUTH_MFA_INVALID",
      );
    }
    expectError(
      await b.post("/auth/staff/login/mfa", { code: codeFor(user, false) }),
      401,
      "AUTH_CHALLENGE_EXPIRED",
    );
  });

  it("NT-M4: a recovery code works once; never for step-up", async () => {
    const code = user.recovery[0]!;
    const b = new Browser();
    await b.post("/auth/staff/login", { email: user.email, password: user.password });
    expect(
      (await b.post("/auth/staff/login/mfa", { recoveryCode: code.toLowerCase() })).status,
    ).toBe(204);
    // A recovery-code login does not count as a fresh MFA verification.
    expect((await b.get("/auth/staff/session")).body.stepUpValidUntil).toBeNull();
    expectError(
      await b.post("/auth/staff/step-up", { recoveryCode: user.recovery[1] }),
      401,
      "AUTH_MFA_INVALID",
    );
    const again = new Browser();
    await again.post("/auth/staff/login", { email: user.email, password: user.password });
    expectError(
      await again.post("/auth/staff/login/mfa", { recoveryCode: code }),
      401,
      "AUTH_MFA_INVALID",
    );
    expect(
      await db.auditEvent.count({
        where: { action: "iam.recovery_code_used", resourceId: user.id },
      }),
    ).toBe(1);
  });

  it("recovery codes are regenerated only with step-up, and the old set stops working", async () => {
    const b = await signIn(user);
    const r = await b.post("/auth/staff/mfa/recovery-codes");
    expect(r.status).toBe(200);
    const codes = RecoveryCodesResponseSchema.parse(r.body).codes;
    codes.forEach((c) => secrets.add(c));
    const old = new Browser();
    await old.post("/auth/staff/login", { email: user.email, password: user.password });
    expectError(
      await old.post("/auth/staff/login/mfa", { recoveryCode: user.recovery[2] }),
      401,
      "AUTH_MFA_INVALID",
    );
    user.recovery = codes;
    clock.advance(11 * 60_000);
    const stale = await signIn(user);
    clock.advance(11 * 60_000);
    expectError(await stale.post("/auth/staff/mfa/recovery-codes"), 403, "AUTH_STEP_UP_REQUIRED");
  });

  it("NT-M7: an account in the middle of enrolment (unconfirmed factor) cannot sign in", async () => {
    const ab = await signIn(admin);
    const e = email("half");
    const inv = await ab.post("/admin/users/invite", {
      email: e,
      displayName: "Half Way",
      siteId: BV,
    });
    const token = tokenOf(inv.body.enrolmentLink);
    secrets.add(token);
    const b = new Browser();
    await b.post("/auth/staff/enrol/password", { token, password: PASSWORD.staff });
    const setup = await b.post("/auth/staff/enrol/mfa/setup", { token });
    secrets.add(setup.body.secret);
    expect(
      await db.mfaFactor.count({ where: { user: { emailNormalized: e }, confirmedAt: null } }),
    ).toBe(1);
    expectError(
      await new Browser().post("/auth/staff/login", { email: e, password: PASSWORD.staff }),
      401,
      "AUTH_INVALID_CREDENTIALS",
    );
  });
});

// ------------------------------------------------------------------------------------------
// 5. Sessions (NT-S1..S9, AC-AU-4)
// ------------------------------------------------------------------------------------------

describe("sessions", () => {
  let user: Staff;
  beforeAll(async () => {
    user = await newStaff("sessions");
  });

  it("NT-S3: logout ends the session; the old cookie is 401", async () => {
    const b = await signIn(user);
    const cookie = b.session!;
    expect((await b.post("/auth/staff/logout")).status).toBe(204);
    expect(b.session).toBeUndefined();
    const replay = new Browser();
    replay.jar.set("__Host-dp_admin_session", cookie);
    expectError(await replay.get("/auth/staff/session"), 401, "AUTH_SESSION_REQUIRED");
  });

  it("NT-S5: idle 30 minutes and absolute 8 hours (injected clock)", async () => {
    const idle = await signIn(user);
    clock.advance(30 * 60_000 + 1_000);
    expectError(await idle.get("/auth/staff/session"), 401, "AUTH_SESSION_REQUIRED");
    const busy = await signIn(user);
    // Activity every 29 minutes keeps it alive up to the absolute limit: 16 x 29 = 464 min.
    for (let i = 0; i < 16; i++) {
      clock.advance(29 * 60_000);
      expect((await busy.get("/auth/staff/session")).status, `after ${(i + 1) * 29} min`).toBe(200);
    }
    clock.advance(29 * 60_000); // 17 x 29 = 493 min > 8 h
    expectError(await busy.get("/auth/staff/session"), 401, "AUTH_SESSION_REQUIRED");
  });

  it("NT-S8: someone else's session id -> 404; one's own other session can be ended", async () => {
    const mine = await signIn(user);
    const mine2 = await signIn(user);
    const theirs = await signIn(admin);
    const theirList = StaffSessionListResponseSchema.parse(
      (await theirs.get("/auth/staff/sessions")).body,
    );
    const foreign = theirList.items.find((s) => s.current)!.id;
    expectError(
      await mine.call("DELETE", `/api/v1/auth/staff/sessions/${foreign}`),
      404,
      "NOT_FOUND",
    );
    expectError(
      await mine.call("DELETE", "/api/v1/auth/staff/sessions/not-a-uuid"),
      404,
      "NOT_FOUND",
    );
    expect((await theirs.get("/auth/staff/session")).status).toBe(200);
    const myList = StaffSessionListResponseSchema.parse(
      (await mine.get("/auth/staff/sessions")).body,
    );
    const other = myList.items.find((s) => !s.current)!.id;
    expect((await mine.call("DELETE", `/api/v1/auth/staff/sessions/${other}`)).status).toBe(204);
    void mine2;
  });

  it("NT-S9: a sixth session ends the oldest (LIMIT_EXCEEDED)", async () => {
    await db.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: clock.now(), revokedReason: "USER_REVOKED" },
    });
    const browsers: Browser[] = [];
    for (let i = 0; i < 6; i++) browsers.push(await signIn(user));
    expectError(await browsers[0]!.get("/auth/staff/session"), 401, "AUTH_SESSION_REQUIRED");
    for (const b of browsers.slice(1))
      expect((await b.get("/auth/staff/session")).status).toBe(200);
    expect(
      await db.session.count({ where: { userId: user.id, revokedReason: "LIMIT_EXCEEDED" } }),
    ).toBe(1);
  });

  it("revoke-others needs step-up and keeps the current session", async () => {
    const other = await signIn(user);
    const b = await signIn(user);
    expect((await b.post("/auth/staff/sessions/revoke-others")).status).toBe(204);
    expectError(await other.get("/auth/staff/session"), 401, "AUTH_SESSION_REQUIRED");
    expect((await b.get("/auth/staff/session")).status).toBe(200);
    clock.advance(10 * 60_000 + 1_000);
    expect((await b.get("/auth/staff/session")).status).toBe(200);
    expectError(await b.post("/auth/staff/sessions/revoke-others"), 403, "AUTH_STEP_UP_REQUIRED");
  });

  it("NT-S4 / AC-AU-4: an own password change rotates this session and ends the other devices", async () => {
    const other = await signIn(user);
    const b = await signIn(user);
    const before = b.session;
    const wrong = await b.post("/auth/staff/password/change", {
      currentPassword: PW.not_my_password_1,
      newPassword: PW.another_long_pass_77,
    });
    expectError(wrong, 401, "AUTH_INVALID_CREDENTIALS");
    const weak = await b.post("/auth/staff/password/change", {
      currentPassword: user.password,
      newPassword: "short",
    });
    expectError(weak, 422, "AUTH_PASSWORD_POLICY");
    // The change applies the same folded identity rule ("sessions Person": "PERSÖN" folds to person).
    const named = await b.post("/auth/staff/password/change", {
      currentPassword: user.password,
      newPassword: "PERSÖN-mavi-dalga-2026",
    });
    expectError(named, 422, "AUTH_PASSWORD_POLICY");
    expect(named.body.error.details).toEqual(["contains_identity"]);
    const next = PW.lighthouse_tundra_pepper_31;
    secrets.add(next);
    expect(
      (
        await b.post("/auth/staff/password/change", {
          currentPassword: user.password,
          newPassword: next,
        })
      ).status,
    ).toBe(204);
    user.password = next;
    expect(b.session).not.toBe(before);
    expect((await b.get("/auth/staff/session")).status).toBe(200);
    expectError(await other.get("/auth/staff/session"), 401, "AUTH_SESSION_REQUIRED");
  });

  it("step-up failures are throttled per user (no TOTP brute force through a stolen session)", async () => {
    await db.authThrottle.deleteMany({});
    const b = await signIn(user);
    for (let i = 0; i < 6; i++) {
      expectError(await b.post("/auth/staff/step-up", { code: "999999" }), 401, "AUTH_MFA_INVALID");
    }
    // Throttled before the code is looked at, so even a valid code would get 429.
    expectError(await b.post("/auth/staff/step-up", { code: "123456" }), 429, "RATE_LIMITED");
    await db.authThrottle.deleteMany({});
  });
});

// ------------------------------------------------------------------------------------------
// 6. Administration (AC-AU-5; NT-R1..R9; MFA reset and re-enrolment NT-M6)
// ------------------------------------------------------------------------------------------

describe("staff administration", () => {
  let siteAdmin: Staff; // site_admin on BV
  let editorBv: Staff;
  let editorCorp: Staff;
  let platformPeer: Staff; // second platform admin, granted by admin

  beforeAll(async () => {
    siteAdmin = await newStaff("siteadmin", { roleKey: "site_admin" });
    editorBv = await newStaff("editorbv", { roleKey: "content_editor" });
    editorCorp = await newStaff("editorcorp", { roleKey: "content_editor", siteId: CORPORATE });
    platformPeer = await newStaff("peer", { roleKey: "platform_super_admin" });
  });

  it("NT-R6: without a fresh step-up every administration call is 403 AUTH_STEP_UP_REQUIRED", async () => {
    const b = await signIn(siteAdmin);
    clock.advance(10 * 60_000 + 1_000);
    for (const [p, body] of [
      [`/admin/users/${editorBv.id}/unlock`, { reason: "unlock without step-up" }],
      [`/admin/users/${editorBv.id}/suspend`, { reason: "suspend without step-up" }],
      [
        `/admin/users/${editorBv.id}/mfa-reset`,
        { reason: "reset without step-up", verificationMethod: "video_call" },
      ],
      ["/admin/users/invite", { email: email("n"), displayName: "N", siteId: BV }],
    ] as const) {
      expectError(await b.post(p, body), 403, "AUTH_STEP_UP_REQUIRED");
    }
  });

  it("NT-R1 / NT-R2: a site admin cannot reach platform admins or staff of another site", async () => {
    const b = await signIn(siteAdmin);
    for (const action of ["unlock", "suspend", "reactivate"]) {
      const r = await b.post(`/admin/users/${admin.id}/${action}`, {
        reason: "site admin on platform admin",
      });
      expect([403, 404]).toContain(r.status);
    }
    expect([403, 404]).toContain(
      (
        await b.post(`/admin/users/${admin.id}/mfa-reset`, {
          reason: "site admin on platform admin",
          verificationMethod: "video_call",
        })
      ).status,
    );
    expectError(
      await b.post(`/admin/users/${editorCorp.id}/unlock`, { reason: "other site staff member" }),
      404,
      "NOT_FOUND",
    );
    expectError(
      await b.post(`/admin/users/${editorCorp.id}/suspend`, { reason: "other site staff member" }),
      404,
      "NOT_FOUND",
    );
  });

  it("NT-R3: nobody acts on themselves", async () => {
    const b = await signIn(admin);
    expectError(
      await b.post(`/admin/users/${admin.id}/unlock`, { reason: "unlock myself please" }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await b.post(`/admin/users/${admin.id}/sessions/revoke`, {
        reason: "revoke my own sessions",
      }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await b.post(`/admin/users/${admin.id}/mfa-reset`, {
        reason: "reset my own MFA",
        verificationMethod: "in_person",
      }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await b.post(`/admin/users/${admin.id}/suspend`, { reason: "suspend myself now" }),
      403,
      "FORBIDDEN",
    );
  });

  it("NT-R7: a site admin can neither revoke sessions nor deactivate (Ö3)", async () => {
    const b = await signIn(siteAdmin);
    expectError(
      await b.post(`/admin/users/${editorBv.id}/sessions/revoke`, {
        reason: "site admin revoking sessions",
      }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await b.post(`/admin/users/${editorBv.id}/deactivate`, {
        reason: "site admin deactivating",
        confirmEmail: editorBv.email,
      }),
      403,
      "FORBIDDEN",
    );
  });

  it("NT-R8: customer targets and unknown ids look missing", async () => {
    const custEmail = email("cust");
    const cust = await db.user.create({
      data: {
        email: custEmail,
        emailNormalized: custEmail,
        kind: "CUSTOMER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
    const b = await signIn(admin);
    expectError(
      await b.post(`/admin/users/${cust.id}/unlock`, { reason: "customer moderation try" }),
      404,
      "NOT_FOUND",
    );
    expectError(
      await b.post(`/admin/users/00000000-0000-7000-8000-000000000000/unlock`, {
        reason: "nobody with this id",
      }),
      404,
      "NOT_FOUND",
    );
    expectError(
      await b.post(`/admin/users/not-a-uuid/unlock`, { reason: "malformed id given here" }),
      404,
      "NOT_FOUND",
    );
  });

  it("AC-AU-5 / NT-R9: a site admin manages its own site's staff; successes and refusals are audited", async () => {
    const b = await signIn(siteAdmin);
    const before = await db.auditEvent.count({
      where: { actorUserId: siteAdmin.id, outcome: "DENIED" },
    });
    expectError(
      await b.post(`/admin/users/${editorCorp.id}/unlock`, { reason: "other site staff member" }),
      404,
      "NOT_FOUND",
    );
    expect(
      await db.auditEvent.count({ where: { actorUserId: siteAdmin.id, outcome: "DENIED" } }),
    ).toBe(before + 1);
    expect(
      (await b.post(`/admin/users/${editorBv.id}/unlock`, { reason: "forgot password attempts" }))
        .status,
    ).toBe(204);
    // Site suspension changes the membership only; the account stays ACTIVE.
    expect(
      (
        await b.post(`/admin/users/${editorBv.id}/suspend`, {
          siteId: BV,
          reason: "membership on hold for now",
        })
      ).status,
    ).toBe(204);
    expect(
      (await db.membership.findFirstOrThrow({ where: { userId: editorBv.id, siteId: BV } })).status,
    ).toBe("SUSPENDED");
    expect((await db.user.findUniqueOrThrow({ where: { id: editorBv.id } })).status).toBe("ACTIVE");
    expectError(
      await b.post(`/admin/users/${editorBv.id}/suspend`, {
        siteId: BV,
        reason: "membership on hold twice",
      }),
      409,
      "CONFLICT_STATE",
    );
    expect(
      (
        await b.post(`/admin/users/${editorBv.id}/reactivate`, {
          siteId: BV,
          reason: "membership back to active",
        })
      ).status,
    ).toBe(204);
    const audits = await db.auditEvent.findMany({
      where: {
        actorUserId: siteAdmin.id,
        action: { in: ["iam.user_unlocked", "iam.membership_suspended", "iam.user_reactivated"] },
        outcome: "SUCCESS",
      },
    });
    expect(audits.map((a) => a.action).sort()).toEqual([
      "iam.membership_suspended",
      "iam.user_reactivated",
      "iam.user_unlocked",
    ]);
    expect(audits.every((a) => a.scopeType === "SITE" && a.siteId === BV && a.reason)).toBe(true);
  });

  it("NT-R4: nobody acts on one of their grant ancestors", async () => {
    // platformPeer's role was granted by admin: the peer holds the right but may not use it on admin.
    const b = await signIn(platformPeer);
    expectError(
      await b.post(`/admin/users/${admin.id}/unlock`, { reason: "peer acting on grantor" }),
      403,
      "FORBIDDEN",
    );
  });

  it("platform suspension ends the sessions (AC-AU-4) and reactivation restores the account", async () => {
    const target = await newStaff("platsusp");
    const device = await signIn(target);
    const b = await signIn(admin);
    expect(
      (await b.post(`/admin/users/${target.id}/suspend`, { reason: "account under investigation" }))
        .status,
    ).toBe(204);
    expectError(await device.get("/auth/staff/session"), 401, "AUTH_SESSION_REQUIRED");
    expect(
      (await b.post(`/admin/users/${target.id}/reactivate`, { reason: "investigation closed now" }))
        .status,
    ).toBe(204);
    expect((await signIn(target)).session).toBeDefined();
  });

  it("admin session revocation ends every session of the target", async () => {
    const target = await newStaff("revoked");
    const d1 = await signIn(target);
    const d2 = await signIn(target);
    const b = await signIn(admin);
    expect(
      (
        await b.post(`/admin/users/${target.id}/sessions/revoke`, {
          reason: "lost laptop reported",
        })
      ).status,
    ).toBe(204);
    for (const d of [d1, d2])
      expectError(await d.get("/auth/staff/session"), 401, "AUTH_SESSION_REQUIRED");
    expect(
      await db.session.count({ where: { userId: target.id, revokedReason: "ADMIN_REVOKED" } }),
    ).toBe(2);
  });

  it("MFA reset: PENDING, sessions end, re-enrolment needs the CURRENT password (NT-M6), no takeover", async () => {
    const target = await newStaff("mfareset");
    const device = await signIn(target);
    const b = await signIn(admin);
    const r = await b.post(`/admin/users/${target.id}/mfa-reset`, {
      reason: "phone lost, verified by video",
      verificationMethod: "video_call",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const link = MfaResetResponseSchema.parse(r.body).reenrolmentLink;
    secrets.add(tokenOf(link));
    expectError(await device.get("/auth/staff/session"), 401, "AUTH_SESSION_REQUIRED");
    expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe("PENDING");
    expect(await db.mfaFactor.count({ where: { userId: target.id } })).toBe(0);
    const token = tokenOf(link);
    const attacker = new Browser();
    // The administrator holds the link but not the password: a new password is not accepted...
    expectError(
      await attacker.post("/auth/staff/enrol/password", {
        token,
        password: PW.admin_chosen_password_1,
      }),
      400,
      "VALIDATION_FAILED",
    );
    // ...and a wrong current password counts against the token; MFA setup stays closed.
    expectError(
      await attacker.post("/auth/staff/enrol/password", {
        token,
        currentPassword: PW.guessing_the_password_1,
      }),
      401,
      "AUTH_INVALID_CREDENTIALS",
    );
    expectError(
      await attacker.post("/auth/staff/enrol/mfa/setup", { token }),
      409,
      "CONFLICT_STATE",
    );
    const inspect = await attacker.post("/auth/staff/enrol/inspect", { token });
    expect(inspect.body.steps[0]).toEqual({ step: "current_password", done: false });
    const enrolled = await enrol(link, target.password, "current_password");
    Object.assign(target, enrolled);
    expect((await signIn(target)).session).toBeDefined();
  });

  it("NT-M6 / NT-K2: five wrong current passwords invalidate the re-enrolment link", async () => {
    const target = await newStaff("mfareset2");
    const b = await signIn(admin);
    const r = await b.post(`/admin/users/${target.id}/mfa-reset`, {
      reason: "second phone lost today",
      verificationMethod: "phone_callback",
    });
    const token = tokenOf(r.body.reenrolmentLink);
    secrets.add(token);
    for (let i = 0; i < 5; i++) {
      expectError(
        await new Browser().post("/auth/staff/enrol/password", {
          token,
          currentPassword: `Wrong-Guess-${i}-xyz`,
        }),
        401,
        "AUTH_INVALID_CREDENTIALS",
      );
    }
    expectError(
      await new Browser().post("/auth/staff/enrol/password", {
        token,
        currentPassword: target.password,
      }),
      400,
      "AUTH_TOKEN_INVALID",
    );
  });

  it("enrolment links: re-issued for a pending invitation only; the old link dies (NT-K3)", async () => {
    const b = await signIn(admin);
    const e = email("relink");
    const inv = await b.post("/admin/users/invite", {
      email: e,
      displayName: "Re Link",
      siteId: BV,
    });
    const first = tokenOf(inv.body.enrolmentLink);
    const again = await b.post(`/admin/users/${inv.body.userId}/enrolment-link`);
    expect(again.status).toBe(200);
    secrets.add(first);
    secrets.add(tokenOf(again.body.enrolmentLink));
    expectError(
      await new Browser().post("/auth/staff/enrol/inspect", { token: first }),
      400,
      "AUTH_TOKEN_INVALID",
    );
    expect(
      (
        await new Browser().post("/auth/staff/enrol/inspect", {
          token: tokenOf(again.body.enrolmentLink),
        })
      ).status,
    ).toBe(200);
    expectError(await b.post(`/admin/users/${editorBv.id}/enrolment-link`), 409, "CONFLICT_STATE");
    // A site admin cannot re-issue the link of a pending platform administrator (dominance).
    const pendingAdmin = await b.post("/admin/users/invite", {
      email: email("pendadmin"),
      displayName: "Pending Admin",
      siteId: BV,
      roleKey: "platform_super_admin",
    });
    secrets.add(tokenOf(pendingAdmin.body.enrolmentLink));
    const sb = await signIn(siteAdmin);
    expectError(
      await sb.post(`/admin/users/${pendingAdmin.body.userId}/enrolment-link`),
      403,
      "FORBIDDEN",
    );
  });

  it("invite: escalation and duplicates are refused", async () => {
    const sb = await signIn(siteAdmin);
    expectError(
      await sb.post("/admin/users/invite", {
        email: email("esc"),
        displayName: "Esc",
        siteId: BV,
        roleKey: "platform_super_admin",
      }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await sb.post("/admin/users/invite", {
        email: email("other"),
        displayName: "Other",
        siteId: CORPORATE,
      }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await sb.post("/admin/users/invite", {
        email: editorBv.email,
        displayName: "Dup",
        siteId: BV,
      }),
      409,
      "CONFLICT_STATE",
    );
    const eb = await signIn(editorBv);
    expectError(
      await eb.post("/admin/users/invite", { email: email("ed"), displayName: "Ed", siteId: BV }),
      403,
      "FORBIDDEN",
    );
  });
});

// ------------------------------------------------------------------------------------------
// 7. Deactivation (AC-DA-1..4; NT-D1..D5) and the last administrator (NT-R5)
// ------------------------------------------------------------------------------------------

describe("deactivation and the last administrator", () => {
  it("NT-D2: a step-up older than 10 minutes -> 403 AUTH_STEP_UP_REQUIRED", async () => {
    const target = await newStaff("d2");
    const b = await signIn(admin);
    clock.advance(11 * 60_000);
    expect((await b.get("/auth/staff/session")).status).toBe(200);
    expectError(
      await b.post(`/admin/users/${target.id}/deactivate`, {
        reason: "step-up too old for this",
        confirmEmail: target.email,
      }),
      403,
      "AUTH_STEP_UP_REQUIRED",
    );
  });

  it("AC-DA-2 / NT-D4: a failure inside the transaction changes nothing", async () => {
    const target = await newStaff("d4", { roleKey: "content_editor" });
    const device = await signIn(target);
    const b = await signIn(admin);
    for (const point of ["deactivate:after-roles", "deactivate:before-user"]) {
      faults.armed = point;
      const r = await b.post(`/admin/users/${target.id}/deactivate`, {
        reason: "fault injection test run",
        confirmEmail: target.email,
      });
      expectError(r, 500, "INTERNAL_ERROR");
      expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe("ACTIVE");
      expect(await db.roleAssignment.count({ where: { userId: target.id, revokedAt: null } })).toBe(
        1,
      );
      expect((await device.get("/auth/staff/session")).status).toBe(200);
    }
    expect(faults.armed).toBeNull();
    expect(
      (
        await b.post(`/admin/users/${target.id}/deactivate`, {
          reason: "fault injection test done",
          confirmEmail: target.email,
        })
      ).status,
    ).toBe(204);
    expectError(await device.get("/auth/staff/session"), 401, "AUTH_SESSION_REQUIRED");
    expect(
      await db.userCredentialToken.count({
        where: { userId: target.id, consumedAt: null, invalidatedAt: null },
      }),
    ).toBe(0);
  });

  it("AC-DA-4: iam.user_deactivated (success and refusal) and db.* events carry the expected fields", async () => {
    const target = await newStaff("d5", { roleKey: "site_admin" });
    const b = await signIn(admin);
    await b.post(`/admin/users/${target.id}/deactivate`, {
      reason: "audit fields check",
      confirmEmail: "wrong.address@staff.dp.test",
    });
    expect(
      (
        await b.post(`/admin/users/${target.id}/deactivate`, {
          reason: "audit fields check done",
          confirmEmail: target.email,
        })
      ).status,
    ).toBe(204);
    const events = await db.auditEvent.findMany({
      where: { action: "iam.user_deactivated", resourceId: target.id },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((e) => e.outcome)).toEqual(["DENIED", "SUCCESS"]);
    expect(events[0]?.reason).toBe("confirm_email_mismatch");
    const ok = events[1]!;
    expect(ok).toMatchObject({
      actorType: "USER",
      actorUserId: admin.id,
      scopeType: "PLATFORM",
      reason: "audit fields check done",
    });
    const meta = ok.metadata as Record<string, unknown>;
    expect(meta["roles"]).toEqual([{ role: "site_admin", scope: "SITE", siteId: BV }]);
    expect(typeof meta["revokedCount"]).toBe("number");
    expect(typeof meta["stepUpAgeSec"]).toBe("number");
    const dbEvents = await db.auditEvent.findMany({
      where: {
        action: { startsWith: "db." },
        OR: [{ resourceId: target.id }, { metadata: { path: ["userId"], equals: target.id } }],
      },
    });
    expect(dbEvents.some((e) => e.action === "db.user_security_changed")).toBe(true);
    expect(dbEvents.some((e) => e.action === "db.role_assignment_changed")).toBe(true);
    expect(
      dbEvents.every((e) => (e.metadata as Record<string, unknown>)["dbUser"] === "dp_app"),
    ).toBe(true);
  });

  it("NT-D3 / NT-R5 / AC-DA-3: the last ACTIVE, MFA-enrolled, non-expiring administrator stays (409 + database)", async () => {
    // Start from admin as the only other-than-test administrator: deactivate the peers it granted.
    const peers = await db.roleAssignment.findMany({
      where: {
        role: { key: "platform_super_admin" },
        revokedAt: null,
        userId: { not: admin.id },
        user: { status: { in: ["ACTIVE", "PENDING", "SUSPENDED"] } },
      },
      select: { userId: true, user: { select: { emailNormalized: true } } },
    });
    const ab = await signIn(admin);
    for (const p of peers) {
      const r = await ab.post(`/admin/users/${p.userId}/deactivate`, {
        reason: "clearing other administrators",
        confirmEmail: p.user.emailNormalized,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(204);
    }
    // peerA (granted by admin) grants peerB; peerB's assignment then gets an expiry, so peerB is an
    // administrator that does not count as qualified, and admin is not in peerB's ancestry once
    // peerA is gone.
    const peerA = await newStaff("peerA", { roleKey: "platform_super_admin" });
    const peerB = await newStaff("peerB", { roleKey: "platform_super_admin", by: peerA });
    await db.roleAssignment.updateMany({
      where: { userId: peerB.id, revokedAt: null },
      data: { expiresAt: new Date(clock.now().getTime() + 7 * 86_400_000) },
    });
    const ab2 = await signIn(admin);
    expect(
      (
        await ab2.post(`/admin/users/${peerA.id}/deactivate`, {
          reason: "peerA leaves the company",
          confirmEmail: peerA.email,
        })
      ).status,
    ).toBe(204);
    const bb = await signIn(peerB);
    // The code rule: removing admin would leave no ACTIVE, MFA-enrolled, non-expiring admin.
    expectError(
      await bb.post(`/admin/users/${admin.id}/deactivate`, {
        reason: "remove the last real admin",
        confirmEmail: admin.email,
      }),
      409,
      "CONFLICT_LAST_ADMIN",
    );
    expectError(
      await bb.post(`/admin/users/${admin.id}/suspend`, { reason: "suspend the last real admin" }),
      409,
      "CONFLICT_LAST_ADMIN",
    );
    const denied = await db.auditEvent.findMany({
      where: { actorUserId: peerB.id, outcome: "DENIED", reason: "last_platform_admin" },
    });
    expect(denied.map((d) => d.action).sort()).toEqual([
      "iam.user_deactivated",
      "iam.user_suspended",
    ]);
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).status).toBe("ACTIVE");
    // Without peerB the database refuses the removal on its own as well (dp_app, direct).
    const ab3 = await signIn(admin);
    expect(
      (
        await ab3.post(`/admin/users/${peerB.id}/deactivate`, {
          reason: "peerB leaves as well",
          confirmEmail: peerB.email,
        })
      ).status,
    ).toBe(204);
    await expect(
      db.user.update({ where: { id: admin.id }, data: { status: "SUSPENDED" } }),
    ).rejects.toThrow(/last active platform administrator/);
    await expect(
      db.roleAssignment.updateMany({
        where: { userId: admin.id, revokedAt: null },
        data: { revokedAt: clock.now() },
      }),
    ).rejects.toThrow(/last active platform administrator/);
  });
});

// ------------------------------------------------------------------------------------------
// 8. Timing and leaks (NT-E2, NT-L1, NT-L2, AC-SEC-2)
// ------------------------------------------------------------------------------------------

describe("no timing or secret leaks", () => {
  it("NT-E2: known vs unknown e-mail, p95 difference < 50 ms (100 + 100 samples)", async () => {
    const measure = async (target: string) => {
      const out: number[] = [];
      for (let i = 0; i < 100; i++) {
        await db.authThrottle.deleteMany({});
        const b = new Browser(TEST_KEYS.admin, `198.19.${i}.1`);
        const t0 = performance.now();
        const r = await b.post("/auth/staff/login", {
          email: target,
          password: PW.wrong_password_123,
        });
        out.push(performance.now() - t0);
        expect(r.status).toBe(401);
      }
      out.sort((a, b) => a - b);
      return out[94] as number;
    };
    const known = await measure(admin.email);
    const unknown = await measure("nobody.at.all@staff.dp.test");
    expect(Math.abs(known - unknown)).toBeLessThan(50);
    await db.authThrottle.deleteMany({});
  }, 300_000);

  it("NT-L1 / NT-L2 / AC-SEC-2: logs, CLI output and audit metadata contain no secret", async () => {
    const values = [...secrets].filter((s) => s.length >= 10);
    expect(values.length).toBeGreaterThan(20);
    const logs = logLines.join("\n");
    const audit = JSON.stringify(
      await db.auditEvent.findMany({ select: { metadata: true, reason: true } }),
    );
    for (const v of values) {
      expect(logs.includes(v), "a secret value is in the logs").toBe(false);
      expect(audit.includes(v), "a secret value is in the audit trail").toBe(false);
    }
    // NT-L3 (stored form): TOTP secrets are ciphertext, recovery codes HMAC digests.
    const factors = await db.mfaFactor.findMany({ select: { secretCiphertext: true } });
    expect(factors.every((f) => /^v1:/.test(f.secretCiphertext))).toBe(true);
  });
});
