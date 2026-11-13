// PM-6 (DP-036): global brands, global products and product cross-references over HTTP and the
// database rules behind them, on a database of its own (XREFS_*_DATABASE_URL, a *_test database
// that starts EMPTY).
//
// Setup as in catalog-documents.int.test.ts: migrations as dp_migrator, catalogue sync and
// bootstrap through the operator CLI, staff fixtures written as dp_owner, the API in-process from
// dist/ as dp_app, with the filesystem media storage in a temporary directory.
//
// Covers: RBAC of the global catalogue and of cross-references (master edit vs. approve vs. site
// publisher vs. read), IDOR, SIMILAR -> PENDING_VERIFICATION -> VERIFIED transitions and back,
// the source document requirement (same product, active revision of an active document), the
// technical comparison requirement, separation of duties (API with audit, trigger), optimistic
// versions, stale verifications (new source revision, specification change, global product
// change, archived global product), append-only history, per-site visibility by the site's
// publisher, public data isolation (site from the key, PM-3 state, no staff texts, never a stale
// or unverified VERIFIED), removal and restore, archived products.
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
  GlobalBrandResponseSchema,
  GlobalProductListResponseSchema,
  GlobalProductResponseSchema,
  ProductCrossReferenceListResponseSchema,
  ProductCrossReferenceResponseSchema,
  ProductDocumentResponseSchema,
  ProductWorkflowResponseSchema,
  PublicCrossReferenceListResponseSchema,
  XREF_PUBLICATION_ACK_VERSION,
  type ProductCrossReference,
} from "@dream/contracts";
import { assertTestDatabaseUrl } from "@dream/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { ADMIN_ORIGIN, TEST_KEYS, apiTestEnv } from "./helpers/auth-env.js";
import { makePdf } from "../fixtures/pdf.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(API_DIR, "dist/iam/iam-cli.js");
const PRISMA = path.join(API_DIR, "node_modules/.bin/prisma");
const appUrl = assertTestDatabaseUrl(process.env["XREFS_DATABASE_URL"]);
const DB_NAME = appUrl.pathname.slice(1);
function bootstrapUrl(): string {
  const u = assertTestDatabaseUrl(process.env["IAM_BOOTSTRAP_DATABASE_URL"]);
  u.pathname = `/${DB_NAME}`;
  return assertTestDatabaseUrl(u.toString()).toString();
}
const urls = {
  app: appUrl.toString(),
  migrate: assertTestDatabaseUrl(process.env["XREFS_MIGRATE_DATABASE_URL"]).toString(),
  boot: bootstrapUrl(),
};
for (const shared of [
  process.env["DATABASE_URL"],
  process.env["AUTH_DATABASE_URL"],
  process.env["CATALOG_DATABASE_URL"],
  process.env["WORKFLOW_DATABASE_URL"],
  process.env["DOCUMENTS_DATABASE_URL"],
]) {
  if (shared && new URL(shared).pathname === appUrl.pathname) {
    throw new Error("XREFS_DATABASE_URL must be a database of its own (it starts empty)");
  }
}
const ENV_BACKUP = { ...process.env };
const MEDIA_DIR = mkdtempSync(path.join(tmpdir(), "dp-xrefs-media-"));

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
        reason: "PM-6 cross-references test fixture",
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
  expect(Number(tables[0]?.n), "the cross-references test database must start empty").toBe(0);
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

/** DP-086: the active revision a publisher confirms when showing a document on a site. */
async function activeRevisionId(documentId: string): Promise<string> {
  return (
    await owner.productDocumentRevision.findFirstOrThrow({
      where: { documentId, isActive: true },
      select: { id: true },
    })
  ).id;
}

// --- PM-6 helpers ---------------------------------------------------------------------------

/** DP-091: the publisher's responsibility acknowledgement, current statement version. */
const ACK = { version: XREF_PUBLICATION_ACK_VERSION, accepted: true } as const;

const xrefVersion = async (id: string) =>
  (await owner.productCrossReference.findUniqueOrThrow({ where: { id } })).version;

async function xref(id: string, as: Staff = pm): Promise<ProductCrossReference> {
  const row = await owner.productCrossReference.findUniqueOrThrow({ where: { id } });
  const res = await as.get(`/products/${row.productId}/cross-references`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const item = ProductCrossReferenceListResponseSchema.parse(res.body).items.find(
    (x) => x.id === id,
  );
  expect(item).toBeTruthy();
  return item!;
}

async function brand(name: string, manufacturer = "Example Lubricants plc"): Promise<string> {
  const res = await pm.post("/global-brands", { name, manufacturer, country: "gb" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return GlobalBrandResponseSchema.parse(res.body).brand.id;
}

async function globalProduct(brandId: string, name: string, grade: string | null = null) {
  const res = await pm.post(`/global-brands/${brandId}/products`, { name, grade });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return GlobalProductResponseSchema.parse(res.body).product;
}

async function createXref(
  productId: string,
  globalProductId: string,
  input: Record<string, unknown> = {},
): Promise<ProductCrossReference> {
  const res = await pm.post(`/products/${productId}/cross-references`, {
    globalProductId,
    description: "Comparable base oil for the same applications.",
    comparison: "KV100 6.1 vs 6.0 mm²/s (ASTM D445); VI 128 vs 125 (ASTM D2270).",
    ...input,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return ProductCrossReferenceResponseSchema.parse(res.body).crossReference;
}

/** A TDS with one uploaded revision for a product; returns its active revision id. */
async function sourceDocument(productId: string, title = "TDS (source)"): Promise<string> {
  const doc = await pm.post(`/products/${productId}/documents`, { type: "TDS", title });
  expect(doc.status, JSON.stringify(doc.body)).toBe(201);
  const up = await pm.uploadPdf(doc.body.document.id, makePdf({ text: title }));
  expect(up.status, JSON.stringify(up.body)).toBe(201);
  return ProductDocumentResponseSchema.parse(up.body).document.activeRevision!.id;
}

async function verified(id: string, revisionId: string): Promise<ProductCrossReference> {
  const req = await pm.post(`/cross-references/${id}/request-verification`, {
    sourceRevisionId: revisionId,
    version: await xrefVersion(id),
  });
  expect(req.status, JSON.stringify(req.body)).toBe(200);
  const res = await reviewer.post(`/cross-references/${id}/verify`, {
    version: await xrefVersion(id),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return ProductCrossReferenceResponseSchema.parse(res.body).crossReference;
}

// ------------------------------------------------------------------------------------------
// 1. Schema and privileges
// ------------------------------------------------------------------------------------------

describe("1. schema", () => {
  it("has the enums and least-privilege grants for dp_app", async () => {
    const labels = await owner.$queryRaw<{ l: string }[]>`
      SELECT e.enumlabel AS l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'CrossReferenceStatus' ORDER BY e.enumsortorder`;
    expect(labels.map((r) => r.l)).toEqual([
      "SIMILAR",
      "PENDING_VERIFICATION",
      "VERIFIED",
      "REMOVED",
    ]);
    const priv = await owner.$queryRaw<{ t: string; p: string }[]>`
      SELECT table_name AS t, privilege_type AS p FROM information_schema.role_table_grants
      WHERE grantee = 'dp_app'
        AND table_name IN ('GlobalBrand', 'GlobalProduct', 'ProductCrossReference',
                           'ProductCrossReferenceEvent', 'ProductCrossReferenceSite')
        AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
      ORDER BY 1, 2`;
    expect(priv.map((r) => `${r.t}:${r.p}`)).toEqual([
      "GlobalBrand:INSERT",
      "GlobalBrand:SELECT",
      "GlobalBrand:UPDATE",
      "GlobalProduct:INSERT",
      "GlobalProduct:SELECT",
      "GlobalProduct:UPDATE",
      "ProductCrossReference:INSERT",
      "ProductCrossReference:SELECT",
      "ProductCrossReference:UPDATE",
      "ProductCrossReferenceEvent:INSERT",
      "ProductCrossReferenceEvent:SELECT",
      "ProductCrossReferenceSite:DELETE",
      "ProductCrossReferenceSite:INSERT",
      "ProductCrossReferenceSite:SELECT",
    ]);
  });
});

// ------------------------------------------------------------------------------------------
// 2. Global brands and products
// ------------------------------------------------------------------------------------------

describe("2. global catalogue", () => {
  let brandId: string;

  it("creates brands with product_master:edit only; everyone with product:read reads", async () => {
    for (const s of [bvEditor, bvPublisher, techBv, bvReader, nobody, comPublisher]) {
      expectError(
        await s.post("/global-brands", { name: "Nope", manufacturer: "Nope Ltd" }),
        403,
        "FORBIDDEN",
      );
    }
    expect(await lastAudit("catalog.access_denied")).toMatchObject({ outcome: "DENIED" });
    brandId = await brand("Example Brand");
    expect(await lastAudit("catalog.global_brand_created")).toMatchObject({
      actorUserId: pm.userId,
      resourceId: brandId,
    });
    const list = await bvReader.get("/global-brands?q=example");
    expect(list.status).toBe(200);
    expect(list.body.items.map((b: { name: string }) => b.name)).toEqual(["Example Brand"]);
    expect(list.body.canEdit).toBe(false);
    expectError(await nobody.get("/global-brands"), 403, "FORBIDDEN");
  });

  it("keeps one brand per name whatever the spelling; validates input", async () => {
    expectError(
      await pm.post("/global-brands", { name: "  example   BRAND ", manufacturer: "Other" }),
      409,
      "CONFLICT_STATE",
      { path: "name", rule: "unique" },
    );
    expectError(
      await pm.post("/global-brands", { name: "", manufacturer: "x" }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await pm.post("/global-brands", { name: "X", manufacturer: "Y", country: "GBR" }),
      400,
      "VALIDATION_FAILED",
    );
    await rejectsDb(
      owner.globalBrand.create({ data: { name: "Raw", nameKey: "RAW", manufacturer: "M" } }),
      /GlobalBrand_name_key_format/,
    );
  });

  it("updates with the version, refuses stale versions", async () => {
    const res = await pm.post(`/global-brands/${brandId}`, {
      name: "Example Brand",
      manufacturer: "Example Lubricants International plc",
      country: "GB",
      version: 1,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.brand).toMatchObject({ version: 2, country: "GB" });
    expectError(
      await pm.post(`/global-brands/${brandId}`, {
        name: "Example Brand",
        manufacturer: "Again",
        version: 1,
      }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
  });

  it("creates global products with grade, unique per brand, searchable", async () => {
    const a = await globalProduct(brandId, "Example Base 6", "Group III");
    expect(a).toMatchObject({ name: "Example Base 6", grade: "Group III", brand: { id: brandId } });
    // Same name with another grade is another product; same name and grade is not.
    await globalProduct(brandId, "Example Base 6", "Group II+");
    expectError(
      await pm.post(`/global-brands/${brandId}/products`, {
        name: "example base 6",
        grade: "group iii",
      }),
      409,
      "CONFLICT_STATE",
      { path: "name", rule: "unique" },
    );
    const found = GlobalProductListResponseSchema.parse(
      (await bvReader.get("/global-products?q=group%20iii")).body,
    );
    expect(found.items.map((p) => p.id)).toEqual([a.id]);
    expectError(
      await pm.post(`/global-brands/0190f2a1-0000-7000-8000-000000000000/products`, { name: "Z" }),
      404,
      "NOT_FOUND",
    );
  });

  it("archives and restores a brand; an archived brand freezes its products", async () => {
    const b = await brand("Short Lived");
    const p = await globalProduct(b, "Gone 1");
    const arch = await pm.post(`/global-brands/${b}/archive`, { version: 1 });
    expect(arch.status).toBe(200);
    expectError(
      await pm.post(`/global-brands/${b}/products`, { name: "Gone 2" }),
      409,
      "CONFLICT_STATE",
      {
        path: "status",
        rule: "global_archived",
      },
    );
    await rejectsDb(
      owner.globalProduct.update({ where: { id: p.id }, data: { description: "x" } }),
      /products of an archived brand cannot change/,
    );
    const hidden = GlobalProductListResponseSchema.parse(
      (await pm.get("/global-products?q=gone")).body,
    );
    expect(hidden.items).toEqual([]);
    expect((await pm.post(`/global-brands/${b}/restore`, { version: 2 })).status).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------
// 3. Cross-references: create, change, history
// ------------------------------------------------------------------------------------------

describe("3. cross-references", () => {
  let productId: string;
  let gp: string;
  let gpOther: string;

  it("creates SIMILAR relations with product_master:edit; reads with product:read", async () => {
    productId = await completeProduct("x1", "XR-A");
    const b = await brand("Brand A", "Maker A AG");
    gp = (await globalProduct(b, "Alpha 46", "ISO VG 46")).id;
    gpOther = (await globalProduct(b, "Alpha 68", "ISO VG 68")).id;
    for (const s of [bvEditor, bvPublisher, techBv, bvReader, nobody]) {
      expectError(
        await s.post(`/products/${productId}/cross-references`, { globalProductId: gp }),
        403,
        "FORBIDDEN",
      );
    }
    const x = await createXref(productId, gp);
    expect(x).toMatchObject({
      status: "SIMILAR",
      version: 1,
      verification: { state: "none", source: null },
      canVerify: false,
    });
    expect(x.events.map((e) => e.action)).toEqual(["CREATED"]);
    expect(await lastAudit("catalog.cross_reference_created")).toMatchObject({
      actorUserId: pm.userId,
      resourceId: x.id,
    });
    const read = await bvReader.get(`/products/${productId}/cross-references`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ canEdit: false, canApprove: false });
    expectError(await nobody.get(`/products/${productId}/cross-references`), 403, "FORBIDDEN");
  });

  it("refuses duplicates, unknown and archived global products, unknown products (IDOR)", async () => {
    expectError(
      await pm.post(`/products/${productId}/cross-references`, { globalProductId: gp }),
      409,
      "CONFLICT_STATE",
      { path: "globalProductId", rule: "unique" },
    );
    expectError(
      await pm.post(`/products/${productId}/cross-references`, {
        globalProductId: "0190f2a1-0000-7000-8000-000000000000",
      }),
      400,
      "VALIDATION_FAILED",
      { path: "globalProductId", rule: "unknown" },
    );
    expectError(
      await pm.post(`/products/0190f2a1-0000-7000-8000-000000000000/cross-references`, {
        globalProductId: gp,
      }),
      404,
      "NOT_FOUND",
    );
    expectError(await pm.get(`/products/not-a-uuid/cross-references`), 404, "NOT_FOUND");
    const archivedGp = await globalProduct(
      (await owner.globalProduct.findUniqueOrThrow({ where: { id: gp } })).brandId,
      "Alpha old",
    );
    expect(
      (await pm.post(`/global-products/${archivedGp.id}/archive`, { version: 1 })).status,
    ).toBe(200);
    expectError(
      await pm.post(`/products/${productId}/cross-references`, { globalProductId: archivedGp.id }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "global_archived" },
    );
  });

  it("changes the texts with the version and keeps an append-only history", async () => {
    const x = await createXref(productId, gpOther, { comparison: null });
    const res = await pm.post(`/cross-references/${x.id}`, {
      description: "Heavier grade.",
      comparison: null,
      version: 1,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.crossReference.events.map((e: { action: string }) => e.action)).toEqual([
      "UPDATED",
      "CREATED",
    ]);
    expectError(
      await pm.post(`/cross-references/${x.id}`, { description: "x", version: 1 }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    const ev = await owner.productCrossReferenceEvent.findFirstOrThrow({
      where: { crossReferenceId: x.id },
    });
    await rejectsDb(
      owner.productCrossReferenceEvent.update({ where: { id: ev.id }, data: { comment: "x" } }),
      /append-only/,
    );
    await rejectsDb(
      owner.productCrossReferenceEvent.delete({ where: { id: ev.id } }),
      /append-only/,
    );
    await rejectsDb(
      asApp.productCrossReference.delete({ where: { id: x.id } }),
      /permission denied/,
    );
    await rejectsDb(
      owner.productCrossReference.update({ where: { id: x.id }, data: { globalProductId: gp } }),
      /the products of a cross-reference cannot change/,
    );
    // Requesting a verification needs the technical comparison.
    const rev = await sourceDocument(productId, "TDS for comparison check");
    expectError(
      await pm.post(`/cross-references/${x.id}/request-verification`, {
        sourceRevisionId: rev,
        version: await xrefVersion(x.id),
      }),
      409,
      "CONFLICT_STATE",
      { path: "comparison", rule: "required" },
    );
  });
});

// ------------------------------------------------------------------------------------------
// 4. Verification: evidence, separation of duties, transitions
// ------------------------------------------------------------------------------------------

describe("4. verification", () => {
  let productId: string;
  let otherProduct: string;
  let id: string;
  let rev: string;

  it("needs a source revision of the same product, active, of an active document", async () => {
    productId = await completeProduct("v1", "XR-V");
    otherProduct = await completeProduct("v2", "XR-W");
    const b = await brand("Brand V", "Maker V SA");
    id = (await createXref(productId, (await globalProduct(b, "Vee 5W-30", "SAE 5W-30")).id)).id;
    rev = await sourceDocument(productId);
    const foreign = await sourceDocument(otherProduct, "TDS of another product");
    expectError(
      await pm.post(`/cross-references/${id}/request-verification`, {
        sourceRevisionId: foreign,
        version: 1,
      }),
      400,
      "VALIDATION_FAILED",
      { path: "sourceRevisionId", rule: "unknown" },
    );
    expectError(
      await pm.post(`/cross-references/${id}/request-verification`, { version: 1 }),
      400,
      "VALIDATION_FAILED",
    );
    // An older revision of the right document is not the evidence either.
    const docId = (await owner.productDocumentRevision.findUniqueOrThrow({ where: { id: rev } }))
      .documentId;
    const up = await pm.uploadPdf(docId, makePdf({ text: "TDS rev 2" }));
    expect(up.status).toBe(201);
    expectError(
      await pm.post(`/cross-references/${id}/request-verification`, {
        sourceRevisionId: rev,
        version: 1,
      }),
      409,
      "CONFLICT_STATE",
      { path: "sourceRevisionId", rule: "not_active" },
    );
    rev = up.body.document.activeRevision.id;
    // Nobody can write VERIFIED around the API: the database checks the evidence.
    await rejectsDb(
      owner.productCrossReference.update({
        where: { id },
        data: { status: "PENDING_VERIFICATION" },
      }),
      /verification needs the active revision/,
    );
    await rejectsDb(
      owner.productCrossReference.update({ where: { id }, data: { status: "VERIFIED" } }),
      /status cannot change from SIMILAR to VERIFIED/,
    );
  });

  it("refuses the requester as verifier (API with audit, and the trigger)", async () => {
    // root holds both product_master:edit and product:approve: requesting makes it a party.
    const req = await root.post(`/cross-references/${id}/request-verification`, {
      sourceRevisionId: rev,
      comment: "Please verify against the current TDS.",
      version: 1,
    });
    expect(req.status, JSON.stringify(req.body)).toBe(200);
    const x = ProductCrossReferenceResponseSchema.parse(req.body).crossReference;
    expect(x).toMatchObject({
      status: "PENDING_VERIFICATION",
      verification: { state: "pending", requestedBy: { id: root.userId } },
      canVerify: false,
      verifyBlockedReason: "own_change",
    });
    expect(x.verification.source).toMatchObject({ revisionId: rev, isActiveRevision: true });
    expectError(
      await root.post(`/cross-references/${id}/verify`, { version: 2 }),
      403,
      "FORBIDDEN",
      { path: "(root)", rule: "own_change" },
    );
    expect(await lastAudit("catalog.access_denied")).toMatchObject({
      actorUserId: root.userId,
      reason: "separation_of_duties",
    });
    await rejectsDb(
      owner.productCrossReference.update({
        where: { id },
        data: {
          status: "VERIFIED",
          verifiedById: root.userId,
          verifiedAt: new Date(),
          verifiedSpecHash: "0".repeat(64),
          verifiedGlobalVersion: 1,
        },
      }),
      /separation of duties/,
    );
    // Without product:approve platform-wide nobody verifies (a BV-only approver neither).
    for (const s of [pm, techBv, bvPublisher, bvEditor]) {
      expectError(await s.post(`/cross-references/${id}/verify`, { version: 2 }), 403, "FORBIDDEN");
    }
  });

  it("rejects with a reason back to SIMILAR", async () => {
    expectError(
      await reviewer.post(`/cross-references/${id}/reject`, { version: 2 }),
      400,
      "VALIDATION_FAILED",
    );
    const res = await reviewer.post(`/cross-references/${id}/reject`, {
      comment: "The TDS does not cover the VI.",
      version: 2,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.crossReference).toMatchObject({
      status: "SIMILAR",
      verification: { state: "none", source: null },
    });
    expect(res.body.crossReference.events[0]).toMatchObject({
      action: "VERIFICATION_REJECTED",
      comment: "The TDS does not cover the VI.",
      sourceRevisionId: rev,
      actor: { id: reviewer.userId },
    });
  });

  it("verifies with a second person and records what was verified", async () => {
    const x = await verified(id, rev);
    expect(x).toMatchObject({
      status: "VERIFIED",
      verification: {
        state: "current",
        staleReasons: [],
        requestedBy: { id: pm.userId },
        verifiedBy: { id: reviewer.userId },
      },
    });
    const row = await owner.productCrossReference.findUniqueOrThrow({ where: { id } });
    expect(row.verifiedSpecHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.verifiedGlobalVersion).toBe(1);
    expect(row.editorIds).toEqual([]);
    expect(await lastAudit("catalog.cross_reference_verified")).toMatchObject({
      actorUserId: reviewer.userId,
      metadata: expect.objectContaining({ sourceRevisionId: rev, requestedById: pm.userId }),
    });
    expectError(
      await reviewer.post(`/cross-references/${id}/verify`, { version: row.version }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "not_pending" },
    );
  });

  it("returns to SIMILAR on any content change, and on an explicit downgrade with reason", async () => {
    const v = await xrefVersion(id);
    const edit = await pm.post(`/cross-references/${id}`, {
      description: "Edited after verification.",
      comparison: "KV100 6.1 vs 6.0 mm²/s (ASTM D445).",
      version: v,
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body.crossReference).toMatchObject({
      status: "SIMILAR",
      verification: { state: "none", verifiedBy: null },
    });
    expect(edit.body.crossReference.events[0].action).toBe("VERIFICATION_RESET");
    await rejectsDb(
      owner.productCrossReference.update({
        where: { id },
        data: { status: "PENDING_VERIFICATION", description: "sneaky" },
      }),
      /ProductCrossReference_request_complete|must be verified again/,
    );
    await verified(id, rev);
    expectError(
      await reviewer.post(`/cross-references/${id}/mark-similar`, {
        version: await xrefVersion(id),
      }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await bvEditor.post(`/cross-references/${id}/mark-similar`, {
        comment: "x",
        version: await xrefVersion(id),
      }),
      403,
      "FORBIDDEN",
    );
    const down = await reviewer.post(`/cross-references/${id}/mark-similar`, {
      comment: "Manufacturer withdrew the approval.",
      version: await xrefVersion(id),
    });
    expect(down.status, JSON.stringify(down.body)).toBe(200);
    expect(down.body.crossReference.status).toBe("SIMILAR");
    expect(down.body.crossReference.events[0]).toMatchObject({
      action: "MARKED_SIMILAR",
      fromStatus: "VERIFIED",
    });
  });
});

// ------------------------------------------------------------------------------------------
// 5. Stale verifications
// ------------------------------------------------------------------------------------------

describe("5. stale verifications", () => {
  let productId: string;
  let gpId: string;
  let id: string;
  let docId: string;

  it("is stale once the source document has a newer active revision", async () => {
    productId = await completeProduct("s1", "XR-S");
    const b = await brand("Brand S", "Maker S Inc");
    gpId = (await globalProduct(b, "Ess 32", "ISO VG 32")).id;
    id = (await createXref(productId, gpId)).id;
    const rev = await sourceDocument(productId);
    docId = (await owner.productDocumentRevision.findUniqueOrThrow({ where: { id: rev } }))
      .documentId;
    await verified(id, rev);
    expect((await pm.uploadPdf(docId, makePdf({ text: "new TDS" }))).status).toBe(201);
    const x = await xref(id);
    expect(x.verification).toMatchObject({
      state: "stale",
      staleReasons: ["source_revision_replaced"],
      source: { revisionId: rev, isActiveRevision: false },
    });
    // Verify again against the new revision: current again.
    const again = await verified(id, await activeRevisionId(docId));
    expect(again.verification.state).toBe("current");
  });

  it("is stale once our specifications change", async () => {
    const res = await pm.post(`/products/${productId}/specs`, {
      version: await version(productId),
      values: [
        {
          definitionId: kvDef,
          value: { type: "NUMBER", number: 6.4 },
          unit: "mm²/s",
          testMethod: "ASTM D445",
        },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await xref(id)).verification).toMatchObject({
      state: "stale",
      staleReasons: ["specs_changed"],
    });
    await verified(id, await activeRevisionId(docId));
  });

  it("is stale once the global product changes or is archived", async () => {
    const gp = await owner.globalProduct.findUniqueOrThrow({ where: { id: gpId } });
    const upd = await pm.post(`/global-products/${gpId}`, {
      name: gp.name,
      grade: gp.grade,
      description: "Reformulated 2026.",
      version: gp.version,
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect((await xref(id)).verification.staleReasons).toEqual(["global_product_changed"]);
    await verified(id, await activeRevisionId(docId));
    const v = (await owner.globalProduct.findUniqueOrThrow({ where: { id: gpId } })).version;
    expect((await pm.post(`/global-products/${gpId}/archive`, { version: v })).status).toBe(200);
    expect((await xref(id)).verification.staleReasons).toContain("global_product_archived");
    expect((await pm.post(`/global-products/${gpId}/restore`, { version: v + 1 })).status).toBe(
      200,
    );
  });
});

// ------------------------------------------------------------------------------------------
// 6. Sites and the public sites
// ------------------------------------------------------------------------------------------

describe("6. sites and public data", () => {
  let productId: string;
  let similarId: string;
  let verifiedId: string;
  let docId: string;
  const slug = "xr-p";

  it("lets only the site's own publisher show a cross-reference on that site", async () => {
    productId = await completeProduct("p1", "XR-P");
    const b = await brand("Brand P", "Maker P BV");
    similarId = (await createXref(productId, (await globalProduct(b, "Pee 10", "ISO VG 10")).id))
      .id;
    verifiedId = (await createXref(productId, (await globalProduct(b, "Pee 22", "ISO VG 22")).id))
      .id;
    const rev = await sourceDocument(productId);
    docId = (await owner.productDocumentRevision.findUniqueOrThrow({ where: { id: rev } }))
      .documentId;
    await verified(verifiedId, rev);
    for (const s of [pm, root, reviewer, bvEditor, bvReader, comPublisher, techBv]) {
      expectError(
        await s.post(`/cross-references/${similarId}/sites/${BV}`, {
          visible: true,
          version: 1,
          acknowledgement: ACK,
        }),
        403,
        "FORBIDDEN",
      );
    }
    expectError(
      await bvPublisher.post(`/cross-references/${similarId}/sites/${COM}`, {
        visible: true,
        acknowledgement: ACK,
        version: 1,
      }),
      403,
      "FORBIDDEN",
    );
    // DP-091: no show without the publisher's acknowledgement of the current statement.
    for (const acknowledgement of [
      undefined,
      { version: "DP-091/old", accepted: true },
      { version: XREF_PUBLICATION_ACK_VERSION, accepted: false },
    ]) {
      expectError(
        await bvPublisher.post(`/cross-references/${similarId}/sites/${BV}`, {
          visible: true,
          version: 1,
          ...(acknowledgement ? { acknowledgement } : {}),
        }),
        400,
        "VALIDATION_FAILED",
      );
    }
    expect(
      await owner.productCrossReferenceSite.count({ where: { crossReferenceId: similarId } }),
    ).toBe(0);
    for (const x of [similarId, verifiedId]) {
      const res = await bvPublisher.post(`/cross-references/${x}/sites/${BV}`, {
        visible: true,
        acknowledgement: ACK,
        version: await xrefVersion(x),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.crossReference.sites).toEqual([
        expect.objectContaining({ siteKey: "BV", enabled: true, state: "product_not_live" }),
      ]);
    }
    expect(await lastAudit("catalog.cross_reference_site_shown")).toMatchObject({
      siteId: BV,
      actorUserId: bvPublisher.userId,
      metadata: expect.objectContaining({ acknowledgementVersion: XREF_PUBLICATION_ACK_VERSION }),
    });
    const acks = await owner.auditEvent.findMany({
      where: { action: "catalog.cross_reference_publication_acknowledged", siteId: BV },
      orderBy: { occurredAt: "asc" },
    });
    expect(acks.map((e) => e.resourceId)).toEqual([similarId, verifiedId]);
    for (const e of acks) {
      expect(e).toMatchObject({ actorUserId: bvPublisher.userId, outcome: "SUCCESS" });
      expect(e.metadata).toMatchObject({
        acknowledgementVersion: XREF_PUBLICATION_ACK_VERSION,
        acknowledgedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    }
    // Hiding needs no acknowledgement and writes none.
    const before = acks.length;
    expect(
      (
        await bvPublisher.post(`/cross-references/${similarId}/sites/${BV}`, {
          visible: false,
          version: await xrefVersion(similarId),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await bvPublisher.post(`/cross-references/${similarId}/sites/${BV}`, {
          visible: true,
          version: await xrefVersion(similarId),
          acknowledgement: ACK,
        })
      ).status,
    ).toBe(200);
    expect(
      await owner.auditEvent.count({
        where: { action: "catalog.cross_reference_publication_acknowledged", siteId: BV },
      }),
    ).toBe(before + 1);
  });

  it("serves nothing while the product is not live; then names and level only", async () => {
    expect((await pub("bv", `/products/${slug}/cross-references`)).status).toBe(404);
    await publishOn(productId, BV, bvPublisher);
    const res = await pub("bv", `/products/${slug}/cross-references`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = PublicCrossReferenceListResponseSchema.parse(res.body).items;
    expect(items.map((i) => [i.product, i.relation])).toEqual([
      ["Pee 22", "VERIFIED"],
      ["Pee 10", "SIMILAR"],
    ]);
    expect(items[0]).toMatchObject({
      brand: "Brand P",
      manufacturer: "Maker P BV",
      grade: "ISO VG 22",
    });
    expect(items[1]!.verifiedAt).toBeNull();
    // No staff texts, evidence or internal ids leave the platform.
    expect(JSON.stringify(res.body)).not.toMatch(
      /Comparable base oil|ASTM D2270|sourceRevision|comparison|description|editorIds|storageKey/,
    );
  });

  it("isolates the sites: Corporate and the admin key get nothing", async () => {
    expect((await pub("com", `/products/${slug}/cross-references`)).status).toBe(404);
    expect((await pub("admin", `/products/${slug}/cross-references`)).status).toBe(404);
    const noKey = await fetch(`${base}/api/v1/public/catalog/products/${slug}/cross-references`);
    expect(noKey.status).toBe(404);
    await publishOn(productId, COM, comPublisher);
    expect(
      PublicCrossReferenceListResponseSchema.parse(
        (await pub("com", `/products/${slug}/cross-references`)).body,
      ).items,
    ).toEqual([]);
  });

  it("never shows a stale or pending verification as VERIFIED", async () => {
    // Pending re-verification: shown as SIMILAR meanwhile.
    const req = await pm.post(`/cross-references/${verifiedId}/request-verification`, {
      sourceRevisionId: await activeRevisionId(docId),
      version: await xrefVersion(verifiedId),
    });
    expect(req.status, JSON.stringify(req.body)).toBe(200);
    const pending = PublicCrossReferenceListResponseSchema.parse(
      (await pub("bv", `/products/${slug}/cross-references`)).body,
    ).items;
    expect(pending.find((i) => i.id === verifiedId)?.relation).toBe("SIMILAR");
    expect(
      (
        await reviewer.post(`/cross-references/${verifiedId}/verify`, {
          version: await xrefVersion(verifiedId),
        })
      ).status,
    ).toBe(200);
    // Stale (new source revision): hidden on the public site, not downgraded.
    expect((await pm.uploadPdf(docId, makePdf({ text: "TDS v3" }))).status).toBe(201);
    const stale = PublicCrossReferenceListResponseSchema.parse(
      (await pub("bv", `/products/${slug}/cross-references`)).body,
    ).items;
    expect(stale.map((i) => i.id)).toEqual([similarId]);
    const admin = await xref(verifiedId, bvPublisher);
    expect(admin.sites[0]).toMatchObject({ state: "verification_stale", shownAs: null });
    // The publisher cannot newly show a stale verification on another site.
    expectError(
      await comPublisher.post(`/cross-references/${verifiedId}/sites/${COM}`, {
        visible: true,
        acknowledgement: ACK,
        version: await xrefVersion(verifiedId),
      }),
      409,
      "CONFLICT_STATE",
      { path: "(root)", rule: "verification_stale" },
    );
  });

  it("removes with a reason (off every site), restores without showing it again", async () => {
    expectError(
      await pm.post(`/cross-references/${similarId}/remove`, {
        version: await xrefVersion(similarId),
      }),
      400,
      "VALIDATION_FAILED",
    );
    const rm = await pm.post(`/cross-references/${similarId}/remove`, {
      comment: "Discontinued by the manufacturer.",
      version: await xrefVersion(similarId),
    });
    expect(rm.status, JSON.stringify(rm.body)).toBe(200);
    expect(rm.body.crossReference).toMatchObject({ status: "REMOVED" });
    expect(
      await owner.productCrossReferenceSite.count({ where: { crossReferenceId: similarId } }),
    ).toBe(0);
    expect(await lastAudit("catalog.cross_reference_removed")).toMatchObject({
      metadata: expect.objectContaining({ sitesHidden: 1 }),
    });
    expect(
      PublicCrossReferenceListResponseSchema.parse(
        (await pub("bv", `/products/${slug}/cross-references`)).body,
      ).items,
    ).toEqual([]);
    expectError(
      await bvPublisher.post(`/cross-references/${similarId}/sites/${BV}`, {
        visible: true,
        acknowledgement: ACK,
        version: await xrefVersion(similarId),
      }),
      409,
      "CONFLICT_STATE",
      { path: "(root)", rule: "xref_not_publishable" },
    );
    await rejectsDb(
      owner.productCrossReferenceSite.create({ data: { crossReferenceId: similarId, siteId: BV } }),
      /only a live cross-reference/,
    );
    const back = await pm.post(`/cross-references/${similarId}/restore`, {
      version: await xrefVersion(similarId),
    });
    expect(back.status).toBe(200);
    expect(back.body.crossReference).toMatchObject({ status: "SIMILAR" });
    expect(back.body.crossReference.sites[0]).toMatchObject({ enabled: false, state: "hidden" });
    // Hiding by the publisher, and unpublishing the product, take it off as well.
    expect(
      (
        await bvPublisher.post(`/cross-references/${similarId}/sites/${BV}`, {
          visible: true,
          acknowledgement: ACK,
          version: await xrefVersion(similarId),
        })
      ).status,
    ).toBe(200);
    const hide = await bvPublisher.post(`/cross-references/${similarId}/sites/${BV}`, {
      visible: false,
      version: await xrefVersion(similarId),
    });
    expect(hide.status).toBe(200);
    expect(await lastAudit("catalog.cross_reference_site_hidden")).toMatchObject({ siteId: BV });
    await unpublishOn(productId, BV, bvPublisher);
    expect((await pub("bv", `/products/${slug}/cross-references`)).status).toBe(404);
  });
});

// ------------------------------------------------------------------------------------------
// 7. Archived products
// ------------------------------------------------------------------------------------------

describe("7. archived products", () => {
  it("freezes the cross-references of an archived product master", async () => {
    const id = await completeProduct("a1", "XR-Z");
    const b = await brand("Brand Z", "Maker Z");
    const x = await createXref(id, (await globalProduct(b, "Zed")).id);
    expect((await pm.post(`/products/${id}/archive`, { version: await version(id) })).status).toBe(
      200,
    );
    expectError(
      await pm.post(`/cross-references/${x.id}`, { description: "x", version: 1 }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "archived" },
    );
    expectError(
      await pm.post(`/products/${id}/cross-references`, { globalProductId: x.globalProduct.id }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "archived" },
    );
  });
});
