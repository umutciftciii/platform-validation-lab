// CMS S1 (DP-015, ADR-020): page drafts of the two public sites over HTTP and the database rules
// behind them, on a database of its own (CMS_*_DATABASE_URL, a *_test database that starts EMPTY).
//
// Setup as in the catalogue suites: migrations as dp_migrator, catalogue sync and bootstrap
// through the operator CLI, staff fixtures written as dp_owner, the API in-process from dist/
// as dp_app, every request with the admin proxy key.
//
// Covers: the CHECK constraints and dp_app privileges of CmsPage; site authorization with the
// existing content roles (content:read / content:edit, site scope, IDOR refusals with DENIED
// audit events); creating TEMPLATE pages, reserved and taken slugs; saving drafts (validation of
// the section schema, optimistic versions, audit metadata without values); DESIGN pages are not
// editable before the S2 import.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  BV_FOOTER_FIELDS,
  CmsContextResponseSchema,
  CmsImportResponseSchema,
  CmsPreviewResponseSchema,
  CmsPublicBundleSchema,
  cmsFieldsSchema,
  CmsPageListResponseSchema,
  CmsPageResponseSchema,
  ErrorBodySchema,
} from "@dream/contracts";
import { assertTestDatabaseUrl } from "@dream/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { ADMIN_ORIGIN, TEST_KEYS, apiTestEnv } from "./helpers/auth-env.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(API_DIR, "dist/iam/iam-cli.js");
const PRISMA = path.join(API_DIR, "node_modules/.bin/prisma");
const appUrl = assertTestDatabaseUrl(process.env["CMS_DATABASE_URL"]);
const DB_NAME = appUrl.pathname.slice(1);
function bootstrapUrl(): string {
  const u = assertTestDatabaseUrl(process.env["IAM_BOOTSTRAP_DATABASE_URL"]);
  u.pathname = `/${DB_NAME}`;
  return assertTestDatabaseUrl(u.toString()).toString();
}
const urls = {
  app: appUrl.toString(),
  migrate: assertTestDatabaseUrl(process.env["CMS_MIGRATE_DATABASE_URL"]).toString(),
  boot: bootstrapUrl(),
};
for (const shared of [
  process.env["DATABASE_URL"],
  process.env["AUTH_DATABASE_URL"],
  process.env["CATALOG_DATABASE_URL"],
  process.env["OWNER_DATABASE_URL"],
]) {
  if (shared && new URL(shared).pathname === appUrl.pathname) {
    throw new Error("CMS_DATABASE_URL must be a database of its own (it starts empty)");
  }
}
const ENV_BACKUP = { ...process.env };

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

  async call(method: string, p: string, body?: unknown): Promise<Res> {
    const headers: Record<string, string> = {
      "x-dp-proxy-key": TEST_KEYS.admin,
      "x-dp-client-ip": "10.20.30.40",
      cookie: `__Host-dp_admin_session=${this.token}`,
    };
    if (method !== "GET") headers["origin"] = ADMIN_ORIGIN;
    if (method === "POST") headers["content-type"] = "application/json";
    return parse(
      await fetch(`${base}/api/v1/admin/cms${p}`, {
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
        reason: "CMS S1 test fixture",
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

let root: Staff; // platform_super_admin: content:read/edit everywhere, no publishing
let bvEditor: Staff; // content_editor @ BV
let bvPublisher: Staff; // content_publisher @ BV (reads, cannot edit drafts)
let comEditor: Staff; // content_editor @ CORPORATE
let bvReader: Staff; // read_only @ BV
let nobody: Staff; // ACTIVE, no role

beforeAll(async () => {
  owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: urls.migrate }) });
  asApp = new PrismaClient({ adapter: new PrismaPg({ connectionString: urls.app }) });
  const tables = await owner.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM pg_tables WHERE schemaname = 'public'`;
  expect(Number(tables[0]?.n), "the CMS test database must start empty").toBe(0);
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
  bvEditor = await staff("bv-editor", [{ role: "content_editor", site: BV }], rootUser.id);
  bvPublisher = await staff("bv-publisher", [{ role: "content_publisher", site: BV }], rootUser.id);
  comEditor = await staff("com-editor", [{ role: "content_editor", site: COM }], rootUser.id);
  bvReader = await staff("bv-reader", [{ role: "read_only", site: BV }], rootUser.id);
  nobody = await staff("nobody", [], rootUser.id);

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
  await owner?.$disconnect();
  await asApp?.$disconnect();
  for (const k of Object.keys(process.env)) if (!(k in ENV_BACKUP)) delete process.env[k];
  Object.assign(process.env, ENV_BACKUP);
});

const SEO = { title: null, description: null, noindex: false };
const HERO = { id: "sec-hero-001", type: "hero", title: "About Dream Petroleum" };

/** A row inserted directly as dp_owner (for the CHECK probes). */
function row(data: Record<string, unknown>) {
  return owner.cmsPage.create({
    data: {
      siteId: BV,
      kind: "TEMPLATE",
      templateKey: "standard",
      path: `/probe-${randomBytes(4).toString("hex")}`,
      locale: "en",
      title: "Probe",
      content: { sections: [] },
      createdById: root.userId,
      updatedById: root.userId,
      ...data,
    } as never,
  });
}

describe("1. schema", () => {
  it("refuses bad paths, reserved slugs and inconsistent kinds", async () => {
    await rejectsDb(row({ path: "/About" }), /CmsPage_path_format/);
    await rejectsDb(row({ path: "/a/b" }), /CmsPage_path_format/);
    await rejectsDb(row({ path: "/" }), /CmsPage_template_path/);
    await rejectsDb(row({ path: "/products" }), /CmsPage_template_path/);
    await rejectsDb(row({ path: "/en" }), /CmsPage_template_path/);
    await rejectsDb(row({ templateKey: "bv.home" }), /CmsPage_template_path/);
    await rejectsDb(row({ kind: "FRAGMENT", templateKey: "bv.site-nav" }), /CmsPage_fragment_path/);
    await rejectsDb(
      row({ kind: "DESIGN", templateKey: "bv.home", path: null }),
      /CmsPage_fragment_path/,
    );
    await rejectsDb(
      row({ kind: "DESIGN", templateKey: "Home", path: "/" }),
      /CmsPage_registry_key/,
    );
  });

  it("refuses untrimmed texts, a non-object content and a bad locale", async () => {
    await rejectsDb(row({ title: " Probe" }), /CmsPage_title_trimmed/);
    await rejectsDb(row({ seoTitle: "" }), /CmsPage_seo_trimmed/);
    await rejectsDb(row({ content: [] }), /CmsPage_content_object/);
    await rejectsDb(row({ locale: "EN" }), /CmsPage_locale_format/);
    await rejectsDb(row({ version: 0 }), /CmsPage_version_positive/);
  });

  it("allows one DESIGN page per registry key and site, and DESIGN pages on app routes", async () => {
    const home = await row({ kind: "DESIGN", templateKey: "bv.home", path: "/" });
    await rejectsDb(
      row({ kind: "DESIGN", templateKey: "bv.home", path: "/home-2" }),
      /CmsPage_registry_siteId_templateKey_key|Unique constraint/,
    );
    const products = await row({
      kind: "DESIGN",
      templateKey: "bv.products-index",
      path: "/products",
    });
    const nav = await row({ kind: "FRAGMENT", templateKey: "bv.site-nav", path: null });
    await owner.cmsPage.deleteMany({ where: { id: { in: [home.id, products.id, nav.id] } } });
  });

  it("gives dp_app no DELETE on CmsPage", async () => {
    const probe = await row({});
    await rejectsDb(asApp.cmsPage.delete({ where: { id: probe.id } }), /permission denied/);
    await owner.cmsPage.delete({ where: { id: probe.id } });
  });
});

describe("2. context and site access", () => {
  it("lists the readable sites with the caller's abilities", async () => {
    const editor = CmsContextResponseSchema.parse((await bvEditor.get("/context")).body);
    expect(editor.sites).toEqual([
      expect.objectContaining({
        id: BV,
        key: "BV",
        canEdit: true,
        canPublish: false,
        locale: "en",
      }),
    ]);
    const publisher = CmsContextResponseSchema.parse((await bvPublisher.get("/context")).body);
    expect(publisher.sites).toEqual([
      expect.objectContaining({ id: BV, canEdit: false, canPublish: true }),
    ]);
    const admin = CmsContextResponseSchema.parse((await root.get("/context")).body);
    expect(admin.sites.map((s) => [s.key, s.canEdit, s.canPublish])).toEqual([
      ["BV", true, false],
      ["CORPORATE", true, false],
    ]);
    expect(CmsContextResponseSchema.parse((await nobody.get("/context")).body).sites).toEqual([]);
  });

  it("refuses the page list of a site the caller cannot read (403, audited)", async () => {
    expectError(await comEditor.get(`/sites/${BV}/pages`), 403, "FORBIDDEN");
    const denied = await lastAudit("cms.access_denied");
    expect(denied?.actorUserId).toBe(comEditor.userId);
    expect(denied?.outcome).toBe("DENIED");
    expectError(await nobody.get(`/sites/${BV}/pages`), 403, "FORBIDDEN");
    expectError(await bvEditor.get(`/sites/not-a-uuid/pages`), 403, "FORBIDDEN");
  });
});

let pageId: string;

describe("3. create a page", () => {
  it("creates an empty TEMPLATE draft on the editor's site, audited", async () => {
    const res = await bvEditor.post(`/sites/${BV}/pages`, {
      title: " About us ",
      slug: "About-Us",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { page, site } = CmsPageResponseSchema.parse(res.body);
    expect(page).toMatchObject({
      siteId: BV,
      kind: "TEMPLATE",
      templateKey: "standard",
      path: "/about-us",
      slug: "about-us",
      title: "About us",
      locale: "en",
      version: 1,
      sectionCount: 0,
      seo: SEO,
      content: { sections: [] },
      createdBy: { id: bvEditor.userId, name: "bv-editor" },
    });
    expect(site.key).toBe("BV");
    pageId = page.id;
    const audit = await lastAudit("cms.page_created");
    expect(audit).toMatchObject({
      actorUserId: bvEditor.userId,
      siteId: BV,
      resourceType: "cms_page",
      resourceId: pageId,
      outcome: "SUCCESS",
    });
  });

  it("refuses reserved, malformed and taken slugs", async () => {
    expectError(
      await bvEditor.post(`/sites/${BV}/pages`, { title: "P", slug: "products" }),
      400,
      "VALIDATION_FAILED",
      { path: "slug", rule: "custom" },
    );
    expectError(
      await bvEditor.post(`/sites/${BV}/pages`, { title: "P", slug: "a/b" }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await bvEditor.post(`/sites/${BV}/pages`, { title: "P", slug: "about-us" }),
      409,
      "CONFLICT_STATE",
      { path: "slug", rule: "unique" },
    );
    // The same slug on the other site is a different page.
    const com = await comEditor.post(`/sites/${COM}/pages`, { title: "About", slug: "about-us" });
    expect(com.status, JSON.stringify(com.body)).toBe(201);
  });

  it("refuses creation without content:edit on that site", async () => {
    expectError(
      await bvReader.post(`/sites/${BV}/pages`, { title: "P", slug: "p-1" }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await bvPublisher.post(`/sites/${BV}/pages`, { title: "P", slug: "p-1" }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await comEditor.post(`/sites/${BV}/pages`, { title: "P", slug: "p-1" }),
      403,
      "FORBIDDEN",
    );
  });
});

describe("4. save a draft", () => {
  const draft = (version: number, content: unknown, extra: Record<string, unknown> = {}) => ({
    version,
    title: "About us",
    slug: "about-us",
    seo: { title: "About Dream Petroleum BV", description: "Who we are.", noindex: true },
    content,
    ...extra,
  });

  it("saves the whole draft, bumps the version and audits field names only", async () => {
    const res = await bvEditor.post(
      `/pages/${pageId}/draft`,
      draft(1, {
        sections: [
          HERO,
          { id: "sec-text-001", type: "text", body: "We trade base oils.\n\nFrom Rotterdam." },
          {
            id: "sec-cards-01",
            type: "cards",
            title: "Services",
            items: [{ title: "Logistics", link: { label: "More", href: "/logistics" } }],
          },
          {
            id: "sec-cta-0001",
            type: "cta",
            title: "Talk to us",
            button: { label: "Contact", href: "mailto:info@example.com" },
          },
        ],
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { page } = CmsPageResponseSchema.parse(res.body);
    expect(page.version).toBe(2);
    expect(page.sectionCount).toBe(4);
    expect(page.seo).toEqual({
      title: "About Dream Petroleum BV",
      description: "Who we are.",
      noindex: true,
    });
    expect((page.content["sections"] as unknown[])[0]).toEqual({
      ...HERO,
      eyebrow: null,
      intro: null,
      cta: null,
    });
    const audit = await lastAudit("cms.page_draft_saved");
    expect(audit?.metadata).toMatchObject({
      permission: "content:edit",
      changed: ["seoTitle", "seoDescription", "noindex", "content"],
      sectionCount: 4,
      version: 2,
    });
    expect(JSON.stringify(audit?.metadata)).not.toContain("Rotterdam");
  });

  it("answers 409 on a stale version and keeps the newer draft", async () => {
    expectError(
      await bvEditor.post(`/pages/${pageId}/draft`, draft(1, { sections: [] })),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    const res = await bvReader.get(`/pages/${pageId}`);
    expect(CmsPageResponseSchema.parse(res.body).page.sectionCount).toBe(4);
  });

  it("refuses invalid section content with the field path", async () => {
    const res = await bvEditor.post(
      `/pages/${pageId}/draft`,
      draft(2, {
        sections: [
          {
            id: "sec-cta-0001",
            type: "cta",
            title: "x",
            button: { label: "Go", href: "javascript:alert(1)" },
          },
        ],
      }),
    );
    expectError(res, 400, "VALIDATION_FAILED");
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(
      "content.sections.0.button.href",
    );
    expectError(
      await bvEditor.post(
        `/pages/${pageId}/draft`,
        draft(2, { sections: [{ id: "sec-x-000001", type: "html" }] }),
      ),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await bvEditor.post(`/pages/${pageId}/draft`, draft(2, { sections: [] }, { kind: "DESIGN" })),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("changes the slug, refusing a taken one", async () => {
    const other = await bvEditor.post(`/sites/${BV}/pages`, {
      title: "Logistics",
      slug: "logistics",
    });
    expect(other.status).toBe(201);
    expectError(
      await bvEditor.post(
        `/pages/${pageId}/draft`,
        draft(2, { sections: [] }, { slug: "logistics" }),
      ),
      409,
      "CONFLICT_STATE",
      { path: "slug", rule: "unique" },
    );
    const res = await bvEditor.post(
      `/pages/${pageId}/draft`,
      draft(2, { sections: [HERO] }, { slug: "who-we-are" }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(CmsPageResponseSchema.parse(res.body).page).toMatchObject({
      path: "/who-we-are",
      version: 3,
    });
  });

  it("hides pages of other sites and from callers without content:edit (404, audited)", async () => {
    expectError(await comEditor.get(`/pages/${pageId}`), 404, "NOT_FOUND");
    expectError(
      await comEditor.post(`/pages/${pageId}/draft`, draft(3, { sections: [] })),
      404,
      "NOT_FOUND",
    );
    const denied = await lastAudit("cms.access_denied");
    expect(denied).toMatchObject({
      actorUserId: comEditor.userId,
      resourceId: pageId,
      outcome: "DENIED",
    });
    expectError(
      await bvReader.post(`/pages/${pageId}/draft`, draft(3, { sections: [] })),
      404,
      "NOT_FOUND",
    );
    expectError(
      await bvPublisher.post(`/pages/${pageId}/draft`, draft(3, { sections: [] })),
      404,
      "NOT_FOUND",
    );
    expectError(await bvEditor.get(`/pages/not-a-uuid`), 404, "NOT_FOUND");
  });
});

describe("5. lists and DESIGN pages", () => {
  it("lists only the site's own pages", async () => {
    const bv = CmsPageListResponseSchema.parse((await bvReader.get(`/sites/${BV}/pages`)).body);
    expect(bv.site.key).toBe("BV");
    expect(bv.items.map((p) => p.path).sort()).toEqual(["/logistics", "/who-we-are"]);
    expect(bv.items.every((p) => p.siteId === BV)).toBe(true);
    const com = CmsPageListResponseSchema.parse((await root.get(`/sites/${COM}/pages`)).body);
    expect(com.items.map((p) => p.path)).toEqual(["/about-us"]);
  });

  it("does not save a designed page that has no template yet (bv.products-index)", async () => {
    const home = await row({ kind: "DESIGN", templateKey: "bv.products-index", path: "/products" });
    const res = await bvEditor.post(`/pages/${home.id}/draft`, {
      version: 1,
      title: "Home",
      slug: "home",
      seo: SEO,
      content: { sections: [] },
    });
    expectError(res, 409, "CONFLICT_STATE", { path: "kind", rule: "not_editable_yet" });
    const read = CmsPageResponseSchema.parse((await bvReader.get(`/pages/${home.id}`)).body);
    expect(read.page).toMatchObject({ kind: "DESIGN", slug: null, path: "/products" });
  });
});

// ---------------------------------------------------------------------------------------------
// CMS S2 (DP-017, DP-134): import, designed drafts, publication, public read model, preview
// ---------------------------------------------------------------------------------------------

async function pub(p: string, key: string = TEST_KEYS.webBv): Promise<Res> {
  return parse(
    await fetch(`${base}/api/v1/public/cms${p}`, {
      headers: { "x-dp-proxy-key": key, "x-dp-client-ip": "10.20.30.41" },
    }),
  );
}
const page = (id: string, as: Staff = bvEditor) => as.get(`/pages/${id}`);
let homeId: string;
let navId: string;
let footerId: string;

describe("6. import from code", () => {
  it("dry-runs, imports as a draft, and never imports twice", async () => {
    const dry = await bvEditor.post(`/sites/${BV}/import`, { key: "bv.home", dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    const check = CmsImportResponseSchema.parse(dry.body);
    expect(check).toMatchObject({ key: "bv.home", dryRun: true, pageId: null });
    expect(check.summary.map((s) => s.field)).toEqual([
      "hero",
      "productGroups",
      "services",
      "ctl",
      "applications",
    ]);
    expect(await owner.cmsPage.count({ where: { siteId: BV, templateKey: "bv.home" } })).toBe(0);

    const res = await bvEditor.post(`/sites/${BV}/import`, { key: "bv.home", dryRun: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    homeId = CmsImportResponseSchema.parse(res.body).pageId!;
    const home = CmsPageResponseSchema.parse((await page(homeId)).body).page;
    expect(home).toMatchObject({
      kind: "DESIGN",
      templateKey: "bv.home",
      path: "/",
      publication: null,
    });
    expect((await lastAudit("cms.page_imported"))?.resourceId).toBe(homeId);

    expectError(
      await bvEditor.post(`/sites/${BV}/import`, { key: "bv.home", dryRun: true }),
      409,
      "CONFLICT_STATE",
      { path: "key", rule: "already_imported" },
    );
    expectError(
      await bvEditor.post(`/sites/${BV}/import`, { key: "bv.home", dryRun: false }),
      409,
      "CONFLICT_STATE",
      { path: "key", rule: "already_imported" },
    );

    for (const key of ["bv.site-nav", "bv.site-footer"]) {
      const r = await bvEditor.post(`/sites/${BV}/import`, { key, dryRun: false });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const id = CmsImportResponseSchema.parse(r.body).pageId!;
      if (key === "bv.site-nav") navId = id;
      else footerId = id;
    }
  });

  it("refuses unknown keys, keys of the other site and callers without content:edit", async () => {
    expectError(
      await bvEditor.post(`/sites/${BV}/import`, { key: "bv.nothing", dryRun: true }),
      400,
      "VALIDATION_FAILED",
      { path: "key", rule: "unknown_template" },
    );
    expectError(
      await comEditor.post(`/sites/${COM}/import`, { key: "bv.home", dryRun: true }),
      400,
      "VALIDATION_FAILED",
      { path: "key", rule: "unknown_template" },
    );
    expectError(
      await bvPublisher.post(`/sites/${BV}/import`, { key: "bv.site-nav", dryRun: true }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await comEditor.post(`/sites/${BV}/import`, { key: "bv.site-nav", dryRun: true }),
      403,
      "FORBIDDEN",
    );
  });
});

describe("7. drafts of designed pages", () => {
  it("saves validated fields; the path stays fixed", async () => {
    const before = CmsPageResponseSchema.parse((await page(footerId)).body).page;
    const content = { ...before.content, headline: "Let’s move energy forward, together." };
    const res = await bvEditor.post(`/pages/${footerId}/draft`, {
      version: before.version,
      title: "Footer",
      seo: { title: null, description: null, noindex: false },
      content,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = CmsPageResponseSchema.parse(res.body).page;
    expect(after).toMatchObject({ version: before.version + 1, path: null });
    expect(after.content["headline"]).toBe("Let’s move energy forward, together.");
    expect((await lastAudit("cms.page_draft_saved"))?.metadata).toMatchObject({
      changed: ["content"],
    });
  });

  it("refuses removing a required disclosure, unknown fields and unregistered images", async () => {
    const home = CmsPageResponseSchema.parse((await page(homeId)).body).page;
    const c = home.content as Record<string, Record<string, unknown>>;
    const save = (content: unknown) =>
      bvEditor.post(`/pages/${homeId}/draft`, {
        version: home.version,
        title: "Home",
        seo: home.seo,
        content,
      });
    const r1 = await save({ ...c, services: { ...c["services"], disclosure: " " } });
    expectError(r1, 400, "VALIDATION_FAILED");
    expect(r1.body.error.details.map((d: { path: string }) => d.path)).toContain(
      "content.services.disclosure",
    );
    expectError(await save({ ...c, extra: 1 }), 400, "VALIDATION_FAILED");
    const ctl = c["ctl"] as { stages: Record<string, unknown>[] };
    const stages = ctl.stages.map((s, i) =>
      i === 0 ? { ...s, image: "https://evil.example/x.webp" } : s,
    );
    expectError(await save({ ...c, ctl: { ...ctl, stages } }), 400, "VALIDATION_FAILED");
    expectError(
      await save({ ...c, ctl: { ...ctl, stages: ctl.stages.slice(0, 2) } }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await bvEditor.post(`/pages/${homeId}/draft`, {
        version: home.version,
        title: "Home",
        slug: "x-y",
        seo: home.seo,
        content: c,
      }),
      400,
      "VALIDATION_FAILED",
    );
  });
});

describe("8. publication and the public read model", () => {
  it("shows nothing before the first publication (no fallback)", async () => {
    expectError(await pub("/page?path=/"), 404, "NOT_FOUND");
  });

  it("publishes only with content:publish of the site", async () => {
    const home = CmsPageResponseSchema.parse((await page(homeId)).body).page;
    expectError(
      await bvEditor.post(`/pages/${homeId}/publish`, { version: home.version }),
      404,
      "NOT_FOUND",
    );
    expectError(
      await root.post(`/pages/${homeId}/publish`, { version: home.version }),
      404,
      "NOT_FOUND",
    );
    expect((await lastAudit("cms.access_denied"))?.actorUserId).toBe(root.userId);
    expectError(
      await bvPublisher.post(`/pages/${homeId}/publish`, { version: home.version + 5 }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
  });

  it("publishes a revision; the site reads it with published fragments only", async () => {
    const home = CmsPageResponseSchema.parse((await page(homeId)).body).page;
    const res = await bvPublisher.post(`/pages/${homeId}/publish`, { version: home.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const published = CmsPageResponseSchema.parse(res.body).page;
    expect(published.publication).toMatchObject({
      status: "PUBLISHED",
      revisionNumber: 1,
      pageVersion: home.version,
      publishedBy: { id: bvPublisher.userId },
    });
    expect((await lastAudit("cms.page_published"))?.metadata).toMatchObject({
      revisionNumber: 1,
      path: "/",
    });

    const live = await pub("/page?path=/");
    expect(live.status, JSON.stringify(live.body)).toBe(200);
    const bundle = CmsPublicBundleSchema.parse(live.body);
    expect(bundle).toMatchObject({
      preview: false,
      page: { templateKey: "bv.home", revisionNumber: 1 },
    });
    expect(bundle.page.content).toEqual(home.content);
    // Navigation and footer are imported but not published: not shown.
    expect(bundle.fragments).toEqual({ "bv.site-nav": null, "bv.site-footer": null });
    // The Corporate site cannot read BV pages, the admin key cannot read public pages.
    expectError(await pub("/page?path=/", TEST_KEYS.webCorporate), 404, "NOT_FOUND");
    expectError(await pub("/page?path=/", TEST_KEYS.admin), 404, "NOT_FOUND");
    expectError(await pub("/page?path=..%2F"), 404, "NOT_FOUND");
  });

  it("keeps a saved draft off the site until it is published again", async () => {
    const home = CmsPageResponseSchema.parse((await page(homeId)).body).page;
    const c = home.content as { hero: Record<string, unknown> };
    const save = await bvEditor.post(`/pages/${homeId}/draft`, {
      version: home.version,
      title: "Home",
      seo: home.seo,
      content: { ...c, hero: { ...c.hero, tagline: "Purity in Motion. (CMS S2 test)" } },
    });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    const saved = CmsPageResponseSchema.parse(save.body).page;
    expect(saved.publication?.pageVersion).toBe(home.version);
    expect(saved.version).toBe(home.version + 1);
    const before = CmsPublicBundleSchema.parse((await pub("/page?path=/")).body);
    expect((before.page.content as { hero: { tagline: string } }).hero.tagline).toBe(
      "Purity in Motion.",
    );

    const re = await bvPublisher.post(`/pages/${homeId}/publish`, { version: saved.version });
    expect(re.status, JSON.stringify(re.body)).toBe(200);
    const after = CmsPublicBundleSchema.parse((await pub("/page?path=/")).body);
    expect(after.page.revisionNumber).toBe(2);
    expect((after.page.content as { hero: { tagline: string } }).hero.tagline).toBe(
      "Purity in Motion. (CMS S2 test)",
    );
  });

  it("shows published fragments, validated", async () => {
    for (const id of [navId, footerId]) {
      const p = CmsPageResponseSchema.parse((await page(id)).body).page;
      const r = await bvPublisher.post(`/pages/${id}/publish`, { version: p.version });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const bundle = CmsPublicBundleSchema.parse((await pub("/page?path=/")).body);
    expect(bundle.fragments["bv.site-nav"]?.templateKey).toBe("bv.site-nav");
    const footer = cmsFieldsSchema(BV_FOOTER_FIELDS).parse(
      bundle.fragments["bv.site-footer"]?.content,
    );
    expect(footer["headline"]).toBe("Let’s move energy forward, together.");
  });

  it("unpublishes: the page is gone from the site (no fallback); republishing brings the draft", async () => {
    const home = CmsPageResponseSchema.parse((await page(homeId)).body).page;
    expectError(
      await bvPublisher.post(`/pages/${homeId}/unpublish`, { publicationVersion: 99 }),
      409,
      "CONFLICT_STATE",
      { path: "publicationVersion", rule: "stale" },
    );
    const res = await bvPublisher.post(`/pages/${homeId}/unpublish`, {
      publicationVersion: home.publication!.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(CmsPageResponseSchema.parse(res.body).page.publication).toMatchObject({
      status: "UNPUBLISHED",
      unpublishedBy: { id: bvPublisher.userId },
    });
    expectError(await pub("/page?path=/"), 404, "NOT_FOUND");
    expectError(
      await bvPublisher.post(`/pages/${homeId}/unpublish`, {
        publicationVersion: home.publication!.version + 1,
      }),
      409,
      "CONFLICT_STATE",
      { path: "status", rule: "not_published" },
    );

    const re = await bvPublisher.post(`/pages/${homeId}/publish`, { version: home.version });
    expect(re.status, JSON.stringify(re.body)).toBe(200);
    expect(CmsPublicBundleSchema.parse((await pub("/page?path=/")).body).page.revisionNumber).toBe(
      3,
    );
    expect(await owner.cmsPageRevision.count({ where: { pageId: homeId } })).toBe(3);
  });

  it("refuses publishing a path that another page shows live", async () => {
    const a = CmsPageResponseSchema.parse(
      (await bvEditor.post(`/sites/${BV}/pages`, { title: "A", slug: "clash-a" })).body,
    ).page;
    const pa = await bvPublisher.post(`/pages/${a.id}/publish`, { version: a.version });
    expect(pa.status, JSON.stringify(pa.body)).toBe(200);
    const moved = await bvEditor.post(`/pages/${a.id}/draft`, {
      version: a.version,
      title: "A",
      slug: "clash-a-moved",
      seo: SEO,
      content: { sections: [] },
    });
    expect(moved.status).toBe(200);
    const b = CmsPageResponseSchema.parse(
      (await bvEditor.post(`/sites/${BV}/pages`, { title: "B", slug: "clash-a" })).body,
    ).page;
    expectError(
      await bvPublisher.post(`/pages/${b.id}/publish`, { version: b.version }),
      409,
      "CONFLICT_STATE",
      { path: "slug", rule: "live_elsewhere" },
    );
  });
});

describe("9. preview links", () => {
  const hmac = Buffer.from(TEST_KEYS.hmac, "base64url");
  const forge = (pageId: string, site: string, exp: number) =>
    `v1.${pageId}.${site}.${exp}.${createHmac("sha256", hmac).update("dp:cms_preview\0").update(`${pageId}\0${site}\0${exp}`).digest("hex")}`;

  it("shows the current draft of one page on its site for 15 minutes", async () => {
    const home = CmsPageResponseSchema.parse((await page(homeId)).body).page;
    const c = home.content as { hero: Record<string, unknown> };
    const draft = await bvEditor.post(`/pages/${homeId}/draft`, {
      version: home.version,
      title: "Home",
      seo: home.seo,
      content: { ...c, hero: { ...c.hero, tagline: "Draft tagline (preview only)" } },
    });
    expect(draft.status).toBe(200);
    const res = await bvReader.post(`/pages/${homeId}/preview`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { url } = CmsPreviewResponseSchema.parse(res.body);
    const token = url.split("/preview/")[1]!;
    const view = await pub(`/preview/${token}`);
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    const bundle = CmsPublicBundleSchema.parse(view.body);
    expect(bundle).toMatchObject({ preview: true, page: { revisionNumber: null } });
    expect((bundle.page.content as { hero: { tagline: string } }).hero.tagline).toBe(
      "Draft tagline (preview only)",
    );
    // The live page is unchanged.
    expect(
      (
        CmsPublicBundleSchema.parse((await pub("/page?path=/")).body).page.content as {
          hero: { tagline: string };
        }
      ).hero.tagline,
    ).not.toBe("Draft tagline (preview only)");
    expect((await lastAudit("cms.preview_issued"))?.actorUserId).toBe(bvReader.userId);
    // Another site's key, a forged, an expired or a too-long token: nothing.
    expectError(await pub(`/preview/${token}`, TEST_KEYS.webCorporate), 404, "NOT_FOUND");
    expectError(await pub(`/preview/${token.slice(0, -1)}0`), 404, "NOT_FOUND");
    expectError(await pub(`/preview/${forge(homeId, "BV", Date.now() - 1000)}`), 404, "NOT_FOUND");
    expectError(
      await pub(`/preview/${forge(homeId, "BV", Date.now() + 86_400_000)}`),
      404,
      "NOT_FOUND",
    );
    expect((await pub(`/preview/${forge(homeId, "BV", Date.now() + 60_000)}`)).status).toBe(200);
  });

  it("previews a fragment around the home page", async () => {
    const res = await bvEditor.post(`/pages/${navId}/preview`, {});
    const token = CmsPreviewResponseSchema.parse(res.body).url.split("/preview/")[1]!;
    const bundle = CmsPublicBundleSchema.parse((await pub(`/preview/${token}`)).body);
    expect(bundle.page.templateKey).toBe("bv.home");
    expect(bundle.fragments["bv.site-nav"]?.revisionNumber).toBeNull();
  });

  it("issues links only to readers of the page's site", async () => {
    expectError(await comEditor.post(`/pages/${homeId}/preview`, {}), 404, "NOT_FOUND");
    expectError(await nobody.post(`/pages/${homeId}/preview`, {}), 404, "NOT_FOUND");
  });
});

describe("10. publication rules in the database", () => {
  it("keeps revisions immutable and publications undeletable", async () => {
    const rev = await owner.cmsPageRevision.findFirstOrThrow({ where: { pageId: homeId } });
    await rejectsDb(
      owner.cmsPageRevision.update({ where: { id: rev.id }, data: { title: "x" } }),
      /published revision cannot be changed/,
    );
    await rejectsDb(
      owner.cmsPageRevision.delete({ where: { id: rev.id } }),
      /published revision cannot be changed/,
    );
    await rejectsDb(
      asApp.cmsPageRevision.update({ where: { id: rev.id }, data: { title: "x" } }),
      /permission denied/,
    );
    await rejectsDb(
      asApp.cmsPagePublication.delete({ where: { pageId: homeId } }),
      /permission denied/,
    );
  });

  it("refuses inconsistent publication state and revisions of another page or site", async () => {
    await rejectsDb(
      owner.cmsPagePublication.update({
        where: { pageId: homeId },
        data: { status: "UNPUBLISHED" },
      }),
      /CmsPagePublication_status_fields/,
    );
    const footerRev = await owner.cmsPageRevision.findFirstOrThrow({ where: { pageId: footerId } });
    await rejectsDb(
      owner.cmsPagePublication.update({
        where: { pageId: homeId },
        data: { revisionId: footerRev.id },
      }),
      /foreign key|CmsPagePublication_revisionId_pageId_fkey/i,
    );
    await rejectsDb(
      owner.cmsPageRevision.create({
        data: {
          pageId: homeId,
          siteId: COM,
          revisionNumber: 99,
          pageVersion: 1,
          title: "x",
          noindex: false,
          content: {},
          schemaVersion: 1,
          createdById: root.userId,
        },
      }),
      /foreign key|CmsPageRevision_pageId_siteId_fkey/i,
    );
  });
});

describe("11. template pages on the site (CMS S3)", () => {
  it("serves a published template page at its path, with fragments; drafts stay off the site", async () => {
    const created = await bvEditor.post(`/sites/${BV}/pages`, {
      title: "Energy trading",
      slug: "energy-trading",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const p = CmsPageResponseSchema.parse(created.body).page;
    const sections = [
      {
        id: "sec-hero-0001",
        type: "hero",
        eyebrow: "Services",
        title: "Energy trading",
        intro: "From Rotterdam.",
        cta: { label: "Contact", href: "/contact" },
      },
      { id: "sec-text-0001", type: "text", title: null, body: "One.\n\nTwo." },
      {
        id: "sec-cards-001",
        type: "cards",
        title: "Markets",
        intro: null,
        items: [{ title: "Base oils", description: null, link: null }],
      },
      {
        id: "sec-cta-00001",
        type: "cta",
        title: "Talk to us",
        text: null,
        button: { label: "Write", href: "mailto:info@example.com" },
      },
    ];
    const saved = await bvEditor.post(`/pages/${p.id}/draft`, {
      version: p.version,
      title: "Energy trading",
      slug: "energy-trading",
      seo: {
        title: "Energy trading | Dream Petroleum BV",
        description: "Trading desk.",
        noindex: true,
      },
      content: { sections },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const draft = CmsPageResponseSchema.parse(saved.body).page;
    expectError(await pub("/page?path=/energy-trading"), 404, "NOT_FOUND");

    const preview = await bvEditor.post(`/pages/${p.id}/preview`, {});
    const token = CmsPreviewResponseSchema.parse(preview.body).url.split("/preview/")[1]!;
    const pv = CmsPublicBundleSchema.parse((await pub(`/preview/${token}`)).body);
    expect(pv).toMatchObject({
      preview: true,
      page: { kind: "TEMPLATE", path: "/energy-trading", revisionNumber: null },
    });

    expect(
      (await bvPublisher.post(`/pages/${p.id}/publish`, { version: draft.version })).status,
    ).toBe(200);
    const live = CmsPublicBundleSchema.parse((await pub("/page?path=/energy-trading")).body);
    expect(live.page).toMatchObject({
      kind: "TEMPLATE",
      path: "/energy-trading",
      revisionNumber: 1,
      seo: {
        title: "Energy trading | Dream Petroleum BV",
        description: "Trading desk.",
        noindex: true,
      },
    });
    expect((live.page.content["sections"] as unknown[]).length).toBe(4);
    expect(live.fragments["bv.site-nav"]?.templateKey).toBe("bv.site-nav");
    // A fragment is never a page of its own; the Corporate site does not see BV pages.
    expectError(await pub("/page?path=/energy-trading", TEST_KEYS.webCorporate), 404, "NOT_FOUND");

    const after = CmsPageResponseSchema.parse((await page(p.id)).body).page;
    expect(
      (
        await bvPublisher.post(`/pages/${p.id}/unpublish`, {
          publicationVersion: after.publication!.version,
        })
      ).status,
    ).toBe(200);
    expectError(await pub("/page?path=/energy-trading"), 404, "NOT_FOUND");
  });
});
