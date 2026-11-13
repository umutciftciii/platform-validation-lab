// DP-042/DP-043 (ADR-016): lead-gated document downloads over HTTP and the database rules
// behind them, on a database of its own (LEADS_*_DATABASE_URL, a *_test database that starts
// EMPTY). Setup as in catalog-documents.int.test.ts: migrations as dp_migrator, catalogue sync and
// bootstrap through the operator CLI, staff fixtures written as dp_owner, the API in-process from
// dist/ as dp_app, filesystem media storage in a temporary directory.
//
// Covers: the short form (validation, honeypot, notice versions, no value echoed), which documents
// can be requested (site, policy, publication), the lead/request/grant rows and their consent
// evidence, grant use (site and document binding, 3 downloads, expiry, policy change), the
// watermark, rate limits, append-only and grant rules in the database for dp_app, and the admin
// lead list/detail (lead:read only, site isolation, audit without personal data).
//
// DP-076 revision (ADR-017 v2): the super admin reads leads directly and assigns roles (customer-
// data roles included) directly; the "direct role assignment" block covers assignment, revocation,
// site isolation, no-escalation, step-up scope, audit and the retired approval workflow.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import {
  AssignRoleResponseSchema,
  ErrorBodySchema,
  LEAD_MARKETING_CONSENT,
  LEAD_PRIVACY_NOTICE,
  LeadActivityResponseSchema,
  LeadDetailResponseSchema,
  LeadDocumentRequestResponseSchema,
  LeadListResponseSchema,
  LeadWorkflowResponseSchema,
  ProductDocumentResponseSchema,
  ProductWorkflowResponseSchema,
  PublicDocumentListResponseSchema,
  StaffListResponseSchema,
  type ProductDocument,
} from "@dream/contracts";
import { assertTestDatabaseUrl } from "@dream/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type Prisma } from "../../src/generated/prisma/client.js";
import { productionApproval } from "../../src/leads/leads-cli.js";
import {
  eraseByEmail,
  planRetention,
  runRetention,
  setRetentionHold,
} from "../../src/leads/retention.js";
import { ADMIN_ORIGIN, TEST_KEYS, apiTestEnv } from "./helpers/auth-env.js";
import { makePdf } from "../fixtures/pdf.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(API_DIR, "dist/iam/iam-cli.js");
const PRISMA = path.join(API_DIR, "node_modules/.bin/prisma");
const appUrl = assertTestDatabaseUrl(process.env["LEADS_DATABASE_URL"]);
const DB_NAME = appUrl.pathname.slice(1);
function bootstrapUrl(): string {
  const u = assertTestDatabaseUrl(process.env["IAM_BOOTSTRAP_DATABASE_URL"]);
  u.pathname = `/${DB_NAME}`;
  return assertTestDatabaseUrl(u.toString()).toString();
}
const urls = {
  app: appUrl.toString(),
  migrate: assertTestDatabaseUrl(process.env["LEADS_MIGRATE_DATABASE_URL"]).toString(),
  boot: bootstrapUrl(),
};
for (const shared of [
  process.env["DATABASE_URL"],
  process.env["AUTH_DATABASE_URL"],
  process.env["CATALOG_DATABASE_URL"],
  process.env["WORKFLOW_DATABASE_URL"],
  process.env["DOCUMENTS_DATABASE_URL"],
  process.env["XREFS_DATABASE_URL"],
]) {
  if (shared && new URL(shared).pathname === appUrl.pathname) {
    throw new Error("LEADS_DATABASE_URL must be a database of its own (it starts empty)");
  }
}
const ENV_BACKUP = { ...process.env };
const MEDIA_DIR = mkdtempSync(path.join(tmpdir(), "dp-leads-media-"));

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
    /** The raw session token (cookie); DP-103 probes pass it as the database context. */
    readonly token: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      "x-dp-proxy-key": TEST_KEYS.admin,
      "x-dp-client-ip": "10.20.30.40",
      cookie: `__Host-dp_admin_session=${this.token}`,
    };
  }

  /** DP-042: the admin lead routes (read only). */
  async leads(p = ""): Promise<Res> {
    return parse(await fetch(`${base}/api/v1/admin/leads${p}`, { headers: this.headers() }));
  }

  /** Any admin route under /api/v1/admin (staff and roles, DP-076 revision). */
  async admin(method: "GET" | "POST", p: string, body?: unknown): Promise<Res> {
    const headers = this.headers();
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
  grants: { role: string; site?: string; expiresAt?: Date }[],
  grantor: string | null,
  existingUserId?: string,
  opts: { memberships?: string[]; mfaVerifiedAt?: Date } = {},
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
    const data = {
      userId,
      roleId: role.id,
      scopeType: g.site ? ("SITE" as const) : ("PLATFORM" as const),
      siteId: g.site ?? null,
      grantedById: grantor,
      reason: "DP-042 leads test fixture",
      expiresAt: g.expiresAt ?? null,
    };
    // Customer-data roles are assigned through the API in these tests (assignRole).
    await owner.roleAssignment.create({ data });
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
      mfaVerifiedAt: opts.mfaVerifiedAt ?? now,
    },
  });
  for (const siteId of opts.memberships ?? []) {
    await owner.membership.upsert({
      where: { userId_siteId: { userId, siteId } },
      create: { userId, siteId, status: "ACTIVE" },
      update: { status: "ACTIVE" },
    });
  }
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

interface LeadCtx {
  staff?: string;
  site?: string | null;
  email?: string;
  grant?: string;
}

/** DP-103: `client` (dp_app) inside one transaction with a lead context, as lead-data.ts does it. */
function appIn<T>(
  ctx: LeadCtx,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  client: PrismaClient = asApp,
): Promise<T> {
  return client.$transaction(async (tx) => {
    if (ctx.staff !== undefined) {
      await tx.$executeRaw`SELECT leads_rls_set_staff_context(${ctx.staff})`;
    } else {
      await tx.$executeRaw`SELECT leads_rls_set_public_context(${ctx.site ?? null}::uuid,
        ${ctx.email ?? ""}, ${ctx.grant ?? ""})`;
    }
    return fn(tx);
  });
}

/** Row counts of the four lead tables as `client` sees them (in a transaction). */
async function visible(tx: Prisma.TransactionClient) {
  return {
    leads: await tx.lead.count(),
    requests: await tx.leadDocumentRequest.count(),
    grants: await tx.documentDownloadGrant.count(),
    downloads: await tx.leadDocumentDownload.count(),
  };
}

const lastAudit = (action: string) =>
  owner.auditEvent.findFirst({ where: { action }, orderBy: { occurredAt: "desc" } });

/** DP-076 revision (ADR-017 v2): the super admin (root) assigns a role directly. */
async function assignRole(
  assignee: Staff,
  roleKey: string,
  siteId: string | null,
  expiresAt?: Date,
): Promise<{ assignmentId: string; replacedAssignmentId: string | null }> {
  const res = await root.admin("POST", `/staff/${assignee.userId}/roles`, {
    roleKey,
    ...(siteId ? { siteId } : {}),
    ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const out = AssignRoleResponseSchema.parse(res.body);
  return { assignmentId: out.assignment.id, replacedAssignmentId: out.replacedAssignmentId };
}

const jpeg = (w = 1200, h = 900, r = 30) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g: 90, b: 120 } } })
    .jpeg()
    .toBuffer();

let root: Staff; // platform_super_admin: master edit + approve platform-wide, never publishes
let reviewer: Staff; // a second platform_super_admin (approver)
let pm: Staff; // platform_product_manager: master edit, no approval
let bvPublisher: Staff; // product_publisher @ BV
let comPublisher: Staff; // product_publisher @ CORPORATE
let bvEditor: Staff; // product_editor @ BV (listings)

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
  expect(Number(tables[0]?.n), "the leads test database must start empty").toBe(0);
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
  bvPublisher = await staff("bv-publisher", [{ role: "product_publisher", site: BV }], rootUser.id);
  comPublisher = await staff(
    "com-publisher",
    [{ role: "product_publisher", site: COM }],
    rootUser.id,
  );
  bvEditor = await staff("bv-editor", [{ role: "product_editor", site: BV }], rootUser.id);

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

// --- lead flow helpers ----------------------------------------------------------------------

const BV_ORIGIN = "https://dreampetroleumbv.com";
const COM_ORIGIN = "https://dreampetroleum.com";
let ipCounter = 1;
/** A fresh client IP per scenario, so the per-IP rate limit of one test never hits another. */
// The rate limit counts per IPv4 /24 prefix, so every scenario gets its own /24.
const freshIp = () => `10.${77 + Math.floor(ipCounter / 250)}.${ipCounter++ % 250}.9`;

interface FormInput {
  documentId: string;
  fullName?: string;
  company?: string;
  email?: string;
  country?: string;
  marketingConsent?: boolean;
  [extra: string]: unknown;
}

function form(input: FormInput): Record<string, unknown> {
  return {
    fullName: "Ada Lovelace",
    company: "Analytical Engines Ltd",
    email: "ada@engines.example",
    country: "NL",
    privacyNoticeVersion: LEAD_PRIVACY_NOTICE.version,
    privacyNoticeAccepted: true,
    marketingConsent: false,
    marketingConsentVersion: null,
    website: "",
    ...input,
  };
}

async function requestLead(
  site: "bv" | "com",
  body: Record<string, unknown>,
  ip: string | null = freshIp(),
): Promise<Res> {
  const headers: Record<string, string> = {
    "x-dp-proxy-key": KEY[site],
    origin: site === "bv" ? BV_ORIGIN : COM_ORIGIN,
    "content-type": "application/json",
  };
  if (ip) headers["x-dp-client-ip"] = ip;
  return parse(
    await fetch(`${base}/api/v1/public/leads/document-requests`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

async function download(site: "bv" | "com", id: string, grant?: string, ip = freshIp()) {
  const headers: Record<string, string> = { "x-dp-proxy-key": KEY[site], "x-dp-client-ip": ip };
  if (grant !== undefined) headers["x-dp-download-grant"] = grant;
  const res = await fetch(`${base}/api/v1/public/catalog/documents/${id}/file`, { headers });
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
}

async function activeRevisionId(documentId: string): Promise<string> {
  return (
    await owner.productDocumentRevision.findFirstOrThrow({
      where: { documentId, isActive: true },
    })
  ).id;
}

/** A document with one revision, shown on a site by that site's publisher. */
async function shownDoc(
  productId: string,
  policy: "PUBLIC" | "MEMBERS_ONLY" | "LEAD_REQUIRED",
  sites: { siteId: string; publisher: Staff }[],
  title = `SDS ${policy}`,
): Promise<string> {
  const d = await createDoc(productId, { type: "SDS", title, accessPolicy: policy });
  const withFile = await uploaded(d.id, makePdf({ text: title, pages: 2 }));
  let v = withFile.version;
  for (const s of sites) {
    const show = await s.publisher.post(`/documents/${d.id}/sites/${s.siteId}`, {
      visible: true,
      version: v,
      revisionId: await activeRevisionId(d.id),
    });
    expect(show.status, JSON.stringify(show.body)).toBe(200);
    v = show.body.document.version;
  }
  return d.id;
}

let slug: string;
let leadDoc: string; // LEAD_REQUIRED, shown on BV only
let publicDoc: string; // PUBLIC, shown on BV
let membersDoc: string; // MEMBERS_ONLY, shown on BV
let bothDoc: string; // LEAD_REQUIRED, shown on BV and Corporate
let salesBv: Staff; // sales_crm_user @ BV (lead:read), assignment as if DP-076 approved it
let salesCom: Staff; // sales_crm_user @ CORPORATE

describe("DP-042/DP-043 lead-gated document downloads", () => {
  beforeAll(async () => {
    const id = await completeProduct("p1", "LEAD-A");
    slug = "lead-a";
    await publishOn(id, BV, bvPublisher);
    await publishOn(id, COM, comPublisher);
    leadDoc = await shownDoc(id, "LEAD_REQUIRED", [{ siteId: BV, publisher: bvPublisher }]);
    publicDoc = await shownDoc(id, "PUBLIC", [{ siteId: BV, publisher: bvPublisher }]);
    membersDoc = await shownDoc(id, "MEMBERS_ONLY", [{ siteId: BV, publisher: bvPublisher }]);
    bothDoc = await shownDoc(
      id,
      "LEAD_REQUIRED",
      [
        { siteId: BV, publisher: bvPublisher },
        { siteId: COM, publisher: comPublisher },
      ],
      "COA batch sample",
    );
    // Lead access through a directly assigned sales role (DP-076 revision); salesCom's ends
    // in 30 days (the expiry test shortens it).
    salesBv = await staff("sales-bv", [], root.userId, undefined, { memberships: [BV] });
    salesCom = await staff("sales-com", [], root.userId, undefined, { memberships: [COM] });
    await assignRole(salesBv, "sales_crm_user", BV);
    await assignRole(salesCom, "sales_crm_user", COM, new Date(Date.now() + 30 * 86_400_000));
  });

  it("lists a lead-gated document as requestable, never downloadable without a grant", async () => {
    const list = await pub("bv", `/products/${slug}/documents`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const items = PublicDocumentListResponseSchema.parse(list.body).items;
    const lead = items.find((i) => i.id === leadDoc);
    expect(lead).toMatchObject({ access: "LEAD_REQUIRED", downloadable: false, requestable: true });
    expect(items.find((i) => i.id === membersDoc)).toMatchObject({
      downloadable: false,
      requestable: false,
    });
    // The direct file URL is useless: no grant, a malformed one, or a random well-formed one.
    expect((await download("bv", leadDoc)).status).toBe(404);
    expect((await download("bv", leadDoc, "nope")).status).toBe(404);
    expect((await download("bv", leadDoc, randomBytes(32).toString("base64url"))).status).toBe(404);
  });

  it("refuses an invalid form without echoing any value", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [form({ documentId: leadDoc, privacyNoticeAccepted: false }), "privacyNoticeAccepted"],
      [form({ documentId: leadDoc, website: "http://spam.example" }), "website"],
      [form({ documentId: leadDoc, email: "not-an-email" }), "email"],
      [form({ documentId: leadDoc, country: "XX" }), "country"],
      [form({ documentId: leadDoc, fullName: "<script>x</script>" }), "fullName"],
      [form({ documentId: leadDoc, company: "" }), "company"],
      [form({ documentId: leadDoc, phone: "+31 20 000" }), "(root)"],
    ];
    for (const [body, field] of cases) {
      const res = await requestLead("bv", body);
      expect(res.status, field).toBe(400);
      const err = ErrorBodySchema.parse(res.body).error;
      expect(err.code).toBe("VALIDATION_FAILED");
      expect(
        err.details.some((d) => typeof d === "object" && d.path === field),
        field,
      ).toBe(true);
      expect(JSON.stringify(res.body)).not.toMatch(/spam\.example|not-an-email|script|\+31/);
    }
    const old = await requestLead(
      "bv",
      form({ documentId: leadDoc, privacyNoticeVersion: "2020-01-01" }),
    );
    expectError(old, 400, "VALIDATION_FAILED", { path: "privacyNoticeVersion", rule: "outdated" });
    const mk = await requestLead(
      "bv",
      form({ documentId: leadDoc, marketingConsent: true, marketingConsentVersion: "2020-01-01" }),
    );
    expectError(mk, 400, "VALIDATION_FAILED", {
      path: "marketingConsentVersion",
      rule: "outdated",
    });
    expect(await owner.lead.count()).toBe(0);
  });

  it("answers 404 for documents this site does not offer on request", async () => {
    const unknown = "0190f3a0-0000-7000-8000-000000000000";
    for (const [site, id] of [
      ["bv", publicDoc],
      ["bv", membersDoc],
      ["bv", unknown],
      ["com", leadDoc], // lead-gated, but not shown on Corporate
    ] as const) {
      const res = await requestLead(
        site,
        form({ documentId: id, email: `x-${site}@probe.example` }),
      );
      expectError(res, 404, "NOT_FOUND");
    }
    expect(await owner.leadDocumentRequest.count()).toBe(0);
  });

  it("stores the lead, the consent evidence and a hashed grant in one go", async () => {
    const res = await requestLead(
      "bv",
      form({
        documentId: leadDoc,
        fullName: "  Grace   Hopper ",
        company: "Navy Labs",
        email: " Grace@Gmail.com ",
        country: "US",
      }),
      "10.1.2.3",
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const out = LeadDocumentRequestResponseSchema.parse(res.body);
    expect(out.grant.maxDownloads).toBe(3);
    const ttl = new Date(out.grant.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000);

    const lead = await owner.lead.findFirstOrThrow({ where: { email: "grace@gmail.com" } });
    expect(lead).toMatchObject({
      siteId: BV,
      fullName: "Grace Hopper",
      company: "Navy Labs",
      country: "US",
      freeMailDomain: true,
      marketingConsentAt: null,
      requestCount: 1,
    });
    const req = await owner.leadDocumentRequest.findFirstOrThrow({ where: { leadId: lead.id } });
    const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
    expect(req).toMatchObject({
      reference: out.reference,
      siteId: BV,
      documentId: leadDoc,
      productId: P["p1"],
      revisionId: await activeRevisionId(leadDoc),
      privacyNoticeVersion: LEAD_PRIVACY_NOTICE.version,
      privacyNoticeSha256: sha(LEAD_PRIVACY_NOTICE.text),
      marketingConsent: false,
      marketingConsentVersion: null,
      marketingConsentSha256: null,
    });
    expect(req.ipPrefixHmac).toMatch(/^[0-9a-f]{64}$/);
    expect(req.ipPrefixHmac).not.toContain("10.1.2");
    const grant = await owner.documentDownloadGrant.findFirstOrThrow({
      where: { requestId: req.id },
    });
    expect(grant.tokenHash).toBe(sha(out.grant.token));
    expect(JSON.stringify(grant)).not.toContain(out.grant.token);
    // Audit: ids only, never the e-mail, name, company or token.
    const audit = await lastAudit("leads.document_request_created");
    expect(audit).toMatchObject({ siteId: BV, resourceId: req.id, outcome: "SUCCESS" });
    expect(JSON.stringify(audit)).not.toMatch(/grace|hopper|navy|gmail/i);
    expect(JSON.stringify(audit)).not.toContain(out.grant.token);
  });

  it("delivers a stamped copy at most three times and records every download", async () => {
    const res = await requestLead(
      "bv",
      form({
        documentId: leadDoc,
        fullName: "Şule Ğüneş",
        company: "Öztürk Yağ A.Ş.",
        email: "sule@oztyag.example",
        country: "TR",
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const out = LeadDocumentRequestResponseSchema.parse(res.body);
    const revision = await owner.productDocumentRevision.findFirstOrThrow({
      where: { documentId: leadDoc, isActive: true },
    });
    const first = await download("bv", leadDoc, out.grant.token);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("application/pdf");
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("content-disposition")).toBe(
      `attachment; filename="${slug}-sds-rev1.pdf"`,
    );
    const sha = createHash("sha256").update(first.body).digest("hex");
    expect(sha).not.toBe(revision.sha256);
    const stamped = await PDFDocument.load(first.body);
    expect(stamped.getPageCount()).toBe(2);
    expect(stamped.getKeywords()).toContain(`ref:${out.reference}`);
    // Letters outside WinAnsi lose their diacritics (Ş→S, ğ→g); WinAnsi letters (ü, Ö) stay.
    expect(stamped.getSubject()).toBe("Prepared for Sule Günes (Öztürk Yag A.S.)");
    expect(first.body.toString("latin1")).not.toContain("sule@oztyag.example");

    expect((await download("bv", leadDoc, out.grant.token)).status).toBe(200);
    expect((await download("bv", leadDoc, out.grant.token)).status).toBe(200);
    expect((await download("bv", leadDoc, out.grant.token)).status).toBe(404);

    const req = await owner.leadDocumentRequest.findUniqueOrThrow({
      where: { reference: out.reference },
    });
    const grant = await owner.documentDownloadGrant.findUniqueOrThrow({
      where: { requestId: req.id },
    });
    expect(grant.downloadCount).toBe(3);
    const rows = await owner.leadDocumentDownload.findMany({ where: { requestId: req.id } });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      grantId: grant.id,
      siteId: BV,
      byteSize: first.body.length,
      sha256: sha,
    });
    const audit = await lastAudit("catalog.document_lead_download");
    expect(audit).toMatchObject({ siteId: BV, resourceId: leadDoc, outcome: "SUCCESS" });
    expect(JSON.stringify(audit)).not.toMatch(/sule|oztyag|ozturk/i);
  });

  it("binds a grant to its site and its document", async () => {
    const res = await requestLead("bv", form({ documentId: bothDoc, email: "bind@firm.example" }));
    const out = LeadDocumentRequestResponseSchema.parse(res.body);
    // The same document is lead-gated on Corporate, but this grant belongs to BV.
    expect((await download("com", bothDoc, out.grant.token)).status).toBe(404);
    // Another lead-gated document of the same product needs its own request.
    expect((await download("bv", leadDoc, out.grant.token)).status).toBe(404);
    // A PUBLIC document ignores the header entirely.
    expect((await download("bv", publicDoc, out.grant.token)).status).toBe(200);
    expect((await download("bv", bothDoc, out.grant.token)).status).toBe(200);
    // Corporate's own request works on Corporate.
    const com = await requestLead("com", form({ documentId: bothDoc, email: "bind@firm.example" }));
    expect(com.status, JSON.stringify(com.body)).toBe(201);
    const comOut = LeadDocumentRequestResponseSchema.parse(com.body);
    expect((await download("com", bothDoc, comOut.grant.token)).status).toBe(200);
    // One lead per site: the same e-mail is a separate lead on each site.
    expect(await owner.lead.count({ where: { email: "bind@firm.example" } })).toBe(2);
  });

  it("refuses an expired grant", async () => {
    const lead = await owner.lead.findFirstOrThrow({
      where: { email: "bind@firm.example", siteId: BV },
    });
    const created = new Date(Date.now() - 20 * 60_000);
    const req = await owner.leadDocumentRequest.create({
      data: {
        reference: "EXP1RED0",
        leadId: lead.id,
        siteId: BV,
        productId: P["p1"]!,
        documentId: leadDoc,
        revisionId: await activeRevisionId(leadDoc),
        fullName: "Old Visitor",
        company: "Old Co",
        country: "NL",
        privacyNoticeVersion: LEAD_PRIVACY_NOTICE.version,
        privacyNoticeSha256: "0".repeat(64),
        marketingConsent: false,
        createdAt: created,
      },
    });
    const token = randomBytes(32).toString("base64url");
    await owner.documentDownloadGrant.create({
      data: {
        requestId: req.id,
        siteId: BV,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        createdAt: created,
        expiresAt: new Date(created.getTime() + 15 * 60_000),
      },
    });
    expect((await download("bv", leadDoc, token)).status).toBe(404);
  });

  it("stops at once when the document stops being lead-gated or shown", async () => {
    const res = await requestLead(
      "bv",
      form({ documentId: leadDoc, email: "switch@firm.example" }),
    );
    const out = LeadDocumentRequestResponseSchema.parse(res.body);
    const d = await owner.productDocument.findUniqueOrThrow({ where: { id: leadDoc } });
    const internal = await pm.post(`/documents/${leadDoc}`, {
      type: d.type,
      title: d.title,
      accessPolicy: "INTERNAL",
      version: d.version,
    });
    expect(internal.status, JSON.stringify(internal.body)).toBe(200);
    expect((await download("bv", leadDoc, out.grant.token)).status).toBe(404);
    expectError(
      await requestLead("bv", form({ documentId: leadDoc, email: "late@firm.example" })),
      404,
      "NOT_FOUND",
    );
    const back = await pm.post(`/documents/${leadDoc}`, {
      type: d.type,
      title: d.title,
      accessPolicy: "LEAD_REQUIRED",
      version: internal.body.document.version,
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect((await download("bv", leadDoc, out.grant.token)).status).toBe(200);
  });

  it("keeps marketing consent separate and never clears it with a later unticked form", async () => {
    const email = "news@firm.example";
    const yes = await requestLead(
      "bv",
      form({
        documentId: leadDoc,
        email,
        marketingConsent: true,
        marketingConsentVersion: LEAD_MARKETING_CONSENT.version,
      }),
    );
    expect(yes.status, JSON.stringify(yes.body)).toBe(201);
    const lead = await owner.lead.findFirstOrThrow({ where: { email } });
    expect(lead.marketingConsentAt).not.toBeNull();
    const evidence = await owner.leadDocumentRequest.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    expect(evidence).toMatchObject({
      marketingConsent: true,
      marketingConsentVersion: LEAD_MARKETING_CONSENT.version,
      marketingConsentSha256: createHash("sha256")
        .update(LEAD_MARKETING_CONSENT.text)
        .digest("hex"),
    });
    const no = await requestLead("bv", form({ documentId: bothDoc, email }));
    expect(no.status).toBe(201);
    const after = await owner.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.marketingConsentAt).toEqual(lead.marketingConsentAt);
    expect(after.requestCount).toBe(2);
  });

  it("rate limits per e-mail and per client IP before writing anything", async () => {
    const email = "burst@firm.example";
    for (let i = 0; i < 5; i++) {
      expect((await requestLead("bv", form({ documentId: leadDoc, email }))).status).toBe(201);
    }
    const sixth = await requestLead("bv", form({ documentId: leadDoc, email }));
    expectError(sixth, 429, "RATE_LIMITED");
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    const lead = await owner.lead.findFirstOrThrow({ where: { email } });
    expect(lead.requestCount).toBe(5);

    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      const r = await requestLead(
        "bv",
        form({ documentId: leadDoc, email: `ip${i}@firm.example` }),
        ip,
      );
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    expectError(
      await requestLead("bv", form({ documentId: leadDoc, email: "ip10@firm.example" }), ip),
      429,
      "RATE_LIMITED",
    );
    expect(await owner.lead.count({ where: { email: "ip10@firm.example" } })).toBe(0);
    // The rate-limit table holds digests only.
    const keys = await owner.publicRateLimit.findMany();
    expect(keys.length).toBeGreaterThan(0);
    expect(JSON.stringify(keys)).not.toMatch(/firm\.example|10\.7[78]\./);
  });

  it("keeps requests and downloads append-only and grants tamper-proof for dp_app", async () => {
    // The privilege checks come before row-level security (DP-103): refused with or without rows.
    const req = await owner.leadDocumentRequest.findFirstOrThrow();
    await rejectsDb(
      asApp.leadDocumentRequest.update({ where: { id: req.id }, data: { company: "Changed" } }),
      /permission denied/,
    );
    await rejectsDb(
      asApp.leadDocumentRequest.delete({ where: { id: req.id } }),
      /permission denied/,
    );
    await rejectsDb(asApp.leadDocumentDownload.deleteMany({}), /permission denied/);
    await rejectsDb(asApp.lead.deleteMany({}), /permission denied/);
    const grant = await owner.documentDownloadGrant.findFirstOrThrow();
    await rejectsDb(
      asApp.documentDownloadGrant.update({
        where: { id: grant.id },
        data: { expiresAt: new Date(Date.now() + 86_400_000) },
      }),
      /permission denied/,
    );
    // Even the owner cannot rewrite evidence or skip the grant rules.
    await rejectsDb(
      owner.leadDocumentRequest.update({ where: { id: req.id }, data: { company: "Changed" } }),
      /document requests are evidence/,
    );
    const used = await owner.documentDownloadGrant.findFirstOrThrow({
      where: { downloadCount: 3 },
    });
    await rejectsDb(
      owner.documentDownloadGrant.update({
        where: { id: used.id },
        data: { downloadCount: 4, lastDownloadAt: new Date() },
      }),
      /DocumentDownloadGrant_download_count|used once per download/,
    );
    // A request for a PUBLIC document cannot even be inserted.
    await rejectsDb(
      owner.leadDocumentRequest.create({
        data: {
          ...req,
          id: undefined,
          reference: "PB000000",
          documentId: publicDoc,
          revisionId: await activeRevisionId(publicDoc),
        } as never,
      }),
      /only an active lead-gated document/,
    );
  });

  describe("admin lead list and detail", () => {
    it("refuses everyone without lead:read, with a DENIED audit event", async () => {
      for (const who of [pm, bvPublisher, bvEditor]) {
        expectError(await who.leads(), 403, "FORBIDDEN");
      }
      const denied = await owner.auditEvent.findFirst({
        where: { action: "leads.access_denied", actorUserId: pm.userId },
      });
      expect(denied?.outcome).toBe("DENIED");
      const lead = await owner.lead.findFirstOrThrow();
      expectError(await pm.leads(`/${lead.id}`), 403, "FORBIDDEN");
    });

    it("lists only the leads of the sites the caller may read", async () => {
      const bv = LeadListResponseSchema.parse((await salesBv.leads()).body);
      expect(bv.sites.map((s) => s.key)).toEqual(["BV"]);
      expect(bv.items.length).toBeGreaterThan(0);
      expect(bv.items.every((l) => l.siteKey === "BV" && l.siteId === BV)).toBe(true);
      const com = LeadListResponseSchema.parse((await salesCom.leads()).body);
      expect(com.items.map((l) => l.email)).toEqual(["bind@firm.example"]);
      // Asking for another site's leads is refused, not silently emptied.
      expectError(await salesBv.leads(`?siteId=${COM}`), 403, "FORBIDDEN");
      // Search and keyset pages.
      const found = LeadListResponseSchema.parse((await salesBv.leads("?q=GMAIL")).body);
      expect(found.items.map((l) => l.email)).toEqual(["grace@gmail.com"]);
      const audit = await lastAudit("leads.list_viewed");
      expect(audit?.actorUserId).toBe(salesBv.userId);
      // The read names the approved assignment behind it (ADR-017 D7).
      const bvAssignment = await owner.roleAssignment.findFirstOrThrow({
        where: { userId: salesBv.userId, revokedAt: null },
      });
      expect((audit?.metadata as { accessAssignmentIds?: string[] }).accessAssignmentIds).toEqual([
        bvAssignment.id,
      ]);
      expect(JSON.stringify(audit)).not.toMatch(/gmail|grace/i);
    });

    it("pages through the list with an opaque cursor", async () => {
      const seen = new Set<string>();
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: Res = await salesBv.leads(cursor ? `?cursor=${cursor}` : "");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const page = LeadListResponseSchema.parse(res.body);
        for (const l of page.items) {
          expect(seen.has(l.id)).toBe(false);
          seen.add(l.id);
        }
        cursor = page.nextCursor;
        pages++;
      } while (cursor && pages < 10);
      expect(seen.size).toBe(await owner.lead.count({ where: { siteId: BV } }));
      expectError(await salesBv.leads("?cursor=bm90LWEtY3Vyc29y"), 400, "VALIDATION_FAILED");
    });

    it("shows a lead with its requests, consent evidence and downloads", async () => {
      const lead = await owner.lead.findFirstOrThrow({ where: { email: "sule@oztyag.example" } });
      const res = await salesBv.leads(`/${lead.id}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const detail = LeadDetailResponseSchema.parse(res.body);
      expect(detail.lead).toMatchObject({
        email: "sule@oztyag.example",
        country: "TR",
        siteKey: "BV",
      });
      expect(detail.requests).toHaveLength(1);
      const r = detail.requests[0]!;
      expect(r).toMatchObject({
        product: { id: P["p1"], code: "LEAD-A", slug },
        document: { id: leadDoc, type: "SDS" },
        revision: { revisionNumber: 1 },
        privacyNoticeVersion: LEAD_PRIVACY_NOTICE.version,
        marketingConsent: false,
        grant: { downloadCount: 3, maxDownloads: 3 },
      });
      expect(r.downloads).toHaveLength(3);
      const viewed = await lastAudit("leads.lead_viewed");
      expect(viewed).toMatchObject({
        actorUserId: salesBv.userId,
        resourceId: lead.id,
        siteId: BV,
      });
      expect(JSON.stringify(viewed)).not.toMatch(/sule|oztyag/i);
      // Another site's lead looks unknown (IDOR), and is audited as DENIED.
      const comLead = await owner.lead.findFirstOrThrow({ where: { siteId: COM } });
      expectError(await salesBv.leads(`/${comLead.id}`), 404, "NOT_FOUND");
      expectError(await salesBv.leads("/not-a-uuid"), 404, "NOT_FOUND");
    });

    it("ends access when the time-limited assignment expires", async () => {
      // Shortening is allowed without dual approval (only extending is refused, DP-077).
      await owner.roleAssignment.updateMany({
        where: { userId: salesCom.userId },
        data: { expiresAt: new Date(Date.now() + 1500) },
      });
      expect((await salesCom.leads()).status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      expectError(await salesCom.leads(), 403, "FORBIDDEN");
    });
  });
});

// DP-103 (ADR-012B, lead data): row-level security on the four lead tables. The probes run raw
// as dp_app (no site-scoped client), so only the database decides what they see.
describe("DP-103 row-level security on lead data", () => {
  let total: { leads: number; requests: number; grants: number; downloads: number };
  let bvTotal: typeof total;
  let mine: { email: string; token: string; leadId: string; requestId: string };
  let comSales: Staff; // sales_crm_user @ CORPORATE (salesCom's assignment has expired by now)
  let fresh = 0;
  const newStaff = (sites: string[] = [BV]) =>
    staff(`rls-${++fresh}`, [], root.userId, undefined, { memberships: sites });
  const none = { leads: 0, requests: 0, grants: 0, downloads: 0 };

  beforeAll(async () => {
    const email = "rls.visitor@firm.example";
    const res = await requestLead("bv", form({ documentId: leadDoc, email }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const out = LeadDocumentRequestResponseSchema.parse(res.body);
    const lead = await owner.lead.findFirstOrThrow({ where: { siteId: BV, email } });
    const request = await owner.leadDocumentRequest.findFirstOrThrow({
      where: { leadId: lead.id },
    });
    mine = { email, token: out.grant.token, leadId: lead.id, requestId: request.id };
    const count = async (where: { siteId?: string }) => ({
      leads: await owner.lead.count({ where }),
      requests: await owner.leadDocumentRequest.count({ where }),
      grants: await owner.documentDownloadGrant.count({ where }),
      downloads: await owner.leadDocumentDownload.count({ where }),
    });
    total = await count({});
    bvTotal = await count({ siteId: BV });
    // Both sites hold data of every kind, or the isolation checks below prove nothing.
    expect(bvTotal.downloads).toBeGreaterThan(0);
    expect(total.leads).toBeGreaterThan(bvTotal.leads);
    expect(total.requests).toBeGreaterThan(bvTotal.requests);
    comSales = await newStaff([COM]);
    await assignRole(comSales, "sales_crm_user", COM);
  });

  it("switches RLS on for exactly the four lead tables, policies for dp_app and retention only", async () => {
    // DP-125 put the IAM tables under RLS as well (db-roles.int.test.ts, owner.int.test.ts); this
    // test keeps to the lead data.
    const LEAD_TABLES = [
      "Lead",
      "LeadActivity",
      "LeadDocumentRequest",
      "DocumentDownloadGrant",
      "LeadDocumentDownload",
    ];
    const tables = await owner.$queryRaw<{ t: string; force: boolean }[]>`
      SELECT relname::text AS t, relforcerowsecurity AS force FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relrowsecurity
        AND relname = ANY (${LEAD_TABLES}::text[]) ORDER BY 1`;
    expect(tables).toEqual([
      { t: "DocumentDownloadGrant", force: false },
      { t: "Lead", force: false },
      // DP-041: the sales history of a lead.
      { t: "LeadActivity", force: false },
      { t: "LeadDocumentDownload", force: false },
      { t: "LeadDocumentRequest", force: false },
    ]);
    const policies = await owner.$queryRaw<{ t: string; cmd: string; roles: string }[]>`
      SELECT tablename::text AS t, cmd::text AS cmd, array_to_string(roles, ',') AS roles
      FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY (${LEAD_TABLES}::text[])
      ORDER BY 1, 2, 3`;
    expect(new Set(policies.map((p) => p.roles))).toEqual(new Set(["dp_app", "dp_lead_retention"]));
    // dp_app never deletes lead data; only retention deletes (grants, under the DP-096 guard).
    expect(policies.filter((p) => p.cmd === "DELETE")).toEqual([
      { t: "DocumentDownloadGrant", cmd: "DELETE", roles: "dp_lead_retention" },
    ]);
    // dp_app writes through the public form and download paths, and as staff only the DP-041
    // workflow (lead_staff_update, activity_staff_insert; lead:manage).
    expect(
      policies
        .filter((p) => p.roles === "dp_app" && p.cmd !== "SELECT")
        .map((p) => `${p.t}:${p.cmd}`),
    ).toEqual([
      "DocumentDownloadGrant:INSERT",
      "DocumentDownloadGrant:UPDATE",
      "Lead:INSERT",
      "Lead:UPDATE",
      "Lead:UPDATE",
      "LeadActivity:INSERT",
      "LeadDocumentDownload:INSERT",
      "LeadDocumentRequest:INSERT",
    ]);
  });

  it("shows dp_app nothing without a context of the current transaction (fail closed)", async () => {
    expect(await visible(asApp as unknown as Prisma.TransactionClient)).toEqual(none);
    expect(await appIn({}, visible)).toEqual(none);
    expect(await appIn({ staff: "" }, visible)).toEqual(none);
    expect(await appIn({ site: null, email: mine.email, grant: mine.token }, visible)).toEqual(
      none,
    );
    // A context set by plain set_config without the transaction stamp opens nothing either.
    const raw = await asApp.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('dp.lead_staff_session', ${root.token}, true)`;
      return visible(tx);
    });
    expect(raw).toEqual(none);
  });

  it("opens to staff exactly the sites the database finds lead:read for", async () => {
    // Super admin (ADR-017 v2) and the BV/Corporate sales users.
    expect(await appIn({ staff: root.token }, visible)).toEqual(total);
    expect(await appIn({ staff: salesBv.token }, visible)).toEqual(bvTotal);
    const com = await appIn({ staff: comSales.token }, (tx) => tx.lead.findMany());
    expect(com.length).toBe(total.leads - bvTotal.leads);
    expect(com.every((l) => l.siteId === COM)).toBe(true);
    // An expired assignment opens nothing (salesCom's ended in the previous block).
    expect(await appIn({ staff: salesCom.token }, visible)).toEqual(none);
    // Staff without lead:read: nothing, even with a valid session.
    for (const who of [pm, bvPublisher, bvEditor]) {
      expect(await appIn({ staff: who.token }, visible)).toEqual(none);
    }
    // DP-041: staff with lead:manage update only the workflow columns (guard); a lead's details
    // change only through the public form. Without lead:manage no row is even reachable.
    await rejectsDb(
      appIn({ staff: root.token }, (tx) =>
        tx.lead.updateMany({ where: { id: mine.leadId }, data: { company: "Staff Co" } }),
      ),
      /lead details change only through the public form/,
    );
    const officer = await newStaff([]);
    await assignRole(officer, "platform_customer_data_officer", null);
    const changed = await appIn({ staff: officer.token }, (tx) =>
      tx.lead.updateMany({ where: { id: mine.leadId }, data: { status: "CONTACTED" } }),
    );
    expect(changed.count).toBe(0);
  });

  it("accepts only a live session's raw token: not the stored hash, a random or a dead one", async () => {
    const x = await newStaff();
    await assignRole(x, "sales_crm_user", BV);
    expect((await appIn({ staff: x.token }, visible)).leads).toBe(bvTotal.leads);
    const hash = createHash("sha256").update(x.token).digest("hex");
    for (const bad of [hash, randomBytes(32).toString("base64url"), `${x.token}x`, "' OR 1=1 --"]) {
      expect(await appIn({ staff: bad }, visible)).toEqual(none);
    }
    const sessionId = async (who: Staff) =>
      (
        await owner.session.findUniqueOrThrow({
          where: { tokenHash: createHash("sha256").update(who.token).digest("hex") },
        })
      ).id;
    // Idle-expired.
    await owner.session.update({
      where: { id: await sessionId(x) },
      data: { idleExpiresAt: new Date() },
    });
    expect(await appIn({ staff: x.token }, visible)).toEqual(none);
    // Revoked (a new session of the same user first works).
    const x2 = await staff("rls-x2", [], root.userId, x.userId);
    expect((await appIn({ staff: x2.token }, visible)).leads).toBe(bvTotal.leads);
    await owner.session.update({
      where: { id: await sessionId(x2) },
      data: { revokedAt: new Date(), revokedReason: "ADMIN_REVOKED" },
    });
    expect(await appIn({ staff: x2.token }, visible)).toEqual(none);
    // A security-version change (password reset, MFA reset) ends every older session.
    const x3 = await staff("rls-x3", [], root.userId, x.userId);
    expect((await appIn({ staff: x3.token }, visible)).leads).toBe(bvTotal.leads);
    await owner.user.update({
      where: { id: x.userId },
      data: { securityVersion: { increment: 1 } },
    });
    expect(await appIn({ staff: x3.token }, visible)).toEqual(none);
  });

  it("closes at once when the role is revoked or the membership suspended", async () => {
    const x = await newStaff();
    const { assignmentId } = await assignRole(x, "sales_crm_user", BV);
    expect((await appIn({ staff: x.token }, visible)).leads).toBe(bvTotal.leads);
    await owner.membership.update({
      where: { userId_siteId: { userId: x.userId, siteId: BV } },
      data: { status: "SUSPENDED" },
    });
    expect(await appIn({ staff: x.token }, visible)).toEqual(none);
    await owner.membership.update({
      where: { userId_siteId: { userId: x.userId, siteId: BV } },
      data: { status: "ACTIVE" },
    });
    expect((await appIn({ staff: x.token }, visible)).leads).toBe(bvTotal.leads);
    const res = await root.admin("POST", `/role-assignments/${assignmentId}/revoke`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(204);
    expect(await appIn({ staff: x.token }, visible)).toEqual(none);
    expectError(await x.leads(), 403, "FORBIDDEN");
    // A deactivated user's session opens nothing either.
    const y = await newStaff();
    await assignRole(y, "sales_crm_user", BV);
    await owner.user.update({ where: { id: y.userId }, data: { status: "SUSPENDED" } });
    expect(await appIn({ staff: y.token }, visible)).toEqual(none);
  });

  it("opens to a visitor only the own lead or the own grant, never by site alone", async () => {
    const own = await appIn({ site: BV, email: mine.email }, async (tx) => ({
      leads: await tx.lead.findMany({ select: { id: true } }),
      requests: await tx.leadDocumentRequest.findMany({ select: { id: true } }),
    }));
    expect(own.leads).toEqual([{ id: mine.leadId }]);
    expect(own.requests).toEqual([{ id: mine.requestId }]);
    const byGrant = await appIn({ site: BV, grant: mine.token }, async (tx) => ({
      ...(await visible(tx)),
      request: await tx.leadDocumentRequest.findFirst({ select: { id: true } }),
    }));
    expect(byGrant).toMatchObject({ leads: 0, requests: 1, grants: 1, downloads: 0 });
    expect(byGrant.request?.id).toBe(mine.requestId);
    // The other site's key with the same e-mail or token: nothing (site from the proxy key only).
    expect(await appIn({ site: COM, email: mine.email, grant: mine.token }, visible)).toEqual(none);
    // A site alone, a malformed e-mail or token: nothing.
    expect(await appIn({ site: BV }, visible)).toEqual(none);
    expect(await appIn({ site: BV, email: "%", grant: "x" }, visible)).toEqual(none);
  });

  it("refuses public writes outside the visitor's own key", async () => {
    const ctx = { site: BV, email: "rls.writer@firm.example" };
    const lead = {
      email: "rls.writer@firm.example",
      fullName: "Rls Writer",
      company: "Firm",
      country: "NL",
    };
    // Into the other site, or under another e-mail than the form's.
    await rejectsDb(
      appIn(ctx, (tx) => tx.lead.create({ data: { ...lead, siteId: COM } })),
      /row-level security/,
    );
    await rejectsDb(
      appIn(ctx, (tx) =>
        tx.lead.create({ data: { ...lead, email: "someone.else@firm.example", siteId: BV } }),
      ),
      /row-level security/,
    );
    // Another visitor's lead cannot be changed from this context.
    const touched = await appIn(ctx, (tx) =>
      tx.lead.updateMany({ where: { id: mine.leadId }, data: { company: "Hijacked" } }),
    );
    expect(touched.count).toBe(0);
    // A grant with one's own token on someone else's request (its id is in the audit trail).
    const token = randomBytes(32).toString("base64url");
    await rejectsDb(
      appIn({ ...ctx, grant: token }, (tx) =>
        tx.documentDownloadGrant.create({
          data: {
            requestId: mine.requestId,
            siteId: BV,
            tokenHash: createHash("sha256").update(token).digest("hex"),
            expiresAt: new Date(Date.now() + 60_000),
          },
        }),
      ),
      /grant must belong to a request of the same site/,
    );
    expect(await owner.lead.count({ where: { email: lead.email } })).toBe(0);
  });

  it("cannot be switched off or redefined by dp_app", async () => {
    for (const sql of [
      `ALTER TABLE "Lead" DISABLE ROW LEVEL SECURITY`,
      `ALTER TABLE "Lead" NO FORCE ROW LEVEL SECURITY`,
      `DROP POLICY lead_staff_read ON "Lead"`,
      `CREATE POLICY lead_all ON "Lead" FOR SELECT TO dp_app USING (true)`,
      `ALTER POLICY lead_staff_read ON "Lead" USING (true)`,
      `CREATE OR REPLACE FUNCTION leads_rls_staff_site_ids() RETURNS uuid[] LANGUAGE sql AS 'SELECT ARRAY[]::uuid[]'`,
      `ALTER ROLE dp_app BYPASSRLS`,
    ]) {
      await rejectsDb(asApp.$executeRawUnsafe(sql), /must be owner|permission denied/);
    }
    // row_security = off makes a query that RLS would filter fail instead of returning all rows.
    await rejectsDb(
      asApp.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL row_security = off");
        return tx.lead.count();
      }),
      /row-level security/,
    );
    const role = await owner.$queryRaw<{ bypass: boolean; owns: bigint }[]>`
      SELECT rolbypassrls AS bypass,
        (SELECT count(*) FROM pg_class WHERE relowner = r.oid) AS owns
      FROM pg_roles r WHERE rolname = 'dp_app'`;
    expect(role[0]).toEqual({ bypass: false, owns: 0n });
  });

  it("keeps the context inside its transaction on a pooled connection", async () => {
    const single = new PrismaClient({
      adapter: new PrismaPg({ connectionString: urls.app, max: 1 }),
    });
    try {
      expect(await appIn({ staff: root.token }, visible, single)).toEqual(total);
      // Same (only) connection, next statements: the context is gone.
      const after = await single.$queryRaw<{ s: string | null; at: string | null }[]>`
        SELECT current_setting('dp.lead_staff_session', true) AS s,
               current_setting('dp.lead_ctx_at', true) AS at`;
      expect(after[0]?.s ?? "").toBe("");
      expect(after[0]?.at ?? "").toBe("");
      expect(await visible(single as unknown as Prisma.TransactionClient)).toEqual(none);
      // A context leaked to the whole session by mistake (is_local = false) opens nothing in
      // the next transaction: its stamp belongs to the transaction that set it.
      await single.$executeRaw`SELECT leads_rls_set_staff_context(${root.token})`;
      await single.$executeRaw`SELECT set_config('dp.lead_staff_session', ${root.token}, false),
        set_config('dp.lead_ctx_at', now()::text, false)`;
      expect(await visible(single as unknown as Prisma.TransactionClient)).toEqual(none);
      expect(
        await single.$transaction((tx) => visible(tx as unknown as Prisma.TransactionClient)),
      ).toEqual(none);
      // A following request on the same connection sees only its own context.
      expect(await appIn({ staff: salesBv.token }, visible, single)).toEqual(bvTotal);
      expect(await appIn({ site: BV, email: mine.email }, visible, single)).toMatchObject({
        leads: 1,
      });
    } finally {
      await single.$disconnect();
    }
  });

  it("still serves the public form, the download and the admin screens", async () => {
    const email = "rls.flow@firm.example";
    const res = await requestLead("bv", form({ documentId: leadDoc, email }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const out = LeadDocumentRequestResponseSchema.parse(res.body);
    expect((await download("bv", leadDoc, out.grant.token)).status).toBe(200);
    expect((await download("com", leadDoc, out.grant.token)).status).toBe(404);
    const grant = await owner.documentDownloadGrant.findFirstOrThrow({
      where: { tokenHash: createHash("sha256").update(out.grant.token).digest("hex") },
    });
    expect(grant.downloadCount).toBe(1);
    // A second form of the same e-mail updates the same lead (its own context finds it).
    const again = await requestLead("bv", form({ documentId: leadDoc, email, company: "New Co" }));
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    const lead = await owner.lead.findFirstOrThrow({ where: { siteId: BV, email } });
    expect(lead).toMatchObject({ requestCount: 2, company: "New Co" });
    const list = LeadListResponseSchema.parse((await salesBv.leads("?q=rls.flow")).body);
    expect(list.items.map((l) => l.id)).toEqual([lead.id]);
    const detail = LeadDetailResponseSchema.parse((await salesBv.leads(`/${lead.id}`)).body);
    expect(detail.requests).toHaveLength(2);
    expect(detail.requests.some((r) => r.downloads.length === 1)).toBe(true);
    expectError(await comSales.leads(`/${lead.id}`), 404, "NOT_FOUND");
  });
});

describe("DP-076 revision: direct role assignment (ADR-017 v2)", () => {
  let sweep: (
    db: PrismaClient,
    now?: Date,
  ) => Promise<{ requestsExpired: number; accessExpired: number }>;
  let fresh = 0;
  /** A new active, MFA-enrolled staff user with a membership at the given sites. */
  const newStaff = (sites: string[] = [BV], grants: { role: string; site?: string }[] = []) =>
    staff(`dr-${++fresh}`, grants, root.userId, undefined, { memberships: sites });
  const assign = (by: Staff, who: Staff, body: Record<string, unknown>) =>
    by.admin("POST", `/staff/${who.userId}/roles`, body);

  beforeAll(async () => {
    const mod = (await import(
      pathToFileURL(path.join(API_DIR, "dist/iam/customer-data-access/sweep.js")).href
    )) as { runCustomerDataAccessSweep: typeof sweep };
    sweep = mod.runCustomerDataAccessSweep;
  });

  it("lets the super admin read leads of every site directly", async () => {
    const res = await root.leads();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const list = LeadListResponseSchema.parse(res.body);
    expect(list.sites.map((s) => s.key).sort()).toEqual(["BV", "CORPORATE"]);
    expect(new Set(list.items.map((l) => l.siteKey))).toEqual(new Set(["BV", "CORPORATE"]));
    const audit = await lastAudit("leads.list_viewed");
    expect(audit).toMatchObject({ actorUserId: root.userId, scopeType: "PLATFORM", siteId: null });
    const adminGrant = await owner.roleAssignment.findFirstOrThrow({
      where: { userId: root.userId, revokedAt: null, role: { key: "platform_super_admin" } },
    });
    expect((audit?.metadata as { accessAssignmentIds?: string[] }).accessAssignmentIds).toContain(
      adminGrant.id,
    );
    const lead = await owner.lead.findFirstOrThrow({ where: { siteId: COM } });
    expect((await root.leads(`/${lead.id}`)).status).toBe(200);
  });

  it("lists staff with their roles and what the viewer may assign", async () => {
    const res = await root.admin("GET", "/staff");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const list = StaffListResponseSchema.parse(res.body);
    expect(list.viewerId).toBe(root.userId);
    const bv = list.staff.find((s) => s.id === salesBv.userId);
    expect(bv?.roles.map((r) => [r.roleKey, r.siteId])).toEqual([["sales_crm_user", BV]]);
    const sales = list.roles.find((r) => r.key === "sales_crm_user");
    expect(sales).toMatchObject({ customerData: true, scopeType: "SITE" });
    expect(sales?.siteIds.sort()).toEqual([BV, COM].sort());
    expect(list.roles.find((r) => r.key === "platform_super_admin")?.platform).toBe(true);
    // Customers never show up here.
    expect(list.staff.every((s) => s.email.endsWith("@staff.dp.test"))).toBe(true);
    // Staff without user:read get nothing.
    expectError(await bvEditor.admin("GET", "/staff"), 403, "FORBIDDEN");
  });

  it("assigns a site role directly: permanent, audited, effective at once, own site only", async () => {
    const x = await newStaff([]);
    expectError(await x.leads(), 403, "FORBIDDEN");
    const { assignmentId } = await assignRole(x, "sales_crm_user", BV);
    const row = await owner.roleAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(row).toMatchObject({ expiresAt: null, grantedById: root.userId, siteId: BV });
    // The site role brought an ACTIVE membership with it.
    expect(
      (
        await owner.membership.findUniqueOrThrow({
          where: { userId_siteId: { userId: x.userId, siteId: BV } },
        })
      ).status,
    ).toBe("ACTIVE");
    const list = LeadListResponseSchema.parse((await x.leads()).body);
    expect(list.sites.map((s) => s.key)).toEqual(["BV"]);
    expect(list.items.every((l) => l.siteId === BV)).toBe(true);
    expectError(await x.leads(`?siteId=${COM}`), 403, "FORBIDDEN");
    const comLead = await owner.lead.findFirstOrThrow({ where: { siteId: COM } });
    expectError(await x.leads(`/${comLead.id}`), 404, "NOT_FOUND");
    const event = await owner.auditEvent.findFirstOrThrow({
      where: { action: "iam.role_assigned", resourceId: assignmentId },
    });
    expect(event).toMatchObject({ actorUserId: root.userId, outcome: "SUCCESS", siteId: BV });
    expect(event.metadata).toMatchObject({ roleKey: "sales_crm_user", customerData: true });
    // The same role again is refused; another site is a separate assignment.
    expectError(
      await assign(root, x, { roleKey: "sales_crm_user", siteId: BV }),
      409,
      "CONFLICT_STATE",
      {
        path: "(root)",
        rule: "already_assigned",
      },
    );
  });

  it("revokes at once, audited", async () => {
    const x = await newStaff();
    const { assignmentId } = await assignRole(x, "sales_crm_user", BV);
    expect((await x.leads()).status).toBe(200);
    const res = await root.admin("POST", `/role-assignments/${assignmentId}/revoke`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(204);
    expectError(await x.leads(), 403, "FORBIDDEN");
    expectError(
      await root.admin("POST", `/role-assignments/${assignmentId}/revoke`, {}),
      409,
      "CONFLICT_STATE",
      { path: "(root)", rule: "already_ended" },
    );
    const event = await owner.auditEvent.findFirstOrThrow({
      where: { action: "iam.role_revoked", resourceId: assignmentId },
    });
    expect(event.actorUserId).toBe(root.userId);
    expectError(
      await root.admin("POST", `/role-assignments/not-a-uuid/revoke`, {}),
      404,
      "NOT_FOUND",
    );
  });

  it("gives the platform officer role every site", async () => {
    const x = await newStaff([]);
    await assignRole(x, "platform_customer_data_officer", null);
    const list = LeadListResponseSchema.parse((await x.leads()).body);
    expect(list.sites.map((s) => s.key).sort()).toEqual(["BV", "CORPORATE"]);
  });

  it("keeps the no-escalation, self-grant, scope and membership rules", async () => {
    const siteAdmin = await newStaff([BV], [{ role: "site_admin", site: BV }]);
    const x = await newStaff([BV]);
    // A site admin holds no customer data, so it cannot hand it out, and only on its own site.
    expectError(
      await assign(siteAdmin, x, { roleKey: "sales_crm_user", siteId: BV }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await assign(siteAdmin, x, { roleKey: "content_editor", siteId: COM }),
      403,
      "FORBIDDEN",
    );
    expect((await assign(siteAdmin, x, { roleKey: "content_editor", siteId: BV })).status).toBe(
      201,
    );
    // Its staff list is limited to its site.
    const seen = StaffListResponseSchema.parse((await siteAdmin.admin("GET", "/staff")).body);
    expect(seen.staff.every((s) => s.memberships.every((m) => m.siteId === BV))).toBe(true);
    expect(seen.roles.find((r) => r.key === "sales_crm_user")?.siteIds).toEqual([]);
    // Nobody grants themselves, nor anyone up their own grant chain (x got its role from the
    // site admin).
    expectError(
      await assign(root, root, { roleKey: "sales_crm_user", siteId: BV }),
      409,
      "CONFLICT_STATE",
      { path: "(root)", rule: "self_grant" },
    );
    expectError(
      await assign(x, siteAdmin, { roleKey: "read_only", siteId: BV }),
      409,
      "CONFLICT_STATE",
      {
        path: "(root)",
        rule: "reciprocal_grant",
      },
    );
    // Staff without role_assignment:grant assign nothing.
    const y = await newStaff([BV]);
    expectError(await assign(x, y, { roleKey: "read_only", siteId: BV }), 403, "FORBIDDEN");
    // Input and scope checks.
    expectError(
      await assign(root, x, { roleKey: "no_such_role", siteId: BV }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(await assign(root, x, { roleKey: "sales_crm_user" }), 400, "VALIDATION_FAILED", {
      path: "(root)",
      rule: "scope_mismatch",
    });
    expectError(
      await assign(root, x, {
        roleKey: "sales_crm_user",
        siteId: BV,
        expiresAt: new Date(0).toISOString(),
      }),
      400,
      "VALIDATION_FAILED",
      { path: "(root)", rule: "expiry_in_past" },
    );
    // A suspended membership is not silently reactivated.
    await owner.membership.update({
      where: { userId_siteId: { userId: x.userId, siteId: BV } },
      data: { status: "SUSPENDED" },
    });
    expectError(
      await assign(root, x, { roleKey: "sales_crm_user", siteId: BV }),
      409,
      "CONFLICT_STATE",
      {
        path: "(root)",
        rule: "membership_inactive",
      },
    );
    const denied = await owner.auditEvent.findFirst({
      where: { action: "iam.role_assignment_denied", actorUserId: siteAdmin.userId },
    });
    expect(denied?.outcome).toBe("DENIED");
  });

  it("replaces a time-limited assignment only when an admin assigns the role again", async () => {
    const x = await newStaff();
    const first = await assignRole(x, "sales_crm_user", BV, new Date(Date.now() + 5 * 86_400_000));
    // Nothing turns permanent by itself.
    expect(
      (await owner.roleAssignment.findUniqueOrThrow({ where: { id: first.assignmentId } }))
        .expiresAt,
    ).not.toBeNull();
    const second = await assignRole(x, "sales_crm_user", BV);
    expect(second.replacedAssignmentId).toBe(first.assignmentId);
    const old = await owner.roleAssignment.findUniqueOrThrow({ where: { id: first.assignmentId } });
    expect(old.revokedAt).not.toBeNull();
    expect(
      (await owner.roleAssignment.findUniqueOrThrow({ where: { id: second.assignmentId } }))
        .expiresAt,
    ).toBeNull();
  });

  it("needs only the sign-in MFA for roles; account actions keep their step-up", async () => {
    const stale = await staff(
      "dr-stale",
      [{ role: "platform_super_admin" }],
      root.userId,
      undefined,
      {
        mfaVerifiedAt: new Date(Date.now() - 6 * 3_600_000),
      },
    );
    const x = await newStaff();
    expect((await assign(stale, x, { roleKey: "read_only", siteId: BV })).status).toBe(201);
    expect((await stale.leads()).status).toBe(200);
    expectError(
      await stale.admin("POST", `/users/${x.userId}/suspend`, { reason: "Stale session check." }),
      403,
      "AUTH_STEP_UP_REQUIRED",
    );
  });

  it("retires the approval workflow: no routes, no new requests, history read-only", async () => {
    for (const p of ["/customer-data-access", "/customer-data-access/mine"]) {
      expectError(await root.admin("GET", p), 404, "NOT_FOUND");
    }
    expectError(await root.admin("POST", "/customer-data-access/requests", {}), 404, "NOT_FOUND");
    const role = await owner.role.findUniqueOrThrow({ where: { key: "sales_crm_user" } });
    await rejectsDb(
      owner.customerDataAccessRequest.create({
        data: {
          userId: salesBv.userId,
          roleId: role.id,
          scopeType: "SITE",
          siteId: BV,
          justification: "A request after the workflow was retired.",
          durationDays: 5,
          requestedById: root.userId,
          decideBy: new Date(Date.now() + 86_400_000),
        },
      }),
      /workflow is retired/,
    );
    await rejectsDb(asApp.customerDataAccessRequest.deleteMany({}), /permission denied/);
    // The legacy sweep still runs and finds nothing to record.
    expect(await sweep(asApp, new Date())).toEqual({ requestsExpired: 0, accessExpired: 0 });
  });
});

// DP-096 (ADR-003 §4-5): retention, anonymisation and erasure on request. The operator credential
// (dp_iam_bootstrap) switches to dp_lead_retention; the database limits that role to clearing the
// identity and link fields. Old data is inserted as dp_owner with past timestamps (the request
// and grant guards allow inserts only), so the cut-offs are tested against the real clock.
describe("DP-096 lead retention, anonymisation and erasure", () => {
  let operator: PrismaClient;
  const DAY = 86_400_000;
  const longAgo = (days: number) => new Date(Date.now() - days * DAY);
  const hex64 = () => randomBytes(32).toString("hex");

  /** A lead with one real request and one download, then made "old" by dp_owner. */
  async function oldLead(email: string, ageDays: number, site: "bv" | "com" = "bv") {
    const res = await requestLead(
      site,
      form({ documentId: site === "bv" ? leadDoc : bothDoc, email }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const out = LeadDocumentRequestResponseSchema.parse(res.body);
    const file = await download(site, site === "bv" ? leadDoc : bothDoc, out.grant.token);
    expect(file.status).toBe(200);
    const lead = await owner.lead.findFirstOrThrow({
      where: { email, siteId: site === "bv" ? BV : COM },
    });
    if (ageDays > 0) {
      await owner.lead.update({
        where: { id: lead.id },
        data: { firstRequestAt: longAgo(ageDays), lastRequestAt: longAgo(ageDays) },
      });
    }
    return { leadId: lead.id, reference: out.reference };
  }

  /** Everything that a dry run must leave untouched, as one comparable text. */
  async function fingerprint(): Promise<string> {
    const rows = await owner.$queryRaw<{ t: string; n: bigint; h: string | null }[]>`
      SELECT 'lead' AS t, count(*) AS n, md5(string_agg(l::text, '|' ORDER BY l."id")) AS h FROM "Lead" l
      UNION ALL SELECT 'req', count(*), md5(string_agg(r::text, '|' ORDER BY r."id")) FROM "LeadDocumentRequest" r
      UNION ALL SELECT 'dl', count(*), md5(string_agg(d::text, '|' ORDER BY d."id")) FROM "LeadDocumentDownload" d
      UNION ALL SELECT 'grant', count(*), md5(string_agg(g::text, '|' ORDER BY g."id")) FROM "DocumentDownloadGrant" g
      UNION ALL SELECT 'bucket', count(*), md5(string_agg(b::text, '|' ORDER BY b."key")) FROM "PublicRateLimit" b
      UNION ALL SELECT 'audit', count(*), NULL FROM "AuditEvent"`;
    return JSON.stringify(rows.map((r) => [r.t, Number(r.n), r.h]));
  }

  let due: { leadId: string; reference: string };
  let recent: { leadId: string; reference: string };
  let held: { leadId: string; reference: string };
  let oldRequestId: string;
  let oldGrantId: string;

  beforeAll(async () => {
    operator = new PrismaClient({ adapter: new PrismaPg({ connectionString: urls.boot }) });
    due = await oldLead("due.person@retention.example", 800);
    recent = await oldLead("recent.person@retention.example", 30);
    held = await oldLead("held.person@retention.example", 800);
    // An old request of the recent lead (IP HMAC older than 90 days) with a grant that was never
    // used and expired long ago; inserted directly with past timestamps.
    const tmpl = await owner.leadDocumentRequest.findFirstOrThrow({
      where: { leadId: recent.leadId },
    });
    const created = longAgo(120);
    const oldReq = await owner.leadDocumentRequest.create({
      data: {
        ...tmpl,
        id: undefined,
        reference: "RT000001",
        ipPrefixHmac: hex64(),
        requestId: "old-request",
        createdAt: created,
      } as never,
    });
    oldRequestId = oldReq.id;
    const g = await owner.documentDownloadGrant.create({
      data: {
        requestId: oldReq.id,
        siteId: BV,
        tokenHash: hex64(),
        createdAt: created,
        expiresAt: new Date(created.getTime() + 10 * 60_000),
      },
    });
    oldGrantId = g.id;
    await owner.publicRateLimit.create({
      data: { key: hex64(), windowStartedAt: longAgo(2), count: 1, expiresAt: longAgo(1) },
    });
  });

  afterAll(async () => {
    await operator?.$disconnect();
  });

  it("lets only the operator switch to the retention role; dp_app cannot touch identity fields", async () => {
    await rejectsDb(asApp.$executeRawUnsafe("SET ROLE dp_lead_retention"), /permission denied/);
    await rejectsDb(
      asApp.lead.update({ where: { id: due.leadId }, data: { email: "x@retention.example" } }),
      /permission denied/,
    );
    await rejectsDb(
      asApp.lead.update({ where: { id: due.leadId }, data: { anonymisedAt: new Date() } }),
      /permission denied/,
    );
    await rejectsDb(
      asApp.lead.update({ where: { id: due.leadId }, data: { retentionHold: "CUSTOMER" } }),
      /permission denied/,
    );
    await rejectsDb(
      asApp.documentDownloadGrant.delete({ where: { id: oldGrantId } }),
      /permission denied/,
    );
    // The operator itself, without the role switch, has no rights on lead data either.
    await rejectsDb(
      operator.$executeRaw`UPDATE "Lead" SET "fullName" = '' WHERE "id" = ${due.leadId}::uuid`,
      /permission denied/,
    );
    // And dp_app still updates the latest details of a live lead (the form path, in the
    // visitor's own context since DP-103).
    await appIn({ site: BV, email: "recent.person@retention.example" }, (tx) =>
      tx.lead.update({ where: { id: recent.leadId }, data: { company: "Recent Co" } }),
    );
  });

  it("keeps the retention role inside the anonymisation rules", async () => {
    const asRole = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      operator.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE dp_lead_retention");
        return fn(tx);
      });
    // Not a clearing value, another column, a deletion, a used grant: all refused.
    await rejectsDb(
      asRole(
        (tx) =>
          tx.$executeRaw`UPDATE "LeadDocumentRequest" SET "company" = 'Other' WHERE "leadId" = ${due.leadId}::uuid`,
      ),
      /only clear identity and link fields/,
    );
    await rejectsDb(
      asRole(
        (tx) =>
          tx.$executeRaw`UPDATE "LeadDocumentRequest" SET "country" = 'DE' WHERE "leadId" = ${due.leadId}::uuid`,
      ),
      /permission denied/,
    );
    await rejectsDb(
      asRole(
        (tx) =>
          tx.$executeRaw`DELETE FROM "LeadDocumentRequest" WHERE "leadId" = ${due.leadId}::uuid`,
      ),
      /permission denied/,
    );
    await rejectsDb(
      asRole(
        (tx) =>
          tx.$executeRaw`UPDATE "Lead" SET "fullName" = 'Someone' WHERE "id" = ${due.leadId}::uuid`,
      ),
      /identity fields change only by anonymisation/,
    );
    await rejectsDb(
      asRole(
        (tx) =>
          tx.$executeRaw`UPDATE "Lead" SET "anonymisedAt" = now() WHERE "id" = ${due.leadId}::uuid`,
      ),
      /Lead_anonymised|Lead_full_name_trimmed/,
    );
    const used = await owner.documentDownloadGrant.findFirstOrThrow({
      where: { request: { leadId: due.leadId } },
    });
    await rejectsDb(
      asRole(
        (tx) => tx.$executeRaw`DELETE FROM "DocumentDownloadGrant" WHERE "id" = ${used.id}::uuid`,
      ),
      /only an unused grant/,
    );
    await rejectsDb(
      asRole((tx) => tx.$executeRaw`DELETE FROM "AuditEvent"`),
      /permission denied/,
    );
  });

  it("sets a hold only through the operator, audited without personal data", async () => {
    await expect(
      setRetentionHold(
        operator,
        {
          email: "held.person@retention.example",
          siteKey: "BV",
          hold: "CUSTOMER",
          reference: "CRM-4711",
        },
        new Date(),
      ),
    ).resolves.toEqual({ outcome: "set" });
    await expect(
      setRetentionHold(
        operator,
        {
          email: "nobody@retention.example",
          siteKey: "BV",
          hold: "CUSTOMER",
          reference: "CRM-4712",
        },
        new Date(),
      ),
    ).resolves.toEqual({ outcome: "no_match" });
    await expect(
      setRetentionHold(
        operator,
        {
          email: "held.person@retention.example",
          siteKey: "BV",
          hold: "CUSTOMER",
          reference: "a@b.example",
        },
        new Date(),
      ),
    ).rejects.toThrow(/ticket id/);
    const audit = await lastAudit("leads.retention_hold_set");
    expect(audit).toMatchObject({ resourceId: held.leadId, siteId: BV, actorType: "BOOTSTRAP" });
    expect(JSON.stringify(audit)).not.toMatch(/held\.person|retention\.example/);
  });

  it("dry run changes nothing, not even the audit trail, and reports what is due", async () => {
    const before = await fingerprint();
    const r = await runRetention(operator, new Date(), { apply: false });
    expect(await fingerprint()).toBe(before);
    expect(r.dryRun).toBe(true);
    expect(r.applied).toEqual({
      leadsAnonymised: 0,
      ipHmacCleared: 0,
      unusedGrantsDeleted: 0,
      rateLimitBucketsDeleted: 0,
    });
    expect(r.plan.leadsDue).toBeGreaterThanOrEqual(1);
    expect(r.plan.leadsHeld).toBe(1);
    expect(r.plan.ipHmacDue).toBeGreaterThanOrEqual(1);
    expect(r.plan.unusedGrantsDue).toBe(1);
    expect(r.plan.rateLimitBucketsDue).toBeGreaterThanOrEqual(1);
    // The API's own scheduled report plans the same way as dp_app (read only).
    expect(await planRetention(asApp, new Date())).toEqual(r.plan);
  });

  it("refuses --apply in production without the owner's separate approval", () => {
    expect(() => productionApproval({ DP_DEPLOY_ENV: "production" }, true)).toThrow(
      /separate approval/,
    );
    expect(() => productionApproval({ DP_DEPLOY_ENV: "prod-typo" }, true)).toThrow(
      /separate approval/,
    );
    expect(productionApproval({ DP_DEPLOY_ENV: "production" }, false)).toBeNull();
    expect(productionApproval({ DP_DEPLOY_ENV: "local" }, true)).toBeNull();
    expect(
      productionApproval(
        { DP_DEPLOY_ENV: "production", DP_LEAD_RETENTION_PRODUCTION_APPROVAL: "OWNER-2026-12-01" },
        true,
      ),
    ).toBe("OWNER-2026-12-01");
  });

  it("the CLI checks the database name and its own identity before anything", () => {
    const run = (args: string[], env: Record<string, string>) =>
      spawnSync(process.execPath, [path.join(API_DIR, "dist/leads/leads-cli.js"), ...args], {
        env: { PATH: process.env["PATH"] ?? "", ...env },
        encoding: "utf8",
      });
    const wrongDb = run(["retention", "--confirm-database", "other_db"], {
      IAM_BOOTSTRAP_DATABASE_URL: urls.boot,
    });
    expect(wrongDb.status).toBe(1);
    expect(wrongDb.stderr).toMatch(/--confirm-database/);
    const asAppUrl = run(["retention", "--confirm-database", DB_NAME], {
      IAM_BOOTSTRAP_DATABASE_URL: urls.app,
    });
    expect(asAppUrl.status).toBe(1);
    expect(asAppUrl.stderr).toMatch(/run as dp_iam_bootstrap/);
    const prodApply = run(["retention", "--confirm-database", DB_NAME, "--apply"], {
      IAM_BOOTSTRAP_DATABASE_URL: urls.boot,
      DP_DEPLOY_ENV: "production",
    });
    expect(prodApply.status).toBe(1);
    expect(prodApply.stderr).toMatch(/separate approval/);
    const dry = run(["retention", "--confirm-database", DB_NAME], {
      IAM_BOOTSTRAP_DATABASE_URL: urls.boot,
    });
    expect(dry.status, dry.stderr).toBe(0);
    const out = JSON.parse(dry.stdout);
    expect(out.dryRun).toBe(true);
    expect(dry.stdout).not.toMatch(/retention\.example|Ada|Lovelace|Analytical/);
  });

  it("applies: anonymises due leads only, keeps evidence and keys, skips the held lead", async () => {
    const r = await runRetention(operator, new Date(), { apply: true });
    expect(r.dryRun).toBe(false);
    expect(r.applied.leadsAnonymised).toBeGreaterThanOrEqual(1);
    expect(r.applied.unusedGrantsDeleted).toBe(1);
    expect(r.applied.ipHmacCleared).toBeGreaterThanOrEqual(1);
    expect(r.applied.rateLimitBucketsDeleted).toBeGreaterThanOrEqual(1);

    const lead = await owner.lead.findUniqueOrThrow({ where: { id: due.leadId } });
    expect(lead).toMatchObject({
      email: `anonymised+${due.leadId}@anonymised.invalid`,
      fullName: "",
      company: "",
      marketingConsentAt: null,
      country: "NL",
      requestCount: 1,
    });
    expect(lead.anonymisedAt).toBeInstanceOf(Date);
    const reqs = await owner.leadDocumentRequest.findMany({ where: { leadId: due.leadId } });
    for (const q of reqs) {
      expect(q).toMatchObject({
        fullName: "",
        company: "",
        ipPrefixHmac: null,
        reference: null,
        requestId: null,
      });
      // Consent evidence stays.
      expect(q.privacyNoticeVersion).toBe(LEAD_PRIVACY_NOTICE.version);
      expect(q.privacyNoticeSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const dls = await owner.leadDocumentDownload.findMany({
      where: { request: { leadId: due.leadId } },
    });
    expect(dls.length).toBe(1);
    expect(dls[0]).toMatchObject({ sha256: null, httpRequestId: null });
    expect(dls[0]?.byteSize).toBeGreaterThan(0);
    // The used grant stays with its download evidence (foreign key intact).
    expect(
      await owner.documentDownloadGrant.count({ where: { request: { leadId: due.leadId } } }),
    ).toBe(1);
    // Nothing of the person is left anywhere in these rows.
    const all = JSON.stringify([lead, reqs, dls]);
    expect(all).not.toMatch(/due\.person|Ada Lovelace|Analytical Engines/);
    expect(all).not.toContain(due.reference);

    // Held and recent leads untouched; the old request lost only its IP HMAC; its unused grant is gone.
    const h = await owner.lead.findUniqueOrThrow({ where: { id: held.leadId } });
    expect(h).toMatchObject({
      anonymisedAt: null,
      fullName: "Ada Lovelace",
      retentionHold: "CUSTOMER",
    });
    const rc = await owner.lead.findUniqueOrThrow({ where: { id: recent.leadId } });
    expect(rc.anonymisedAt).toBeNull();
    const oldReq = await owner.leadDocumentRequest.findUniqueOrThrow({
      where: { id: oldRequestId },
    });
    expect(oldReq).toMatchObject({
      ipPrefixHmac: null,
      reference: "RT000001",
      fullName: "Ada Lovelace",
    });
    expect(await owner.documentDownloadGrant.findUnique({ where: { id: oldGrantId } })).toBeNull();
    const fresh = await owner.leadDocumentRequest.findFirstOrThrow({
      where: { leadId: recent.leadId, reference: { not: "RT000001" } },
    });
    expect(fresh.ipPrefixHmac).toMatch(/^[0-9a-f]{64}$/);

    // One audit event, counts only.
    const audit = await lastAudit("leads.retention_applied");
    expect(audit).toMatchObject({ actorType: "BOOTSTRAP", outcome: "SUCCESS" });
    expect(audit?.metadata).toMatchObject({ leadsHeld: 1, unusedGrantsDeleted: 1 });
    expect(JSON.stringify(audit)).not.toMatch(/@|Ada|Lovelace/);
  });

  it("an anonymised lead is final; the same e-mail starts a new lead", async () => {
    await rejectsDb(
      owner.lead.update({ where: { id: due.leadId }, data: { country: "DE" } }),
      /an anonymised lead cannot change/,
    );
    const again = await requestLead(
      "bv",
      form({ documentId: leadDoc, email: "due.person@retention.example" }),
    );
    expect(again.status).toBe(201);
    const leads = await owner.lead.findMany({
      where: { siteId: BV, email: "due.person@retention.example" },
    });
    expect(leads.length).toBe(1);
    expect(leads[0]?.id).not.toBe(due.leadId);
  });

  it("shows an anonymised lead in the admin as anonymised, without references", async () => {
    const res = await salesBv.leads(`/${due.leadId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const detail = LeadDetailResponseSchema.parse(res.body);
    expect(detail.lead.anonymisedAt).not.toBeNull();
    expect(detail.lead.email).toBe(`anonymised+${due.leadId}@anonymised.invalid`);
    expect(detail.requests.every((q) => q.reference === null)).toBe(true);
    expect(detail.requests.flatMap((q) => q.downloads).every((d) => d.sha256 === null)).toBe(true);
  });

  describe("erasure on request (GDPR Art. 17)", () => {
    const EMAIL = "erase.me@retention.example";
    beforeAll(async () => {
      await oldLead(EMAIL, 0, "bv");
      await oldLead(EMAIL, 0, "com");
    });

    it("needs a ticket-style identity check reference, never an e-mail", async () => {
      for (const bad of ["", "ab", "erase.me@retention.example", "has space"]) {
        await expect(
          eraseByEmail(operator, { email: EMAIL, identityCheck: bad, apply: true }, new Date()),
        ).rejects.toThrow(/identity check reference/);
      }
    });

    it("reports an unknown e-mail as no match; the applied refusal is audited without the address", async () => {
      const dry = await eraseByEmail(
        operator,
        { email: "unknown@retention.example", identityCheck: "DSR-1", apply: false },
        new Date(),
      );
      expect(dry).toEqual({ outcome: "no_match", matched: 0, held: 0, anonymised: 0 });
      await eraseByEmail(
        operator,
        { email: "unknown@retention.example", identityCheck: "DSR-1", apply: true },
        new Date(),
      );
      const audit = await lastAudit("leads.erasure_requested");
      expect(audit).toMatchObject({ outcome: "DENIED", reason: "no lead matched" });
      expect(JSON.stringify(audit)).not.toMatch(/unknown@|retention\.example/);
    });

    it("refuses a held lead for manual legal review and changes nothing", async () => {
      const r = await eraseByEmail(
        operator,
        { email: "held.person@retention.example", identityCheck: "DSR-2", apply: true },
        new Date(),
      );
      expect(r).toEqual({ outcome: "held", matched: 1, held: 1, anonymised: 0 });
      const h = await owner.lead.findUniqueOrThrow({ where: { id: held.leadId } });
      expect(h.anonymisedAt).toBeNull();
      const audit = await lastAudit("leads.erasure_requested");
      expect(audit).toMatchObject({
        resourceId: held.leadId,
        outcome: "DENIED",
        reason: "retention hold: manual legal review",
      });
    });

    it("dry run first, then erases the person's leads on every site", async () => {
      const before = await fingerprint();
      const dry = await eraseByEmail(
        operator,
        { email: ` ${EMAIL.toUpperCase()} `, identityCheck: "DSR-3", apply: false },
        new Date(),
      );
      expect(dry).toEqual({ outcome: "would_erase", matched: 2, held: 0, anonymised: 0 });
      expect(await fingerprint()).toBe(before);

      const done = await eraseByEmail(
        operator,
        { email: EMAIL, identityCheck: "DSR-3", apply: true },
        new Date(),
      );
      expect(done).toEqual({ outcome: "erased", matched: 2, held: 0, anonymised: 2 });
      expect(await owner.lead.count({ where: { email: EMAIL } })).toBe(0);
      const audits = await owner.auditEvent.findMany({
        where: { action: "leads.erasure_applied" },
      });
      expect(audits.map((a) => a.siteId).sort()).toEqual([BV, COM].sort());
      expect(JSON.stringify(audits)).not.toMatch(/erase\.me|retention\.example/);
      // A second request finds nothing left.
      const again = await eraseByEmail(
        operator,
        { email: EMAIL, identityCheck: "DSR-3", apply: false },
        new Date(),
      );
      expect(again.outcome).toBe("no_match");
    });
  });
});

describe("DP-041 lead sales workflow (ADR-019)", () => {
  let operator: PrismaClient;
  let fresh = 0;
  const DAY = 86_400_000;
  /** A staff user with a role (site roles get an ACTIVE membership through `staff`). */
  const member = async (role: string, siteId: string | null) => {
    const x = await staff(`wf-${++fresh}`, [], root.userId, undefined, {
      memberships: siteId ? [siteId] : [],
    });
    await assignRole(x, role, siteId);
    return x;
  };
  async function newLead(email: string, site: "bv" | "com" = "bv"): Promise<string> {
    const res = await requestLead(
      site,
      form({ documentId: site === "bv" ? leadDoc : bothDoc, email }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (
      await owner.lead.findFirstOrThrow({ where: { email, siteId: site === "bv" ? BV : COM } })
    ).id;
  }
  const flow = (who: Staff, id: string, body: unknown) =>
    who.admin("POST", `/leads/${id}/workflow`, body);
  const note = (who: Staff, id: string, body: unknown) =>
    who.admin("POST", `/leads/${id}/activities`, body);
  async function detail(who: Staff, id: string) {
    const res = await who.leads(`/${id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return LeadDetailResponseSchema.parse(res.body);
  }
  async function list(who: Staff, query: string) {
    const res = await who.leads(query);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return LeadListResponseSchema.parse(res.body);
  }
  async function moved(who: Staff, id: string, body: Record<string, unknown>) {
    const res = await flow(who, id, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return LeadWorkflowResponseSchema.parse(res.body).lead;
  }
  const version = async (id: string) =>
    (await owner.lead.findUniqueOrThrow({ where: { id } })).workflowVersion;

  let L1: string; // BV
  let L2: string; // BV
  let L3: string; // Corporate
  let sA: Staff; // sales_crm_user @ BV
  let sB: Staff; // sales_crm_user @ BV
  let sCom: Staff; // sales_crm_user @ Corporate
  let officer: Staff; // platform_customer_data_officer: reads, does not manage
  let siteAdmin: Staff; // site_admin @ BV: no customer data
  let god: Staff; // the designated system owner (ADR-018)

  beforeAll(async () => {
    operator = new PrismaClient({ adapter: new PrismaPg({ connectionString: urls.boot }) });
    L1 = await newLead("wf.one@pipeline.example");
    L2 = await newLead("wf.two@pipeline.example");
    L3 = await newLead("wf.three@pipeline.example", "com");
    sA = await member("sales_crm_user", BV);
    sB = await member("sales_crm_user", BV);
    sCom = await member("sales_crm_user", COM);
    officer = await member("platform_customer_data_officer", null);
    siteAdmin = await staff("wf-site-admin", [{ role: "site_admin", site: BV }], root.userId);
    god = await staff("wf-god", [], root.userId);
    const hash = randomBytes(32).toString("hex");
    await operator.$queryRaw`SELECT iam_owner_designation_start(${god.userId}::uuid, ${hash},
      ${"DP-041 test: God Mode on leads"})::text AS id`;
    await asApp.$queryRaw`SELECT iam_owner_designation_confirm(${god.userId}::uuid, ${hash},
      ${"dp041-test"})::text AS id`;
    expect(await owner.systemOwner.count({ where: { userId: god.userId } })).toBe(1);
  });

  afterAll(async () => {
    await operator?.$disconnect();
  });

  it("starts every lead as NEW and unassigned (additive migration)", async () => {
    const rows = await owner.lead.findMany({ where: { id: { in: [L1, L2, L3] } } });
    expect(
      rows.map((r) => [r.status, r.assignedToId, r.workflowVersion, r.statusChangedAt]),
    ).toEqual([
      ["NEW", null, 0, null],
      ["NEW", null, 0, null],
      ["NEW", null, 0, null],
    ]);
    const d = await detail(sA, L1);
    expect(d.lead).toMatchObject({ status: "NEW", assignedTo: null, workflowVersion: 0 });
    expect(d.activities).toEqual([]);
    expect(d.canManage).toBe(true);
  });

  it("moves the status along the allowed transitions only, with an optimistic version", async () => {
    const one = await moved(sA, L1, { version: 0, status: "CONTACTED" });
    expect(one).toMatchObject({ status: "CONTACTED", workflowVersion: 1 });
    expect(one.statusChangedAt).not.toBeNull();
    // The same (now stale) version again: refused, nothing changes.
    expectError(await flow(sA, L1, { version: 0, status: "QUALIFIED" }), 409, "CONFLICT_STATE", {
      path: "version",
      rule: "stale",
    });
    // Not an allowed transition (CONTACTED → CONVERTED skips qualification).
    expectError(await flow(sA, L1, { version: 1, status: "CONVERTED" }), 409, "CONFLICT_STATE", {
      path: "status",
      rule: "transition",
    });
    expectError(await flow(sA, L1, { version: 1, status: "CONTACTED" }), 409, "CONFLICT_STATE", {
      path: "lead",
      rule: "unchanged",
    });
    expectError(await flow(sA, L1, { version: 1 }), 400, "VALIDATION_FAILED");
    expectError(await flow(sA, L1, { version: 1, status: "WON" }), 400, "VALIDATION_FAILED");
    expect((await moved(sA, L1, { version: 1, status: "QUALIFIED" })).status).toBe("QUALIFIED");
    expect((await moved(sB, L1, { version: 2, status: "CONVERTED" })).status).toBe("CONVERTED");
    // CONVERTED is final.
    for (const to of ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED"]) {
      expectError(await flow(sA, L1, { version: 3, status: to }), 409, "CONFLICT_STATE");
    }
    // UNQUALIFIED can be reopened.
    await moved(sA, L2, { version: 0, status: "UNQUALIFIED" });
    expect((await moved(sA, L2, { version: 1, status: "CONTACTED" })).status).toBe("CONTACTED");
    // The database wrote the history: who, when, from → to.
    const history = await owner.leadActivity.findMany({
      where: { leadId: L1 },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((h) => [h.kind, h.fromStatus, h.toStatus, h.actorUserId])).toEqual([
      ["STATUS_CHANGED", "NEW", "CONTACTED", sA.userId],
      ["STATUS_CHANGED", "CONTACTED", "QUALIFIED", sA.userId],
      ["STATUS_CHANGED", "QUALIFIED", "CONVERTED", sB.userId],
    ]);
    const ev = await lastAudit("leads.status_changed");
    expect(ev).toMatchObject({
      actorUserId: sA.userId,
      resourceId: L2,
      siteId: BV,
      outcome: "SUCCESS",
    });
    expect(ev?.metadata).toMatchObject({ from: "UNQUALIFIED", to: "CONTACTED", version: 2 });
    expect(JSON.stringify(ev?.metadata)).not.toContain("pipeline.example");
  });

  it("assigns only to staff with lead:manage on the lead's site; unassigns", async () => {
    let v = await version(L2);
    const assigned = await moved(sA, L2, { version: v, assignedToId: sB.userId });
    expect(assigned.assignedTo).toEqual({ id: sB.userId, displayName: sB.name, active: true });
    expect(assigned.assignedAt).not.toBeNull();
    v = assigned.workflowVersion;
    // Corporate sales, a read-only officer, a site admin and an unknown id are not eligible.
    for (const who of [sCom, officer, siteAdmin, pm]) {
      expectError(
        await flow(sA, L2, { version: v, assignedToId: who.userId }),
        400,
        "VALIDATION_FAILED",
        { path: "assignedToId", rule: "assignee_not_eligible" },
      );
    }
    expectError(
      await flow(sA, L2, { version: v, assignedToId: "0190e000-0000-7000-8000-000000000000" }),
      400,
      "VALIDATION_FAILED",
    );
    const denied = await owner.auditEvent.findFirst({
      where: { action: "leads.access_denied", reason: "assignee_not_eligible" },
      orderBy: { occurredAt: "desc" },
    });
    expect(denied).toMatchObject({ actorUserId: sA.userId, outcome: "DENIED", resourceId: L2 });
    // Platform super admin and the system owner may be assigned on every site.
    v = (await moved(sA, L2, { version: v, assignedToId: root.userId })).workflowVersion;
    v = (await moved(sA, L2, { version: v, assignedToId: god.userId })).workflowVersion;
    // Status and assignment in one change, with a note.
    const both = await moved(sB, L2, {
      version: v,
      status: "QUALIFIED",
      assignedToId: sA.userId,
      note: "  Asked for a quote on 200 drums.  ",
    });
    expect(both).toMatchObject({ status: "QUALIFIED", assignedTo: { id: sA.userId } });
    // One change, three rows in the order they were written (newest first): the note saved with
    // the change after the database's status and assignment rows.
    const ordered = (await detail(sB, L2)).activities.slice(0, 3);
    expect(ordered.map((a) => a.kind)).toEqual(["NOTE", "ASSIGNMENT_CHANGED", "STATUS_CHANGED"]);
    const unassigned = await moved(sA, L2, { version: both.workflowVersion, assignedToId: null });
    expect(unassigned).toMatchObject({ assignedTo: null, assignedAt: null });
    const d = await detail(sA, L2);
    expect(
      d.activities
        .filter((a) => a.kind === "ASSIGNMENT_CHANGED")
        .map((a) => [a.fromAssignee?.id ?? null, a.toAssignee?.id ?? null]),
    ).toEqual([
      [sA.userId, null],
      [god.userId, sA.userId],
      [root.userId, god.userId],
      [sB.userId, root.userId],
      [null, sB.userId],
    ]);
    const n = d.activities.find((a) => a.kind === "NOTE");
    expect(n).toMatchObject({ body: "Asked for a quote on 200 drums.", actor: { id: sB.userId } });
    // The picker offers exactly the eligible staff of BV.
    const ids = d.assignees.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([sA.userId, sB.userId, root.userId, god.userId]));
    for (const x of [sCom, officer, siteAdmin, pm]) expect(ids).not.toContain(x.userId);
  });

  it("shows an assignee who lost lead:manage as inactive, and no longer offers them", async () => {
    const gone = await member("sales_crm_user", BV);
    const v = await version(L1);
    const out = await moved(sA, L1, { version: v, assignedToId: gone.userId });
    expect(out.assignedTo?.active).toBe(true);
    await owner.membership.update({
      where: { userId_siteId: { userId: gone.userId, siteId: BV } },
      data: { status: "SUSPENDED" },
    });
    const d = await detail(sA, L1);
    expect(d.lead.assignedTo).toMatchObject({ id: gone.userId, active: false });
    expect(d.assignees.map((u) => u.id)).not.toContain(gone.userId);
    // Unassigned, they cannot be assigned again: refused by the API and by the database.
    const v2 = (await moved(sA, L1, { version: d.lead.workflowVersion, assignedToId: null }))
      .workflowVersion;
    expectError(
      await flow(sA, L1, { version: v2, assignedToId: gone.userId }),
      400,
      "VALIDATION_FAILED",
      { path: "assignedToId", rule: "assignee_not_eligible" },
    );
    await rejectsDb(
      appIn({ staff: sA.token }, (tx) =>
        tx.lead.update({ where: { id: L1 }, data: { assignedToId: gone.userId } }),
      ),
      /assignee needs lead:manage/,
    );
  });

  it("refuses staff without lead:manage and leads of other sites (audited)", async () => {
    const v = await version(L3);
    // Read but no manage: 403 FORBIDDEN, DENIED audit.
    expectError(await flow(officer, L3, { version: v, status: "CONTACTED" }), 403, "FORBIDDEN");
    expectError(await note(officer, L3, { kind: "NOTE", body: "x" }), 403, "FORBIDDEN");
    for (const who of [siteAdmin, pm, bvPublisher]) {
      expectError(await flow(who, L1, { version: 0, status: "CONTACTED" }), 403, "FORBIDDEN");
    }
    // Manage elsewhere: the lead looks unknown (IDOR), audited.
    expectError(await flow(sA, L3, { version: v, status: "CONTACTED" }), 404, "NOT_FOUND");
    expectError(await note(sCom, L1, { kind: "NOTE", body: "x" }), 404, "NOT_FOUND");
    const ev = await owner.auditEvent.findFirst({
      where: { action: "leads.access_denied", resourceId: L1, actorUserId: sCom.userId },
    });
    expect(ev).toMatchObject({ outcome: "DENIED", reason: "not_found_or_other_site" });
    expect(await version(L3)).toBe(v);
    // The officer reads the lead and its history, without controls.
    const d = await detail(officer, L2);
    expect(d.canManage).toBe(false);
    expect(d.assignees).toEqual([]);
    expect(d.activities.length).toBeGreaterThan(0);
  });

  it("lets the super admin and the system owner work leads of every site", async () => {
    const a = await moved(root, L3, { version: await version(L3), status: "CONTACTED" });
    const b = await moved(god, L3, { version: a.workflowVersion, assignedToId: sCom.userId });
    expect(b.assignedTo?.id).toBe(sCom.userId);
    const c = await note(god, L3, { kind: "NOTE", body: "Owner follow-up." });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(LeadActivityResponseSchema.parse(c.body).activity.actor.id).toBe(god.userId);
    // Corporate sales sees it; BV sales does not.
    expect((await detail(sCom, L3)).activities.map((x) => x.actor.id)).toContain(god.userId);
    expectError(await sA.leads(`/${L3}`), 404, "NOT_FOUND");
  });

  it("records notes and contacts; rejects empty, future or malformed input", async () => {
    const n1 = await note(sA, L2, { kind: "NOTE", body: "Prefers e-mail.\nCall after 15:00." });
    expect(n1.status, JSON.stringify(n1.body)).toBe(201);
    const when = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const c1 = await note(sA, L2, {
      kind: "CONTACT",
      body: "Phone call: interested in base oils.",
      channel: "PHONE",
      contactedAt: when,
    });
    expect(c1.status, JSON.stringify(c1.body)).toBe(201);
    expect(LeadActivityResponseSchema.parse(c1.body).activity).toMatchObject({
      kind: "CONTACT",
      contactChannel: "PHONE",
      contactedAt: when,
      actor: { id: sA.userId, displayName: sA.name },
    });
    const bad = [
      { kind: "NOTE", body: "   " },
      { kind: "NOTE", body: "x".repeat(4001) },
      { kind: "NOTE", body: "bell\u0007" },
      { kind: "NOTE", body: "x", actorUserId: sB.userId },
      { kind: "CONTACT", body: "x", channel: "FAX", contactedAt: when },
      { kind: "CONTACT", body: "x", channel: "EMAIL" },
      { kind: "STATUS_CHANGED", body: "x" },
    ];
    for (const body of bad) expectError(await note(sA, L2, body), 400, "VALIDATION_FAILED");
    expectError(
      await note(sA, L2, {
        kind: "CONTACT",
        body: "x",
        channel: "EMAIL",
        contactedAt: new Date(Date.now() + DAY).toISOString(),
      }),
      400,
      "VALIDATION_FAILED",
      { path: "contactedAt", rule: "future" },
    );
    const d = await detail(sB, L2);
    expect(d.activities[0]).toMatchObject({ kind: "CONTACT" });
    expect(d.activities[1]).toMatchObject({
      kind: "NOTE",
      body: "Prefers e-mail.\nCall after 15:00.",
    });
    // The audit trail names the activity, never its text.
    const ev = await lastAudit("leads.contact_logged");
    expect(ev?.metadata).toMatchObject({ channel: "PHONE" });
    expect(JSON.stringify(ev?.metadata)).not.toMatch(/base oils|pipeline\.example/);
    const ev2 = await lastAudit("leads.note_added");
    expect(JSON.stringify(ev2?.metadata)).not.toContain("Prefers");
  });

  it("filters the list by status and assignee, keeps search and site isolation", async () => {
    const v = await version(L2);
    await moved(sA, L2, { version: v, assignedToId: sA.userId });
    const mine = await list(sA, "?assignee=me");
    expect(mine.items.map((i) => i.id)).toEqual([L2]);
    expect(mine.items[0]?.assignedTo).toMatchObject({ id: sA.userId, active: true });
    const unassigned = await list(sA, "?assignee=none");
    expect(unassigned.items.map((i) => i.id)).not.toContain(L2);
    expect(unassigned.items.every((i) => i.assignedTo === null && i.siteKey === "BV")).toBe(true);
    const byUser = await list(root, `?assignee=${sA.userId}`);
    expect(byUser.items.map((i) => i.id)).toEqual([L2]);
    // The audit event records the kind of filter, never the user id or a search text.
    expect((await lastAudit("leads.list_viewed"))?.metadata).toMatchObject({ assignee: "user" });
    const qualified = await list(sA, "?status=QUALIFIED");
    expect(qualified.items.map((i) => i.id)).toEqual([L2]);
    expect((await list(sA, "?status=CONVERTED")).items.map((i) => i.id)).toEqual([L1]);
    expect((await list(sA, "?status=QUALIFIED&q=wf.two")).items.map((i) => i.id)).toEqual([L2]);
    expect((await list(sA, "?status=QUALIFIED&q=nobody")).items).toEqual([]);
    // Site isolation: Corporate sales never sees BV leads, whatever the filter.
    const com = await list(sCom, "?status=CONTACTED");
    expect(com.items.map((i) => i.id)).toEqual([L3]);
    expectError(await sCom.leads(`?siteId=${BV}`), 403, "FORBIDDEN");
    // The super admin and the owner see both sites.
    for (const who of [root, god]) {
      const all = await list(who, "?q=pipeline.example");
      expect(new Set(all.items.map((i) => i.siteKey))).toEqual(new Set(["BV", "CORPORATE"]));
    }
    expectError(await sA.leads("?status=won"), 400, "VALIDATION_FAILED", {
      path: "status",
      rule: "invalid",
    });
    expectError(await sA.leads("?assignee=someone"), 400, "VALIDATION_FAILED", {
      path: "assignee",
      rule: "invalid",
    });
  });

  it("enforces the workflow in the database whatever the API does (RLS, guards)", async () => {
    const L4 = await newLead("wf.four@pipeline.example");
    // Another site's manager reaches no row; a reader without lead:manage neither.
    for (const who of [sCom, officer]) {
      const n = await appIn({ staff: who.token }, (tx) =>
        tx.lead.updateMany({ where: { id: L4 }, data: { status: "CONTACTED" } }),
      );
      expect(n.count).toBe(0);
    }
    const asA = { staff: sA.token };
    await rejectsDb(
      appIn(asA, (tx) => tx.lead.update({ where: { id: L4 }, data: { status: "CONVERTED" } })),
      /status transition NEW to CONVERTED is not allowed/,
    );
    await rejectsDb(
      appIn(asA, (tx) =>
        tx.lead.update({ where: { id: L4 }, data: { assignedToId: sCom.userId } }),
      ),
      /assignee needs lead:manage/,
    );
    await rejectsDb(
      appIn(asA, (tx) => tx.lead.update({ where: { id: L4 }, data: { workflowVersion: 7 } })),
      /bookkeeping changes only with the workflow/,
    );
    await rejectsDb(
      appIn(asA, (tx) =>
        tx.lead.update({ where: { id: L4 }, data: { status: "CONTACTED", country: "DE" } }),
      ),
      /cannot change the lead details/,
    );
    // The public form context cannot move the status of its own lead.
    await rejectsDb(
      appIn({ site: BV, email: "wf.four@pipeline.example" }, (tx) =>
        tx.lead.update({ where: { id: L4 }, data: { status: "CONTACTED" } }),
      ),
      /changed by staff with lead:manage only/,
    );
    // The database stamps the bookkeeping itself and logs the actor of the session.
    await appIn(asA, (tx) =>
      tx.lead.update({
        where: { id: L4 },
        data: { status: "CONTACTED", statusChangedAt: new Date(0), workflowVersion: 41 },
      }),
    );
    const row = await owner.lead.findUniqueOrThrow({ where: { id: L4 } });
    expect(row.workflowVersion).toBe(1);
    expect(row.statusChangedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    const log = await owner.leadActivity.findFirstOrThrow({ where: { leadId: L4 } });
    expect(log).toMatchObject({ kind: "STATUS_CHANGED", actorUserId: sA.userId });
    // History rows: never forged directly, never as someone else, never changed or deleted.
    const base = { siteId: BV, leadId: L4 };
    await rejectsDb(
      appIn(asA, (tx) =>
        tx.leadActivity.create({
          data: {
            ...base,
            kind: "STATUS_CHANGED",
            actorUserId: sA.userId,
            fromStatus: "NEW",
            toStatus: "CONVERTED",
          },
        }),
      ),
      /written by the database only/,
    );
    await rejectsDb(
      appIn(asA, (tx) =>
        tx.leadActivity.create({
          data: { ...base, kind: "NOTE", actorUserId: sB.userId, body: "x" },
        }),
      ),
      /row-level security/,
    );
    await rejectsDb(
      appIn({ staff: officer.token }, (tx) =>
        tx.leadActivity.create({
          data: { ...base, kind: "NOTE", actorUserId: officer.userId, body: "x" },
        }),
      ),
      /row-level security/,
    );
    await rejectsDb(
      appIn({ site: BV, email: "wf.four@pipeline.example" }, (tx) =>
        tx.leadActivity.create({
          data: { ...base, kind: "NOTE", actorUserId: sA.userId, body: "x" },
        }),
      ),
      /row-level security/,
    );
    await rejectsDb(
      appIn(asA, (tx) =>
        tx.leadActivity.updateMany({ where: { leadId: L4 }, data: { body: "y" } }),
      ),
      /permission denied/,
    );
    await rejectsDb(
      appIn(asA, (tx) => tx.leadActivity.deleteMany({ where: { leadId: L4 } })),
      /permission denied/,
    );
    // Reads: managers and readers of the site; nobody else, no context no rows.
    const count = (ctx: LeadCtx) =>
      appIn(ctx, (tx) => tx.leadActivity.count({ where: { leadId: L4 } }));
    expect(await count(asA)).toBe(1);
    expect(await count({ staff: officer.token })).toBe(1);
    expect(await count({ staff: sCom.token })).toBe(0);
    expect(await count({ staff: siteAdmin.token })).toBe(0);
    expect(await count({ site: BV, email: "wf.four@pipeline.example" })).toBe(0);
    expect(await asApp.leadActivity.count()).toBe(0);
  });

  it("keeps the sales pipeline out of retention and clears note text on anonymisation", async () => {
    const kept = await newLead("wf.kept@pipeline.example");
    const gone = await newLead("wf.gone@pipeline.example");
    await moved(sA, kept, { version: 0, status: "QUALIFIED" });
    await moved(sA, gone, {
      version: 0,
      status: "UNQUALIFIED",
      note: "Not a fit: private person.",
    });
    const c = await note(sA, gone, {
      kind: "CONTACT",
      body: "Spoke to Mr Example on his mobile.",
      channel: "PHONE",
      contactedAt: new Date(Date.now() - DAY).toISOString(),
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const old = new Date(Date.now() - 800 * DAY);
    for (const id of [kept, gone]) {
      await owner.lead.update({ where: { id }, data: { firstRequestAt: old, lastRequestAt: old } });
    }
    const dry = await runRetention(operator, new Date(), { apply: false });
    expect(dry.plan.leadsHeld).toBeGreaterThanOrEqual(1);
    // Erasure on request of a pipeline lead goes to manual legal review.
    const erase = await eraseByEmail(
      operator,
      { email: "wf.kept@pipeline.example", identityCheck: "TICKET-41", apply: true },
      new Date(),
    );
    expect(erase).toMatchObject({ outcome: "held", held: 1, anonymised: 0 });
    await runRetention(operator, new Date(), { apply: true });
    const [k, g] = await Promise.all([
      owner.lead.findUniqueOrThrow({ where: { id: kept } }),
      owner.lead.findUniqueOrThrow({ where: { id: gone } }),
    ]);
    expect(k.anonymisedAt).toBeNull();
    expect(g.anonymisedAt).not.toBeNull();
    // Status, assignment and who/when stay; the free text is gone.
    const acts = await owner.leadActivity.findMany({ where: { leadId: gone } });
    expect(acts.map((a) => a.kind).sort()).toEqual(["CONTACT", "NOTE", "STATUS_CHANGED"]);
    for (const a of acts) {
      expect(a.body).toBeNull();
      if (a.kind !== "STATUS_CHANGED") expect(a.redactedAt).not.toBeNull();
    }
    expect(g.status).toBe("UNQUALIFIED");
    // An anonymised lead is frozen: no workflow, no new activity, no controls.
    expectError(
      await flow(sA, gone, { version: g.workflowVersion, status: "CONTACTED" }),
      409,
      "CONFLICT_STATE",
      { path: "lead", rule: "anonymised" },
    );
    expectError(await note(sA, gone, { kind: "NOTE", body: "again" }), 409, "CONFLICT_STATE");
    expect((await detail(sA, gone)).canManage).toBe(false);
    await rejectsDb(
      appIn({ staff: sA.token }, (tx) =>
        tx.leadActivity.create({
          data: { siteId: BV, leadId: gone, kind: "NOTE", actorUserId: sA.userId, body: "x" },
        }),
      ),
      /live lead/,
    );
    // The database itself refuses to anonymise a QUALIFIED or CONVERTED lead.
    await rejectsDb(
      operator.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL ROLE dp_lead_retention`;
        await tx.$executeRaw`UPDATE "Lead" SET "email" = 'anonymised+' || "id"::text || '@anonymised.invalid',
          "fullName" = '', "company" = '', "marketingConsentAt" = NULL, "anonymisedAt" = now()
          WHERE "id" = ${kept}::uuid`;
      }),
      /Lead_anonymised_pipeline/,
    );
    // Retention clears text only; it cannot rewrite history.
    await rejectsDb(
      operator.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL ROLE dp_lead_retention`;
        await tx.$executeRaw`UPDATE "LeadActivity" SET "body" = 'changed', "redactedAt" = NULL
          WHERE "leadId" = ${kept}::uuid`;
      }),
      /may only clear the text/,
    );
  });
});
