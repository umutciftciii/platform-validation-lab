// PM-3 (DP-068): product review, approval and per-site publication over HTTP, the public content
// API of the sites, and the database rules behind them, on a database of its own
// (WORKFLOW_*_DATABASE_URL, a *_test database that starts EMPTY).
//
// Setup as in catalog.int.test.ts: migrations as dp_migrator, catalogue sync and bootstrap
// through the operator CLI, staff fixtures written as dp_owner, the API in-process from dist/ as
// dp_app, with the filesystem media storage in a temporary directory.
//
// Covers: state transitions (submit, withdraw, approve, request changes, review reset on edits),
// separation of duties (API and triggers), RBAC and cross-site refusals with audit, stale versions
// and concurrent edits, publication readiness (BLOCKING/WARNING), publish/republish/unpublish per
// site (BV and Corporate independent), the public read API (site from the key only; drafts,
// hidden listings, unpublished products and original images never exposed), the append-only
// history, snapshot immutability, guards on archiving and deleting published images, and the
// dp_app privileges of the new tables.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
import {
  ErrorBodySchema,
  ProductWorkflowResponseSchema,
  PublicCategoryListResponseSchema,
  PublicProductListResponseSchema,
  PublicProductResponseSchema,
  ReviewQueueResponseSchema,
} from "@dream/contracts";
import { assertTestDatabaseUrl } from "@dream/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { ADMIN_ORIGIN, TEST_KEYS, apiTestEnv } from "./helpers/auth-env.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(API_DIR, "dist/iam/iam-cli.js");
const PRISMA = path.join(API_DIR, "node_modules/.bin/prisma");
const appUrl = assertTestDatabaseUrl(process.env["WORKFLOW_DATABASE_URL"]);
const DB_NAME = appUrl.pathname.slice(1);
function bootstrapUrl(): string {
  const u = assertTestDatabaseUrl(process.env["IAM_BOOTSTRAP_DATABASE_URL"]);
  u.pathname = `/${DB_NAME}`;
  return assertTestDatabaseUrl(u.toString()).toString();
}
const urls = {
  app: appUrl.toString(),
  migrate: assertTestDatabaseUrl(process.env["WORKFLOW_MIGRATE_DATABASE_URL"]).toString(),
  boot: bootstrapUrl(),
};
for (const shared of [
  process.env["DATABASE_URL"],
  process.env["AUTH_DATABASE_URL"],
  process.env["CATALOG_DATABASE_URL"],
]) {
  if (shared && new URL(shared).pathname === appUrl.pathname) {
    throw new Error("WORKFLOW_DATABASE_URL must be a database of its own (it starts empty)");
  }
}
const ENV_BACKUP = { ...process.env };
const MEDIA_DIR = mkdtempSync(path.join(tmpdir(), "dp-workflow-media-"));

interface App {
  listen(port: number, host: string): Promise<unknown>;
  getHttpServer(): { address(): unknown };
  close(): Promise<void>;
}

let app: App;
let base: string;
let owner: PrismaClient; // dp_migrator acting as dp_owner: fixtures and probes
let asApp: PrismaClient; // dp_app: privilege probes
let BV: string;
let COM: string;

interface Res {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Headers;
}

async function parse(res: Response): Promise<Res> {
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

class Staff {
  constructor(
    readonly name: string,
    readonly userId: string,
    private readonly token: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      "x-dp-proxy-key": TEST_KEYS.admin,
      "x-dp-client-ip": "10.20.30.40",
      cookie: `__Host-dp_admin_session=${this.token}`,
    };
  }

  async call(method: string, p: string, body?: unknown): Promise<Res> {
    const headers = this.headers();
    if (method !== "GET") headers["origin"] = ADMIN_ORIGIN;
    if (method === "POST") headers["content-type"] = "application/json";
    return parse(
      await fetch(`${base}/api/v1/admin/catalog${p}`, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      }),
    );
  }
  get(p: string) {
    return this.call("GET", p);
  }
  post(p: string, body?: unknown) {
    return this.call("POST", p, body);
  }
  del(p: string) {
    return this.call("DELETE", p);
  }
  async upload(productId: string, bytes: Buffer): Promise<Res> {
    return parse(
      await fetch(`${base}/api/v1/admin/catalog/products/${productId}/images`, {
        method: "PUT",
        headers: { ...this.headers(), origin: ADMIN_ORIGIN, "content-type": "image/jpeg" },
        body: new Uint8Array(bytes),
      }),
    );
  }
  async workflow(productId: string) {
    const res = await this.get(`/products/${productId}/workflow`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return ProductWorkflowResponseSchema.parse(res.body);
  }
}

type Site = "bv" | "com" | "admin";
const KEY: Record<Site, string> = {
  bv: TEST_KEYS.webBv,
  com: TEST_KEYS.webCorporate,
  admin: TEST_KEYS.admin,
};
async function pub(site: Site, p: string, method = "GET"): Promise<Res> {
  return parse(
    await fetch(`${base}/api/v1/public/catalog${p}`, {
      method,
      headers: { "x-dp-proxy-key": KEY[site] },
    }),
  );
}
async function pubBytes(site: Site, p: string) {
  const res = await fetch(`${base}/api/v1/public/catalog${p}`, {
    headers: { "x-dp-proxy-key": KEY[site] },
  });
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
}

function expectError(
  res: Res,
  status: number,
  code: string,
  detail?: { path: string; rule: string },
) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(ErrorBodySchema.parse(res.body).error.code).toBe(code);
  if (detail) expect(res.body.error.details).toContainEqual(detail);
}

const FAKE_ARGON = "$argon2id$v=19$m=19456,t=2,p=1$ZmFrZXNhbHQ$ZmFrZWhhc2hmYWtlaGFzaGZha2VoYXNo";

async function staff(
  name: string,
  grants: { role: string; site?: string }[],
  grantor: string | null,
  existingUserId?: string,
): Promise<Staff> {
  const now = new Date();
  const userId =
    existingUserId ??
    (
      await owner.user.create({
        data: {
          email: `${name}@staff.dp.test`,
          emailNormalized: `${name}@staff.dp.test`,
          kind: "STAFF",
          status: "ACTIVE",
          displayName: name,
          emailVerifiedAt: now,
          passwordHash: FAKE_ARGON,
          passwordUpdatedAt: now,
          mfaEnrolledAt: now,
        },
      })
    ).id;
  for (const g of grants) {
    const role = await owner.role.findUniqueOrThrow({ where: { key: g.role } });
    if (g.site) {
      await owner.membership.upsert({
        where: { userId_siteId: { userId, siteId: g.site } },
        create: { userId, siteId: g.site, status: "ACTIVE" },
        update: { status: "ACTIVE" },
      });
    }
    await owner.roleAssignment.create({
      data: {
        userId,
        roleId: role.id,
        scopeType: g.site ? "SITE" : "PLATFORM",
        siteId: g.site ?? null,
        grantedById: grantor,
        reason: "PM-3 workflow test fixture",
      },
    });
  }
  const token = randomBytes(32).toString("base64url");
  await owner.session.create({
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      userId,
      kind: "STAFF",
      app: "ADMIN",
      securityVersion: 0,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + 30 * 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 8 * 3_600_000),
      mfaVerifiedAt: now,
    },
  });
  return new Staff(name, userId, token);
}

function cli(args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    env: { PATH: process.env["PATH"] ?? "", DP_ADMIN_BASE_URL: ADMIN_ORIGIN, ...env },
    encoding: "utf8",
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

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
  owner.auditEvent.findFirst({ where: { action }, orderBy: { occurredAt: "desc" } });

const jpeg = (w = 1200, h = 900, r = 30) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g: 90, b: 120 } } })
    .jpeg()
    .toBuffer();

let root: Staff; // platform_super_admin: master edit + approve platform-wide, never publishes
let reviewer: Staff; // a second platform_super_admin (approver)
let pm: Staff; // platform_product_manager: master edit, no approval
let techBv: Staff; // technical_reviewer @ BV: product:approve on BV only (not platform-wide)
let bvPublisher: Staff; // product_publisher @ BV
let comPublisher: Staff; // product_publisher @ CORPORATE
let bvEditor: Staff; // product_editor @ BV (listings)
let bvReader: Staff; // read_only @ BV
let nobody: Staff; // ACTIVE, no role

/** Product fixtures: id plus the site data the publish step needs. */
const P: Record<string, string> = {};
let kvDef: string;
let bvCategory: string;
let comCategory: string;

async function version(id: string): Promise<number> {
  return (await owner.product.findUniqueOrThrow({ where: { id } })).version;
}
async function listingVersion(id: string, siteId: string): Promise<number> {
  return (
    await owner.productSiteListing.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId } },
    })
  ).version;
}

beforeAll(async () => {
  owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: urls.migrate }) });
  asApp = new PrismaClient({ adapter: new PrismaPg({ connectionString: urls.app }) });
  const tables = await owner.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM pg_tables WHERE schemaname = 'public'`;
  expect(Number(tables[0]?.n), "the workflow test database must start empty").toBe(0);
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
  const rootUser = await owner.user.findUniqueOrThrow({
    where: { emailNormalized: "root@staff.dp.test" },
  });
  const now = new Date();
  await owner.user.update({
    where: { id: rootUser.id },
    data: {
      status: "ACTIVE",
      emailVerifiedAt: now,
      passwordHash: FAKE_ARGON,
      passwordUpdatedAt: now,
      mfaEnrolledAt: now,
    },
  });
  const sites = await owner.site.findMany();
  BV = sites.find((s) => s.key === "BV")!.id;
  COM = sites.find((s) => s.key === "CORPORATE")!.id;

  root = await staff("root", [], null, rootUser.id);
  reviewer = await staff("reviewer", [{ role: "platform_super_admin" }], rootUser.id);
  pm = await staff("pm", [{ role: "platform_product_manager" }], rootUser.id);
  techBv = await staff("tech-bv", [{ role: "technical_reviewer", site: BV }], rootUser.id);
  bvPublisher = await staff("bv-publisher", [{ role: "product_publisher", site: BV }], rootUser.id);
  comPublisher = await staff(
    "com-publisher",
    [{ role: "product_publisher", site: COM }],
    rootUser.id,
  );
  bvEditor = await staff("bv-editor", [{ role: "product_editor", site: BV }], rootUser.id);
  bvReader = await staff("bv-reader", [{ role: "read_only", site: BV }], rootUser.id);
  nobody = await staff("nobody", [], rootUser.id);

  Object.assign(process.env, apiTestEnv(), {
    DATABASE_URL: urls.app,
    DB_ENV: "test",
    DB_EXPECTED_NAME: DB_NAME,
    DP_MEDIA_STORAGE: "filesystem",
    DP_MEDIA_DIR: MEDIA_DIR,
  });
  delete process.env["DP_DEPLOY_ENV"];
  const factory = (await import(pathToFileURL(path.join(API_DIR, "dist/app.factory.js")).href)) as {
    createApiApp(o: { logger: false }): Promise<App>;
  };
  app = await factory.createApiApp({ logger: false });
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as { port: number };
  base = `http://127.0.0.1:${port}`;

  // Catalogue fixtures through the API: a required specification, categories on both sites.
  const def = await root.post("/spec-definitions", {
    key: "kv100",
    name: "Kinematic viscosity at 100 °C",
    dataType: "NUMBER",
    units: ["mm²/s"],
    testMethods: ["ASTM D445"],
    required: true,
    decimals: 2,
  });
  expect(def.status, JSON.stringify(def.body)).toBe(201);
  kvDef = def.body.definition.id;
  const cBv = await bvEditor.post(`/sites/${BV}/categories`, {
    name: "Base oils",
    slug: "base-oils",
    parentId: null,
  });
  expect(cBv.status, JSON.stringify(cBv.body)).toBe(201);
  bvCategory = cBv.body.category.id;
  const cCom = await root.post(`/sites/${COM}/categories`, {
    name: "Products",
    slug: "products",
    parentId: null,
  });
  expect(cCom.status, JSON.stringify(cCom.body)).toBe(201);
  comCategory = cCom.body.category.id;
});

afterAll(async () => {
  await app?.close();
  rmSync(MEDIA_DIR, { recursive: true, force: true });
  await owner?.$disconnect();
  await asApp?.$disconnect();
  for (const k of Object.keys(process.env)) if (!(k in ENV_BACKUP)) delete process.env[k];
  Object.assign(process.env, ENV_BACKUP);
});

/** A complete product by the product manager: master, value, cover image, both listings. */
async function completeProduct(key: string, code: string): Promise<string> {
  const created = await pm.post("/products", {
    code,
    slug: code.toLowerCase(),
    name: `Product ${code}`,
    summary: `Summary of ${code}`,
    description: `Description of ${code}`,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id: string = created.body.product.id;
  P[key] = id;
  const specs = await pm.post(`/products/${id}/specs`, {
    version: await version(id),
    values: [
      {
        definitionId: kvDef,
        value: { type: "NUMBER", number: 6.12 },
        unit: "mm²/s",
        testMethod: "ASTM D445",
      },
    ],
  });
  expect(specs.status, JSON.stringify(specs.body)).toBe(200);
  const up = await pm.upload(id, await jpeg());
  expect(up.status, JSON.stringify(up.body)).toBe(201);
  const img = up.body.image;
  const alt = await pm.post(`/images/${img.id}`, {
    altText: "Drum of the product",
    version: img.version,
  });
  expect(alt.status, JSON.stringify(alt.body)).toBe(200);
  const lBv = await bvEditor.post(`/products/${id}/listings/${BV}`, {
    version: null,
    categoryId: bvCategory,
    visibility: "VISIBLE",
    title: `${code} for BV`,
  });
  expect(lBv.status, JSON.stringify(lBv.body)).toBe(200);
  const lCom = await root.post(`/products/${id}/listings/${COM}`, {
    version: null,
    categoryId: comCategory,
    visibility: "VISIBLE",
  });
  expect(lCom.status, JSON.stringify(lCom.body)).toBe(200);
  return id;
}

// ------------------------------------------------------------------------------------------
// 1. Schema and permissions overview
// ------------------------------------------------------------------------------------------

describe("1. context and schema", () => {
  it("tells each user what they may review and publish", async () => {
    const ctx = async (s: Staff) => (await s.get("/context")).body;
    expect(await ctx(root)).toMatchObject({ canEditMaster: true, canApprove: true });
    expect((await ctx(root)).sites.map((s: { canPublish: boolean }) => s.canPublish)).toEqual([
      false,
      false,
    ]);
    expect(await ctx(pm)).toMatchObject({ canEditMaster: true, canApprove: false });
    expect(await ctx(techBv)).toMatchObject({ canEditMaster: false, canApprove: false });
    const p = await ctx(bvPublisher);
    expect(p.sites).toEqual([
      expect.objectContaining({ key: "BV", canPublish: true, canEdit: false }),
    ]);
  });

  it("has the review states and the dp_app privileges of the new tables", async () => {
    const labels = await owner.$queryRaw<{ l: string }[]>`
      SELECT e.enumlabel AS l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'ProductStatus' ORDER BY e.enumsortorder`;
    expect(labels.map((r) => r.l)).toEqual(["DRAFT", "IN_REVIEW", "APPROVED", "ARCHIVED"]);
    const priv = await owner.$queryRaw<{ t: string; p: string }[]>`
      SELECT table_name AS t, privilege_type AS p FROM information_schema.role_table_grants
      WHERE grantee = 'dp_app' AND table_name IN ('ProductReviewEvent', 'ProductPublication')
      ORDER BY 1, 2`;
    expect(priv.map((r) => `${r.t}:${r.p}`)).toEqual([
      "ProductPublication:INSERT",
      "ProductPublication:SELECT",
      "ProductPublication:UPDATE",
      "ProductReviewEvent:INSERT",
      "ProductReviewEvent:SELECT",
    ]);
  });
});

// ------------------------------------------------------------------------------------------
// 2. Submit, withdraw, review decisions
// ------------------------------------------------------------------------------------------

describe("2. review workflow", () => {
  it("refuses to submit without the master permission, with a stale version or BLOCKING data", async () => {
    const created = await pm.post("/products", {
      code: "WF-A",
      slug: "wf-a",
      name: "Workflow A",
      summary: "A",
    });
    expect(created.status).toBe(201);
    P["a"] = created.body.product.id;
    const v = await version(P["a"]!);
    for (const s of [bvEditor, techBv, bvPublisher, bvReader, nobody]) {
      expectError(await s.post(`/products/${P["a"]}/submit`, { version: v }), 403, "FORBIDDEN");
    }
    expectError(
      await pm.post(`/products/${P["a"]}/submit`, { version: v + 5 }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    // The required kinematic viscosity is missing: BLOCKING, so no review.
    expectError(
      await pm.post(`/products/${P["a"]}/submit`, { version: v }),
      400,
      "VALIDATION_FAILED",
      { path: "spec:kv100", rule: "required_missing" },
    );
    expect((await owner.product.findUniqueOrThrow({ where: { id: P["a"] } })).status).toBe("DRAFT");
  });

  it("submits a complete master: IN_REVIEW, history event, audit, review queue", async () => {
    await pm.post(`/products/${P["a"]}/specs`, {
      version: await version(P["a"]!),
      values: [
        {
          definitionId: kvDef,
          value: { type: "NUMBER", number: 5 },
          unit: "mm²/s",
          testMethod: null,
        },
      ],
    });
    const v = await version(P["a"]!);
    const res = await pm.post(`/products/${P["a"]}/submit`, { version: v, comment: " Ready  " });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const wf = ProductWorkflowResponseSchema.parse(res.body);
    expect(wf).toMatchObject({
      status: "IN_REVIEW",
      version: v + 1,
      submittedVersion: v + 1,
      submittedBy: { id: pm.userId, name: "pm" },
    });
    expect(wf.history[0]).toMatchObject({ action: "SUBMITTED", comment: "Ready", siteId: null });
    // The test method is missing: a WARNING, shown but not blocking.
    expect(wf.validation.warnings.map((w) => w.code)).toContain("test_method_missing");
    expect(await lastAudit("catalog.product_submitted")).toMatchObject({
      actorUserId: pm.userId,
      resourceId: P["a"],
      outcome: "SUCCESS",
    });
    expectError(
      await pm.post(`/products/${P["a"]}/submit`, { version: v + 1 }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "not_draft" },
    );
    const q = ReviewQueueResponseSchema.parse((await reviewer.get("/review-queue")).body);
    expect(q.canApprove).toBe(true);
    expect(q.items).toEqual([
      expect.objectContaining({
        productId: P["a"],
        comment: "Ready",
        canReview: true,
        blockingCount: 0,
      }),
    ]);
    // The submitter sees the item but may not decide on it.
    const own = ReviewQueueResponseSchema.parse((await pm.get("/review-queue")).body);
    expect(own.items[0]).toMatchObject({ canReview: false, reviewBlockedReason: "no_permission" });
    const reader = ReviewQueueResponseSchema.parse((await bvReader.get("/review-queue")).body);
    expect(reader.items).toHaveLength(1);
    expectError(await nobody.get("/review-queue"), 403, "FORBIDDEN");
  });

  it("withdraws back to DRAFT (editor), then resubmits", async () => {
    let v = await version(P["a"]!);
    expectError(
      await bvReader.post(`/products/${P["a"]}/withdraw`, { version: v }),
      403,
      "FORBIDDEN",
    );
    const res = await pm.post(`/products/${P["a"]}/withdraw`, { version: v });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.history[0].action).toBe("WITHDRAWN");
    v = await version(P["a"]!);
    expect((await pm.post(`/products/${P["a"]}/submit`, { version: v })).status).toBe(200);
  });

  it("needs product:approve platform-wide: site reviewers and editors cannot decide", async () => {
    const v = await version(P["a"]!);
    for (const s of [pm, techBv, bvPublisher, bvEditor]) {
      expectError(await s.post(`/products/${P["a"]}/approve`, { version: v }), 403, "FORBIDDEN");
    }
    const denied = await owner.auditEvent.findFirst({
      where: { action: "catalog.access_denied", actorUserId: techBv.userId },
      orderBy: { occurredAt: "desc" },
    });
    expect(denied).toMatchObject({ outcome: "DENIED", reason: "no_grant" });
  });

  it("requires a reason to request changes, then returns the master to DRAFT", async () => {
    const v = await version(P["a"]!);
    expectError(
      await reviewer.post(`/products/${P["a"]}/request-changes`, { version: v }),
      400,
      "VALIDATION_FAILED",
    );
    const res = await reviewer.post(`/products/${P["a"]}/request-changes`, {
      version: v,
      comment: "Add the ASTM D445 test method.",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.history[0]).toMatchObject({
      action: "CHANGES_REQUESTED",
      comment: "Add the ASTM D445 test method.",
      actor: { id: reviewer.userId },
    });
    expect(await lastAudit("catalog.product_changes_requested")).toMatchObject({
      actorUserId: reviewer.userId,
      outcome: "SUCCESS",
    });
  });

  it("approves a resubmitted master; the approval records who and which version", async () => {
    let v = await version(P["a"]!);
    await pm.post(`/products/${P["a"]}/specs`, {
      version: v,
      values: [
        {
          definitionId: kvDef,
          value: { type: "NUMBER", number: 5 },
          unit: "mm²/s",
          testMethod: "ASTM D445",
        },
      ],
    });
    v = await version(P["a"]!);
    expect((await pm.post(`/products/${P["a"]}/submit`, { version: v })).status).toBe(200);
    expectError(
      await reviewer.post(`/products/${P["a"]}/approve`, { version: v }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    const res = await reviewer.post(`/products/${P["a"]}/approve`, {
      version: v + 1,
      comment: "OK",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      status: "APPROVED",
      version: v + 2,
      approvedVersion: v + 2,
      approvedBy: { id: reviewer.userId },
    });
    const row = await owner.product.findUniqueOrThrow({ where: { id: P["a"] } });
    expect(row.revisionEditorIds).toEqual([]);
    expectError(
      await reviewer.post(`/products/${P["a"]}/approve`, { version: v + 2 }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "not_in_review" },
    );
  });
});

// ------------------------------------------------------------------------------------------
// 3. Separation of duties
// ------------------------------------------------------------------------------------------

describe("3. separation of duties", () => {
  it("an approver who edited the revision cannot approve it (403, audited)", async () => {
    const created = await pm.post("/products", {
      code: "WF-B",
      slug: "wf-b",
      name: "B",
      summary: "B",
    });
    P["b"] = created.body.product.id;
    await pm.post(`/products/${P["b"]}/specs`, {
      version: await version(P["b"]!),
      values: [
        {
          definitionId: kvDef,
          value: { type: "NUMBER", number: 7 },
          unit: "mm²/s",
          testMethod: "ASTM D445",
        },
      ],
    });
    // The reviewer edits the master: now an editor of this revision.
    const before = (await owner.product.findUniqueOrThrow({ where: { id: P["b"] } })).version;
    const edit = await reviewer.post(`/products/${P["b"]}`, {
      version: before,
      code: "WF-B",
      slug: "wf-b",
      name: "B (reviewed name)",
      summary: "B",
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const v = await version(P["b"]!);
    expect((await pm.post(`/products/${P["b"]}/submit`, { version: v })).status).toBe(200);
    const wf = await reviewer.workflow(P["b"]!);
    expect(wf.permissions).toMatchObject({ canReview: false, reviewBlockedReason: "own_change" });
    for (const action of ["approve", "request-changes"]) {
      expectError(
        await reviewer.post(`/products/${P["b"]}/${action}`, { version: v + 1, comment: "self" }),
        403,
        "FORBIDDEN",
        { path: "(root)", rule: "own_change" },
      );
    }
    expect(
      await owner.auditEvent.findFirst({
        where: { actorUserId: reviewer.userId, reason: "separation_of_duties" },
      }),
    ).toMatchObject({ outcome: "DENIED", action: "catalog.access_denied" });
    // Root did not touch it: root may approve.
    const ok = await root.post(`/products/${P["b"]}/approve`, { version: v + 1 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("the submitter cannot approve their own submission", async () => {
    const created = await pm.post("/products", {
      code: "WF-C",
      slug: "wf-c",
      name: "C",
      summary: "C",
    });
    P["c"] = created.body.product.id;
    await pm.post(`/products/${P["c"]}/specs`, {
      version: await version(P["c"]!),
      values: [
        {
          definitionId: kvDef,
          value: { type: "NUMBER", number: 3 },
          unit: "mm²/s",
          testMethod: "ASTM D445",
        },
      ],
    });
    // Root submits a master edited only by the product manager.
    const v = await version(P["c"]!);
    expect((await root.post(`/products/${P["c"]}/submit`, { version: v })).status).toBe(200);
    expectError(
      await root.post(`/products/${P["c"]}/approve`, { version: v + 1 }),
      403,
      "FORBIDDEN",
      { path: "(root)", rule: "own_change" },
    );
    expect((await reviewer.post(`/products/${P["c"]}/approve`, { version: v + 1 })).status).toBe(
      200,
    );
  });

  it("the database refuses a self-approval and invalid transitions from any writer", async () => {
    const created = await pm.post("/products", {
      code: "WF-D",
      slug: "wf-d",
      name: "D",
      summary: "D",
    });
    const id: string = created.body.product.id;
    P["d"] = id;
    const v = await version(id);
    // DRAFT -> APPROVED directly is not a transition.
    await rejectsDb(
      owner.product.update({
        where: { id },
        data: {
          status: "APPROVED",
          version: v + 1,
          approvedAt: new Date(),
          approvedById: reviewer.userId,
          approvedVersion: v + 1,
        },
      }),
      /product status cannot change from DRAFT to APPROVED/,
    );
    await owner.product.update({
      where: { id },
      data: {
        status: "IN_REVIEW",
        version: v + 1,
        submittedAt: new Date(),
        submittedById: root.userId,
        submittedVersion: v + 1,
      },
    });
    // The product manager created it (revision editor): approval by them is refused.
    await rejectsDb(
      owner.product.update({
        where: { id },
        data: {
          status: "APPROVED",
          version: v + 2,
          approvedAt: new Date(),
          approvedById: pm.userId,
          approvedVersion: v + 2,
        },
      }),
      /separation of duties/,
    );
    await rejectsDb(
      owner.productReviewEvent.create({
        data: {
          productId: id,
          action: "APPROVED",
          productVersion: v + 2,
          actorUserId: root.userId,
        },
      }),
      /separation of duties/,
    );
    await rejectsDb(
      owner.productReviewEvent.create({
        data: {
          productId: id,
          action: "CHANGES_REQUESTED",
          productVersion: v + 2,
          actorUserId: reviewer.userId,
        },
      }),
      /ProductReviewEvent_changes_need_reason/,
    );
    // APPROVED must be the current version.
    await rejectsDb(
      owner.product.update({
        where: { id },
        data: {
          status: "APPROVED",
          version: v + 2,
          approvedAt: new Date(),
          approvedById: reviewer.userId,
          approvedVersion: v + 1,
        },
      }),
      /Product_approved_current/,
    );
    await owner.product.update({
      where: { id },
      data: { status: "DRAFT", version: v + 2 },
    });
  });
});

// ------------------------------------------------------------------------------------------
// 4. Edits after review or approval, stale versions, concurrency
// ------------------------------------------------------------------------------------------

describe("4. changes never keep an approval silently", () => {
  it("a master edit, a specification save and an image change each reset the approval", async () => {
    const id = await completeProduct("e", "WF-E");
    const approve = async () => {
      const v = await version(id);
      expect((await pm.post(`/products/${id}/submit`, { version: v })).status).toBe(200);
      expect((await reviewer.post(`/products/${id}/approve`, { version: v + 1 })).status).toBe(200);
    };
    const changes: [string, () => Promise<Res>][] = [
      [
        "master",
        async () =>
          pm.post(`/products/${id}`, {
            version: await version(id),
            code: "WF-E",
            slug: "wf-e",
            name: "Product WF-E (new name)",
            summary: "Summary of WF-E",
            description: "Description of WF-E",
          }),
      ],
      [
        "spec_values",
        async () =>
          pm.post(`/products/${id}/specs`, {
            version: await version(id),
            values: [
              {
                definitionId: kvDef,
                value: { type: "NUMBER", number: 6.2 },
                unit: "mm²/s",
                testMethod: "ASTM D445",
              },
            ],
          }),
      ],
      [
        "image_updated",
        async () => {
          const img = await owner.productImage.findFirstOrThrow({ where: { productId: id } });
          return pm.post(`/images/${img.id}`, { altText: "A new alt text", version: img.version });
        },
      ],
    ];
    for (const [cause, change] of changes) {
      await approve();
      const res = await change();
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const row = await owner.product.findUniqueOrThrow({ where: { id } });
      expect(row.status, cause).toBe("DRAFT");
      expect(row.revisionEditorIds).toEqual([pm.userId]);
      const reset = await lastAudit("catalog.product_review_reset");
      expect(reset?.metadata).toMatchObject({ previousStatus: "APPROVED", cause });
      const wf = await pm.workflow(id);
      expect(wf.history[0]).toMatchObject({ action: "REVIEW_RESET", actor: { id: pm.userId } });
    }
  });

  it("an edit while in review returns it to DRAFT; the reviewer's stale approval fails", async () => {
    const id = P["e"]!;
    const v = await version(id);
    expect((await pm.post(`/products/${id}/submit`, { version: v })).status).toBe(200);
    const edit = await pm.post(`/products/${id}/specs`, {
      version: v + 1,
      values: [
        {
          definitionId: kvDef,
          value: { type: "NUMBER", number: 6.3 },
          unit: "mm²/s",
          testMethod: "ASTM D445",
        },
      ],
    });
    expect(edit.status).toBe(200);
    expect((await owner.product.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
    expectError(
      await reviewer.post(`/products/${id}/approve`, { version: v + 1 }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
  });

  it("concurrent approval and edit: never an APPROVED master that differs from its approval", async () => {
    const id = P["e"]!;
    for (let round = 0; round < 4; round++) {
      const v = await version(id);
      expect((await pm.post(`/products/${id}/submit`, { version: v })).status).toBe(200);
      const [a, e] = await Promise.all([
        reviewer.post(`/products/${id}/approve`, { version: v + 1 }),
        pm.post(`/products/${id}/specs`, {
          version: v + 1,
          values: [
            {
              definitionId: kvDef,
              value: { type: "NUMBER", number: 6 + round / 10 },
              unit: "mm²/s",
              testMethod: "ASTM D445",
            },
          ],
        }),
      ]);
      expect([a.status, e.status].sort()).toEqual(
        a.status === 200 && e.status === 200 ? [200, 200] : [200, 409],
      );
      const row = await owner.product.findUniqueOrThrow({ where: { id } });
      if (row.status === "APPROVED") expect(row.approvedVersion).toBe(row.version);
      // Both succeeded only if the approval came first; then the edit reset it.
      if (a.status === 200 && e.status === 200) expect(row.status).toBe("DRAFT");
      if (row.status !== "DRAFT") {
        await pm.post(`/products/${id}`, {
          version: row.version,
          code: "WF-E",
          slug: "wf-e",
          name: "Product WF-E (new name)",
          summary: "Summary of WF-E",
          description: "Description of WF-E",
        });
      }
    }
  });

  it("two reviewers deciding at once: exactly one wins", async () => {
    const id = P["e"]!;
    const v = await version(id);
    expect((await pm.post(`/products/${id}/submit`, { version: v })).status).toBe(200);
    const [x, y] = await Promise.all([
      reviewer.post(`/products/${id}/approve`, { version: v + 1 }),
      root.post(`/products/${id}/request-changes`, { version: v + 1, comment: "Not yet" }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
  });
});

// ------------------------------------------------------------------------------------------
// 5. Publication per site
// ------------------------------------------------------------------------------------------

describe("5. publication", () => {
  let pv: number;

  it("shows the readiness per site and blocks a product that is not approved", async () => {
    const id = await completeProduct("p", "WF-P");
    const wf = await bvPublisher.workflow(id);
    expect(wf.sites.map((s) => s.siteKey)).toEqual(["BV"]); // only the sites the user may read
    expect(wf.sites[0]).toMatchObject({ canPublish: true, publication: null });
    expect(wf.sites[0]!.readiness.blocking.map((i) => i.code)).toEqual(["not_approved"]);
    expectError(
      await bvPublisher.post(`/products/${id}/publications/${BV}/publish`, {
        version: await version(id),
        listingVersion: await listingVersion(id, BV),
      }),
      409,
      "CONFLICT_STATE",
      { path: "product", rule: "not_approved" },
    );
    const v = await version(id);
    await pm.post(`/products/${id}/submit`, { version: v });
    expect((await reviewer.post(`/products/${id}/approve`, { version: v + 1 })).status).toBe(200);
    pv = v + 2;
  });

  it("needs product:publish of that site (super admin and other sites refused, audited)", async () => {
    const id = P["p"]!;
    const body = { version: pv, listingVersion: await listingVersion(id, BV) };
    for (const s of [root, reviewer, pm, bvEditor, comPublisher, bvReader]) {
      expectError(
        await s.post(`/products/${id}/publications/${BV}/publish`, body),
        403,
        "FORBIDDEN",
      );
    }
    const denied = await owner.auditEvent.findFirst({
      where: { action: "catalog.access_denied", actorUserId: comPublisher.userId },
      orderBy: { occurredAt: "desc" },
    });
    expect(denied).toMatchObject({ outcome: "DENIED", resourceType: "product_publication" });
    expectError(
      await bvPublisher.post(`/products/${id}/publications/not-a-site/publish`, body),
      403,
      "FORBIDDEN",
    );
  });

  it("refuses stale versions and a hidden listing", async () => {
    const id = P["p"]!;
    const lv = await listingVersion(id, BV);
    expectError(
      await bvPublisher.post(`/products/${id}/publications/${BV}/publish`, {
        version: pv - 1,
        listingVersion: lv,
      }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    expectError(
      await bvPublisher.post(`/products/${id}/publications/${BV}/publish`, {
        version: pv,
        listingVersion: lv + 1,
      }),
      409,
      "CONFLICT_STATE",
      { path: "listingVersion", rule: "stale" },
    );
    const hide = await bvEditor.post(`/products/${id}/listings/${BV}`, {
      version: lv,
      categoryId: bvCategory,
      visibility: "HIDDEN",
      title: "WF-P for BV",
    });
    expect(hide.status).toBe(200);
    expectError(
      await bvPublisher.post(`/products/${id}/publications/${BV}/publish`, {
        version: pv,
        listingVersion: lv + 1,
      }),
      409,
      "CONFLICT_STATE",
      { path: "listing", rule: "listing_hidden" },
    );
    expect(
      (
        await bvEditor.post(`/products/${id}/listings/${BV}`, {
          version: lv + 1,
          categoryId: bvCategory,
          visibility: "VISIBLE",
          title: "WF-P for BV",
          summary: "BV summary of WF-P",
        })
      ).status,
    ).toBe(200);
  });

  it("publishes on BV only: snapshot, versions, history, audit; Corporate unaffected", async () => {
    const id = P["p"]!;
    const lv = await listingVersion(id, BV);
    const res = await bvPublisher.post(`/products/${id}/publications/${BV}/publish`, {
      version: pv,
      listingVersion: lv,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const wf = ProductWorkflowResponseSchema.parse(res.body);
    expect(wf.sites[0]).toMatchObject({
      publication: {
        status: "PUBLISHED",
        productVersion: pv,
        listingVersion: lv,
        publishedBy: { id: bvPublisher.userId },
      },
      outdated: { master: false, listing: false },
    });
    expect(wf.history[0]).toMatchObject({ action: "PUBLISHED", siteId: BV, productVersion: pv });
    const row = await owner.productPublication.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: BV } },
    });
    expect(row.snapshot).toMatchObject({
      slug: "wf-p",
      name: "WF-P for BV",
      summary: "BV summary of WF-P",
      category: { slug: "base-oils", name: "Base oils" },
      specs: [
        {
          key: "kv100",
          value: { type: "NUMBER", number: 6.12 },
          unit: "mm²/s",
          testMethod: "ASTM D445",
        },
      ],
    });
    expect(row.imageIds).toHaveLength(1);
    expect(await lastAudit("catalog.product_published")).toMatchObject({
      actorUserId: bvPublisher.userId,
      siteId: BV,
      scopeType: "SITE",
      outcome: "SUCCESS",
    });
    expect(
      await owner.productPublication.findUnique({
        where: { productId_siteId: { productId: id, siteId: COM } },
      }),
    ).toBeNull();
    // The Corporate publisher sees only Corporate, unpublished there.
    const com = await comPublisher.workflow(id);
    expect(com.sites).toEqual([
      expect.objectContaining({ siteKey: "CORPORATE", publication: null }),
    ]);
    expect(com.history.some((e) => e.siteId === BV)).toBe(false);
  });

  it("publishes on Corporate independently, with the Corporate listing's texts", async () => {
    const id = P["p"]!;
    const res = await comPublisher.post(`/products/${id}/publications/${COM}/publish`, {
      version: pv,
      listingVersion: await listingVersion(id, COM),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await owner.productPublication.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: COM } },
    });
    expect(row.snapshot).toMatchObject({ name: "Product WF-P", summary: "Summary of WF-P" });
  });
});

// ------------------------------------------------------------------------------------------
// 6. Public content API
// ------------------------------------------------------------------------------------------

describe("6. public read API", () => {
  it("serves only the key's site, GET only; the admin key has no public routes", async () => {
    expect((await pub("admin", "/products")).status).toBe(404);
    expect((await pub("bv", "/products", "POST")).status).toBe(403); // CSRF: no Origin
    const noKey = await fetch(`${base}/api/v1/public/catalog/products`);
    expect(noKey.status).toBe(404);
    // A site key cannot reach the admin API.
    const adminPath = await fetch(`${base}/api/v1/admin/catalog/context`, {
      headers: { "x-dp-proxy-key": TEST_KEYS.webBv },
    });
    expect(adminPath.status).toBe(404);
  });

  it("lists published, visible products with public fields only", async () => {
    const bv = PublicProductListResponseSchema.parse((await pub("bv", "/products")).body);
    expect(bv.items.map((i) => i.slug)).toEqual(["wf-p"]);
    expect(bv.items[0]).toMatchObject({ name: "WF-P for BV", summary: "BV summary of WF-P" });
    const text = JSON.stringify((await pub("bv", "/products")).body);
    for (const secret of [
      "storageKey",
      "sha256",
      "originalFilename",
      "revisionEditorIds",
      "@staff.dp.test",
      "products/",
    ]) {
      expect(text).not.toContain(secret);
    }
    const com = PublicProductListResponseSchema.parse((await pub("com", "/products")).body);
    expect(com.items.map((i) => i.name)).toEqual(["Product WF-P"]);
  });

  it("DP-160: lists the category tree of live products only, with counts", async () => {
    const bv = PublicCategoryListResponseSchema.parse((await pub("bv", "/categories")).body);
    // one live BV product (wf-p): its category alone, nothing about drafts or empty categories
    expect(bv.items).toHaveLength(1);
    expect(bv.items[0]).toMatchObject({ count: 1, parentSlug: null });
    const one = PublicProductListResponseSchema.parse((await pub("bv", "/products")).body);
    expect(bv.items[0]!.slug).toBe(one.items[0]!.category.slug);
    const text = JSON.stringify(bv);
    expect(text).not.toMatch(/"id"|siteId|isDefault/);
    expect((await pub("admin", "/categories")).status).toBe(404);
  });

  it("serves a product by slug; drafts, approved-but-unpublished and unknown slugs are 404", async () => {
    const one = PublicProductResponseSchema.parse((await pub("bv", "/products/wf-p")).body);
    expect(one.product.specs[0]).toMatchObject({ key: "kv100", unit: "mm²/s" });
    expect(one.product.images).toHaveLength(1);
    for (const slug of ["wf-a", "wf-b", "wf-e", "nope", "WF-P", "..%2Fwf-p"]) {
      expect((await pub("bv", `/products/${slug}`)).status, slug).toBe(404);
    }
  });

  it("serves published images as WebP display/thumb only, never originals or drafts", async () => {
    const id = P["p"]!;
    const img = await owner.productImage.findFirstOrThrow({ where: { productId: id } });
    const d = await pubBytes("bv", `/images/${img.id}/display`);
    expect(d.status).toBe(200);
    expect(d.headers.get("content-type")).toBe("image/webp");
    expect(d.headers.get("x-content-type-options")).toBe("nosniff");
    expect(d.headers.get("cache-control")).toBe("public, max-age=300");
    expect((await sharp(d.body).metadata()).exif).toBeUndefined();
    expect((await pubBytes("bv", `/images/${img.id}/thumb`)).status).toBe(200);
    expect((await pubBytes("bv", `/images/${img.id}/original`)).status).toBe(404);
    // A draft product's image (WF-E has one; never published).
    const draft = await owner.productImage.findFirstOrThrow({ where: { productId: P["e"] } });
    expect((await pubBytes("bv", `/images/${draft.id}/display`)).status).toBe(404);
    expect((await pubBytes("bv", `/images/not-a-uuid/display`)).status).toBe(404);
    // The admin key cannot use the public image route either.
    expect((await pubBytes("admin", `/images/${img.id}/display`)).status).toBe(404);
  });

  it("hiding the listing takes the product off that site at once, and only that site", async () => {
    const id = P["p"]!;
    const lv = await listingVersion(id, BV);
    await bvEditor.post(`/products/${id}/listings/${BV}`, {
      version: lv,
      categoryId: bvCategory,
      visibility: "HIDDEN",
      title: "WF-P for BV",
      summary: "BV summary of WF-P",
    });
    expect(
      PublicProductListResponseSchema.parse((await pub("bv", "/products")).body).items,
    ).toEqual([]);
    expect((await pub("bv", "/products/wf-p")).status).toBe(404);
    const img = await owner.productImage.findFirstOrThrow({ where: { productId: id } });
    expect((await pubBytes("bv", `/images/${img.id}/display`)).status).toBe(404);
    expect((await pub("com", "/products/wf-p")).status).toBe(200);
    await bvEditor.post(`/products/${id}/listings/${BV}`, {
      version: lv + 1,
      categoryId: bvCategory,
      visibility: "VISIBLE",
      title: "WF-P for BV",
      summary: "BV summary of WF-P",
    });
    expect((await pub("bv", "/products/wf-p")).status).toBe(200);
    const wf = await bvPublisher.workflow(id);
    expect(wf.sites[0]!.outdated).toEqual({ master: false, listing: true });
  });
});

// ------------------------------------------------------------------------------------------
// 7. After publication: edits, republish, guards, unpublish
// ------------------------------------------------------------------------------------------

describe("7. after publication", () => {
  it("an edit keeps the live snapshot, revokes the approval and blocks republishing", async () => {
    const id = P["p"]!;
    const res = await pm.post(`/products/${id}`, {
      version: await version(id),
      code: "WF-P",
      slug: "wf-p",
      name: "Product WF-P",
      summary: "Edited summary (not approved)",
      description: "Description of WF-P",
    });
    expect(res.status).toBe(200);
    const live = PublicProductResponseSchema.parse((await pub("com", "/products/wf-p")).body);
    expect(live.product.summary).toBe("Summary of WF-P"); // the approved snapshot
    const wf = await comPublisher.workflow(id);
    expect(wf.status).toBe("DRAFT");
    expect(wf.sites[0]!.outdated.master).toBe(true);
    expectError(
      await comPublisher.post(`/products/${id}/publications/${COM}/publish`, {
        version: await version(id),
        listingVersion: await listingVersion(id, COM),
      }),
      409,
      "CONFLICT_STATE",
      { path: "product", rule: "not_approved" },
    );
  });

  it("republishes after a new approval; the snapshot moves to the new version", async () => {
    const id = P["p"]!;
    const v = await version(id);
    await pm.post(`/products/${id}/submit`, { version: v });
    expect((await reviewer.post(`/products/${id}/approve`, { version: v + 1 })).status).toBe(200);
    const before = await owner.productPublication.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: COM } },
    });
    const res = await comPublisher.post(`/products/${id}/publications/${COM}/publish`, {
      version: v + 2,
      listingVersion: await listingVersion(id, COM),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await owner.productPublication.findUniqueOrThrow({ where: { id: before.id } });
    expect(after).toMatchObject({ productVersion: v + 2, version: before.version + 1 });
    expect(after.publishedAt.getTime()).toBeGreaterThan(before.publishedAt.getTime());
    expect(
      PublicProductResponseSchema.parse((await pub("com", "/products/wf-p")).body).product.summary,
    ).toBe("Edited summary (not approved)");
    // BV still shows its own, older snapshot until BV republishes.
    expect(
      PublicProductResponseSchema.parse((await pub("bv", "/products/wf-p")).body).product.summary,
    ).toBe("BV summary of WF-P");
  });

  it("refuses to archive a published product and to delete a published image", async () => {
    const id = P["p"]!;
    expectError(
      await pm.post(`/products/${id}/archive`, { version: await version(id) }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "published" },
    );
    const img = await owner.productImage.findFirstOrThrow({ where: { productId: id } });
    expectError(await pm.del(`/images/${img.id}`), 409, "CONFLICT_STATE", {
      path: "(root)",
      rule: "image_published",
    });
    expect(await owner.productImage.findUnique({ where: { id: img.id } })).not.toBeNull();
    // Neither refusal changed the approval.
    expect((await owner.product.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");
  });

  it("unpublishes per site with the publication's version; history and row are kept", async () => {
    const id = P["p"]!;
    const row = await owner.productPublication.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: BV } },
    });
    expectError(
      await comPublisher.post(`/products/${id}/publications/${BV}/unpublish`, {
        version: row.version,
      }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await bvPublisher.post(`/products/${id}/publications/${BV}/unpublish`, {
        version: row.version + 1,
      }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    const res = await bvPublisher.post(`/products/${id}/publications/${BV}/unpublish`, {
      version: row.version,
      comment: "Seasonal range",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.sites[0].publication).toMatchObject({
      status: "UNPUBLISHED",
      unpublishedBy: { id: bvPublisher.userId },
    });
    expect(res.body.history[0]).toMatchObject({ action: "UNPUBLISHED", comment: "Seasonal range" });
    expect((await pub("bv", "/products/wf-p")).status).toBe(404);
    expect((await pub("com", "/products/wf-p")).status).toBe(200);
    expectError(
      await bvPublisher.post(`/products/${id}/publications/${BV}/unpublish`, {
        version: row.version + 1,
      }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "not_published" },
    );
    expect(await lastAudit("catalog.product_unpublished")).toMatchObject({
      actorUserId: bvPublisher.userId,
      siteId: BV,
    });
  });

  it("an archived product cannot be published", async () => {
    const id = P["p"]!;
    const com = await owner.productPublication.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: COM } },
    });
    await comPublisher.post(`/products/${id}/publications/${COM}/unpublish`, {
      version: com.version,
    });
    const archived = await pm.post(`/products/${id}/archive`, { version: await version(id) });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expectError(
      await comPublisher.post(`/products/${id}/publications/${COM}/publish`, {
        version: await version(id),
        listingVersion: await listingVersion(id, COM),
      }),
      409,
      "CONFLICT_STATE",
      { path: "product", rule: "archived" },
    );
    expectError(
      await pm.post(`/products/${id}/submit`, { version: await version(id) }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "not_draft" },
    );
    expect(
      PublicProductListResponseSchema.parse((await pub("com", "/products")).body).items,
    ).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------
// 8. Database rules of the history and the publications
// ------------------------------------------------------------------------------------------

describe("8. database rules", () => {
  it("the history is append-only for dp_app and for the owner", async () => {
    const e = await owner.productReviewEvent.findFirstOrThrow();
    await rejectsDb(
      asApp.productReviewEvent.update({ where: { id: e.id }, data: { comment: "rewritten" } }),
      /permission denied/,
    );
    await rejectsDb(asApp.productReviewEvent.delete({ where: { id: e.id } }), /permission denied/);
    await rejectsDb(
      owner.productReviewEvent.update({ where: { id: e.id }, data: { comment: "rewritten" } }),
      /append-only/,
    );
    await rejectsDb(owner.productReviewEvent.delete({ where: { id: e.id } }), /append-only/);
    await rejectsDb(owner.$executeRaw`TRUNCATE "ProductReviewEvent"`, /append-only/);
  });

  it("a snapshot is never edited in place, and publications are never deleted by dp_app", async () => {
    const p = await owner.productPublication.findFirstOrThrow();
    await rejectsDb(
      owner.productPublication.update({
        where: { id: p.id },
        data: { snapshot: { schemaVersion: 1, name: "tampered" } },
      }),
      /replaced only by publishing again/,
    );
    await rejectsDb(
      owner.productPublication.update({
        where: { id: p.id },
        data: { siteId: p.siteId === BV ? COM : BV },
      }),
      /cannot change/,
    );
    await rejectsDb(asApp.productPublication.delete({ where: { id: p.id } }), /permission denied/);
  });

  it("a publication of an unapproved version is refused by the database", async () => {
    const id = P["e"]!; // any state: the published version below is not the approved one
    const listing = await owner.productSiteListing.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: BV } },
    });
    await rejectsDb(
      owner.productPublication.create({
        data: {
          productId: id,
          siteId: BV,
          listingId: listing.id,
          status: "PUBLISHED",
          productVersion: (await version(id)) - 1,
          listingVersion: listing.version,
          snapshot: { schemaVersion: 1 },
          imageIds: [],
          publishedAt: new Date(),
          publishedById: bvPublisher.userId,
        },
      }),
      /only the approved version/,
    );
  });

  it("every transition left an audit event with its permission", async () => {
    for (const action of [
      "catalog.product_submitted",
      "catalog.product_review_withdrawn",
      "catalog.product_approved",
      "catalog.product_changes_requested",
      "catalog.product_review_reset",
      "catalog.product_published",
      "catalog.product_unpublished",
    ]) {
      const e = await lastAudit(action);
      expect(e, action).not.toBeNull();
      expect((e!.metadata as { permission?: string }).permission, action).toMatch(
        /^product(_master)?:(edit|approve|publish)$/,
      );
    }
  });
});

// ------------------------------------------------------------------------------------------
// 9. DP-166: image visibility (hide without deleting)
// ------------------------------------------------------------------------------------------

describe("9. DP-166 image visibility", () => {
  async function addImage(id: string, alt: string): Promise<string> {
    const up = await pm.upload(id, await jpeg(1200, 900, 60 + Math.floor(Math.random() * 120)));
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const res = await pm.post(`/images/${up.body.image.id}`, {
      altText: alt,
      version: up.body.image.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return up.body.image.id as string;
  }
  const imgVersion = async (imageId: string) =>
    (await owner.productImage.findUniqueOrThrow({ where: { id: imageId } })).version;
  async function approveAndPublishBv(id: string): Promise<void> {
    const v = await version(id);
    expect((await pm.post(`/products/${id}/submit`, { version: v })).status).toBe(200);
    expect((await reviewer.post(`/products/${id}/approve`, { version: v + 1 })).status).toBe(200);
    const res = await bvPublisher.post(`/products/${id}/publications/${BV}/publish`, {
      version: v + 2,
      listingVersion: await listingVersion(id, BV),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  it("keeps every image public by default; hides others, never the cover; audited", async () => {
    const id = await completeProduct("vis", "WF-VIS");
    const second = await addImage(id, "Second view");
    const list = await pm.get(`/products/${id}/images`);
    expect(list.body.items.map((i: { isPublic: boolean }) => i.isPublic)).toEqual([true, true]);
    const cover = list.body.items.find((i: { isCover: boolean }) => i.isCover).id as string;

    expectError(
      await pm.post(`/images/${cover}/visibility`, {
        isPublic: false,
        version: await imgVersion(cover),
      }),
      409,
      "CONFLICT_STATE",
      { path: "isPublic", rule: "cover_cannot_be_hidden" },
    );
    // Readers and other sites' staff cannot change it.
    expectError(
      await bvReader.post(`/images/${second}/visibility`, {
        isPublic: false,
        version: await imgVersion(second),
      }),
      403,
      "FORBIDDEN",
    );
    // A stale version is a conflict, never a silent overwrite.
    expectError(
      await pm.post(`/images/${second}/visibility`, {
        isPublic: false,
        version: (await imgVersion(second)) + 5,
      }),
      409,
      "CONFLICT_STATE",
    );

    const before = await version(id);
    const res = await pm.post(`/images/${second}/visibility`, {
      isPublic: false,
      version: await imgVersion(second),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      res.body.items.map((i: { id: string; isPublic: boolean }) => [i.id === second, i.isPublic]),
    ).toEqual(
      expect.arrayContaining([
        [true, false],
        [false, true],
      ]),
    );
    // Part of the reviewed content: the master revision moves on.
    expect(await version(id)).toBeGreaterThan(before);
    expect(await lastAudit("catalog.image_visibility_set")).toMatchObject({
      resourceId: second,
      metadata: expect.objectContaining({ productId: id, isPublic: false }),
    });
    // Idempotent: the same state changes nothing.
    const v = await version(id);
    expect(
      (
        await pm.post(`/images/${second}/visibility`, {
          isPublic: false,
          version: await imgVersion(second),
        })
      ).status,
    ).toBe(200);
    expect(await version(id)).toBe(v);

    // A hidden image cannot become the cover; the database refuses a hidden cover from any writer.
    expectError(
      await pm.post(`/images/${second}/cover`, { version: await imgVersion(second) }),
      409,
      "CONFLICT_STATE",
      { path: "isPublic", rule: "hidden_image" },
    );
    await rejectsDb(
      owner.productImage.update({ where: { id: cover }, data: { isPublic: false } }),
      /ProductImage_cover_public/,
    );
    // The hidden image stays in the admin: its file is still served to catalogue readers.
    expect((await pm.get(`/images/${second}/thumb`)).status).toBe(200);
  });

  it("publication leaves hidden images out; live content waits for a new publication", async () => {
    const id = P["vis"]!;
    const hidden = (
      await owner.productImage.findFirstOrThrow({
        where: { productId: id, isPublic: false },
      })
    ).id;
    await approveAndPublishBv(id);
    const pubRow = await owner.productPublication.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: BV } },
    });
    expect(pubRow.imageIds).not.toContain(hidden);
    expect(pubRow.imageIds).toHaveLength(1);
    const live = PublicProductResponseSchema.parse((await pub("bv", "/products/wf-vis")).body);
    expect(live.product.images.map((i) => i.id)).toEqual([pubRow.imageIds[0]]);
    expect((await pubBytes("bv", `/images/${hidden}/thumb`)).status).toBe(404);
    expect((await pubBytes("bv", `/images/${pubRow.imageIds[0]}/thumb`)).status).toBe(200);

    // Showing it again (the rollback) does not change the live page until it is republished.
    const show = await pm.post(`/images/${hidden}/visibility`, {
      isPublic: true,
      version: await imgVersion(hidden),
    });
    expect(show.status, JSON.stringify(show.body)).toBe(200);
    expect(
      PublicProductResponseSchema.parse((await pub("bv", "/products/wf-vis")).body).product.images,
    ).toHaveLength(1);
    expect((await owner.product.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");

    await approveAndPublishBv(id);
    const after = PublicProductResponseSchema.parse((await pub("bv", "/products/wf-vis")).body);
    expect(after.product.images.map((i) => i.id)).toContain(hidden);
    expect((await pubBytes("bv", `/images/${hidden}/thumb`)).status).toBe(200);

    // Hiding a published image keeps the live snapshot (and its file) until the next publication.
    const hide = await pm.post(`/images/${hidden}/visibility`, {
      isPublic: false,
      version: await imgVersion(hidden),
    });
    expect(hide.status, JSON.stringify(hide.body)).toBe(200);
    expect(
      PublicProductResponseSchema.parse((await pub("bv", "/products/wf-vis")).body).product.images,
    ).toHaveLength(2);
    expect((await pubBytes("bv", `/images/${hidden}/thumb`)).status).toBe(200);
  });

  it("removing the cover promotes the next public image, never a hidden one", async () => {
    const id = await completeProduct("vis2", "WF-VIS2");
    const hidden = await addImage(id, "Hidden view");
    const visible = await addImage(id, "Visible view");
    expect(
      (
        await pm.post(`/images/${hidden}/visibility`, {
          isPublic: false,
          version: await imgVersion(hidden),
        })
      ).status,
    ).toBe(200);
    const cover = (
      await owner.productImage.findFirstOrThrow({ where: { productId: id, isCover: true } })
    ).id;
    expect((await pm.del(`/images/${cover}`)).status).toBe(204);
    const rows = await owner.productImage.findMany({ where: { productId: id } });
    expect(rows.find((r) => r.id === visible)).toMatchObject({ isCover: true, isPublic: true });
    expect(rows.find((r) => r.id === hidden)).toMatchObject({ isCover: false, isPublic: false });
  });
});
