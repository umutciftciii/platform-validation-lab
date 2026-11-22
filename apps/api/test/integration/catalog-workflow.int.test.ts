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
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
import {
  CatalogPreviewLinkResponseSchema,
  CatalogPreviewListResponseSchema,
  CatalogPreviewProductResponseSchema,
  ErrorBodySchema,
  ProposalContextResponseSchema,
  ProposalListResponseSchema,
  ProposalResponseSchema,
  ProductWorkflowResponseSchema,
  PublicCategoryListResponseSchema,
  PublicProductListResponseSchema,
  PublicProductResponseSchema,
  ReviewQueueResponseSchema,
  PublicSeoResolveResponseSchema,
  PublicSitemapResponseSchema,
  ListingSeoResponseSchema,
  SeoOverviewResponseSchema,
  localizeSnapshot,
  parseStoredSnapshot,
  ProductTranslationsResponseSchema,
  CategoryTranslationListResponseSchema,
  PublicationPreviewResponseSchema,
  SpecDefinitionTranslationListResponseSchema,
  readSnapshot,
  snapshotCoverage,
} from "@dream/contracts";
import { assertTestDatabaseUrl } from "@dream/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { issueCatalogPreviewToken } from "../../src/catalog/preview-token.js";
import { adminApi } from "../../src/catalog/import/client.js";
import { runApplyText, textSha256 } from "../../src/catalog/proposals/apply-text.js";
import { parseHmacKey } from "../../src/iam/auth/secrets.js";
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
    readonly token: string,
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
  /** DP-171: a GET outside the catalogue routes (e.g. /api/v1/admin/leads). */
  async getAbs(p: string): Promise<Res> {
    return parse(await fetch(`${base}${p}`, { headers: this.headers() }));
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
/** DP-207: the technical SEO reads of a site (existence check, sitemap). */
async function seo(site: Site, p: string): Promise<Res> {
  return parse(
    await fetch(`${base}/api/v1/public/seo${p}`, { headers: { "x-dp-proxy-key": KEY[site] } }),
  );
}
const sitemapPaths = async (site: Site) =>
  PublicSitemapResponseSchema.parse((await seo(site, "/sitemap")).body).entries.map((e) => e.path);
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

/** contracts proposalContentKey, hashed like the API (DP-171/DP-191). */
const textSha = (summary: string | null, description: string | null) =>
  createHash("sha256")
    .update(`${summary ?? ""}\u0000${description ?? ""}`, "utf8")
    .digest("hex");

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
    // ML-8a: a new publication is a v2 snapshot; its English view is what v1 held.
    expect(row.snapshot).toMatchObject({ schemaVersion: 2, defaultLocale: "en" });
    expect(Object.keys((row.snapshot as { locales: object }).locales)).toEqual(["en"]);
    expect(readSnapshot(row.snapshot, "en")).toMatchObject({
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
    expect(readSnapshot(row.snapshot, "en")).toMatchObject({
      name: "Product WF-P",
      summary: "Summary of WF-P",
    });
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

  it("DP-207: resolves and lists the live products only, per site", async () => {
    const live = await seo("bv", "/resolve?path=/products/wf-p");
    expect(live.status, JSON.stringify(live.body)).toBe(200);
    expect(PublicSeoResolveResponseSchema.parse(live.body)).toEqual({
      path: "/products/wf-p",
      kind: "product",
    });
    for (const slug of ["wf-a", "wf-b", "wf-e", "nope", "WF-P"]) {
      expect((await seo("bv", `/resolve?path=/products/${slug}`)).status, slug).toBe(404);
    }
    const bv = await sitemapPaths("bv");
    expect(bv).toEqual(expect.arrayContaining(["/products", "/products/wf-p"]));
    for (const slug of ["wf-a", "wf-b", "wf-e"]) expect(bv).not.toContain(`/products/${slug}`);
    const entry = PublicSitemapResponseSchema.parse(
      (await seo("bv", "/sitemap")).body,
    ).entries.find((e) => e.path === "/products/wf-p");
    expect(entry).toMatchObject({ kind: "product", lastModified: expect.any(String) });
    expect((await seo("admin", "/sitemap")).status).toBe(404);
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
    // DP-207: a hidden listing is no address of the site any more (real 404, out of the sitemap).
    expect((await seo("bv", "/resolve?path=/products/wf-p")).status).toBe(404);
    expect(await sitemapPaths("bv")).not.toContain("/products/wf-p");
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

// ------------------------------------------------------------------------------------------
// 10. DP-171 (ADR-022): content proposals and the company review
// ------------------------------------------------------------------------------------------

describe("10. DP-171 content proposals", () => {
  let companyBv: Staff; // company_content_reviewer @ BV
  let companyCom: Staff; // company_content_reviewer @ CORPORATE
  let productId: string;
  let unlisted: string; // a product without a BV listing
  let proposalId: string;
  let before: string; // product, listing, texts, specs, images and publications before section 10

  const reviewData = {
    schemaVersion: 1,
    family: "Group II base oil",
    items: [
      {
        kind: "DP002_HELD",
        field: "spec:pour_point",
        text: "Two pour point limits on one page.",
        sourceIds: ["S1"],
        heldValue: {
          definition: "pour_point",
          basis: "SPECIFICATION",
          raw: "Pour point, max: Minus 15 °C [GOST 20287]",
          conflict: true,
          finding: null,
        },
      },
      {
        kind: "CONFIRM",
        field: "packaging",
        text: "Packaging options.",
        sourceIds: [],
        heldValue: null,
      },
    ],
    sources: [{ id: "S1", title: "GOST 20287-91", url: null, level: "B", documentDate: "1991" }],
  };
  const body = (extra: Record<string, unknown> = {}) => ({
    productId,
    locale: "en",
    summary: "Group II base oil for lubricant blending.",
    description: "A base oil offered as a blending component for lubricant manufacturers.",
    reviewData,
    sourceRef: "docs/catalog/proposals/test.json",
    sourceSha256: "b".repeat(64),
    ...extra,
  });

  async function fingerprint(): Promise<string> {
    const ids = [productId, unlisted];
    const [products, listings, texts, specs, images, publications, reviews] = await Promise.all([
      owner.product.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } }),
      owner.productSiteListing.findMany({
        where: { productId: { in: ids } },
        orderBy: { id: "asc" },
      }),
      owner.productListingText.findMany({ orderBy: [{ listingId: "asc" }, { locale: "asc" }] }),
      owner.productSpecValue.findMany({
        where: { productId: { in: ids } },
        orderBy: { id: "asc" },
      }),
      owner.productImage.findMany({ where: { productId: { in: ids } }, orderBy: { id: "asc" } }),
      owner.productPublication.findMany({ orderBy: { id: "asc" } }),
      owner.productReviewEvent.findMany({
        where: { productId: { in: ids } },
        orderBy: { id: "asc" },
      }),
    ]);
    return createHash("sha256")
      .update(JSON.stringify({ products, listings, texts, specs, images, publications, reviews }))
      .digest("hex");
  }

  async function proposal(who: Staff = bvEditor) {
    const res = await who.get(`/proposals/${proposalId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return ProposalResponseSchema.parse(res.body);
  }

  beforeAll(async () => {
    companyBv = await staff(
      "company-bv",
      [{ role: "company_content_reviewer", site: BV }],
      root.userId,
    );
    companyCom = await staff(
      "company-com",
      [{ role: "company_content_reviewer", site: COM }],
      root.userId,
    );
    productId = await completeProduct("proposal", "DP171-A");
    const u = await pm.post("/products", { code: "DP171-B", slug: "dp171-b", name: "Unlisted" });
    expect(u.status, JSON.stringify(u.body)).toBe(201);
    unlisted = u.body.product.id;
    before = await fingerprint();
  });

  it("creates a proposal with product:edit only; CREATED event, audit, one per product and locale", async () => {
    expectError(await companyBv.post(`/sites/${BV}/proposals`, body()), 403, "FORBIDDEN");
    expectError(await bvReader.post(`/sites/${BV}/proposals`, body()), 403, "FORBIDDEN");
    expectError(await bvEditor.post(`/sites/${COM}/proposals`, body()), 403, "FORBIDDEN");
    const bad = await bvEditor.post(
      `/sites/${BV}/proposals`,
      body({ summary: "Text [CONFIRM: TDS]" }),
    );
    expectError(bad, 400, "VALIDATION_FAILED");
    expectError(
      await bvEditor.post(`/sites/${BV}/proposals`, body({ productId: unlisted })),
      409,
      "CONFLICT_STATE",
      { path: "productId", rule: "listing_missing" },
    );
    const res = await bvEditor.post(`/sites/${BV}/proposals`, body());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const p = ProposalResponseSchema.parse(res.body);
    proposalId = p.proposal.id;
    expect(p.proposal).toMatchObject({
      status: "REVIEW_PENDING",
      version: 1,
      productCode: "DP171-A",
    });
    expect(p.proposal.authors.map((a) => a.id)).toEqual([bvEditor.userId]);
    expect(p.events.map((e) => [e.action, e.proposalVersion])).toEqual([["CREATED", 1]]);
    expect(p.canDecide).toBe(false);
    expect(p.decisionBlocked).toBe("no_permission");
    expect((await lastAudit("catalog.proposal_created"))?.actorUserId).toBe(bvEditor.userId);
    expectError(await bvEditor.post(`/sites/${BV}/proposals`, body()), 409, "CONFLICT_STATE", {
      path: "productId",
      rule: "unique",
    });
  });

  it("DP-172: tells the console who is a review-only company reviewer", async () => {
    const ctx = async (who: Staff) => {
      const r = await who.get("/proposals/context");
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return ProposalContextResponseSchema.parse(r.body);
    };
    const company = await ctx(companyBv);
    expect(company.reviewOnly).toBe(true);
    expect(company.sites.find((x) => x.id === BV)).toMatchObject({
      canRead: true,
      canReview: true,
      canRevise: false,
    });
    expect(company.sites.find((x) => x.id === COM)).toMatchObject({
      canRead: false,
      canReview: false,
    });
    expect((await ctx(bvEditor)).reviewOnly).toBe(false);
    expect((await ctx(bvReader)).reviewOnly).toBe(false);
    expect((await ctx(root)).reviewOnly).toBe(false);
    const none = await ctx(nobody);
    expect(none.reviewOnly).toBe(false);
    expect(none.sites.every((x) => !x.canRead && !x.canReview)).toBe(true);
  });

  it("reads proposals only within the reader's sites", async () => {
    const list = await companyBv.get(`/proposals?siteId=${BV}`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const parsed = ProposalListResponseSchema.parse(list.body);
    expect(parsed.proposals.map((p) => p.productCode)).toEqual(["DP171-A"]);
    expect(parsed.proposals[0]?.itemCounts.DP002_HELD).toBe(1);
    expect(parsed.counts.REVIEW_PENDING).toBe(1);
    const own = await proposal(companyBv);
    expect(own.canDecide).toBe(true);
    expect(own.canRevise).toBe(false);
    expectError(await companyCom.get(`/proposals/${proposalId}`), 404, "NOT_FOUND");
    const comList = await companyCom.get(`/proposals`);
    expect(ProposalListResponseSchema.parse(comList.body).proposals).toEqual([]);
    expectError(await companyCom.get(`/proposals?siteId=${BV}`), 403, "FORBIDDEN");
    expectError(await nobody.get(`/proposals`), 403, "FORBIDDEN");
  });

  it("requests changes with a reason, the editor revises, the company approves", async () => {
    expectError(
      await companyBv.post(`/proposals/${proposalId}/request-changes`, {
        version: 1,
        comment: " ",
      }),
      400,
      "VALIDATION_FAILED",
    );
    const rc = await companyBv.post(`/proposals/${proposalId}/request-changes`, {
      version: 1,
      comment: "Please drop the second sentence.",
    });
    expect(rc.status, JSON.stringify(rc.body)).toBe(200);
    expect(ProposalResponseSchema.parse(rc.body).proposal).toMatchObject({
      status: "CHANGES_REQUESTED",
      version: 2,
    });
    expectError(
      await companyBv.post(`/proposals/${proposalId}/approve`, { version: 2 }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "not_in_review" },
    );
    expectError(
      await companyBv.post(`/proposals/${proposalId}/revise`, {
        ...body(),
        productId: undefined,
        version: 2,
      }),
      403,
      "FORBIDDEN",
    );
    const rev = await bvEditor.post(`/proposals/${proposalId}/revise`, {
      version: 2,
      summary: "Group II base oil for lubricant blending.",
      description: "A base oil for lubricant manufacturers.",
      reviewData,
      sourceRef: "docs/catalog/proposals/test.json",
      sourceSha256: "b".repeat(64),
      comment: "Second sentence removed.",
    });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    const revised = ProposalResponseSchema.parse(rev.body);
    expect(revised.proposal).toMatchObject({
      status: "REVIEW_PENDING",
      version: 3,
      decidedBy: null,
    });
    expectError(
      await companyBv.post(`/proposals/${proposalId}/approve`, { version: 2 }),
      409,
      "CONFLICT_STATE",
    );
    const ok = await companyBv.post(`/proposals/${proposalId}/approve`, { version: 3 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const approved = ProposalResponseSchema.parse(ok.body);
    expect(approved.proposal).toMatchObject({ status: "APPROVED", version: 4 });
    expect(approved.proposal.decidedBy?.id).toBe(companyBv.userId);
    expect(approved.events.map((e) => e.action)).toEqual([
      "CREATED",
      "CHANGES_REQUESTED",
      "REVISED",
      "APPROVED",
    ]);
    expect(approved.events.every((e) => e.createdAt && e.actor.id)).toBe(true);
    const audit = await lastAudit("catalog.proposal_approved");
    expect(audit).toMatchObject({ actorUserId: companyBv.userId, siteId: BV, outcome: "SUCCESS" });
  });

  it("an author cannot decide on the revision (403, audited); the database refuses it too", async () => {
    const rev = await root.post(`/proposals/${proposalId}/revise`, {
      version: 4,
      summary: "Group II base oil for lubricant blending.",
      description: "A base oil for lubricant manufacturers and blenders.",
      reviewData,
      sourceRef: "manual",
      sourceSha256: "c".repeat(64),
    });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    expect(ProposalResponseSchema.parse(rev.body).proposal.status).toBe("REVIEW_PENDING");
    expectError(
      await root.post(`/proposals/${proposalId}/approve`, { version: 5 }),
      403,
      "FORBIDDEN",
      {
        path: "(root)",
        rule: "own_change",
      },
    );
    const denied = await owner.auditEvent.findFirst({
      where: {
        action: "catalog.access_denied",
        actorUserId: root.userId,
        reason: "separation_of_duties",
      },
      orderBy: { occurredAt: "desc" },
    });
    expect(denied?.resourceId).toBe(proposalId);
    await rejectsDb(
      asApp.productContentProposal.update({
        where: { id: proposalId },
        data: {
          status: "APPROVED",
          version: 6,
          decidedAt: new Date(),
          decidedById: bvEditor.userId,
        },
      }),
      /separation of duties/,
    );
    await rejectsDb(
      asApp.productContentProposalEvent.create({
        data: {
          proposalId,
          siteId: BV,
          action: "APPROVED",
          proposalVersion: 6,
          actorUserId: root.userId,
          contentSha256: "d".repeat(64),
        },
      }),
      /separation of duties/,
    );
    const p = await proposal();
    expect(p.proposal.status).toBe("REVIEW_PENDING");
  });

  it("a company approval changes nothing in the product, its listing, data or publications", async () => {
    const ok = await companyBv.post(`/proposals/${proposalId}/approve`, { version: 5 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await fingerprint()).toBe(before);
    const wf = await bvEditor.workflow(productId);
    expect(wf.status).toBe("DRAFT");
    const live = await pub("bv", "/products");
    expect(live.body.items.map((p: { code: string }) => p.code)).not.toContain("DP171-A");
  });

  it("the company reviewer cannot edit, approve technical data, publish or reach other modules", async () => {
    const v = await version(productId);
    expectError(
      await companyBv.post(`/products/${productId}/submit`, { version: v }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await companyBv.post(`/products/${productId}/approve`, { version: v }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await companyBv.post(`/products/${productId}/publications/${BV}/publish`, {
        version: v,
        listingVersion: await listingVersion(productId, BV),
      }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await companyBv.post(`/products/${productId}/listings/${BV}`, {
        version: await listingVersion(productId, BV),
        categoryId: bvCategory,
        visibility: "VISIBLE",
        title: "Changed",
      }),
      403,
      "FORBIDDEN",
    );
    // Lead/CRM data, staff administration and CMS pages are refused; the CMS context lists no site.
    for (const p of [
      "/api/v1/admin/leads",
      "/api/v1/admin/staff",
      `/api/v1/admin/cms/sites/${BV}/pages`,
    ]) {
      const r = await companyBv.getAbs(p);
      expect(r.status, `${p} -> ${r.status}`).toBe(403);
    }
    const cms = await companyBv.getAbs("/api/v1/admin/cms/context");
    expect(cms.body.sites).toEqual([]);
    expect(await fingerprint()).toBe(before);
  });

  it("keeps the history append-only and proposals undeletable; formats are checked", async () => {
    await rejectsDb(
      asApp.productContentProposalEvent.updateMany({
        where: { proposalId },
        data: { comment: "x" },
      }),
      /permission denied/,
    );
    await rejectsDb(
      owner.productContentProposalEvent.updateMany({
        where: { proposalId },
        data: { comment: "x" },
      }),
      /append-only/,
    );
    await rejectsDb(
      owner.productContentProposalEvent.deleteMany({ where: { proposalId } }),
      /append-only/,
    );
    await rejectsDb(
      asApp.productContentProposal.delete({ where: { id: proposalId } }),
      /permission denied/,
    );
    // A pending revision, so that the guards pass and the CHECK itself refuses the event.
    const cur = await proposal();
    const rev = await bvEditor.post(`/proposals/${proposalId}/revise`, {
      version: cur.proposal.version,
      summary: cur.proposal.summary,
      description: "A base oil for lubricant manufacturers.",
      reviewData,
      sourceRef: "manual",
      sourceSha256: "c".repeat(64),
    });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    const pendingText = {
      summary: cur.proposal.summary,
      description: "A base oil for lubricant manufacturers.",
    };
    await rejectsDb(
      owner.productContentProposalEvent.create({
        data: {
          proposalId,
          siteId: BV,
          action: "CHANGES_REQUESTED",
          proposalVersion: cur.proposal.version + 2,
          actorUserId: companyBv.userId,
          contentSha256: textSha(pendingText.summary, pendingText.description),
          textRecorded: true,
          ...pendingText,
        },
      }),
      /changes_need_comment|check constraint/,
    );
    await rejectsDb(
      owner.productContentProposal.create({
        data: {
          productId: unlisted,
          siteId: BV,
          locale: "en",
          proposedSummary: "Hidden [CONFIRM: x]",
          reviewData: {},
          sourceRef: "manual",
          sourceSha256: "f".repeat(64),
          authorIds: [root.userId],
          createdById: root.userId,
        },
      }),
      /no_review_markers|check constraint/,
    );
    const events = await owner.productContentProposalEvent.count({ where: { proposalId } });
    expect(events).toBe(7);
  });

  it("resubmits unchanged content after a request for changes, then the company approves", async () => {
    const pending = await proposal();
    expect(pending.proposal.status).toBe("REVIEW_PENDING");
    const rc = await companyBv.post(`/proposals/${proposalId}/request-changes`, {
      version: pending.proposal.version,
      comment: "Please check the wording once more.",
    });
    expect(rc.status, JSON.stringify(rc.body)).toBe(200);
    const asked = ProposalResponseSchema.parse(rc.body).proposal;
    const same = await bvEditor.post(`/proposals/${proposalId}/revise`, {
      version: asked.version,
      summary: asked.summary,
      description: asked.description,
      reviewData: asked.reviewData,
      sourceRef: asked.sourceRef,
      sourceSha256: asked.sourceSha256,
      comment: "Wording checked; no change needed.",
    });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    const resubmitted = ProposalResponseSchema.parse(same.body);
    expect(resubmitted.proposal).toMatchObject({ status: "REVIEW_PENDING", decidedBy: null });
    expect(resubmitted.events.at(-1)?.contentSha256).toBe(resubmitted.events.at(-2)?.contentSha256);
    const ok = await companyBv.post(`/proposals/${proposalId}/approve`, {
      version: resubmitted.proposal.version,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ProposalResponseSchema.parse(ok.body).proposal.status).toBe("APPROVED");
    expect(await fingerprint()).toBe(before);
  });
});

// ------------------------------------------------------------------------------------------
// 10b. DP-191: editing the proposed text; every version keeps its text
// ------------------------------------------------------------------------------------------

describe("10b. DP-191 proposal text editing and history", () => {
  let companyBv: Staff;
  let productId: string;
  let proposalId: string;
  let before: string;

  // Review data close to the largest BV proposal (ICCSYN-6-G3P, ~14.8 KB): with it, the full
  // revision body of an 8,000-character description is over the 16 KiB request limit.
  const bigReviewData = {
    schemaVersion: 1,
    language: "en",
    family: "Group III+ base oil",
    items: Array.from({ length: 22 }, (_, i) => ({
      kind: "DP002_HELD",
      field: `spec:held_${i}`,
      text: `Held value ${i}: ${"two limits on one page, the source shows both. ".repeat(6)}`,
      sourceIds: ["S1"],
      heldValue: {
        definition: `held_${i}`,
        basis: "SPECIFICATION",
        raw: `Property ${i}, max: ${"value as printed on the source page ".repeat(4)}`,
        conflict: i % 2 === 0,
        finding: null,
      },
    })),
    sources: [{ id: "S1", title: "Source page", url: null, level: "D", documentDate: null }],
  };
  const original = {
    summary: "Group III+ base oil for synthetic blends.",
    description: "A base oil for lubricant blenders.",
  };

  async function read(who: Staff = bvEditor) {
    const res = await who.get(`/proposals/${proposalId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return ProposalResponseSchema.parse(res.body);
  }

  async function stored() {
    return owner.productContentProposal.findUniqueOrThrow({
      where: { id: proposalId },
      select: { reviewData: true, sourceRef: true, sourceSha256: true },
    });
  }

  beforeAll(async () => {
    companyBv = await staff(
      "company-bv-191",
      [{ role: "company_content_reviewer", site: BV }],
      root.userId,
    );
    productId = await completeProduct("dp191", "DP191-A");
    const res = await bvEditor.post(`/sites/${BV}/proposals`, {
      productId,
      locale: "en",
      ...original,
      reviewData: bigReviewData,
      sourceRef: "docs/catalog/proposals/test.json",
      sourceSha256: "d".repeat(64),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    proposalId = ProposalResponseSchema.parse(res.body).proposal.id;
    before = JSON.stringify(await stored());
  });

  it("records the text of the CREATED event", async () => {
    const { events } = await read();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "CREATED", textRecorded: true, ...original });
    expect(events[0]?.contentSha256).toBe(textSha(original.summary, original.description));
  });

  it("revises only the text it sends; review data and source stay as they are", async () => {
    const res = await bvEditor.post(`/proposals/${proposalId}/revise`, {
      version: 1,
      description: "A base oil for lubricant blenders and grease makers.",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = ProposalResponseSchema.parse(res.body);
    expect(r.proposal).toMatchObject({
      version: 2,
      status: "REVIEW_PENDING",
      summary: original.summary,
      description: "A base oil for lubricant blenders and grease makers.",
    });
    expect(JSON.stringify(await stored())).toBe(before);
    expect(r.events.map((e) => [e.action, e.proposalVersion, e.description])).toEqual([
      ["CREATED", 1, original.description],
      ["REVISED", 2, "A base oil for lubricant blenders and grease makers."],
    ]);
    const audit = await lastAudit("catalog.proposal_revised");
    expect(audit?.metadata).toMatchObject({ version: 2, fields: ["description"] });
  });

  it("saves an 8,000-character description although the full body would be over 16 KiB", async () => {
    const long = `${"Base oil text. ".repeat(533)}End.`.slice(0, 8000).trim();
    expect(long.length).toBeGreaterThan(7990);
    const fullBody = {
      version: 2,
      summary: original.summary,
      description: long,
      reviewData: bigReviewData,
      sourceRef: "docs/catalog/proposals/test.json",
      sourceSha256: "d".repeat(64),
    };
    expect(Buffer.byteLength(JSON.stringify(fullBody))).toBeGreaterThan(16 * 1024);
    expectError(
      await bvEditor.post(`/proposals/${proposalId}/revise`, fullBody),
      413,
      "PAYLOAD_TOO_LARGE",
    );
    const res = await bvEditor.post(`/proposals/${proposalId}/revise`, {
      version: 2,
      description: long,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = ProposalResponseSchema.parse(res.body);
    expect(r.proposal.description).toBe(long);
    expect(r.events.at(-1)).toMatchObject({ proposalVersion: 3, description: long });
    expect(JSON.stringify(await stored())).toBe(before);
  });

  it("keeps null apart from a left-out field", async () => {
    // null review data, source or hash is invalid, never "keep".
    for (const field of ["reviewData", "sourceRef", "sourceSha256"]) {
      expectError(
        await bvEditor.post(`/proposals/${proposalId}/revise`, { version: 3, [field]: null }),
        400,
        "VALIDATION_FAILED",
      );
    }
    // null clears a text; the other text is kept.
    const res = await bvEditor.post(`/proposals/${proposalId}/revise`, {
      version: 3,
      summary: null,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = ProposalResponseSchema.parse(res.body);
    expect(r.proposal.summary).toBeNull();
    expect(r.proposal.description?.length).toBeGreaterThan(7990);
    const filled = await bvEditor.post(`/proposals/${proposalId}/revise`, {
      version: 4,
      summary: original.summary,
      description: original.description,
    });
    expect(filled.status, JSON.stringify(filled.body)).toBe(200);
  });

  it("refuses a stale version and keeps the newer text", async () => {
    const cur = (await read()).proposal;
    expectError(
      await bvEditor.post(`/proposals/${proposalId}/revise`, {
        version: cur.version - 1,
        description: "An older edit.",
      }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    expect((await read()).proposal).toMatchObject({
      version: cur.version,
      description: cur.description,
    });
  });

  it("only product:edit of the site may revise; the author still cannot approve", async () => {
    const cur = (await read()).proposal;
    const body = { version: cur.version, description: "Not allowed." };
    expectError(await companyBv.post(`/proposals/${proposalId}/revise`, body), 403, "FORBIDDEN");
    expectError(await bvReader.post(`/proposals/${proposalId}/revise`, body), 403, "FORBIDDEN");
    expectError(await nobody.post(`/proposals/${proposalId}/revise`, body), 404, "NOT_FOUND");
    // The super admin edits with its own account and becomes an author of the revision.
    const own = await root.post(`/proposals/${proposalId}/revise`, {
      version: cur.version,
      summary: "Group III+ base oil for synthetic lubricant blends.",
    });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    const mine = ProposalResponseSchema.parse(own.body);
    expect(mine.proposal.authors.map((a) => a.id)).toContain(root.userId);
    expectError(
      await root.post(`/proposals/${proposalId}/approve`, { version: mine.proposal.version }),
      403,
      "FORBIDDEN",
      { path: "(root)", rule: "own_change" },
    );
    expect((await read(root)).canDecide).toBe(false);
    const ok = await companyBv.post(`/proposals/${proposalId}/approve`, {
      version: mine.proposal.version,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const approved = ProposalResponseSchema.parse(ok.body);
    expect(approved.events.at(-1)).toMatchObject({
      action: "APPROVED",
      textRecorded: true,
      summary: "Group III+ base oil for synthetic lubricant blends.",
      description: original.description,
    });
  });

  it("keeps every earlier text in the history", async () => {
    const { events } = await read();
    expect(events.every((e) => e.textRecorded)).toBe(true);
    expect(events.map((e) => e.proposalVersion)).toEqual(events.map((_, i) => i + 1));
    for (const e of events) expect(e.contentSha256).toBe(textSha(e.summary, e.description));
    expect(new Set(events.map((e) => e.contentSha256)).size).toBeGreaterThanOrEqual(5);
  });

  it("the database refuses an event without its text, with another text or another version's text", async () => {
    const cur = (await read()).proposal;
    const base = {
      proposalId,
      siteId: BV,
      action: "REVISED" as const,
      proposalVersion: cur.version + 1,
      actorUserId: bvEditor.userId,
    };
    await rejectsDb(
      owner.productContentProposalEvent.create({
        data: { ...base, contentSha256: textSha(cur.summary, cur.description) },
      }),
      /records the text of its version/,
    );
    await rejectsDb(
      owner.productContentProposalEvent.create({
        data: {
          ...base,
          contentSha256: textSha(cur.summary, cur.description),
          textRecorded: true,
          summary: cur.summary,
          description: "Another text.",
        },
      }),
      /text_matches_hash|check constraint/,
    );
    await rejectsDb(
      owner.productContentProposalEvent.create({
        data: {
          ...base,
          contentSha256: textSha(null, null),
          textRecorded: false,
          summary: "Unrecorded text.",
        },
      }),
      /unrecorded_text_empty|check constraint/,
    );
    // A request for changes on a pending revision must record exactly the pending text.
    const rev = await bvEditor.post(`/proposals/${proposalId}/revise`, {
      version: cur.version,
      description: "Pending text.",
    });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    const pending = ProposalResponseSchema.parse(rev.body).proposal;
    await rejectsDb(
      owner.productContentProposalEvent.create({
        data: {
          proposalId,
          siteId: BV,
          action: "CHANGES_REQUESTED",
          proposalVersion: pending.version + 1,
          actorUserId: companyBv.userId,
          comment: "Please shorten it.",
          contentSha256: textSha(original.summary, original.description),
          textRecorded: true,
          ...original,
        },
      }),
      /records the text it decides on/,
    );
    await rejectsDb(
      asApp.productContentProposalEvent.updateMany({
        where: { proposalId },
        data: { description: "Rewritten history." },
      }),
      /permission denied/,
    );
    await rejectsDb(
      owner.productContentProposalEvent.updateMany({
        where: { proposalId },
        data: { description: "Rewritten history." },
      }),
      /append-only/,
    );
  });
});

// ------------------------------------------------------------------------------------------
// 11. DP-173 (ADR-022 D5): the company catalogue preview
// ------------------------------------------------------------------------------------------

describe("11. DP-173 catalogue preview", () => {
  let company: Staff; // company_content_reviewer @ BV
  let companyCom: Staff; // company_content_reviewer @ CORPORATE
  let productId: string;
  let token: string;
  let before: string;

  const heldItem = {
    kind: "DP002_HELD",
    field: "spec:pour_point",
    text: "DP-002: held value.",
    sourceIds: [],
    heldValue: {
      definition: "pour_point",
      basis: "SPECIFICATION",
      raw: "Pour Point, max: Minus 15 °C [GOST 20287]",
      conflict: true,
      finding: "Method letter not stated.",
    },
  };

  async function fingerprint(): Promise<string> {
    const [products, listings, texts, specs, images, publications, reviews, proposals] =
      await Promise.all([
        owner.product.findMany({ orderBy: { id: "asc" } }),
        owner.productSiteListing.findMany({ orderBy: { id: "asc" } }),
        owner.productListingText.findMany({ orderBy: [{ listingId: "asc" }, { locale: "asc" }] }),
        owner.productSpecValue.findMany({ orderBy: { id: "asc" } }),
        owner.productImage.findMany({ orderBy: { id: "asc" } }),
        owner.productPublication.findMany({ orderBy: { id: "asc" } }),
        owner.productReviewEvent.findMany({ orderBy: { id: "asc" } }),
        owner.productContentProposal.findMany({ orderBy: { id: "asc" } }),
      ]);
    return createHash("sha256")
      .update(
        JSON.stringify({
          products,
          listings,
          texts,
          specs,
          images,
          publications,
          reviews,
          proposals,
        }),
      )
      .digest("hex");
  }

  const preview = (site: Site, p: string) =>
    fetch(`${base}/api/v1/public/catalog-preview${p}`, {
      headers: { "x-dp-proxy-key": KEY[site] },
    });
  const previewJson = async (site: Site, p: string) => parse(await preview(site, p));

  beforeAll(async () => {
    company = await staff(
      "company-preview",
      [{ role: "company_content_reviewer", site: BV }],
      root.userId,
    );
    companyCom = await staff(
      "company-preview-com",
      [{ role: "company_content_reviewer", site: COM }],
      root.userId,
    );
    productId = await completeProduct("preview", "DP173-A");
    const created = await bvEditor.post(`/sites/${BV}/proposals`, {
      productId,
      locale: "en",
      summary: "Proposed short text for DP173-A.",
      description: "Proposed long text for DP173-A.",
      reviewData: {
        schemaVersion: 1,
        language: "en",
        family: null,
        items: [heldItem],
        sources: [],
      },
      sourceRef: "docs/catalog/proposals/test.json",
      sourceSha256: "d".repeat(64),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    before = await fingerprint();
  });

  it("issues a link only to a reviewer of the site, for BV only, audited", async () => {
    expectError(await bvReader.post(`/sites/${BV}/preview-link`), 403, "FORBIDDEN");
    expectError(await bvEditor.post(`/sites/${BV}/preview-link`), 403, "FORBIDDEN");
    expectError(await companyCom.post(`/sites/${BV}/preview-link`), 403, "FORBIDDEN");
    expectError(await companyCom.post(`/sites/${COM}/preview-link`), 409, "CONFLICT_STATE", {
      path: "site",
      rule: "no_preview",
    });
    const res = await company.post(`/sites/${BV}/preview-link`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const link = CatalogPreviewLinkResponseSchema.parse(res.body);
    const m = /^https:\/\/dreampetroleumbv\.com\/preview\/catalog\/([^/]+)\/products$/.exec(
      link.url,
    );
    expect(m, link.url).not.toBeNull();
    token = m![1]!;
    // the link names the session and user ids, never a session token
    const session = await owner.session.findFirstOrThrow({
      where: { userId: company.userId, revokedAt: null },
    });
    expect(token.split(".")[1]).toBe(session.id);
    expect(token).not.toContain(session.tokenHash);
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    expect((await lastAudit("catalog.preview_link_issued"))?.actorUserId).toBe(company.userId);
  });

  it("lists every listed product with its current data; proposals and held values stay apart", async () => {
    const res = await preview("bv", `/${token}/products`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    const list = CatalogPreviewListResponseSchema.parse(await res.json());
    const item = list.items.find((i) => i.code === "DP173-A");
    expect(item).toMatchObject({
      unpublished: true,
      proposalStatus: "REVIEW_PENDING",
      hasProposalText: true,
      hasDocuments: false,
    });
    // the CURRENT master text, never the proposal
    expect(item?.summary).toBe("Summary of DP173-A");
    expect(list.items.length).toBeGreaterThanOrEqual(2);
    expect(list.categories.length).toBeGreaterThan(0);
    const detail = await previewJson("bv", `/${token}/products/dp173-a`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    const d = CatalogPreviewProductResponseSchema.parse(detail.body);
    expect(d.product.summary).toBe("Summary of DP173-A");
    expect(d.product.description).toBe("Description of DP173-A");
    expect(JSON.stringify(d.product)).not.toContain("Proposed");
    expect(d.proposal).toMatchObject({
      summary: "Proposed short text for DP173-A.",
      status: "REVIEW_PENDING",
    });
    expect(d.product.specs.map((x) => x.key)).toEqual(["kv100"]);
    expect(JSON.stringify(d.product)).not.toContain("Minus 15");
    expect(d.held).toEqual([
      {
        kind: "DP002_HELD",
        raw: "Pour Point, max: Minus 15 °C [GOST 20287]",
        conflict: true,
        finding: "Method letter not stated.",
      },
    ]);
    const cover = d.product.cover!;
    const img = await preview("bv", `/${token}/images/${cover.id}/thumb`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/webp");
    expect(img.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses forged, expired and foreign links, other keys and writes", async () => {
    const parts = token.split(".");
    const tampered = [
      ...parts.slice(0, 5),
      parts[5]!.replace(/.$/, (c) => (c === "0" ? "1" : "0")),
    ].join(".");
    const key = parseHmacKey(process.env["IAM_HMAC_KEY"]);
    const expired = issueCatalogPreviewToken(
      key,
      { sessionId: parts[1]!, userId: parts[2]!, siteKey: "BV" },
      new Date(Date.now() - 31 * 60_000),
    ).token;
    const corporateToken = issueCatalogPreviewToken(
      key,
      { sessionId: parts[1]!, userId: parts[2]!, siteKey: "CORPORATE" },
      new Date(),
    ).token;
    for (const t of [tampered, expired, "v1.nope", corporateToken]) {
      expect((await preview("bv", `/${t}/products`)).status).toBe(404);
    }
    expect((await preview("com", `/${token}/products`)).status).toBe(404);
    expect((await preview("admin", `/${token}/products`)).status).toBe(404);
    for (const method of ["POST", "PUT", "DELETE"]) {
      const r = await fetch(`${base}/api/v1/public/catalog-preview/${token}/products`, {
        method,
        headers: { "x-dp-proxy-key": KEY.bv, "content-type": "application/json" },
        body: method === "DELETE" ? undefined : "{}",
      });
      expect(r.status, method).toBeGreaterThanOrEqual(400);
    }
    expect((await previewJson("bv", `/${token}/products/not-a-product`)).status).toBe(404);
  });

  // DP-204: the publisher of the site previews before publishing; same link, same checks.
  it("issues a link to the site's publisher too (audited as product:publish), never to others", async () => {
    const publisher = await staff(
      "preview-publisher",
      [{ role: "product_publisher", site: BV }],
      root.userId,
    );
    // Still refused: no publishing or review right on BV, or another site's publisher.
    expectError(await bvReader.post(`/sites/${BV}/preview-link`), 403, "FORBIDDEN");
    expectError(await bvEditor.post(`/sites/${BV}/preview-link`), 403, "FORBIDDEN");
    expectError(await nobody.post(`/sites/${BV}/preview-link`), 403, "FORBIDDEN");
    expectError(await comPublisher.post(`/sites/${BV}/preview-link`), 403, "FORBIDDEN");
    // Corporate has no preview pages: its publisher gets the same refusal as its reviewer.
    expectError(await comPublisher.post(`/sites/${COM}/preview-link`), 409, "CONFLICT_STATE", {
      path: "site",
      rule: "no_preview",
    });

    const res = await publisher.post(`/sites/${BV}/preview-link`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const t = /\/catalog\/([^/]+)\//.exec(
      CatalogPreviewLinkResponseSchema.parse(res.body).url,
    )![1]!;
    const audit = await lastAudit("catalog.preview_link_issued");
    expect(audit?.actorUserId).toBe(publisher.userId);
    expect((audit?.metadata as { permission?: string }).permission).toBe("product:publish");
    expect(audit?.siteId).toBe(BV);

    // The link opens the unpublished product on BV only, read-only.
    expect((await preview("bv", `/${t}/products`)).status).toBe(200);
    const detail = await previewJson("bv", `/${t}/products/dp173-a`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect((await preview("com", `/${t}/products`)).status).toBe(404);
    expect((await preview("admin", `/${t}/products`)).status).toBe(404);
    // Another user's ids in the same link break the signature: 404.
    const forged = t.replace(publisher.userId, bvReader.userId);
    expect((await preview("bv", `/${forged}/products`)).status).toBe(404);

    // Removing the publisher role ends the preview at once (the database re-checks every request).
    const role = await owner.role.findUniqueOrThrow({ where: { key: "product_publisher" } });
    const assignment = await owner.roleAssignment.findFirstOrThrow({
      where: { userId: publisher.userId, roleId: role.id, siteId: BV, revokedAt: null },
    });
    await owner.roleAssignment.update({
      where: { id: assignment.id },
      data: { revokedAt: new Date(), revokedById: root.userId },
    });
    expect((await preview("bv", `/${t}/products`)).status).toBe(404);
  });

  it("ends at once when the role is revoked or the session ends", async () => {
    const ok = await company.post(`/sites/${BV}/preview-link`);
    const t2 = /\/catalog\/([^/]+)\//.exec(
      CatalogPreviewLinkResponseSchema.parse(ok.body).url,
    )![1]!;
    expect((await preview("bv", `/${t2}/products`)).status).toBe(200);
    const role = await owner.role.findUniqueOrThrow({ where: { key: "company_content_reviewer" } });
    const assignment = await owner.roleAssignment.findFirstOrThrow({
      where: { userId: company.userId, roleId: role.id, siteId: BV, revokedAt: null },
    });
    await owner.roleAssignment.update({
      where: { id: assignment.id },
      data: { revokedAt: new Date(), revokedById: root.userId },
    });
    expect((await preview("bv", `/${t2}/products`)).status).toBe(404);
    // a reviewer whose session is revoked loses the preview too
    const second = await staff(
      "company-preview-2",
      [{ role: "company_content_reviewer", site: BV }],
      root.userId,
    );
    const link = await second.post(`/sites/${BV}/preview-link`);
    const t3 = /\/catalog\/([^/]+)\//.exec(
      CatalogPreviewLinkResponseSchema.parse(link.body).url,
    )![1]!;
    expect((await preview("bv", `/${t3}/products`)).status).toBe(200);
    await owner.session.updateMany({
      where: { userId: second.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "USER_REVOKED" },
    });
    expect((await preview("bv", `/${t3}/products`)).status).toBe(404);
  });

  it("changes nothing: product data, proposals and publications are as before; the live site shows nothing new", async () => {
    expect(await fingerprint()).toBe(before);
    const live = await pub("bv", "/products");
    expect(live.body.items.map((p: { code: string }) => p.code)).not.toContain("DP173-A");
  });
});

// ------------------------------------------------------------------------------------------
// 12. DP-193 (ADR-023): direct publication by one authorised administrator
// ------------------------------------------------------------------------------------------

describe("12. DP-193 direct publication", () => {
  let admin: Staff; // platform_super_admin + product_publisher @ BV: approve (platform) + publish
  let d: string; // a complete DRAFT product, BV listing hidden
  const NOTE = "Direct publication: published without a second-person technical review (DP-193).";
  const publish = (who: Staff, id: string, body: Record<string, unknown>) =>
    who.post(`/products/${id}/publications/${BV}/publish`, body);
  const hide = async (id: string) => {
    const res = await bvEditor.post(`/products/${id}/listings/${BV}`, {
      version: await listingVersion(id, BV),
      categoryId: bvCategory,
      visibility: "HIDDEN",
      title: "Direct product for BV",
      summary: "Offered under the pharmaceutical grade designation.",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  const listingRow = (id: string) =>
    owner.productSiteListing.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: BV } },
    });

  beforeAll(async () => {
    admin = await staff(
      "direct-admin",
      [{ role: "platform_super_admin" }, { role: "product_publisher", site: BV }],
      root.userId,
    );
    d = await completeProduct("direct", "DP193-A");
    await hide(d);
  });

  it("tells the console the mode: DIRECT for the administrator, APPROVED for a publisher", async () => {
    const mine = (await admin.workflow(d)).sites.find((s) => s.siteKey === "BV")!;
    expect(mine).toMatchObject({
      canPublish: true,
      publishMode: "DIRECT",
      canShowListing: true,
      canPreview: true,
    });
    expect(mine.readiness.ok).toBe(true);
    expect(mine.readiness.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["not_reviewed", "listing_shown_on_publish", "sensitive_claim"]),
    );
    const theirs = (await bvPublisher.workflow(d)).sites[0]!;
    expect(theirs).toMatchObject({ publishMode: "APPROVED", canShowListing: false });
    // DP-204: the site's publisher previews what it is about to publish.
    expect(theirs.canPreview).toBe(true);
    expect(theirs.readiness.blocking.map((i) => i.code)).toEqual([
      "not_approved",
      "listing_hidden",
    ]);
  });

  it("refuses DIRECT without both rights (publisher only, super admin only), audited", async () => {
    const body = {
      version: await version(d),
      listingVersion: await listingVersion(d, BV),
      approvalMode: "DIRECT",
      makeVisible: true,
    };
    expectError(await publish(bvPublisher, d, body), 403, "FORBIDDEN");
    const denied = await owner.auditEvent.findFirst({
      where: { action: "catalog.access_denied", actorUserId: bvPublisher.userId },
      orderBy: { occurredAt: "desc" },
    });
    expect(denied).toMatchObject({ outcome: "DENIED", resourceType: "product_publication" });
    for (const s of [root, reviewer, pm, bvEditor, comPublisher, bvReader]) {
      expectError(await publish(s, d, body), 403, "FORBIDDEN");
    }
    expect((await listingRow(d)).visibility).toBe("HIDDEN");
  });

  it("keeps the APPROVED mode as it was: a draft is refused even for the administrator", async () => {
    const lv = await listingVersion(d, BV);
    expectError(
      await publish(admin, d, { version: await version(d), listingVersion: lv }),
      409,
      "CONFLICT_STATE",
      { path: "product", rule: "not_approved" },
    );
    // DP-198: makeVisible is accepted in the APPROVED mode, but a draft is still refused and the
    // listing is not shown.
    expectError(
      await publish(admin, d, {
        version: await version(d),
        listingVersion: lv,
        approvalMode: "APPROVED",
        makeVisible: true,
      }),
      409,
      "CONFLICT_STATE",
      { path: "product", rule: "not_approved" },
    );
    expect(await listingRow(d)).toMatchObject({ visibility: "HIDDEN", version: lv });
  });

  it("blocks a hidden listing unless asked to show it, and stale versions", async () => {
    const v = await version(d);
    const lv = await listingVersion(d, BV);
    expectError(
      await publish(admin, d, { version: v, listingVersion: lv, approvalMode: "DIRECT" }),
      409,
      "CONFLICT_STATE",
      { path: "listing", rule: "listing_hidden" },
    );
    expectError(
      await publish(admin, d, {
        version: v - 1,
        listingVersion: lv,
        approvalMode: "DIRECT",
        makeVisible: true,
      }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    expectError(
      await publish(admin, d, {
        version: v,
        listingVersion: lv - 1,
        approvalMode: "DIRECT",
        makeVisible: true,
      }),
      409,
      "CONFLICT_STATE",
      { path: "listingVersion", rule: "stale" },
    );
    expect(await listingRow(d)).toMatchObject({ visibility: "HIDDEN", version: lv });
  });

  it("is atomic: a missing cover refuses it and the listing stays hidden", async () => {
    const id = await completeProduct("direct-nocover", "DP193-B");
    await hide(id);
    const img = await owner.productImage.findFirstOrThrow({ where: { productId: id } });
    expect((await pm.del(`/images/${img.id}`)).status).toBe(204);
    const lv = await listingVersion(id, BV);
    expectError(
      await publish(admin, id, {
        version: await version(id),
        listingVersion: lv,
        approvalMode: "DIRECT",
        makeVisible: true,
      }),
      409,
      "CONFLICT_STATE",
      { path: "images", rule: "cover_missing" },
    );
    expect(await listingRow(id)).toMatchObject({ visibility: "HIDDEN", version: lv });
    expect(
      await owner.productPublication.findUnique({
        where: { productId_siteId: { productId: id, siteId: BV } },
      }),
    ).toBeNull();
  });

  it("refuses invalid technical data and archived masters", async () => {
    const id = await completeProduct("direct-invalid", "DP193-C");
    // The database refuses wrong units outright; a required value removed past the API is a
    // BLOCKING issue of the validation engine.
    await owner.productSpecValue.deleteMany({ where: { productId: id } });
    expectError(
      await publish(admin, id, {
        version: await version(id),
        listingVersion: await listingVersion(id, BV),
        approvalMode: "DIRECT",
      }),
      409,
      "CONFLICT_STATE",
      { path: "spec:kv100", rule: "required_missing" },
    );
    const a = await completeProduct("direct-archived", "DP193-D");
    expect((await pm.post(`/products/${a}/archive`, { version: await version(a) })).status).toBe(
      200,
    );
    expectError(
      await publish(admin, a, {
        version: await version(a),
        listingVersion: await listingVersion(a, BV),
        approvalMode: "DIRECT",
      }),
      409,
      "CONFLICT_STATE",
      { path: "product", rule: "archived" },
    );
  });

  it("publishes the current draft, shows the listing in the same step, keeps it DRAFT", async () => {
    const v = await version(d);
    const lv = await listingVersion(d, BV);
    const res = await publish(admin, d, {
      version: v,
      listingVersion: lv,
      approvalMode: "DIRECT",
      makeVisible: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const wf = ProductWorkflowResponseSchema.parse(res.body);
    expect(wf.status).toBe("DRAFT");
    expect(wf.approvedVersion).toBeNull();
    const bv = wf.sites.find((s) => s.siteKey === "BV")!;
    expect(bv.publication).toMatchObject({
      status: "PUBLISHED",
      approvalMode: "DIRECT",
      productVersion: v,
      listingVersion: lv + 1,
      publishedBy: { id: admin.userId },
    });
    expect(bv.listing).toEqual({ version: lv + 1, visibility: "VISIBLE" });
    expect(bv.outdated).toEqual({ master: false, listing: false });
    // The master was not touched: same version, not approved, no review event of its own.
    const p = await owner.product.findUniqueOrThrow({ where: { id: d } });
    expect(p).toMatchObject({ status: "DRAFT", version: v, approvedById: null });
    expect(wf.history[0]).toMatchObject({
      action: "PUBLISHED",
      siteId: BV,
      productVersion: v,
      comment: NOTE,
      actor: { id: admin.userId },
    });
    const audit = await lastAudit("catalog.product_published_direct");
    expect(audit).toMatchObject({
      actorUserId: admin.userId,
      siteId: BV,
      resourceType: "product_publication",
      resourceId: d,
    });
    expect(audit?.metadata).toMatchObject({
      permission: "product:publish",
      approvalMode: "DIRECT",
      productStatus: "DRAFT",
      listingShown: true,
      listingVersion: lv + 1,
      sensitiveClaims: 1,
      republished: false,
    });
    const shown = await lastAudit("catalog.listing_updated");
    expect(shown).toMatchObject({ actorUserId: admin.userId, resourceType: "product_listing" });
    expect(shown?.metadata).toMatchObject({
      permission: "product:edit",
      cause: "direct_publication",
      visibility: "VISIBLE",
    });
    // Live on BV with the draft's content; Corporate untouched.
    const live = PublicProductResponseSchema.parse((await pub("bv", "/products/dp193-a")).body);
    expect(live.product.summary).toBe("Offered under the pharmaceutical grade designation.");
    expect((await pub("com", "/products/dp193-a")).status).toBe(404);
  });

  it("an edit after publication keeps the snapshot; republishing moves it, as DIRECT", async () => {
    const before = await owner.productPublication.findUniqueOrThrow({
      where: { productId_siteId: { productId: d, siteId: BV } },
    });
    const edit = await pm.post(`/products/${d}`, {
      version: await version(d),
      code: "DP193-A",
      slug: "dp193-a",
      name: "Product DP193-A",
      summary: "Summary of DP193-A",
      description: "A new master description.",
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const after1 = await owner.productPublication.findUniqueOrThrow({ where: { id: before.id } });
    expect(after1.snapshot).toEqual(before.snapshot);
    const wf = await admin.workflow(d);
    expect(wf.sites.find((s) => s.siteKey === "BV")!.outdated.master).toBe(true);
    const res = await publish(admin, d, {
      version: await version(d),
      listingVersion: await listingVersion(d, BV),
      approvalMode: "DIRECT",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after2 = await owner.productPublication.findUniqueOrThrow({ where: { id: before.id } });
    expect(after2).toMatchObject({
      approvalMode: "DIRECT",
      productVersion: await version(d),
      version: before.version + 1,
    });
    expect(readSnapshot(after2.snapshot, "en")?.description).toBe("A new master description.");
    expect((await lastAudit("catalog.product_published_direct"))?.metadata).toMatchObject({
      republished: true,
      listingShown: false,
    });
  });

  it("unpublishes and republishes directly; the separation of duties is unchanged", async () => {
    const row = await owner.productPublication.findUniqueOrThrow({
      where: { productId_siteId: { productId: d, siteId: BV } },
    });
    const off = await admin.post(`/products/${d}/publications/${BV}/unpublish`, {
      version: row.version,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect((await pub("bv", "/products/dp193-a")).status).toBe(404);
    const again = await publish(admin, d, {
      version: await version(d),
      listingVersion: await listingVersion(d, BV),
      approvalMode: "DIRECT",
    });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect((await pub("bv", "/products/dp193-a")).status).toBe(200);
    // The administrator who edited the master still cannot approve their own revision.
    const v = await version(d);
    const edit = await admin.post(`/products/${d}`, {
      version: v,
      code: "DP193-A",
      slug: "dp193-a",
      name: "Product DP193-A",
      summary: "Summary of DP193-A",
      description: "Edited by the administrator.",
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect((await admin.post(`/products/${d}/submit`, { version: v + 1 })).status).toBe(200);
    expectError(await admin.post(`/products/${d}/approve`, { version: v + 2 }), 403, "FORBIDDEN", {
      path: "(root)",
      rule: "own_change",
    });
    // An IN_REVIEW master can still be published directly; it stays IN_REVIEW.
    const inReview = await publish(admin, d, {
      version: v + 2,
      listingVersion: await listingVersion(d, BV),
      approvalMode: "DIRECT",
    });
    expect(inReview.status, JSON.stringify(inReview.body)).toBe(200);
    expect((await owner.product.findUniqueOrThrow({ where: { id: d } })).status).toBe("IN_REVIEW");
    expect((await admin.post(`/products/${d}/withdraw`, { version: v + 2 })).status).toBe(200);
  });

  it("shows the site's research proposal and its claim notes, never its held values", async () => {
    const res = await bvEditor.post(`/sites/${BV}/proposals`, {
      productId: d,
      locale: "en",
      summary: "Research summary of DP193-A.",
      description: "Research description of DP193-A.",
      reviewData: {
        schemaVersion: 1,
        family: "White oil",
        items: [
          {
            kind: "CLAIM_RISK",
            field: "summary",
            text: "Pharmaceutical suitability needs a manufacturer certificate.",
            sourceIds: [],
            heldValue: null,
          },
          {
            kind: "DP002_HELD",
            field: "spec:kv100",
            text: "Two viscosity limits on one page.",
            sourceIds: [],
            heldValue: {
              definition: "kv100",
              basis: "SPECIFICATION",
              raw: "KV100: 7.5 mm2/s [ASTM D445]",
              conflict: true,
              finding: null,
            },
          },
        ],
        sources: [],
      },
      sourceRef: "docs/catalog/proposals/dp193.json",
      sourceSha256: "c".repeat(64),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const site = (await admin.workflow(d)).sites.find((s) => s.siteKey === "BV")!;
    expect(site.proposal).toMatchObject({
      status: "REVIEW_PENDING",
      summary: "Research summary of DP193-A.",
      description: "Research description of DP193-A.",
      claimRisks: ["Pharmaceutical suitability needs a manufacturer certificate."],
    });
    expect(JSON.stringify(site.proposal)).not.toContain("7.5");
    expect(site.readiness.warnings.map((w) => w.code)).toContain("company_review_pending");
    expect(site.readiness.ok).toBe(true);
    // Reading the proposal wrote nothing to the listing.
    const text = await owner.productListingText.findFirstOrThrow({
      where: { listingId: (await listingRow(d)).id },
    });
    expect(text.summary).toBe("Offered under the pharmaceutical grade designation.");
  });

  it("concurrent direct publications showing the listing: exactly one wins", async () => {
    const id = await completeProduct("direct-race", "DP193-E");
    await hide(id);
    const body = {
      version: await version(id),
      listingVersion: await listingVersion(id, BV),
      approvalMode: "DIRECT",
      makeVisible: true,
    };
    const results = await Promise.all([publish(admin, id, body), publish(admin, id, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = await owner.productPublication.findMany({ where: { productId: id } });
    expect(rows).toHaveLength(1);
    expect((await listingRow(id)).version).toBe(body.listingVersion + 1);
  });

  it("a master edit racing a direct publication: the snapshot is never newer content under an older version", async () => {
    const id = await completeProduct("direct-race2", "DP193-F");
    const v = await version(id);
    const [pubRes, editRes] = await Promise.all([
      publish(admin, id, {
        version: v,
        listingVersion: await listingVersion(id, BV),
        approvalMode: "DIRECT",
      }),
      pm.post(`/products/${id}`, {
        version: v,
        code: "DP193-F",
        slug: "dp193-f",
        name: "Product DP193-F",
        summary: "Raced summary",
        description: "Description of DP193-F",
      }),
    ]);
    expect(editRes.status, JSON.stringify(editRes.body)).toBe(200);
    if (pubRes.status === 200) {
      const row = await owner.productPublication.findUniqueOrThrow({
        where: { productId_siteId: { productId: id, siteId: BV } },
      });
      expect(row.productVersion).toBe(v);
      // The listing has no own summary, so the snapshot shows the master's version-v summary.
      expect(readSnapshot(row.snapshot, "en")?.summary).toBe("Summary of DP193-F");
    } else {
      expectError(pubRes, 409, "CONFLICT_STATE", { path: "version", rule: "stale" });
    }
  });

  it("the database refuses a direct publication without both rights, of an old or archived version, and a mode change in place", async () => {
    const id = await completeProduct("direct-db", "DP193-G");
    const listing = await listingRow(id);
    const row = (publishedById: string, productVersion: number) => ({
      productId: id,
      siteId: BV,
      listingId: listing.id,
      status: "PUBLISHED" as const,
      approvalMode: "DIRECT" as const,
      productVersion,
      listingVersion: listing.version,
      snapshot: { schemaVersion: 1 },
      imageIds: [],
      publishedAt: new Date(),
      publishedById,
    });
    const v = await version(id);
    for (const who of [bvPublisher, root, pm, comPublisher]) {
      await rejectsDb(
        owner.productPublication.create({ data: row(who.userId, v) }),
        /direct publication needs product approval and publishing rights/,
      );
    }
    await rejectsDb(
      owner.productPublication.create({ data: row(admin.userId, v - 1) }),
      /only the current version of an active product can be published directly/,
    );
    // The APPROVED mode still needs the approved version, whoever writes it.
    await rejectsDb(
      owner.productPublication.create({
        data: { ...row(admin.userId, v), approvalMode: "APPROVED" },
      }),
      /only the approved version/,
    );
    const ok = await owner.productPublication.create({ data: row(admin.userId, v) });
    await rejectsDb(
      owner.productPublication.update({
        where: { id: ok.id },
        data: { approvalMode: "APPROVED" },
      }),
      /replaced only by publishing again/,
    );
    // A revoked publisher role ends the right at once.
    await owner.roleAssignment.updateMany({
      where: { userId: admin.userId, siteId: BV, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: root.userId },
    });
    await rejectsDb(
      owner.productPublication.update({
        where: { id: ok.id },
        data: { publishedAt: new Date(Date.now() + 1000) },
      }),
      /direct publication needs product approval and publishing rights/,
    );
    const helper = await owner.$queryRaw<{ who: string | null }[]>`
      SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FILTER (
               WHERE has_function_privilege(r.oid, 'catalog_direct_publish_allowed(uuid, uuid)', 'EXECUTE')) AS who
      FROM pg_roles r
      WHERE r.rolname IN ('dp_app', 'dp_iam_bootstrap', 'dp_iam_system', 'dp_lead_retention', 'public')`;
    expect(helper[0]?.who).toBe("dp_app");
  });

  it("the existing publications stayed APPROVED publications", async () => {
    const modes = await owner.productPublication.groupBy({
      by: ["approvalMode"],
      where: { publishedById: { not: admin.userId } },
      _count: true,
    });
    expect(modes.map((m) => m.approvalMode)).toEqual(["APPROVED"]);
  });
});

// ------------------------------------------------------------------------------------------
// 13. DP-180: research text into listing texts (source check, audit, the apply-text tool)
// ------------------------------------------------------------------------------------------

describe("13. DP-180 proposal text into listings", () => {
  const reviewData = {
    schemaVersion: 1,
    family: "Group II base oil",
    items: [
      { kind: "CONFIRM", field: "packaging", text: "Pack sizes?", sourceIds: [], heldValue: null },
    ],
    sources: [],
  };
  const ids: Record<string, string> = {};
  const proposals: Record<string, { id: string; version: number }> = {};

  async function withProposal(
    key: string,
    code: string,
    summary: string | null,
    description: string | null,
  ) {
    const id = await completeProduct(`dp180-${key}`, code);
    ids[key] = id;
    const res = await bvEditor.post(`/sites/${BV}/proposals`, {
      productId: id,
      locale: "en",
      summary,
      description,
      reviewData,
      sourceRef: "docs/catalog/proposals/dp180.json",
      sourceSha256: "d".repeat(64),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    proposals[key] = { id: res.body.proposal.id, version: res.body.proposal.version };
  }
  const listingOf = (id: string) =>
    owner.productSiteListing.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: BV } },
      include: { texts: true },
    });
  async function save(key: string, extra: Record<string, unknown>) {
    const l = await listingOf(ids[key]!);
    return bvEditor.post(`/products/${ids[key]}/listings/${BV}`, {
      version: l.version,
      categoryId: l.categoryId,
      visibility: l.visibility,
      sortOrder: l.sortOrder,
      title: l.texts[0]?.title ?? null,
      ...extra,
    });
  }

  beforeAll(async () => {
    await withProposal(
      "a",
      "DP180-A",
      "Group II base oil, 150N.",
      "A paraffinic base oil for blending.",
    );
    await withProposal("b", "DP180-B", "Base oil B.", "Description B.");
    await withProposal("c", "DP180-C", "Base oil C.", "Description C.");
    await withProposal("n", "DP180-N", null, null);
  });

  it("refuses a source of another product, another version, another hash or another text", async () => {
    const a = proposals["a"]!;
    const sha = textSha256("Group II base oil, 150N.", "A paraffinic base oil for blending.");
    const text = {
      summary: "Group II base oil, 150N.",
      description: "A paraffinic base oil for blending.",
    };
    expectError(
      await save("a", {
        ...text,
        source: { proposalId: proposals["b"]!.id, proposalVersion: 1, textSha256: sha },
      }),
      400,
      "VALIDATION_FAILED",
      { path: "source.proposalId", rule: "unknown" },
    );
    expectError(
      await save("a", {
        ...text,
        source: { proposalId: a.id, proposalVersion: a.version + 1, textSha256: sha },
      }),
      409,
      "CONFLICT_STATE",
      { path: "source.proposalVersion", rule: "stale" },
    );
    expectError(
      await save("a", {
        ...text,
        source: { proposalId: a.id, proposalVersion: a.version, textSha256: "0".repeat(64) },
      }),
      400,
      "VALIDATION_FAILED",
      { path: "source.textSha256", rule: "mismatch" },
    );
    expectError(
      await save("a", {
        summary: "Edited by hand.",
        description: text.description,
        source: { proposalId: a.id, proposalVersion: a.version, textSha256: sha },
      }),
      400,
      "VALIDATION_FAILED",
      { path: "summary", rule: "differs_from_source" },
    );
    const n = proposals["n"]!;
    expectError(
      await save("n", {
        source: {
          proposalId: n.id,
          proposalVersion: n.version,
          textSha256: textSha256(null, null),
        },
      }),
      400,
      "VALIDATION_FAILED",
      { path: "source", rule: "no_text" },
    );
    // Nothing was written by the refusals.
    expect((await listingOf(ids["a"]!)).texts[0]?.summary ?? null).toBeNull();
  });

  it("accepts the proposal's exact text and keeps the source in the audit event", async () => {
    const a = proposals["a"]!;
    const sha = textSha256("Group II base oil, 150N.", "A paraffinic base oil for blending.");
    const res = await save("a", {
      summary: "Group II base oil, 150N.",
      description: "A paraffinic base oil for blending.",
      source: { proposalId: a.id, proposalVersion: a.version, textSha256: sha },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const audit = await lastAudit("catalog.listing_updated");
    expect(audit).toMatchObject({ actorUserId: bvEditor.userId, siteId: BV });
    expect(audit?.metadata).toMatchObject({
      productId: ids["a"],
      source: { proposalId: a.id, proposalVersion: a.version, textSha256: sha },
    });
    // A save without a source behaves as before and records none.
    const plain = await save("a", {
      summary: "Group II base oil, 150N.",
      description: "Edited later.",
    });
    expect(plain.status).toBe(200);
    expect((await lastAudit("catalog.listing_updated"))?.metadata).not.toHaveProperty("source");
  });

  it("apply-text: dry run, --confirm, only summary and description, idempotent second run", async () => {
    const only = new Set(["DP180-A", "DP180-B", "DP180-C", "DP180-N"]);
    // DP180-C already has its own summary: never overwritten.
    expect((await save("c", { summary: "Our own summary." })).status).toBe(200);
    const api = adminApi({
      baseUrl: base,
      proxyKey: TEST_KEYS.admin,
      sessionToken: bvEditor.token,
      origin: ADMIN_ORIGIN,
    });
    const before = {
      b: await listingOf(ids["b"]!),
      specs: await owner.productSpecValue.findMany({
        where: { productId: { in: Object.values(ids) } },
        orderBy: { id: "asc" },
      }),
      products: await owner.product.findMany({
        where: { id: { in: Object.values(ids) } },
        orderBy: { id: "asc" },
      }),
    };
    const dry = await runApplyText(api, {
      siteKey: "BV",
      locale: "en",
      only,
      apply: false,
      confirm: undefined,
    });
    expect(dry.error).toBeNull();
    expect(Object.fromEntries(dry.plan.map((r) => [r.code, r.action]))).toEqual({
      "DP180-A": "KEEP_EXISTING", // edited by hand above
      "DP180-B": "APPLY",
      "DP180-C": "KEEP_EXISTING",
      "DP180-N": "NO_TEXT",
    });
    expect(
      (await runApplyText(api, { siteKey: "BV", locale: "en", only, apply: true, confirm: 2 }))
        .error,
    ).toMatch(/does not match/);
    const applied = await runApplyText(api, {
      siteKey: "BV",
      locale: "en",
      only,
      apply: true,
      confirm: 1,
    });
    expect(applied.error).toBeNull();
    expect(applied.applied.map((a) => a.code)).toEqual(["DP180-B"]);
    const b = await listingOf(ids["b"]!);
    expect(b).toMatchObject({
      visibility: before.b.visibility,
      categoryId: before.b.categoryId,
      sortOrder: before.b.sortOrder,
      version: before.b.version + 1,
    });
    expect(b.texts[0]).toMatchObject({
      title: before.b.texts[0]?.title,
      summary: "Base oil B.",
      description: "Description B.",
    });
    expect((await lastAudit("catalog.listing_updated"))?.metadata).toMatchObject({
      source: {
        proposalId: proposals["b"]!.id,
        textSha256: textSha256("Base oil B.", "Description B."),
      },
    });
    // Others untouched; proposals stay REVIEW_PENDING; master and specification values unchanged.
    expect((await listingOf(ids["c"]!)).texts[0]?.summary).toBe("Our own summary.");
    expect((await listingOf(ids["n"]!)).texts[0]?.summary ?? null).toBeNull();
    const statuses = await owner.productContentProposal.findMany({
      where: { id: { in: Object.values(proposals).map((p) => p.id) } },
      select: { status: true },
    });
    expect(new Set(statuses.map((s) => s.status))).toEqual(new Set(["REVIEW_PENDING"]));
    expect(
      await owner.productSpecValue.findMany({
        where: { productId: { in: Object.values(ids) } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before.specs);
    expect(
      await owner.product.findMany({
        where: { id: { in: Object.values(ids) } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before.products);
    expect(
      await owner.productPublication.count({ where: { productId: { in: Object.values(ids) } } }),
    ).toBe(0);
    // Second run: nothing to do.
    const again = await runApplyText(api, {
      siteKey: "BV",
      locale: "en",
      only,
      apply: false,
      confirm: undefined,
    });
    expect(Object.fromEntries(again.plan.map((r) => [r.code, r.action]))).toMatchObject({
      "DP180-B": "SAME",
    });
    expect(again.counts.APPLY).toBe(0);
  });

  it("skips a product published on the site (archived: unit test)", async () => {
    const live = P["direct"]!; // DP-193 section: published on BV
    const code = (await owner.product.findUniqueOrThrow({ where: { id: live } })).code;
    const api = adminApi({
      baseUrl: base,
      proxyKey: TEST_KEYS.admin,
      sessionToken: bvEditor.token,
      origin: ADMIN_ORIGIN,
    });
    const r = await runApplyText(api, {
      siteKey: "BV",
      locale: "en",
      only: new Set([code]),
      apply: false,
      confirm: undefined,
    });
    expect(r.plan).toEqual([
      expect.objectContaining({ code, action: "SKIP", reason: "published" }),
    ]);
  });
});

// ------------------------------------------------------------------------------------------
// 14. DP-197: the console without a visibility control. The admin's Content save sends the
//     saved visibility back; Publish shows the listing (makeVisible; DP-198: in both modes, see
//     section 15); Unpublish takes the product off the public catalogue.
// ------------------------------------------------------------------------------------------

describe("14. DP-197 publication without a visibility control", () => {
  let admin: Staff; // platform_super_admin + product_publisher @ BV (DIRECT)
  const listingRow = (id: string) =>
    owner.productSiteListing.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: BV } },
      include: { texts: true },
    });
  const publicationRow = (id: string) =>
    owner.productPublication.findUnique({
      where: { productId_siteId: { productId: id, siteId: BV } },
    });
  /** The body the console's Content tab sends: the edited texts, the saved visibility. */
  const contentSave = async (id: string, title: string) => {
    const l = await listingRow(id);
    return bvEditor.post(`/products/${id}/listings/${BV}`, {
      version: l.version,
      categoryId: l.categoryId,
      visibility: l.visibility,
      sortOrder: l.sortOrder,
      title,
      summary: `BV summary ${title}`,
      description: "",
    });
  };
  const publicSlugs = async () =>
    PublicProductListResponseSchema.parse((await pub("bv", "/products")).body).items.map(
      (i) => i.slug,
    );

  beforeAll(async () => {
    admin = await staff(
      "dp197-admin",
      [{ role: "platform_super_admin" }, { role: "product_publisher", site: BV }],
      root.userId,
    );
  });

  it("a Content save changes neither the visibility nor the publication", async () => {
    const id = await completeProduct("dp197-content", "DP197-A");
    // A new listing as the console creates it now: off the site.
    const l = await listingRow(id);
    expect(
      (
        await bvEditor.post(`/products/${id}/listings/${BV}`, {
          version: l.version,
          categoryId: l.categoryId,
          visibility: "HIDDEN",
          sortOrder: 0,
          title: "DP197-A for BV",
        })
      ).status,
    ).toBe(200);
    const res = await contentSave(id, "Edited title");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await listingRow(id)).toMatchObject({ visibility: "HIDDEN", version: l.version + 2 });
    expect(await publicationRow(id)).toBeNull();
    expect((await pub("bv", "/products/dp197-a")).status).toBe(404);
  });

  it("DIRECT: Publish shows the listing; Unpublish takes it off the public catalogue", async () => {
    const id = await completeProduct("dp197-direct", "DP197-B");
    const l0 = await listingRow(id);
    await bvEditor.post(`/products/${id}/listings/${BV}`, {
      version: l0.version,
      categoryId: l0.categoryId,
      visibility: "HIDDEN",
      title: "DP197-B for BV",
    });
    const site = (await admin.workflow(id)).sites.find((s) => s.siteKey === "BV")!;
    expect(site).toMatchObject({ publishMode: "DIRECT", canShowListing: true });
    expect(site.readiness.ok).toBe(true);
    const published = await admin.post(`/products/${id}/publications/${BV}/publish`, {
      version: await version(id),
      listingVersion: await listingVersion(id, BV),
      approvalMode: "DIRECT",
      makeVisible: true,
    });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect((await listingRow(id)).visibility).toBe("VISIBLE");
    expect(await publicSlugs()).toContain("dp197-b");
    expect((await pub("bv", "/products/dp197-b")).status).toBe(200);

    // A Content save while live keeps it live with the published snapshot.
    expect((await contentSave(id, "Edited while live")).status).toBe(200);
    expect((await listingRow(id)).visibility).toBe("VISIBLE");
    expect((await publicationRow(id))?.status).toBe("PUBLISHED");
    expect((await pub("bv", "/products/dp197-b")).body).toMatchObject({
      product: { name: "DP197-B for BV" },
    });

    const row = (await publicationRow(id))!;
    const off = await admin.post(`/products/${id}/publications/${BV}/unpublish`, {
      version: row.version,
      comment: null,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    // The API leaves the listing switched on; the public catalogue needs a PUBLISHED row.
    expect((await listingRow(id)).visibility).toBe("VISIBLE");
    expect((await publicationRow(id))?.status).toBe("UNPUBLISHED");
    expect(await publicSlugs()).not.toContain("dp197-b");
    expect((await pub("bv", "/products/dp197-b")).status).toBe(404);
    const img = await owner.productImage.findFirstOrThrow({ where: { productId: id } });
    expect((await pubBytes("bv", `/images/${img.id}/display`)).status).toBe(404);

    // Publishing again brings it back, without makeVisible (already shown).
    const again = await admin.post(`/products/${id}/publications/${BV}/publish`, {
      version: await version(id),
      listingVersion: await listingVersion(id, BV),
      approvalMode: "DIRECT",
    });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect((await pub("bv", "/products/dp197-b")).body).toMatchObject({
      product: { name: "Edited while live" },
    });
  });
});

// ------------------------------------------------------------------------------------------
// 15. DP-198 (R-29): an APPROVED publication shows the hidden listing and publishes in ONE
//     transaction (makeVisible in both modes), with one audit trail; a repeated or concurrent
//     request publishes once; a refusal at any point leaves nothing behind.
// ------------------------------------------------------------------------------------------

describe("15. DP-198 atomic APPROVED publication", () => {
  let pubEditor: Staff; // product_publisher + product_editor @ BV: publish and show the listing
  const listingRow = (id: string) =>
    owner.productSiteListing.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: BV } },
    });
  const publicationRow = (id: string) =>
    owner.productPublication.findUnique({
      where: { productId_siteId: { productId: id, siteId: BV } },
    });
  const publish = (who: Staff, id: string, body: Record<string, unknown>) =>
    who.post(`/products/${id}/publications/${BV}/publish`, body);
  /** Everything a publication writes about one product, to prove that nothing was written. */
  const trail = async (id: string) => {
    const listing = await listingRow(id);
    return {
      listing: { visibility: listing.visibility, version: listing.version },
      master: await owner.product.findUniqueOrThrow({
        where: { id },
        select: { status: true, version: true, approvedVersion: true },
      }),
      publication: await publicationRow(id),
      published: await owner.productReviewEvent.count({
        where: { productId: id, siteId: BV, action: "PUBLISHED" },
      }),
      listingAudits: await owner.auditEvent.count({
        where: { action: "catalog.listing_updated", resourceId: listing.id, outcome: "SUCCESS" },
      }),
      publishAudits: await owner.auditEvent.count({
        where: { action: "catalog.product_published", resourceId: id, siteId: BV },
      }),
    };
  };
  /** An APPROVED master whose BV listing is hidden (a new listing as the console creates it). */
  async function approvedHidden(key: string, code: string): Promise<string> {
    const id = await completeProduct(key, code);
    const hidden = await bvEditor.post(`/products/${id}/listings/${BV}`, {
      version: await listingVersion(id, BV),
      categoryId: bvCategory,
      visibility: "HIDDEN",
      title: `${code} for BV`,
    });
    expect(hidden.status, JSON.stringify(hidden.body)).toBe(200);
    expect((await pm.post(`/products/${id}/submit`, { version: await version(id) })).status).toBe(
      200,
    );
    expect(
      (await reviewer.post(`/products/${id}/approve`, { version: await version(id) })).status,
    ).toBe(200);
    return id;
  }
  const bodyOf = async (id: string, extra: Record<string, unknown> = {}) => ({
    version: await version(id),
    listingVersion: await listingVersion(id, BV),
    makeVisible: true,
    ...extra,
  });

  beforeAll(async () => {
    pubEditor = await staff(
      "dp198-publisher-editor",
      [
        { role: "product_publisher", site: BV },
        { role: "product_editor", site: BV },
      ],
      root.userId,
    );
  });

  it("tells the console that Publish shows the listing, only with edit rights on it", async () => {
    const id = await approvedHidden("dp198-ctx", "DP198-A");
    const mine = (await pubEditor.workflow(id)).sites.find((s) => s.siteKey === "BV")!;
    expect(mine).toMatchObject({ publishMode: "APPROVED", canShowListing: true });
    expect(mine.readiness).toMatchObject({ ok: true, blocking: [] });
    expect(mine.readiness.warnings.map((w) => w.code)).toContain("listing_shown_on_publish");
    // A publisher without product:edit: the hidden listing still blocks (no new right).
    const theirs = (await bvPublisher.workflow(id)).sites[0]!;
    expect(theirs).toMatchObject({ publishMode: "APPROVED", canShowListing: false });
    expect(theirs.readiness.blocking.map((i) => i.code)).toEqual(["listing_hidden"]);
    // An editor who cannot publish is not offered it either.
    const editor = (await bvEditor.workflow(id)).sites.find((s) => s.siteKey === "BV")!;
    expect(editor).toMatchObject({ canPublish: false, canShowListing: false });
  });

  it("publishes the approved version and shows the listing in one request, one audit trail", async () => {
    const id = await approvedHidden("dp198-ok", "DP198-B");
    const before = await trail(id);
    expect((await pub("bv", "/products/dp198-b")).status).toBe(404);
    const body = await bodyOf(id);
    const res = await publish(pubEditor, id, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const site = ProductWorkflowResponseSchema.parse(res.body).sites.find(
      (s) => s.siteKey === "BV",
    )!;
    expect(site.publication).toMatchObject({
      status: "PUBLISHED",
      approvalMode: "APPROVED",
      productVersion: body.version,
      listingVersion: body.listingVersion + 1,
    });
    expect(site.outdated).toEqual({ master: false, listing: false });

    const after = await trail(id);
    expect(after.listing).toEqual({ visibility: "VISIBLE", version: body.listingVersion + 1 });
    // The approval and the master are untouched (the lock keeps the version).
    expect(after.master).toEqual(before.master);
    expect(after.master).toMatchObject({ status: "APPROVED", approvedVersion: body.version });
    expect(after.published).toBe(before.published + 1);
    expect(after.listingAudits).toBe(before.listingAudits + 1);
    expect(after.publishAudits).toBe(before.publishAudits + 1);

    const listing = await listingRow(id);
    const shown = await owner.auditEvent.findFirstOrThrow({
      where: { action: "catalog.listing_updated", resourceId: listing.id },
      orderBy: { occurredAt: "desc" },
    });
    const published = await owner.auditEvent.findFirstOrThrow({
      where: { action: "catalog.product_published", resourceId: id },
      orderBy: { occurredAt: "desc" },
    });
    expect(shown).toMatchObject({ actorUserId: pubEditor.userId, siteId: BV, outcome: "SUCCESS" });
    expect(shown.metadata).toMatchObject({
      productId: id,
      changed: ["visibility"],
      visibility: "VISIBLE",
      version: body.listingVersion + 1,
      cause: "approved_publication",
      permission: "product:edit",
    });
    expect(published).toMatchObject({ actorUserId: pubEditor.userId, siteId: BV });
    expect(published.metadata).toMatchObject({
      productVersion: body.version,
      listingVersion: body.listingVersion + 1,
      listingShown: true,
      republished: false,
      permission: "product:publish",
    });
    // Both events belong to the same request.
    expect(shown.requestId).toBe(published.requestId);

    expect((await pub("bv", "/products/dp198-b")).status).toBe(200);
    expect(
      PublicProductListResponseSchema.parse((await pub("bv", "/products")).body).items.map(
        (i) => i.slug,
      ),
    ).toContain("dp198-b");
  });

  it("refuses callers without both rights, audited, and changes nothing", async () => {
    const id = await approvedHidden("dp198-rbac", "DP198-C");
    const before = await trail(id);
    const body = await bodyOf(id);
    // Publisher without product:edit: the listing change is refused (403, audited).
    expectError(await publish(bvPublisher, id, body), 403, "FORBIDDEN");
    const denied = await owner.auditEvent.findFirst({
      where: { action: "catalog.access_denied", actorUserId: bvPublisher.userId },
      orderBy: { occurredAt: "desc" },
    });
    expect(denied).toMatchObject({
      outcome: "DENIED",
      resourceType: "product_listing",
      resourceId: id,
    });
    // Editor without product:publish, the other site's publisher, a reader, a super admin
    // (never publishes) and a user without a role.
    for (const s of [bvEditor, comPublisher, bvReader, root, nobody]) {
      expectError(await publish(s, id, body), 403, "FORBIDDEN");
    }
    expect(await trail(id)).toEqual(before);
    expect((await pub("bv", "/products/dp198-c")).status).toBe(404);
  });

  it("refuses stale versions and an unapproved master without showing the listing", async () => {
    const id = await approvedHidden("dp198-stale", "DP198-D");
    const before = await trail(id);
    const body = await bodyOf(id);
    expectError(
      await publish(pubEditor, id, { ...body, version: body.version - 1 }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    expectError(
      await publish(pubEditor, id, { ...body, listingVersion: body.listingVersion - 1 }),
      409,
      "CONFLICT_STATE",
      { path: "listingVersion", rule: "stale" },
    );
    expect(await trail(id)).toEqual(before);

    // An edit after the approval returns the master to DRAFT: refused, listing stays hidden.
    const edit = await pm.post(`/products/${id}`, {
      version: body.version,
      code: "DP198-D",
      slug: "dp198-d",
      name: "Product DP198-D",
      summary: "Changed after approval",
      description: "Description of DP198-D",
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expectError(await publish(pubEditor, id, await bodyOf(id)), 409, "CONFLICT_STATE", {
      path: "product",
      rule: "not_approved",
    });
    expect((await trail(id)).listing).toEqual(before.listing);
    expect(await publicationRow(id)).toBeNull();
  });

  it("rolls back the shown listing when the publication is refused at the last write", async () => {
    const id = await approvedHidden("dp198-rollback", "DP198-E");
    const before = await trail(id);
    // The database refuses the publication row itself (as its guard would), after the API has
    // already shown the listing and written its audit event in the same transaction.
    await owner.$executeRawUnsafe(`
      CREATE FUNCTION dp198_refuse_publication() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION 'catalog: only the approved version of a product can be published'
          USING ERRCODE = 'check_violation';
      END
      $fn$`);
    await owner.$executeRawUnsafe(`
      CREATE TRIGGER dp198_refuse_publication BEFORE INSERT OR UPDATE ON "ProductPublication"
      FOR EACH ROW WHEN (NEW."productId" = '${id}'::uuid)
      EXECUTE FUNCTION dp198_refuse_publication()`);
    try {
      expectError(await publish(pubEditor, id, await bodyOf(id)), 409, "CONFLICT_STATE", {
        path: "status",
        rule: "not_approved",
      });
    } finally {
      await owner.$executeRawUnsafe(
        `DROP TRIGGER dp198_refuse_publication ON "ProductPublication"`,
      );
      await owner.$executeRawUnsafe(`DROP FUNCTION dp198_refuse_publication()`);
    }
    // Nothing of the request is left: listing, master, publication, history, audit.
    expect(await trail(id)).toEqual(before);
    expect((await pub("bv", "/products/dp198-e")).status).toBe(404);
    // And the same request succeeds once the refusal is gone.
    expect((await publish(pubEditor, id, await bodyOf(id))).status).toBe(200);
  });

  it("concurrent identical requests: exactly one publication, one event, one audit", async () => {
    const id = await approvedHidden("dp198-race", "DP198-F");
    const before = await trail(id);
    const body = await bodyOf(id);
    const results = await Promise.all([
      publish(pubEditor, id, body),
      publish(pubEditor, id, body),
      publish(pubEditor, id, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) {
      expectError(r, 409, "CONFLICT_STATE", { path: "listingVersion", rule: "stale" });
    }
    const after = await trail(id);
    expect(after.listing).toEqual({ visibility: "VISIBLE", version: body.listingVersion + 1 });
    expect(after.published).toBe(before.published + 1);
    expect(after.listingAudits).toBe(before.listingAudits + 1);
    expect(after.publishAudits).toBe(before.publishAudits + 1);
    expect(after.publication).toMatchObject({ status: "PUBLISHED", version: 1 });
  });

  it("a repeated request publishes once: what is live is not published twice", async () => {
    const id = await approvedHidden("dp198-repeat", "DP198-G");
    const res = await publish(pubEditor, id, await bodyOf(id));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const live = await trail(id);
    // The same request again (now without makeVisible, as the listing is shown), sequentially
    // and concurrently.
    const again = await bodyOf(id, { makeVisible: false });
    expectError(await publish(pubEditor, id, again), 409, "CONFLICT_STATE", {
      path: "publication",
      rule: "already_published",
    });
    const raced = await Promise.all([
      publish(pubEditor, id, again),
      publish(bvPublisher, id, again),
    ]);
    for (const r of raced) {
      expectError(r, 409, "CONFLICT_STATE", { path: "publication", rule: "already_published" });
    }
    expect(await trail(id)).toEqual(live);
  });

  it("Unpublish takes it off the public catalogue; Publish brings it back without a second listing change", async () => {
    const id = await approvedHidden("dp198-unpub", "DP198-H");
    expect((await publish(pubEditor, id, await bodyOf(id))).status).toBe(200);
    expect((await pub("bv", "/products/dp198-h")).status).toBe(200);
    const row = (await publicationRow(id))!;
    const off = await bvPublisher.post(`/products/${id}/publications/${BV}/unpublish`, {
      version: row.version,
      comment: null,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect((await publicationRow(id))?.status).toBe("UNPUBLISHED");
    expect((await listingRow(id)).visibility).toBe("VISIBLE");
    expect((await pub("bv", "/products/dp198-h")).status).toBe(404);
    expect(
      PublicProductListResponseSchema.parse((await pub("bv", "/products")).body).items.map(
        (i) => i.slug,
      ),
    ).not.toContain("dp198-h");

    // A publisher without product:edit may publish again: the listing is shown already.
    const listingBefore = await listingRow(id);
    const back = await publish(bvPublisher, id, await bodyOf(id, { makeVisible: false }));
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect((await listingRow(id)).version).toBe(listingBefore.version);
    expect((await pub("bv", "/products/dp198-h")).status).toBe(200);
    expect(await lastAudit("catalog.product_published")).toMatchObject({
      actorUserId: bvPublisher.userId,
      resourceId: id,
    });
    expect((await lastAudit("catalog.product_published"))!.metadata).toMatchObject({
      republished: true,
      listingShown: false,
    });
  });

  it("DIRECT is unchanged: the draft stays DRAFT, the listing is shown, a repeat publishes once", async () => {
    const admin = await staff(
      "dp198-direct-admin",
      [{ role: "platform_super_admin" }, { role: "product_publisher", site: BV }],
      root.userId,
    );
    const id = await completeProduct("dp198-direct", "DP198-I");
    const l = await listingRow(id);
    await bvEditor.post(`/products/${id}/listings/${BV}`, {
      version: l.version,
      categoryId: bvCategory,
      visibility: "HIDDEN",
      title: "DP198-I for BV",
    });
    const body = await bodyOf(id, { approvalMode: "DIRECT" });
    const res = await publish(admin, id, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await trail(id);
    expect(after.master.status).toBe("DRAFT");
    expect(after.master.version).toBe(body.version);
    expect(after.listing).toEqual({ visibility: "VISIBLE", version: body.listingVersion + 1 });
    expect(after.publication).toMatchObject({ status: "PUBLISHED", approvalMode: "DIRECT" });
    const shown = await owner.auditEvent.findFirstOrThrow({
      where: { action: "catalog.listing_updated", resourceId: l.id },
      orderBy: { occurredAt: "desc" },
    });
    expect(shown.metadata).toMatchObject({ cause: "direct_publication" });
    expect(await lastAudit("catalog.product_published_direct")).toMatchObject({ resourceId: id });
    expectError(
      await publish(admin, id, await bodyOf(id, { approvalMode: "DIRECT", makeVisible: false })),
      409,
      "CONFLICT_STATE",
      { path: "publication", rule: "already_published" },
    );
    expect(await trail(id)).toEqual(after);
    expect((await pub("bv", "/products/dp198-i")).status).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------
// 16. DP-209 product SEO: saved on the listing, published with the snapshot, sitemap consistent
// ------------------------------------------------------------------------------------------

describe("16. DP-209 product SEO", () => {
  let admin: Staff; // approve (platform) + publish (BV): publishes directly
  let id: string;
  let imageId: string;
  const path = "/products/dp209-a";
  const seoUrl = () => `/products/${id}/listings/${BV}/seo`;
  const EMPTY = {
    title: null,
    description: null,
    ogTitle: null,
    ogDescription: null,
    canonicalPath: null,
    noindex: false,
    ogImageId: null,
  };
  async function saveSeo(body: Record<string, unknown>, who: Staff = bvEditor) {
    return who.post(seoUrl(), { version: await listingVersion(id, BV), ...EMPTY, ...body });
  }
  async function republish() {
    const res = await admin.post(`/products/${id}/publications/${BV}/publish`, {
      version: await version(id),
      listingVersion: await listingVersion(id, BV),
      approvalMode: "DIRECT",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  const live = async () =>
    PublicProductResponseSchema.parse((await pub("bv", "/products/dp209-a")).body).product;

  beforeAll(async () => {
    admin = await staff(
      "seo-admin",
      [{ role: "platform_super_admin" }, { role: "product_publisher", site: BV }],
      root.userId,
    );
    id = await completeProduct("seo", "DP209-A");
    imageId = (await owner.productImage.findFirstOrThrow({ where: { productId: id } })).id;
    await republish();
  });

  it("publishes without any SEO; the public product carries empty SEO (fallbacks)", async () => {
    expect((await live()).seo).toEqual(EMPTY);
    expect(await sitemapPaths("bv")).toContain(path);
    // The admin listing answers its SEO.
    const detail = await bvEditor.get(`/products/${id}?siteId=${BV}`);
    expect(detail.body.listing.seo).toEqual(EMPTY);
  });

  it("saves the SEO on the listing (version + 1, audited by field name); live only after publishing", async () => {
    const before = await listingVersion(id, BV);
    const res = await saveSeo({
      title: "DP209-A base oil | Dream Petroleum BV",
      description: "A base oil for the DP-209 test, with a description long enough to count.",
      ogTitle: "Share DP209-A",
      ogDescription: "Share description",
      ogImageId: imageId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const saved = ListingSeoResponseSchema.parse(res.body);
    expect(saved.version).toBe(before + 1);
    expect(saved.seo).toMatchObject({ ogTitle: "Share DP209-A", ogImageId: imageId });
    const audit = await lastAudit("catalog.listing_seo_updated");
    expect(audit).toMatchObject({
      resourceType: "product_listing",
      siteId: BV,
      outcome: "SUCCESS",
    });
    expect((audit?.metadata as { changed: string[] }).changed).toEqual([
      "seoTitle",
      "seoDescription",
      "seoOgTitle",
      "seoOgDescription",
      "seoOgImageId",
    ]);
    expect(JSON.stringify(audit?.metadata)).not.toContain("Share DP209-A");
    // Not public yet: the snapshot is the published one; the listing reads as changed.
    expect((await live()).seo).toEqual(EMPTY);
    const wf = await admin.workflow(id);
    expect(wf.sites.find((s) => s.siteId === BV)!.outdated.listing).toBe(true);
    // SEO never blocks publishing.
    expect(wf.sites.find((s) => s.siteId === BV)!.readiness.ok).toBe(true);
    await republish();
    expect((await live()).seo).toMatchObject({
      title: "DP209-A base oil | Dream Petroleum BV",
      ogTitle: "Share DP209-A",
      ogImageId: imageId,
      noindex: false,
    });
    const snap = await owner.productPublication.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: BV } },
    });
    expect(readSnapshot(snap.snapshot, "en")?.seo?.ogImageId).toBe(imageId);
    // Corporate has its own listing: untouched by the BV SEO.
    const comListing = await owner.productSiteListing.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: COM } },
    });
    expect(comListing).toMatchObject({ seoTitle: null, seoOgTitle: null, seoOgImageId: null });
  });

  it("noindex and a canonical elsewhere leave the sitemap; the page stays live", async () => {
    expect((await saveSeo({ noindex: true })).status).toBe(200);
    expect(await sitemapPaths("bv")).toContain(path); // not published yet
    await republish();
    expect((await seo("bv", `/resolve?path=${path}`)).status).toBe(200);
    expect((await live()).seo.noindex).toBe(true);
    expect(await sitemapPaths("bv")).not.toContain(path);
    expect((await saveSeo({ canonicalPath: "/products/wf-p" })).status).toBe(200);
    await republish();
    expect(await sitemapPaths("bv")).not.toContain(path);
    expect((await saveSeo({ canonicalPath: path })).status).toBe(200);
    await republish();
    expect(await sitemapPaths("bv")).toContain(path);
    const o = SeoOverviewResponseSchema.parse(
      (await bvReader.getAbs(`/api/v1/admin/seo/sites/${BV}/overview`)).body,
    );
    expect(o.permissions).toMatchObject({ readProducts: true, editProducts: false });
    expect(o.items.find((i) => i.id === id)).toMatchObject({
      source: "product",
      path,
      live: true,
      pendingChanges: false,
      inSitemap: true,
    });
  });

  it("refuses unsafe canonicals, foreign or hidden images, stale versions and missing rights", async () => {
    expectError(
      await saveSeo({ canonicalPath: "https://evil.example/x" }),
      400,
      "VALIDATION_FAILED",
      {
        path: "canonicalPath",
        rule: "custom",
      },
    );
    const foreign = await owner.productImage.findFirstOrThrow({ where: { productId: P["p"] } });
    expectError(await saveSeo({ ogImageId: foreign.id }), 400, "VALIDATION_FAILED", {
      path: "ogImageId",
      rule: "unknown",
    });
    const lv = await listingVersion(id, BV);
    expectError(
      await bvEditor.post(seoUrl(), { ...EMPTY, version: lv - 1 }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    for (const who of [bvReader, comPublisher, nobody]) {
      expectError(await saveSeo({ title: "x" }, who), 403, "FORBIDDEN");
    }
    expect(await lastAudit("catalog.access_denied")).toMatchObject({
      outcome: "DENIED",
      resourceType: "product_listing",
    });
    expectError(
      await bvEditor.post(`/products/${id}/listings/${COM}/seo`, { ...EMPTY, version: 1 }),
      403,
      "FORBIDDEN",
    );
    expect(await listingVersion(id, BV)).toBe(lv);
    // The database refuses an unsafe canonical too.
    await rejectsDb(
      owner.productSiteListing.update({
        where: { productId_siteId: { productId: id, siteId: BV } },
        data: { seoCanonicalPath: "//evil.example" },
      }),
      /ProductSiteListing_seo_canonical_path/,
    );
  });

  it("an unpublished or hidden product is never indexed, whatever its SEO says", async () => {
    expect((await saveSeo({ noindex: false })).status).toBe(200);
    await republish();
    expect(await sitemapPaths("bv")).toContain(path);
    const row = await owner.productPublication.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: BV } },
    });
    const off = await admin.post(`/products/${id}/publications/${BV}/unpublish`, {
      version: row.version,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect((await seo("bv", `/resolve?path=${path}`)).status).toBe(404);
    expect(await sitemapPaths("bv")).not.toContain(path);
    expect((await pub("bv", "/products/dp209-a")).status).toBe(404);
  });
});

// ------------------------------------------------------------------------------------------
// 17. DP-210: a product's slug change keeps its old address (automatic 301)
// ------------------------------------------------------------------------------------------

describe("17. DP-210 product slug changes and automatic 301", () => {
  let admin: Staff; // approve (platform) + publish (BV and Corporate): publishes directly
  let id: string;
  const resolve = (p: string, site: Site = "bv") =>
    seo(site, `/resolve?path=${encodeURIComponent(p)}`);
  async function expectLive(p: string) {
    const res = await resolve(p);
    expect(res.status, `${p} ${JSON.stringify(res.body)}`).toBe(200);
    expect(PublicSeoResolveResponseSchema.parse(res.body)).toEqual({ path: p, kind: "product" });
  }
  async function expectRedirect(p: string, target: string) {
    const res = await resolve(p);
    expect(res.status, `${p} ${JSON.stringify(res.body)}`).toBe(200);
    expect(PublicSeoResolveResponseSchema.parse(res.body)).toEqual({
      path: p,
      redirect: { target, statusCode: 301 },
    });
  }
  async function setSlug(productId: string, slug: string): Promise<Res> {
    const p = await owner.product.findUniqueOrThrow({ where: { id: productId } });
    return pm.post(`/products/${productId}`, {
      version: p.version,
      code: p.code,
      slug,
      name: p.name,
      summary: p.summary,
      description: p.description,
    });
  }
  async function publish(productId: string, siteId: string = BV): Promise<Res> {
    return admin.post(`/products/${productId}/publications/${siteId}/publish`, {
      version: await version(productId),
      listingVersion: await listingVersion(productId, siteId),
      approvalMode: "DIRECT",
    });
  }
  async function move(productId: string, slug: string) {
    const saved = await setSlug(productId, slug);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const res = await publish(productId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return ProductWorkflowResponseSchema.parse(res.body).sites.find((s) => s.siteKey === "BV")!;
  }
  /** No active BV redirect starts at a live address or ends at another redirect's source. */
  async function expectConsistent() {
    const active = await owner.siteRedirect.findMany({ where: { siteId: BV, active: true } });
    const sources = new Set(active.map((r) => r.sourcePath));
    for (const r of active) {
      expect(sources.has(r.target.split("?")[0]!), `chain at ${r.sourcePath}`).toBe(false);
      expect((await resolve(r.sourcePath)).body?.redirect, r.sourcePath).toBeDefined();
    }
  }

  beforeAll(async () => {
    admin = await staff(
      "slug-admin",
      [
        { role: "platform_super_admin" },
        { role: "product_publisher", site: BV },
        { role: "product_publisher", site: COM },
      ],
      root.userId,
    );
    id = await completeProduct("slug", "DP210-A");
    expect((await publish(id)).status).toBe(200);
    expect((await publish(id, COM)).status).toBe(200);
  });

  it("a master slug change is a draft: the live address stays until the product is republished", async () => {
    await expectLive("/products/dp210-a");
    expect((await setSlug(id, "dp210-b")).status).toBe(200);
    await expectLive("/products/dp210-a");
    expectError(await resolve("/products/dp210-b"), 404, "NOT_FOUND");
    expect((await pub("bv", "/products/dp210-a")).status).toBe(200);
    expect(await sitemapPaths("bv")).toContain("/products/dp210-a");
    const wf = await admin.workflow(id);
    const bv = wf.sites.find((s) => s.siteKey === "BV")!;
    expect(bv.publication?.slug).toBe("dp210-a");
    expect(bv.addresses).toEqual({
      live: "/products/dp210-a",
      next: "/products/dp210-b",
      keepsOldAddress: true,
      redirectsHere: [],
    });
    expect(wf.sites.find((s) => s.siteKey === "CORPORATE")!.addresses.keepsOldAddress).toBe(false);
    expect(await owner.siteRedirect.count({ where: { contentId: id } })).toBe(0);
  });

  it("republishing makes the new address live and answers the old one with 301", async () => {
    const res = await publish(id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const bv = ProductWorkflowResponseSchema.parse(res.body).sites.find((s) => s.siteKey === "BV")!;
    expect(bv.addresses).toMatchObject({
      live: "/products/dp210-b",
      next: "/products/dp210-b",
      redirectsHere: ["/products/dp210-a"],
    });
    await expectLive("/products/dp210-b");
    await expectRedirect("/products/dp210-a", "/products/dp210-b");
    expect((await pub("bv", "/products/dp210-b")).status).toBe(200);
    const paths = await sitemapPaths("bv");
    expect(paths).toContain("/products/dp210-b");
    expect(paths).not.toContain("/products/dp210-a");
    const row = await owner.siteRedirect.findFirstOrThrow({ where: { contentId: id } });
    expect(row).toMatchObject({
      siteId: BV,
      sourcePath: "/products/dp210-a",
      target: "/products/dp210-b",
      statusCode: 301,
      active: true,
      origin: "SLUG_CHANGE",
      contentType: "PRODUCT",
      createdById: admin.userId,
    });
    expect((await lastAudit("seo.redirect_created"))?.metadata).toMatchObject({
      permission: "product:publish",
      contentType: "PRODUCT",
      sourcePath: "/products/dp210-a",
      target: "/products/dp210-b",
    });
    expect((await lastAudit("catalog.product_published_direct"))?.metadata).toMatchObject({
      republished: true,
      slugChanged: true,
    });
    // The Corporate publication still shows the old slug until it is republished there; the
    // Corporate site gets no redirects.
    expect((await pub("com", "/products/dp210-a")).status).toBe(200);
    expect((await publish(id, COM)).status).toBe(200);
    expect((await pub("com", "/products/dp210-b")).status).toBe(200);
    expect(await owner.siteRedirect.count({ where: { siteId: COM } })).toBe(0);
    expectError(await resolve("/products/dp210-a", "com"), 404, "NOT_FOUND");
  });

  it("collapses chains and never loops when the product returns to an old slug", async () => {
    await move(id, "dp210-c");
    await expectRedirect("/products/dp210-a", "/products/dp210-c");
    await expectRedirect("/products/dp210-b", "/products/dp210-c");
    const back = await move(id, "dp210-a");
    expect(back.addresses.redirectsHere).toEqual(["/products/dp210-b", "/products/dp210-c"]);
    await expectLive("/products/dp210-a");
    await expectRedirect("/products/dp210-b", "/products/dp210-a");
    await expectRedirect("/products/dp210-c", "/products/dp210-a");
    expect(
      (await owner.siteRedirect.findFirstOrThrow({ where: { sourcePath: "/products/dp210-a" } }))
        .active,
    ).toBe(false);
    await expectConsistent();
  });

  it("refuses malformed and taken slugs, a live address and the old addresses of another product", async () => {
    for (const slug of ["Bad Slug", "a/b", "-x", "x--y"]) {
      expectError(await setSlug(id, slug), 400, "VALIDATION_FAILED");
    }
    const other = await completeProduct("slug-other", "DP210-X");
    expectError(await setSlug(other, "dp210-a"), 409, "CONFLICT_STATE", {
      path: "slug",
      rule: "unique",
    });
    // The first product's master moves on (not yet republished): the address is still live.
    expect((await setSlug(id, "dp210-d")).status).toBe(200);
    expect((await setSlug(other, "dp210-a")).status).toBe(200);
    expectError(await publish(other), 409, "CONFLICT_STATE", {
      path: "slug",
      rule: "live_elsewhere",
    });
    await expectLive("/products/dp210-a");
    // Once it moved, /products/dp210-a is its old address: the other product is refused again
    // (409 old_address), the 301 and every row stay as they were.
    expect((await publish(id)).status).toBe(200);
    await expectRedirect("/products/dp210-a", "/products/dp210-d");
    const rows = await owner.siteRedirect.findMany({
      where: { siteId: BV, active: true },
      orderBy: { sourcePath: "asc" },
    });
    expectError(await publish(other), 409, "CONFLICT_STATE", {
      path: "slug",
      rule: "old_address",
    });
    expect(
      await owner.siteRedirect.findMany({
        where: { siteId: BV, active: true },
        orderBy: { sourcePath: "asc" },
      }),
    ).toEqual(rows);
    await expectRedirect("/products/dp210-a", "/products/dp210-d");
    await expectRedirect("/products/dp210-b", "/products/dp210-d");
    await expectRedirect("/products/dp210-c", "/products/dp210-d");
    // With a slug of its own the other product publishes normally.
    expect((await setSlug(other, "dp210-x")).status).toBe(200);
    expect((await publish(other)).status).toBe(200);
    await expectLive("/products/dp210-x");
    await expectLive("/products/dp210-d");
    const wf = await admin.workflow(id);
    expect(wf.sites.find((s) => s.siteKey === "BV")!.addresses.redirectsHere).toEqual([
      "/products/dp210-a",
      "/products/dp210-b",
      "/products/dp210-c",
    ]);
    await expectConsistent();
  });

  it("concurrent republishing of one product: exactly one publication, one redirect", async () => {
    expect((await setSlug(id, "dp210-e")).status).toBe(200);
    const [r1, r2] = await Promise.all([publish(id), publish(id)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    await expectLive("/products/dp210-e");
    await expectRedirect("/products/dp210-d", "/products/dp210-e");
    expect(
      await owner.siteRedirect.count({ where: { siteId: BV, sourcePath: "/products/dp210-d" } }),
    ).toBe(1);
    await expectConsistent();
  });

  it("taken off the site: the current address is 404, the old ones still lead there in one hop", async () => {
    const row = await owner.productPublication.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: BV } },
    });
    const off = await admin.post(`/products/${id}/publications/${BV}/unpublish`, {
      version: row.version,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expectError(await resolve("/products/dp210-e"), 404, "NOT_FOUND");
    await expectRedirect("/products/dp210-d", "/products/dp210-e");
    expect(await sitemapPaths("bv")).not.toContain("/products/dp210-e");
    // Publishing again at the same slug was not a move (it was not live): no new redirect.
    const before = await owner.siteRedirect.count({ where: { contentId: id } });
    expect((await publish(id)).status).toBe(200);
    expect(await owner.siteRedirect.count({ where: { contentId: id } })).toBe(before);
    await expectLive("/products/dp210-e");
  });
});

// ------------------------------------------------------------------------------------------
// 17. ML-8a (ADR-028 D8, DP-239, DP-214): catalogue texts per language, snapshot v2
// ------------------------------------------------------------------------------------------

describe("17. ML-8a catalogue texts per language", () => {
  let admin: Staff; // approve (platform) + publish (BV): publishes directly
  let comEditor: Staff; // product_editor @ CORPORATE
  let id: string;
  let imageId: string;
  const slug = "ml8a-a";
  /** ML-8b: other languages are published only when named (with the manual claim check). */
  async function republish(locales: string[] = []) {
    const res = await admin.post(`/products/${id}/publications/${BV}/publish`, {
      version: await version(id),
      listingVersion: await listingVersion(id, BV),
      approvalMode: "DIRECT",
      locales,
      manualReview: locales,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  const stored = async () =>
    (
      await owner.productPublication.findUniqueOrThrow({
        where: { productId_siteId: { productId: id, siteId: BV } },
      })
    ).snapshot;
  /** The public English output (list entry, product page, categories) without dates. */
  async function publicEnglish() {
    const strip = (o: unknown) =>
      JSON.parse(JSON.stringify(o), (k, v) => (k === "publishedAt" ? undefined : v));
    const list = PublicProductListResponseSchema.parse((await pub("bv", "/products")).body);
    const page = PublicProductResponseSchema.parse((await pub("bv", `/products/${slug}`)).body);
    const cats = PublicCategoryListResponseSchema.parse((await pub("bv", "/categories")).body);
    return JSON.stringify(
      strip({
        item: list.items.find((i) => i.slug === slug),
        page,
        cats,
        sitemap: await sitemapPaths("bv"),
      }),
    );
  }
  const imageVersion = async () =>
    (await owner.productImage.findUniqueOrThrow({ where: { id: imageId } })).version;

  beforeAll(async () => {
    admin = await staff(
      "ml8a-admin",
      [{ role: "platform_super_admin" }, { role: "product_publisher", site: BV }],
      root.userId,
    );
    comEditor = await staff(
      "ml8a-com-editor",
      [{ role: "product_editor", site: COM }],
      root.userId,
    );
    id = await completeProduct("ml8a", "ML8A-A");
    imageId = (await owner.productImage.findFirstOrThrow({ where: { productId: id } })).id;
    await republish();
  });

  it("migration 39: English rows mirror the English columns (created through the API of before ML-8a)", async () => {
    const cat = await owner.productCategory.findUniqueOrThrow({ where: { id: bvCategory } });
    expect(
      await owner.productCategoryText.findUniqueOrThrow({
        where: { categoryId_locale: { categoryId: bvCategory, locale: "en" } },
      }),
    ).toMatchObject({ siteId: BV, name: cat.name, description: cat.description });
    const def = await owner.specDefinition.findUniqueOrThrow({ where: { id: kvDef } });
    expect(
      (
        await owner.specDefinitionText.findUniqueOrThrow({
          where: { definitionId_locale: { definitionId: kvDef, locale: "en" } },
        })
      ).name,
    ).toBe(def.name);
    expect(
      (
        await owner.productImageText.findUniqueOrThrow({
          where: { imageId_locale: { imageId, locale: "en" } },
        })
      ).altText,
    ).toBe("Drum of the product");
    // dp_app may read and write the new tables (default privileges of dp_owner)
    expect(await asApp.productCategoryText.count({ where: { categoryId: bvCategory } })).toBe(1);
  });

  it("a new publication is v2 with English only; its English view equals the v1 shape", async () => {
    const snap = parseStoredSnapshot(await stored());
    expect(snap?.schemaVersion).toBe(2);
    expect(Object.keys((snap as { locales: object }).locales)).toEqual(["en"]);
    const en = localizeSnapshot(snap!, "en");
    expect(en).toMatchObject({
      schemaVersion: 1,
      slug,
      name: "ML8A-A for BV",
      summary: "Summary of ML8A-A",
      category: { slug: "base-oils", name: "Base oils" },
    });
    expect(en?.specs[0]).toMatchObject({ key: "kv100", name: "Kinematic viscosity at 100 °C" });
    expect(readSnapshot(await stored(), "nl")).toBeNull();
  });

  it("a v1 snapshot of before ML-8a stays readable: the public output is the same as from v2", async () => {
    const v2Output = await publicEnglish();
    const row = await owner.productPublication.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: BV } },
    });
    const v1 = readSnapshot(row.snapshot, "en");
    // replaced the way a publication replaces it (new publishedAt), as before ML-8a stored it
    await owner.productPublication.update({
      where: { id: row.id },
      data: { snapshot: v1!, publishedAt: new Date(), version: { increment: 1 } },
    });
    expect(parseStoredSnapshot(await stored())?.schemaVersion).toBe(1);
    expect(await publicEnglish()).toBe(v2Output);
    await republish();
    expect(parseStoredSnapshot(await stored())?.schemaVersion).toBe(2);
    expect(await publicEnglish()).toBe(v2Output);
  });

  it("the public catalogue takes ?locale: Dutch is 404 while nl is not public (ML-8c)", async () => {
    const plain = (await pub("bv", `/products/${slug}`)).body;
    expect((await pub("bv", `/products/${slug}?locale=en`)).body).toEqual(plain);
    expectError(await pub("bv", `/products/${slug}?locale=nl`), 404, "NOT_FOUND");
    expectError(await pub("bv", "/products?locale=nl"), 404, "NOT_FOUND");
    expectError(await pub("bv", "/categories?locale=nl"), 404, "NOT_FOUND");
    expectError(await pub("bv", "/products?locale=EN"), 404, "NOT_FOUND");
    expectError(await pub("com", "/products?locale=nl"), 404, "NOT_FOUND");
  });

  it("Dutch listing texts: product:edit of the site, listing version + 1, audited; enabled languages only", async () => {
    const url = `/products/${id}/listings/${BV}/texts/nl`;
    const body = async () => ({
      version: await listingVersion(id, BV),
      title: null,
      summary: "Synthetische basisolie voor ML-8a.",
      description: null,
      seo: { title: "ML8A-A basisolie", description: null, ogTitle: null, ogDescription: null },
    });
    expectError(await bvReader.post(url, await body()), 403, "FORBIDDEN");
    expectError(await comEditor.post(url, await body()), 403, "FORBIDDEN");
    // Corporate has no Dutch
    const comUrl = `/products/${id}/listings/${COM}/texts/nl`;
    expectError(
      await comEditor.post(comUrl, { ...(await body()), version: await listingVersion(id, COM) }),
      409,
      "CONFLICT_STATE",
      { path: "locale", rule: "not_enabled" },
    );
    expectError(
      await bvEditor.post(`/products/${id}/listings/${BV}/texts/xx-`, await body()),
      404,
      "NOT_FOUND",
    );
    const before = await listingVersion(id, BV);
    const englishBefore = await publicEnglish();
    const res = await bvEditor.post(url, await body());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ locale: "nl", version: before + 1 });
    expect(await lastAudit("catalog.listing_translation_updated")).toMatchObject({
      siteId: BV,
      outcome: "SUCCESS",
      metadata: { locale: "nl", changed: ["summary", "seoTitle"], version: before + 1 },
    });
    // stale
    expectError(
      await bvEditor.post(url, { ...(await body()), version: before }),
      409,
      "CONFLICT_STATE",
      {
        path: "version",
        rule: "stale",
      },
    );
    // English untouched: rows and the live site
    const en = await owner.productListingText.findMany({ where: { siteId: BV, locale: "en" } });
    expect(en.every((t) => t.summary !== "Synthetische basisolie voor ML-8a.")).toBe(true);
    expect(await publicEnglish()).toBe(englishBefore);
  });

  it("ML-8b: an English publication leaves the Dutch draft out; an incomplete Dutch cannot be chosen", async () => {
    const englishBefore = await publicEnglish();
    await republish();
    const snap = parseStoredSnapshot(await stored())!;
    // ML-8b (DP-257): the Dutch draft is not published with the English publication
    expect(Object.keys((snap as { locales: object }).locales)).toEqual(["en"]);
    expect(readSnapshot(snap, "nl")).toBeNull();
    // chosen while incomplete (no category or specification name yet): refused, nothing written
    const res = await admin.post(`/products/${id}/publications/${BV}/publish`, {
      version: await version(id),
      listingVersion: await listingVersion(id, BV),
      approvalMode: "DIRECT",
      locales: ["nl"],
      manualReview: ["nl"],
    });
    expectError(res, 409, "CONFLICT_STATE", { path: "nl:category", rule: "translation_missing" });
    expect(res.body.error.details).toContainEqual({
      path: "nl:spec:kv100",
      rule: "translation_missing",
    });
    expect(await stored()).toEqual(snap);
    expect(snapshotCoverage(snap).map((c) => c.locale)).toEqual(["en"]);
    // the English output did not change
    expect(await publicEnglish()).toBe(englishBefore);
    expect(await lastAudit("catalog.product_published_direct")).toMatchObject({
      metadata: { locales: ["en"], writtenLocales: ["en"] },
    });
  });

  it("category, specification and alt texts per language (permissions, versions, approval reset)", async () => {
    // category: product:edit of its site
    const cat = await owner.productCategory.findUniqueOrThrow({ where: { id: bvCategory } });
    const catUrl = `/categories/${bvCategory}/texts/nl`;
    expectError(
      await comEditor.post(catUrl, { version: cat.version, name: "Basisoliën" }),
      404,
      "NOT_FOUND",
    );
    expectError(
      await bvEditor.post(catUrl, { version: cat.version, name: null, description: "x" }),
      400,
      "VALIDATION_FAILED",
    );
    const c = await bvEditor.post(catUrl, { version: cat.version, name: "Basisoliën" });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body).toMatchObject({ name: "Basisoliën", version: cat.version + 1 });
    // the English column is not touched by Dutch
    expect(
      (await owner.productCategory.findUniqueOrThrow({ where: { id: bvCategory } })).name,
    ).toBe(cat.name);
    // specification: product_master:edit (platform)
    const def = await owner.specDefinition.findUniqueOrThrow({ where: { id: kvDef } });
    const defUrl = `/spec-definitions/${kvDef}/texts/nl`;
    expectError(await bvEditor.post(defUrl, { version: def.version, name: "x" }), 403, "FORBIDDEN");
    const d = await pm.post(defUrl, {
      version: def.version,
      name: "Kinematische viscositeit bij 100 °C",
    });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    // an English name cannot be removed
    expectError(
      await pm.post(`/spec-definitions/${kvDef}/texts/en`, {
        version: def.version + 1,
        name: null,
      }),
      400,
      "VALIDATION_FAILED",
    );
    // image alt text: master content, resets nothing for a DRAFT but bumps the master version
    const v = await version(id);
    const i = await pm.post(`/images/${imageId}/texts/nl`, {
      version: await imageVersion(),
      altText: "Vat van het product",
    });
    expect(i.status, JSON.stringify(i.body)).toBe(200);
    expect(await version(id)).toBe(v + 1);
    expect((await owner.productImage.findUniqueOrThrow({ where: { id: imageId } })).altText).toBe(
      "Drum of the product",
    );
    // the translations view shows each unit next to English
    const t = ProductTranslationsResponseSchema.parse(
      (await bvReader.get(`/products/${id}/translations?siteId=${BV}&locale=nl`)).body,
    );
    expect(t).toMatchObject({ locale: "nl", defaultLocale: "en", enabled: true });
    expect(t.category?.name).toEqual({ value: "Basisoliën", source: "Base oils" });
    expect(t.specs[0]?.name.value).toBe("Kinematische viscositeit bij 100 °C");
    expect(t.images[0]?.altText).toEqual({
      value: "Vat van het product",
      source: "Drum of the product",
    });
    expect(t.listing?.summary.value).toBe("Synthetische basisolie voor ML-8a.");
    expectError(
      await nobody.get(`/products/${id}/translations?siteId=${BV}&locale=nl`),
      403,
      "FORBIDDEN",
    );
  });

  it("complete Dutch after republishing; still not public (nl public=false)", async () => {
    const englishBefore = await publicEnglish();
    await republish(["nl"]);
    const nl = readSnapshot(await stored(), "nl");
    expect(nl).toMatchObject({
      name: "Product ML8A-A",
      summary: "Synthetische basisolie voor ML-8a.",
      description: null,
      category: { slug: "base-oils", name: "Basisoliën" },
    });
    expect(nl?.specs[0]?.name).toBe("Kinematische viscositeit bij 100 °C");
    expect(nl?.images[0]?.altText).toBe("Vat van het product");
    expect(nl?.seo?.title).toBe("ML8A-A basisolie");
    expectError(await pub("bv", `/products/${slug}?locale=nl`), 404, "NOT_FOUND");
    expect(await publicEnglish()).toBe(englishBefore);
  });

  it("English columns and rows stay in step in both directions (DP-214 SEO included)", async () => {
    // legacy endpoint (columns) → row
    const cat = await owner.productCategory.findUniqueOrThrow({ where: { id: bvCategory } });
    const up = await bvEditor.post(`/categories/${bvCategory}`, {
      version: cat.version,
      name: "Base oils",
      slug: "base-oils",
      parentId: null,
      description: "Mineral and synthetic base oils",
    });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(
      await owner.productCategoryText.findUniqueOrThrow({
        where: { categoryId_locale: { categoryId: bvCategory, locale: "en" } },
      }),
    ).toMatchObject({ description: "Mineral and synthetic base oils" });
    // row (translation endpoint, English) → column
    const c2 = await bvEditor.post(`/categories/${bvCategory}/texts/en`, {
      version: cat.version + 1,
      name: "Base oils",
      description: null,
    });
    expect(c2.status, JSON.stringify(c2.body)).toBe(200);
    expect(
      (await owner.productCategory.findUniqueOrThrow({ where: { id: bvCategory } })).description,
    ).toBeNull();
    // the English row cannot be removed while the category exists
    await rejectsDb(
      asApp.productCategoryText.delete({
        where: { categoryId_locale: { categoryId: bvCategory, locale: "en" } },
      }),
      /English text row mirrors/,
    );
    // SEO (DP-209 endpoint): written to the English listing text, the listing columns follow
    const seo = await bvEditor.post(`/products/${id}/listings/${BV}/seo`, {
      version: await listingVersion(id, BV),
      title: "ML8A-A base oil",
      description: null,
      ogTitle: "Share ML8A-A",
      ogDescription: null,
      canonicalPath: null,
      noindex: false,
      ogImageId: null,
    });
    expect(seo.status, JSON.stringify(seo.body)).toBe(200);
    const listing = await owner.productSiteListing.findUniqueOrThrow({
      where: { productId_siteId: { productId: id, siteId: BV } },
      include: { texts: true },
    });
    expect(listing).toMatchObject({ seoTitle: "ML8A-A base oil", seoOgTitle: "Share ML8A-A" });
    expect(listing.texts.find((t) => t.locale === "en")).toMatchObject({
      seoTitle: "ML8A-A base oil",
      seoOgTitle: "Share ML8A-A",
    });
    // Dutch SEO untouched
    expect(listing.texts.find((t) => t.locale === "nl")).toMatchObject({
      seoTitle: "ML8A-A basisolie",
    });
    // and the English alt text the other way round (legacy image endpoint)
    const img = await pm.post(`/images/${imageId}`, {
      altText: null,
      version: await imageVersion(),
    });
    expect(img.status, JSON.stringify(img.body)).toBe(200);
    expect(
      (
        await owner.productImageText.findUniqueOrThrow({
          where: { imageId_locale: { imageId, locale: "en" } },
        })
      ).altText,
    ).toBeNull();
    expect(
      (
        await owner.productImageText.findUniqueOrThrow({
          where: { imageId_locale: { imageId, locale: "nl" } },
        })
      ).altText,
    ).toBe("Vat van het product");
  });

  it("proposals in an enabled language; not in a language the site lacks", async () => {
    const proposer = await staff(
      "ml8a-proposer",
      [{ role: "product_editor", site: BV }],
      root.userId,
    );
    const body = {
      productId: id,
      summary: "Voorstel samenvatting.",
      description: null,
      reviewData: { schemaVersion: 1, family: null, items: [], sources: [] },
      sourceRef: "manual",
      sourceSha256: "c".repeat(64),
    };
    const nl = await proposer.post(`/sites/${BV}/proposals`, { ...body, locale: "nl" });
    expect(nl.status, JSON.stringify(nl.body)).toBe(201);
    expectError(
      await proposer.post(`/sites/${BV}/proposals`, { ...body, locale: "de" }),
      409,
      "CONFLICT_STATE",
      {
        path: "locale",
        rule: "not_enabled",
      },
    );
    // the Dutch proposal does not gate the English publication (the default language's does)
    const wf = await admin.workflow(id);
    expect(wf.sites.find((x) => x.siteId === BV)?.proposal).toBeNull();
  });

  it("migration 39: rollback (header) and a re-run on existing data, in a rolled-back transaction", async () => {
    const sql = readFileSync(
      path.join(API_DIR, "prisma/migrations/20261212090000_ml_8a_catalog_texts/migration.sql"),
      "utf8",
    );
    const rollback = sql
      .split("-- Rollback")[1]!
      .split("-- ===")[0]!
      .split("\n")
      .filter((l) => l.startsWith("--   ") && !l.startsWith("--   ("))
      .map((l) => l.slice(5).trim().replace(/;$/, ""));
    expect(rollback).toHaveLength(15);
    // ML-8b: migration 40 lives on these tables, so it is rolled back first and re-run last.
    const ml8b = ml8bRollbackStatements();
    expect(ml8b).toHaveLength(4);
    const ml8bForward = forwardStatements(
      readFileSync(path.join(API_DIR, `prisma/migrations/${ML8B_MIGRATION}/migration.sql`), "utf8"),
    );
    const forward: string[] = [];
    let cur = "";
    let inBody = false;
    for (const line of sql.split("\n")) {
      if (!inBody && /^\s*--/.test(line)) continue;
      cur += `${line}\n`;
      if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inBody = !inBody;
      if (!inBody && /;\s*$/.test(line)) {
        if (cur.trim()) forward.push(cur.trim());
        cur = "";
      }
    }
    const legacy = async (tx: PrismaClient) => ({
      categories: await tx.productCategory.findMany({ orderBy: { id: "asc" } }),
      definitions: await tx.specDefinition.findMany({ orderBy: { id: "asc" } }),
      images: await tx.productImage.findMany({ orderBy: { id: "asc" } }),
      listings: await tx.productSiteListing.findMany({ orderBy: { id: "asc" } }),
      publications: await tx.productPublication.findMany({ orderBy: { id: "asc" } }),
    });
    const before = await legacy(owner);
    const nlBefore = await owner.productListingText.count({ where: { locale: "nl" } });
    expect(nlBefore).toBeGreaterThan(0);
    await expect(
      owner.$transaction(
        async (t) => {
          const tx = t as unknown as PrismaClient;
          for (const st of ml8b) await tx.$executeRawUnsafe(st);
          for (const st of rollback) await tx.$executeRawUnsafe(st);
          const gone = await tx.$queryRaw<{ n: bigint }[]>`
            SELECT count(*)::bigint AS n FROM pg_class
            WHERE relname IN ('ProductCategoryText', 'SpecDefinitionText', 'ProductImageText')`;
          expect(Number(gone[0]?.n)).toBe(0);
          // every English text is still in the columns of before ML-8a
          expect(await legacy(tx)).toEqual(before);
          for (const st of forward) await tx.$executeRawUnsafe(st);
          for (const st of ml8bForward) await tx.$executeRawUnsafe(st);
          expect(await legacy(tx)).toEqual(before);
          // the English rows are back and equal to the columns; translations are gone
          const cats = await tx.productCategoryText.findMany({ where: { locale: "en" } });
          expect(cats.length).toBe(before.categories.length);
          for (const c of before.categories) {
            expect(cats.find((x) => x.categoryId === c.id)).toMatchObject({
              name: c.name,
              description: c.description,
            });
          }
          const defs = await tx.specDefinitionText.findMany({ where: { locale: "en" } });
          expect(defs.map((d) => [d.definitionId, d.name]).sort()).toEqual(
            before.definitions.map((d) => [d.id, d.name]).sort(),
          );
          const alts = await tx.productImageText.findMany();
          expect(alts.map((a) => [a.imageId, a.altText]).sort()).toEqual(
            before.images
              .filter((i) => i.altText)
              .map((i) => [i.id, i.altText])
              .sort(),
          );
          for (const l of before.listings.filter((x) => x.seoTitle || x.seoOgTitle)) {
            expect(
              await tx.productListingText.findUniqueOrThrow({
                where: { listingId_locale: { listingId: l.id, locale: "en" } },
              }),
            ).toMatchObject({ seoTitle: l.seoTitle, seoOgTitle: l.seoOgTitle });
          }
          expect(await tx.productListingText.count({ where: { locale: "nl" } })).toBe(0);
          throw new Error("rolled back by the test");
        },
        { timeout: 60_000 },
      ),
    ).rejects.toThrow("rolled back by the test");
    expect(await owner.productListingText.count({ where: { locale: "nl" } })).toBe(nlBefore);
  });

  it("a deleted category takes its texts with it (cascade), the English guard does not block it", async () => {
    const c = await bvEditor.post(`/sites/${BV}/categories`, {
      name: "Empty ML8A",
      slug: "empty-ml8a",
      parentId: bvCategory,
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const cid = c.body.category.id;
    const nl = await bvEditor.post(`/categories/${cid}/texts/nl`, {
      version: c.body.category.version,
      name: "Leeg ML8A",
    });
    expect(nl.status, JSON.stringify(nl.body)).toBe(200);
    expect(await owner.productCategoryText.count({ where: { categoryId: cid } })).toBe(2);
    expect((await bvEditor.del(`/categories/${cid}`)).status).toBe(204);
    expect(await owner.productCategoryText.count({ where: { categoryId: cid } })).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------
// 18. ML-8b: admin language tabs — translation states, source revisions, languages of a
//     publication and the manual claim check (ADR-028 D8, DP-239, DP-257)
// ------------------------------------------------------------------------------------------

const ML8B_MIGRATION = "20261213090000_ml_8b_translation_source";

/** The rollback statements of migration 40 from its header comment. */
function ml8bRollbackStatements(): string[] {
  const sql = readFileSync(
    path.join(API_DIR, `prisma/migrations/${ML8B_MIGRATION}/migration.sql`),
    "utf8",
  );
  return sql
    .split("-- Rollback")[1]!
    .split("-- ML-8a (39)")[0]!
    .split("\n")
    .filter((l) => l.startsWith("--   ") && !l.startsWith("--   ("))
    .map((l) => l.slice(5).trim().replace(/;$/, ""));
}

/** The statements of a migration (comments outside function bodies dropped). */
function forwardStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inBody = false;
  for (const line of sql.split("\n")) {
    if (!inBody && /^\s*--/.test(line)) continue;
    cur += `${line}\n`;
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inBody = !inBody;
    if (!inBody && /;\s*$/.test(line)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    }
  }
  return out;
}

const sha = (values: (string | null)[]) =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");

describe("18. ML-8b language tabs: states, source revisions, languages of a publication", () => {
  let admin: Staff; // approve (platform) + publish (BV): publishes directly
  let id: string;
  let imageId: string;
  let listingId: string;
  let cat: string;
  const slug = "ml8b-a";
  const tr = async (who: Staff, locale = "nl") => {
    const res = await who.get(`/products/${id}/translations?siteId=${BV}&locale=${locale}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return ProductTranslationsResponseSchema.parse(res.body);
  };
  const publish = async (body: Record<string, unknown> = {}, who?: Staff) =>
    (who ?? admin).post(`/products/${id}/publications/${BV}/publish`, {
      version: await version(id),
      listingVersion: await listingVersion(id, BV),
      approvalMode: "DIRECT",
      ...body,
    });
  const stored = async () =>
    (
      await owner.productPublication.findUniqueOrThrow({
        where: { productId_siteId: { productId: id, siteId: BV } },
      })
    ).snapshot;
  const nlRow = () =>
    owner.productListingText.findUnique({
      where: { listingId_locale: { listingId, locale: "nl" } },
    });
  const saveNl = async (
    texts: { title?: string | null; summary?: string | null; description?: string | null },
    sections: string[] = ["texts"],
    who: Staff = bvEditor,
  ) =>
    who.post(`/products/${id}/listings/${BV}/texts/nl`, {
      version: await listingVersion(id, BV),
      sections,
      title: null,
      summary: null,
      description: null,
      ...texts,
    });
  const catVersion = async () =>
    (await owner.productCategory.findUniqueOrThrow({ where: { id: cat } })).version;
  const defVersion = async () =>
    (await owner.specDefinition.findUniqueOrThrow({ where: { id: kvDef } })).version;
  const imgVersion = async () =>
    (await owner.productImage.findUniqueOrThrow({ where: { id: imageId } })).version;
  /** The public English product page without its publication date. */
  const publicPage = async () =>
    JSON.stringify((await pub("bv", `/products/${slug}`)).body, (k, v) =>
      k === "publishedAt" ? undefined : v,
    );

  beforeAll(async () => {
    admin = await staff(
      "ml8b-admin",
      [{ role: "platform_super_admin" }, { role: "product_publisher", site: BV }],
      root.userId,
    );
    id = await completeProduct("ml8b", "ML8B-A");
    imageId = (await owner.productImage.findFirstOrThrow({ where: { productId: id } })).id;
    const c = await bvEditor.post(`/sites/${BV}/categories`, {
      name: "ML8B oils",
      slug: "ml8b-oils",
      parentId: null,
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    cat = c.body.category.id;
    const l = await bvEditor.post(`/products/${id}/listings/${BV}`, {
      version: await listingVersion(id, BV),
      categoryId: cat,
      visibility: "VISIBLE",
      title: "ML8B-A for BV",
    });
    expect(l.status, JSON.stringify(l.body)).toBe(200);
    listingId = l.body.listing.id;
    // the specification name in Dutch, written against today's English name
    const d = await pm.post(`/spec-definitions/${kvDef}/texts/nl`, {
      version: await defVersion(),
      name: "Kinematische viscositeit bij 100 °C",
    });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    const res = await publish();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("migration 40: source hashes are null or lower-case hex SHA-256 (CHECK)", async () => {
    const bad = "Z".repeat(64);
    await rejectsDb(
      owner.productListingText.update({
        where: { listingId_locale: { listingId, locale: "en" } },
        data: { seoSourceHash: bad },
      }),
      /ProductListingText_seoSourceHash_format/,
    );
    await rejectsDb(
      owner.productCategoryText.update({
        where: { categoryId_locale: { categoryId: cat, locale: "en" } },
        data: { sourceHash: "a".repeat(63) + "G" },
      }),
      /ProductCategoryText_sourceHash_format/,
    );
    await rejectsDb(
      owner.specDefinitionText.update({
        where: { definitionId_locale: { definitionId: kvDef, locale: "en" } },
        data: { sourceHash: bad },
      }),
      /SpecDefinitionText_sourceHash_format/,
    );
    await rejectsDb(
      owner.productImageText.update({
        where: { imageId_locale: { imageId, locale: "en" } },
        data: { sourceHash: bad },
      }),
      /ProductImageText_sourceHash_format/,
    );
    // the default-language rows are the source: no hash
    const en = await owner.productListingText.findUniqueOrThrow({
      where: { listingId_locale: { listingId, locale: "en" } },
    });
    expect([en.sourceHash, en.seoSourceHash]).toEqual([null, null]);
  });

  it("a new language starts Missing: nothing copied, the required units listed, English next to it", async () => {
    const t = await tr(bvReader);
    expect(t).toMatchObject({
      locale: "nl",
      defaultLocale: "en",
      enabled: true,
      public: false,
      live: { published: true, hasLocale: false },
    });
    expect(t.locales.map((l) => l.locale)).toEqual(["en", "nl"]);
    expect(t.listing).toMatchObject({ hasText: false, state: "MISSING" });
    // the source is what the English page shows: its own title, else the shared texts
    expect(t.listing?.title).toEqual({ value: null, source: "ML8B-A for BV" });
    expect(t.listing?.summary).toEqual({ value: null, source: "Summary of ML8B-A" });
    expect(t.listing?.sharedSource).toEqual({ title: false, summary: true, description: true });
    expect(t.category).toMatchObject({
      state: "MISSING",
      name: { value: null, source: "ML8B oils" },
    });
    expect(t.requiredMissing).toEqual(["listing", "category"]);
    expect(t.missing).toEqual(expect.arrayContaining(["title", "summary", "description"]));
    expect(t.missing).toContain(`image:${imageId}`);
    expect(t.specs[0]).toMatchObject({ key: "kv100", state: "DRAFT" });
    expect(await nlRow()).toBeNull();
    // the English view of the same product: complete and live
    const en = await tr(bvReader, "en");
    expect(en.requiredMissing).toEqual([]);
    expect(en.listing?.state).toBe("PUBLISHED");
    expectError(
      await nobody.get(`/products/${id}/translations?siteId=${BV}&locale=nl`),
      403,
      "FORBIDDEN",
    );
  });

  it("saving Dutch records the source revision of the checked parts; Draft; nothing published", async () => {
    const live = await stored();
    const page = await publicPage();
    expectError(await saveNl({ summary: "x" }, ["texts"], bvReader), 403, "FORBIDDEN");
    expectError(
      await bvEditor.post(`/products/${id}/listings/${BV}/texts/nl`, {
        version: await listingVersion(id, BV),
        sections: ["specs"],
      }),
      400,
      "VALIDATION_FAILED",
    );
    const res = await saveNl({ summary: "Samenvatting van ML8B-A." });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await nlRow();
    expect(row?.sourceHash).toBe(
      sha(["ML8B-A for BV", "Summary of ML8B-A", "Description of ML8B-A"]),
    );
    expect(row?.seoSourceHash).toBeNull(); // the SEO part was not checked
    expect(await lastAudit("catalog.listing_translation_updated")).toMatchObject({
      metadata: { locale: "nl", checked: ["texts"] },
    });
    const c = await bvEditor.post(`/categories/${cat}/texts/nl`, {
      version: await catVersion(),
      name: "ML8B-oliën",
    });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(
      (
        await owner.productCategoryText.findUniqueOrThrow({
          where: { categoryId_locale: { categoryId: cat, locale: "nl" } },
        })
      ).sourceHash,
    ).toBe(sha(["ML8B oils", null]));
    const t = await tr(bvReader);
    expect([t.listing?.state, t.category?.state]).toEqual(["DRAFT", "DRAFT"]);
    expect(t.requiredMissing).toEqual([]);
    // nothing reached the site
    expect(await stored()).toEqual(live);
    expect(await publicPage()).toBe(page);
  });

  it("an English publication never carries the Dutch draft (DP-257)", async () => {
    const page = await publicPage();
    const res = await publish();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const snap = parseStoredSnapshot(await stored())!;
    expect(Object.keys((snap as { locales: object }).locales)).toEqual(["en"]);
    expect(await lastAudit("catalog.product_published_direct")).toMatchObject({
      metadata: { writtenLocales: ["en"], locales: ["en"] },
    });
    expect(await publicPage()).toBe(page);
    const wf = await admin.workflow(id);
    const langs = wf.sites.find((x) => x.siteId === BV)!.languages;
    expect(langs.map((l) => [l.locale, l.isDefault, l.live, l.state, l.claimScan])).toEqual([
      ["en", true, true, "PUBLISHED", "AUTOMATIC"],
      ["nl", false, false, "DRAFT", "MANUAL"],
    ]);
    expect(langs[1]).toMatchObject({ hasText: true, public: false, requiredMissing: [] });
    // Corporate has English only
    expect(wf.sites.find((x) => x.siteId === COM)!.languages.map((l) => l.locale)).toEqual(["en"]);
  });

  it("choosing Dutch: enabled and complete only, a confirmed manual check, the publisher's right", async () => {
    expectError(await publish({ locales: ["de"] }), 409, "CONFLICT_STATE", {
      path: "locale",
      rule: "not_enabled",
    });
    expectError(await publish({ locales: ["en"] }), 400, "VALIDATION_FAILED", {
      path: "locales",
      rule: "default_locale",
    });
    expectError(await publish({ manualReview: ["nl"] }), 400, "VALIDATION_FAILED", {
      path: "manualReview",
      rule: "not_chosen",
    });
    expectError(await publish({ locales: ["nl"] }), 409, "CONFLICT_STATE", {
      path: "nl",
      rule: "manual_review_required",
    });
    expectError(
      await publish({ locales: ["nl"], manualReview: ["nl"] }, bvEditor),
      403,
      "FORBIDDEN",
    );
    // incomplete: without the category name
    const c = await bvEditor.post(`/categories/${cat}/texts/nl`, {
      version: await catVersion(),
      name: null,
    });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expectError(await publish({ locales: ["nl"], manualReview: ["nl"] }), 409, "CONFLICT_STATE", {
      path: "nl:category",
      rule: "translation_missing",
    });
    const c2 = await bvEditor.post(`/categories/${cat}/texts/nl`, {
      version: await catVersion(),
      name: "ML8B-oliën",
    });
    expect(c2.status, JSON.stringify(c2.body)).toBe(200);
    const page = await publicPage();
    const ok = await publish({ locales: ["nl"], manualReview: ["nl"] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const nl = readSnapshot(await stored(), "nl");
    expect(nl).toMatchObject({
      name: "Product ML8B-A",
      summary: "Samenvatting van ML8B-A.",
      description: null,
      category: { slug: "ml8b-oils", name: "ML8B-oliën" },
    });
    expect(nl?.specs[0]?.name).toBe("Kinematische viscositeit bij 100 °C");
    expect(await lastAudit("catalog.product_published_direct")).toMatchObject({
      metadata: { writtenLocales: ["en", "nl"], manualReview: ["nl"], locales: ["en", "nl"] },
    });
    // the English page is the same; Dutch is not public (nl public=false; ML-8c section 19)
    expect(await publicPage()).toBe(page);
    expectError(await pub("bv", `/products/${slug}?locale=nl`), 404, "NOT_FOUND");
    const t = await tr(bvReader);
    expect(t.live.hasLocale).toBe(true);
    expect([t.listing?.state, t.category?.state, t.specs[0]?.state]).toEqual([
      "PUBLISHED",
      "PUBLISHED",
      "PUBLISHED",
    ]);
  });

  it("a later Dutch draft stays off the site: republishing keeps the live Dutch texts", async () => {
    // ML-8c (the 28th check of the ML-8b DEV isolation run, contract stated here): a Dutch draft
    // is a listing change (listing version + 1), so an English republication at the new version
    // is allowed (the DP-193 trigger records versions only with a new publication) — and it
    // publishes exactly the live content: the Dutch draft is not written, the snapshot is
    // byte-identical. DP-198 refuses the same request again at the same versions.
    const before = await stored();
    const listingBefore = await listingVersion(id, BV);
    const res = await saveNl({ summary: "Concept, nog niet nagekeken." });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await listingVersion(id, BV)).toBe(listingBefore + 1);
    expect((await tr(bvReader)).listing?.state).toBe("DRAFT");
    // the draft changed nothing public
    expect(await stored()).toEqual(before);
    const again = await publish();
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(await stored()).toEqual(before);
    expect(readSnapshot(await stored(), "nl")?.summary).toBe("Samenvatting van ML8B-A.");
    expect(await lastAudit("catalog.product_published_direct")).toMatchObject({
      metadata: { writtenLocales: ["en"], locales: ["en", "nl"] },
    });
    expect((await tr(bvReader)).listing?.state).toBe("DRAFT");
    // DP-198: the same content at the same versions is not published twice
    expectError(await publish(), 409, "CONFLICT_STATE", {
      path: "publication",
      rule: "already_published",
    });
    expect(await stored()).toEqual(before);
  });

  it("a changed English source makes Dutch Outdated; checking it again makes it current", async () => {
    // English summary of the site (legacy listing endpoint)
    const l = await bvEditor.post(`/products/${id}/listings/${BV}`, {
      version: await listingVersion(id, BV),
      categoryId: cat,
      visibility: "VISIBLE",
      title: "ML8B-A for BV",
      summary: "A new English summary.",
    });
    expect(l.status, JSON.stringify(l.body)).toBe(200);
    let t = await tr(bvReader);
    expect(t.listing?.state).toBe("OUTDATED");
    expect(t.listing?.summary.source).toBe("A new English summary.");
    const wf = await admin.workflow(id);
    expect(wf.sites.find((x) => x.siteId === BV)!.languages[1]?.state).toBe("OUTDATED");
    // saved again unchanged, checked against the new source
    const ok = await saveNl({ summary: "Concept, nog niet nagekeken." });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    t = await tr(bvReader);
    expect(t.listing?.state).toBe("DRAFT");
    // the SEO part alone does not clear the texts part
    await bvEditor.post(`/products/${id}/listings/${BV}`, {
      version: await listingVersion(id, BV),
      categoryId: cat,
      visibility: "VISIBLE",
      title: "ML8B-A for BV",
      summary: "Another English summary.",
    });
    await saveNl({ summary: "Concept, nog niet nagekeken." }, ["seo"]);
    expect((await tr(bvReader)).listing?.state).toBe("OUTDATED");
    // the specification name: English changed → Outdated; back to the old name → current again
    const en = await pm.post(`/spec-definitions/${kvDef}/texts/en`, {
      version: await defVersion(),
      name: "Kinematic viscosity at 100 °C (KV100)",
    });
    expect(en.status, JSON.stringify(en.body)).toBe(200);
    expect((await tr(bvReader)).specs[0]?.state).toBe("OUTDATED");
    const back = await pm.post(`/spec-definitions/${kvDef}/texts/en`, {
      version: await defVersion(),
      name: "Kinematic viscosity at 100 °C",
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect((await tr(bvReader)).specs[0]?.state).toBe("PUBLISHED");
    // the alt text: Dutch written against the English one, then the English one changes
    const a = await pm.post(`/images/${imageId}/texts/nl`, {
      version: await imgVersion(),
      altText: "Vat van ML8B-A",
    });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(
      (
        await owner.productImageText.findUniqueOrThrow({
          where: { imageId_locale: { imageId, locale: "nl" } },
        })
      ).sourceHash,
    ).toBe(sha(["Drum of the product"]));
    expect((await tr(bvReader)).images[0]?.state).toBe("DRAFT");
    const e = await pm.post(`/images/${imageId}`, {
      altText: "Steel drum of the product",
      version: await imgVersion(),
    });
    expect(e.status, JSON.stringify(e.body)).toBe(200);
    expect((await tr(bvReader)).images[0]?.state).toBe("OUTDATED");
  });

  it("category and specification lists per language: states, live counts, permissions", async () => {
    const cats = await bvReader.get(`/sites/${BV}/categories/translations?locale=nl`);
    expect(cats.status, JSON.stringify(cats.body)).toBe(200);
    const list = CategoryTranslationListResponseSchema.parse(cats.body);
    expect(list).toMatchObject({
      locale: "nl",
      defaultLocale: "en",
      enabled: true,
      canEdit: false,
    });
    expect(list.locales.map((l) => l.locale)).toEqual(["en", "nl"]);
    expect(list.items.find((i) => i.id === cat)).toMatchObject({
      slug: "ml8b-oils",
      liveProducts: 1,
      state: "PUBLISHED",
      name: { value: "ML8B-oliën", source: "ML8B oils" },
    });
    const forEditor = CategoryTranslationListResponseSchema.parse(
      (await bvEditor.get(`/sites/${BV}/categories/translations?locale=nl`)).body,
    );
    expect(forEditor.canEdit).toBe(true);
    expectError(
      await nobody.get(`/sites/${BV}/categories/translations?locale=nl`),
      403,
      "FORBIDDEN",
    );
    expectError(
      await bvReader.get(`/sites/${BV}/categories/translations?locale=xx-`),
      404,
      "NOT_FOUND",
    );
    // Corporate has no Dutch: readable, not enabled
    const com = await root.get(`/sites/${COM}/categories/translations?locale=nl`);
    expect(CategoryTranslationListResponseSchema.parse(com.body).enabled).toBe(false);

    const defs = await bvReader.get(`/spec-definitions/translations?locale=nl`);
    expect(defs.status, JSON.stringify(defs.body)).toBe(200);
    const d = SpecDefinitionTranslationListResponseSchema.parse(defs.body);
    expect(d).toMatchObject({ locale: "nl", sourceLocale: "en", enabled: true, canEdit: false });
    expect(d.locales).toEqual(["en", "nl"]);
    expect(d.items.find((i) => i.id === kvDef)).toMatchObject({
      key: "kv100",
      state: "PUBLISHED",
      name: {
        value: "Kinematische viscositeit bij 100 °C",
        source: "Kinematic viscosity at 100 °C",
      },
    });
    expect(
      SpecDefinitionTranslationListResponseSchema.parse(
        (await pm.get(`/spec-definitions/translations?locale=nl`)).body,
      ).canEdit,
    ).toBe(true);
    expectError(await nobody.get(`/spec-definitions/translations?locale=nl`), 403, "FORBIDDEN");
  });

  it("the publication preview shows one language: the next Dutch text next to the live one", async () => {
    const url = (locale: string, site = BV) =>
      `/products/${id}/sites/${site}/publication-preview?locale=${locale}`;
    const res = await bvReader.get(url("nl"));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const p = PublicationPreviewResponseSchema.parse(res.body);
    expect(p).toMatchObject({
      locale: "nl",
      public: false,
      claimScan: "MANUAL",
      requiredMissing: [],
    });
    expect(p.next?.summary).toBe("Concept, nog niet nagekeken.");
    expect(p.live?.summary).toBe("Samenvatting van ML8B-A.");
    expect(p.next?.category.name).toBe("ML8B-oliën");
    const en = PublicationPreviewResponseSchema.parse((await bvReader.get(url("en"))).body);
    expect(en).toMatchObject({ locale: "en", public: true, claimScan: "AUTOMATIC" });
    expect(en.next?.summary).toBe("Another English summary.");
    expectError(await bvReader.get(url("de")), 409, "CONFLICT_STATE", {
      path: "locale",
      rule: "not_enabled",
    });
    expectError(await root.get(url("nl", COM)), 409, "CONFLICT_STATE", {
      path: "locale",
      rule: "not_enabled",
    });
    expectError(await nobody.get(url("nl")), 403, "FORBIDDEN");
    // nothing was written
    expect(readSnapshot(await stored(), "nl")?.summary).toBe("Samenvatting van ML8B-A.");
  });

  it("DP-257: wording found in the Dutch text is listed; the manual check stays required", async () => {
    const res = await saveNl({ summary: "Geschikt als grondstof voor SAF." });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const wf = await admin.workflow(id);
    const nl = wf.sites.find((x) => x.siteId === BV)!.languages[1]!;
    expect(nl.claims.map((c) => c.key)).toEqual(["saf"]);
    expect(nl.claimScan).toBe("MANUAL");
    const p = PublicationPreviewResponseSchema.parse(
      (await bvReader.get(`/products/${id}/sites/${BV}/publication-preview?locale=nl`)).body,
    );
    expect(p.claims.map((c) => c.key)).toEqual(["saf"]);
    expectError(await publish({ locales: ["nl"] }), 409, "CONFLICT_STATE", {
      path: "nl",
      rule: "manual_review_required",
    });
  });

  it("the BV catalogue preview takes ?locale: Dutch from its own texts only, other languages 404", async () => {
    const reviewer = await staff(
      "ml8b-preview",
      [{ role: "product_publisher", site: BV }],
      root.userId,
    );
    const link = await reviewer.post(`/sites/${BV}/preview-link`);
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    const token = /\/preview\/catalog\/([^/]+)\/products$/.exec(
      CatalogPreviewLinkResponseSchema.parse(link.body).url,
    )![1]!;
    const get = async (p: string) =>
      parse(
        await fetch(`${base}/api/v1/public/catalog-preview/${token}${p}`, {
          headers: { "x-dp-proxy-key": KEY.bv },
        }),
      );
    const enRes = await get(`/products/${slug}`);
    expect(enRes.status, JSON.stringify(enRes.body)).toBe(200);
    expect(CatalogPreviewProductResponseSchema.parse(enRes.body).product.summary).toBe(
      "Another English summary.",
    );
    expect((await get(`/products/${slug}?locale=en`)).body).toEqual(enRes.body);
    const nlRes = await get(`/products/${slug}?locale=nl`);
    expect(nlRes.status, JSON.stringify(nlRes.body)).toBe(200);
    const nl = CatalogPreviewProductResponseSchema.parse(nlRes.body).product;
    expect(nl.summary).toBe("Geschikt als grondstof voor SAF.");
    expect(nl.category.name).toBe("ML8B-oliën");
    const list = CatalogPreviewListResponseSchema.parse((await get("/products?locale=nl")).body);
    // products without own Dutch text are not in the Dutch preview (no fallback to English)
    expect(list.items.map((i) => i.slug)).toContain(slug);
    expect(list.items.every((i) => i.slug !== "ml8a-a" || i.summary !== "Summary of ML8A-A")).toBe(
      true,
    );
    expect(list.categories.find((c) => c.slug === "ml8b-oils")?.name).toBe("ML8B-oliën");
    expect((await get(`/products/${slug}?locale=de`)).status).toBe(404);
    expect((await get(`/products/${slug}?locale=NL`)).status).toBe(404);
  });

  it("migration 40: rollback (header) and a re-run, in a rolled-back transaction", async () => {
    const rollback = ml8bRollbackStatements();
    expect(rollback).toHaveLength(4);
    const forward = forwardStatements(
      readFileSync(path.join(API_DIR, `prisma/migrations/${ML8B_MIGRATION}/migration.sql`), "utf8"),
    );
    const cols = async (tx: PrismaClient) =>
      Number(
        (
          await tx.$queryRaw<{ n: bigint }[]>`
            SELECT count(*)::bigint AS n FROM information_schema.columns
            WHERE column_name IN ('sourceHash', 'seoSourceHash')
              AND table_name IN ('ProductListingText', 'ProductCategoryText',
                                 'SpecDefinitionText', 'ProductImageText')`
        )[0]?.n,
      );
    const textsBefore = await owner.productListingText.findMany({
      where: { listingId },
      orderBy: { locale: "asc" },
      select: { locale: true, title: true, summary: true, description: true, seoTitle: true },
    });
    expect(await cols(owner)).toBe(5);
    await expect(
      owner.$transaction(
        async (t) => {
          const tx = t as unknown as PrismaClient;
          for (const st of rollback) await tx.$executeRawUnsafe(st);
          expect(await cols(tx)).toBe(0);
          // only hashes are lost: every text is still there
          const after = await tx.$queryRaw<{ locale: string; summary: string | null }[]>`
            SELECT "locale", "summary" FROM "ProductListingText" WHERE "listingId" = ${listingId}::uuid
            ORDER BY "locale"`;
          expect(after).toEqual(textsBefore.map((x) => ({ locale: x.locale, summary: x.summary })));
          for (const st of forward) await tx.$executeRawUnsafe(st);
          expect(await cols(tx)).toBe(5);
          throw new Error("rolled back by the test");
        },
        { timeout: 60_000 },
      ),
    ).rejects.toThrow("rolled back by the test");
    expect(await cols(owner)).toBe(5);
  });
});

// ------------------------------------------------------------------------------------------
// 19. ML-8c public catalogue per language (DP-239). `nl` is made public ONLY in this disposable
// test database, and set back to not public afterwards.
// ------------------------------------------------------------------------------------------
describe("19. ML-8c public catalogue per language", () => {
  let admin: Staff;
  let withNl: string;
  let enOnly: string;
  const NL_SLUG = "ml8c-a";
  const EN_SLUG = "ml8c-b";
  const setNlPublic = (value: boolean) =>
    owner.siteLocale.update({
      where: { siteId_locale: { siteId: BV, locale: "nl" } },
      data: { public: value },
    });
  const strip = (o: unknown) =>
    JSON.stringify(o, (k, v) => (k === "publishedAt" || k === "lastModified" ? undefined : v));
  /** Every public English catalogue read (list, categories, both products, documents, xrefs). */
  async function english() {
    return strip({
      list: (await pub("bv", "/products")).body,
      cats: (await pub("bv", "/categories")).body,
      a: (await pub("bv", `/products/${NL_SLUG}`)).body,
      b: (await pub("bv", `/products/${EN_SLUG}`)).body,
      docs: (await pub("bv", `/products/${NL_SLUG}/documents`)).body,
      xrefs: (await pub("bv", `/products/${NL_SLUG}/cross-references`)).body,
      resolve: (await seo("bv", `/resolve?path=/products/${NL_SLUG}`)).body,
    });
  }
  /** The live BV products whose publication has a complete Dutch text (what NL must list). */
  async function dutchSlugs(): Promise<string[]> {
    const rows = await owner.productPublication.findMany({
      where: { siteId: BV, status: "PUBLISHED", listing: { visibility: "VISIBLE" } },
      select: { snapshot: true },
    });
    return rows
      .map((r) => readSnapshot(r.snapshot, "nl")?.slug ?? null)
      .filter((x): x is string => x !== null)
      .sort();
  }
  async function publish(id: string, locales: string[] = []) {
    const res = await admin.post(`/products/${id}/publications/${BV}/publish`, {
      version: await version(id),
      listingVersion: await listingVersion(id, BV),
      approvalMode: "DIRECT",
      locales,
      manualReview: locales,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  beforeAll(async () => {
    admin = await staff(
      "ml8c-admin",
      [{ role: "platform_super_admin" }, { role: "product_publisher", site: BV }],
      root.userId,
    );
    withNl = await completeProduct("ml8c-a", "ML8C-A");
    enOnly = await completeProduct("ml8c-b", "ML8C-B");
    const nl = await bvEditor.post(`/products/${withNl}/listings/${BV}/texts/nl`, {
      version: await listingVersion(withNl, BV),
      title: "ML8C-A voor BV",
      summary: "Samenvatting van ML8C-A.",
      description: null,
      seo: {
        title: "ML8C-A basisolie",
        description: "Nederlandse metabeschrijving.",
        ogTitle: null,
        ogDescription: null,
      },
    });
    expect(nl.status, JSON.stringify(nl.body)).toBe(200);
    const img = await owner.productImage.findFirstOrThrow({ where: { productId: withNl } });
    const alt = await pm.post(`/images/${img.id}/texts/nl`, {
      version: img.version,
      altText: "Vat van ML8C-A",
    });
    expect(alt.status, JSON.stringify(alt.body)).toBe(200);
    // the category and specification names are Dutch already (section 17)
    await publish(withNl, ["nl"]);
    await publish(enOnly);
    expect(await dutchSlugs()).toContain(NL_SLUG);
    expect(await dutchSlugs()).not.toContain(EN_SLUG);
  });

  afterAll(async () => {
    await setNlPublic(false);
  });

  it("nl public=false: every Dutch catalogue, SEO and document read is a 404; nothing Dutch is listed", async () => {
    for (const p of [
      "/products?locale=nl",
      "/categories?locale=nl",
      `/products/${NL_SLUG}?locale=nl`,
      `/products/${NL_SLUG}/documents?locale=nl`,
      `/products/${NL_SLUG}/cross-references?locale=nl`,
    ]) {
      expectError(await pub("bv", p), 404, "NOT_FOUND");
    }
    expectError(await seo("bv", `/resolve?path=/products/${NL_SLUG}&locale=nl`), 404, "NOT_FOUND");
    const map = PublicSitemapResponseSchema.parse((await seo("bv", "/sitemap")).body);
    expect(map.entries.some((e) => e.locale === "nl")).toBe(false);
    expect(map.entries.flatMap((e) => e.alternates).some((a) => a.locale === "nl")).toBe(false);
  });

  it("nl public=true (isolated): Dutch lists exactly the products published in Dutch; English unchanged", async () => {
    const englishBefore = await english();
    await setNlPublic(true);
    try {
      expect(await english()).toBe(englishBefore);
      const list = PublicProductListResponseSchema.parse(
        (await pub("bv", "/products?locale=nl")).body,
      );
      expect(list.items.map((i) => i.slug).sort()).toEqual(await dutchSlugs());
      expect(list.items.map((i) => i.slug)).not.toContain(EN_SLUG);
      const a = list.items.find((i) => i.slug === NL_SLUG)!;
      expect(a).toMatchObject({ name: "ML8C-A voor BV", summary: "Samenvatting van ML8C-A." });
      // ML-8c: Dutch collation of the list (positions first, as in English)
      const names = list.items.map((i) => i.name);
      expect(names.length).toBe(list.items.length);
      // the English product is a 404 in Dutch, never its English text under a Dutch address
      expectError(await pub("bv", `/products/${EN_SLUG}?locale=nl`), 404, "NOT_FOUND");
      expectError(await pub("bv", `/products/${EN_SLUG}/documents?locale=nl`), 404, "NOT_FOUND");
      expectError(
        await pub("bv", `/products/${EN_SLUG}/cross-references?locale=nl`),
        404,
        "NOT_FOUND",
      );
      // other languages and malformed tags stay closed
      expectError(await pub("bv", "/products?locale=de"), 404, "NOT_FOUND");
      expectError(await pub("bv", "/products?locale=NL"), 404, "NOT_FOUND");
      expectError(await pub("com", "/products?locale=nl"), 404, "NOT_FOUND");
    } finally {
      await setNlPublic(false);
    }
  });

  it("a Dutch product page: Dutch texts, technical values and codes identical to English", async () => {
    await setNlPublic(true);
    try {
      const en = PublicProductResponseSchema.parse(
        (await pub("bv", `/products/${NL_SLUG}`)).body,
      ).product;
      const nl = PublicProductResponseSchema.parse(
        (await pub("bv", `/products/${NL_SLUG}?locale=nl`)).body,
      ).product;
      expect(nl).toMatchObject({
        slug: NL_SLUG,
        code: "ML8C-A",
        name: "ML8C-A voor BV",
        summary: "Samenvatting van ML8C-A.",
        category: { slug: "base-oils", name: "Basisoliën" },
      });
      expect(nl.seo).toMatchObject({
        title: "ML8C-A basisolie",
        description: "Nederlandse metabeschrijving.",
      });
      expect(nl.images[0]?.altText).toBe("Vat van ML8C-A");
      expect(en.images[0]?.altText).toBe("Drum of the product");
      // technical data: same keys, values, units, test methods; only the names are Dutch
      const tech = (p: typeof en) =>
        p.specs.map((x) => ({
          key: x.key,
          value: x.value,
          unit: x.unit,
          testMethod: x.testMethod,
        }));
      expect(tech(nl)).toEqual(tech(en));
      expect(nl.specs[0]?.name).toBe("Kinematische viscositeit bij 100 °C");
      expect(nl.code).toBe(en.code);
      expect(nl.images.map((i) => i.id)).toEqual(en.images.map((i) => i.id));
      // documents and cross-references are the same lists (documents are not translated)
      expect((await pub("bv", `/products/${NL_SLUG}/documents?locale=nl`)).body).toEqual(
        (await pub("bv", `/products/${NL_SLUG}/documents`)).body,
      );
      expect((await pub("bv", `/products/${NL_SLUG}/cross-references?locale=nl`)).body).toEqual(
        (await pub("bv", `/products/${NL_SLUG}/cross-references`)).body,
      );
      // categories in Dutch: names of the publications, counts of Dutch products only
      const cats = PublicCategoryListResponseSchema.parse(
        (await pub("bv", "/categories?locale=nl")).body,
      ).items;
      const base = cats.find((c) => c.slug === "base-oils")!;
      expect(base.name).toBe("Basisoliën");
      const enCats = PublicCategoryListResponseSchema.parse(
        (await pub("bv", "/categories")).body,
      ).items;
      expect(base.count).toBeLessThan(enCats.find((c) => c.slug === "base-oils")!.count);
    } finally {
      await setNlPublic(false);
    }
  });

  it("SEO in Dutch: resolve, sitemap entries and reciprocal product counterparts", async () => {
    await setNlPublic(true);
    try {
      const hit = PublicSeoResolveResponseSchema.parse(
        (await seo("bv", `/resolve?path=/products/${NL_SLUG}&locale=nl`)).body,
      );
      expect(hit).toEqual({ path: `/nl/products/${NL_SLUG}`, kind: "product" });
      expectError(
        await seo("bv", `/resolve?path=/products/${EN_SLUG}&locale=nl`),
        404,
        "NOT_FOUND",
      );
      const map = PublicSitemapResponseSchema.parse((await seo("bv", "/sitemap")).body).entries;
      const at = (locale: string, p: string) =>
        map.find((e) => e.locale === locale && e.path === p);
      const dutchProducts = map.filter((e) => e.locale === "nl" && e.kind === "product");
      // only indexable Dutch products (section 16/17 fixtures may carry noindex)
      for (const e of dutchProducts) {
        expect(await dutchSlugs()).toContain(e.path.replace("/products/", ""));
      }
      expect(at("nl", `/products/${NL_SLUG}`)?.alternates).toEqual([
        { locale: "en", path: `/products/${NL_SLUG}` },
      ]);
      expect(at("en", `/products/${NL_SLUG}`)?.alternates).toEqual([
        { locale: "nl", path: `/products/${NL_SLUG}` },
      ]);
      expect(at("en", `/products/${EN_SLUG}`)?.alternates).toEqual([]);
      expect(at("nl", `/products/${EN_SLUG}`)).toBeUndefined();
      expect(at("nl", "/products")?.alternates).toEqual([{ locale: "en", path: "/products" }]);
      expect(at("en", "/products")?.alternates).toEqual([{ locale: "nl", path: "/products" }]);
      // every alternate is itself listed (reciprocity)
      for (const e of map) {
        for (const a of e.alternates) expect(at(a.locale, a.path), a.path).toBeDefined();
      }
    } finally {
      await setNlPublic(false);
    }
    // back to not public: no Dutch entry at all
    const off = PublicSitemapResponseSchema.parse((await seo("bv", "/sitemap")).body).entries;
    expect(off.some((e) => e.locale === "nl")).toBe(false);
    expect(off.find((e) => e.path === `/products/${NL_SLUG}`)?.alternates).toEqual([]);
  });

  it("Outdated and drafts: the live Dutch text stays public until a reviewed republication", async () => {
    await setNlPublic(true);
    try {
      const live = (await pub("bv", `/products/${NL_SLUG}?locale=nl`)).body;
      // the English source changes: Dutch becomes Outdated, its publication is not removed
      const en = await bvEditor.post(`/products/${withNl}/listings/${BV}`, {
        version: await listingVersion(withNl, BV),
        categoryId: bvCategory,
        visibility: "VISIBLE",
        title: "ML8C-A for BV",
        summary: "A changed English summary.",
      });
      expect(en.status, JSON.stringify(en.body)).toBe(200);
      const t = ProductTranslationsResponseSchema.parse(
        (await bvReader.get(`/products/${withNl}/translations?siteId=${BV}&locale=nl`)).body,
      );
      expect(t.listing?.state).toBe("OUTDATED");
      expect((await pub("bv", `/products/${NL_SLUG}?locale=nl`)).body).toEqual(live);
      // a Dutch draft does not reach the site either
      const d = await bvEditor.post(`/products/${withNl}/listings/${BV}/texts/nl`, {
        version: await listingVersion(withNl, BV),
        sections: ["texts"],
        title: "ML8C-A voor BV",
        summary: "Concept, niet nagekeken.",
        description: null,
      });
      expect(d.status, JSON.stringify(d.body)).toBe(200);
      expect((await pub("bv", `/products/${NL_SLUG}?locale=nl`)).body).toEqual(live);
      // an English-only republication keeps the live Dutch texts (carried, not the draft)
      await publish(withNl);
      const after = PublicProductResponseSchema.parse(
        (await pub("bv", `/products/${NL_SLUG}?locale=nl`)).body,
      ).product;
      expect(after.summary).toBe("Samenvatting van ML8C-A.");
      // the new Dutch text needs its own publication with the manual check (DP-257)
      expectError(
        await admin.post(`/products/${withNl}/publications/${BV}/publish`, {
          version: await version(withNl),
          listingVersion: await listingVersion(withNl, BV),
          approvalMode: "DIRECT",
          locales: ["nl"],
        }),
        409,
        "CONFLICT_STATE",
        { path: "nl", rule: "manual_review_required" },
      );
      await publish(withNl, ["nl"]);
      expect(
        PublicProductResponseSchema.parse((await pub("bv", `/products/${NL_SLUG}?locale=nl`)).body)
          .product.summary,
      ).toBe("Concept, niet nagekeken.");
    } finally {
      await setNlPublic(false);
    }
  });

  it("taken off the site: a hidden listing or an unpublished product leaves the Dutch catalogue too", async () => {
    await setNlPublic(true);
    try {
      const row = await owner.productPublication.findUniqueOrThrow({
        where: { productId_siteId: { productId: withNl, siteId: BV } },
      });
      const off = await admin.post(`/products/${withNl}/publications/${BV}/unpublish`, {
        version: row.version,
        comment: null,
      });
      expect(off.status, JSON.stringify(off.body)).toBe(200);
      expectError(await pub("bv", `/products/${NL_SLUG}?locale=nl`), 404, "NOT_FOUND");
      expectError(
        await seo("bv", `/resolve?path=/products/${NL_SLUG}&locale=nl`),
        404,
        "NOT_FOUND",
      );
      const list = PublicProductListResponseSchema.parse(
        (await pub("bv", "/products?locale=nl")).body,
      );
      expect(list.items.map((i) => i.slug)).not.toContain(NL_SLUG);
      // published again: an English-only publication after an unpublication carries no Dutch
      // (nothing is live to carry); Dutch comes back only when it is chosen and checked again
      await publish(withNl);
      expectError(await pub("bv", `/products/${NL_SLUG}?locale=nl`), 404, "NOT_FOUND");
      await publish(withNl, ["nl"]);
      expect((await pub("bv", `/products/${NL_SLUG}?locale=nl`)).status).toBe(200);
    } finally {
      await setNlPublic(false);
    }
  });
});
