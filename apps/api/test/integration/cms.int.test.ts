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
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CmsContextResponseSchema,
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
    expect(page.content.sections[0]).toEqual({ ...HERO, eyebrow: null, intro: null, cta: null });
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

  it("does not save DESIGN pages before the S2 import gives them a form", async () => {
    const home = await row({ kind: "DESIGN", templateKey: "bv.home", path: "/" });
    const res = await bvEditor.post(`/pages/${home.id}/draft`, {
      version: 1,
      title: "Home",
      slug: "home",
      seo: SEO,
      content: { sections: [] },
    });
    expectError(res, 409, "CONFLICT_STATE", { path: "kind", rule: "not_editable_yet" });
    const read = CmsPageResponseSchema.parse((await bvReader.get(`/pages/${home.id}`)).body);
    expect(read.page).toMatchObject({ kind: "DESIGN", slug: null, path: "/" });
  });
});
