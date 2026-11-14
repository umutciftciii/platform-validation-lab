// PM-1 (DP-031..DP-034): the product catalogue administration over HTTP and its database rules,
// on a database of its own (CATALOG_*_DATABASE_URL, a *_test database that starts EMPTY).
//
// Setup: migrations as dp_migrator, catalogue sync and bootstrap through the operator CLI, then
// staff fixtures written as dp_owner (users, memberships, role assignments granted by the
// bootstrap administrator, and admin sessions whose cookie value the test keeps). The API runs
// in-process from dist/ through createApiApp, connected as dp_app, and every request carries the
// admin proxy key as the admin Route Handler would.
//
// Covers: platform vs. site authorization (product_master:edit vs. product:edit/read), cross-site
// and IDOR refusals, audit events (SUCCESS and DENIED), optimistic versions, the category tree,
// default category, site visibility, search/filter/sort/pagination, CHECK constraints, triggers
// and the dp_app privileges of the new tables.
//
// PM-2 (sections 8-12): technical specifications and product images on the same database, with
// the filesystem media storage in a temporary directory: definitions and values (types, units,
// ranges, versions), the shared validation report, uploads (types, sizes, pixel bombs, corrupt
// files), private reads, cover/order/delete consistency, storage failures and orphan clean-up,
// audit events and authorization (platform master permission, any-site read, no access).
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
import {
  CatalogContextResponseSchema,
  CategoryListResponseSchema,
  ErrorBodySchema,
  ProductDetailResponseSchema,
  ProductListResponseSchema,
} from "@dream/contracts";
import { assertTestDatabaseUrl } from "@dream/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { ADMIN_ORIGIN, TEST_KEYS, apiTestEnv } from "./helpers/auth-env.js";
import { adminApi } from "../../src/catalog/import/client.js";
import { runImport } from "../../src/catalog/import/run.js";
import { CatalogMappingSchema } from "@dream/contracts";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(API_DIR, "dist/iam/iam-cli.js");
const PRISMA = path.join(API_DIR, "node_modules/.bin/prisma");
const appUrl = assertTestDatabaseUrl(process.env["CATALOG_DATABASE_URL"]);
const DB_NAME = appUrl.pathname.slice(1);
/** The bootstrap role's URL, pointed at this suite's database. */
function bootstrapUrl(): string {
  const u = assertTestDatabaseUrl(process.env["IAM_BOOTSTRAP_DATABASE_URL"]);
  u.pathname = `/${DB_NAME}`;
  return assertTestDatabaseUrl(u.toString()).toString();
}
const urls = {
  app: appUrl.toString(),
  migrate: assertTestDatabaseUrl(process.env["CATALOG_MIGRATE_DATABASE_URL"]).toString(),
  boot: bootstrapUrl(),
};
for (const shared of [process.env["DATABASE_URL"], process.env["AUTH_DATABASE_URL"]]) {
  if (shared && new URL(shared).pathname === appUrl.pathname) {
    throw new Error("CATALOG_DATABASE_URL must be a database of its own (it starts empty)");
  }
}
const ENV_BACKUP = { ...process.env };

// ------------------------------------------------------------------------------------------
// Harness
// ------------------------------------------------------------------------------------------

interface App {
  listen(port: number, host: string): Promise<unknown>;
  getHttpServer(): { address(): unknown };
  get<T>(token: unknown): T;
  close(): Promise<void>;
}
interface Faults {
  armed: string | null;
}
let FaultToken: unknown;
/** The filesystem media storage of this suite (a temporary directory, removed afterwards). */
const MEDIA_DIR = mkdtempSync(path.join(tmpdir(), "dp-catalog-media-"));

let app: App;
let base: string;
let owner: PrismaClient; // dp_migrator acting as dp_owner: fixtures and probes
let asApp: PrismaClient; // dp_app: privilege probes
let BV: string;
let COM: string;

interface Res {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

class Staff {
  constructor(
    readonly name: string,
    readonly userId: string,
    readonly token: string,
  ) {}

  async call(method: string, p: string, body?: unknown): Promise<Res> {
    const headers: Record<string, string> = {
      "x-dp-proxy-key": TEST_KEYS.admin,
      "x-dp-client-ip": "10.20.30.40",
      cookie: `__Host-dp_admin_session=${this.token}`,
    };
    if (method !== "GET") headers["origin"] = ADMIN_ORIGIN;
    if (method === "POST") headers["content-type"] = "application/json";
    const res = await fetch(`${base}/api/v1/admin/catalog${p}`, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
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
  private headers(): Record<string, string> {
    return {
      "x-dp-proxy-key": TEST_KEYS.admin,
      "x-dp-client-ip": "10.20.30.40",
      cookie: `__Host-dp_admin_session=${this.token}`,
    };
  }
  /** PM-2: the raw image upload (PUT, image body), as the admin upload proxy sends it. */
  async upload(productId: string, bytes: Buffer, type: string, filename?: string): Promise<Res> {
    const headers: Record<string, string> = {
      ...this.headers(),
      origin: ADMIN_ORIGIN,
      "content-type": type,
    };
    if (filename) headers["x-dp-upload-filename"] = encodeURIComponent(filename);
    const res = await fetch(`${base}/api/v1/admin/catalog/products/${productId}/images`, {
      method: "PUT",
      headers,
      body: new Uint8Array(bytes),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }
  /** PM-2: an image's bytes with the response headers. */
  async file(imageId: string, variant: string) {
    const res = await fetch(`${base}/api/v1/admin/catalog/images/${imageId}/${variant}`, {
      headers: this.headers(),
    });
    return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
  }
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

/** An ACTIVE staff user with an admin session; roles are granted by the bootstrap admin. */
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
        reason: "PM-1 catalogue test fixture",
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

let admin: Staff; // platform_super_admin
let pm: Staff; // platform_product_manager
let bvEditor: Staff; // product_editor @ BV
let bvReader: Staff; // read_only @ BV
let comEditor: Staff; // product_editor @ CORPORATE
let nobody: Staff; // ACTIVE, member of BV, no role

beforeAll(async () => {
  owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: urls.migrate }) });
  asApp = new PrismaClient({ adapter: new PrismaPg({ connectionString: urls.app }) });

  const tables = await owner.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM pg_tables WHERE schemaname = 'public'`;
  expect(Number(tables[0]?.n), "the catalogue test database must start empty").toBe(0);
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
  const root = await owner.user.findUniqueOrThrow({
    where: { emailNormalized: "root@staff.dp.test" },
  });
  const now = new Date();
  await owner.user.update({
    where: { id: root.id },
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

  admin = await staff("root", [], null, root.id);
  pm = await staff("pm", [{ role: "platform_product_manager" }], root.id);
  bvEditor = await staff("bv-editor", [{ role: "product_editor", site: BV }], root.id);
  bvReader = await staff("bv-reader", [{ role: "read_only", site: BV }], root.id);
  comEditor = await staff("com-editor", [{ role: "product_editor", site: COM }], root.id);
  nobody = await staff("nobody", [], root.id);
  await owner.membership.create({ data: { userId: nobody.userId, siteId: BV, status: "ACTIVE" } });

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
    FaultInjector: unknown;
  };
  FaultToken = factory.FaultInjector;
  app = await factory.createApiApp({ logger: false });
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as { port: number };
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
  chmodSync(MEDIA_DIR, 0o700);
  rmSync(MEDIA_DIR, { recursive: true, force: true });
  await owner?.$disconnect();
  await asApp?.$disconnect();
  for (const k of Object.keys(process.env)) if (!(k in ENV_BACKUP)) delete process.env[k];
  Object.assign(process.env, ENV_BACKUP);
});

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

async function lastAudit(action: string) {
  return owner.auditEvent.findFirst({ where: { action }, orderBy: { occurredAt: "desc" } });
}

// ------------------------------------------------------------------------------------------
// 1. Context and authentication
// ------------------------------------------------------------------------------------------

describe("catalogue context", () => {
  it("needs an admin session", async () => {
    const anon = new Staff("anon", "", randomBytes(32).toString("base64url"));
    expectError(await anon.get("/context"), 401, "AUTH_SESSION_REQUIRED");
  });

  it("lists only the sites a user may read, with edit rights per site", async () => {
    const ctx = async (s: Staff) =>
      CatalogContextResponseSchema.parse((await s.get("/context")).body);
    const a = await ctx(admin);
    expect(a.canEditMaster).toBe(true);
    expect(a.sites.map((s) => [s.key, s.canEdit])).toEqual([
      ["BV", true],
      ["CORPORATE", true],
    ]);
    const p = await ctx(pm);
    expect(p.canEditMaster).toBe(true);
    expect(p.sites.map((s) => [s.key, s.canEdit])).toEqual([
      ["BV", false],
      ["CORPORATE", false],
    ]);
    const e = await ctx(bvEditor);
    expect(e.canEditMaster).toBe(false);
    expect(e.sites.map((s) => [s.key, s.canEdit])).toEqual([["BV", true]]);
    const r = await ctx(bvReader);
    expect(r.sites.map((s) => [s.key, s.canEdit])).toEqual([["BV", false]]);
    expect((await ctx(nobody)).sites).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------
// 2. Product masters: PLATFORM permission only
// ------------------------------------------------------------------------------------------

const products: Record<string, { id: string; version: number }> = {};

describe("product masters (product_master:edit, PLATFORM)", () => {
  it("refuses site roles, even a site editor, and audits the refusal", async () => {
    const body = { code: "ICC-100", slug: "icc-100", name: "Not allowed" };
    for (const s of [bvEditor, comEditor, bvReader, nobody]) {
      expectError(await s.post("/products", body), 403, "FORBIDDEN");
    }
    const denied = await owner.auditEvent.findFirst({
      where: { action: "catalog.access_denied", actorUserId: bvEditor.userId },
    });
    expect(denied).toMatchObject({
      outcome: "DENIED",
      scopeType: "PLATFORM",
      siteId: null,
      reason: "no_grant",
    });
    expect(await owner.product.count()).toBe(0);
  });

  it("creates masters for the platform product manager; code and slug are normalised", async () => {
    const res = await pm.post("/products", {
      code: " icc-syn-6 ",
      slug: "ICCSYN-6",
      name: "ICCSYN 6",
      summary: "  Synthetic base oil  ",
      description: "",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.product).toMatchObject({
      code: "ICC-SYN-6",
      slug: "iccsyn-6",
      name: "ICCSYN 6",
      summary: "Synthetic base oil",
      description: null,
      status: "DRAFT",
      version: 1,
    });
    products["syn6"] = { id: res.body.product.id, version: 1 };
    const audit = await lastAudit("catalog.product_created");
    expect(audit).toMatchObject({
      outcome: "SUCCESS",
      actorUserId: pm.userId,
      scopeType: "PLATFORM",
      siteId: null,
      resourceId: res.body.product.id,
    });
    for (const [code, name] of [
      ["SN-500", "SN 500 Base Oil"],
      ["GRP3-PLUS", "Group III+ Base Oil"],
      ["WAX-10", "Paraffin Wax 10"],
    ] as const) {
      const r = await admin.post("/products", { code, slug: code.toLowerCase(), name });
      expect(r.status).toBe(201);
      products[code] = { id: r.body.product.id, version: 1 };
    }
  });

  it("validates bodies and refuses duplicates by field", async () => {
    expectError(
      await pm.post("/products", { code: "bad code!", slug: "x", name: "x" }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await pm.post("/products", { code: "X1", slug: "x1", name: "x", extra: 1 }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await pm.post("/products", { code: "ICC-SYN-6", slug: "other", name: "Dup" }),
      409,
      "CONFLICT_STATE",
      { path: "code", rule: "unique" },
    );
    expectError(
      await pm.post("/products", { code: "OTHER", slug: "iccsyn-6", name: "Dup" }),
      409,
      "CONFLICT_STATE",
      { path: "slug", rule: "unique" },
    );
  });

  it("updates with the current version only; a stale version is a conflict", async () => {
    const id = products["syn6"]!.id;
    const body = {
      code: "ICC-SYN-6",
      slug: "iccsyn-6",
      name: "ICCSYN 6 Synthetic",
      summary: null,
      description: "PAO-based.",
    };
    expectError(await bvEditor.post(`/products/${id}`, { ...body, version: 1 }), 403, "FORBIDDEN");
    const ok = await pm.post(`/products/${id}`, { ...body, version: 1 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.product).toMatchObject({
      name: "ICCSYN 6 Synthetic",
      version: 2,
      summary: null,
    });
    expectError(await pm.post(`/products/${id}`, { ...body, version: 1 }), 409, "CONFLICT_STATE", {
      path: "version",
      rule: "stale",
    });
    const audit = await lastAudit("catalog.product_updated");
    expect(audit?.metadata).toMatchObject({
      changed: ["name", "summary", "description"],
      version: 2,
    });
    products["syn6"]!.version = 2;
    expectError(await pm.post(`/products/not-a-uuid`, { ...body, version: 1 }), 404, "NOT_FOUND");
    expectError(
      await pm.post(`/products/0190f2a1-0000-7000-8000-000000000000`, { ...body, version: 1 }),
      404,
      "NOT_FOUND",
    );
  });
});

// ------------------------------------------------------------------------------------------
// 3. Categories: one site each, product:edit of that site
// ------------------------------------------------------------------------------------------

const cats: Record<string, { id: string; version: number }> = {};

describe("categories (product:edit of the site)", () => {
  it("creates a tree; the first category of a site becomes its default", async () => {
    const root = await bvEditor.post(`/sites/${BV}/categories`, {
      name: "Base Oils",
      slug: "base-oils",
      parentId: null,
    });
    expect(root.status, JSON.stringify(root.body)).toBe(201);
    expect(root.body.category).toMatchObject({ isDefault: true, siteId: BV, version: 1 });
    cats["base"] = { id: root.body.category.id, version: 1 };
    const child = await bvEditor.post(`/sites/${BV}/categories`, {
      name: "Synthetic",
      slug: "synthetic",
      parentId: cats["base"]!.id,
    });
    expect(child.status).toBe(201);
    expect(child.body.category.isDefault).toBe(false);
    cats["synthetic"] = { id: child.body.category.id, version: 1 };
    const leaf = await bvEditor.post(`/sites/${BV}/categories`, {
      name: "PAO",
      slug: "pao",
      parentId: cats["synthetic"]!.id,
    });
    expect(leaf.status).toBe(201);
    cats["pao"] = { id: leaf.body.category.id, version: 1 };
    const waxes = await bvEditor.post(`/sites/${BV}/categories`, {
      name: "Waxes",
      slug: "waxes",
      parentId: null,
      sortOrder: 10,
    });
    cats["waxes"] = { id: waxes.body.category.id, version: 1 };
    const audit = await lastAudit("catalog.category_created");
    expect(audit).toMatchObject({ scopeType: "SITE", siteId: BV, actorUserId: bvEditor.userId });
  });

  it("enforces depth, cycles, unique slugs per site and the same site for parents", async () => {
    expectError(
      await bvEditor.post(`/sites/${BV}/categories`, {
        name: "Too deep",
        slug: "too-deep",
        parentId: cats["pao"]!.id,
      }),
      400,
      "VALIDATION_FAILED",
      { path: "parentId", rule: "too_deep" },
    );
    expectError(
      await bvEditor.post(`/categories/${cats["base"]!.id}`, {
        name: "Base Oils",
        slug: "base-oils",
        parentId: cats["synthetic"]!.id,
        version: 1,
      }),
      400,
      "VALIDATION_FAILED",
      { path: "parentId", rule: "cycle" },
    );
    expectError(
      await bvEditor.post(`/sites/${BV}/categories`, {
        name: "Dup",
        slug: "waxes",
        parentId: null,
      }),
      409,
      "CONFLICT_STATE",
      { path: "slug", rule: "unique" },
    );
    // The same slug on the other site is fine; the first COM category is COM's default.
    const com = await comEditor.post(`/sites/${COM}/categories`, {
      name: "Waxes",
      slug: "waxes",
      parentId: null,
    });
    expect(com.status).toBe(201);
    expect(com.body.category.isDefault).toBe(true);
    cats["comWaxes"] = { id: com.body.category.id, version: 1 };
    // A parent of another site is unknown here.
    expectError(
      await bvEditor.post(`/sites/${BV}/categories`, {
        name: "X",
        slug: "x",
        parentId: cats["comWaxes"]!.id,
      }),
      400,
      "VALIDATION_FAILED",
      { path: "parentId", rule: "unknown_parent" },
    );
  });

  it("keeps sites apart: other sites' categories are forbidden to list and not found to change (IDOR)", async () => {
    expectError(await comEditor.get(`/sites/${BV}/categories`), 403, "FORBIDDEN");
    expectError(
      await comEditor.post(`/sites/${BV}/categories`, { name: "X", slug: "x", parentId: null }),
      403,
      "FORBIDDEN",
    );
    const idor = await comEditor.post(`/categories/${cats["base"]!.id}`, {
      name: "Hijacked",
      slug: "hijacked",
      parentId: null,
      version: 1,
    });
    expectError(idor, 404, "NOT_FOUND");
    expectError(await comEditor.del(`/categories/${cats["waxes"]!.id}`), 404, "NOT_FOUND");
    const denied = await owner.auditEvent.findFirst({
      where: {
        action: "catalog.access_denied",
        actorUserId: comEditor.userId,
        resourceId: cats["base"]!.id,
      },
    });
    expect(denied).toMatchObject({ outcome: "DENIED", reason: "not_found_in_scope" });
    // Readers read, but do not change.
    const list = CategoryListResponseSchema.parse(
      (await bvReader.get(`/sites/${BV}/categories`)).body,
    );
    expect(list.items.map((c) => c.slug).sort()).toEqual([
      "base-oils",
      "pao",
      "synthetic",
      "waxes",
    ]);
    expect(list.items.find((c) => c.slug === "base-oils")).toMatchObject({
      childCount: 1,
      isDefault: true,
    });
    expectError(
      await bvReader.post(`/sites/${BV}/categories`, { name: "X", slug: "x", parentId: null }),
      403,
      "FORBIDDEN",
    );
    // The platform product manager has no product:edit: no site categories.
    expectError(
      await pm.post(`/sites/${BV}/categories`, { name: "X", slug: "x", parentId: null }),
      403,
      "FORBIDDEN",
    );
    expectError(await bvEditor.get(`/sites/not-a-site/categories`), 403, "FORBIDDEN");
    const dbRow = await owner.productCategory.findUniqueOrThrow({
      where: { id: cats["base"]!.id },
    });
    expect(dbRow.name).toBe("Base Oils");
  });

  it("moves the default and updates with versions", async () => {
    const res = await bvEditor.post(`/categories/${cats["waxes"]!.id}/default`, { version: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.category).toMatchObject({ isDefault: true, version: 2 });
    cats["waxes"]!.version = 2;
    const list = CategoryListResponseSchema.parse(
      (await bvEditor.get(`/sites/${BV}/categories`)).body,
    );
    expect(list.items.filter((c) => c.isDefault).map((c) => c.slug)).toEqual(["waxes"]);
    const base = list.items.find((c) => c.slug === "base-oils")!;
    cats["base"]!.version = base.version;
    const renamed = await bvEditor.post(`/categories/${cats["base"]!.id}`, {
      name: "Base Oils & Stocks",
      slug: "base-oils",
      parentId: null,
      description: "Group II, III and synthetic base stocks.",
      version: base.version,
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.category.version).toBe(base.version + 1);
    expectError(
      await bvEditor.post(`/categories/${cats["base"]!.id}`, {
        name: "Again",
        slug: "base-oils",
        parentId: null,
        version: base.version,
      }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
  });
});

// ------------------------------------------------------------------------------------------
// 4. Site listings: visibility, category, English texts
// ------------------------------------------------------------------------------------------

describe("site listings (product:edit of the site)", () => {
  it("lists a product on BV; without a category the site default is used", async () => {
    const id = products["syn6"]!.id;
    const res = await bvEditor.post(`/products/${id}/listings/${BV}`, {
      version: null,
      visibility: "VISIBLE",
      title: "ICCSYN 6 — PAO base oil",
      summary: "For BV.",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.listing).toMatchObject({
      siteId: BV,
      categoryId: cats["waxes"]!.id,
      visibility: "VISIBLE",
      version: 1,
      text: { title: "ICCSYN 6 — PAO base oil", summary: "For BV.", description: null },
    });
    const audit = await lastAudit("catalog.listing_created");
    expect(audit).toMatchObject({ siteId: BV, scopeType: "SITE", actorUserId: bvEditor.userId });
    expect(JSON.stringify(audit?.metadata)).not.toContain("PAO base oil"); // names, not values
  });

  it("moves it to another BV category with the current version; stale and duplicate creates conflict", async () => {
    const id = products["syn6"]!.id;
    const ok = await bvEditor.post(`/products/${id}/listings/${BV}`, {
      version: 1,
      categoryId: cats["pao"]!.id,
      visibility: "VISIBLE",
      title: "ICCSYN 6 — PAO base oil",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.listing).toMatchObject({ categoryId: cats["pao"]!.id, version: 2 });
    expectError(
      await bvEditor.post(`/products/${id}/listings/${BV}`, { version: 1, visibility: "HIDDEN" }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    expectError(
      await bvEditor.post(`/products/${id}/listings/${BV}`, {
        version: null,
        visibility: "HIDDEN",
      }),
      409,
      "CONFLICT_STATE",
      { path: "listing", rule: "unique" },
    );
  });

  it("refuses other sites' categories and other sites' listings", async () => {
    const id = products["SN-500"]!.id;
    expectError(
      await bvEditor.post(`/products/${id}/listings/${BV}`, {
        version: null,
        categoryId: cats["comWaxes"]!.id,
        visibility: "VISIBLE",
      }),
      400,
      "VALIDATION_FAILED",
      { path: "categoryId", rule: "unknown" },
    );
    expectError(
      await bvEditor.post(`/products/${id}/listings/${COM}`, {
        version: null,
        visibility: "VISIBLE",
      }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await comEditor.post(`/products/${id}/listings/${BV}`, {
        version: null,
        visibility: "VISIBLE",
      }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await bvReader.post(`/products/${id}/listings/${BV}`, {
        version: null,
        visibility: "VISIBLE",
      }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await pm.post(`/products/${id}/listings/${BV}`, { version: null, visibility: "VISIBLE" }),
      403,
      "FORBIDDEN",
    );
    const denied = await owner.auditEvent.findFirst({
      where: { action: "catalog.access_denied", actorUserId: comEditor.userId, siteId: BV },
    });
    expect(denied).toMatchObject({ outcome: "DENIED", scopeType: "SITE" });
  });

  it("lists the same product on COM independently", async () => {
    const id = products["syn6"]!.id;
    const res = await comEditor.post(`/products/${id}/listings/${COM}`, {
      version: null,
      visibility: "HIDDEN",
      title: "Corporate title",
    });
    expect(res.status).toBe(200);
    expect(res.body.listing).toMatchObject({ siteId: COM, categoryId: cats["comWaxes"]!.id });
    for (const [code, cat, vis] of [
      ["SN-500", "synthetic", "VISIBLE"],
      ["GRP3-PLUS", "base", "HIDDEN"],
    ] as const) {
      const r = await bvEditor.post(`/products/${products[code]!.id}/listings/${BV}`, {
        version: null,
        categoryId: cats[cat]!.id,
        visibility: vis,
      });
      expect(r.status).toBe(200);
    }
  });

  it("shows each site only its own listing", async () => {
    const id = products["syn6"]!.id;
    const bv = ProductDetailResponseSchema.parse(
      (await bvReader.get(`/products/${id}?siteId=${BV}`)).body,
    );
    expect(bv.listing).toMatchObject({ siteId: BV, text: { title: "ICCSYN 6 — PAO base oil" } });
    const com = ProductDetailResponseSchema.parse(
      (await comEditor.get(`/products/${id}?siteId=${COM}`)).body,
    );
    expect(com.listing).toMatchObject({
      siteId: COM,
      visibility: "HIDDEN",
      text: { title: "Corporate title" },
    });
    expectError(await bvReader.get(`/products/${id}?siteId=${COM}`), 403, "FORBIDDEN");
    expectError(await bvReader.get(`/products/${id}`), 403, "FORBIDDEN");
  });

  it("archived products cannot be made visible, and archive/restore need the master permission", async () => {
    const p = products["WAX-10"]!;
    expectError(await bvEditor.post(`/products/${p.id}/archive`, { version: 1 }), 403, "FORBIDDEN");
    const arch = await pm.post(`/products/${p.id}/archive`, { version: 1 });
    expect(arch.status).toBe(200);
    expect(arch.body.product).toMatchObject({ status: "ARCHIVED", version: 2 });
    expect(arch.body.product.archivedAt).not.toBeNull();
    expectError(
      await bvEditor.post(`/products/${p.id}/listings/${BV}`, {
        version: null,
        visibility: "VISIBLE",
      }),
      409,
      "CONFLICT_STATE",
      { path: "visibility", rule: "product_archived" },
    );
    expectError(
      await pm.post(`/products/${p.id}`, { code: "WAX-10", slug: "wax-10", name: "x", version: 2 }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "archived" },
    );
    const restored = await pm.post(`/products/${p.id}/restore`, { version: 2 });
    expect(restored.body.product).toMatchObject({ status: "DRAFT", archivedAt: null, version: 3 });
    expect(await lastAudit("catalog.product_restored")).toMatchObject({ siteId: null });
  });
});

// ------------------------------------------------------------------------------------------
// 5. Search, filter, sort, pagination (DP-034)
// ------------------------------------------------------------------------------------------

describe("product list", () => {
  const list = async (s: Staff, q: string) => {
    const res = await s.get(`/products?${q}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return ProductListResponseSchema.parse(res.body);
  };

  it("needs product:read of the requested site", async () => {
    expectError(await comEditor.get(`/products?siteId=${BV}`), 403, "FORBIDDEN");
    expectError(await nobody.get(`/products?siteId=${BV}`), 403, "FORBIDDEN");
    expectError(await bvReader.get(`/products`), 400, "VALIDATION_FAILED");
    expectError(await bvReader.get(`/products?siteId=${BV}&unknown=1`), 400, "VALIDATION_FAILED");
  });

  it("shows every master with this site's listing only", async () => {
    const r = await list(bvReader, `siteId=${BV}`);
    expect(r.total).toBe(4);
    expect(r.items.map((i) => i.name)).toEqual([
      "Group III+ Base Oil",
      "ICCSYN 6 Synthetic",
      "Paraffin Wax 10",
      "SN 500 Base Oil",
    ]);
    const syn = r.items.find((i) => i.code === "ICC-SYN-6")!;
    expect(syn.listing).toMatchObject({ visibility: "VISIBLE", categoryName: "PAO" });
    expect(r.items.find((i) => i.code === "WAX-10")!.listing).toBeNull();
    // COM sees its own (hidden) listing of the same product, never BV's.
    const c = await list(comEditor, `siteId=${COM}`);
    expect(c.items.find((i) => i.code === "ICC-SYN-6")!.listing).toMatchObject({
      visibility: "HIDDEN",
      categoryName: "Waxes",
    });
  });

  it("searches name, code and slug case-insensitively", async () => {
    expect((await list(bvReader, `siteId=${BV}&q=base%20oil`)).items.map((i) => i.code)).toEqual([
      "GRP3-PLUS",
      "SN-500",
    ]);
    expect((await list(bvReader, `siteId=${BV}&q=icc-syn`)).items.map((i) => i.code)).toEqual([
      "ICC-SYN-6",
    ]);
    expect((await list(bvReader, `siteId=${BV}&q=nothing-matches`)).total).toBe(0);
  });

  it("filters by listing, visibility, status and category (with its descendants)", async () => {
    const codes = async (q: string) =>
      (await list(bvReader, `siteId=${BV}&${q}`)).items.map((i) => i.code);
    expect(await codes("listing=listed")).toEqual(["GRP3-PLUS", "ICC-SYN-6", "SN-500"]);
    expect(await codes("listing=unlisted")).toEqual(["WAX-10"]);
    expect(await codes("visibility=VISIBLE")).toEqual(["ICC-SYN-6", "SN-500"]);
    expect(await codes("visibility=HIDDEN")).toEqual(["GRP3-PLUS"]);
    expect(await codes(`categoryId=${cats["base"]!.id}`)).toEqual([
      "GRP3-PLUS",
      "ICC-SYN-6",
      "SN-500",
    ]);
    expect(await codes(`categoryId=${cats["synthetic"]!.id}`)).toEqual(["ICC-SYN-6", "SN-500"]);
    expect(await codes(`categoryId=${cats["pao"]!.id}`)).toEqual(["ICC-SYN-6"]);
    // Another site's category matches nothing here.
    expect(await codes(`categoryId=${cats["comWaxes"]!.id}`)).toEqual([]);
    expect(await codes("status=DRAFT")).toHaveLength(4);
    expect(await codes("status=ARCHIVED")).toEqual([]);
  });

  it("sorts and pages", async () => {
    const desc = await list(bvReader, `siteId=${BV}&sort=code&order=desc`);
    expect(desc.items.map((i) => i.code)).toEqual(["WAX-10", "SN-500", "ICC-SYN-6", "GRP3-PLUS"]);
    const p1 = await list(bvReader, `siteId=${BV}&sort=code&pageSize=3&page=1`);
    const p2 = await list(bvReader, `siteId=${BV}&sort=code&pageSize=3&page=2`);
    expect(p1).toMatchObject({ total: 4, page: 1, pageSize: 3 });
    expect(p1.items).toHaveLength(3);
    expect(p2.items.map((i) => i.code)).toEqual(["WAX-10"]);
    expectError(
      await bvReader.get(`/products?siteId=${BV}&pageSize=101`),
      400,
      "VALIDATION_FAILED",
    );
    expectError(await bvReader.get(`/products?siteId=${BV}&sort=secret`), 400, "VALIDATION_FAILED");
  });
});

// ------------------------------------------------------------------------------------------
// 6. Deleting categories
// ------------------------------------------------------------------------------------------

describe("deleting categories", () => {
  it("refuses categories with children or listings and deletes empty ones (audited)", async () => {
    expectError(await bvEditor.del(`/categories/${cats["base"]!.id}`), 409, "CONFLICT_STATE", {
      path: "(root)",
      rule: "has_children",
    });
    expectError(await bvEditor.del(`/categories/${cats["pao"]!.id}`), 409, "CONFLICT_STATE", {
      path: "(root)",
      rule: "has_listings",
    });
    const tmp = await bvEditor.post(`/sites/${BV}/categories`, {
      name: "Temp",
      slug: "temp",
      parentId: null,
    });
    expect(tmp.status).toBe(201);
    expectError(await bvReader.del(`/categories/${tmp.body.category.id}`), 404, "NOT_FOUND");
    const del = await bvEditor.del(`/categories/${tmp.body.category.id}`);
    expect(del.status).toBe(204);
    expect(
      await owner.productCategory.findUnique({ where: { id: tmp.body.category.id } }),
    ).toBeNull();
    expect(await lastAudit("catalog.category_deleted")).toMatchObject({
      siteId: BV,
      resourceId: tmp.body.category.id,
    });
  });
});

// ------------------------------------------------------------------------------------------
// 7. Database rules and dp_app privileges (migration 20261111140000_pm_1_catalog_foundation)
// ------------------------------------------------------------------------------------------

describe("catalogue database rules", () => {
  const rejects = async (p: Promise<unknown>, pattern: RegExp) => {
    let error: unknown;
    try {
      await p;
    } catch (e) {
      error = e;
    }
    expect(error, "expected a database refusal").toBeDefined();
    const text = JSON.stringify(error, Object.getOwnPropertyNames(error)) + String(error);
    expect(text).toMatch(pattern);
  };

  it("dp_app cannot delete products, listings or listing texts", async () => {
    await rejects(asApp.product.deleteMany({ where: { code: "WAX-10" } }), /permission denied/i);
    await rejects(
      asApp.productSiteListing.deleteMany({ where: { siteId: BV } }),
      /permission denied/i,
    );
    await rejects(
      asApp.productListingText.deleteMany({ where: { siteId: BV } }),
      /permission denied/i,
    );
    expect(await owner.product.count()).toBe(4);
  });

  it("CHECK constraints refuse malformed codes, slugs, names and archive state", async () => {
    await rejects(
      asApp.product.create({ data: { code: "lower", slug: "ok", name: "x" } }),
      /Product_code_format/,
    );
    await rejects(
      asApp.product.create({ data: { code: "OK1", slug: "Not Ok", name: "x" } }),
      /Product_slug_format/,
    );
    await rejects(
      asApp.product.create({ data: { code: "OK2", slug: "ok-2", name: " padded " } }),
      /Product_name_trimmed/,
    );
    await rejects(
      asApp.product.create({ data: { code: "OK3", slug: "ok-3", name: "x", status: "ARCHIVED" } }),
      /Product_archived_consistent/,
    );
  });

  it("the tree trigger refuses cross-site parents, cycles and a fourth level", async () => {
    await rejects(
      asApp.productCategory.create({
        data: { siteId: COM, name: "X", slug: "x-cross", parentId: cats["base"]!.id },
      }),
      /same site/,
    );
    await rejects(
      asApp.productCategory.update({
        where: { id: cats["base"]!.id },
        data: { parentId: cats["pao"]!.id },
      }),
      /below itself/,
    );
    await rejects(
      asApp.productCategory.create({
        data: { siteId: BV, name: "D4", slug: "d4", parentId: cats["pao"]!.id },
      }),
      /three levels/,
    );
  });

  it("a listing's category must be of its site (composite foreign key); site columns never change", async () => {
    await rejects(
      asApp.productSiteListing.create({
        data: { productId: products["WAX-10"]!.id, siteId: BV, categoryId: cats["comWaxes"]!.id },
      }),
      /foreign key|ProductSiteListing_categoryId_siteId_fkey/i,
    );
    await rejects(
      asApp.productCategory.update({ where: { id: cats["waxes"]!.id }, data: { siteId: COM } }),
      /siteId cannot change/,
    );
    const listing = await owner.productSiteListing.findFirstOrThrow({ where: { siteId: BV } });
    await rejects(
      asApp.productSiteListing.update({
        where: { id: listing.id },
        data: { productId: products["WAX-10"]!.id },
      }),
      /productId cannot change/,
    );
  });

  it("one default category per site (partial unique index)", async () => {
    await rejects(
      asApp.productCategory.update({ where: { id: cats["base"]!.id }, data: { isDefault: true } }),
      /ProductCategory_default_siteId_key|Unique constraint/i,
    );
  });
});

// ==========================================================================================
// PM-2: technical specifications and product images
// ==========================================================================================

const defs: Record<string, { id: string; version: number }> = {};

describe("8. specification definitions (product_master:edit, PLATFORM)", () => {
  const kv = {
    key: "kv100",
    name: "Kinematic viscosity at 100 °C",
    dataType: "NUMBER",
    units: ["mm²/s", "cSt"],
    testMethods: ["ASTM D445"],
    required: true,
    minValue: 0,
    maxValue: 1000,
    decimals: 2,
  };

  it("refuses site roles and creates definitions for the platform product manager", async () => {
    expectError(await bvEditor.post("/spec-definitions", kv), 403, "FORBIDDEN");
    expectError(await nobody.post("/spec-definitions", kv), 403, "FORBIDDEN");
    const r = await pm.post("/spec-definitions", kv);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.definition).toMatchObject({
      key: "kv100",
      dataType: "NUMBER",
      minValue: 0,
      maxValue: 1000,
      valueCount: 0,
      version: 1,
    });
    defs["kv100"] = { id: r.body.definition.id, version: 1 };
    for (const d of [
      {
        key: "pour_point",
        name: "Pour point",
        dataType: "RANGE",
        units: ["°C"],
        testMethods: ["ASTM D97"],
        minValue: -80,
        maxValue: 50,
      },
      { key: "appearance", name: "Appearance", dataType: "TEXT", maxLength: 40 },
      { key: "food_grade", name: "Food grade", dataType: "BOOLEAN" },
    ]) {
      const c = await admin.post("/spec-definitions", d);
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      defs[d.key] = { id: c.body.definition.id, version: 1 };
    }
    expect(await lastAudit("catalog.spec_definition_created")).toMatchObject({
      scopeType: "PLATFORM",
      siteId: null,
    });
  });

  it("validates definitions and keeps key and data type fixed", async () => {
    expectError(await pm.post("/spec-definitions", kv), 409, "CONFLICT_STATE", {
      path: "key",
      rule: "unique",
    });
    expectError(
      await pm.post("/spec-definitions", {
        key: "bad_text",
        name: "x",
        dataType: "TEXT",
        units: ["mm"],
      }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await pm.post("/spec-definitions", {
        key: "bad_bounds",
        name: "x",
        dataType: "NUMBER",
        minValue: 5,
        maxValue: 1,
      }),
      400,
      "VALIDATION_FAILED",
    );
    const { key: _k, ...rest } = kv;
    void _k;
    expectError(
      await pm.post(`/spec-definitions/${defs["kv100"]!.id}`, {
        ...rest,
        dataType: "TEXT",
        units: [],
        minValue: null,
        maxValue: null,
        decimals: null,
        version: 1,
      }),
      409,
      "CONFLICT_STATE",
      { path: "dataType", rule: "immutable" },
    );
    const ok = await pm.post(`/spec-definitions/${defs["kv100"]!.id}`, {
      ...rest,
      name: "KV @ 100 °C",
      version: 1,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.definition).toMatchObject({ name: "KV @ 100 °C", version: 2 });
    expectError(
      await pm.post(`/spec-definitions/${defs["kv100"]!.id}`, { ...rest, version: 1 }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    await rejectsDb(
      asApp.specDefinition.update({ where: { id: defs["kv100"]!.id }, data: { key: "renamed" } }),
      /key and data type cannot change/,
    );
  });

  it("is readable with product:read on any site, not without", async () => {
    for (const s of [bvReader, comEditor, pm]) {
      const r = await s.get("/spec-definitions");
      expect(r.status).toBe(200);
      expect(r.body.items.map((d: { key: string }) => d.key)).toEqual(
        expect.arrayContaining(["kv100", "pour_point", "appearance", "food_grade"]),
      );
    }
    expectError(await nobody.get("/spec-definitions"), 403, "FORBIDDEN");
  });
});

describe("9. specification values (master data, product version)", () => {
  const value = (
    key: string,
    v: object,
    unit: string | null = null,
    testMethod: string | null = null,
  ) => ({
    definitionId: defs[key]!.id,
    value: v,
    unit,
    testMethod,
  });

  it("reports a missing required value as BLOCKING before anything is entered", async () => {
    const r = await comEditor.get(`/products/${products["syn6"]!.id}/specs`);
    expect(r.status).toBe(200);
    expect(r.body.productVersion).toBe(2);
    expect(r.body.validation.ok).toBe(false);
    expect(
      r.body.validation.blocking.map((i: { code: string; target: string }) => [i.code, i.target]),
    ).toEqual([["required_missing", "spec:kv100"]]);
    expectError(await nobody.get(`/products/${products["syn6"]!.id}/specs`), 403, "FORBIDDEN");
  });

  it("refuses BLOCKING value problems with field details, and site roles", async () => {
    const id = products["syn6"]!.id;
    const save = (values: object[], version = 2) =>
      pm.post(`/products/${id}/specs`, { version, values });
    expectError(
      await bvEditor.post(`/products/${id}/specs`, { version: 2, values: [] }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await save([value("kv100", { type: "TEXT", text: "thick" }, "cSt")]),
      400,
      "VALIDATION_FAILED",
      { path: "spec:kv100", rule: "invalid_type" },
    );
    expectError(
      await save([value("kv100", { type: "NUMBER", number: 5.8 }, "°C")]),
      400,
      "VALIDATION_FAILED",
      { path: "spec:kv100", rule: "invalid_unit" },
    );
    expectError(
      await save([value("pour_point", { type: "RANGE", min: 10, max: -10 }, "°C")]),
      400,
      "VALIDATION_FAILED",
      { path: "spec:pour_point", rule: "invalid_range" },
    );
    expectError(
      await save([value("kv100", { type: "NUMBER", number: 5000 }, "cSt")]),
      400,
      "VALIDATION_FAILED",
      { path: "spec:kv100", rule: "out_of_bounds" },
    );
    expectError(
      await save([value("kv100", { type: "NUMBER", number: 5.857 }, "cSt")]),
      400,
      "VALIDATION_FAILED",
      { path: "spec:kv100", rule: "too_precise" },
    );
    expectError(
      await save([value("appearance", { type: "TEXT", text: "x".repeat(41) })]),
      400,
      "VALIDATION_FAILED",
      { path: "spec:appearance", rule: "too_long" },
    );
    expectError(
      await save([
        {
          ...value("kv100", { type: "NUMBER", number: 5 }, "cSt"),
          definitionId: "0190f2a1-0000-7000-8000-000000000000",
        },
      ]),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await save([
        value("food_grade", { type: "BOOLEAN", boolean: true }),
        value("food_grade", { type: "BOOLEAN", boolean: false }),
      ]),
      400,
      "VALIDATION_FAILED",
      { path: "spec:food_grade", rule: "duplicate" },
    );
    expectError(
      await save([value("kv100", { type: "NUMBER", number: 5.8 }, "cSt")], 1),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    expect(await owner.productSpecValue.count()).toBe(0);
  });

  it("saves values once on the master, bumps its version and reports what is left", async () => {
    const id = products["syn6"]!.id;
    const r = await pm.post(`/products/${id}/specs`, {
      version: 2,
      values: [
        value("kv100", { type: "NUMBER", number: 5.85 }, "mm²/s", "ASTM D445"),
        value("pour_point", { type: "RANGE", min: -45, max: -36 }, "°C"),
        value("appearance", { type: "TEXT", text: "Clear and bright" }),
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.productVersion).toBe(3);
    expect(r.body.validation.ok).toBe(true);
    expect(
      r.body.validation.warnings.map((i: { code: string; target: string }) => [i.code, i.target]),
    ).toEqual([
      ["optional_missing", "spec:food_grade"],
      ["test_method_missing", "spec:pour_point"],
    ]);
    expect(
      r.body.values.find((v: { definitionId: string }) => v.definitionId === defs["pour_point"]!.id)
        .value,
    ).toEqual({ type: "RANGE", min: -45, max: -36, minExclusive: false, maxExclusive: false });
    products["syn6"]!.version = 3;
    const audit = await lastAudit("catalog.spec_values_saved");
    expect(audit).toMatchObject({ scopeType: "PLATFORM", siteId: null, resourceId: id });
    expect(audit?.metadata).toMatchObject({
      changed: ["kv100", "pour_point", "appearance"],
      removed: [],
      version: 3,
    });
    // One value per product and definition: the same for every site, never copied.
    expect(await owner.productSpecValue.count({ where: { productId: id } })).toBe(3);
    const bv = await bvReader.get(`/products/${id}/specs`);
    const com = await comEditor.get(`/products/${id}/specs`);
    expect(bv.body.values).toEqual(com.body.values);
    // The master version moved: an edit based on version 2 is stale now.
    expectError(
      await pm.post(`/products/${id}`, {
        code: "ICC-SYN-6",
        slug: "iccsyn-6",
        name: "x",
        version: 2,
      }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
  });

  it("removes omitted values; a required one missing is BLOCKING again", async () => {
    const id = products["syn6"]!.id;
    const r = await pm.post(`/products/${id}/specs`, {
      version: 3,
      values: [value("appearance", { type: "TEXT", text: "Clear and bright" })],
    });
    expect(r.status).toBe(200);
    expect(r.body.values).toHaveLength(1);
    expect(r.body.validation.blocking.map((i: { code: string }) => i.code)).toEqual([
      "required_missing",
    ]);
    expect((await lastAudit("catalog.spec_values_saved"))?.metadata).toMatchObject({
      changed: [],
      removed: ["kv100", "pour_point"],
    });
    const back = await pm.post(`/products/${id}/specs`, {
      version: 4,
      values: [
        value("kv100", { type: "NUMBER", number: 5.85 }, "mm²/s", "ASTM D445"),
        value("appearance", { type: "TEXT", text: "Clear and bright" }),
      ],
    });
    expect(back.body.productVersion).toBe(5);
    products["syn6"]!.version = 5;
  });

  it("DP-156: one-sided and open limits, and a typical value beside the specification", async () => {
    const id = products["syn6"]!.id;
    const kv = value("kv100", { type: "NUMBER", number: 5.85 }, "mm²/s", "ASTM D445");
    const pourLimit = {
      ...value("pour_point", { type: "RANGE", min: null, max: -30 }, "°C", "ASTM D97"),
      basis: "SPECIFICATION",
    };
    const pourTypical = {
      ...value("pour_point", { type: "RANGE", min: -42, max: -42 }, "°C"),
      basis: "TYPICAL",
    };
    const appearanceTypical = {
      ...value("appearance", { type: "TEXT", text: "Clear" }),
      basis: "TYPICAL",
    };
    const save = (values: object[], version: number) =>
      pm.post(`/products/${id}/specs`, { version, values });
    // shape problems are BLOCKING invalid_range on the value's own target
    expectError(
      await save([kv, { ...pourLimit, value: { type: "RANGE", min: null, max: null } }], 5),
      400,
      "VALIDATION_FAILED",
      { path: "spec:pour_point", rule: "invalid_range" },
    );
    expectError(
      await save(
        [
          kv,
          {
            ...pourTypical,
            value: { type: "RANGE", min: -42, max: -42, minExclusive: true },
          },
        ],
        5,
      ),
      400,
      "VALIDATION_FAILED",
      { path: "spec:pour_point:typical", rule: "invalid_range" },
    );
    expectError(await save([kv, pourLimit, { ...pourLimit }], 5), 400, "VALIDATION_FAILED", {
      path: "spec:pour_point",
      rule: "duplicate",
    });
    const r = await save([kv, pourLimit, pourTypical, appearanceTypical], 5);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.productVersion).toBe(6);
    products["syn6"]!.version = 6;
    const pour = r.body.values.filter(
      (v: { definitionId: string }) => v.definitionId === defs["pour_point"]!.id,
    );
    expect(pour.map((v: { basis: string; value: unknown }) => [v.basis, v.value])).toEqual(
      expect.arrayContaining([
        [
          "SPECIFICATION",
          { type: "RANGE", min: null, max: -30, minExclusive: false, maxExclusive: false },
        ],
        [
          "TYPICAL",
          { type: "RANGE", min: -42, max: -42, minExclusive: false, maxExclusive: false },
        ],
      ]),
    );
    // a typical appearance does not stand in for anything; warnings name the typical target
    expect(
      r.body.validation.warnings.map((i: { code: string; target: string }) => [i.code, i.target]),
    ).toEqual(expect.arrayContaining([["test_method_missing", "spec:pour_point:typical"]]));
    expect((await lastAudit("catalog.spec_values_saved"))?.metadata).toMatchObject({
      changed: ["pour_point", "pour_point:typical", "appearance:typical"],
      removed: ["appearance"],
    });
    // an open end is stored as such; saving the same set again changes nothing
    const open = await save(
      [
        kv,
        { ...pourLimit, value: { type: "RANGE", min: -45, max: -30, maxExclusive: true } },
        pourTypical,
        appearanceTypical,
      ],
      6,
    );
    expect(open.status, JSON.stringify(open.body)).toBe(200);
    products["syn6"]!.version = 7;
    const row = await owner.productSpecValue.findUniqueOrThrow({
      where: {
        productId_definitionId_basis: {
          productId: id,
          definitionId: defs["pour_point"]!.id,
          basis: "SPECIFICATION",
        },
      },
    });
    expect([row.rangeMin?.toString(), row.rangeMax?.toString(), row.rangeMaxExclusive]).toEqual([
      "-45",
      "-30",
      true,
    ]);
    // back to the earlier set: kv100 + appearance (other tests rely on it)
    const back = await save(
      [kv, value("appearance", { type: "TEXT", text: "Clear and bright" })],
      7,
    );
    expect(back.status).toBe(200);
    expect(await owner.productSpecValue.count({ where: { productId: id } })).toBe(2);
    products["syn6"]!.version = 8;
  });

  it("archived products keep their values read-only", async () => {
    const p = products["WAX-10"]!;
    const arch = await pm.post(`/products/${p.id}/archive`, { version: 3 });
    expect(arch.status).toBe(200);
    expectError(
      await pm.post(`/products/${p.id}/specs`, { version: 4, values: [] }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "archived" },
    );
    expect((await pm.post(`/products/${p.id}/restore`, { version: 4 })).status).toBe(200);
    products["WAX-10"]!.version = 5;
  });

  it("the database refuses a value of the wrong shape or unit", async () => {
    const productId = products["SN-500"]!.id;
    await rejectsDb(
      asApp.productSpecValue.create({
        data: { productId, definitionId: defs["kv100"]!.id, textValue: "x" },
      }),
      /does not match the specification data type/,
    );
    await rejectsDb(
      asApp.productSpecValue.create({
        data: { productId, definitionId: defs["kv100"]!.id, numberValue: 5, unit: "°C" },
      }),
      /unit is not accepted/,
    );
    await rejectsDb(
      asApp.productSpecValue.create({
        data: {
          productId,
          definitionId: defs["pour_point"]!.id,
          rangeMin: 5,
          rangeMax: 1,
          unit: "°C",
        },
      }),
      /ProductSpecValue_range_order/,
    );
    // DP-156: an open end needs that end, and [x, x) is empty
    await rejectsDb(
      asApp.productSpecValue.create({
        data: {
          productId,
          definitionId: defs["pour_point"]!.id,
          rangeMax: -10,
          rangeMinExclusive: true,
          unit: "°C",
        },
      }),
      /ProductSpecValue_range_open_end/,
    );
    await rejectsDb(
      asApp.productSpecValue.create({
        data: {
          productId,
          definitionId: defs["pour_point"]!.id,
          rangeMin: -10,
          rangeMax: -10,
          rangeMaxExclusive: true,
          unit: "°C",
        },
      }),
      /ProductSpecValue_range_open_end/,
    );
    await rejectsDb(
      asApp.productSpecValue.create({
        data: { productId, definitionId: defs["pour_point"]!.id, unit: "°C", textValue: null },
      }),
      /ProductSpecValue_one_shape|does not match the specification data type/,
    );
    // a value cannot change its basis (it would silently turn a typical value into a limit)
    const typical = await owner.productSpecValue.create({
      data: {
        productId,
        definitionId: defs["pour_point"]!.id,
        basis: "TYPICAL",
        rangeMin: -40,
        rangeMax: -40,
        unit: "°C",
      },
    });
    await rejectsDb(
      asApp.productSpecValue.update({
        where: { id: typical.id },
        data: { basis: "SPECIFICATION" },
      }),
      /cannot move to another product, definition or basis/,
    );
    await owner.productSpecValue.delete({ where: { id: typical.id } });
    await rejectsDb(
      asApp.productSpecValue.create({
        data: {
          productId,
          definitionId: defs["food_grade"]!.id,
          booleanValue: true,
          numberValue: 1,
        },
      }),
      /ProductSpecValue_one_shape/,
    );
  });

  it("definitions in use cannot be deleted; unused ones can", async () => {
    expectError(await pm.del(`/spec-definitions/${defs["kv100"]!.id}`), 409, "CONFLICT_STATE", {
      path: "(root)",
      rule: "in_use",
    });
    const tmp = await pm.post("/spec-definitions", {
      key: "tmp_unused",
      name: "Temp",
      dataType: "BOOLEAN",
    });
    expectError(
      await bvEditor.del(`/spec-definitions/${tmp.body.definition.id}`),
      403,
      "FORBIDDEN",
    );
    expect((await pm.del(`/spec-definitions/${tmp.body.definition.id}`)).status).toBe(204);
    expect(await lastAudit("catalog.spec_definition_deleted")).toMatchObject({
      resourceId: tmp.body.definition.id,
    });
  });
});

// ---- images ---------------------------------------------------------------------------------

function image(w: number, h: number, format: "jpeg" | "png" | "webp"): Promise<Buffer> {
  const img = sharp({
    create: { width: w, height: h, channels: 3, background: { r: 241, g: 125, b: 33 } },
  });
  return (format === "jpeg" ? img.jpeg() : format === "png" ? img.png() : img.webp()).toBuffer();
}
function pngBomb(w: number, h: number): Buffer {
  const crc32 = (buf: Buffer) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function mediaFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(MEDIA_DIR, p));
    }
  };
  walk(MEDIA_DIR);
  return out.sort();
}

const imgs: Record<string, { id: string; version: number; sha256: string }> = {};

describe("10. image uploads (validation, authorization, storage)", () => {
  it("needs a session and the platform master permission", async () => {
    const jpeg = await image(1200, 900, "jpeg");
    const id = products["syn6"]!.id;
    const anon = new Staff("anon", "", randomBytes(32).toString("base64url"));
    expectError(await anon.upload(id, jpeg, "image/jpeg"), 401, "AUTH_SESSION_REQUIRED");
    for (const s of [bvEditor, comEditor, bvReader, nobody]) {
      expectError(await s.upload(id, jpeg, "image/jpeg"), 403, "FORBIDDEN");
    }
    expect(
      await owner.auditEvent.count({
        where: { action: "catalog.access_denied", resourceType: "product_image" },
      }),
    ).toBeGreaterThanOrEqual(4);
    expect(mediaFiles()).toEqual([]);
  });

  it("refuses SVG, lying types, small images, pixel bombs, corrupt and oversized files", async () => {
    const id = products["syn6"]!.id;
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expectError(await pm.upload(id, svg, "image/svg+xml"), 415, "UNSUPPORTED_MEDIA_TYPE");
    expectError(await pm.upload(id, svg, "image/png"), 415, "UNSUPPORTED_MEDIA_TYPE", {
      path: "file",
      rule: "unsupported_type",
    });
    expectError(
      await pm.upload(id, Buffer.from("MZ\x90\x00 not an image"), "image/jpeg"),
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
    expectError(
      await pm.upload(id, await image(1200, 900, "png"), "image/jpeg"),
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      { path: "file", rule: "type_mismatch" },
    );
    expectError(
      await pm.upload(id, await image(640, 480, "jpeg"), "image/jpeg"),
      400,
      "VALIDATION_FAILED",
      { path: "file", rule: "too_small" },
    );
    expectError(
      await pm.upload(id, pngBomb(40_000, 40_000), "image/png"),
      400,
      "VALIDATION_FAILED",
      { path: "file", rule: "too_many_pixels" },
    );
    const jpeg = await image(1200, 900, "jpeg");
    expectError(
      await pm.upload(id, jpeg.subarray(0, 300), "image/jpeg"),
      400,
      "VALIDATION_FAILED",
      { path: "file", rule: "corrupt" },
    );
    expectError(
      await pm.upload(id, Buffer.alloc(10 * 1024 * 1024 + 1, 0x89), "image/png"),
      413,
      "PAYLOAD_TOO_LARGE",
    );
    expectError(await pm.upload(id, Buffer.alloc(0), "image/png"), 400, "VALIDATION_FAILED");
    expect(await owner.productImage.count()).toBe(0);
    expect(mediaFiles()).toEqual([]);
  });

  it("stores JPEG, PNG and WebP privately under random keys; the first becomes the cover", async () => {
    const id = products["syn6"]!.id;
    for (const [name, fmt, w, h] of [
      ["drum front.jpg", "jpeg", 2400, 1800],
      ["../../etc/passwd.png", "png", 1600, 1200],
      ["pail.webp", "webp", 1000, 800],
    ] as const) {
      const bytes = await image(w, h, fmt);
      const r = await pm.upload(id, bytes, `image/${fmt}`, name);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      imgs[fmt] = {
        id: r.body.image.id,
        version: r.body.image.version,
        sha256: r.body.image.sha256,
      };
      expect(r.body.image).toMatchObject({
        mimeType: `image/${fmt}`,
        width: w,
        height: h,
        byteSize: bytes.length,
      });
      expect(r.body.image).not.toHaveProperty("storageKey");
    }
    const list = await bvReader.get(`/products/${id}/images`);
    expect(
      list.body.items.map(
        (i: { isCover: boolean; sortOrder: number; originalFilename: string }) => [
          i.isCover,
          i.sortOrder,
          i.originalFilename,
        ],
      ),
    ).toEqual([
      [true, 0, "drum front.jpg"],
      [false, 1, "passwd.png"],
      [false, 2, "pail.webp"],
    ]);
    const files = mediaFiles();
    expect(files).toHaveLength(9); // original + display + thumb per image
    for (const f of files) {
      expect(f).toMatch(/^products\/[0-9a-f]{32}\/(original|display\.webp|thumb\.webp)$/);
      expect(statSync(path.join(MEDIA_DIR, f)).mode & 0o777).toBe(0o600);
    }
    const rows = await owner.productImage.findMany();
    expect(rows.every((r) => !("data" in r))).toBe(true);
    const audit = await lastAudit("catalog.image_uploaded");
    expect(audit).toMatchObject({ scopeType: "PLATFORM", siteId: null, actorUserId: pm.userId });
    expect(audit?.metadata).toMatchObject({ productId: id, mimeType: "image/webp" });
  });

  it("serves the bytes privately to readers of any site, never without access", async () => {
    const orig = await comEditor.file(imgs["jpeg"]!.id, "original");
    expect(orig.status).toBe(200);
    expect(orig.headers.get("content-type")).toBe("image/jpeg");
    expect(orig.headers.get("x-content-type-options")).toBe("nosniff");
    expect(orig.headers.get("content-disposition")).toMatch(/^inline; filename="drum front.jpg"/);
    expect(orig.headers.get("cache-control")).toMatch(/no-store/);
    expect(orig.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
    expect(createHash("sha256").update(orig.body).digest("hex")).toBe(imgs["jpeg"]!.sha256);
    const thumb = await bvReader.file(imgs["png"]!.id, "thumb");
    expect(thumb.headers.get("content-type")).toBe("image/webp");
    expect((await sharp(thumb.body).metadata()).width).toBe(480);
    expect((await nobody.file(imgs["jpeg"]!.id, "original")).status).toBe(403);
    const anon = new Staff("anon", "", randomBytes(32).toString("base64url"));
    expect((await anon.file(imgs["jpeg"]!.id, "original")).status).toBe(401);
    expect((await bvReader.file("0190f2a1-0000-7000-8000-000000000000", "original")).status).toBe(
      404,
    );
    expect((await bvReader.file(imgs["jpeg"]!.id, "..%2F..%2Fetc")).status).toBe(404);
    expect((await bvReader.file(imgs["jpeg"]!.id, "huge")).status).toBe(404);
  });
});

describe("11. cover, order, alt text and removal", () => {
  it("keeps exactly one cover", async () => {
    expectError(
      await bvEditor.post(`/images/${imgs["png"]!.id}/cover`, { version: 1 }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await pm.post(`/images/${imgs["png"]!.id}/cover`, { version: 9 }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    const r = await pm.post(`/images/${imgs["png"]!.id}/cover`, { version: 1 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(
      r.body.items.filter((i: { isCover: boolean }) => i.isCover).map((i: { id: string }) => i.id),
    ).toEqual([imgs["png"]!.id]);
    expect(
      await owner.productImage.count({ where: { productId: products["syn6"]!.id, isCover: true } }),
    ).toBe(1);
    await rejectsDb(
      asApp.productImage.update({ where: { id: imgs["webp"]!.id }, data: { isCover: true } }),
      /ProductImage_cover_productId_key|Unique constraint/i,
    );
    expect(await lastAudit("catalog.image_cover_set")).toMatchObject({
      resourceId: imgs["png"]!.id,
    });
  });

  it("reorders the whole gallery only, never another product's images", async () => {
    const id = products["syn6"]!.id;
    const other = await pm.upload(
      products["SN-500"]!.id,
      await image(900, 700, "jpeg"),
      "image/jpeg",
      "sn500.jpg",
    );
    expect(other.status).toBe(201);
    const order = [imgs["webp"]!.id, imgs["png"]!.id, imgs["jpeg"]!.id];
    expectError(
      await pm.post(`/products/${id}/images/order`, {
        imageIds: [imgs["webp"]!.id, imgs["png"]!.id, other.body.image.id],
      }),
      409,
      "CONFLICT_STATE",
      { path: "imageIds", rule: "not_the_gallery" },
    );
    expectError(
      await pm.post(`/products/${id}/images/order`, {
        imageIds: [imgs["webp"]!.id, imgs["webp"]!.id, imgs["jpeg"]!.id],
      }),
      409,
      "CONFLICT_STATE",
    );
    expectError(
      await pm.post(`/products/${id}/images/order`, { imageIds: order.slice(0, 2) }),
      409,
      "CONFLICT_STATE",
    );
    expectError(
      await bvEditor.post(`/products/${id}/images/order`, { imageIds: order }),
      403,
      "FORBIDDEN",
    );
    const r = await pm.post(`/products/${id}/images/order`, { imageIds: order });
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: { id: string }) => i.id)).toEqual(order);
    expect(
      (await owner.productImage.findUniqueOrThrow({ where: { id: other.body.image.id } }))
        .sortOrder,
    ).toBe(0);
  });

  it("sets alt text with versions; missing alt text is a WARNING in the report", async () => {
    const before = await pm.get(`/products/${products["syn6"]!.id}/specs`);
    expect(
      before.body.validation.warnings.filter(
        (i: { code: string }) => i.code === "alt_text_missing",
      ),
    ).toHaveLength(3);
    // Moving the cover bumped the former cover's version: use the current one.
    const current = (await pm.get(`/products/${products["syn6"]!.id}/images`)).body.items.find(
      (i: { id: string }) => i.id === imgs["jpeg"]!.id,
    ).version as number;
    const r = await pm.post(`/images/${imgs["jpeg"]!.id}`, {
      altText: "  ICCSYN 6 drum, front  ",
      version: current,
    });
    expect(r.status).toBe(200);
    expect(r.body.image).toMatchObject({ altText: "ICCSYN 6 drum, front", version: current + 1 });
    expectError(
      await pm.post(`/images/${imgs["jpeg"]!.id}`, { altText: "x", version: current }),
      409,
      "CONFLICT_STATE",
    );
    expectError(
      await bvEditor.post(`/images/${imgs["jpeg"]!.id}`, { altText: "x", version: current + 1 }),
      403,
      "FORBIDDEN",
    );
    const after = await pm.get(`/products/${products["syn6"]!.id}/specs`);
    expect(
      after.body.validation.warnings.filter((i: { code: string }) => i.code === "alt_text_missing"),
    ).toHaveLength(2);
    await rejectsDb(
      asApp.productImage.update({
        where: { id: imgs["jpeg"]!.id },
        data: { sha256: "0".repeat(64) },
      }),
      /file facts of an image cannot change/,
    );
  });

  it("deleting the cover promotes the next image and removes the files", async () => {
    const before = mediaFiles().length;
    expectError(await bvEditor.del(`/images/${imgs["png"]!.id}`), 403, "FORBIDDEN");
    expect((await pm.del(`/images/${imgs["png"]!.id}`)).status).toBe(204);
    const list = await pm.get(`/products/${products["syn6"]!.id}/images`);
    expect(list.body.items.map((i: { id: string; isCover: boolean }) => [i.id, i.isCover])).toEqual(
      [
        [imgs["webp"]!.id, true],
        [imgs["jpeg"]!.id, false],
      ],
    );
    expect(mediaFiles()).toHaveLength(before - 3);
    expect((await lastAudit("catalog.image_deleted"))?.metadata).toMatchObject({
      wasCover: true,
      promoted: imgs["webp"]!.id,
    });
    expectError(await pm.del(`/images/${imgs["png"]!.id}`), 404, "NOT_FOUND");
  });
});

describe("12. storage failures leave no orphans", () => {
  it("a failed storage write answers 503 and removes what was written", async () => {
    const faults = app.get<Faults>(FaultToken);
    const before = mediaFiles();
    const rows = await owner.productImage.count();
    faults.armed = "media.put.display";
    expectError(
      await pm.upload(products["SN-500"]!.id, await image(1000, 800, "jpeg"), "image/jpeg"),
      503,
      "STORAGE_UNAVAILABLE",
    );
    expect(mediaFiles()).toEqual(before);
    expect(await owner.productImage.count()).toBe(rows);
  });

  it("a failed database write removes the stored files again", async () => {
    const faults = app.get<Faults>(FaultToken);
    const before = mediaFiles();
    faults.armed = "media.db.insert";
    const r = await pm.upload(products["SN-500"]!.id, await image(1000, 800, "png"), "image/png");
    expect(r.status).toBe(500);
    expect(mediaFiles()).toEqual(before);
  });

  it("an unwritable storage answers 503 (skipped when running as root)", async () => {
    if (process.getuid?.() === 0) return;
    // New images go into products/<random>/, so the products directory is what must be read-only.
    const productsDir = path.join(MEDIA_DIR, "products");
    chmodSync(productsDir, 0o500);
    try {
      expectError(
        await pm.upload(products["SN-500"]!.id, await image(1000, 800, "jpeg"), "image/jpeg"),
        503,
        "STORAGE_UNAVAILABLE",
      );
    } finally {
      chmodSync(productsDir, 0o700);
    }
  });

  it("a row whose file is missing answers 404, not 500", async () => {
    const row = await owner.productImage.findUniqueOrThrow({ where: { id: imgs["jpeg"]!.id } });
    rmSync(path.join(MEDIA_DIR, row.storageKey));
    expect((await pm.file(imgs["jpeg"]!.id, "original")).status).toBe(404);
    expect((await pm.file(imgs["jpeg"]!.id, "display")).status).toBe(200);
  });
});

describe("13. DP-157 catalogue import (dry run, apply, idempotence, conflicts)", () => {
  const range = (min: number | null, max: number | null) => ({
    type: "RANGE",
    min,
    max,
    minExclusive: false,
    maxExclusive: false,
  });
  const item = (code: string, slug: string, category: string, specs: object[] = []) => ({
    liveSlug: slug,
    sourceUrl: `https://example.test/en/products/${slug}`,
    code,
    slug,
    name: `Imported ${code}`,
    readiness: specs.length ? "READY" : "READY_NO_SPECS",
    import: {
      master: { code, slug, name: `Imported ${code}`, status: "DRAFT" },
      listing: {
        site: "BV",
        categorySlug: category,
        visibility: "HIDDEN",
        sortOrder: 10,
        texts: { en: { title: `Imported ${code}` } },
      },
      specs,
    },
  });
  const mapping = CatalogMappingSchema.parse({
    schemaVersion: 1,
    site: "BV",
    definitions: [
      { key: "imp_vi", name: "VI", dataType: "RANGE", units: [], testMethods: [], decimals: 0 },
      // existing RANGE °C definition: reused
      {
        key: "pour_point",
        name: "Pour",
        dataType: "RANGE",
        units: ["°C"],
        testMethods: [],
        decimals: 0,
      },
      // existing NUMBER definition: incompatible, so IMP-3's technical set is skipped
      {
        key: "kv100",
        name: "KV",
        dataType: "RANGE",
        units: ["mm²/s"],
        testMethods: [],
        decimals: 2,
      },
    ],
    categories: [
      { slug: "imp-oil", name: "Imported oil", parentSlug: null, sortOrder: 10 },
      { slug: "imp-oil-g1", name: "Group I", parentSlug: "imp-oil", sortOrder: 20 },
    ],
    products: [
      item("IMP-1", "imp-1", "imp-oil-g1", [
        {
          key: "imp_vi",
          basis: "SPECIFICATION",
          value: range(95, null),
          unit: null,
          testMethod: null,
        },
        {
          key: "pour_point",
          basis: "SPECIFICATION",
          value: range(null, -9),
          unit: "°C",
          testMethod: "ASTM D97",
        },
        {
          key: "pour_point",
          basis: "TYPICAL",
          value: range(-12, -12),
          unit: "°C",
          testMethod: null,
        },
      ]),
      item("IMP-2", "imp-2", "imp-oil"),
      item("IMP-3", "imp-3", "imp-oil", [
        {
          key: "kv100",
          basis: "SPECIFICATION",
          value: range(4, 5),
          unit: "mm²/s",
          testMethod: null,
        },
      ]),
      // the code of an existing product with another slug: never touched
      item("SN-500", "sn-500-live", "imp-oil"),
      item("IMP-4", "imp-4", "imp-oil"),
    ],
  });
  let importer: Staff;
  const api = () =>
    adminApi({
      baseUrl: base,
      proxyKey: TEST_KEYS.admin,
      sessionToken: importer.token,
      origin: ADMIN_ORIGIN,
    });
  const footprint = async () => ({
    products: await owner.product.count(),
    categories: await owner.productCategory.count(),
    definitions: await owner.specDefinition.count(),
    listings: await owner.productSiteListing.count(),
    values: await owner.productSpecValue.count(),
  });

  beforeAll(async () => {
    importer = await staff(
      "importer",
      [{ role: "platform_product_manager" }, { role: "product_editor", site: BV }],
      admin.userId,
    );
  });

  it("a dry run reads only and reports the plan; a reader cannot apply", async () => {
    const before = await footprint();
    const sn500 = await owner.product.findUniqueOrThrow({ where: { code: "SN-500" } });
    const r = await runImport(api(), mapping, { apply: false });
    expect(r.mode).toBe("dry-run");
    expect(r.written).toEqual([]);
    expect(r.plan.products.map((p) => [p.code, p.action, p.specs, p.specsSkipped])).toEqual([
      ["IMP-1", "CREATE", 3, 0],
      ["IMP-2", "CREATE", 0, 0],
      ["IMP-3", "CREATE", 0, 1],
      ["SN-500", "CONFLICT", 0, 0],
      ["IMP-4", "CREATE", 0, 0],
    ]);
    expect(r.plan.definitions.map((d) => [d.key, d.action])).toEqual([
      ["imp_vi", "CREATE"],
      ["pour_point", "REUSE"],
      ["kv100", "CONFLICT"],
    ]);
    expect(r.plan.confirmCount).toBe(4);
    expect(await footprint()).toEqual(before);
    // an apply without the dry run's count is refused before anything is written
    await expect(runImport(api(), mapping, { apply: true, confirm: 3 })).rejects.toThrow(
      /does not match the plan \(4 product/,
    );
    expect(await footprint()).toEqual(before);
    expect(
      (await owner.product.findUniqueOrThrow({ where: { code: "SN-500" } })).updatedAt,
    ).toEqual(sn500.updatedAt);
    // the session's own permissions apply: a BV reader cannot create anything
    const reader = adminApi({
      baseUrl: base,
      proxyKey: TEST_KEYS.admin,
      sessionToken: bvReader.token,
      origin: ADMIN_ORIGIN,
    });
    const denied = await runImport(reader, mapping, { apply: true, confirm: 4 });
    expect(denied.error).toMatch(/403/);
    expect(denied.written).toEqual([]);
    expect(await footprint()).toEqual(before);
  });

  it("apply creates DRAFT masters, HIDDEN BV listings and only the importable values", async () => {
    const before = await footprint();
    const sn500 = await owner.product.findUniqueOrThrow({ where: { code: "SN-500" } });
    // IMP-4 was started by hand earlier: same code, slug and name, no listing (PARTIAL)
    const partial = await pm.post("/products", {
      code: "IMP-4",
      slug: "imp-4",
      name: "Imported IMP-4",
    });
    expect(partial.status).toBe(201);
    const dry = await runImport(api(), mapping, { apply: false });
    expect(dry.plan.products.find((p) => p.code === "IMP-4")?.action).toBe("PARTIAL");
    expect(dry.plan.confirmCount).toBe(3);
    const r = await runImport(api(), mapping, { apply: true, confirm: 3 });
    expect(r.error).toBeNull();
    expect(r.written.map((w) => `${w.kind}:${w.ref}`)).toEqual([
      "definition:imp_vi",
      "category:imp-oil",
      "category:imp-oil-g1",
      "product:IMP-1",
      "listing:IMP-1",
      "specs:IMP-1",
      "product:IMP-2",
      "listing:IMP-2",
      "product:IMP-3",
      "listing:IMP-3",
    ]);
    const created = await owner.product.findMany({
      where: { code: { in: ["IMP-1", "IMP-2", "IMP-3"] } },
      include: { listings: true, specValues: true },
      orderBy: { code: "asc" },
    });
    expect(
      created.map((p) => [p.code, p.status, p.listings.map((l) => [l.siteId, l.visibility])]),
    ).toEqual([
      ["IMP-1", "DRAFT", [[BV, "HIDDEN"]]],
      ["IMP-2", "DRAFT", [[BV, "HIDDEN"]]],
      ["IMP-3", "DRAFT", [[BV, "HIDDEN"]]],
    ]);
    expect(created.map((p) => p.specValues.length)).toEqual([3, 0, 0]);
    const typical = created[0]!.specValues.find((v) => v.basis === "TYPICAL")!;
    expect([typical.rangeMin?.toString(), typical.rangeMax?.toString()]).toEqual(["-12", "-12"]);
    const limit = created[0]!.specValues.find(
      (v) => v.basis === "SPECIFICATION" && v.rangeMin === null,
    )!;
    expect([limit.rangeMax?.toString(), limit.testMethod]).toEqual(["-9", "ASTM D97"]);
    // the hand-made IMP-4 and the conflicting SN-500 are untouched
    const imp4 = await owner.product.findUniqueOrThrow({
      where: { code: "IMP-4" },
      include: { listings: true },
    });
    expect(imp4.listings).toEqual([]);
    expect(
      (await owner.product.findUniqueOrThrow({ where: { code: "SN-500" } })).updatedAt,
    ).toEqual(sn500.updatedAt);
    const after = await footprint();
    expect(after.products - before.products).toBe(4); // 3 imported + IMP-4 by hand
    expect(after.definitions - before.definitions).toBe(1);
    // the import acted as the operator: audit events carry the importer
    const audit = await owner.auditEvent.findMany({
      where: { actorUserId: importer.userId, action: "catalog.product_created" },
    });
    expect(audit).toHaveLength(3);
  });

  it("re-running writes nothing; a partial product is completed only on request", async () => {
    const before = await footprint();
    const again = await runImport(api(), mapping, { apply: false });
    expect(again.plan.products.map((p) => [p.code, p.action])).toEqual([
      ["IMP-1", "ALREADY_IMPORTED"],
      ["IMP-2", "ALREADY_IMPORTED"],
      ["IMP-3", "ALREADY_IMPORTED"],
      ["SN-500", "CONFLICT"],
      ["IMP-4", "PARTIAL"],
    ]);
    expect(again.plan.counts.definitionsToCreate + again.plan.counts.categoriesToCreate).toBe(0);
    const noop = await runImport(api(), mapping, { apply: true, confirm: 0 });
    expect(noop.written).toEqual([]);
    expect(await footprint()).toEqual(before);
    const resume = await runImport(api(), mapping, {
      apply: true,
      confirm: 1,
      resumePartial: true,
    });
    expect(resume.error).toBeNull();
    expect(resume.written.map((w) => `${w.kind}:${w.ref}`)).toEqual(["listing:IMP-4"]);
    const final = await runImport(api(), mapping, { apply: false, resumePartial: true });
    expect(final.plan.confirmCount).toBe(0);
  });
});
