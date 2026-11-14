// PM-5 (DP-035): technical documents (TDS, SDS, COA, other PDFs) over HTTP and the database
// rules behind them, on a database of its own (DOCUMENTS_*_DATABASE_URL, a *_test database that
// starts EMPTY).
//
// Setup as in catalog-workflow.int.test.ts: migrations as dp_migrator, catalogue sync and
// bootstrap through the operator CLI, staff fixtures written as dp_owner, the API in-process from
// dist/ as dp_app, with the filesystem media storage in a temporary directory.
//
// Covers: RBAC (master edit vs. read vs. site publisher), IDOR and cross-site refusals with
// audit, PDF upload checks (type, size, active content, encryption) with FAILURE audit, revision
// numbering, immutability (trigger and column privileges) and active-revision selection,
// archiving and restoring, archived products, per-site visibility by the site's publisher, the
// public list and download (site from the key only, PM-3 publication state, fail-closed
// MEMBERS_ONLY / LEAD_REQUIRED / INTERNAL), and the media storage layout.
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
  ProductDocumentListResponseSchema,
  ProductDocumentResponseSchema,
  ProductWorkflowResponseSchema,
  PublicDocumentListResponseSchema,
  PublicProductListResponseSchema,
  type ProductDocument,
} from "@dream/contracts";
import { assertTestDatabaseUrl } from "@dream/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { ADMIN_ORIGIN, TEST_KEYS, apiTestEnv } from "./helpers/auth-env.js";
import { makePdf } from "../fixtures/pdf.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(API_DIR, "dist/iam/iam-cli.js");
const PRISMA = path.join(API_DIR, "node_modules/.bin/prisma");
const appUrl = assertTestDatabaseUrl(process.env["DOCUMENTS_DATABASE_URL"]);
const DB_NAME = appUrl.pathname.slice(1);
function bootstrapUrl(): string {
  const u = assertTestDatabaseUrl(process.env["IAM_BOOTSTRAP_DATABASE_URL"]);
  u.pathname = `/${DB_NAME}`;
  return assertTestDatabaseUrl(u.toString()).toString();
}
const urls = {
  app: appUrl.toString(),
  migrate: assertTestDatabaseUrl(process.env["DOCUMENTS_MIGRATE_DATABASE_URL"]).toString(),
  boot: bootstrapUrl(),
};
for (const shared of [
  process.env["DATABASE_URL"],
  process.env["AUTH_DATABASE_URL"],
  process.env["CATALOG_DATABASE_URL"],
  process.env["WORKFLOW_DATABASE_URL"],
]) {
  if (shared && new URL(shared).pathname === appUrl.pathname) {
    throw new Error("DOCUMENTS_DATABASE_URL must be a database of its own (it starts empty)");
  }
}
const ENV_BACKUP = { ...process.env };
const MEDIA_DIR = mkdtempSync(path.join(tmpdir(), "dp-documents-media-"));

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
  async uploadPdf(
    documentId: string,
    bytes: Buffer,
    opts: { type?: string; note?: string; name?: string; length?: number } = {},
  ): Promise<Res> {
    const headers: Record<string, string> = {
      ...this.headers(),
      origin: ADMIN_ORIGIN,
      "content-type": opts.type ?? "application/pdf",
    };
    if (opts.note !== undefined) headers["x-dp-revision-note"] = encodeURIComponent(opts.note);
    if (opts.name !== undefined) headers["x-dp-upload-filename"] = encodeURIComponent(opts.name);
    if (opts.length !== undefined) headers["content-length"] = String(opts.length);
    return parse(
      await fetch(`${base}/api/v1/admin/catalog/documents/${documentId}/revisions`, {
        method: "PUT",
        headers,
        body: new Uint8Array(bytes),
      }),
    );
  }
  async bytes(p: string) {
    const res = await fetch(`${base}/api/v1/admin/catalog${p}`, { headers: this.headers() });
    return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
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
        reason: "PM-5 documents test fixture",
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
  expect(Number(tables[0]?.n), "the documents test database must start empty").toBe(0);
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

/** Submit, approve and publish a complete product on one site (PM-3 workflow). */
async function publishOn(id: string, siteId: string, publisher: Staff): Promise<void> {
  const row = await owner.product.findUniqueOrThrow({ where: { id } });
  if (row.status !== "APPROVED") {
    const v = await version(id);
    expect((await pm.post(`/products/${id}/submit`, { version: v })).status).toBe(200);
    expect((await reviewer.post(`/products/${id}/approve`, { version: v + 1 })).status).toBe(200);
  }
  const res = await publisher.post(`/products/${id}/publications/${siteId}/publish`, {
    version: await version(id),
    listingVersion: await listingVersion(id, siteId),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function unpublishOn(id: string, siteId: string, publisher: Staff): Promise<void> {
  const wf = await publisher.workflow(id);
  const pub = wf.sites.find((s) => s.siteId === siteId)?.publication;
  expect(pub).toBeTruthy();
  const res = await publisher.post(`/products/${id}/publications/${siteId}/unpublish`, {
    version: pub!.version,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function createDoc(
  productId: string,
  input: Record<string, unknown> = {},
  as: Staff = pm,
): Promise<ProductDocument> {
  const res = await as.post(`/products/${productId}/documents`, {
    type: "TDS",
    title: "Technical data sheet",
    ...input,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return ProductDocumentResponseSchema.parse(res.body).document;
}

async function uploaded(documentId: string, pdf: Buffer, note?: string): Promise<ProductDocument> {
  const res = await pm.uploadPdf(documentId, pdf, {
    name: "TDS ICCSYN 6 – EN.pdf",
    ...(note ? { note } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return ProductDocumentResponseSchema.parse(res.body).document;
}

const docVersion = async (id: string) =>
  (await owner.productDocument.findUniqueOrThrow({ where: { id } })).version;

/** DP-086: the active revision a publisher confirms when showing a document on a site. */
async function activeRevisionId(documentId: string): Promise<string> {
  return (
    await owner.productDocumentRevision.findFirstOrThrow({
      where: { documentId, isActive: true },
      select: { id: true },
    })
  ).id;
}

// ------------------------------------------------------------------------------------------
// 1. Schema and privileges
// ------------------------------------------------------------------------------------------

describe("1. schema", () => {
  it("has the document enums and least-privilege grants for dp_app", async () => {
    const labels = await owner.$queryRaw<{ l: string }[]>`
      SELECT e.enumlabel AS l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'DocumentAccessPolicy' ORDER BY e.enumsortorder`;
    expect(labels.map((r) => r.l)).toEqual(["PUBLIC", "MEMBERS_ONLY", "LEAD_REQUIRED", "INTERNAL"]);
    const priv = await owner.$queryRaw<{ t: string; p: string }[]>`
      SELECT table_name AS t, privilege_type AS p FROM information_schema.role_table_grants
      WHERE grantee = 'dp_app'
        AND table_name IN ('ProductDocument', 'ProductDocumentRevision', 'ProductDocumentSite')
      ORDER BY 1, 2`;
    expect(priv.map((r) => `${r.t}:${r.p}`)).toEqual([
      "ProductDocument:INSERT",
      "ProductDocument:SELECT",
      "ProductDocument:UPDATE",
      "ProductDocumentRevision:INSERT",
      "ProductDocumentRevision:SELECT",
      "ProductDocumentSite:DELETE",
      "ProductDocumentSite:INSERT",
      "ProductDocumentSite:SELECT",
    ]);
    const cols = await owner.$queryRaw<{ c: string }[]>`
      SELECT column_name AS c FROM information_schema.column_privileges
      WHERE grantee = 'dp_app' AND table_name = 'ProductDocumentRevision'
        AND privilege_type = 'UPDATE'`;
    expect(cols.map((r) => r.c)).toEqual(["isActive"]);
    // DP-086: a site row may only move its pin (revision and time); nothing else changes.
    const siteCols = await owner.$queryRaw<{ c: string }[]>`
      SELECT column_name AS c FROM information_schema.column_privileges
      WHERE grantee = 'dp_app' AND table_name = 'ProductDocumentSite'
        AND privilege_type = 'UPDATE' ORDER BY 1`;
    expect(siteCols.map((r) => r.c)).toEqual(["pinnedAt", "revisionId"]);
  });
});

// ------------------------------------------------------------------------------------------
// 2. RBAC, IDOR and metadata
// ------------------------------------------------------------------------------------------

describe("2. access and metadata", () => {
  it("creates documents with product_master:edit only; private (INTERNAL) by default", async () => {
    const id = await completeProduct("d1", "DOC-A");
    for (const s of [bvEditor, bvPublisher, techBv, bvReader, nobody]) {
      expectError(
        await s.post(`/products/${id}/documents`, { type: "TDS", title: "X" }),
        403,
        "FORBIDDEN",
      );
    }
    expect(await lastAudit("catalog.access_denied")).toMatchObject({ outcome: "DENIED" });
    const doc = await createDoc(id, { title: "  ICCSYN 6 TDS  ", description: "  " });
    expect(doc).toMatchObject({
      title: "ICCSYN 6 TDS",
      description: null,
      accessPolicy: "INTERNAL",
      status: "ACTIVE",
      revisionCount: 0,
      activeRevision: null,
    });
    expect(doc.sites.map((s) => [s.siteKey, s.state])).toEqual([
      ["BV", "internal"],
      ["CORPORATE", "internal"],
    ]);
    expect(await lastAudit("catalog.document_created")).toMatchObject({
      actorUserId: pm.userId,
      resourceId: doc.id,
      outcome: "SUCCESS",
    });
  });

  it("validates input and refuses unknown products and ids (404, no oracle)", async () => {
    const id = P["d1"]!;
    expectError(
      await pm.post(`/products/${id}/documents`, { type: "MSDS", title: "X" }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await pm.post(`/products/${id}/documents`, { type: "TDS", title: "" }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await pm.post(`/products/${id}/documents`, { type: "TDS", title: "X", extra: 1 }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await pm.post(`/products/0190f2a1-0000-7000-8000-000000000000/documents`, {
        type: "TDS",
        title: "X",
      }),
      404,
      "NOT_FOUND",
    );
    expectError(await pm.get(`/products/not-a-uuid/documents`), 404, "NOT_FOUND");
    expectError(
      await pm.post(`/documents/0190f2a1-0000-7000-8000-000000000000`, {
        type: "TDS",
        title: "X",
        accessPolicy: "PUBLIC",
        version: 1,
      }),
      404,
      "NOT_FOUND",
    );
  });

  it("lets every catalogue reader list documents, never a user without product:read", async () => {
    const id = P["d1"]!;
    for (const s of [pm, root, bvReader, bvPublisher, techBv, comPublisher]) {
      const res = await s.get(`/products/${id}/documents`);
      expect(res.status, s.name).toBe(200);
      const list = ProductDocumentListResponseSchema.parse(res.body);
      expect(list.canEdit, s.name).toBe(s === pm || s === root);
    }
    // A site user sees only their own site's switch.
    const bvOnly = ProductDocumentListResponseSchema.parse(
      (await bvPublisher.get(`/products/${id}/documents`)).body,
    );
    expect(bvOnly.items[0]!.sites.map((s) => [s.siteKey, s.canPublish])).toEqual([["BV", true]]);
    expectError(await nobody.get(`/products/${id}/documents`), 403, "FORBIDDEN");
  });

  it("updates metadata with optimistic versions and audits a policy change", async () => {
    const [doc] = ProductDocumentListResponseSchema.parse(
      (await pm.get(`/products/${P["d1"]}/documents`)).body,
    ).items;
    const body = {
      type: "TDS",
      title: "ICCSYN 6 technical data sheet",
      description: "English edition",
      accessPolicy: "PUBLIC",
    };
    expectError(
      await pm.post(`/documents/${doc!.id}`, { ...body, version: doc!.version + 3 }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    expectError(
      await bvPublisher.post(`/documents/${doc!.id}`, { ...body, version: doc!.version }),
      403,
      "FORBIDDEN",
    );
    const res = await pm.post(`/documents/${doc!.id}`, { ...body, version: doc!.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.document).toMatchObject({ ...body, version: doc!.version + 1 });
    expect((await lastAudit("catalog.document_updated"))?.metadata).toMatchObject({
      changed: ["title", "description", "accessPolicy"],
      accessPolicy: { from: "INTERNAL", to: "PUBLIC" },
    });
  });
});

// ------------------------------------------------------------------------------------------
// 3. Uploads, revisions and immutability
// ------------------------------------------------------------------------------------------

describe("3. uploads and revisions", () => {
  it("stores a valid PDF as revision 1, active, under a random documents/ key", async () => {
    const [doc] = ProductDocumentListResponseSchema.parse(
      (await pm.get(`/products/${P["d1"]}/documents`)).body,
    ).items;
    const pdf = makePdf({ pages: 2, text: "ICCSYN 6 TDS revision 1" });
    const after = await uploaded(doc!.id, pdf, "  First issue  ");
    expect(after.revisionCount).toBe(1);
    expect(after.activeRevision).toMatchObject({
      revisionNumber: 1,
      isActive: true,
      byteSize: pdf.length,
      pageCount: 2,
      pdfVersion: "1.7",
      changeNote: "First issue",
      originalFilename: "TDS ICCSYN 6 – EN.pdf",
      uploadedBy: { id: pm.userId, displayName: "pm" },
    });
    expect(after.activeRevision!.sha256).toBe(createHash("sha256").update(pdf).digest("hex"));
    const row = await owner.productDocumentRevision.findFirstOrThrow({
      where: { documentId: doc!.id },
    });
    expect(row.storageKey).toMatch(/^documents\/[0-9a-f]{32}\/document\.pdf$/);
    expect(row.storageKey).not.toContain(doc!.id);
    expect((await lastAudit("catalog.document_revision_uploaded"))?.metadata).toMatchObject({
      revisionNumber: 1,
      previousActiveRevisionId: null,
      sha256: row.sha256,
    });
  });

  it("refuses non-PDF types, fake PDFs, active content and encryption, with FAILURE audit", async () => {
    const docId = (await owner.productDocument.findFirstOrThrow({ where: { productId: P["d1"] } }))
      .id;
    expectError(
      await pm.uploadPdf(docId, makePdf(), { type: "application/octet-stream" }),
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
    expectError(
      await pm.uploadPdf(docId, Buffer.from("<html><script>x</script></html>")),
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      { path: "file", rule: "not_pdf" },
    );
    expectError(
      await pm.uploadPdf(
        docId,
        makePdf({ catalogExtra: "/OpenAction << /S /Java#53cript /JS (app.alert(1)) >>" }),
      ),
      400,
      "VALIDATION_FAILED",
      { path: "file", rule: "active_content" },
    );
    expect(await lastAudit("catalog.document_upload_rejected")).toMatchObject({
      outcome: "FAILURE",
      reason: "pdf_active_content",
      actorUserId: pm.userId,
    });
    expectError(
      await pm.uploadPdf(docId, makePdf({ objectStream: ["<< /S /Launch /F (x.exe) >>"] })),
      400,
      "VALIDATION_FAILED",
      { path: "file", rule: "active_content" },
    );
    expectError(await pm.uploadPdf(docId, makePdf({ encrypted: true })), 400, "VALIDATION_FAILED", {
      path: "file",
      rule: "encrypted",
    });
    // Declared over 20 MB: refused by the boundary before the body is read. (The streaming cap
    // of the controller, for bodies without a declared length, is unit-tested: read-limited.)
    expectError(
      await pm.uploadPdf(docId, Buffer.alloc(20 * 1024 * 1024 + 1, 0x25)),
      413,
      "PAYLOAD_TOO_LARGE",
    );
    for (const s of [bvPublisher, bvReader]) {
      expectError(await s.uploadPdf(docId, makePdf()), 403, "FORBIDDEN");
    }
    // Nothing of the refused uploads was stored.
    expect(await owner.productDocumentRevision.count({ where: { documentId: docId } })).toBe(1);
    const files = (await readdirRecursive(path.join(MEDIA_DIR, "documents"))).length;
    expect(files).toBe(1);
  });

  it("numbers revisions, makes the newest active and can switch back", async () => {
    const docId = (await owner.productDocument.findFirstOrThrow({ where: { productId: P["d1"] } }))
      .id;
    const r2 = await uploaded(docId, makePdf({ text: "revision 2" }), "Section 9 updated");
    expect(r2.revisions.map((r) => [r.revisionNumber, r.isActive])).toEqual([
      [2, true],
      [1, false],
    ]);
    const rev1 = r2.revisions.find((r) => r.revisionNumber === 1)!;
    expectError(
      await pm.post(`/document-revisions/${rev1.id}/activate`, { version: r2.version - 1 }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    expectError(
      await bvPublisher.post(`/document-revisions/${rev1.id}/activate`, { version: r2.version }),
      403,
      "FORBIDDEN",
    );
    const back = await pm.post(`/document-revisions/${rev1.id}/activate`, { version: r2.version });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.document.activeRevision.revisionNumber).toBe(1);
    expect((await lastAudit("catalog.document_revision_activated"))?.metadata).toMatchObject({
      revisionNumber: 1,
      previousRevisionNumber: 2,
    });
    // Back to the newest for the rest of the suite.
    const fwd = await pm.post(`/document-revisions/${r2.revisions[0]!.id}/activate`, {
      version: back.body.document.version,
    });
    expect(fwd.status).toBe(200);
  });

  it("keeps revisions immutable: trigger for every role, column privileges for dp_app", async () => {
    const rev = await owner.productDocumentRevision.findFirstOrThrow({
      where: { revisionNumber: 1, document: { productId: P["d1"] } },
    });
    await rejectsDb(
      owner.productDocumentRevision.update({
        where: { id: rev.id },
        data: { sha256: "0".repeat(64) },
      }),
      /document revisions are immutable/,
    );
    await rejectsDb(
      owner.productDocumentRevision.delete({ where: { id: rev.id } }),
      /cannot be deleted/,
    );
    await rejectsDb(
      owner.$executeRawUnsafe(`TRUNCATE "ProductDocumentRevision" CASCADE`),
      /cannot be deleted/,
    );
    await rejectsDb(
      asApp.productDocumentRevision.update({
        where: { id: rev.id },
        data: { changeNote: "rewritten" },
      }),
      /permission denied/,
    );
    await rejectsDb(
      asApp.productDocumentRevision.delete({ where: { id: rev.id } }),
      /permission denied/,
    );
    await rejectsDb(
      asApp.productDocument.delete({ where: { id: rev.documentId } }),
      /permission denied/,
    );
    // A second active revision of one document is impossible (partial unique index).
    await rejectsDb(
      owner.productDocumentRevision.update({ where: { id: rev.id }, data: { isActive: true } }),
      /ProductDocumentRevision_active_documentId_key|unique/i,
    );
  });

  it("serves files to catalogue readers only, inline (preview) or as attachment, audited", async () => {
    const rev = await owner.productDocumentRevision.findFirstOrThrow({
      where: { isActive: true, document: { productId: P["d1"] } },
    });
    const inline = await bvReader.bytes(`/document-revisions/${rev.id}/inline`);
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-type")).toBe("application/pdf");
    expect(inline.headers.get("x-content-type-options")).toBe("nosniff");
    expect(inline.headers.get("cache-control")).toBe("private, no-store");
    expect(inline.headers.get("content-disposition")).toMatch(
      /^inline; filename="TDS ICCSYN 6 _ EN\.pdf"; filename\*=UTF-8''/,
    );
    expect(createHash("sha256").update(inline.body).digest("hex")).toBe(rev.sha256);
    const att = await pm.bytes(`/document-revisions/${rev.id}/attachment`);
    expect(att.headers.get("content-disposition")).toMatch(/^attachment; /);
    expect(await lastAudit("catalog.document_file_read")).toMatchObject({
      actorUserId: pm.userId,
      outcome: "SUCCESS",
    });
    expect((await nobody.bytes(`/document-revisions/${rev.id}/inline`)).status).toBe(403);
    expect((await pm.bytes(`/document-revisions/${rev.id}/download`)).status).toBe(404);
    expect(
      (await pm.bytes(`/document-revisions/0190f2a1-0000-7000-8000-000000000000/inline`)).status,
    ).toBe(404);
  });
});

// ------------------------------------------------------------------------------------------
// 4. Per-site visibility and the public sites
// ------------------------------------------------------------------------------------------

describe("4. sites and public delivery", () => {
  let docId: string;
  const slug = "doc-a";

  it("lets only the site's own publisher show a document on that site", async () => {
    docId = (await owner.productDocument.findFirstOrThrow({ where: { productId: P["d1"] } })).id;
    const v = await docVersion(docId);
    const revisionId = await activeRevisionId(docId);
    for (const s of [pm, root, bvEditor, bvReader, comPublisher, techBv]) {
      expectError(
        await s.post(`/documents/${docId}/sites/${BV}`, { visible: true, version: v, revisionId }),
        403,
        "FORBIDDEN",
      );
    }
    expectError(
      await bvPublisher.post(`/documents/${docId}/sites/${COM}`, {
        visible: true,
        version: v,
        revisionId,
      }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await bvPublisher.post(`/documents/${docId}/sites/${BV}`, {
        visible: true,
        version: v - 1,
        revisionId,
      }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    // DP-086: showing names the revision the publisher confirms.
    expectError(
      await bvPublisher.post(`/documents/${docId}/sites/${BV}`, { visible: true, version: v }),
      400,
      "VALIDATION_FAILED",
    );
    const res = await bvPublisher.post(`/documents/${docId}/sites/${BV}`, {
      visible: true,
      version: v,
      revisionId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.document.sites).toEqual([
      expect.objectContaining({
        siteKey: "BV",
        enabled: true,
        state: "product_not_live",
        pinnedRevision: expect.objectContaining({ id: revisionId, revisionNumber: 2 }),
        updateAvailable: false,
      }),
    ]);
    expect(await lastAudit("catalog.document_site_shown")).toMatchObject({
      siteId: BV,
      metadata: expect.objectContaining({ revisionId, revisionNumber: 2 }),
    });
    // Idempotent: showing again changes nothing and writes no second event.
    const before = await owner.auditEvent.count({
      where: { action: "catalog.document_site_shown" },
    });
    expect(
      (
        await bvPublisher.post(`/documents/${docId}/sites/${BV}`, {
          visible: true,
          version: v,
          revisionId,
        })
      ).status,
    ).toBe(200);
    expect(await owner.auditEvent.count({ where: { action: "catalog.document_site_shown" } })).toBe(
      before,
    );
  });

  it("serves nothing while the product is not live on the site (PM-3 state)", async () => {
    expect((await pub("bv", `/products/${slug}/documents`)).status).toBe(404);
    expect((await pubBytes("bv", `/documents/${docId}/file`)).status).toBe(404);
  });

  it("lists and serves a PUBLIC document once the product is published on BV", async () => {
    await publishOn(P["d1"]!, BV, bvPublisher);
    const list = await pub("bv", `/products/${slug}/documents`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const items = PublicDocumentListResponseSchema.parse(list.body).items;
    expect(items).toEqual([
      expect.objectContaining({
        id: docId,
        type: "TDS",
        access: "PUBLIC",
        downloadable: true,
        revisionNumber: 2,
      }),
    ]);
    expect(JSON.stringify(list.body)).not.toMatch(/storageKey|sha256|originalFilename|documents\//);
    const file = await pubBytes("bv", `/documents/${docId}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(file.headers.get("content-disposition")).toBe(
      'attachment; filename="doc-a-tds-rev2.pdf"',
    );
    const active = await owner.productDocumentRevision.findFirstOrThrow({
      where: { documentId: docId, isActive: true },
    });
    expect(createHash("sha256").update(file.body).digest("hex")).toBe(active.sha256);
    // DP-163: the list flags the product, and only with what a visitor can reach.
    const entry = PublicProductListResponseSchema.parse(
      (await pub("bv", "/products")).body,
    ).items.find((i) => i.slug === slug);
    expect(entry).toMatchObject({ hasDocuments: true });
  });

  it("isolates the sites: Corporate and the admin key get nothing", async () => {
    expect((await pub("com", `/products/${slug}/documents`)).status).toBe(404);
    expect((await pubBytes("com", `/documents/${docId}/file`)).status).toBe(404);
    expect((await pubBytes("admin", `/documents/${docId}/file`)).status).toBe(404);
    const noKey = await fetch(`${base}/api/v1/public/catalog/documents/${docId}/file`);
    expect(noKey.status).toBe(404);
    // Published on Corporate too, but not shown there by its publisher: still nothing.
    await publishOn(P["d1"]!, COM, comPublisher);
    expect(
      PublicDocumentListResponseSchema.parse((await pub("com", `/products/${slug}/documents`)).body)
        .items,
    ).toEqual([]);
    expect((await pubBytes("com", `/documents/${docId}/file`)).status).toBe(404);
  });

  it("DP-086: pins the revision per site; a new revision waits for each site's publisher", async () => {
    const pinned = await activeRevisionId(docId);
    const pinnedSha = (
      await owner.productDocumentRevision.findUniqueOrThrow({ where: { id: pinned } })
    ).sha256;
    // A new upload becomes the active revision, but BV keeps serving the pinned one.
    const next = await uploaded(docId, makePdf({ text: "revision 3" }));
    const rev3 = await activeRevisionId(docId);
    expect(rev3).not.toBe(pinned);
    const bvList = PublicDocumentListResponseSchema.parse(
      (await pub("bv", `/products/${slug}/documents`)).body,
    ).items;
    expect(bvList.find((i) => i.id === docId)?.revisionNumber).toBe(2);
    const bvFile = await pubBytes("bv", `/documents/${docId}/file`);
    expect(createHash("sha256").update(bvFile.body).digest("hex")).toBe(pinnedSha);
    expect(bvFile.headers.get("content-disposition")).toBe(
      'attachment; filename="doc-a-tds-rev2.pdf"',
    );
    const admin = ProductDocumentListResponseSchema.parse(
      (await pm.get(`/products/${P["d1"]}/documents`)).body,
    ).items.find((d) => d.id === docId)!;
    expect(admin.sites.find((x) => x.siteKey === "BV")).toMatchObject({
      enabled: true,
      updateAvailable: true,
      pinnedRevision: { id: pinned, revisionNumber: 2 },
    });
    // Corporate shows the same document on the new revision: the sites differ.
    const com = await comPublisher.post(`/documents/${docId}/sites/${COM}`, {
      visible: true,
      version: next.version,
      revisionId: rev3,
    });
    expect(com.status, JSON.stringify(com.body)).toBe(200);
    expect(
      PublicDocumentListResponseSchema.parse((await pub("com", `/products/${slug}/documents`)).body)
        .items[0]?.revisionNumber,
    ).toBe(3);
    expect(
      PublicDocumentListResponseSchema.parse(
        (await pub("bv", `/products/${slug}/documents`)).body,
      ).items.find((i) => i.id === docId)?.revisionNumber,
    ).toBe(2);
    // Only BV's publisher moves BV's pin, and only to the active revision.
    for (const s of [pm, root, bvEditor, comPublisher]) {
      expectError(
        await s.post(`/documents/${docId}/sites/${BV}`, {
          visible: true,
          version: next.version,
          revisionId: rev3,
        }),
        403,
        "FORBIDDEN",
      );
    }
    const rev1 = await owner.productDocumentRevision.findFirstOrThrow({
      where: { documentId: docId, revisionNumber: 1 },
    });
    expectError(
      await bvPublisher.post(`/documents/${docId}/sites/${BV}`, {
        visible: true,
        version: next.version,
        revisionId: rev1.id,
      }),
      409,
      "CONFLICT_STATE",
      { path: "revisionId", rule: "not_active" },
    );
    const site = await owner.productDocumentSite.findFirstOrThrow({
      where: { documentId: docId, siteId: BV },
    });
    await rejectsDb(
      owner.productDocumentSite.update({ where: { id: site.id }, data: { revisionId: rev1.id } }),
      /a site can only pin the active revision/,
    );
    await rejectsDb(
      owner.productDocumentSite.update({ where: { id: site.id }, data: { siteId: COM } }),
      /a document site row cannot change/,
    );
    const confirm = await bvPublisher.post(`/documents/${docId}/sites/${BV}`, {
      visible: true,
      version: next.version,
      revisionId: rev3,
    });
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);
    expect(confirm.body.document.sites[0]).toMatchObject({
      updateAvailable: false,
      pinnedRevision: { id: rev3, revisionNumber: 3 },
    });
    expect(await lastAudit("catalog.document_site_revision_pinned")).toMatchObject({
      actorUserId: bvPublisher.userId,
      siteId: BV,
      metadata: expect.objectContaining({
        revisionId: rev3,
        revisionNumber: 3,
        previousRevisionId: pinned,
        previousRevisionNumber: 2,
      }),
    });
    // Making an older revision active again changes no site either.
    const back = await pm.post(`/document-revisions/${pinned}/activate`, {
      version: await docVersion(docId),
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    for (const key of ["bv", "com"] as const) {
      expect(
        PublicDocumentListResponseSchema.parse(
          (await pub(key, `/products/${slug}/documents`)).body,
        ).items.find((i) => i.id === docId)?.revisionNumber,
      ).toBe(3);
    }
    // History: every revision is kept.
    expect(await owner.productDocumentRevision.count({ where: { documentId: docId } })).toBe(3);
  });

  it("lists MEMBERS_ONLY closed, LEAD_REQUIRED on request only; never INTERNAL (fail-closed)", async () => {
    const extra: Record<string, string> = {};
    for (const policy of ["MEMBERS_ONLY", "LEAD_REQUIRED", "INTERNAL"] as const) {
      const d = await createDoc(P["d1"]!, {
        type: "SDS",
        title: `SDS ${policy}`,
        accessPolicy: policy,
      });
      const withFile = await uploaded(d.id, makePdf({ text: policy }));
      extra[policy] = d.id;
      const show = await bvPublisher.post(`/documents/${d.id}/sites/${BV}`, {
        visible: true,
        version: withFile.version,
        revisionId: await activeRevisionId(d.id),
      });
      if (policy === "INTERNAL") {
        expectError(show, 409, "CONFLICT_STATE", { path: "(root)", rule: "not_publishable" });
      } else {
        expect(show.status, JSON.stringify(show.body)).toBe(200);
        expect(show.body.document.sites[0].state).toBe(
          policy === "MEMBERS_ONLY" ? "awaiting_membership" : "served_on_request",
        );
      }
    }
    const items = PublicDocumentListResponseSchema.parse(
      (await pub("bv", `/products/${slug}/documents`)).body,
    ).items;
    expect(items.map((i) => [i.access, i.downloadable, i.requestable]).sort()).toEqual(
      [
        ["LEAD_REQUIRED", false, true],
        ["MEMBERS_ONLY", false, false],
        ["PUBLIC", true, false],
      ].sort(),
    );
    // Without a download grant (DP-043) no gated file leaves, whatever the URL.
    for (const id of Object.values(extra)) {
      expect((await pubBytes("bv", `/documents/${id}/file`)).status).toBe(404);
    }
    // A PUBLIC document switched to INTERNAL leaves the site at once (the switch stays on).
    const d = await owner.productDocument.findUniqueOrThrow({
      where: { id: extra["MEMBERS_ONLY"]! },
    });
    const internal = await pm.post(`/documents/${d.id}`, {
      type: d.type,
      title: d.title,
      accessPolicy: "INTERNAL",
      version: d.version,
    });
    expect(internal.status).toBe(200);
    expect(internal.body.document.sites[0]).toMatchObject({ enabled: true, state: "internal" });
    expect(
      PublicDocumentListResponseSchema.parse(
        (await pub("bv", `/products/${slug}/documents`)).body,
      ).items.map((i) => i.id),
    ).not.toContain(d.id);
  });

  it("DP-163: flags documents in the list only while one is open to visitors", async () => {
    const flag = async () =>
      PublicProductListResponseSchema.parse((await pub("bv", "/products")).body).items.find(
        (i) => i.slug === slug,
      )?.hasDocuments;
    expect(await flag()).toBe(true);
    // Make every open document of the product closed or internal: the flag goes off.
    const open = await owner.productDocument.findMany({
      where: { productId: P["d1"]!, accessPolicy: { in: ["PUBLIC", "LEAD_REQUIRED"] } },
    });
    const saved = open.map((d) => ({ id: d.id, accessPolicy: d.accessPolicy }));
    await owner.productDocument.updateMany({
      where: { id: { in: saved.map((d) => d.id) } },
      data: { accessPolicy: "MEMBERS_ONLY" },
    });
    try {
      expect(await flag()).toBe(false);
    } finally {
      for (const d of saved) {
        await owner.productDocument.update({
          where: { id: d.id },
          data: { accessPolicy: d.accessPolicy },
        });
      }
    }
    expect(await flag()).toBe(true);
  });

  it("refuses a site row the database rules forbid, whoever writes it", async () => {
    const internalId = (
      await owner.productDocument.findFirstOrThrow({
        where: { accessPolicy: "INTERNAL", revisionCount: 1, title: "SDS INTERNAL" },
      })
    ).id;
    await rejectsDb(
      owner.productDocumentSite.create({
        data: {
          documentId: internalId,
          siteId: BV,
          revisionId: await activeRevisionId(internalId),
        },
      }),
      /only an active, non-internal document with a file/,
    );
    const empty = await createDoc(P["d1"]!, {
      type: "COA",
      title: "COA batch 1",
      accessPolicy: "PUBLIC",
    });
    expectError(
      await bvPublisher.post(`/documents/${empty.id}/sites/${BV}`, {
        visible: true,
        version: empty.version,
        revisionId: "0190f2a1-0000-7000-8000-000000000000",
      }),
      409,
      "CONFLICT_STATE",
      { path: "(root)", rule: "not_publishable" },
    );
  });

  it("hides on a site, archives and restores; archived documents are frozen and offline", async () => {
    // Hide on BV: gone from the site.
    let v = await docVersion(docId);
    const hide = await bvPublisher.post(`/documents/${docId}/sites/${BV}`, {
      visible: false,
      version: v,
    });
    expect(hide.status).toBe(200);
    expect(await lastAudit("catalog.document_site_hidden")).toMatchObject({ siteId: BV });
    expect((await pubBytes("bv", `/documents/${docId}/file`)).status).toBe(404);
    expect(
      (
        await bvPublisher.post(`/documents/${docId}/sites/${BV}`, {
          visible: true,
          version: v,
          revisionId: await activeRevisionId(docId),
        })
      ).status,
    ).toBe(200);
    expect((await pubBytes("bv", `/documents/${docId}/file`)).status).toBe(200);
    // Archive: offline everywhere, frozen.
    expectError(
      await bvPublisher.post(`/documents/${docId}/archive`, { version: v }),
      403,
      "FORBIDDEN",
    );
    const arch = await pm.post(`/documents/${docId}/archive`, { version: v });
    expect(arch.status, JSON.stringify(arch.body)).toBe(200);
    expect(arch.body.document).toMatchObject({ status: "ARCHIVED" });
    expect(arch.body.document.sites[0].state).toBe("archived");
    expect((await pubBytes("bv", `/documents/${docId}/file`)).status).toBe(404);
    expect(
      PublicDocumentListResponseSchema.parse(
        (await pub("bv", `/products/${slug}/documents`)).body,
      ).items.map((i) => i.id),
    ).not.toContain(docId);
    v = await docVersion(docId);
    expectError(
      await pm.post(`/documents/${docId}`, {
        type: "TDS",
        title: "New",
        accessPolicy: "PUBLIC",
        version: v,
      }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "document_archived" },
    );
    expectError(await pm.uploadPdf(docId, makePdf()), 409, "CONFLICT_STATE", {
      path: "status",
      rule: "document_archived",
    });
    const rev1 = await owner.productDocumentRevision.findFirstOrThrow({
      where: { documentId: docId, revisionNumber: 1 },
    });
    expectError(
      await pm.post(`/document-revisions/${rev1.id}/activate`, { version: v }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "document_archived" },
    );
    await rejectsDb(
      owner.productDocument.update({ where: { id: docId }, data: { title: "Changed" } }),
      /an archived document cannot change/,
    );
    // Restore: back online with the publisher's switch unchanged.
    const restore = await pm.post(`/documents/${docId}/restore`, { version: v });
    expect(restore.status).toBe(200);
    expect(restore.body.document.sites[0].state).toBe("served");
    expect((await pubBytes("bv", `/documents/${docId}/file`)).status).toBe(200);
  });

  it("takes documents off a site when the product is unpublished or its listing hidden", async () => {
    await unpublishOn(P["d1"]!, BV, bvPublisher);
    expect((await pub("bv", `/products/${slug}/documents`)).status).toBe(404);
    expect((await pubBytes("bv", `/documents/${docId}/file`)).status).toBe(404);
    const list = ProductDocumentListResponseSchema.parse(
      (await pm.get(`/products/${P["d1"]}/documents`)).body,
    );
    expect(list.items.find((d) => d.id === docId)!.sites[0]!.state).toBe("product_not_live");
  });
});

// ------------------------------------------------------------------------------------------
// 5. Archived products
// ------------------------------------------------------------------------------------------

describe("5. archived products", () => {
  it("freezes the documents of an archived product master (API and trigger)", async () => {
    const id = await completeProduct("d2", "DOC-B");
    const doc = await createDoc(id, { accessPolicy: "PUBLIC" });
    await uploaded(doc.id, makePdf());
    const v = await version(id);
    const archived = await pm.post(`/products/${id}/archive`, { version: v });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expectError(
      await pm.post(`/products/${id}/documents`, { type: "SDS", title: "X" }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "archived" },
    );
    expectError(await pm.uploadPdf(doc.id, makePdf()), 409, "CONFLICT_STATE", {
      path: "status",
      rule: "archived",
    });
    expectError(
      await pm.post(`/documents/${doc.id}`, {
        type: "TDS",
        title: "Y",
        accessPolicy: "PUBLIC",
        version: await docVersion(doc.id),
      }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "archived" },
    );
    await rejectsDb(
      owner.productDocument.create({ data: { productId: id, type: "COA", title: "Z" } }),
      /documents of an archived product cannot change/,
    );
  });
});

async function readdirRecursive(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await readdirRecursive(full)));
    else out.push(full);
  }
  return out;
}
