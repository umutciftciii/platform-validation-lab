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
  CmsHistoryResponseSchema,
  CmsImportResponseSchema,
  CmsPreviewResponseSchema,
  CmsPublicBundleSchema,
  CmsPublicNewsSchema,
  cmsFieldsSchema,
  CmsPageListResponseSchema,
  CmsPageResponseSchema,
  ErrorBodySchema,
  PublicSeoResolveResponseSchema,
  PublicSiteSeoResponseSchema,
  PublicSitemapResponseSchema,
  SeoOverviewResponseSchema,
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
    // DP-209: a request without the canonical and Open Graph fields stores them as null.
    expect(page.seo).toEqual({
      title: "About Dream Petroleum BV",
      description: "Who we are.",
      noindex: true,
      canonicalPath: null,
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
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
    // Change the last signature character; a fixed "0" left the token unchanged when it ended in 0.
    const tampered = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
    expectError(await pub(`/preview/${tampered}`), 404, "NOT_FOUND");
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

describe("12. content pages from code (DP-135)", () => {
  it("imports a content page as a TEMPLATE draft with its SEO, and never over a page at that path", async () => {
    const dry = await bvEditor.post(`/sites/${BV}/import`, {
      key: "bv.storage-distribution",
      dryRun: true,
    });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(CmsImportResponseSchema.parse(dry.body).summary).toEqual([
      { field: "sections", items: 5 },
    ]);

    const res = await bvEditor.post(`/sites/${BV}/import`, {
      key: "bv.storage-distribution",
      dryRun: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const id = CmsImportResponseSchema.parse(res.body).pageId!;
    const imported = CmsPageResponseSchema.parse((await page(id)).body).page;
    expect(imported).toMatchObject({
      kind: "TEMPLATE",
      templateKey: "standard",
      path: "/storage-distribution",
      title: "Storage & Distribution",
      seo: {
        title: "Storage & Distribution | Dream Petroleum BV",
        description: null,
        noindex: false,
      },
      publication: null,
    });
    const sections = imported.content["sections"] as { type: string }[];
    expect(sections.map((s) => s.type)).toEqual(["split", "specList", "cards", "specList", "cta"]);
    expect((await lastAudit("cms.page_imported"))?.metadata).toMatchObject({
      templateKey: "bv.storage-distribution",
    });

    expectError(
      await bvEditor.post(`/sites/${BV}/import`, { key: "bv.storage-distribution", dryRun: true }),
      409,
      "CONFLICT_STATE",
      { path: "key", rule: "already_imported" },
    );
    // /energy-trading was made by hand above: the import leaves that page alone.
    expectError(
      await bvEditor.post(`/sites/${BV}/import`, { key: "bv.energy-trading", dryRun: false }),
      409,
      "CONFLICT_STATE",
      { path: "key", rule: "already_imported" },
    );
  });

  it("refuses unknown keys and BV pages on the Corporate site", async () => {
    expectError(
      await bvEditor.post(`/sites/${BV}/import`, { key: "bv.no-such-page", dryRun: true }),
      400,
      "VALIDATION_FAILED",
      { path: "key", rule: "unknown_template" },
    );
    expectError(
      await comEditor.post(`/sites/${COM}/import`, {
        key: "bv.news-oil-prices-us-iran",
        dryRun: true,
      }),
      400,
      "VALIDATION_FAILED",
      { path: "key", rule: "unknown_template" },
    );
    expectError(
      await comEditor.post(`/sites/${COM}/import`, { key: "bv.about-us", dryRun: true }),
      400,
      "VALIDATION_FAILED",
      { path: "key", rule: "unknown_template" },
    );
  });
});

describe("13. news articles (DP-020)", () => {
  const COVER = "/media/services-showcase/logistics-desktop.webp";
  const body = (version: number, slug: string, over: Record<string, unknown> = {}) => ({
    version,
    title: `Article ${slug}`,
    slug,
    seo: { title: null, description: "About the markets.", noindex: false },
    content: {
      excerpt: `Summary of ${slug}.`,
      coverImage: COVER,
      coverAlt: "Tank terminal at dusk",
      sections: [{ id: "sec-text-0001", type: "text", title: null, body: "One.\n\nTwo." }],
      ...over,
    },
  });
  async function create(slug: string) {
    const res = await bvEditor.post(`/sites/${BV}/pages`, {
      title: `Article ${slug}`,
      slug,
      template: "article",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return CmsPageResponseSchema.parse(res.body).page;
  }
  async function save(id: string, version: number, slug: string, over = {}) {
    return bvEditor.post(`/pages/${id}/draft`, body(version, slug, over));
  }

  it("keeps article paths under /news/ and /news itself away from template pages (CHECK)", async () => {
    const article = await row({ templateKey: "article", path: "/news/probe-article" });
    expect(article.path).toBe("/news/probe-article");
    await rejectsDb(row({ path: "/news" }), /CmsPage_template_path/);
    await rejectsDb(row({ path: "/news/x" }), /CmsPage_path_format/);
    await rejectsDb(row({ templateKey: "article", path: "/x" }), /CmsPage_template_path/);
    await rejectsDb(row({ templateKey: "article", path: "/news/A" }), /CmsPage_path_format/);
    await rejectsDb(row({ templateKey: "article", path: "/news/a/b" }), /CmsPage_path_format/);
    expectError(
      await bvEditor.post(`/sites/${BV}/pages`, { title: "News", slug: "news" }),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("creates an article draft at /news/<slug>, audited, and lists it with the pages", async () => {
    const a = await create("market-update");
    expect(a).toMatchObject({
      kind: "TEMPLATE",
      templateKey: "article",
      path: "/news/market-update",
      slug: "market-update",
      content: { excerpt: "", coverImage: null, coverAlt: null, sections: [] },
      publication: null,
    });
    expect((await lastAudit("cms.page_created"))?.metadata).toMatchObject({
      templateKey: "article",
      path: "/news/market-update",
    });
    // The same slug as a page is fine: articles live under /news/.
    expect((await create("about-us-news")).path).toBe("/news/about-us-news");
    expectError(
      await bvEditor.post(`/sites/${BV}/pages`, {
        title: "Dup",
        slug: "market-update",
        template: "article",
      }),
      409,
      "CONFLICT_STATE",
      { path: "slug", rule: "unique" },
    );
    expectError(
      await bvReader.post(`/sites/${BV}/pages`, { title: "X", slug: "x", template: "article" }),
      403,
      "FORBIDDEN",
    );
    const list = CmsPageListResponseSchema.parse((await bvEditor.get(`/sites/${BV}/pages`)).body);
    expect(list.items.some((p) => p.path === "/news/market-update")).toBe(true);
  });

  it("validates the article fields and allows only body section types", async () => {
    const a = await create("validation-check");
    expectError(
      await save(a.id, a.version, "validation-check", { excerpt: "" }),
      400,
      "VALIDATION_FAILED",
      {
        path: "content.excerpt",
        rule: "too_small",
      },
    );
    expectError(
      await save(a.id, a.version, "validation-check", { coverAlt: null }),
      400,
      "VALIDATION_FAILED",
      { path: "content.coverAlt", rule: "custom" },
    );
    expectError(
      await save(a.id, a.version, "validation-check", { coverImage: "https://evil.test/x.png" }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await save(a.id, a.version, "validation-check", {
        sections: [{ id: "sec-hero-0001", type: "hero", title: "No hero in articles" }],
      }),
      400,
      "VALIDATION_FAILED",
    );
    // No cover is fine: both cover fields are null.
    const ok = await save(a.id, a.version, "validation-check", { coverImage: "", coverAlt: "" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(CmsPageResponseSchema.parse(ok.body).page.content).toMatchObject({
      coverImage: null,
      coverAlt: null,
    });
  });

  it("publishes only complete articles; the site lists them newest first by first publication", async () => {
    const empty = await create("empty-article");
    expectError(
      await bvPublisher.post(`/pages/${empty.id}/publish`, { version: empty.version }),
      409,
      "CONFLICT_STATE",
      { path: "content", rule: "article_incomplete" },
    );

    const before = CmsPublicNewsSchema.parse((await pub("/news")).body);
    expect(before.articles).toEqual([]);
    // DP-153: no list heading until bv.news-index is imported and published.
    expect(before.page).toBeNull();

    const older = await create("older-article");
    const olderSaved = CmsPageResponseSchema.parse(
      (await save(older.id, older.version, "older-article")).body,
    ).page;
    expect(
      (await bvPublisher.post(`/pages/${older.id}/publish`, { version: olderSaved.version }))
        .status,
    ).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    const newer = await create("newer-article");
    const newerSaved = CmsPageResponseSchema.parse(
      (await save(newer.id, newer.version, "newer-article", { coverImage: null, coverAlt: null }))
        .body,
    ).page;
    expect(
      (await bvPublisher.post(`/pages/${newer.id}/publish`, { version: newerSaved.version }))
        .status,
    ).toBe(200);

    // Republishing a correction of the older article does not move it up the list.
    const corrected = CmsPageResponseSchema.parse(
      (
        await save(older.id, olderSaved.version, "older-article", {
          excerpt: "Corrected summary.",
        })
      ).body,
    ).page;
    expect(
      (await bvPublisher.post(`/pages/${older.id}/publish`, { version: corrected.version })).status,
    ).toBe(200);

    const news = CmsPublicNewsSchema.parse((await pub("/news")).body);
    expect(news.articles.map((x) => x.slug)).toEqual(["newer-article", "older-article"]);
    expect(news.articles[1]).toMatchObject({
      path: "/news/older-article",
      title: "Article older-article",
      excerpt: "Corrected summary.",
      coverImage: COVER,
      coverAlt: "Tank terminal at dusk",
    });
    expect(news.articles[1]!.firstPublishedAt < news.articles[1]!.publishedAt).toBe(true);
    expect(news.articles[0]).toMatchObject({ coverImage: null, coverAlt: null });
    expect(news.fragments).toHaveProperty("bv.site-nav");
    // Drafts and other sites never show.
    expect(news.articles.some((x) => x.slug === "market-update")).toBe(false);
    expect(
      CmsPublicNewsSchema.parse((await pub("/news", TEST_KEYS.webCorporate)).body).articles,
    ).toEqual([]);
    expect((await fetch(`${base}/api/v1/public/cms/news`)).status).toBe(404);

    const live = CmsPublicBundleSchema.parse((await pub("/page?path=/news/older-article")).body);
    expect(live.page).toMatchObject({
      templateKey: "article",
      path: "/news/older-article",
      revisionNumber: 2,
      firstPublishedAt: news.articles[1]!.firstPublishedAt,
      seo: { description: "About the markets.", noindex: false },
    });
  });

  it("manages the list heading as the designed page bv.news-index at /news (DP-153)", async () => {
    const res = await bvEditor.post(`/sites/${BV}/import`, { key: "bv.news-index", dryRun: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const id = CmsImportResponseSchema.parse(res.body).pageId!;
    const imported = CmsPageResponseSchema.parse((await page(id)).body).page;
    expect(imported).toMatchObject({
      kind: "DESIGN",
      templateKey: "bv.news-index",
      path: "/news",
      publication: null,
    });
    expect(imported.content).toMatchObject({ eyebrow: "News", title: "News and insights" });
    // A draft never reaches the site.
    expect(CmsPublicNewsSchema.parse((await pub("/news")).body).page).toBeNull();

    // Editor changes the heading; the template refuses an empty heading.
    const content = { ...(imported.content as Record<string, unknown>) };
    const draft = (version: number, over: Record<string, unknown>) =>
      bvEditor.post(`/pages/${id}/draft`, {
        version,
        title: "News",
        seo: { title: "News · Dream Petroleum BV", description: "Market notes.", noindex: false },
        content: { ...content, ...over },
      });
    expectError(await draft(imported.version, { title: "" }), 400, "VALIDATION_FAILED");
    const saved = CmsPageResponseSchema.parse(
      (await draft(imported.version, { title: "Market notes" })).body,
    ).page;

    // Preview shows the draft heading before the first publication.
    const preview = await bvEditor.post(`/pages/${id}/preview`, {});
    const token = CmsPreviewResponseSchema.parse(preview.body).url.split("/preview/")[1]!;
    expect(CmsPublicBundleSchema.parse((await pub(`/preview/${token}`)).body).page).toMatchObject({
      templateKey: "bv.news-index",
      path: "/news",
      content: { title: "Market notes" },
    });

    expect(
      (await bvPublisher.post(`/pages/${id}/publish`, { version: saved.version })).status,
    ).toBe(200);
    const news = CmsPublicNewsSchema.parse((await pub("/news")).body);
    expect(news.page).toMatchObject({
      kind: "DESIGN",
      templateKey: "bv.news-index",
      revisionNumber: 1,
      seo: { title: "News · Dream Petroleum BV", description: "Market notes." },
      content: { eyebrow: "News", title: "Market notes" },
    });
    // The other site has no heading of its own.
    expect(
      CmsPublicNewsSchema.parse((await pub("/news", TEST_KEYS.webCorporate)).body).page,
    ).toBeNull();
  });

  it("previews an article draft and says when a published article was taken off the site", async () => {
    const a = await create("to-be-removed");
    const saved = CmsPageResponseSchema.parse(
      (await save(a.id, a.version, "to-be-removed")).body,
    ).page;
    const preview = await bvEditor.post(`/pages/${a.id}/preview`, {});
    const token = CmsPreviewResponseSchema.parse(preview.body).url.split("/preview/")[1]!;
    expect(CmsPublicBundleSchema.parse((await pub(`/preview/${token}`)).body).page).toMatchObject({
      templateKey: "article",
      path: "/news/to-be-removed",
      revisionNumber: null,
      firstPublishedAt: null,
    });

    expectError(await pub("/page?path=/news/to-be-removed"), 404, "NOT_FOUND");
    expect((await pub("/page?path=/news/to-be-removed")).body.error.details).toEqual([]);
    await bvPublisher.post(`/pages/${a.id}/publish`, { version: saved.version });
    const live = CmsPageResponseSchema.parse((await page(a.id)).body).page;
    expect(
      (
        await bvPublisher.post(`/pages/${a.id}/unpublish`, {
          publicationVersion: live.publication!.version,
        })
      ).status,
    ).toBe(200);
    expectError(await pub("/page?path=/news/to-be-removed"), 404, "NOT_FOUND", {
      path: "path",
      rule: "unpublished",
    });
    expect(
      CmsPublicNewsSchema.parse((await pub("/news")).body).articles.some(
        (x) => x.slug === "to-be-removed",
      ),
    ).toBe(false);
    expectError(await pub("/page?path=/news/never-existed"), 404, "NOT_FOUND");
    expectError(await pub("/page?path=/news/Bad"), 404, "NOT_FOUND");
  });

  it("lists the publication history and restores a revision into the draft", async () => {
    const a = await create("history-article");
    let p = CmsPageResponseSchema.parse((await save(a.id, a.version, "history-article")).body).page;
    expect(
      CmsHistoryResponseSchema.parse((await bvReader.get(`/pages/${a.id}/history`)).body),
    ).toEqual({
      revisions: [],
    });
    await bvPublisher.post(`/pages/${a.id}/publish`, { version: p.version });
    p = CmsPageResponseSchema.parse(
      (await save(a.id, p.version, "history-article", { excerpt: "Second version." })).body,
    ).page;
    await bvPublisher.post(`/pages/${a.id}/publish`, { version: p.version });
    p = CmsPageResponseSchema.parse(
      (await save(a.id, p.version, "history-article", { excerpt: "Unpublished draft." })).body,
    ).page;

    const history = CmsHistoryResponseSchema.parse(
      (await bvReader.get(`/pages/${a.id}/history`)).body,
    );
    expect(history.revisions.map((r) => [r.revisionNumber, r.live])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(history.revisions[0]).toMatchObject({
      title: "Article history-article",
      path: "/news/history-article",
      publishedBy: { id: bvPublisher.userId },
    });

    // Restoring needs content:edit and the current draft version.
    expectError(
      await bvReader.post(`/pages/${a.id}/restore`, { version: p.version, revisionNumber: 1 }),
      404,
      "NOT_FOUND",
    );
    expectError(
      await bvEditor.post(`/pages/${a.id}/restore`, { version: p.version - 1, revisionNumber: 1 }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    expectError(
      await bvEditor.post(`/pages/${a.id}/restore`, { version: p.version, revisionNumber: 9 }),
      404,
      "NOT_FOUND",
    );
    const restored = await bvEditor.post(`/pages/${a.id}/restore`, {
      version: p.version,
      revisionNumber: 1,
    });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    const r = CmsPageResponseSchema.parse(restored.body).page;
    expect(r.version).toBe(p.version + 1);
    expect(r.content["excerpt"]).toBe("Summary of history-article.");
    // The site still shows revision 2 until the restored draft is published.
    expect(
      CmsPublicBundleSchema.parse((await pub("/page?path=/news/history-article")).body).page
        .content["excerpt"],
    ).toBe("Second version.");
    expect((await lastAudit("cms.page_revision_restored"))?.metadata).toMatchObject({
      revisionNumber: 1,
      changed: ["content"],
      version: p.version + 1,
    });
    // History of a page outside the caller's sites: not found.
    expectError(await comEditor.get(`/pages/${a.id}/history`), 404, "NOT_FOUND");
  });
});

describe("14. company pages and the blog post of the live site (DP-206)", () => {
  const ARTICLE =
    "/news/why-are-oil-prices-falling-the-impact-of-the-us-iran-agreement-on-energy-markets";
  const KEYS = [
    ["bv.strategic-partnership", "/strategic-partnership", "standard"],
    ["bv.sustainability", "/sustainability", "standard"],
    ["bv.our-team", "/our-team", "standard"],
    ["bv.news-oil-prices-us-iran", ARTICLE, "article"],
  ] as const;

  it("imports the four as drafts once, publishes them and a second run creates nothing", async () => {
    const ids: string[] = [];
    for (const [key, path, templateKey] of KEYS) {
      const dry = await bvEditor.post(`/sites/${BV}/import`, { key, dryRun: true });
      expect(dry.status, `${key} ${JSON.stringify(dry.body)}`).toBe(200);
      const res = await bvEditor.post(`/sites/${BV}/import`, { key, dryRun: false });
      expect(res.status, `${key} ${JSON.stringify(res.body)}`).toBe(200);
      const id = CmsImportResponseSchema.parse(res.body).pageId!;
      const imported = CmsPageResponseSchema.parse((await page(id)).body).page;
      expect(imported).toMatchObject({ kind: "TEMPLATE", templateKey, path, publication: null });
      ids.push(id);
    }
    // A draft never reaches the site.
    expectError(await pub("/page?path=/our-team"), 404, "NOT_FOUND");

    const team = CmsPageResponseSchema.parse((await page(ids[2]!)).body).page;
    expect(team.title).toBe("Our Leadership Team");
    expect((team.content["sections"] as { type: string }[]).map((x) => x.type)).toEqual([
      "hero",
      "split",
      "specList",
      "cta",
    ]);
    const article = CmsPageResponseSchema.parse((await page(ids[3]!)).body).page;
    expect(article).toMatchObject({
      title: "Why Are Oil Prices Falling? The Impact Of The US-Iran Agreement On Energy Markets",
      seo: { title: "Why Are Oil Prices Falling? | Dream Petroleum BV", description: null },
      content: {
        coverImage: "/media/news/why-are-oil-prices-falling.jpg",
        excerpt: expect.stringMatching(/^An in-depth analysis of how the recent geopolitical/),
      },
    });

    for (const id of ids) {
      const draft = CmsPageResponseSchema.parse((await page(id)).body).page;
      const res = await bvPublisher.post(`/pages/${id}/publish`, { version: draft.version });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    for (const [, path] of KEYS) {
      const live = CmsPublicBundleSchema.parse((await pub(`/page?path=${path}`)).body);
      expect(live.page).toMatchObject({ path, revisionNumber: 1 });
    }
    const news = CmsPublicNewsSchema.parse((await pub("/news")).body);
    expect(news.articles[0]).toMatchObject({
      path: ARTICLE,
      coverImage: "/media/news/why-are-oil-prices-falling.jpg",
    });

    // Repeatable: every key answers already_imported, nothing new is created.
    const count = await owner.cmsPage.count();
    for (const [key] of KEYS) {
      for (const dryRun of [true, false]) {
        expectError(
          await bvEditor.post(`/sites/${BV}/import`, { key, dryRun }),
          409,
          "CONFLICT_STATE",
          { path: "key", rule: "already_imported" },
        );
      }
    }
    expect(await owner.cmsPage.count()).toBe(count);
  });
});

// ---------------------------------------------------------------------------------------------
// DP-207: technical SEO reads (existence check before rendering, sitemap)
// ---------------------------------------------------------------------------------------------

describe("15. technical SEO reads (DP-207)", () => {
  const ARTICLE =
    "/news/why-are-oil-prices-falling-the-impact-of-the-us-iran-agreement-on-energy-markets";
  async function seo(p: string, key: string = TEST_KEYS.webBv): Promise<Res> {
    return parse(
      await fetch(`${base}/api/v1/public/seo${p}`, {
        headers: { "x-dp-proxy-key": key, "x-dp-client-ip": "10.20.30.42" },
      }),
    );
  }
  const resolve = (p: string, key?: string) => seo(`/resolve?path=${encodeURIComponent(p)}`, key);
  const sitemap = async () =>
    PublicSitemapResponseSchema.parse((await seo("/sitemap")).body).entries.map((e) => e.path);

  /** A TEMPLATE page at /<slug>, published (optionally with noindex). */
  async function livePage(slug: string, noindex = false) {
    const created = await bvEditor.post(`/sites/${BV}/pages`, { title: `SEO ${slug}`, slug });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const p = CmsPageResponseSchema.parse(created.body).page;
    const saved = await bvEditor.post(`/pages/${p.id}/draft`, {
      version: p.version,
      title: `SEO ${slug}`,
      slug,
      seo: { title: null, description: null, noindex },
      content: { sections: [HERO] },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const draft = CmsPageResponseSchema.parse(saved.body).page;
    expect(
      (await bvPublisher.post(`/pages/${p.id}/publish`, { version: draft.version })).status,
    ).toBe(200);
    return p.id;
  }

  it("resolves the live pages, articles and home of the key's site only", async () => {
    for (const [p, kind] of [
      ["/", "home"],
      ["/our-team", "page"],
      ["/sustainability", "page"],
      [ARTICLE, "article"],
    ] as const) {
      const res = await resolve(p);
      expect(res.status, `${p} ${JSON.stringify(res.body)}`).toBe(200);
      expect(PublicSeoResolveResponseSchema.parse(res.body)).toEqual({ path: p, kind });
    }
    // The Corporate key never sees BV content; the admin key and no key have no public routes.
    expectError(await resolve("/our-team", TEST_KEYS.webCorporate), 404, "NOT_FOUND");
    expect((await resolve("/our-team", TEST_KEYS.admin)).status).toBe(404);
    expect((await fetch(`${base}/api/v1/public/seo/resolve?path=/our-team`)).status).toBe(404);
  });

  it("answers 404 for unknown, draft and malformed addresses", async () => {
    const created = await bvEditor.post(`/sites/${BV}/pages`, {
      title: "SEO draft",
      slug: "seo-draft",
    });
    expect(created.status).toBe(201);
    for (const p of [
      "/seo-draft",
      "/nope",
      "/news/nope",
      "/products/nope",
      "/About-Us",
      "/a/b",
      "/news/a/b",
      "/../our-team",
      "/our-team/",
      "our-team",
      "",
    ]) {
      expectError(await resolve(p), 404, "NOT_FOUND");
    }
    expectError(await seo("/resolve"), 404, "NOT_FOUND");
  });

  it("an unpublished page answers 404 with `unpublished`, and leaves the sitemap", async () => {
    const id = await livePage("seo-off");
    expect((await resolve("/seo-off")).status).toBe(200);
    expect(await sitemap()).toContain("/seo-off");
    const after = CmsPageResponseSchema.parse((await page(id)).body).page;
    const off = await bvPublisher.post(`/pages/${id}/unpublish`, {
      publicationVersion: after.publication!.version,
    });
    expect(off.status).toBe(200);
    expectError(await resolve("/seo-off"), 404, "NOT_FOUND", { path: "path", rule: "unpublished" });
    expect(await sitemap()).not.toContain("/seo-off");
  });

  it("lists only indexable live addresses in the sitemap, once each", async () => {
    await livePage("seo-hidden", true);
    // noindex: the page is live (resolves) but never in the sitemap.
    expect((await resolve("/seo-hidden")).status).toBe(200);
    const res = await seo("/sitemap");
    expect(res.status).toBe(200);
    const entries = PublicSitemapResponseSchema.parse(res.body).entries;
    const paths = entries.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual(expect.arrayContaining(["/", "/products", "/our-team", ARTICLE]));
    for (const p of ["/seo-hidden", "/seo-draft", "/seo-off", "/nope"]) {
      expect(paths, p).not.toContain(p);
    }
    expect(entries.find((e) => e.path === ARTICLE)?.kind).toBe("article");
    // Every CMS entry is live; fragments (no path) never appear.
    for (const e of entries.filter((x) => x.kind === "page" || x.kind === "article")) {
      expect((await resolve(e.path)).status, e.path).toBe(200);
      expect(e.lastModified).not.toBeNull();
    }
    // The Corporate site has no BV address; the admin key has no sitemap.
    const com = PublicSitemapResponseSchema.parse(
      (await seo("/sitemap", TEST_KEYS.webCorporate)).body,
    );
    expect(com.entries.map((e) => e.path)).not.toContain("/our-team");
    expect((await seo("/sitemap", TEST_KEYS.admin)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------
// DP-209: admin-managed SEO — page SEO (canonical, Open Graph), draft/publish separation, site
// defaults (bv.site-seo), sitemap consistency, permissions, audit and versions
// ---------------------------------------------------------------------------------------------

describe("16. admin-managed SEO (DP-209)", () => {
  async function seoRead(p: string, key: string = TEST_KEYS.webBv): Promise<Res> {
    return parse(
      await fetch(`${base}/api/v1/public/seo${p}`, {
        headers: { "x-dp-proxy-key": key, "x-dp-client-ip": "10.20.30.43" },
      }),
    );
  }
  const sitemap = async () =>
    PublicSitemapResponseSchema.parse((await seoRead("/sitemap")).body).entries.map((e) => e.path);
  async function overview(as: Staff, siteId: string = BV, part?: string): Promise<Res> {
    const headers: Record<string, string> = {
      "x-dp-proxy-key": TEST_KEYS.admin,
      "x-dp-client-ip": "10.20.30.40",
      cookie: `__Host-dp_admin_session=${(as as unknown as { token: string }).token}`,
    };
    return parse(
      await fetch(
        `${base}/api/v1/admin/seo/sites/${siteId}/overview${part ? `?part=${part}` : ""}`,
        { headers },
      ),
    );
  }
  const FULL_SEO = {
    title: "Our SEO page | Dream Petroleum BV",
    description: "A page about SEO for the integration test, long enough to be a description.",
    noindex: false,
    canonicalPath: null,
    ogTitle: "Share title",
    ogDescription: "Share description",
    ogImage: "/media/ctl-technology/industrial-process.webp",
  };
  let id: string;
  let version: number;

  async function save(seo: Record<string, unknown>, as: Staff = bvEditor, v = version) {
    return as.post(`/pages/${id}/draft`, {
      version: v,
      title: "SEO admin page",
      slug: "seo-admin",
      seo,
      content: { sections: [HERO] },
    });
  }

  it("saves canonical and Open Graph fields with the draft and audits field names only", async () => {
    const created = await bvEditor.post(`/sites/${BV}/pages`, {
      title: "SEO admin page",
      slug: "seo-admin",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const p = CmsPageResponseSchema.parse(created.body).page;
    id = p.id;
    version = p.version;
    const res = await save(FULL_SEO);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const saved = CmsPageResponseSchema.parse(res.body).page;
    expect(saved.seo).toEqual(FULL_SEO);
    version = saved.version;
    const audit = await lastAudit("cms.page_draft_saved");
    const meta = audit?.metadata as { changed: string[] };
    expect(meta.changed).toEqual(
      expect.arrayContaining(["seoTitle", "seoDescription", "ogTitle", "ogDescription", "ogImage"]),
    );
    expect(JSON.stringify(audit?.metadata)).not.toContain("Share title");
  });

  it("refuses unsafe canonical addresses and unregistered images (400), stored nothing", async () => {
    for (const canonicalPath of [
      "https://evil.example/x",
      "//evil.example/x",
      "javascript:alert(1)",
      "/About",
      "/api/v1/x",
      "/preview/abc",
      "/a/b/c/d",
      "/x?y=1",
      "/x#y",
    ]) {
      const res = await save({ ...FULL_SEO, canonicalPath });
      expectError(res, 400, "VALIDATION_FAILED", { path: "seo.canonicalPath", rule: "custom" });
    }
    expectError(
      await save({ ...FULL_SEO, ogImage: "https://evil.example/a.png" }),
      400,
      "VALIDATION_FAILED",
      { path: "seo.ogImage", rule: "custom" },
    );
    const now = CmsPageResponseSchema.parse((await page(id)).body).page;
    expect(now.version).toBe(version);
    expect(now.seo.canonicalPath).toBeNull();
    // The database refuses the same values directly.
    await rejectsDb(
      owner.cmsPage.update({ where: { id }, data: { canonicalPath: "https://evil.example" } }),
      /CmsPage_seo_canonical_path/,
    );
    await rejectsDb(
      owner.cmsPage.update({ where: { id }, data: { ogImage: "javascript:x" } }),
      /CmsPage_seo_og_image/,
    );
    await rejectsDb(
      owner.cmsPage.update({ where: { id }, data: { ogTitle: " padded " } }),
      /CmsPage_seo_og_trimmed/,
    );
  });

  it("keeps the published SEO until the next publication (draft/publish separation)", async () => {
    let p = CmsPageResponseSchema.parse((await page(id)).body).page;
    expect((await bvPublisher.post(`/pages/${id}/publish`, { version: p.version })).status).toBe(
      200,
    );
    const live1 = CmsPublicBundleSchema.parse((await pub("/page?path=/seo-admin")).body).page;
    expect(live1.seo).toMatchObject({ ogTitle: "Share title", canonicalPath: null });
    // A later draft change is not public.
    const res = await save(
      { ...FULL_SEO, ogTitle: "Draft share title", noindex: true },
      bvEditor,
      p.version,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    version = CmsPageResponseSchema.parse(res.body).page.version;
    const live2 = CmsPublicBundleSchema.parse((await pub("/page?path=/seo-admin")).body).page;
    expect(live2.seo).toMatchObject({ ogTitle: "Share title", noindex: false });
    expect(await sitemap()).toContain("/seo-admin");
    // The overview says the draft differs from what the site shows.
    const o = SeoOverviewResponseSchema.parse((await overview(bvEditor)).body);
    expect(o.items.find((i) => i.id === id)).toMatchObject({
      live: true,
      pendingChanges: true,
      inSitemap: true,
      noindex: true,
    });
    // Published: noindex reaches the page and the sitemap at once.
    p = CmsPageResponseSchema.parse((await page(id)).body).page;
    expect((await bvPublisher.post(`/pages/${id}/publish`, { version: p.version })).status).toBe(
      200,
    );
    const live3 = CmsPublicBundleSchema.parse((await pub("/page?path=/seo-admin")).body).page;
    expect(live3.seo).toMatchObject({ ogTitle: "Draft share title", noindex: true });
    expect(await sitemap()).not.toContain("/seo-admin");
    // The revision is immutable, the DP-209 columns included.
    const rev = await owner.cmsPageRevision.findFirstOrThrow({
      where: { pageId: id },
      orderBy: { revisionNumber: "desc" },
    });
    expect(rev.ogTitle).toBe("Draft share title");
    await rejectsDb(
      owner.cmsPageRevision.update({ where: { id: rev.id }, data: { ogTitle: "x" } }),
      /published revision cannot be changed/,
    );
  });

  it("leaves a page whose canonical names another address out of the sitemap", async () => {
    let p = CmsPageResponseSchema.parse((await page(id)).body).page;
    const res = await save({ ...FULL_SEO, canonicalPath: "/our-team" }, bvEditor, p.version);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    p = CmsPageResponseSchema.parse(res.body).page;
    expect((await bvPublisher.post(`/pages/${id}/publish`, { version: p.version })).status).toBe(
      200,
    );
    expect((await seoRead(`/resolve?path=/seo-admin`)).status).toBe(200);
    const paths = await sitemap();
    expect(paths).not.toContain("/seo-admin");
    expect(paths).toContain("/our-team");
    // Its own address as canonical counts as no override.
    const self = await save({ ...FULL_SEO, canonicalPath: "/seo-admin" }, bvEditor, p.version);
    p = CmsPageResponseSchema.parse(self.body).page;
    expect((await bvPublisher.post(`/pages/${id}/publish`, { version: p.version })).status).toBe(
      200,
    );
    expect(await sitemap()).toContain("/seo-admin");
    version = p.version;
  });

  it("restores the SEO of a revision with the rest of the draft", async () => {
    const history = CmsHistoryResponseSchema.parse(
      (await bvEditor.get(`/pages/${id}/history`)).body,
    );
    const first = history.revisions.at(-1)!;
    const res = await bvEditor.post(`/pages/${id}/restore`, {
      version,
      revisionNumber: first.revisionNumber,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const p = CmsPageResponseSchema.parse(res.body).page;
    expect(p.seo).toMatchObject({ ogTitle: "Share title", noindex: false, canonicalPath: null });
    version = p.version;
  });

  it("refuses stale versions and editors without content:edit on the site", async () => {
    expectError(await save(FULL_SEO, bvEditor, version - 1), 409, "CONFLICT_STATE", {
      path: "version",
      rule: "stale",
    });
    expect((await save(FULL_SEO, bvReader)).status).toBe(404);
    expect((await save(FULL_SEO, bvPublisher)).status).toBe(404);
    expect((await save(FULL_SEO, comEditor)).status).toBe(404);
    const now = CmsPageResponseSchema.parse((await page(id)).body).page;
    expect(now.version).toBe(version);
  });

  it("site defaults: built-in until bv.site-seo is published, then the published values", async () => {
    const none = PublicSiteSeoResponseSchema.parse((await seoRead("/settings")).body);
    expect(none).toEqual({ settings: null, publishedAt: null });
    const imported = await bvEditor.post(`/sites/${BV}/import`, {
      key: "bv.site-seo",
      dryRun: false,
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    const fragmentId = CmsImportResponseSchema.parse(imported.body).pageId!;
    let f = CmsPageResponseSchema.parse((await page(fragmentId)).body).page;
    expect(f).toMatchObject({ kind: "FRAGMENT", templateKey: "bv.site-seo", path: null });
    // The draft is not public.
    expect(
      PublicSiteSeoResponseSchema.parse((await seoRead("/settings")).body).settings,
    ).toBeNull();
    const saved = await bvEditor.post(`/pages/${fragmentId}/draft`, {
      version: f.version,
      title: f.title,
      seo: { title: null, description: null, noindex: false },
      content: {
        siteName: "Dream Petroleum B.V.",
        defaultTitle: "Dream Petroleum B.V. — base oils",
        defaultDescription: "Base oils, white oils and solvents.",
        defaultOgImage: "/media/ctl-technology/industrial-process.webp",
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    f = CmsPageResponseSchema.parse(saved.body).page;
    // An unregistered image is refused like any asset field.
    expectError(
      await bvEditor.post(`/pages/${fragmentId}/draft`, {
        version: f.version,
        title: f.title,
        seo: { title: null, description: null, noindex: false },
        content: { ...f.content, defaultOgImage: "https://evil.example/x.png" },
      }),
      400,
      "VALIDATION_FAILED",
    );
    expect(
      (await bvPublisher.post(`/pages/${fragmentId}/publish`, { version: f.version })).status,
    ).toBe(200);
    const live = PublicSiteSeoResponseSchema.parse((await seoRead("/settings")).body);
    expect(live.settings).toEqual({
      siteName: "Dream Petroleum B.V.",
      defaultTitle: "Dream Petroleum B.V. — base oils",
      defaultDescription: "Base oils, white oils and solvents.",
      defaultOgImage: "/media/ctl-technology/industrial-process.webp",
    });
    expect(live.publishedAt).not.toBeNull();
    // A fragment is never a sitemap address; the Corporate key has no BV defaults.
    expect(await sitemap()).not.toContain(null);
    expect(
      PublicSiteSeoResponseSchema.parse((await seoRead("/settings", TEST_KEYS.webCorporate)).body)
        .settings,
    ).toBeNull();
    expect((await seoRead("/settings", TEST_KEYS.admin)).status).toBe(404);
    // The overview shows the defaults and the live values.
    const o = SeoOverviewResponseSchema.parse((await overview(bvEditor)).body);
    expect(o.settings).toMatchObject({
      pageId: fragmentId,
      published: true,
      pendingChanges: false,
    });
    expect(o.liveSettings?.siteName).toBe("Dream Petroleum B.V.");
    const part = SeoOverviewResponseSchema.parse((await overview(bvEditor, BV, "settings")).body);
    expect(part.items).toEqual([]);
    expect(part.liveSettings?.siteName).toBe("Dream Petroleum B.V.");
  });

  it("overview: content readers see pages, others are refused or see their own site only", async () => {
    const reader = SeoOverviewResponseSchema.parse((await overview(bvReader)).body);
    expect(reader.permissions).toMatchObject({ readPages: true, editPages: false });
    expect(reader.items.some((i) => i.path === "/our-team")).toBe(true);
    expect(reader.items.every((i) => i.kind !== undefined)).toBe(true);
    expectError(await overview(nobody), 403, "FORBIDDEN");
    expectError(await overview(comEditor), 403, "FORBIDDEN");
    const audit = await lastAudit("cms.access_denied");
    expect(audit).toMatchObject({ resourceType: "seo_overview", outcome: "DENIED" });
  });
});

// ---------------------------------------------------------------------------------------------
// DP-210: slug changes keep the old address (automatic 301, no chain, no loop), redirect table
// rules, draft/publish separation, address reuse, concurrent publications, 404 regression
// ---------------------------------------------------------------------------------------------

describe("17. slug changes and automatic 301 (DP-210)", () => {
  let comPublisher: Staff;
  async function seo(p: string, key: string = TEST_KEYS.webBv): Promise<Res> {
    return parse(
      await fetch(`${base}/api/v1/public/seo${p}`, {
        headers: { "x-dp-proxy-key": key, "x-dp-client-ip": "10.20.30.44" },
      }),
    );
  }
  const resolve = (p: string, key?: string) => seo(`/resolve?path=${encodeURIComponent(p)}`, key);
  const sitemap = async () =>
    PublicSitemapResponseSchema.parse((await seo("/sitemap")).body).entries.map((e) => e.path);
  async function expectLive(p: string) {
    const res = await resolve(p);
    expect(res.status, `${p} ${JSON.stringify(res.body)}`).toBe(200);
    expect(PublicSeoResolveResponseSchema.parse(res.body)).toMatchObject({ path: p });
    expect(res.body.redirect, p).toBeUndefined();
  }
  async function expectRedirect(p: string, target: string) {
    const res = await resolve(p);
    expect(res.status, `${p} ${JSON.stringify(res.body)}`).toBe(200);
    expect(PublicSeoResolveResponseSchema.parse(res.body)).toEqual({
      path: p,
      redirect: { target, statusCode: 301 },
    });
  }
  const pageOf = async (id: string) => CmsPageResponseSchema.parse((await page(id)).body).page;
  async function create(slug: string, as: Staff = bvEditor, site = BV, article = false) {
    const res = await as.post(`/sites/${site}/pages`, {
      title: `DP-210 ${slug}`,
      slug,
      ...(article ? { template: "article" } : {}),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return CmsPageResponseSchema.parse(res.body).page.id;
  }
  async function setSlug(id: string, slug: string, as: Staff = bvEditor): Promise<Res> {
    const p = CmsPageResponseSchema.parse((await as.get(`/pages/${id}`)).body).page;
    const article = p.templateKey === "article";
    return as.post(`/pages/${id}/draft`, {
      version: p.version,
      title: p.title,
      slug,
      seo: SEO,
      content: article
        ? {
            excerpt: "Summary.",
            coverImage: null,
            coverAlt: null,
            sections: [{ id: "sec-text-0001", type: "text", title: null, body: "Body." }],
          }
        : { sections: [HERO] },
    });
  }
  async function publish(id: string, as: Staff = bvPublisher): Promise<Res> {
    const p = CmsPageResponseSchema.parse((await as.get(`/pages/${id}`)).body).page;
    return as.post(`/pages/${id}/publish`, { version: p.version });
  }
  async function moveAndPublish(id: string, slug: string) {
    const saved = await setSlug(id, slug);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const res = await publish(id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return CmsPageResponseSchema.parse(res.body).page;
  }
  /** No active redirect starts at a live address or ends at another redirect's source. */
  async function expectConsistent(siteId: string = BV) {
    const active = await owner.siteRedirect.findMany({ where: { siteId, active: true } });
    const sources = new Set(active.map((r) => r.sourcePath));
    for (const r of active) {
      expect(sources.has(r.target.split("?")[0]!), `chain at ${r.sourcePath}`).toBe(false);
      expect(r.target, `self at ${r.sourcePath}`).not.toBe(r.sourcePath);
    }
    for (const r of active) {
      const res = await resolve(r.sourcePath, siteId === BV ? TEST_KEYS.webBv : undefined);
      expect(res.body?.redirect, `live content at ${r.sourcePath}`).toBeDefined();
    }
  }

  beforeAll(async () => {
    comPublisher = await staff(
      "com-cms-publisher",
      [{ role: "content_publisher", site: COM }],
      root.userId,
    );
  });

  it("schema: path formats, statuses, provenance; no chain and no loop for any writer", async () => {
    const base = {
      siteId: BV,
      origin: "MANUAL" as const,
      createdById: root.userId,
      updatedById: root.userId,
    };
    const ins = (data: Record<string, unknown>) =>
      owner.siteRedirect.create({ data: { ...base, ...data } as never });
    for (const sourcePath of ["/", "x", "//x", "/api/x", "/_next/static/a", "/a b", "/a?b"]) {
      await rejectsDb(ins({ sourcePath, target: "/ok" }), /SiteRedirect_source_path/);
    }
    for (const target of [
      "http://evil.example/",
      "//evil.example",
      "javascript:alert(1)",
      "/api",
    ]) {
      await rejectsDb(ins({ sourcePath: "/probe-src", target }), /SiteRedirect_target/);
    }
    await rejectsDb(
      ins({ sourcePath: "/probe-self", target: "/probe-self" }),
      /SiteRedirect_not_self/,
    );
    await rejectsDb(
      ins({ sourcePath: "/probe-s", target: "/x", statusCode: 307 }),
      /SiteRedirect_status_code/,
    );
    await rejectsDb(
      ins({ sourcePath: "/probe-s", target: "/x", origin: "SLUG_CHANGE" }),
      /SiteRedirect_slug_change/,
    );
    await rejectsDb(
      ins({
        sourcePath: "/probe-s",
        target: "/x",
        contentType: "CMS_PAGE",
        contentId: root.userId,
      }),
      /SiteRedirect_slug_change/,
    );
    // Legacy-style sources (DP-212) and https targets (DP-211) fit the same columns.
    const legacy = await ins({
      sourcePath: "/en/Products/Old.html",
      target: "https://example.com/a",
    });
    const withQuery = await ins({ sourcePath: "/probe-q", target: "/products?category=base-oil" });
    // A -> B exists: B -> C (chain forward) and X -> A (chain backward) are refused; B -> A
    // (a loop) is a chain too.
    const a = await ins({ sourcePath: "/probe-a", target: "/probe-b" });
    await rejectsDb(ins({ sourcePath: "/probe-b", target: "/probe-c" }), /cannot be the target/);
    await rejectsDb(ins({ sourcePath: "/probe-x", target: "/probe-a" }), /cannot be the source/);
    await rejectsDb(ins({ sourcePath: "/probe-b", target: "/probe-a" }), /redirect/);
    // An inactive redirect takes no part; switching it on is checked again.
    const off = await ins({ sourcePath: "/probe-b", target: "/probe-a", active: false });
    await rejectsDb(
      owner.siteRedirect.update({ where: { id: off.id }, data: { active: true } }),
      /redirect/,
    );
    // The same source once per site and query; the other site is separate.
    await rejectsDb(
      ins({ sourcePath: "/probe-a", target: "/elsewhere" }),
      /Unique constraint|unique/i,
    );
    const other = await ins({ siteId: COM, sourcePath: "/probe-a", target: "/elsewhere" });
    await owner.siteRedirect.deleteMany({
      where: { id: { in: [legacy.id, withQuery.id, a.id, off.id, other.id] } },
    });
    // At most one lock row per site (rows of sites made after the migration are created on first
    // use: this database got its sites after migrating); dp_app never deletes one.
    expect(await owner.sitePathLock.count()).toBeLessThanOrEqual(await owner.site.count());
    expect(await owner.sitePathLock.count({ where: { siteId: BV } })).toBe(1);
    await rejectsDb(asApp.sitePathLock.deleteMany({ where: { siteId: BV } }), /permission denied/);
  });

  it("a draft slug never changes the live address; publishing moves it with a 301", async () => {
    const id = await create("dp210-a");
    expect((await publish(id)).status).toBe(200);
    await expectLive("/dp210-a");
    expect(await pageOf(id)).toMatchObject({
      path: "/dp210-a",
      keepsOldAddress: true,
      redirectsHere: [],
      publication: { status: "PUBLISHED", path: "/dp210-a" },
    });
    // Draft: the site still shows /dp210-a; /dp210-b does not exist yet.
    expect((await setSlug(id, "dp210-b")).status).toBe(200);
    expect(await pageOf(id)).toMatchObject({
      path: "/dp210-b",
      publication: { path: "/dp210-a" },
    });
    await expectLive("/dp210-a");
    expectError(await resolve("/dp210-b"), 404, "NOT_FOUND");
    expect(await sitemap()).toContain("/dp210-a");
    expect(await owner.siteRedirect.count({ where: { contentId: id } })).toBe(0);
    // Publish: new address live, old one 301 to it, sitemap has only the new one.
    const live = CmsPageResponseSchema.parse((await publish(id)).body).page;
    expect(live).toMatchObject({
      path: "/dp210-b",
      publication: { path: "/dp210-b" },
      redirectsHere: ["/dp210-a"],
    });
    await expectLive("/dp210-b");
    await expectRedirect("/dp210-a", "/dp210-b");
    const paths = await sitemap();
    expect(paths).toContain("/dp210-b");
    expect(paths).not.toContain("/dp210-a");
    // The row and the audit trail (paths only; who; the publication's permission).
    const row = await owner.siteRedirect.findFirstOrThrow({ where: { contentId: id } });
    expect(row).toMatchObject({
      siteId: BV,
      sourcePath: "/dp210-a",
      sourceQuery: "",
      target: "/dp210-b",
      statusCode: 301,
      active: true,
      origin: "SLUG_CHANGE",
      contentType: "CMS_PAGE",
      createdById: bvPublisher.userId,
    });
    const audit = await lastAudit("seo.redirect_created");
    expect(audit).toMatchObject({
      actorUserId: bvPublisher.userId,
      resourceType: "site_redirect",
      resourceId: row.id,
      siteId: BV,
    });
    expect(audit?.metadata).toEqual({
      permission: "content:publish",
      contentType: "CMS_PAGE",
      contentId: id,
      sourcePath: "/dp210-a",
      target: "/dp210-b",
      origin: "SLUG_CHANGE",
      statusCode: 301,
    });
    expect((await lastAudit("cms.page_published"))?.metadata).toMatchObject({
      path: "/dp210-b",
      previousPath: "/dp210-a",
    });
    await expectConsistent();
  });

  it("collapses chains: A -> B, then B -> C makes A -> C and B -> C", async () => {
    const id = (await owner.siteRedirect.findFirstOrThrow({ where: { sourcePath: "/dp210-a" } }))
      .contentId!;
    await moveAndPublish(id, "dp210-c");
    await expectLive("/dp210-c");
    await expectRedirect("/dp210-a", "/dp210-c");
    await expectRedirect("/dp210-b", "/dp210-c");
    expect((await pageOf(id)).redirectsHere).toEqual(["/dp210-a", "/dp210-b"]);
    expect((await lastAudit("seo.redirect_retargeted"))?.metadata).toMatchObject({
      sourcePath: "/dp210-a",
      previousTarget: "/dp210-b",
      target: "/dp210-c",
    });
    await expectConsistent();
  });

  it("moving back to an old address never loops: that redirect is switched off", async () => {
    const id = (await owner.siteRedirect.findFirstOrThrow({ where: { sourcePath: "/dp210-a" } }))
      .contentId!;
    await moveAndPublish(id, "dp210-a");
    await expectLive("/dp210-a");
    await expectRedirect("/dp210-b", "/dp210-a");
    await expectRedirect("/dp210-c", "/dp210-a");
    const a = await owner.siteRedirect.findFirstOrThrow({ where: { sourcePath: "/dp210-a" } });
    expect(a.active).toBe(false);
    expect((await pageOf(id)).redirectsHere).toEqual(["/dp210-b", "/dp210-c"]);
    expect((await lastAudit("seo.redirect_retired"))?.metadata).toMatchObject({
      sourcePath: "/dp210-a",
      reason: "address_live_again",
    });
    // And forward again: the switched-off row is reused (one row per source).
    await moveAndPublish(id, "dp210-d");
    await expectRedirect("/dp210-a", "/dp210-d");
    expect(await owner.siteRedirect.count({ where: { sourcePath: "/dp210-a", siteId: BV } })).toBe(
      1,
    );
    expect((await lastAudit("seo.redirect_updated"))?.metadata).toMatchObject({
      sourcePath: "/dp210-a",
      target: "/dp210-d",
    });
    await expectConsistent();
  });

  it("an old address stays with its content: other pages get 409, the 301 and A -> B -> C stay", async () => {
    // The moved page lives at /dp210-d; /dp210-a, /dp210-b, /dp210-c answer 301 to it.
    const before = await owner.siteRedirect.findMany({
      where: { siteId: BV, active: true },
      orderBy: { sourcePath: "asc" },
    });
    const moved = before.find((r) => r.sourcePath === "/dp210-b")!.contentId!;
    // A new page cannot be created at an old address, nor move its draft there.
    expectError(
      await bvEditor.post(`/sites/${BV}/pages`, { title: "Reuse", slug: "dp210-b" }),
      409,
      "CONFLICT_STATE",
      { path: "slug", rule: "old_address" },
    );
    const other = await create("dp210-other");
    for (const slug of ["dp210-a", "dp210-b", "dp210-c"]) {
      expectError(await setSlug(other, slug), 409, "CONFLICT_STATE", {
        path: "slug",
        rule: "old_address",
      });
    }
    // Nothing changed: the same rows, targets, versions; still one hop to the page.
    expect(
      await owner.siteRedirect.findMany({
        where: { siteId: BV, active: true },
        orderBy: { sourcePath: "asc" },
      }),
    ).toEqual(before);
    for (const p of ["/dp210-a", "/dp210-b", "/dp210-c"]) await expectRedirect(p, "/dp210-d");
    expect((await pageOf(moved)).redirectsHere).toEqual(["/dp210-a", "/dp210-b", "/dp210-c"]);
    expect((await publish(other)).status).toBe(200);
    await expectLive("/dp210-other");
    await expectConsistent();
  });

  it("the same content may return to its old address (and leave again) without a chain", async () => {
    const id = await create("dp210-p1");
    expect((await publish(id)).status).toBe(200);
    await moveAndPublish(id, "dp210-p2");
    await moveAndPublish(id, "dp210-p3");
    await expectRedirect("/dp210-p1", "/dp210-p3");
    await expectRedirect("/dp210-p2", "/dp210-p3");
    // Return to p2: allowed for the same page; its redirect is switched off, the others follow.
    await moveAndPublish(id, "dp210-p2");
    await expectLive("/dp210-p2");
    await expectRedirect("/dp210-p1", "/dp210-p2");
    await expectRedirect("/dp210-p3", "/dp210-p2");
    // Another page still cannot take p1 or p3 (old addresses of this page).
    const q = await create("dp210-q");
    for (const slug of ["dp210-p1", "dp210-p3"]) {
      expectError(await setSlug(q, slug), 409, "CONFLICT_STATE", {
        path: "slug",
        rule: "old_address",
      });
    }
    await expectConsistent();
  });

  it("validates slugs: malformed, reserved and taken (400/409), and addresses of another page", async () => {
    const id = await create("dp210-v");
    for (const slug of ["Bad Slug", "a/b", "-x", "x--y", "../x"]) {
      expectError(await setSlug(id, slug), 400, "VALIDATION_FAILED");
    }
    for (const slug of ["products", "news", "privacy", "api", "preview", "sitemap", "en", "tr"]) {
      expectError(await setSlug(id, slug), 400, "VALIDATION_FAILED", {
        path: "slug",
        rule: "custom",
      });
    }
    expectError(await setSlug(id, "dp210-other"), 409, "CONFLICT_STATE", {
      path: "slug",
      rule: "unique",
    });
    // A page live at /dp210-w whose draft moved on keeps that address until it is published.
    const w = await create("dp210-w");
    expect((await publish(w)).status).toBe(200);
    expect((await setSlug(w, "dp210-w2")).status).toBe(200);
    expect((await setSlug(id, "dp210-w")).status).toBe(200);
    expectError(await publish(id), 409, "CONFLICT_STATE", {
      path: "slug",
      rule: "live_elsewhere",
    });
    // Once w moved, /dp210-w is w's old address: id is refused again (409 old_address), and the
    // 301 stays. A draft saved before the move is checked again when it is published.
    expect((await publish(w)).status).toBe(200);
    await expectRedirect("/dp210-w", "/dp210-w2");
    expectError(await publish(id), 409, "CONFLICT_STATE", { path: "slug", rule: "old_address" });
    await expectRedirect("/dp210-w", "/dp210-w2");
    await moveAndPublish(id, "dp210-w3");
    await expectLive("/dp210-w3");
    await expectLive("/dp210-w2");
    await expectConsistent();
  });

  it("a page that was never published changes its slug freely, without a redirect", async () => {
    const id = await create("dp210-draft-1");
    for (const slug of ["dp210-draft-2", "dp210-draft-3"]) {
      expect((await setSlug(id, slug)).status).toBe(200);
    }
    expect(await owner.siteRedirect.count({ where: { contentId: id } })).toBe(0);
    expect((await pageOf(id)).redirectsHere).toEqual([]);
    // A page taken off the site and published again elsewhere was not live: no redirect.
    expect((await publish(id)).status).toBe(200);
    const p = await pageOf(id);
    expect(
      (
        await bvPublisher.post(`/pages/${id}/unpublish`, {
          publicationVersion: p.publication!.version,
        })
      ).status,
    ).toBe(200);
    await moveAndPublish(id, "dp210-draft-4");
    expect(await owner.siteRedirect.count({ where: { contentId: id } })).toBe(0);
    expectError(await resolve("/dp210-draft-3"), 404, "NOT_FOUND");
  });

  it("articles keep their old /news/ address the same way", async () => {
    const id = await create("dp210-article", bvEditor, BV, true);
    expect((await setSlug(id, "dp210-article")).status).toBe(200);
    expect((await publish(id)).status).toBe(200);
    await expectLive("/news/dp210-article");
    await moveAndPublish(id, "dp210-article-renamed");
    await expectLive("/news/dp210-article-renamed");
    await expectRedirect("/news/dp210-article", "/news/dp210-article-renamed");
    const paths = await sitemap();
    expect(paths).toContain("/news/dp210-article-renamed");
    expect(paths).not.toContain("/news/dp210-article");
    // Taken off the site: the new address answers `unpublished`, the old one still one hop away.
    const p = await pageOf(id);
    await bvPublisher.post(`/pages/${id}/unpublish`, {
      publicationVersion: p.publication!.version,
    });
    expectError(await resolve("/news/dp210-article-renamed"), 404, "NOT_FOUND", {
      path: "path",
      rule: "unpublished",
    });
    await expectRedirect("/news/dp210-article", "/news/dp210-article-renamed");
  });

  it("concurrent publications: the same page twice is stale once; two pages never share an address", async () => {
    const id = await create("dp210-race");
    const p = await pageOf(id);
    const twice = await Promise.all([
      bvPublisher.post(`/pages/${id}/publish`, { version: p.version }),
      bvPublisher.post(`/pages/${id}/publish`, { version: p.version }),
    ]);
    // Serialised by the site lock: each one is a whole publication (200) or stale (409), never a
    // half-written one; revisions stay numbered 1, 2, … and the publication shows the last.
    for (const r of twice) {
      expect([200, 409], JSON.stringify(r.body)).toContain(r.status);
      if (r.status === 409) {
        expect(r.body.error.details).toContainEqual({ path: "version", rule: "stale" });
      }
    }
    const revs = await owner.cmsPageRevision.findMany({
      where: { pageId: id },
      orderBy: { revisionNumber: "asc" },
    });
    expect(revs.map((r) => r.revisionNumber)).toEqual(revs.map((_, i) => i + 1));
    expect(revs.length).toBe(twice.filter((r) => r.status === 200).length);
    const pubRow = await owner.cmsPagePublication.findUniqueOrThrow({ where: { pageId: id } });
    expect(pubRow.revisionId).toBe(revs.at(-1)!.id);
    // A publication of a draft version that was saved over is stale; the live address stays.
    const seen = await pageOf(id);
    expect((await setSlug(id, "dp210-race-2")).status).toBe(200);
    expectError(
      await bvPublisher.post(`/pages/${id}/publish`, { version: seen.version }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    await expectLive("/dp210-race");
    expectError(await resolve("/dp210-race-2"), 404, "NOT_FOUND");
    // k1 leaves /dp210-k while k2 takes it, at the same time: either order is consistent.
    const k1 = await create("dp210-k");
    expect((await publish(k1)).status).toBe(200);
    expect((await setSlug(k1, "dp210-k-new")).status).toBe(200);
    const k2 = await create("dp210-k");
    const [r1, r2] = await Promise.all([publish(k1), publish(k2)]);
    // In either order k2 never gets /dp210-k: while k1 is there it is live elsewhere, once k1
    // moved it is k1's old address.
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r2.status, JSON.stringify(r2.body)).toBe(409);
    expect(["live_elsewhere", "old_address"]).toContain(r2.body.error.details[0].rule);
    await expectLive("/dp210-k-new");
    await expectRedirect("/dp210-k", "/dp210-k-new");
    await expectConsistent();
  });

  it("the Corporate site moves its pages as before (no redirects there)", async () => {
    const created = await comEditor.post(`/sites/${COM}/pages`, {
      title: "Com",
      slug: "dp210-com",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = CmsPageResponseSchema.parse(created.body).page.id;
    expect((await publish(id, comPublisher)).status).toBe(200);
    expect((await setSlug(id, "dp210-com-2", comEditor)).status).toBe(200);
    const res = await publish(id, comPublisher);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(CmsPageResponseSchema.parse(res.body).page).toMatchObject({
      keepsOldAddress: false,
      redirectsHere: [],
    });
    expect(await owner.siteRedirect.count({ where: { siteId: COM } })).toBe(0);
    expectError(await resolve("/dp210-com", TEST_KEYS.webCorporate), 404, "NOT_FOUND");
    // A BV redirect is never answered for the Corporate key.
    expectError(await resolve("/dp210-c", TEST_KEYS.webCorporate), 404, "NOT_FOUND");
  });

  it("404 regression: unknown, draft and malformed addresses stay 404; restore is a draft", async () => {
    for (const p of [
      "/dp210-nope",
      "/dp210-draft-1",
      "/news/dp210-nope",
      "/A",
      "/a/b",
      "/dp210-a/",
    ]) {
      expectError(await resolve(p), 404, "NOT_FOUND");
    }
    // Restoring an older revision brings its slug back into the draft only.
    const id = (await owner.siteRedirect.findFirstOrThrow({ where: { sourcePath: "/dp210-c" } }))
      .contentId!;
    const p = await pageOf(id);
    const restored = await bvEditor.post(`/pages/${id}/restore`, {
      version: p.version,
      revisionNumber: 1,
    });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(CmsPageResponseSchema.parse(restored.body).page).toMatchObject({
      path: "/dp210-a",
      publication: { path: "/dp210-d" },
    });
    await expectLive("/dp210-d");
    await expectRedirect("/dp210-a", "/dp210-d");
  });
});
