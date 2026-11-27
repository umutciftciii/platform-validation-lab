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
//
// ML-13a (DP-244, section 23): translation packages — export, read-only dry run and import as
// drafts (pages, catalogue texts), with the permission, conflict and idempotency rules.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  BvFooterPublicSchema,
  BvNavMenuSchema,
  BvNavPublicSchema,
  CmsContextResponseSchema,
  CmsHistoryResponseSchema,
  CmsImportResponseSchema,
  CmsMenuTargetsResponseSchema,
  CmsPreviewResponseSchema,
  CmsPublicBundleSchema,
  menuNlProposal,
  CORPORATE_CONTENT_REGISTRY,
  CORPORATE_TR_PROPOSAL_INDEX,
  cmsTemplateContentSchema,
  CmsPublicNewsSchema,
  CmsPageListResponseSchema,
  CmsPageResponseSchema,
  ErrorBodySchema,
  PublicSeoResolveResponseSchema,
  PublicSiteSeoResponseSchema,
  PublicSiteLocalesResponseSchema,
  PublicSitemapResponseSchema,
  SeoOverviewResponseSchema,
  SeoRedirectHistoryResponseSchema,
  SeoRedirectImportResponseSchema,
  SeoRedirectListResponseSchema,
  SeoRedirectResponseSchema,
  ProductTranslationsResponseSchema,
  TranslationImportReportSchema,
  TranslationPackageSchema,
  menuReferencePlan,
  menuTargetCheck,
  translationUnitKey,
  type TranslationPackage,
} from "@dream/contracts";
import { assertTestDatabaseUrl } from "@dream/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import {
  boundedTransaction,
  transientDbError,
  transientDbRule,
  worstCaseMs,
  type TransactionLimits,
} from "../../src/iam/bounded-transaction.js";
import type { SiteScopedClient } from "../../src/iam/site-scope.js";
import { DRY_RUN_LIMITS, IMPORT_LIMITS } from "../../src/translation-packages/limits.js";
import { ADMIN_ORIGIN, TEST_KEYS, apiTestEnv } from "./helpers/auth-env.js";
import { DP_212_PAIRS, ML_4_PAIRS } from "../fixtures/legacy-url-map.js";

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

  async call(method: string, p: string, body?: unknown, signal?: AbortSignal): Promise<Res> {
    const headers: Record<string, string> = {
      "x-dp-proxy-key": TEST_KEYS.admin,
      "x-dp-client-ip": "10.20.30.40",
      cookie: `__Host-dp_admin_session=${this.token}`,
    };
    if (method !== "GET") headers["origin"] = ADMIN_ORIGIN;
    if (method === "POST") headers["content-type"] = "application/json";
    return parse(
      // DP-211: an absolute API path (e.g. /api/v1/admin/seo/...) is used as is.
      await fetch(`${base}${p.startsWith("/api/") ? p : `/api/v1/admin/cms${p}`}`, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
        ...(signal ? { signal } : {}),
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

/**
 * A row inserted directly as dp_owner (for the CHECK probes). ML-2: an original page is the first
 * page of its own translation group (translationGroupId = id) unless the probe names a group.
 */
function row(data: Record<string, unknown>) {
  const id = (data["id"] as string | undefined) ?? randomUUID();
  return owner.cmsPage.create({
    data: {
      id,
      translationGroupId: id,
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
      /CmsPage_registry_siteId_locale_templateKey_key|Unique constraint/,
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
    // DP-219: the menus leave the API in their public shape (references resolved).
    const footer = BvFooterPublicSchema.parse(bundle.fragments["bv.site-footer"]?.content);
    expect(footer.headline).toBe("Let’s move energy forward, together.");
    expect(BvNavPublicSchema.parse(bundle.fragments["bv.site-nav"]?.content).items.length).toBe(6);
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
    // DP-250: an English fragment preview names English.
    expect(bundle.locale).toBe("en");
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
      const res = await resolve(
        r.sourcePath,
        siteId === BV ? TEST_KEYS.webBv : TEST_KEYS.webCorporate,
      );
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

  it("COM-1: the Corporate site keeps the old address of a moved page too, for its own key", async () => {
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
    expect(CmsPageResponseSchema.parse(res.body).page.keepsOldAddress).toBe(true);
    const rows = await owner.siteRedirect.findMany({ where: { siteId: COM } });
    expect(rows.map((r) => [r.sourcePath, r.target, r.origin, r.active])).toEqual([
      ["/dp210-com", "/dp210-com-2", "SLUG_CHANGE", true],
    ]);
    expect((await resolve("/dp210-com", TEST_KEYS.webCorporate)).body).toEqual({
      path: "/dp210-com",
      redirect: { target: "/dp210-com-2", statusCode: 301 },
    });
    // Each site answers only its own: the BV key never sees the Corporate redirect, nor the other way.
    expectError(await resolve("/dp210-com"), 404, "NOT_FOUND");
    expectError(await resolve("/dp210-c", TEST_KEYS.webCorporate), 404, "NOT_FOUND");
    await expectConsistent(COM);
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

describe("18. redirect management (DP-211)", () => {
  let manager: Staff; // site_admin @ BV: content:publish and audit:read
  let comPublisher2: Staff; // content_publisher @ CORPORATE
  const R = () => `/api/v1/admin/seo/sites/${BV}/redirects`;
  async function seo(p: string, key: string = TEST_KEYS.webBv): Promise<Res> {
    return parse(
      await fetch(`${base}/api/v1/public/seo${p}`, {
        headers: { "x-dp-proxy-key": key, "x-dp-client-ip": "10.20.30.45" },
      }),
    );
  }
  const resolve = (p: string, query = "", key?: string) =>
    seo(
      `/resolve?path=${encodeURIComponent(p)}${query ? `&query=${encodeURIComponent(query)}` : ""}`,
      key,
    );
  const sitemap = async () =>
    PublicSitemapResponseSchema.parse((await seo("/sitemap")).body).entries.map((e) => e.path);
  async function livePage(slug: string, as: Staff = bvEditor): Promise<string> {
    const created = await as.post(`/sites/${BV}/pages`, { title: `DP-211 ${slug}`, slug });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = CmsPageResponseSchema.parse(created.body).page.id;
    const p = CmsPageResponseSchema.parse((await bvPublisher.get(`/pages/${id}`)).body).page;
    const pub = await bvPublisher.post(`/pages/${id}/publish`, { version: p.version });
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    return id;
  }
  async function move(id: string, slug: string) {
    const p = CmsPageResponseSchema.parse((await bvEditor.get(`/pages/${id}`)).body).page;
    const saved = await bvEditor.post(`/pages/${id}/draft`, {
      version: p.version,
      title: p.title,
      slug,
      seo: SEO,
      content: { sections: [HERO] },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const q = CmsPageResponseSchema.parse((await bvPublisher.get(`/pages/${id}`)).body).page;
    const pub = await bvPublisher.post(`/pages/${id}/publish`, { version: q.version });
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  }
  const body = (source: string, target: string, over: Record<string, unknown> = {}) => ({
    source,
    target,
    statusCode: 301,
    active: true,
    note: null,
    ...over,
  });
  async function create(source: string, target: string, over = {}, as: Staff = manager) {
    const res = await as.post(R(), body(source, target, over));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return SeoRedirectResponseSchema.parse(res.body);
  }
  const rowAt = (sourcePath: string, sourceQuery = "") =>
    owner.siteRedirect.findUniqueOrThrow({
      where: { siteId_sourcePath_sourceQuery: { siteId: BV, sourcePath, sourceQuery } },
    });
  /** No active redirect starts at a live address, chains or loops. */
  async function expectConsistent() {
    const active = await owner.siteRedirect.findMany({ where: { siteId: BV, active: true } });
    const plain = new Set(active.filter((r) => r.sourceQuery === "").map((r) => r.sourcePath));
    for (const r of active) {
      expect(plain.has(r.target.split("?")[0]!), `chain at ${r.sourcePath}`).toBe(false);
      const res = await resolve(r.sourcePath, r.sourceQuery);
      expect(res.body?.redirect, `live content at ${r.sourcePath}`).toBeDefined();
    }
  }

  beforeAll(async () => {
    manager = await staff("bv-site-admin", [{ role: "site_admin", site: BV }], root.userId);
    comPublisher2 = await staff(
      "com-publisher-211",
      [{ role: "content_publisher", site: COM }],
      root.userId,
    );
    await livePage("dp211-target");
  });

  it("authorization: read with content:read, change with content:publish, history with audit:read", async () => {
    expectError(await nobody.get(R()), 403, "FORBIDDEN");
    expectError(await comEditor.get(R()), 403, "FORBIDDEN");
    const read = await bvReader.get(R());
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(SeoRedirectListResponseSchema.parse(read.body).permissions).toEqual({
      manage: false,
      history: false,
    });
    const managed = SeoRedirectListResponseSchema.parse((await manager.get(R())).body);
    expect(managed.permissions).toEqual({ manage: true, history: true });
    expect(
      SeoRedirectListResponseSchema.parse((await bvPublisher.get(R())).body).permissions,
    ).toEqual({
      manage: true,
      history: false,
    });
    // Editors (no publishing), readers and the super admin (no publishing) cannot change redirects.
    for (const who of [bvEditor, bvReader, root, nobody]) {
      expectError(await who.post(R(), body("/dp211-denied", "/dp211-target")), 403, "FORBIDDEN");
    }
    const denied = await owner.auditEvent.findFirst({
      where: { actorUserId: bvEditor.userId, outcome: "DENIED", resourceType: "site_redirect" },
    });
    expect(denied).not.toBeNull();
    expect(await owner.siteRedirect.count({ where: { sourcePath: "/dp211-denied" } })).toBe(0);
    // COM-1: the Corporate site manages its own redirects; its list never shows a BV row.
    const com = await comPublisher2.get(`/api/v1/admin/seo/sites/${COM}/redirects`);
    expect(com.status, JSON.stringify(com.body)).toBe(200);
    const comList = SeoRedirectListResponseSchema.parse(com.body);
    expect(comList.site.key).toBe("CORPORATE");
    expect(comList.permissions.manage).toBe(true);
    expect(comList.items.every((i) => !i.sourcePath.startsWith("/dp211"))).toBe(true);
    // A BV publisher has no right on the Corporate site (refused and audited).
    expectError(await manager.get(`/api/v1/admin/seo/sites/${COM}/redirects`), 403, "FORBIDDEN");
    expectError(
      await manager.get(`/api/v1/admin/seo/sites/not-a-uuid/redirects`),
      403,
      "FORBIDDEN",
    );
  });

  it("create, edit and delete a manual redirect; audited; live on the site at once", async () => {
    const created = await create("/dp211-old", "/dp211-target", { note: " Old page " });
    expect(created.warnings).toEqual([]);
    expect(created.redirect).toMatchObject({
      sourcePath: "/dp211-old",
      sourceQuery: "",
      target: "/dp211-target",
      statusCode: 301,
      active: true,
      origin: "MANUAL",
      note: "Old page",
      version: 1,
      protected: false,
      content: null,
      createdBy: expect.any(String),
    });
    const res = await resolve("/dp211-old");
    expect(PublicSeoResolveResponseSchema.parse(res.body)).toEqual({
      path: "/dp211-old",
      redirect: { target: "/dp211-target", statusCode: 301 },
    });
    expect(await sitemap()).not.toContain("/dp211-old");
    const audit = await lastAudit("seo.redirect_created");
    expect(audit).toMatchObject({ actorUserId: manager.userId, siteId: BV, outcome: "SUCCESS" });
    expect(audit?.metadata).toMatchObject({
      permission: "content:publish",
      sourcePath: "/dp211-old",
      target: "/dp211-target",
      origin: "MANUAL",
      hasNote: true,
    });
    expect(JSON.stringify(audit?.metadata)).not.toContain("Old page");

    // Edit: 302 and inactive; a stale version is refused; the site follows at once.
    const id = created.redirect.id;
    const edited = await manager.post(`${R()}/${id}`, {
      ...body("/dp211-old", "/dp211-target", { statusCode: 302 }),
      version: 1,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(SeoRedirectResponseSchema.parse(edited.body).redirect).toMatchObject({
      statusCode: 302,
      version: 2,
      note: null,
    });
    expect((await resolve("/dp211-old")).body.redirect).toEqual({
      target: "/dp211-target",
      statusCode: 302,
    });
    expectError(
      await manager.post(`${R()}/${id}`, { ...body("/dp211-old", "/x"), version: 1 }),
      409,
      "CONFLICT_STATE",
      { path: "version", rule: "stale" },
    );
    const off = await bvPublisher.post(`${R()}/${id}`, {
      ...body("/dp211-old", "/dp211-target", { active: false, statusCode: 302 }),
      version: 2,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expectError(await resolve("/dp211-old"), 404, "NOT_FOUND");
    expect((await lastAudit("seo.redirect_updated"))?.metadata).toMatchObject({
      active: false,
      previous: { active: true, statusCode: 302 },
      changed: ["active"],
    });

    // Delete: version checked; history survives the row (audit:read only).
    expectError(await manager.post(`${R()}/${id}/delete`, { version: 1 }), 409, "CONFLICT_STATE", {
      path: "version",
      rule: "stale",
    });
    expectError(await bvReader.post(`${R()}/${id}/delete`, { version: 3 }), 403, "FORBIDDEN");
    const del = await manager.post(`${R()}/${id}/delete`, { version: 3 });
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect(await owner.siteRedirect.count({ where: { id } })).toBe(0);
    expect((await lastAudit("seo.redirect_deleted"))?.metadata).toMatchObject({
      sourcePath: "/dp211-old",
      origin: "MANUAL",
      version: 3,
    });
    expectError(await bvPublisher.get(`${R()}/${id}/history`), 403, "FORBIDDEN");
    const history = SeoRedirectHistoryResponseSchema.parse(
      (await manager.get(`${R()}/${id}/history`)).body,
    );
    expect(history.events.map((e) => e.action)).toEqual([
      "seo.redirect_deleted",
      "seo.redirect_updated",
      "seo.redirect_updated",
      "seo.redirect_created",
    ]);
    expect(history.events[0]?.actor).toBeTruthy();
    expect(history.events[0]?.details["permission"]).toBeUndefined();
    expectError(await manager.get(`${R()}/${randomUUIDLike()}/history`), 404, "NOT_FOUND");
  });

  it("validation: same-site targets, reserved paths, live content, duplicates, chains and loops", async () => {
    const bad = async (
      source: string,
      target: string,
      status: number,
      detail: { path: string; rule: string },
    ) =>
      expectError(
        await manager.post(R(), body(source, target)),
        status,
        status === 400 ? "VALIDATION_FAILED" : "CONFLICT_STATE",
        detail,
      );
    await bad("/dp211-v", "https://evil.example/", 400, { path: "target", rule: "external" });
    await bad("/dp211-v", "//evil.example", 400, { path: "target", rule: "external" });
    await bad("/dp211-v", "/api/x", 400, { path: "target", rule: "reserved" });
    await bad("/products", "/x", 400, { path: "source", rule: "reserved" });
    // DP-212: /en and /tr are old-site sources now; other language codes stay reserved, and
    // upper case is lower-cased (so a malformed source is one with a space, "..", "//", ...).
    await bad("/de", "/x", 400, { path: "source", rule: "reserved" });
    await bad("/dp211 v", "/x", 400, { path: "source", rule: "format" });
    await bad("/dp211/../x", "/x", 400, { path: "source", rule: "format" });
    await bad("/dp211-v#x", "/x", 400, { path: "source", rule: "fragment" });
    await bad("/dp211-v", "/dp211-v", 400, { path: "target", rule: "self" });
    // A live page's address is never a source.
    await bad("/dp211-target", "/x", 409, { path: "source", rule: "live_content" });
    // Duplicates: the same source (and query) once.
    await create("/dp211-a", "/dp211-target");
    await bad("/dp211-a", "/x", 409, { path: "source", rule: "duplicate" });
    await bad("/dp211-a/", "/x", 409, { path: "source", rule: "duplicate" });
    // Chains (and so loops): /dp211-b -> /dp211-a (a source), /dp211-target <- ... ; /dp211-c as a
    // source that /dp211-x already targets.
    await bad("/dp211-b", "/dp211-a", 409, { path: "target", rule: "chain" });
    await create("/dp211-x", "/dp211-c");
    await bad("/dp211-c", "/dp211-target", 409, { path: "source", rule: "chain" });
    await bad("/dp211-target-2", "/dp211-x", 409, { path: "target", rule: "chain" });
    // Warnings never block: a target without live content, a draft at the source.
    const draft = await bvEditor.post(`/sites/${BV}/pages`, {
      title: "Draft",
      slug: "dp211-draft",
    });
    expect(draft.status).toBe(201);
    const warned = await create("/dp211-draft", "/dp211-nowhere");
    expect(warned.warnings.sort()).toEqual(["source:draft_content", "target:not_live"]);
    expect((await create("/dp211-to-products", "/products?category=base-oil")).warnings).toEqual(
      [],
    );
    await expectConsistent();
  });

  it("query-bound sources match their exact query and send the target as is", async () => {
    await create("/dp211-q?ref=mail&b=2", "/dp211-target", { statusCode: 302 });
    await create("/dp211-q", "/dp211-target?from=q");
    expect(await rowAt("/dp211-q", "b=2&ref=mail")).toMatchObject({ statusCode: 302 });
    expect((await resolve("/dp211-q", "ref=mail&b=2")).body.redirect).toEqual({
      target: "/dp211-target",
      statusCode: 302,
      keepQuery: false,
    });
    // Parameter order does not matter.
    expect((await resolve("/dp211-q", "b=2&ref=mail")).body.redirect).toMatchObject({
      keepQuery: false,
    });
    // Another query falls back to the plain redirect (which keeps the request query, DP-210).
    expect((await resolve("/dp211-q", "ref=other")).body.redirect).toEqual({
      target: "/dp211-target?from=q",
      statusCode: 301,
    });
    expect((await resolve("/dp211-q")).body.redirect).toMatchObject({ statusCode: 301 });
    // The Corporate key never sees a BV redirect.
    expectError(await resolve("/dp211-q", "", TEST_KEYS.webCorporate), 404, "NOT_FOUND");
  });

  it("slug-change redirects are listed with their content and protected", async () => {
    const list = SeoRedirectListResponseSchema.parse(
      (await manager.get(`${R()}?origin=SLUG_CHANGE`)).body,
    );
    expect(list.items.length).toBeGreaterThan(0);
    const item = list.items.find((i) => i.sourcePath === "/dp210-a")!;
    expect(item).toMatchObject({
      origin: "SLUG_CHANGE",
      protected: true,
      content: { type: "CMS_PAGE", name: expect.stringContaining("DP-210"), livePath: item.target },
    });
    const keep = { source: item.sourcePath, target: item.target, statusCode: 301, active: true };
    for (const change of [
      { target: "/dp211-target" },
      { active: false },
      { statusCode: 302 },
      { source: "/dp211-moved" },
    ]) {
      expectError(
        await manager.post(`${R()}/${item.id}`, {
          ...keep,
          note: null,
          ...change,
          version: item.version,
        }),
        409,
        "CONFLICT_STATE",
        { path: "redirect", rule: "protected" },
      );
    }
    expectError(
      await manager.post(`${R()}/${item.id}/delete`, { version: item.version }),
      409,
      "CONFLICT_STATE",
      {
        path: "redirect",
        rule: "protected",
      },
    );
    const noted = await manager.post(`${R()}/${item.id}`, {
      ...keep,
      note: "Moved in 2026",
      version: item.version,
    });
    expect(noted.status, JSON.stringify(noted.body)).toBe(200);
    expect(SeoRedirectResponseSchema.parse(noted.body).redirect).toMatchObject({
      note: "Moved in 2026",
      origin: "SLUG_CHANGE",
      target: item.target,
    });
    expect((await resolve("/dp210-a")).body.redirect).toEqual({
      target: item.target,
      statusCode: 301,
    });
    // Search, filters and sorting.
    const found = SeoRedirectListResponseSchema.parse(
      (await manager.get(`${R()}?q=MOVED%20IN&origin=SLUG_CHANGE`)).body,
    );
    expect(found.items.map((i) => i.id)).toEqual([item.id]);
    const sorted = SeoRedirectListResponseSchema.parse(
      (await manager.get(`${R()}?sort=source&dir=asc`)).body,
    );
    const dbOrder = await owner.siteRedirect.findMany({
      where: { siteId: BV },
      orderBy: [{ sourcePath: "asc" }, { sourceQuery: "asc" }, { id: "asc" }],
      take: 50,
      select: { id: true },
    });
    expect(sorted.items.map((i) => i.id)).toEqual(dbOrder.map((r) => r.id));
    const s302 = SeoRedirectListResponseSchema.parse((await manager.get(`${R()}?status=302`)).body);
    expect(s302.items.every((i) => i.statusCode === 302)).toBe(true);
    expect(s302.counts.SLUG_CHANGE).toBe(list.counts.SLUG_CHANGE);
    expectError(await manager.get(`${R()}?sort=evil`), 400, "VALIDATION_FAILED");
    expectError(await manager.get(`${R()}?unknown=1`), 400, "VALIDATION_FAILED");
  });

  it("slug changes keep manual redirects one hop; published content takes a source back", async () => {
    const pid = await livePage("dp211-p1");
    await create("/dp211-m", "/dp211-p1");
    await move(pid, "dp211-p2");
    // DP-210 rule 2: the manual redirect follows the page (no chain), origin unchanged.
    expect(await rowAt("/dp211-m")).toMatchObject({
      target: "/dp211-p2",
      origin: "MANUAL",
      active: true,
    });
    expect(await rowAt("/dp211-p1")).toMatchObject({ target: "/dp211-p2", origin: "SLUG_CHANGE" });
    // DP-210 rule 1: a page published at a manual redirect's source switches it off.
    await create("/dp211-src", "/dp211-target");
    await livePage("dp211-src");
    expect(await rowAt("/dp211-src")).toMatchObject({ active: false, origin: "MANUAL" });
    expect((await resolve("/dp211-src")).body.redirect).toBeUndefined();
    // Switching it on again is refused while the page is live.
    const r = await rowAt("/dp211-src");
    expectError(
      await manager.post(`${R()}/${r.id}`, {
        ...body("/dp211-src", "/dp211-target"),
        version: r.version,
      }),
      409,
      "CONFLICT_STATE",
      { path: "source", rule: "live_content" },
    );
    await expectConsistent();
  });

  it("concurrent changes: one wins, the other is refused; no duplicate, no chain", async () => {
    const r = (await create("/dp211-race", "/dp211-target")).redirect;
    const [a, b] = await Promise.all([
      manager.post(`${R()}/${r.id}`, {
        ...body("/dp211-race", "/dp211-target", { statusCode: 302 }),
        version: 1,
      }),
      bvPublisher.post(`${R()}/${r.id}`, {
        ...body("/dp211-race", "/dp211-target", { active: false }),
        version: 1,
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await rowAt("/dp211-race")).version).toBe(2);
    const twins = await Promise.all([
      manager.post(R(), body("/dp211-twin", "/dp211-target")),
      bvPublisher.post(R(), body("/dp211-twin", "/dp211-target")),
    ]);
    expect(twins.map((t) => t.status).sort()).toEqual([201, 409]);
    expect(
      await owner.siteRedirect.count({ where: { siteId: BV, sourcePath: "/dp211-twin" } }),
    ).toBe(1);
    // A redirect and a publication at the same address: whichever is second sees the first.
    const draft = await bvEditor.post(`/sites/${BV}/pages`, {
      title: "Race",
      slug: "dp211-race-page",
    });
    const raceId = CmsPageResponseSchema.parse(draft.body).page.id;
    const p = CmsPageResponseSchema.parse((await bvPublisher.get(`/pages/${raceId}`)).body).page;
    const [made, pub] = await Promise.all([
      manager.post(R(), body("/dp211-race-page", "/dp211-target")),
      bvPublisher.post(`/pages/${raceId}/publish`, { version: p.version }),
    ]);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    expect([201, 409]).toContain(made.status);
    const left = await owner.siteRedirect.findMany({
      where: { siteId: BV, sourcePath: "/dp211-race-page" },
    });
    expect(left.every((x) => !x.active)).toBe(true);
    await expectConsistent();
  });

  it("CSV: dry-run, error report, import of the confirmed plan, idempotent re-import", async () => {
    const imp = (csv: string, dryRun: boolean, planHash?: string, as: Staff = manager) =>
      as.post(`${R()}/import`, { csv, dryRun, ...(planHash ? { planHash } : {}) });
    expectError(
      await imp("source,target\n/dp211-i1,/dp211-target", true, undefined, bvEditor),
      403,
      "FORBIDDEN",
    );
    expectError(await imp("from,to\n/a,/b", true), 400, "VALIDATION_FAILED", {
      path: "csv.1",
      rule: "header",
    });
    const before = await owner.siteRedirect.count({ where: { siteId: BV } });
    const withErrors = [
      "source,target,status,active,note",
      "/dp211-i1,/dp211-target,301,true,first",
      "/dp211-i2,https://evil.example/,301,true,",
      "/products,/dp211-target,301,true,",
      "/dp211-i1,/dp211-other,301,true,",
      "/dp211-i3,/dp211-i4,302,yes,",
      "/dp211-i4,/dp211-target,301,true,",
      "/dp211-target,/x,301,true,",
      "/dp211-i5,/dp211-target,307,true,",
      "/dp211-a,/dp211-target,301,true,changed",
    ].join("\n");
    const dry = SeoRedirectImportResponseSchema.parse((await imp(withErrors, true)).body);
    expect(dry.applied).toBe(false);
    const by = (line: number) => dry.rows.find((r) => r.line === line)!;
    expect(by(2)).toMatchObject({ action: "create", errors: [] });
    expect(by(3).errors).toContain("target:external");
    expect(by(4).errors).toContain("source:reserved");
    expect(by(5).errors).toContain("source:duplicate_in_file");
    expect(by(6).errors).toContain("target:chain");
    expect(by(7).errors).toContain("source:chain");
    expect(by(8).errors).toContain("source:live_content");
    expect(by(9).errors).toContain("status:format");
    expect(by(10)).toMatchObject({ action: "update" });
    expect(dry.summary).toMatchObject({ rows: 9, create: 1, update: 1, error: 7 });
    expectError(await imp(withErrors, false, dry.planHash), 409, "CONFLICT_STATE", {
      path: "import",
      rule: "has_errors",
    });
    expect(await owner.siteRedirect.count({ where: { siteId: BV } })).toBe(before);

    const good = [
      "target,source,note",
      "/dp211-target,/dp211-i1,first",
      "/dp211-target,/dp211-i2,",
      '/products?category=base-oil,"/dp211-i3?utm=mail",campaign',
    ].join("\r\n");
    const plan = SeoRedirectImportResponseSchema.parse((await imp(good, true)).body);
    expect(plan.summary).toMatchObject({ create: 3, error: 0 });
    expectError(await imp(good, false), 400, "VALIDATION_FAILED", {
      path: "planHash",
      rule: "required",
    });
    // Data changed since the dry-run: the import is refused, nothing written.
    await create("/dp211-i2", "/dp211-target", { note: "manual meanwhile" });
    expectError(await imp(good, false, plan.planHash), 409, "CONFLICT_STATE", {
      path: "import",
      rule: "changed",
    });
    expect(await owner.siteRedirect.count({ where: { siteId: BV, origin: "IMPORT" } })).toBe(0);
    const plan2 = SeoRedirectImportResponseSchema.parse((await imp(good, true)).body);
    expect(plan2.summary).toMatchObject({ create: 2, update: 1, error: 0 });
    const done = await imp(good, false, plan2.planHash);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(SeoRedirectImportResponseSchema.parse(done.body)).toMatchObject({ applied: true });
    expect(await rowAt("/dp211-i1")).toMatchObject({ origin: "IMPORT", note: "first" });
    expect(await rowAt("/dp211-i2")).toMatchObject({ origin: "MANUAL", note: null });
    expect(await rowAt("/dp211-i3", "utm=mail")).toMatchObject({
      origin: "IMPORT",
      target: "/products?category=base-oil",
    });
    expect((await lastAudit("seo.redirects_imported"))?.metadata).toMatchObject({
      create: 2,
      update: 1,
    });
    // Re-import: nothing changes, nothing is duplicated.
    const count = await owner.siteRedirect.count({ where: { siteId: BV } });
    const again = SeoRedirectImportResponseSchema.parse((await imp(good, true)).body);
    expect(again.summary).toMatchObject({ create: 0, update: 0, unchanged: 3, error: 0 });
    const reapplied = await imp(good, false, again.planHash);
    expect(reapplied.status).toBe(200);
    expect(await owner.siteRedirect.count({ where: { siteId: BV } })).toBe(count);
    await expectConsistent();
  });

  it("public regressions: sitemap without sources, real 404s, live content wins", async () => {
    const paths = await sitemap();
    const sources = (
      await owner.siteRedirect.findMany({ where: { siteId: BV, active: true } })
    ).map((r) => r.sourcePath);
    for (const s of sources) expect(paths, s).not.toContain(s);
    expect(paths).toContain("/dp211-target");
    for (const p of ["/dp211-nope", "/news/dp211-nope", "/products/dp211-nope", "/DP211", "/a/b"]) {
      expectError(await resolve(p), 404, "NOT_FOUND");
    }
    const live = await resolve("/dp211-target", "ref=mail");
    expect(live.status).toBe(200);
    expect(live.body.redirect).toBeUndefined();
    await expectConsistent();
  });
});

describe("19. old-site addresses and the legacy URL map (DP-212)", () => {
  let manager: Staff; // site_admin @ BV: content:publish and audit:read
  const R = () => `/api/v1/admin/seo/sites/${BV}/redirects`;
  async function seo(p: string, key: string = TEST_KEYS.webBv): Promise<Res> {
    return parse(
      await fetch(`${base}/api/v1/public/seo${p}`, {
        headers: { "x-dp-proxy-key": key, "x-dp-client-ip": "10.20.30.46" },
      }),
    );
  }
  const resolve = (p: string, query = "", key?: string) =>
    seo(
      `/resolve?path=${encodeURIComponent(p)}${query ? `&query=${encodeURIComponent(query)}` : ""}`,
      key,
    );
  async function livePage(slug: string): Promise<string> {
    const created = await bvEditor.post(`/sites/${BV}/pages`, { title: `DP-212 ${slug}`, slug });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = CmsPageResponseSchema.parse(created.body).page.id;
    const p = CmsPageResponseSchema.parse((await bvPublisher.get(`/pages/${id}`)).body).page;
    const pub = await bvPublisher.post(`/pages/${id}/publish`, { version: p.version });
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    return id;
  }
  const body = (source: string, target: string, over: Record<string, unknown> = {}) => ({
    source,
    target,
    statusCode: 301,
    active: true,
    note: null,
    ...over,
  });
  async function create(source: string, target: string, over = {}) {
    const res = await manager.post(R(), body(source, target, over));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return SeoRedirectResponseSchema.parse(res.body);
  }
  const imp = (csv: string, dryRun: boolean, planHash?: string) =>
    manager.post(`${R()}/import`, { csv, dryRun, ...(planHash ? { planHash } : {}) });
  const redirectOf = async (p: string, query = "") => {
    const res = await resolve(p, query);
    expect(res.status, `${p}?${query} ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.redirect as { target: string; statusCode: number; keepQuery?: boolean };
  };

  beforeAll(async () => {
    manager = await staff("bv-site-admin-212", [{ role: "site_admin", site: BV }], root.userId);
    await livePage("dp212-about");
    await livePage("dp212-target");
    await livePage("dp212-live");
  });

  it("old-site sources: stored in lower case, answered for any spelling, one hop", async () => {
    const about = await create("/EN/DP212-About/", "/dp212-about");
    expect(about.redirect).toMatchObject({ sourcePath: "/en/dp212-about", sourceQuery: "" });
    expect(about.warnings).toEqual([]);
    await create("/en/dp212-contact-us.html", "/dp212-about");
    await create("/en/blog_detail/dp212-post/1", "/dp212-target");
    await create("/en/dp212-index", "/");
    await create(
      "https://dreampetroleumbv.com/en/dp212-products?category=base-oil",
      "/products?category=base-oil",
    );
    await create("/en/dp212-products", "/products");
    for (const p of ["/en/dp212-about", "/EN/DP212-About", "/En/Dp212-About"]) {
      expect(await redirectOf(p), p).toEqual({ target: "/dp212-about", statusCode: 301 });
    }
    expect((await redirectOf("/en/DP212-CONTACT-US.HTML")).target).toBe("/dp212-about");
    expect((await redirectOf("/en/blog_detail/dp212-post/1")).target).toBe("/dp212-target");
    expect((await redirectOf("/en/dp212-index")).target).toBe("/");
    // A trailing slash is the framework's to normalise (308 first); the API keeps DP-210's 404.
    expectError(await resolve("/en/dp212-index/"), 404, "NOT_FOUND");
    // Query-bound source: the target as is; the plain one keeps the request's query.
    expect(await redirectOf("/en/dp212-products", "category=base-oil")).toEqual({
      target: "/products?category=base-oil",
      statusCode: 301,
      keepQuery: false,
    });
    expect(await redirectOf("/en/dp212-products", "page=2")).toEqual({
      target: "/products",
      statusCode: 301,
    });
    // The duplicate check sees the lower-case form.
    expectError(await manager.post(R(), body("/en/DP212-ABOUT", "/x")), 409, "CONFLICT_STATE", {
      path: "source",
      rule: "duplicate",
    });
    // No row, malformed or internal: 404 without guessing (".html" is not stripped).
    for (const p of [
      "/en/dp212-nope",
      "/en/dp212-about.html",
      "/en//dp212-about",
      "/en/../dp212-about",
      "/_next/static/x.js",
      "/media/brand/x.svg",
      "/robots.txt",
      `/en/${"a".repeat(300)}`,
    ]) {
      expectError(await resolve(p), 404, "NOT_FOUND");
    }
  });

  it("the locale homes /en and /tr are sources; other language codes, internals and files are not", async () => {
    // (The real /en row comes with the map; the rule is checked on /tr here.)
    await create("/tr", "/");
    expect(await redirectOf("/tr")).toEqual({ target: "/", statusCode: 301 });
    expect(await redirectOf("/TR")).toEqual({ target: "/", statusCode: 301 });
    for (const [source, rule] of [
      ["/de", "reserved"],
      ["/Media/x.jpg", "reserved"],
      ["/sitemap.xml", "reserved"],
      ["/api/v1/x", "reserved"],
      ["/a/b/c/d/e/f/g", "format"],
    ] as const) {
      expectError(
        await manager.post(R(), body(source, "/dp212-target")),
        400,
        "VALIDATION_FAILED",
        {
          path: "source",
          rule,
        },
      );
    }
  });

  it("live content is never overridden; chains and loops are refused for old-site sources too", async () => {
    // An upper-case spelling of a live address is not a redirect of it (no row, no guess): 404.
    expectError(await resolve("/DP212-Live"), 404, "NOT_FOUND");
    expect((await resolve("/dp212-live")).body).toEqual({ path: "/dp212-live", kind: "page" });
    // Its lower-case form is live, so it cannot be a source.
    expectError(
      await manager.post(R(), body("/DP212-Live", "/dp212-target")),
      409,
      "CONFLICT_STATE",
      {
        path: "source",
        rule: "live_content",
      },
    );
    // A target that is itself an (old-site) source: chain.
    expectError(
      await manager.post(R(), body("/dp212-chain", "/en/dp212-about")),
      409,
      "CONFLICT_STATE",
      { path: "target", rule: "chain" },
    );
    const active = await owner.siteRedirect.findMany({ where: { siteId: BV, active: true } });
    const plain = new Set(active.filter((r) => r.sourceQuery === "").map((r) => r.sourcePath));
    for (const r of active) expect(plain.has(r.target.split("?")[0]!), r.sourcePath).toBe(false);
  });

  it("DP-210 automatic 301s still apply: an old-site redirect follows a page that moves (one hop)", async () => {
    const id = await livePage("dp212-mover");
    await create("/en/dp212-mover", "/dp212-mover");
    const p = CmsPageResponseSchema.parse((await bvEditor.get(`/pages/${id}`)).body).page;
    const saved = await bvEditor.post(`/pages/${id}/draft`, {
      version: p.version,
      title: p.title,
      slug: "dp212-moved",
      seo: SEO,
      content: { sections: [HERO] },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const q = CmsPageResponseSchema.parse((await bvPublisher.get(`/pages/${id}`)).body).page;
    expect((await bvPublisher.post(`/pages/${id}/publish`, { version: q.version })).status).toBe(
      200,
    );
    expect((await redirectOf("/en/dp212-mover")).target).toBe("/dp212-moved");
    expect((await redirectOf("/dp212-mover")).target).toBe("/dp212-moved");
    const slugRow = await owner.siteRedirect.findUniqueOrThrow({
      where: {
        siteId_sourcePath_sourceQuery: { siteId: BV, sourcePath: "/dp212-mover", sourceQuery: "" },
      },
    });
    expect(slugRow.origin).toBe("SLUG_CHANGE");
  });

  it("CSV: a 1000-row legacy map in one file, atomic, idempotent, stale plans refused", async () => {
    const header = "source,target,status,active,note";
    const rows = Array.from(
      { length: 1000 },
      (_, i) =>
        `/en/products/dp212-legacy-${i},/dp212-target,301,true,DP-212 legacy (product HIGH)`,
    );
    const csv = [header, ...rows].join("\r\n");
    expect(Buffer.byteLength(csv)).toBeGreaterThan(16 * 1024);
    // One bad row: the whole file is refused, nothing written.
    const bad = [
      header,
      ...rows.slice(0, 999),
      "/en/dp212-bad,https://evil.example/,301,true,",
    ].join("\n");
    const before = await owner.siteRedirect.count({ where: { siteId: BV } });
    const badDry = SeoRedirectImportResponseSchema.parse((await imp(bad, true)).body);
    expect(badDry.summary).toMatchObject({ rows: 1000, create: 999, error: 1 });
    expect(badDry.rows.find((r) => r.action === "error")).toMatchObject({
      line: 1001,
      errors: ["target:external"],
    });
    expectError(await imp(bad, false, badDry.planHash), 409, "CONFLICT_STATE", {
      path: "import",
      rule: "has_errors",
    });
    expect(await owner.siteRedirect.count({ where: { siteId: BV } })).toBe(before);

    const t0 = Date.now();
    const dry = SeoRedirectImportResponseSchema.parse((await imp(csv, true)).body);
    expect(dry.summary).toEqual({ rows: 1000, create: 1000, update: 0, unchanged: 0, error: 0 });
    const done = await imp(csv, false, dry.planHash);
    expect(done.status, JSON.stringify(done.body).slice(0, 500)).toBe(200);
    expect(SeoRedirectImportResponseSchema.parse(done.body).applied).toBe(true);
    expect(Date.now() - t0).toBeLessThan(45_000);
    expect(await owner.siteRedirect.count({ where: { siteId: BV } })).toBe(before + 1000);
    const one = await owner.siteRedirect.findUniqueOrThrow({
      where: {
        siteId_sourcePath_sourceQuery: {
          siteId: BV,
          sourcePath: "/en/products/dp212-legacy-999",
          sourceQuery: "",
        },
      },
    });
    expect(one).toMatchObject({
      origin: "IMPORT",
      target: "/dp212-target",
      statusCode: 301,
      active: true,
    });
    expect((await redirectOf("/EN/Products/DP212-Legacy-999")).target).toBe("/dp212-target");
    const audit = await lastAudit("seo.redirects_imported");
    // (The audit log stores the plan hash redacted.)
    expect(audit?.metadata).toMatchObject({ rows: 1000, create: 1000, error: 0 });

    // Re-import: nothing to write, no duplicates.
    const again = SeoRedirectImportResponseSchema.parse((await imp(csv, true)).body);
    expect(again.summary).toMatchObject({ create: 0, update: 0, unchanged: 1000, error: 0 });
    expect((await imp(csv, false, again.planHash)).status).toBe(200);
    expect(await owner.siteRedirect.count({ where: { siteId: BV } })).toBe(before + 1000);

    // Stale: a row changed after the dry-run.
    const edit = [header, "/en/products/dp212-legacy-0,/dp212-about,301,true,changed"].join("\n");
    const plan = SeoRedirectImportResponseSchema.parse((await imp(edit, true)).body);
    expect(plan.summary.update).toBe(1);
    const row0 = await owner.siteRedirect.findUniqueOrThrow({
      where: {
        siteId_sourcePath_sourceQuery: {
          siteId: BV,
          sourcePath: "/en/products/dp212-legacy-0",
          sourceQuery: "",
        },
      },
    });
    const upd = await manager.post(`${R()}/${row0.id}`, {
      ...body("/en/products/dp212-legacy-0", "/dp212-target", { note: "meanwhile" }),
      version: row0.version,
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expectError(await imp(edit, false, plan.planHash), 409, "CONFLICT_STATE", {
      path: "import",
      rule: "changed",
    });
    // Stale: the target's live state changed after the dry-run (warning part of the plan).
    const late = [header, "/en/dp212-late,/dp212-late,301,true,"].join("\n");
    const latePlan = SeoRedirectImportResponseSchema.parse((await imp(late, true)).body);
    expect(latePlan.rows[0]!.warnings).toEqual(["target:not_live"]);
    await livePage("dp212-late");
    expectError(await imp(late, false, latePlan.planHash), 409, "CONFLICT_STATE", {
      path: "import",
      rule: "changed",
    });
    const fresh = SeoRedirectImportResponseSchema.parse((await imp(late, true)).body);
    expect(fresh.rows[0]!.warnings).toEqual([]);
    expect((await imp(late, false, fresh.planHash)).status).toBe(200);
  });

  it("CSV limits: 1001 rows refused, the larger request limit only on the import route", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => `/en/dp212-x-${i},/dp212-target`);
    expectError(await imp(["source,target", ...rows].join("\n"), true), 400, "VALIDATION_FAILED", {
      path: "csv",
      rule: "too_many_rows",
    });
    // Over 128 KB of CSV: refused by the schema (400); over 320 KB of JSON: 413 before reading.
    const big = `source,target,note\n${`/en/dp212-y,/dp212-target,${"n".repeat(400)}\n`.repeat(330)}`;
    expect(Buffer.byteLength(big)).toBeGreaterThan(128 * 1024);
    expectError(await imp(big, true), 400, "VALIDATION_FAILED");
    expectError(await imp(big.repeat(3), true), 413, "PAYLOAD_TOO_LARGE");
    // Every other JSON route keeps 16 KB.
    expectError(
      await manager.post(R(), body("/dp212-z", "/dp212-target", { note: "n".repeat(17 * 1024) })),
      413,
      "PAYLOAD_TOO_LARGE",
    );
  });

  it("public regressions: sitemap lists live content only; unknown old addresses are 404", async () => {
    const paths = PublicSitemapResponseSchema.parse((await seo("/sitemap")).body).entries.map(
      (e) => e.path,
    );
    expect(paths).toContain("/dp212-target");
    expect(paths.some((p) => p.startsWith("/en/") || p === "/en" || p === "/tr")).toBe(false);
    for (const p of ["/tr/dp212-nope", "/EN/DP212-NOPE", "/assets/specs/dp212.pdf"]) {
      expectError(await resolve(p), 404, "NOT_FOUND");
    }
    // The Corporate site applies no redirects: its own resolve never answers old-site rows.
    expectError(await resolve("/en/dp212-about", "", TEST_KEYS.webCorporate), 404, "NOT_FOUND");
  });

  it("ML-4 (DP-237): the DEV transition with the real maps (DP-212 off, ML-4 on, rollback)", async () => {
    // The rows of docs/cms/legacy-url-map (generated fixture): the same imports the DEV step runs.
    const header = "source,target,status,active,note";
    const split = (pair: string) => pair.split(" ") as [string, string];
    const csv = (pairs: readonly string[], active: boolean, note: string) =>
      [header, ...pairs.map((p) => `${split(p).join(",")},301,${active},${note}`)].join("\n");
    const resolveSource = (source: string) => {
      const q = source.indexOf("?");
      return q === -1 ? resolve(source) : resolve(source.slice(0, q), source.slice(q + 1));
    };
    const run = async (text: string, rows: number) => {
      const dry = SeoRedirectImportResponseSchema.parse((await imp(text, true)).body);
      expect(dry.summary.rows).toBe(rows);
      expect(dry.summary.error, JSON.stringify(dry.rows.filter((r) => r.action === "error"))).toBe(
        0,
      );
      const done = await imp(text, false, dry.planHash);
      expect(done.status, JSON.stringify(done.body).slice(0, 500)).toBe(200);
      return dry.summary;
    };
    const activeOf = async (pairs: readonly string[]) => {
      let n = 0;
      for (const p of pairs) {
        const [source] = split(p);
        const q = source.indexOf("?");
        const row = await owner.siteRedirect.findUnique({
          where: {
            siteId_sourcePath_sourceQuery: {
              siteId: BV,
              sourcePath: q === -1 ? source : source.slice(0, q),
              sourceQuery: q === -1 ? "" : source.slice(q + 1),
            },
          },
        });
        if (row?.active) n++;
      }
      return n;
    };
    const ml4Sources = new Set(ML_4_PAIRS.map((p) => split(p)[0]));
    const dp212Only = DP_212_PAIRS.filter((p) => !ml4Sources.has(split(p)[0]));
    expect(DP_212_PAIRS).toHaveLength(83);
    expect(ML_4_PAIRS.length).toBeGreaterThan(0);

    // Today's DEV state: the 83 DP-212 rows.
    await run(csv(DP_212_PAIRS, true, "DP-212 legacy"), 83);
    expect(await activeOf(DP_212_PAIRS)).toBe(83);

    // Step 3: switch them off (same sources, active=false): nothing answers them any more.
    const off = await run(csv(DP_212_PAIRS, false, "DP-212 legacy"), 83);
    expect(off).toMatchObject({ update: 83, create: 0 });
    expect(await activeOf(DP_212_PAIRS)).toBe(0);
    for (const p of DP_212_PAIRS) expectError(await resolveSource(split(p)[0]), 404, "NOT_FOUND");

    // Step 5: import the ML-4 map; a second dry-run has nothing to write.
    const on = await run(csv(ML_4_PAIRS, true, "ML-4 legacy"), ML_4_PAIRS.length);
    expect(on.create + on.update + on.unchanged).toBe(ML_4_PAIRS.length);
    const again = SeoRedirectImportResponseSchema.parse(
      (await imp(csv(ML_4_PAIRS, true, "ML-4 legacy"), true)).body,
    );
    expect(again.summary).toMatchObject({ unchanged: ML_4_PAIRS.length, create: 0, update: 0 });
    for (const p of ML_4_PAIRS) {
      const [source, target] = split(p);
      const answer = await resolveSource(source);
      expect(answer.status, `${source} ${JSON.stringify(answer.body)}`).toBe(200);
      expect((answer.body.redirect as { target: string }).target, source).toBe(target);
    }
    // The old /en rows that ML-4 keeps as the site's own addresses stay off (no /en/x -> /x).
    // A query of a list whose plain row is on (`/tr/products?category=white-oil`) is answered by
    // that plain row (query kept), never by its own old target.
    expect(dp212Only.length).toBeGreaterThan(0);
    const ml4Plain = new Map(ML_4_PAIRS.map(split).filter(([s]) => !s.includes("?")));
    for (const p of dp212Only) {
      const [source] = split(p);
      const plainTarget = ml4Plain.get(source.split("?")[0]!);
      if (source.includes("?") && plainTarget !== undefined) {
        const answer = await resolveSource(source);
        expect(answer.status, source).toBe(200);
        expect((answer.body.redirect as { target: string }).target, source).toBe(plainTarget);
      } else {
        expectError(await resolveSource(source), 404, "NOT_FOUND");
      }
    }
    expect(await activeOf(ML_4_PAIRS)).toBe(ML_4_PAIRS.length);
    expect(await activeOf(dp212Only)).toBe(0);
    // No active row points at the source of another active row (site_redirect_no_chain).
    const active = await owner.siteRedirect.findMany({ where: { siteId: BV, active: true } });
    const plain = new Set(active.filter((r) => r.sourceQuery === "").map((r) => r.sourcePath));
    for (const r of active) expect(plain.has(r.target.split("?")[0]!), r.sourcePath).toBe(false);

    // Rollback: ML-4 off, DP-212 on again; the rows ML-4 added are off.
    await run(csv(ML_4_PAIRS, false, "ML-4 legacy"), ML_4_PAIRS.length);
    await run(csv(DP_212_PAIRS, true, "DP-212 legacy"), 83);
    expect(await activeOf(DP_212_PAIRS)).toBe(83);
    for (const p of DP_212_PAIRS) {
      const [source, target] = split(p);
      expect((await resolveSource(source)).body.redirect, source).toMatchObject({ target });
    }
    const dp212Sources = new Set(DP_212_PAIRS.map((p) => split(p)[0]));
    for (const p of ML_4_PAIRS.filter((x) => !dp212Sources.has(split(x)[0]))) {
      expectError(await resolveSource(split(p)[0]), 404, "NOT_FOUND");
    }

    // Leave both maps switched off for the sections that follow.
    await run(csv(DP_212_PAIRS, false, "DP-212 legacy"), 83);
    expect(await activeOf(DP_212_PAIRS)).toBe(0);
    expect(await activeOf(ML_4_PAIRS)).toBe(0);
  });
});

function randomUUIDLike(): string {
  const h = randomBytes(16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

describe("20. header and footer menus (DP-219)", () => {
  // Products and categories are written as dp_owner within the catalogue's own rules (the
  // publication guard checks an approved master and a visible current listing).
  let pageA: string; // a live content page, moved later
  let pageB: string; // a live content page, unpublished later
  let draftOnly: string; // never published
  let category: string;
  let product: string;
  let hiddenProduct: string; // listed on BV, never live
  let comCategory: string;
  const pageOf = async (id: string) => CmsPageResponseSchema.parse((await page(id)).body).page;
  const fragments = async () =>
    CmsPublicNewsSchema.parse((await pub("/news")).body).fragments as Record<
      string,
      { content: Record<string, unknown>; revisionNumber: number | null } | null
    >;
  const publicNav = async () =>
    BvNavPublicSchema.parse((await fragments())["bv.site-nav"]?.content);
  const publicFooter = async () =>
    BvFooterPublicSchema.parse((await fragments())["bv.site-footer"]?.content);
  async function livePage(slug: string, publish = true): Promise<string> {
    const created = await bvEditor.post(`/sites/${BV}/pages`, { title: `DP-219 ${slug}`, slug });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = CmsPageResponseSchema.parse(created.body).page.id;
    if (publish) {
      const p = await pageOf(id);
      const res = await bvPublisher.post(`/pages/${id}/publish`, { version: p.version });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    return id;
  }
  async function publishPage(id: string) {
    const p = await pageOf(id);
    const res = await bvPublisher.post(`/pages/${id}/publish`, { version: p.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return CmsPageResponseSchema.parse(res.body).page;
  }
  const saveMenu = async (id: string, content: unknown, as: Staff = bvEditor) => {
    const p = await pageOf(id);
    return as.post(`/pages/${id}/draft`, {
      version: p.version,
      title: p.title,
      seo: p.seo,
      content,
    });
  };
  const snapshot = (slug: string) => ({
    schemaVersion: 1,
    slug,
    code: "DP219-OIL",
    name: "DP-219 Oil",
    summary: null,
    description: null,
    category: { slug: "dp219-oils", name: "DP-219 oils" },
    sortOrder: 0,
    specs: [],
    images: [],
  });
  const link = (label: string, target: unknown, over: Record<string, unknown> = {}) => ({
    label,
    target,
    newTab: false,
    visible: true,
    ...over,
  });

  beforeAll(async () => {
    pageA = await livePage("dp219-a");
    pageB = await livePage("dp219-b");
    draftOnly = await livePage("dp219-draft", false);
    const now = new Date();
    category = (
      await owner.productCategory.create({
        data: { siteId: BV, name: "DP-219 oils", slug: "dp219-oils" },
      })
    ).id;
    comCategory = (
      await owner.productCategory.create({
        data: { siteId: COM, name: "DP-219 corporate", slug: "dp219-corp" },
      })
    ).id;
    const master = (code: string, slug: string) =>
      owner.product.create({
        data: {
          code,
          slug,
          name: `DP-219 ${code}`,
          status: "APPROVED",
          approvedAt: now,
          approvedById: root.userId,
          approvedVersion: 1,
        } as never,
      });
    product = (await master("DP219-OIL", "dp219-oil")).id;
    hiddenProduct = (await master("DP219-HID", "dp219-hidden")).id;
    const listing = await owner.productSiteListing.create({
      data: { productId: product, siteId: BV, categoryId: category, visibility: "VISIBLE" },
    });
    await owner.productSiteListing.create({
      data: { productId: hiddenProduct, siteId: BV, categoryId: category },
    });
    await owner.productPublication.create({
      data: {
        productId: product,
        siteId: BV,
        listingId: listing.id,
        status: "PUBLISHED",
        productVersion: 1,
        listingVersion: 1,
        snapshot: snapshot("dp219-oil"),
        imageIds: [],
        publishedAt: now,
        publishedById: root.userId,
      },
    });
  });

  it("menu targets: content:read of the site; products not live only with product:read", async () => {
    const asEditor = CmsMenuTargetsResponseSchema.parse(
      (await bvEditor.get(`/sites/${BV}/menu-targets`)).body,
    );
    expect(asEditor.productsComplete).toBe(true);
    expect(asEditor.pages.find((p) => p.id === pageA)).toMatchObject({
      livePath: "/dp219-a",
      status: "PUBLISHED",
    });
    expect(asEditor.pages.find((p) => p.id === draftOnly)).toMatchObject({
      livePath: null,
      status: "DRAFT",
    });
    expect(asEditor.pages.some((p) => p.id === navId)).toBe(false); // fragments are not targets
    expect(asEditor.products.find((p) => p.id === product)?.livePath).toBe("/products/dp219-oil");
    expect(asEditor.products.find((p) => p.id === hiddenProduct)?.livePath).toBeNull();
    expect(asEditor.categories.find((c) => c.id === category)).toMatchObject({
      path: "/products?category=dp219-oils",
      liveProducts: 1,
    });
    expect(asEditor.categories.some((c) => c.id === comCategory)).toBe(false);

    // content_publisher has no product:read: live products only.
    const asPublisher = CmsMenuTargetsResponseSchema.parse(
      (await bvPublisher.get(`/sites/${BV}/menu-targets`)).body,
    );
    expect(asPublisher.productsComplete).toBe(false);
    expect(asPublisher.products.map((p) => p.id)).toContain(product);
    expect(asPublisher.products.map((p) => p.id)).not.toContain(hiddenProduct);

    expectError(await nobody.get(`/sites/${BV}/menu-targets`), 403, "FORBIDDEN");
    expectError(await comEditor.get(`/sites/${BV}/menu-targets`), 403, "FORBIDDEN");
  });

  it("saves a header with a submenu, references, visibility and new tab; the draft stays off the site", async () => {
    const liveBefore = await publicNav();
    const content = {
      items: [
        link("Home", { type: "path", path: "#top" }),
        link(
          "Products",
          { type: "path", path: "/products" },
          {
            children: [
              link("DP-219 oils", { type: "category", categoryId: category }),
              link("DP-219 Oil", { type: "product", productId: product }),
              link("Hidden child", { type: "path", path: "/x" }, { visible: false }),
            ],
          },
        ),
        link("About", { type: "page", pageId: pageA }, { children: [] }),
        link(
          "Company",
          { type: "none" },
          {
            children: [link("Team", { type: "page", pageId: pageB })],
          },
        ),
        link(
          "Partner",
          { type: "url", url: "https://example.com/partner" },
          {
            newTab: true,
            children: [],
          },
        ),
        link("Secret", { type: "path", path: "/secret" }, { visible: false, children: [] }),
      ],
      contact: link("Contact", { type: "page", pageId: pageA }),
      noScriptLinks: [
        link("Home", { type: "path", path: "#top" }),
        link("Not ready", { type: "none" }),
        link("Draft page", { type: "page", pageId: draftOnly }),
      ],
      pendingNote: "This page isn't ready yet.",
    };
    const res = await saveMenu(navId, content);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const saved = CmsPageResponseSchema.parse(res.body).page;
    expect((saved.content["items"] as unknown[]).length).toBe(6);
    const row = await owner.cmsPage.findUniqueOrThrow({ where: { id: navId } });
    expect(row.schemaVersion).toBe(2);
    expect((await lastAudit("cms.page_draft_saved"))?.metadata).toMatchObject({
      changed: ["content"],
    });
    // The draft does not reach the site: the published navigation is unchanged.
    expect(await publicNav()).toEqual(liveBefore);
  });

  it("refuses references outside the site, unsafe addresses and broken limits", async () => {
    const nav = (await pageOf(navId)).content as Record<string, unknown>;
    const items = nav["items"] as Record<string, unknown>[];
    const withFirst = (patch: Record<string, unknown>) => ({
      ...nav,
      items: [{ ...items[0], ...patch }, ...items.slice(1)],
    });
    for (const target of [
      { type: "page", pageId: randomUUIDLike() },
      { type: "category", categoryId: comCategory },
      { type: "product", productId: randomUUIDLike() },
      { type: "page", pageId: footerId }, // a fragment is not a target
    ]) {
      const r = await saveMenu(navId, withFirst({ target }));
      expectError(r, 400, "VALIDATION_FAILED", {
        path: "content.items.0.target",
        rule: "unknown_reference",
      });
    }
    for (const target of [
      { type: "url", url: "javascript:alert(1)" },
      { type: "url", url: "http://example.com" },
      { type: "url", url: "//evil.example" },
      { type: "path", path: "https://example.com" },
      { type: "page", pageId: "not-a-uuid" },
    ]) {
      expectError(await saveMenu(navId, withFirst({ target })), 400, "VALIDATION_FAILED");
    }
    const many = Array.from({ length: 9 }, (_, i) => link(`C${i}`, { type: "none" }));
    expectError(await saveMenu(navId, withFirst({ children: many })), 400, "VALIDATION_FAILED");
    const nested = withFirst({ children: [{ ...link("x", { type: "none" }), children: [] }] });
    expectError(await saveMenu(navId, nested), 400, "VALIDATION_FAILED");
    // Only editors save drafts; a publisher's attempt is not found (and audited).
    expectError(await saveMenu(navId, nav, bvPublisher), 404, "NOT_FOUND");
  });

  it("publishes: hidden links dropped, references resolved now, submenus and new tab kept", async () => {
    const before = await owner.siteRedirect.count();
    const nav = await pageOf(navId);
    expectError(
      await bvEditor.post(`/pages/${navId}/publish`, { version: nav.version }),
      404,
      "NOT_FOUND",
    );
    await publishPage(navId);
    const live = await publicNav();
    expect(live.items.map((i) => i.label)).toEqual([
      "Home",
      "Products",
      "About",
      "Company",
      "Partner",
    ]);
    expect(live.items[1]).toEqual({
      label: "Products",
      href: "/products",
      newTab: false,
      children: [
        { label: "DP-219 oils", href: "/products?category=dp219-oils", newTab: false },
        { label: "DP-219 Oil", href: "/products/dp219-oil", newTab: false },
      ],
    });
    expect(live.items[2]).toMatchObject({ href: "/dp219-a", children: [] });
    expect(live.items[3]).toMatchObject({
      href: null,
      children: [{ label: "Team", href: "/dp219-b", newTab: false }],
    });
    expect(live.items[4]).toMatchObject({ href: "https://example.com/partner", newTab: true });
    expect(live.contact).toEqual({ label: "Contact", href: "/dp219-a", newTab: false });
    // Without JavaScript only real destinations: "not ready" and the draft page are left out.
    expect(live.noScriptLinks.map((l) => l.label)).toEqual(["Home"]);
    expect(JSON.stringify(live)).not.toMatch(/pageId|productId|categoryId|Secret|Hidden child/);
    // Publishing a menu writes no redirect.
    expect(await owner.siteRedirect.count()).toBe(before);
    expect(
      (
        await owner.cmsPageRevision.findFirstOrThrow({
          where: { pageId: navId },
          orderBy: { revisionNumber: "desc" },
        })
      ).schemaVersion,
    ).toBe(2);
    expect((await lastAudit("cms.page_published"))?.resourceId).toBe(navId);
  });

  it("follows slug changes of pages and products without republishing the menu", async () => {
    const moved = await pageOf(pageA);
    const save = await bvEditor.post(`/pages/${pageA}/draft`, {
      version: moved.version,
      title: moved.title,
      slug: "dp219-a-moved",
      seo: SEO,
      content: moved.content,
    });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    // A draft slug is not live: the menu keeps the live address.
    expect((await publicNav()).items[2]?.href).toBe("/dp219-a");
    await publishPage(pageA);
    const nav = await publicNav();
    expect(nav.items[2]?.href).toBe("/dp219-a-moved");
    expect(nav.contact?.href).toBe("/dp219-a-moved");

    // A product published again under a new slug.
    await owner.productPublication.update({
      where: { productId_siteId: { productId: product, siteId: BV } },
      data: { snapshot: snapshot("dp219-oil-v2"), publishedAt: new Date() },
    });
    expect((await publicNav()).items[1]?.children[1]?.href).toBe("/products/dp219-oil-v2");
  });

  it("shows content that is no longer live as text; the admin sees why", async () => {
    const b = await pageOf(pageB);
    const off = await bvPublisher.post(`/pages/${pageB}/unpublish`, {
      publicationVersion: b.publication!.version,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    await owner.productPublication.update({
      where: { productId_siteId: { productId: product, siteId: BV } },
      data: { status: "UNPUBLISHED", unpublishedAt: new Date(), unpublishedById: root.userId },
    });
    const nav = await publicNav();
    expect(nav.items[3]?.children[0]).toEqual({ label: "Team", href: null, newTab: false });
    expect(nav.items[1]?.children[1]).toEqual({ label: "DP-219 Oil", href: null, newTab: false });
    const targets = CmsMenuTargetsResponseSchema.parse(
      (await bvEditor.get(`/sites/${BV}/menu-targets`)).body,
    );
    expect(menuTargetCheck({ type: "page", pageId: pageB }, targets).problem).toBe(
      "page_unpublished",
    );
    expect(menuTargetCheck({ type: "product", productId: product }, targets).problem).toBe(
      "product_not_live",
    );
    expect(menuTargetCheck({ type: "category", categoryId: category }, targets).problem).toBe(
      "category_empty",
    );
    // The draft with these references still saves: the warning is the admin's, not a refusal.
    const nav2 = await pageOf(navId);
    expect((await saveMenu(navId, nav2.content)).status).toBe(200);
  });

  it("footer: columns, visibility, social links and contact details; contact page keeps them", async () => {
    const f = await pageOf(footerId);
    const c = f.content as Record<string, unknown> & {
      contact: Record<string, Record<string, unknown>>;
      columns: { title: string; links: unknown[] }[];
    };
    const content = {
      ...c,
      cta: { label: "Get in Touch", target: { type: "page", pageId: pageA }, newTab: false },
      contact: { ...c.contact, phone: { ...c.contact["phone"], visible: false } },
      columns: [
        { ...c.columns[1]!, visible: true },
        { ...c.columns[0]!, visible: false },
        {
          title: "DP-219",
          visible: true,
          links: [
            link("Oils", { type: "category", categoryId: category }),
            link("Hidden", { type: "path", path: "/x" }, { visible: false }),
          ],
        },
      ],
      social: [
        {
          network: "linkedin",
          label: "LinkedIn",
          url: "https://www.linkedin.com/company/x",
          visible: true,
        },
        { network: "x", label: "X", url: "https://x.com/x", visible: false },
      ],
    };
    expectError(
      await saveMenu(footerId, { ...content, cta: { ...content.cta, target: { type: "none" } } }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await saveMenu(footerId, {
        ...content,
        social: [{ network: "x", label: "X", url: "http://x.com/x", visible: true }],
      }),
      400,
      "VALIDATION_FAILED",
    );
    const res = await saveMenu(footerId, content);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await publishPage(footerId);
    const live = await publicFooter();
    expect(live.cta).toEqual({ label: "Get in Touch", href: "/dp219-a-moved", newTab: false });
    expect(live.columns.map((col) => col.title)).toEqual([c.columns[1]!.title, "DP-219"]);
    expect(live.columns[1]!.links).toEqual([
      { label: "Oils", href: "/products?category=dp219-oils", newTab: false },
    ]);
    expect(live.social).toEqual([
      { network: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/company/x" },
    ]);
    // Hidden in the footer only: the details stay for the contact page.
    expect(live.contact.phone).toMatchObject({ href: "tel:+31202101350", visible: false });
    expect(live.contact.email.visible).toBe(true);
  });

  it("reads version 1 revisions as before and restores them as version 2 drafts", async () => {
    // A revision as DEV holds it today (DP-134 content: label + href), published.
    const last = await owner.cmsPageRevision.findFirstOrThrow({
      where: { pageId: navId },
      orderBy: { revisionNumber: "desc" },
    });
    const v1 = {
      items: [
        { label: "Home", href: "#top" },
        { label: "Products", href: "/products" },
        { label: "Company", href: "/about-us" },
        { label: "Blogs", href: "/news" },
        { label: "Soon", href: null },
      ],
      contact: { label: "Contact", href: "/contact" },
      noScriptLinks: [
        { label: "Home", href: "#top" },
        { label: "Services", href: "/#services" },
      ],
      pendingNote: "This page isn't ready yet.",
    };
    const rev = await owner.cmsPageRevision.create({
      data: {
        pageId: navId,
        siteId: BV,
        revisionNumber: last.revisionNumber + 1,
        pageVersion: last.pageVersion,
        title: "Navigation",
        noindex: false,
        content: v1,
        schemaVersion: 1,
        createdById: root.userId,
      },
    });
    await owner.cmsPagePublication.update({
      where: { pageId: navId },
      data: { revisionId: rev.id },
    });
    const nav = await publicNav();
    expect(nav.items.map((i) => [i.label, i.href])).toEqual([
      ["Home", "#top"],
      ["Products", "/products"],
      ["Company", "/about-us"],
      ["Blogs", "/news"],
      ["Soon", null],
    ]);
    expect(nav.items.every((i) => i.children.length === 0 && !i.newTab)).toBe(true);
    expect(nav.contact).toEqual({ label: "Contact", href: "/contact", newTab: false });

    const draft = await pageOf(navId);
    const restored = await bvEditor.post(`/pages/${navId}/restore`, {
      version: draft.version,
      revisionNumber: rev.revisionNumber,
    });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    const after = CmsPageResponseSchema.parse(restored.body).page;
    expect((after.content["items"] as { target: unknown }[])[2]?.target).toEqual({
      type: "path",
      path: "/about-us",
    });
    expect((after.content["items"] as { target: unknown }[])[4]?.target).toEqual({
      type: "none",
    });
    expect((await owner.cmsPage.findUniqueOrThrow({ where: { id: navId } })).schemaVersion).toBe(2);
    expect((await lastAudit("cms.page_revision_restored"))?.metadata).toMatchObject({
      revisionNumber: rev.revisionNumber,
    });
    // Restoring changes the draft only: the site still shows the published revision.
    expect((await fragments())["bv.site-nav"]?.revisionNumber).toBe(rev.revisionNumber);
  });

  it("the reference conversion keeps every address and is idempotent", async () => {
    // pageA now lives at /dp219-a-moved; the category at /products?category=dp219-oils.
    const draft = await pageOf(navId);
    const content = {
      ...(draft.content as Record<string, unknown>),
      items: [
        link("Home", { type: "path", path: "#top" }, { children: [] }),
        link("Moved", { type: "path", path: "/dp219-a-moved" }, { children: [] }),
        link("Oils", { type: "path", path: "/products?category=dp219-oils" }, { children: [] }),
        link("Catalogue", { type: "path", path: "/products" }, { children: [] }),
      ],
    };
    expect((await saveMenu(navId, content)).status).toBe(200);
    const targets = CmsMenuTargetsResponseSchema.parse(
      (await bvEditor.get(`/sites/${BV}/menu-targets`)).body,
    );
    const parsed = BvNavMenuSchema.parse((await pageOf(navId)).content);
    const plan = menuReferencePlan("bv.site-nav", parsed, targets);
    const byPath = Object.fromEntries(plan.changes.map((ch) => [ch.path, ch]));
    expect(byPath["items.1"]?.to).toEqual({ type: "page", pageId: pageA });
    expect(byPath["items.2"]?.to).toEqual({ type: "category", categoryId: category });
    // Anchors and site routes stay fixed paths.
    expect(byPath["items.0"]).toBeUndefined();
    expect(byPath["items.3"]).toBeUndefined();
    // Every conversion keeps the address the link opens now.
    for (const ch of plan.changes) expect(menuTargetCheck(ch.to, targets).href).toBe(ch.from);
    expect(menuReferencePlan("bv.site-nav", plan.content, targets).changes).toEqual([]);
    expect((await saveMenu(navId, plan.content)).status).toBe(200);
    await publishPage(navId);
    const live = await publicNav();
    expect(live.items.map((i) => i.href)).toEqual([
      "#top",
      "/dp219-a-moved",
      "/products?category=dp219-oils",
      "/products",
    ]);
  });
});

/** ML-8b: the rollback statements of migration 40 from its header comment (before ML-8a's). */
/**
 * ML-10: the rollback statements of migration 42 from its header comment. Migration 42 adds
 * foreign keys from LeadDocumentRequest and LeadContactMessage to SiteLocale, so ML-1's rollback
 * runs after it.
 */
function ml10RollbackStatements(): string[] {
  const sql = readFileSync(
    path.join(API_DIR, "prisma/migrations/20261215090000_ml_10_form_locale/migration.sql"),
    "utf8",
  );
  return sql
    .split("-- Rollback")[1]!
    .split("-- ===")[0]!
    .split("\n")
    .filter((l) => l.startsWith("--   ") && !l.startsWith("--   ("))
    .map((l) => l.slice(5).trim().replace(/;$/, ""));
}

function ml8bRollbackStatements(): string[] {
  const sql = readFileSync(
    path.join(API_DIR, "prisma/migrations/20261213090000_ml_8b_translation_source/migration.sql"),
    "utf8",
  );
  return sql
    .split("-- Rollback")[1]!
    .split("-- ML-8a (39)")[0]!
    .split("\n")
    .filter((l) => l.startsWith("--   ") && !l.startsWith("--   ("))
    .map((l) => l.slice(5).trim().replace(/;$/, ""));
}

/**
 * ML-8a: the rollback statements of migration 39 from its header comment. Migration 39 adds
 * foreign keys from ProductListingText and ProductCategoryText to SiteLocale, so ML-1's rollback
 * runs after it (39, 38, then 37).
 */
function ml8aRollbackStatements(): string[] {
  const sql = readFileSync(
    path.join(API_DIR, "prisma/migrations/20261212090000_ml_8a_catalog_texts/migration.sql"),
    "utf8",
  );
  const block = sql.split("-- Rollback")[1]!.split("-- ===")[0]!;
  return block
    .split("\n")
    .filter((l) => l.startsWith("--   "))
    .map((l) => l.slice(5))
    .filter((l) => !l.startsWith("("))
    .join("\n")
    .split(/;\s*\n/)
    .map((st) => st.trim().replace(/;$/, ""))
    .filter(Boolean);
}

/**
 * ML-2: the rollback statements of migration 38 from its header comment. Migration 38 adds a
 * foreign key from CmsPage to SiteLocale, so ML-1's rollback runs after it (38, then 37).
 */
function ml2RollbackStatements(): string[] {
  const sql = readFileSync(
    path.join(
      API_DIR,
      "prisma/migrations/20261211090000_ml_2_cms_translation_groups/migration.sql",
    ),
    "utf8",
  );
  const block = sql.split("-- Rollback")[1]!.split("-- ===")[0]!;
  return block
    .split("\n")
    .filter((l) => l.startsWith("--   "))
    .map((l) => l.slice(5))
    .filter((l) => !l.startsWith("("))
    .join("\n")
    .split(/;\s*\n/)
    .map((st) => st.trim().replace(/;$/, ""))
    .filter(Boolean);
}

describe("21. site languages (ML-1, DP-073, ADR-028 D2)", () => {
  const MIGRATION = "20261210090000_ml_1_site_locales";
  const rowsOf = async () =>
    (
      await owner.siteLocale.findMany({
        orderBy: [{ siteId: "asc" }, { sortOrder: "asc" }],
        select: {
          siteId: true,
          locale: true,
          enabled: true,
          public: true,
          isDefault: true,
          sortOrder: true,
        },
      })
    ).map((r) => ({ ...r, site: r.siteId === BV ? "BV" : r.siteId === COM ? "COM" : r.siteId }));
  const EXPECTED = [
    { site: "BV", locale: "en", enabled: true, public: true, isDefault: true, sortOrder: 0 },
    { site: "BV", locale: "nl", enabled: true, public: false, isDefault: false, sortOrder: 10 },
    { site: "COM", locale: "en", enabled: true, public: true, isDefault: true, sortOrder: 0 },
    // COM-1 (contract 3.2 b): Turkish from the catalogue sync, for editing, not public.
    { site: "COM", locale: "tr", enabled: true, public: false, isDefault: false, sortOrder: 10 },
  ];
  const shape = (rows: Awaited<ReturnType<typeof rowsOf>>) =>
    rows
      .map(({ siteId: _s, ...r }) => {
        void _s;
        return r;
      })
      .sort((a, b) => a.site.localeCompare(b.site) || a.sortOrder - b.sortOrder);

  /** Runs `fn` in a transaction that is always rolled back. */
  async function rolledBack(fn: (tx: PrismaClient) => Promise<void>): Promise<void> {
    await expect(
      owner.$transaction(
        async (tx) => {
          await fn(tx as unknown as PrismaClient);
          throw new Error("rolled back by the test");
        },
        { timeout: 60_000 },
      ),
    ).rejects.toThrow("rolled back by the test");
  }

  /** Statements of a migration file: comments dropped, `;` inside $$ bodies kept. */
  function statements(sql: string): string[] {
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
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  it("seeds BV with English (default, public) and Dutch (enabled, not public); Corporate keeps English only", async () => {
    expect(shape(await rowsOf())).toEqual(EXPECTED);
    const sites = await owner.site.findMany({ select: { key: true, defaultLocale: true } });
    expect(sites.map((s) => [s.key, s.defaultLocale]).sort()).toEqual([
      ["BV", "en"],
      ["CORPORATE", "en"],
    ]);
  });

  it("refuses a bad tag, public without enabled, a hidden default and a second default", async () => {
    await rejectsDb(
      owner.siteLocale.create({ data: { siteId: COM, locale: "EN" } }),
      /SiteLocale_locale_format/,
    );
    await rejectsDb(
      owner.siteLocale.create({ data: { siteId: COM, locale: "de", public: true } }),
      /SiteLocale_public_enabled/,
    );
    await rejectsDb(
      owner.siteLocale.create({
        data: { siteId: COM, locale: "fr", enabled: true, isDefault: true },
      }),
      /SiteLocale_default_public/,
    );
    await rejectsDb(
      owner.siteLocale.create({
        data: { siteId: COM, locale: "fr", enabled: true, public: true, isDefault: true },
      }),
      /SiteLocale_default_siteId_key|Unique constraint|P2002/,
    );
    await rejectsDb(
      owner.siteLocale.update({
        where: { siteId_locale: { siteId: BV, locale: "nl" } },
        data: { sortOrder: 5000 },
      }),
      /SiteLocale_sort_order/,
    );
    expect(shape(await rowsOf())).toEqual(EXPECTED);
  });

  it("keeps exactly one default per site, equal to Site.defaultLocale (checked at commit)", async () => {
    // No default left.
    await rejectsDb(
      owner.siteLocale.update({
        where: { siteId_locale: { siteId: BV, locale: "en" } },
        data: { isDefault: false },
      }),
      /SiteLocale_one_default/,
    );
    await rejectsDb(
      owner.siteLocale.delete({ where: { siteId_locale: { siteId: COM, locale: "en" } } }),
      /SiteLocale_one_default/,
    );
    // Dutch as default while the site still says English.
    await rejectsDb(
      owner.$transaction(async (tx) => {
        await tx.siteLocale.update({
          where: { siteId_locale: { siteId: BV, locale: "en" } },
          data: { isDefault: false },
        });
        await tx.siteLocale.update({
          where: { siteId_locale: { siteId: BV, locale: "nl" } },
          data: { isDefault: true, public: true },
        });
      }),
      /SiteLocale_matches_site/,
    );
    // The site's column alone cannot move away from its default row either.
    await rejectsDb(
      owner.site.update({ where: { id: BV }, data: { defaultLocale: "nl" } }),
      /SiteLocale_matches_site/,
    );
    expect(shape(await rowsOf())).toEqual(EXPECTED);
    expect((await owner.site.findUniqueOrThrow({ where: { id: BV } })).defaultLocale).toBe("en");
  });

  it("lets dp_app read the languages and nothing else", async () => {
    // BV en + nl, Corporate en + tr (COM-1).
    expect(await asApp.siteLocale.count()).toBe(4);
    await rejectsDb(
      asApp.siteLocale.update({
        where: { siteId_locale: { siteId: BV, locale: "nl" } },
        data: { public: true },
      }),
      /permission denied/i,
    );
    await rejectsDb(
      asApp.siteLocale.create({ data: { siteId: COM, locale: "nl", enabled: true } }),
      /permission denied/i,
    );
    await rejectsDb(asApp.siteLocale.deleteMany({ where: { locale: "nl" } }), /permission denied/i);
    const rights = await owner.$queryRaw<{ p: string }[]>`
      SELECT privilege_type AS p FROM information_schema.role_table_grants
      WHERE grantee = 'dp_app' AND table_name = 'SiteLocale' ORDER BY 1`;
    expect(rights.map((r) => r.p)).toEqual(["SELECT"]);
    // The trigger functions are callable by no application role.
    const exec = await owner.$queryRaw<{ f: string; n: bigint }[]>`
      SELECT p.proname::text AS f, count(r.oid) FILTER (
               WHERE has_function_privilege(r.oid, p.oid, 'EXECUTE'))::bigint AS n
      FROM pg_proc p CROSS JOIN pg_roles r
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'site_locale_%'
        AND r.rolname IN ('dp_app', 'dp_iam_bootstrap', 'dp_lead_retention')
      GROUP BY p.proname ORDER BY 1`;
    expect(exec.map((r) => [r.f, Number(r.n)])).toEqual([
      ["site_locale_check_site", 0],
      ["site_locale_consistent", 0],
      ["site_locale_default_row", 0],
    ]);
    expect(shape(await rowsOf())).toEqual(EXPECTED);
  });

  it("the catalogue sync only adds a missing language and never changes one", async () => {
    await owner.siteLocale.update({
      where: { siteId_locale: { siteId: BV, locale: "nl" } },
      data: { sortOrder: 20 },
    });
    try {
      const sync = cli(["sync", "--confirm-database", DB_NAME], {
        MIGRATE_DATABASE_URL: urls.migrate,
      });
      expect(sync.status, sync.err).toBe(0);
      expect(JSON.parse(sync.out).siteLocalesAdded).toBe(0);
      const nl = await owner.siteLocale.findUniqueOrThrow({
        where: { siteId_locale: { siteId: BV, locale: "nl" } },
      });
      expect([nl.sortOrder, nl.public, nl.enabled]).toEqual([20, false, true]);
    } finally {
      await owner.siteLocale.update({
        where: { siteId_locale: { siteId: BV, locale: "nl" } },
        data: { sortOrder: 10 },
      });
    }
    expect(shape(await rowsOf())).toEqual(EXPECTED);
  });

  it("rehearses the rollback and a re-run of the migration on existing sites (rolled back)", async () => {
    const sql = readFileSync(
      path.join(API_DIR, "prisma/migrations", MIGRATION, "migration.sql"),
      "utf8",
    );
    const rollback = /-- Rollback[^\n]*\n((?:--[^\n]*\n)+)/
      .exec(sql)?.[1]
      ?.split("\n")
      .map((l) => l.replace(/^--\s?/, "").trim())
      .filter(Boolean);
    expect(rollback?.length).toBe(4);
    const sitesBefore = await owner.site.findMany({ orderBy: { key: "asc" } });
    const pagesBefore = await owner.cmsPage.count();
    await rolledBack(async (tx) => {
      // ML-10 (42) first (lead language foreign keys), then ML-8b (40) (its columns live on
      // ML-8a's tables), then ML-8a, then ML-2: their foreign keys to SiteLocale depend on the table.
      const ml10 = ml10RollbackStatements();
      expect(ml10).toEqual([
        'ALTER TABLE "LeadContactMessage" DROP COLUMN "locale"',
        'ALTER TABLE "LeadDocumentRequest" DROP COLUMN "locale"',
      ]);
      for (const stmt of ml10) await tx.$executeRawUnsafe(stmt);
      const ml8b = ml8bRollbackStatements();
      expect(ml8b).toHaveLength(4);
      for (const stmt of ml8b) await tx.$executeRawUnsafe(stmt);
      const ml8a = ml8aRollbackStatements();
      expect(ml8a).toHaveLength(15);
      for (const stmt of ml8a) await tx.$executeRawUnsafe(stmt);
      for (const stmt of ml2RollbackStatements()) await tx.$executeRawUnsafe(stmt);
      for (const stmt of rollback ?? []) await tx.$executeRawUnsafe(stmt);
      const left = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM pg_class WHERE relname = 'SiteLocale'`;
      expect(Number(left[0]?.n)).toBe(0);
      const fns = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM pg_proc WHERE proname LIKE 'site_locale_%'`;
      expect(Number(fns[0]?.n)).toBe(0);
      // Sites and content are untouched by the rollback.
      expect(await tx.site.findMany({ orderBy: { key: "asc" } })).toEqual(sitesBefore);
      expect(await tx.cmsPage.count()).toBe(pagesBefore);
      // Forward again, now over existing sites (the DEV case): the seed rows come from Part 3.
      for (const stmt of statements(sql)) await tx.$executeRawUnsafe(stmt);
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      const again = await tx.siteLocale.findMany({ select: { siteId: true, locale: true } });
      expect(again.map((r) => `${r.siteId === BV ? "BV" : "COM"}:${r.locale}`).sort()).toEqual([
        "BV:en",
        "BV:nl",
        "COM:en",
      ]);
      expect(await tx.site.findMany({ orderBy: { key: "asc" } })).toEqual(sitesBefore);
    });
    expect(shape(await rowsOf())).toEqual(EXPECTED);
  });

  it("shows each readable site's languages in the CMS context, read only and site-scoped", async () => {
    const bv = CmsContextResponseSchema.parse((await bvReader.get("/context")).body);
    expect(bv.sites.map((s) => s.key)).toEqual(["BV"]);
    expect(bv.sites[0]?.locales).toEqual([
      { locale: "en", enabled: true, public: true, isDefault: true, sortOrder: 0 },
      { locale: "nl", enabled: true, public: false, isDefault: false, sortOrder: 10 },
    ]);
    const com = CmsContextResponseSchema.parse((await comEditor.get("/context")).body);
    expect(com.sites.map((s) => [s.key, s.locales.map((l) => l.locale)])).toEqual([
      ["CORPORATE", ["en", "tr"]],
    ]);
    const all = CmsContextResponseSchema.parse((await root.get("/context")).body);
    expect(all.sites.map((s) => [s.key, s.locales.length])).toEqual([
      ["BV", 2],
      ["CORPORATE", 2],
    ]);
    expect(CmsContextResponseSchema.parse((await nobody.get("/context")).body).sites).toEqual([]);
    // The page response carries the same read-only list (no route changes a language).
    const list = await bvEditor.get(`/sites/${BV}/pages`);
    expect(list.status).toBe(200);
    expect(list.body.site.locales.map((l: { locale: string }) => l.locale)).toEqual(["en", "nl"]);
    for (const p of [`/sites/${BV}/locales`, `/sites/${BV}/locales/nl`]) {
      expect((await root.post(p, { public: true })).status).toBe(404);
    }
  });

  it("lists only public languages on the public sites; Dutch never appears", async () => {
    const bv = PublicSiteLocalesResponseSchema.parse((await pub("/locales")).body);
    expect(bv).toEqual({ defaultLocale: "en", locales: [{ locale: "en", isDefault: true }] });
    const com = PublicSiteLocalesResponseSchema.parse(
      (await pub("/locales", TEST_KEYS.webCorporate)).body,
    );
    expect(com).toEqual({ defaultLocale: "en", locales: [{ locale: "en", isDefault: true }] });
    expect(JSON.stringify((await pub("/locales")).body)).not.toContain('"nl"');
    // Without a site key there is no answer.
    const bare = await fetch(`${base}/api/v1/public/cms/locales`);
    expect(bare.status).not.toBe(200);
  });

  const seoGet = (p: string) =>
    fetch(`${base}/api/v1/public/seo${p}`, {
      headers: { "x-dp-proxy-key": TEST_KEYS.webBv, "x-dp-client-ip": "10.20.30.43" },
    }).then(parse);
  const sitemapPaths = async () =>
    PublicSitemapResponseSchema.parse((await seoGet("/sitemap")).body).entries.map((e) => e.path);
  const nlPage = (title: string) =>
    row({ locale: "nl", title, content: { sections: [{ ...HERO, title }] } });

  it("Dutch (enabled, not public): draft, preview, publish, history, restore and unpublish work for staff; visitors get 404", async () => {
    const p = await nlPage("Over ons (ML-1 probe)");
    // Draft.
    const draft = await bvEditor.post(`/pages/${p.id}/draft`, {
      version: p.version,
      title: "Over ons (ML-1 probe, v2)",
      slug: p.path!.slice(1),
      seo: SEO,
      content: { sections: [{ ...HERO, title: "Wie wij zijn" }] },
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    const v2 = CmsPageResponseSchema.parse(draft.body).page;
    expect(v2.locale).toBe("nl");
    // Authorised preview of the draft (signed link) shows it; the site key alone does not.
    const pre = await bvReader.post(`/pages/${p.id}/preview`, {});
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    const token = CmsPreviewResponseSchema.parse(pre.body).url.split("/preview/")[1]!;
    const view = await pub(`/preview/${token}`);
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(CmsPublicBundleSchema.parse(view.body).page.title).toBe("Over ons (ML-1 probe, v2)");
    // Publish: allowed, recorded as a normal publication.
    const published = await bvPublisher.post(`/pages/${p.id}/publish`, { version: v2.version });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    const live = CmsPageResponseSchema.parse(published.body).page;
    expect(live.publication).toMatchObject({ status: "PUBLISHED", revisionNumber: 1 });
    expect(await owner.cmsPageRevision.count({ where: { pageId: p.id } })).toBe(1);
    // The admin sees it as live; visitors do not: page, resolve, sitemap, news.
    // ML-2: the admin lists one language at a time (`?locale=nl`).
    const listed = CmsPageListResponseSchema.parse(
      (await bvReader.get(`/sites/${BV}/pages?locale=nl`)).body,
    );
    expect(listed.items.find((i) => i.id === p.id)?.publication?.status).toBe("PUBLISHED");
    const page = await pub(`/page?path=${p.path}`);
    expectError(page, 404, "NOT_FOUND");
    expect(page.body.error.details).toEqual([]);
    expectError(await seoGet(`/resolve?path=${encodeURIComponent(p.path!)}`), 404, "NOT_FOUND");
    expect(await sitemapPaths()).not.toContain(p.path);
    expect(JSON.stringify((await pub("/news")).body)).not.toContain(p.path!);
    // History and restore work.
    const history = CmsHistoryResponseSchema.parse(
      (await bvReader.get(`/pages/${p.id}/history`)).body,
    );
    expect(history.revisions.map((r) => r.revisionNumber)).toEqual([1]);
    const restored = await bvEditor.post(`/pages/${p.id}/restore`, {
      version: live.version,
      revisionNumber: 1,
    });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    // Take back: allowed; the address stays a plain 404 (no `unpublished` hint for a hidden language).
    const after = CmsPageResponseSchema.parse(restored.body).page;
    const off = await bvPublisher.post(`/pages/${p.id}/unpublish`, {
      publicationVersion: after.publication!.version,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(CmsPageResponseSchema.parse(off.body).page.publication?.status).toBe("UNPUBLISHED");
    const gone = await pub(`/page?path=${p.path}`);
    expectError(gone, 404, "NOT_FOUND");
    expect(gone.body.error.details).toEqual([]);
    const goneSeo = await seoGet(`/resolve?path=${encodeURIComponent(p.path!)}`);
    expectError(goneSeo, 404, "NOT_FOUND");
    expect(goneSeo.body.error.details).toEqual([]);
    expect(shape(await rowsOf())).toEqual(EXPECTED);
  });

  it("a language that is not enabled is closed to editing, preview and publication", async () => {
    // ML-2: a page's language must be a language of its site (foreign key), so the probe adds a
    // closed German row for the duration of the test (as dp_owner).
    await owner.siteLocale.create({
      data: { siteId: BV, locale: "de", enabled: false, public: false, sortOrder: 20 },
    });
    const de = await row({ locale: "de", title: "Probe de", content: { sections: [HERO] } });
    const rule = { path: "locale", rule: "not_enabled" };
    const draftBody = {
      version: de.version,
      title: "x",
      slug: de.path!.slice(1),
      seo: SEO,
      content: { sections: [HERO] },
    };
    expectError(
      await bvEditor.post(`/pages/${de.id}/draft`, draftBody),
      409,
      "CONFLICT_STATE",
      rule,
    );
    expectError(await bvReader.post(`/pages/${de.id}/preview`, {}), 409, "CONFLICT_STATE", rule);
    expectError(
      await bvPublisher.post(`/pages/${de.id}/publish`, { version: de.version }),
      409,
      "CONFLICT_STATE",
      rule,
    );
    // Dutch switched off for a moment (as dp_owner; no API route can do it): closed too.
    const nl = await nlPage("Probe nl closed");
    await owner.siteLocale.update({
      where: { siteId_locale: { siteId: BV, locale: "nl" } },
      data: { enabled: false },
    });
    try {
      expectError(
        await bvPublisher.post(`/pages/${nl.id}/publish`, { version: nl.version }),
        409,
        "CONFLICT_STATE",
        rule,
      );
      expectError(await bvReader.post(`/pages/${nl.id}/preview`, {}), 409, "CONFLICT_STATE", rule);
    } finally {
      await owner.siteLocale.update({
        where: { siteId_locale: { siteId: BV, locale: "nl" } },
        data: { enabled: true },
      });
    }
    for (const id of [de.id, nl.id]) {
      expect(await owner.cmsPagePublication.count({ where: { pageId: id } })).toBe(0);
    }
    await owner.cmsPage.delete({ where: { id: de.id } });
    await owner.siteLocale.delete({ where: { siteId_locale: { siteId: BV, locale: "de" } } });
    expect(shape(await rowsOf())).toEqual(EXPECTED);
  });

  it("English is unchanged: published English stays visible on the site, resolve and sitemap", async () => {
    const en = await row({ locale: "en", title: "Locale probe en", content: { sections: [HERO] } });
    const ok = await bvPublisher.post(`/pages/${en.id}/publish`, { version: en.version });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await pub(`/page?path=${en.path}`)).status).toBe(200);
    expect((await seoGet(`/resolve?path=${encodeURIComponent(en.path!)}`)).status).toBe(200);
    expect(await sitemapPaths()).toContain(en.path);
  });
});

// ---------------------------------------------------------------------------------------------
// ML-2 (DP-074, ADR-028 D6/D7): CMS pages per language and translation groups
// ---------------------------------------------------------------------------------------------

describe("22. translation groups and pages per language (ML-2, DP-074, ADR-028 D6)", () => {
  const MIGRATION = "20261211090000_ml_2_cms_translation_groups";
  const seoGet = (p: string) =>
    fetch(`${base}/api/v1/public/seo${p}`, {
      headers: { "x-dp-proxy-key": TEST_KEYS.webBv, "x-dp-client-ip": "10.20.30.44" },
    }).then(parse);
  const pageOf = async (id: string) => CmsPageResponseSchema.parse((await page(id)).body);

  /** Every column of the English CMS rows (pages, revisions, publications), hashed. */
  async function englishHash(): Promise<string> {
    const pages = await owner.cmsPage.findMany({ where: { locale: "en" }, orderBy: { id: "asc" } });
    const ids = pages.map((p) => p.id);
    const [revisions, pubs] = await Promise.all([
      owner.cmsPageRevision.findMany({ where: { pageId: { in: ids } }, orderBy: { id: "asc" } }),
      owner.cmsPagePublication.findMany({ where: { pageId: { in: ids } }, orderBy: { id: "asc" } }),
    ]);
    return createHash("sha256").update(JSON.stringify({ pages, revisions, pubs })).digest("hex");
  }

  /** Runs `fn` in a transaction that is always rolled back. */
  async function rolledBack(fn: (tx: PrismaClient) => Promise<void>): Promise<void> {
    await expect(
      owner.$transaction(
        async (tx) => {
          await fn(tx as unknown as PrismaClient);
          throw new Error("rolled back by the test");
        },
        { timeout: 60_000 },
      ),
    ).rejects.toThrow("rolled back by the test");
  }

  async function createPage(slug: string, title: string, sections: unknown[]) {
    const created = await bvEditor.post(`/sites/${BV}/pages`, { title, slug });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const p = CmsPageResponseSchema.parse(created.body).page;
    const saved = await bvEditor.post(`/pages/${p.id}/draft`, {
      version: p.version,
      title,
      slug,
      seo: { ...SEO, title: `${title} SEO` },
      content: { sections },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    return CmsPageResponseSchema.parse(saved.body).page;
  }
  async function publish(id: string) {
    const p = (await pageOf(id)).page;
    const res = await bvPublisher.post(`/pages/${id}/publish`, { version: p.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return CmsPageResponseSchema.parse(res.body);
  }
  async function setNlPublic(value: boolean) {
    await owner.siteLocale.update({
      where: { siteId_locale: { siteId: BV, locale: "nl" } },
      data: { public: value },
    });
  }

  const SECTIONS = [
    { id: "ml2-hero-0001", type: "hero", title: "About us", intro: "Who we are." },
    {
      id: "ml2-text-0002",
      type: "text",
      title: "Our story",
      body: "Founded in Rotterdam.",
    },
  ];
  let en: Awaited<ReturnType<typeof createPage>>;
  let nlId: string;

  it("migration: every page is the first page of its own group; rollback restores the old keys (rehearsed, rolled back)", async () => {
    const applied = await owner.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "_prisma_migrations"
      WHERE migration_name = ${MIGRATION} AND finished_at IS NOT NULL`;
    expect(Number(applied[0]?.n)).toBe(1);
    // Every page so far is an original (no translation exists yet in this database).
    const nested = await owner.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "CmsPage" WHERE "translationGroupId" <> "id"`;
    expect(Number(nested[0]?.n)).toBe(0);
    const indexes = async (tx: PrismaClient) =>
      (
        await tx.$queryRaw<{ indexname: string }[]>`
          SELECT indexname FROM pg_indexes WHERE tablename = 'CmsPage' ORDER BY indexname`
      ).map((r) => r.indexname);
    expect(await indexes(owner)).toEqual(
      expect.arrayContaining([
        "CmsPage_siteId_locale_path_key",
        "CmsPage_registry_siteId_locale_templateKey_key",
        "CmsPage_translationGroupId_locale_key",
      ]),
    );
    // The rollback of the migration header, statement by statement, then undone.
    const statements = ml2RollbackStatements();
    expect(statements.length).toBeGreaterThanOrEqual(10);
    const before = await englishHash();
    await rolledBack(async (tx) => {
      for (const st of statements) await tx.$executeRawUnsafe(st);
      const after = await indexes(tx);
      expect(after).toContain("CmsPage_siteId_path_key");
      expect(after).toContain("CmsPage_registry_siteId_templateKey_key");
      expect(after).not.toContain("CmsPage_translationGroupId_locale_key");
      const cols = await tx.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'CmsPage' AND column_name LIKE 'translation%'`;
      expect(cols).toEqual([]);
    });
    expect(await englishHash()).toBe(before);
  });

  it("database rules: one page per language and group; a group shares site, kind and template; sources stay in the group", async () => {
    const a = await row({ title: "ML-2 rule probe" });
    // A language the site does not have (foreign key to SiteLocale).
    await rejectsDb(row({ locale: "fr" }), /CmsPage_siteId_locale_fkey|Foreign key/i);
    // A translation must keep the group's site, kind and template.
    await rejectsDb(
      row({
        id: randomUUID(),
        locale: "nl",
        translationGroupId: a.id,
        templateKey: "article",
        path: "/news/ml2-x",
      }),
      /CmsPage_translation_group_consistent/,
    );
    await rejectsDb(
      row({ locale: "nl", siteId: COM, translationGroupId: a.id }),
      /CmsPage_translation_group|CmsPage_siteId_locale_fkey/,
    );
    const nl = await row({
      id: randomUUID(),
      locale: "nl",
      translationGroupId: a.id,
      path: a.path,
    });
    // Never twice per language (unique), and a translation cannot be the root of another group.
    await rejectsDb(
      row({ id: randomUUID(), locale: "nl", translationGroupId: a.id }),
      /CmsPage_translationGroupId_locale_key|Unique constraint/,
    );
    await rejectsDb(
      owner.cmsPage.update({ where: { id: a.id }, data: { translationGroupId: nl.id } }),
      /CmsPage_translation_group_root/,
    );
    // Same path in two languages is allowed (above); twice in one language is not.
    await rejectsDb(
      row({ locale: "nl", path: a.path }),
      /CmsPage_siteId_locale_path_key|Unique constraint/,
    );
    // A source revision must be a revision of another page of the same group.
    const other = await row({ title: "ML-2 other group" });
    await bvPublisher.post(`/pages/${other.id}/publish`, { version: other.version });
    const rev = await owner.cmsPageRevision.findFirstOrThrow({ where: { pageId: other.id } });
    await rejectsDb(
      owner.cmsPage.update({ where: { id: nl.id }, data: { translationSourceRevisionId: rev.id } }),
      /CmsPage_translation_source/,
    );
    // dp_app still cannot delete pages; clean up as dp_owner.
    await rejectsDb(asApp.cmsPage.delete({ where: { id: nl.id } }), /permission denied/);
    await owner.cmsPage.delete({ where: { id: nl.id } });
    await owner.cmsPage.delete({ where: { id: a.id } });
  });

  it("create translation: copies the structure with empty texts, as an NL draft in the same group; never twice", async () => {
    en = await createPage("ml2-about", "About us (ML-2)", SECTIONS);
    await publish(en.id);
    const enHash = await englishHash();
    // Readers cannot create; a language that is not enabled or the page's own language is refused.
    expectError(
      await bvReader.post(`/pages/${en.id}/translations`, { locale: "nl", title: "Over ons" }),
      404,
      "NOT_FOUND",
    );
    expectError(
      await bvEditor.post(`/pages/${en.id}/translations`, { locale: "de", title: "Über uns" }),
      409,
      "CONFLICT_STATE",
      { path: "locale", rule: "not_enabled" },
    );
    expectError(
      await bvEditor.post(`/pages/${en.id}/translations`, { locale: "en", title: "Again" }),
      409,
      "CONFLICT_STATE",
      { path: "locale", rule: "exists" },
    );
    const res = await bvEditor.post(`/pages/${en.id}/translations`, {
      locale: "nl",
      title: "Over ons (ML-2)",
      slug: "over-ons-ml2",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const created = CmsPageResponseSchema.parse(res.body);
    nlId = created.page.id;
    expect(created.page).toMatchObject({
      locale: "nl",
      path: "/over-ons-ml2",
      kind: "TEMPLATE",
      templateKey: "standard",
      translationGroupId: en.id,
      publication: null,
      title: "Over ons (ML-2)",
    });
    expect(created.page.seo).toMatchObject({ title: null, description: null, noindex: false });
    const sections = created.page.content["sections"] as Record<string, unknown>[];
    expect(sections.map((s) => [s["id"], s["type"]])).toEqual(SECTIONS.map((s) => [s.id, s.type]));
    expect(sections[0]).toMatchObject({ title: "", intro: "" });
    expect(sections[1]).toMatchObject({ title: "", body: "" });
    expect(created.page.structureWarnings).toEqual([]);
    expect(created.translations.map((t) => [t.locale, t.state, t.isSource])).toEqual([
      ["en", "published", true],
      ["nl", "draft", false],
    ]);
    expect(created.translations[1]).toMatchObject({
      outdated: false,
      sourceRevisionNumber: 1,
      sourceLatestRevisionNumber: 1,
    });
    const audit = await lastAudit("cms.translation_created");
    expect(audit?.metadata).toMatchObject({
      locale: "nl",
      fromPageId: en.id,
      sourceRevisionNumber: 1,
    });
    expect(JSON.stringify(audit?.metadata)).not.toContain("Over ons");
    // Never twice (from either page of the group).
    for (const id of [en.id, nlId]) {
      expectError(
        await bvEditor.post(`/pages/${id}/translations`, { locale: "nl", title: "Nog eens" }),
        409,
        "CONFLICT_STATE",
        { path: "locale", rule: "exists" },
      );
    }
    expect(await owner.cmsPage.count({ where: { translationGroupId: en.id } })).toBe(2);
    // The English page, its revision and publication are untouched.
    expect(await englishHash()).toBe(enHash);
  });

  it("lists one language at a time; the default list carries the NL state; old calls stay English", async () => {
    const plain = CmsPageListResponseSchema.parse((await bvReader.get(`/sites/${BV}/pages`)).body);
    expect(plain.items.every((i) => i.locale === "en")).toBe(true);
    const item = plain.items.find((i) => i.id === en.id)!;
    expect(item.translations.map((t) => [t.locale, t.state])).toEqual([["nl", "draft"]]);
    const nl = CmsPageListResponseSchema.parse(
      (await bvReader.get(`/sites/${BV}/pages?locale=nl`)).body,
    );
    expect(nl.items.some((i) => i.id === nlId)).toBe(true);
    expect(nl.items.every((i) => i.locale === "nl")).toBe(true);
    expectError(await bvReader.get(`/sites/${BV}/pages?locale=xx`), 400, "VALIDATION_FAILED", {
      path: "locale",
      rule: "unknown",
    });
    // Menu targets offer the default language's pages only.
    const targets = CmsMenuTargetsResponseSchema.parse(
      (await bvReader.get(`/sites/${BV}/menu-targets`)).body,
    );
    expect(targets.pages.some((p) => p.id === en.id)).toBe(true);
    expect(targets.pages.some((p) => p.id === nlId)).toBe(false);
  });

  it("NL draft, preview, publish, unpublish and restore are independent of English; visitors never see NL while it is not public", async () => {
    const enHash = await englishHash();
    const nl = (await pageOf(nlId)).page;
    const saved = await bvEditor.post(`/pages/${nlId}/draft`, {
      version: nl.version,
      title: nl.title,
      slug: "over-ons-ml2",
      seo: { ...SEO, title: "Over ons SEO" },
      content: {
        sections: [
          { ...SECTIONS[0], title: "Over ons", intro: "Wie wij zijn." },
          { ...SECTIONS[1], title: "Ons verhaal", body: "Opgericht in Rotterdam." },
        ],
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const pre = await bvReader.post(`/pages/${nlId}/preview`, {});
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    const token = CmsPreviewResponseSchema.parse(pre.body).url.split("/preview/")[1]!;
    const view = CmsPublicBundleSchema.parse((await pub(`/preview/${token}`)).body);
    expect(view.page.title).toBe("Over ons (ML-2)");
    // DP-250: the preview names the draft's language (its address carries none).
    expect(view.locale).toBe("nl");
    // The preview never borrows English fragments for a Dutch page (no NL fragment yet).
    expect(view.fragments["bv.site-nav"] ?? null).toBeNull();
    const live = await publish(nlId);
    expect(live.page.publication).toMatchObject({ status: "PUBLISHED", revisionNumber: 1 });
    expect(live.translations.map((t) => [t.locale, t.state])).toEqual([
      ["en", "published"],
      ["nl", "published"],
    ]);
    expect(await englishHash()).toBe(enHash);
    // English stays the default answer; NL is 404 everywhere while not public.
    const enPage = CmsPublicBundleSchema.parse((await pub(`/page?path=/ml2-about`)).body);
    expect(enPage.page.title).toBe("About us (ML-2)");
    expectError(await pub(`/page?path=/over-ons-ml2`), 404, "NOT_FOUND");
    const hidden = await pub(`/page?path=/over-ons-ml2&locale=nl`);
    expectError(hidden, 404, "NOT_FOUND");
    expect(hidden.body.error.details).toEqual([]);
    expectError(await pub(`/news?locale=nl`), 404, "NOT_FOUND");
    expectError(
      await seoGet(`/resolve?path=${encodeURIComponent("/nl/over-ons-ml2")}`),
      404,
      "NOT_FOUND",
    );
    expectError(await seoGet(`/settings?locale=nl`), 404, "NOT_FOUND");
    const sitemap = PublicSitemapResponseSchema.parse((await seoGet("/sitemap")).body);
    expect(sitemap.entries.map((e) => e.path)).not.toContain("/over-ons-ml2");
    expect(sitemap.entries.map((e) => e.path)).toContain("/ml2-about");
    // Unpublish NL: English stays live, unchanged.
    const off = await bvPublisher.post(`/pages/${nlId}/unpublish`, {
      publicationVersion: live.page.publication!.version,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect((await pub(`/page?path=/ml2-about`)).status).toBe(200);
    expect(await englishHash()).toBe(enHash);
    // Restore NL revision 1 into the draft, publish again.
    const back = await bvEditor.post(`/pages/${nlId}/restore`, {
      version: CmsPageResponseSchema.parse(off.body).page.version,
      revisionNumber: 1,
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    const again = await publish(nlId);
    expect(again.page.publication).toMatchObject({ status: "PUBLISHED", revisionNumber: 2 });
    expect(await englishHash()).toBe(enHash);
  });

  it("visible once NL is public (owner switch, rolled back here): NL page by locale, the same path in two languages", async () => {
    // The same path in both languages, both live.
    const twin = await bvEditor.post(`/pages/${en.id}/translations`, {
      locale: "nl",
      title: "x",
    });
    expectError(twin, 409, "CONFLICT_STATE", { path: "locale", rule: "exists" });
    const other = await createPage("ml2-same", "Same path (ML-2)", [SECTIONS[0]]);
    await publish(other.id);
    const otherNl = await bvEditor.post(`/pages/${other.id}/translations`, {
      locale: "nl",
      title: "Zelfde pad (ML-2)",
    });
    expect(otherNl.status, JSON.stringify(otherNl.body)).toBe(201);
    const otherNlPage = CmsPageResponseSchema.parse(otherNl.body).page;
    expect(otherNlPage.path).toBe("/ml2-same");
    const nlv = (await pageOf(otherNlPage.id)).page;
    await bvEditor.post(`/pages/${otherNlPage.id}/draft`, {
      version: nlv.version,
      title: nlv.title,
      slug: "ml2-same",
      seo: SEO,
      content: { sections: [{ ...SECTIONS[0], title: "Zelfde", intro: "Tekst." }] },
    });
    await publish(otherNlPage.id);
    await setNlPublic(true);
    try {
      const nlBundle = CmsPublicBundleSchema.parse(
        (await pub(`/page?path=/ml2-same&locale=nl`)).body,
      );
      expect(nlBundle.page.title).toBe("Zelfde pad (ML-2)");
      const enBundle = CmsPublicBundleSchema.parse((await pub(`/page?path=/ml2-same`)).body);
      expect(enBundle.page.title).toBe("Same path (ML-2)");
      // No fallback: a Dutch address without Dutch content is a 404, never English.
      expectError(await pub(`/page?path=/ml2-about-missing&locale=nl`), 404, "NOT_FOUND");
      // ML-5: once NL is public the sitemap lists the path once per language, each naming the
      // other as its counterpart.
      expect(
        PublicSitemapResponseSchema.parse((await seoGet("/sitemap")).body)
          .entries.filter((e) => e.path === "/ml2-same")
          .map((e) => [e.locale, e.alternates]),
      ).toEqual([
        ["en", [{ locale: "nl", path: "/ml2-same" }]],
        ["nl", [{ locale: "en", path: "/ml2-same" }]],
      ]);
    } finally {
      await setNlPublic(false);
    }
  });

  it("slug collision in one language is refused; a Dutch slug change writes /nl/old -> /nl/new, hidden from visitors", async () => {
    const third = await createPage("ml2-third", "Third (ML-2)", [SECTIONS[0]]);
    // The NL slug of another NL page in the same language: refused.
    expectError(
      await bvEditor.post(`/pages/${third.id}/translations`, {
        locale: "nl",
        title: "Derde",
        slug: "over-ons-ml2",
      }),
      409,
      "CONFLICT_STATE",
      { path: "slug", rule: "unique" },
    );
    // The NL page moves: the old NL address answers 301 to the new one, under /nl.
    const nl = (await pageOf(nlId)).page;
    const moved = await bvEditor.post(`/pages/${nlId}/draft`, {
      version: nl.version,
      title: nl.title,
      slug: "over-ons-nieuw",
      seo: nl.seo,
      content: nl.content,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const enRedirects = await owner.siteRedirect.count({
      where: { siteId: BV, sourcePath: "/ml2-about" },
    });
    await publish(nlId);
    const redirect = await owner.siteRedirect.findFirstOrThrow({
      where: { siteId: BV, contentType: "CMS_PAGE", contentId: nlId },
    });
    expect(redirect).toMatchObject({
      sourcePath: "/nl/over-ons-ml2",
      target: "/nl/over-ons-nieuw",
      origin: "SLUG_CHANGE",
      active: true,
    });
    expect(
      await owner.siteRedirect.count({ where: { siteId: BV, sourcePath: "/ml2-about" } }),
    ).toBe(enRedirects);
    // Hidden language: no 301 revealed to visitors.
    const r = await seoGet(`/resolve?path=${encodeURIComponent("/nl/over-ons-ml2")}`);
    expectError(r, 404, "NOT_FOUND");
    expect(r.body.error.details).toEqual([]);
    // The page response names its old Dutch address.
    expect((await pageOf(nlId)).page.redirectsHere).toEqual(["/nl/over-ons-ml2"]);
    // English addresses keep their unprefixed form (no /en routing before ML-3).
    expect((await seoGet(`/resolve?path=/ml2-about`)).status).toBe(200);
  });

  it("translation state: English republished -> NL outdated; marking it up to date clears it; the source cannot be marked", async () => {
    const e1 = (await pageOf(en.id)).page;
    const edited = await bvEditor.post(`/pages/${en.id}/draft`, {
      version: e1.version,
      title: e1.title,
      slug: "ml2-about",
      seo: e1.seo,
      content: {
        sections: [...SECTIONS, { id: "ml2-text-0003", type: "text", body: "Contact us." }],
      },
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const enLive = await publish(en.id);
    expect(enLive.page.publication?.revisionNumber).toBe(2);
    const state = (await pageOf(nlId)).translations.find((t) => t.locale === "nl")!;
    expect(state).toMatchObject({
      state: "outdated",
      outdated: true,
      sourceRevisionNumber: 1,
      sourceLatestRevisionNumber: 2,
    });
    const list = CmsPageListResponseSchema.parse((await bvReader.get(`/sites/${BV}/pages`)).body);
    expect(list.items.find((i) => i.id === en.id)?.translations[0]?.state).toBe("outdated");
    // Structure differs now (EN has a third section): a warning, not a refusal.
    const nlNow = (await pageOf(nlId)).page;
    expect(nlNow.structureWarnings).toEqual(expect.arrayContaining(["sections"]));
    // Mark up to date.
    expectError(
      await bvEditor.post(`/pages/${nlId}/translation-source`, {
        version: nlNow.version,
        revisionNumber: 9,
      }),
      404,
      "NOT_FOUND",
      { path: "revisionNumber", rule: "unknown" },
    );
    const marked = await bvEditor.post(`/pages/${nlId}/translation-source`, {
      version: nlNow.version,
      revisionNumber: 2,
    });
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    const after = CmsPageResponseSchema.parse(marked.body);
    expect(after.translations.find((t) => t.locale === "nl")).toMatchObject({
      state: "published",
      outdated: false,
      sourceRevisionNumber: 2,
    });
    expect((await lastAudit("cms.translation_source_set"))?.metadata).toMatchObject({
      locale: "nl",
      sourceRevisionNumber: 2,
    });
    const enNow = (await pageOf(en.id)).page;
    expectError(
      await bvEditor.post(`/pages/${en.id}/translation-source`, {
        version: enNow.version,
        revisionNumber: 2,
      }),
      409,
      "CONFLICT_STATE",
      { path: "locale", rule: "is_source" },
    );
    expectError(
      await bvReader.post(`/pages/${nlId}/translation-source`, {
        version: after.page.version,
        revisionNumber: 2,
      }),
      404,
      "NOT_FOUND",
    );
  });

  it("fragments per language: NL navigation, footer, SEO, home and news heading leave English untouched", async () => {
    const enBefore = await englishHash();
    const navBefore = JSON.stringify((await pub("/news")).body.fragments);
    const seoBefore = JSON.stringify((await seoGet("/settings")).body);
    const keys = ["bv.site-nav", "bv.site-footer", "bv.site-seo", "bv.home", "bv.news-index"];
    const nlIds: Record<string, string> = {};
    for (const key of keys) {
      const enRow = await owner.cmsPage.findFirst({
        where: { siteId: BV, locale: "en", templateKey: key },
        select: { id: true, path: true, content: true },
      });
      if (!enRow) continue; // imported by an earlier section when present
      // ML-7: the footer starts from the prepared Dutch proposal; the others with empty texts.
      const proposal = key === "bv.site-footer";
      if (key === "bv.home") {
        // No proposal for pages other than the menus.
        expectError(
          await bvEditor.post(`/pages/${enRow.id}/translations`, {
            locale: "nl",
            title: "x",
            proposal: true,
          }),
          400,
          "VALIDATION_FAILED",
          { path: "proposal", rule: "unavailable" },
        );
      }
      const res = await bvEditor.post(`/pages/${enRow.id}/translations`, {
        locale: "nl",
        title: `NL ${key}`,
        ...(proposal ? { proposal: true } : {}),
      });
      expect(res.status, `${key}: ${JSON.stringify(res.body)}`).toBe(201);
      const created = CmsPageResponseSchema.parse(res.body).page;
      expect(created.path).toBe(enRow.path);
      nlIds[key] = created.id;
      // Designed pages and fragments keep their address in every language.
      expectError(
        await bvEditor.post(`/pages/${enRow.id}/translations`, {
          locale: "nl",
          title: "x",
          slug: "x",
        }),
        400,
        "VALIDATION_FAILED",
        { path: "slug", rule: "fixed_address" },
      );
    }
    expect(Object.keys(nlIds)).toEqual(expect.arrayContaining(["bv.site-nav", "bv.home"]));
    // The NL navigation keeps every target and empties every label.
    const nav = (await pageOf(nlIds["bv.site-nav"]!)).page;
    const navText = JSON.stringify(nav.content);
    expect(navText).not.toMatch(/"label":"[^"]/);
    const enNav = await owner.cmsPage.findFirstOrThrow({
      where: { siteId: BV, locale: "en", templateKey: "bv.site-nav" },
    });
    const targets = (c: unknown) => JSON.stringify(c).match(/"target":\{[^}]*\}/g) ?? [];
    expect(targets(nav.content)).toEqual(targets(enNav.content));
    // ML-7: the NL footer: Dutch proposal where one exists, shared contact details kept, targets
    // copied; nothing published.
    if (nlIds["bv.site-footer"]) {
      const nlFooter = (await pageOf(nlIds["bv.site-footer"])).page;
      const enFooter = await owner.cmsPage.findFirstOrThrow({
        where: { siteId: BV, locale: "en", templateKey: "bv.site-footer" },
      });
      const c = nlFooter.content as {
        headline: string;
        contact: { company: string; addressLines: unknown; phone: { label: string } };
      };
      const e = enFooter.content as typeof c;
      expect(c.headline).toBe(menuNlProposal("bv.site-footer", "headline", e.headline));
      expect(c.contact.company).toBe(e.contact.company);
      expect(c.contact.addressLines).toEqual(e.contact.addressLines);
      expect(c.contact.phone.label).toBe(e.contact.phone.label);
      expect(targets(nlFooter.content)).toEqual(targets(enFooter.content));
      expect(nlFooter.publication).toBeNull();
    }
    // A second NL registry page is refused (registry key per language).
    const twinId = randomUUID();
    const twice = await owner.cmsPage
      .create({
        data: {
          id: twinId,
          translationGroupId: twinId,
          siteId: BV,
          kind: "DESIGN",
          templateKey: "bv.home",
          path: "/",
          locale: "nl",
          title: "x",
          content: {},
          createdById: root.userId,
          updatedById: root.userId,
        },
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(JSON.stringify(twice, Object.getOwnPropertyNames(twice ?? {})) + String(twice)).toMatch(
      /CmsPage_registry_siteId_locale_templateKey_key|Unique constraint/,
    );
    // English answers are byte-identical.
    expect(JSON.stringify((await pub("/news")).body.fragments)).toBe(navBefore);
    expect(JSON.stringify((await seoGet("/settings")).body)).toBe(seoBefore);
    expect(await englishHash()).toBe(enBefore);
  });

  it("menus resolve page references per language: the NL counterpart under /nl, never the English page", async () => {
    const navId = (
      await owner.cmsPage.findFirstOrThrow({
        where: { siteId: BV, locale: "nl", templateKey: "bv.site-nav" },
      })
    ).id;
    const nav = (await pageOf(navId)).page;
    // Fill the emptied texts of the copied navigation (labels, pending note) with Dutch.
    const filled = JSON.parse(
      JSON.stringify(nav.content)
        .replace(/"label":""/g, '"label":"NL"')
        .replace(/"pendingNote":""/g, '"pendingNote":"Binnenkort"'),
    ) as Record<string, unknown>;
    const content = {
      ...filled,
      items: [
        {
          label: "Over ons",
          target: { type: "page", pageId: en.id },
          newTab: false,
          visible: true,
        },
        {
          label: "Derde",
          target: { type: "path", path: "/products" },
          newTab: false,
          visible: true,
        },
        // ML-7: an English address whose page has a Dutch counterpart resolves to it.
        {
          label: "Zelfde",
          target: { type: "path", path: "/ml2-same?x=1" },
          newTab: false,
          visible: true,
        },
        {
          label: "Extern",
          target: { type: "url", url: "https://www.example.com/x" },
          newTab: true,
          visible: true,
        },
        {
          label: "Privacy",
          target: { type: "path", path: "/privacy" },
          newTab: false,
          visible: true,
        },
      ],
    };
    const saved = await bvEditor.post(`/pages/${navId}/draft`, {
      version: nav.version,
      title: nav.title,
      seo: nav.seo,
      content,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    await publish(navId);
    await setNlPublic(true);
    try {
      const bundle = CmsPublicBundleSchema.parse(
        (await pub(`/page?path=/ml2-same&locale=nl`)).body,
      );
      const navPublic = BvNavPublicSchema.parse(bundle.fragments["bv.site-nav"]?.content);
      // ML-7 (ADR-028 D7): a link without a destination in Dutch is left out (no pending text,
      // never the English page); URLs stay; order kept.
      expect(navPublic.items.map((i) => [i.label, i.href])).toEqual([
        ["Over ons", "/nl/over-ons-nieuw"],
        ["Zelfde", "/nl/ml2-same?x=1"],
        ["Extern", "https://www.example.com/x"],
      ]);
      expect(JSON.stringify(navPublic)).not.toContain("Derde");
      // The admin warns about the hidden links of the draft before publishing (never refuses).
      const warnings = (await pageOf(navId)).page.menuWarnings;
      expect(
        warnings.filter((w) => w.path.startsWith("items.")).map((w) => [w.label, w.rule]),
      ).toEqual([
        ["Derde", "not_in_language"],
        ["Privacy", "not_in_language"],
      ]);
      // The English navigation is unchanged and still English.
      const enBundle = CmsPublicBundleSchema.parse((await pub(`/page?path=/ml2-same`)).body);
      expect(JSON.stringify(enBundle.fragments["bv.site-nav"])).not.toContain("Over ons");
      // The English navigation keeps its pending texts and site paths (unchanged by ML-7).
      const enNav = BvNavPublicSchema.parse(enBundle.fragments["bv.site-nav"]?.content);
      expect(enNav.items.length).toBeGreaterThan(0);
    } finally {
      await setNlPublic(false);
    }
  });
  // --- ML-3 (DP-236, ADR-028 D3/D7): the reads behind the /en and /nl routing of the site ------

  it("ML-3 resolve: the default language without or with locale=en; other languages only while public", async () => {
    // Default language: `locale=en` answers exactly like no locale (the site sends none).
    const plain = await seoGet(`/resolve?path=/ml2-about`);
    const named = await seoGet(`/resolve?path=/ml2-about&locale=en`);
    expect(plain.status).toBe(200);
    expect(named.body).toEqual(plain.body);
    // NL not public: 404 without detail for any address, live or moved.
    for (const p of ["/ml2-same", "/over-ons-nieuw", "/over-ons-ml2", "/"]) {
      const r = await seoGet(`/resolve?path=${encodeURIComponent(p)}&locale=nl`);
      expectError(r, 404, "NOT_FOUND");
      expect(r.body.error.details).toEqual([]);
    }
    // Unknown or malformed languages are 404 too.
    for (const l of ["xx", "de", "NL", "x".repeat(40)]) {
      expectError(await seoGet(`/resolve?path=/ml2-about&locale=${l}`), 404, "NOT_FOUND");
    }
  });

  it("ML-3 resolve once NL is public (owner switch, rolled back here): own pages, own redirects, no fallback", async () => {
    await setNlPublic(true);
    try {
      expect((await seoGet(`/resolve?path=/ml2-same&locale=nl`)).body).toEqual({
        path: "/nl/ml2-same",
        kind: "page",
      });
      expect((await seoGet(`/resolve?path=/over-ons-nieuw&locale=nl`)).body).toEqual({
        path: "/nl/over-ons-nieuw",
        kind: "page",
      });
      // The ML-2 slug change row (/nl/over-ons-ml2 -> /nl/over-ons-nieuw), asked inside NL.
      const moved = await seoGet(`/resolve?path=/over-ons-ml2&locale=nl`);
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect(moved.body).toEqual({
        path: "/nl/over-ons-ml2",
        redirect: { target: "/nl/over-ons-nieuw", statusCode: 301 },
      });
      // No English content under a Dutch address (ADR-028 D7): the English slug is a 404 in NL.
      expectError(await seoGet(`/resolve?path=/ml2-about&locale=nl`), 404, "NOT_FOUND");
      // No product published in Dutch in this database (ML-8c: a Dutch product resolves only with
      // its own text, catalog-workflow section 19) and no old-site lookups inside NL.
      expectError(await seoGet(`/resolve?path=/products/x&locale=nl`), 404, "NOT_FOUND");
      expectError(
        await seoGet(`/resolve?path=${encodeURIComponent("/en/about-us")}&locale=nl`),
        404,
        "NOT_FOUND",
      );
      // The English answers are unchanged by the switch.
      expect((await seoGet(`/resolve?path=/ml2-same`)).body).toEqual({
        path: "/ml2-same",
        kind: "page",
      });
    } finally {
      await setNlPublic(false);
    }
  });

  it("ML-3 alternates: the published counterpart in public languages only, never a draft", async () => {
    // NL not public: no alternates at all.
    const hidden = CmsPublicBundleSchema.parse((await pub(`/page?path=/ml2-about`)).body);
    expect(hidden.alternates).toEqual([]);
    await setNlPublic(true);
    try {
      const en = CmsPublicBundleSchema.parse((await pub(`/page?path=/ml2-about`)).body);
      expect(en.alternates).toEqual([{ locale: "nl", path: "/over-ons-nieuw", indexable: true }]);
      const nl = CmsPublicBundleSchema.parse(
        (await pub(`/page?path=/over-ons-nieuw&locale=nl`)).body,
      );
      expect(nl.alternates).toEqual([{ locale: "en", path: "/ml2-about", indexable: true }]);
      // A page whose group has no other published language has none.
      const third = await owner.cmsPage.findFirstOrThrow({
        where: { siteId: BV, locale: "en", path: "/ml2-third" },
        select: { id: true },
      });
      await publish(third.id);
      const alone = CmsPublicBundleSchema.parse((await pub(`/page?path=/ml2-third`)).body);
      expect(alone.alternates).toEqual([]);
    } finally {
      await setNlPublic(false);
    }
  });
  // --- ML-5 (DP-019, ADR-028 D3): canonical, hreflang and sitemap per language ----------------

  it("ML-5 sitemap while NL is not public: English only, no Dutch path, no alternates", async () => {
    const sitemap = PublicSitemapResponseSchema.parse((await seoGet("/sitemap")).body);
    expect(sitemap.entries.length).toBeGreaterThan(0);
    expect(new Set(sitemap.entries.map((e) => e.locale))).toEqual(new Set(["en"]));
    expect(sitemap.entries.every((e) => e.alternates.length === 0)).toBe(true);
    for (const p of ["/over-ons-nieuw", "/over-ons-ml2"]) {
      expect(sitemap.entries.map((e) => e.path)).not.toContain(p);
    }
    // The CMS reads name no counterpart either (news list included).
    expect(
      CmsPublicBundleSchema.parse((await pub(`/page?path=/ml2-about`)).body).alternates,
    ).toEqual([]);
    expect(CmsPublicNewsSchema.parse((await pub(`/news`)).body).alternates ?? []).toEqual([]);
  });

  it("ML-5 sitemap once NL is public (rolled back here): reciprocal pairs by translation group, catalogue English only", async () => {
    await setNlPublic(true);
    try {
      const { entries } = PublicSitemapResponseSchema.parse((await seoGet("/sitemap")).body);
      const key = (l: string, p: string) => `${l} ${p}`;
      const keys = new Set(entries.map((e) => key(e.locale, e.path)));
      expect(keys.size).toBe(entries.length);
      const of = (l: string, p: string) => entries.find((e) => e.locale === l && e.path === p);
      expect(of("en", "/ml2-about")?.alternates).toEqual([
        { locale: "nl", path: "/over-ons-nieuw" },
      ]);
      expect(of("nl", "/over-ons-nieuw")).toMatchObject({
        kind: "page",
        alternates: [{ locale: "en", path: "/ml2-about" }],
        lastModified: expect.any(String),
      });
      // Reciprocal: every alternate is itself listed and names the entry back.
      for (const e of entries) {
        for (const a of e.alternates) {
          const back = of(a.locale, a.path);
          expect(back, `${e.locale} ${e.path} -> ${a.locale} ${a.path}`).toBeDefined();
          expect(back!.alternates).toContainEqual({ locale: e.locale, path: e.path });
        }
      }
      // An English page without a published Dutch counterpart names none (no fake NL address).
      expect(of("en", "/ml2-third")).toMatchObject({ alternates: [] });
      // No product is published in Dutch here (ML-8c): no Dutch product list or product.
      expect(
        entries.filter((e) => e.locale === "nl" && (e.kind === "product" || e.kind === "products")),
      ).toEqual([]);
      expect(entries.some((e) => e.locale === "en" && e.kind === "products")).toBe(true);
      // Redirect sources (the Dutch slug change) are never listed.
      expect(of("nl", "/over-ons-ml2")).toBeUndefined();
      // lastModified of a CMS entry is its publication.
      const nlRow = await owner.cmsPagePublication.findUniqueOrThrow({
        where: { pageId: nlId },
        select: { publishedAt: true },
      });
      expect(of("nl", "/over-ons-nieuw")?.lastModified).toBe(nlRow.publishedAt.toISOString());
    } finally {
      await setNlPublic(false);
    }
  });

  it("ML-5 a noindex counterpart is never named: not in the sitemap, not indexable in the CMS read", async () => {
    const nl = (await pageOf(nlId)).page;
    expect(nl.path).toBe("/over-ons-nieuw");
    const saveSeo = async (noindex: boolean) => {
      const current = (await pageOf(nlId)).page;
      const saved = await bvEditor.post(`/pages/${nlId}/draft`, {
        version: current.version,
        title: current.title,
        slug: current.slug,
        seo: { ...current.seo, noindex },
        content: current.content,
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      await publish(nlId);
    };
    await saveSeo(true);
    await setNlPublic(true);
    try {
      const { entries } = PublicSitemapResponseSchema.parse((await seoGet("/sitemap")).body);
      expect(entries.find((e) => e.locale === "nl" && e.path === nl.path)).toBeUndefined();
      expect(entries.find((e) => e.locale === "en" && e.path === "/ml2-about")?.alternates).toEqual(
        [],
      );
      // The language switcher still goes there; hreflang does not (indexable false).
      expect(
        CmsPublicBundleSchema.parse((await pub(`/page?path=/ml2-about`)).body).alternates,
      ).toEqual([{ locale: "nl", path: "/over-ons-nieuw", indexable: false }]);
    } finally {
      await setNlPublic(false);
      await saveSeo(false);
    }
    expect(
      CmsPublicBundleSchema.parse((await pub(`/page?path=/ml2-about`)).body).alternates,
    ).toEqual([]);
  });

  it("ML-5 site SEO defaults per language: the NL fragment only while NL is public", async () => {
    expectError(await seoGet(`/settings?locale=nl`), 404, "NOT_FOUND");
    await setNlPublic(true);
    try {
      const nl = await seoGet(`/settings?locale=nl`);
      expect(nl.status).toBe(200);
      // No published Dutch bv.site-seo here: the site falls back to its code defaults, never to
      // the English fragment.
      expect(nl.body.settings).toBeNull();
    } finally {
      await setNlPublic(false);
    }
  });
});

describe("23. translation packages (ML-13a, DP-244, ADR-028 D13)", () => {
  const API = "/api/v1/admin/translation-packages";
  type Pkg = TranslationPackage;
  let productEditor: Staff; // product_editor @ BV: product:read/edit, no content permission
  let groupA: string; // published English page with sections and SEO
  let groupB: string; // published English page, second slug test
  let groupC: string; // published English page, no title translation
  let listingId: string;
  let productId: string;
  let categoryId: string;
  let definitionId: string;
  let imageId: string;

  const pageOf = async (id: string) => CmsPageResponseSchema.parse((await page(id)).body);
  const hex = (n: number) => randomBytes(n).toString("hex");
  const exportAs = (s: Staff, query = `siteId=${BV}&locale=nl`) => s.get(`${API}/export?${query}`);
  const exported = async (s: Staff = root, query?: string): Promise<Pkg> => {
    const res = await exportAs(s, query);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return TranslationPackageSchema.parse(res.body);
  };
  const key = (kind: "cms" | "listing" | "category" | "spec" | "image", id: string, f: string) =>
    translationUnitKey(kind, id, f);
  const fill = (
    pkg: Pkg,
    targets: Record<string, string | null>,
    extra: Pkg["units"] = [],
  ): Pkg => ({
    ...pkg,
    units: [
      ...pkg.units.map((u) => (u.key in targets ? { ...u, target: targets[u.key] ?? null } : u)),
      ...extra,
    ],
  });
  const statusOf = (report: { units: { key: string; status: string; rule: string | null }[] }) =>
    Object.fromEntries(
      report.units.map((u) => [u.key, u.rule ? `${u.status}:${u.rule}` : u.status]),
    );
  const run = async (s: Staff, mode: "dry-run" | "import", pkg: unknown) =>
    s.post(`${API}/${mode}`, { package: pkg });
  const report = async (s: Staff, mode: "dry-run" | "import", pkg: unknown) => {
    const res = await run(s, mode, pkg);
    expect(res.status, JSON.stringify(res.body).slice(0, 2000)).toBe(200);
    return TranslationImportReportSchema.parse(res.body);
  };

  /** Every row the import may write or must not touch, hashed (audit events counted apart). */
  async function fingerprint(): Promise<string> {
    const [
      pages,
      revisions,
      pubs,
      listings,
      listingTexts,
      cats,
      catTexts,
      defs,
      defTexts,
      imgs,
      imgTexts,
      products,
      productPubs,
      locales,
    ] = await Promise.all([
      owner.cmsPage.findMany({ orderBy: { id: "asc" } }),
      owner.cmsPageRevision.findMany({ orderBy: { id: "asc" } }),
      owner.cmsPagePublication.findMany({ orderBy: { pageId: "asc" } }),
      owner.productSiteListing.findMany({ orderBy: { id: "asc" } }),
      owner.productListingText.findMany({ orderBy: [{ listingId: "asc" }, { locale: "asc" }] }),
      owner.productCategory.findMany({ orderBy: { id: "asc" } }),
      owner.productCategoryText.findMany({ orderBy: [{ categoryId: "asc" }, { locale: "asc" }] }),
      owner.specDefinition.findMany({ orderBy: { id: "asc" } }),
      owner.specDefinitionText.findMany({ orderBy: [{ definitionId: "asc" }, { locale: "asc" }] }),
      owner.productImage.findMany({ orderBy: { id: "asc" } }),
      owner.productImageText.findMany({ orderBy: [{ imageId: "asc" }, { locale: "asc" }] }),
      owner.product.findMany({ orderBy: { id: "asc" } }),
      owner.productPublication.findMany({ orderBy: { id: "asc" } }),
      owner.siteLocale.findMany({ orderBy: [{ siteId: "asc" }, { locale: "asc" }] }),
    ]);
    return createHash("sha256")
      .update(
        JSON.stringify({
          pages,
          revisions,
          pubs,
          listings,
          listingTexts,
          cats,
          catTexts,
          defs,
          defTexts,
          imgs,
          imgTexts,
          products,
          productPubs,
          locales,
        }),
      )
      .digest("hex");
  }
  /** The publication side only: what visitors can see. */
  async function liveFingerprint(): Promise<string> {
    const [pubs, revisions, productPubs, locales] = await Promise.all([
      owner.cmsPagePublication.findMany({ orderBy: { pageId: "asc" } }),
      owner.cmsPageRevision.findMany({ orderBy: { id: "asc" } }),
      owner.productPublication.findMany({ orderBy: { id: "asc" } }),
      owner.siteLocale.findMany({ orderBy: [{ siteId: "asc" }, { locale: "asc" }] }),
    ]);
    return createHash("sha256")
      .update(JSON.stringify({ pubs, revisions, productPubs, locales }))
      .digest("hex");
  }
  const auditCount = () => owner.auditEvent.count();

  async function englishPage(slug: string, title: string, sections: unknown[]) {
    const created = await bvEditor.post(`/sites/${BV}/pages`, { title, slug });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const p = CmsPageResponseSchema.parse(created.body).page;
    const saved = await bvEditor.post(`/pages/${p.id}/draft`, {
      version: p.version,
      title,
      slug,
      seo: { ...SEO, title: `${title} SEO`, description: `${title} description` },
      content: { sections },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const published = await bvPublisher.post(`/pages/${p.id}/publish`, { version: p.version + 1 });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return p.id;
  }
  /** Saves a page's draft with changes (the editor's normal save). */
  type EditorPage = Awaited<ReturnType<typeof pageOf>>["page"];
  async function saveDraft(id: string, change: (p: EditorPage) => Record<string, unknown>) {
    const p = (await pageOf(id)).page;
    const res = await bvEditor.post(`/pages/${id}/draft`, {
      version: p.version,
      title: p.title,
      slug: p.slug,
      seo: p.seo,
      content: p.content,
      ...change(p),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  const nlPage = (group: string) =>
    owner.cmsPage.findFirst({ where: { translationGroupId: group, locale: "nl" } });

  const HERO_A = { id: "ml13-hero-0001", type: "hero", title: "About ML-13", intro: "Who we are." };
  const TEXT_A = {
    id: "ml13-text-0002",
    type: "text",
    title: "Our story",
    body: "Founded in 1990.",
  };

  beforeAll(async () => {
    productEditor = await staff(
      "ml13-product-editor",
      [{ role: "product_editor", site: BV }],
      root.userId,
    );
    await owner.siteLocale.update({
      where: { siteId_locale: { siteId: BV, locale: "nl" } },
      data: { enabled: true, public: false },
    });
    groupA = await englishPage("ml13-about", "About ML-13", [HERO_A, TEXT_A]);
    groupB = await englishPage("ml13-services", "Services ML-13", [
      { id: "ml13-hero-0003", type: "hero", title: "Services", intro: "What we do." },
    ]);
    groupC = await englishPage("ml13-careers", "Careers ML-13", [
      { id: "ml13-text-0004", type: "text", title: "Join us", body: "Open roles." },
    ]);

    const now = new Date();
    categoryId = (
      await owner.productCategory.create({
        data: {
          siteId: BV,
          name: "ML-13 Base oils",
          description: "Group III base oils",
          slug: "ml13-base-oils",
        },
      })
    ).id;
    productId = (
      await owner.product.create({
        data: {
          code: "ML13-OIL",
          slug: "ml13-oil",
          name: "ML-13 Base Oil",
          summary: "A clear base oil.",
          description: "Shared product description.",
          status: "APPROVED",
          approvedAt: now,
          approvedById: root.userId,
          approvedVersion: 1,
        } as never,
      })
    ).id;
    listingId = (
      await owner.productSiteListing.create({
        data: { productId, siteId: BV, categoryId, visibility: "VISIBLE" },
      })
    ).id;
    await owner.productListingText.upsert({
      where: { listingId_locale: { listingId, locale: "en" } },
      create: {
        listingId,
        siteId: BV,
        locale: "en",
        title: "ML-13 Base Oil 4",
        seoTitle: "ML-13 Base Oil 4 SEO",
      },
      update: { title: "ML-13 Base Oil 4", seoTitle: "ML-13 Base Oil 4 SEO" },
    });
    definitionId = (
      await owner.specDefinition.create({
        data: {
          key: `ml13_viscosity_${hex(3)}`,
          name: "Kinematic viscosity ML-13",
          dataType: "NUMBER",
        },
      })
    ).id;
    await owner.productSpecValue.create({
      data: { productId, definitionId, numberValue: 4.2 },
    });
    imageId = (
      await owner.productImage.create({
        data: {
          productId,
          storageKey: `products/${hex(16)}/original`,
          mimeType: "image/webp",
          byteSize: 1000,
          width: 1200,
          height: 800,
          sha256: hex(32),
          originalFilename: "ml13-drum.webp",
          altText: "A blue ML-13 drum",
          isPublic: true,
        },
      })
    ).id;
  });

  it("export: read permissions of each part, the site's languages, every source text with a stable key", async () => {
    expectError(await exportAs(nobody), 403, "FORBIDDEN");
    expectError(await exportAs(comEditor), 403, "FORBIDDEN");
    expectError(await exportAs(productEditor), 403, "FORBIDDEN"); // cms needs content:read
    expectError(await exportAs(root, `siteId=${BV}&locale=en`), 400, "VALIDATION_FAILED", {
      path: "locale",
      rule: "is_source",
    });
    expectError(await exportAs(root, `siteId=${BV}&locale=de`), 409, "CONFLICT_STATE", {
      path: "locale",
      rule: "not_enabled",
    });
    expectError(
      await exportAs(root, `siteId=${BV}&locale=nl&types=media`),
      400,
      "VALIDATION_FAILED",
    );

    const catalogOnly = await exported(productEditor, `siteId=${BV}&locale=nl&types=catalog`);
    expect(catalogOnly.types).toEqual(["catalog"]);
    expect(catalogOnly.pages).toEqual([]);
    expect(catalogOnly.units.some((u) => u.kind === "cms")).toBe(false);

    const before = await auditCount();
    const pkg = await exported(bvReader); // read_only: content:read and product:read
    expect(pkg).toMatchObject({
      site: { id: BV, key: "BV" },
      sourceLocale: "en",
      targetLocale: "nl",
    });
    expect(pkg.pages.find((p) => p.groupId === groupA)).toMatchObject({
      sourcePageId: groupA,
      sourceRevisionNumber: 1,
      kind: "TEMPLATE",
      templateKey: "standard",
      path: "/ml13-about",
      targetPageId: null,
    });
    const byKey = new Map(pkg.units.map((u) => [u.key, u]));
    const src = (k: string) => byKey.get(k)?.source;
    expect(src(key("cms", groupA, "title"))).toBe("About ML-13");
    expect(src(key("cms", groupA, "slug"))).toBe("ml13-about");
    expect(src(key("cms", groupA, "seo.title"))).toBe("About ML-13 SEO");
    expect(src(key("cms", groupA, "content.sections.@ml13-hero-0001.title"))).toBe("About ML-13");
    expect(src(key("cms", groupA, "content.sections.@ml13-text-0002.body"))).toBe(
      "Founded in 1990.",
    );
    expect(byKey.has(key("cms", groupA, "seo.ogTitle"))).toBe(false); // no source text
    expect(byKey.get(key("cms", groupA, "title"))).toMatchObject({
      current: null,
      currentHash: null,
      target: null,
      maxLength: 200,
      sourceHash: createHash("sha256").update("About ML-13").digest("hex"),
    });
    expect(byKey.get(key("cms", groupA, "content.sections.@ml13-hero-0001.title"))?.maxLength).toBe(
      120,
    );
    // The site's menus are in the package as well (published fragments).
    expect(pkg.pages.some((p) => p.templateKey === "bv.site-nav")).toBe(true);
    // Catalogue: own listing text, else the shared product text; SEO; category; spec; alt text.
    expect(src(key("listing", listingId, "title"))).toBe("ML-13 Base Oil 4");
    expect(src(key("listing", listingId, "summary"))).toBe("A clear base oil.");
    expect(src(key("listing", listingId, "description"))).toBe("Shared product description.");
    expect(src(key("listing", listingId, "seo.title"))).toBe("ML-13 Base Oil 4 SEO");
    expect(byKey.has(key("listing", listingId, "seo.description"))).toBe(false);
    expect(src(key("category", categoryId, "name"))).toBe("ML-13 Base oils");
    expect(src(key("category", categoryId, "description"))).toBe("Group III base oils");
    expect(src(key("spec", definitionId, "name"))).toBe("Kinematic viscosity ML-13");
    expect(src(key("image", imageId, "alt"))).toBe("A blue ML-13 drum");
    expect(byKey.get(key("listing", listingId, "title"))?.context).toBe(
      "ML13-OIL · ML-13 Base Oil",
    );
    // One audit event; counts, never texts.
    expect(await auditCount()).toBe(before + 1);
    const audit = await lastAudit("translation.package_exported");
    expect(audit).toMatchObject({ actorUserId: bvReader.userId, siteId: BV, outcome: "SUCCESS" });
    expect(audit?.metadata).toMatchObject({
      locale: "nl",
      types: ["cms", "catalog"],
      units: pkg.units.length,
    });
    expect(JSON.stringify(audit?.metadata)).not.toMatch(/ML-13|Founded/);
  });

  let filled: Pkg;

  it("dry run: a per-unit report, the missing edit permissions; nothing written, no audit event", async () => {
    const pkg = await exported();
    filled = fill(pkg, {
      [key("cms", groupA, "title")]: "Over ML-13",
      [key("cms", groupA, "slug")]: "over-ml13",
      [key("cms", groupA, "seo.title")]: "Over ML-13 SEO",
      [key("cms", groupA, "content.sections.@ml13-hero-0001.title")]: "Over ML-13",
      [key("cms", groupA, "content.sections.@ml13-text-0002.title")]: "Ons verhaal",
      [key("cms", groupA, "content.sections.@ml13-text-0002.body")]: "Opgericht in 1990.",
      [key("listing", listingId, "title")]: "ML-13 Basisolie 4",
      [key("listing", listingId, "summary")]: "  Een heldere basisolie.  ",
      [key("category", categoryId, "name")]: "ML-13 Basisoliën",
      [key("spec", definitionId, "name")]: "Kinematische viscositeit ML-13",
      [key("image", imageId, "alt")]: "Een blauw ML-13 vat",
    });
    const fp = await fingerprint();
    const audits = await auditCount();
    const r = await report(bvEditor, "dry-run", filled);
    expect(r).toMatchObject({ dryRun: true, siteId: BV, canImport: false });
    expect(r.missingPermissions.sort()).toEqual(["product:edit", "product_master:edit"]);
    const st = statusOf(r);
    expect(st[key("cms", groupA, "title")]).toBe("create");
    expect(st[key("cms", groupA, "content.sections.@ml13-hero-0001.intro")]).toBe("empty");
    expect(st[key("listing", listingId, "summary")]).toBe("create");
    expect(st[key("image", imageId, "alt")]).toBe("create");
    expect(r.pages.find((p) => p.groupId === groupA)).toMatchObject({
      action: "create",
      targetPageId: null,
    });
    expect(r.pages.find((p) => p.groupId === groupB)).toMatchObject({
      action: "skipped",
      rule: "nothing_to_write",
    });
    expect(r.counts.create).toBe(11);
    expect(r.written).toEqual({
      cmsPagesCreated: 0,
      cmsPagesUpdated: 0,
      listings: 0,
      categories: 0,
      specs: 0,
      images: 0,
    });
    expect(await fingerprint()).toBe(fp);
    expect(await auditCount()).toBe(audits);
    // A dry run needs the read permissions of the declared parts.
    expectError(await run(nobody, "dry-run", filled), 403, "FORBIDDEN");
    expectError(await run(comEditor, "dry-run", filled), 403, "FORBIDDEN");
  });

  it("a broken package, another site key or a missing permission refuses the whole import", async () => {
    const fp = await fingerprint();
    // content_editor holds content:edit but not product:edit / product_master:edit.
    expectError(await run(bvEditor, "import", filled), 403, "FORBIDDEN");
    const tampered = {
      ...filled,
      units: filled.units.map((u, i) => (i === 0 ? { ...u, source: `${u.source}!` } : u)),
    };
    expectError(await run(root, "import", tampered), 400, "VALIDATION_FAILED", {
      path: "package.units.0.sourceHash",
      rule: "mismatch",
    });
    expectError(
      await run(root, "import", { ...filled, site: { id: BV, key: "CORPORATE" } }),
      400,
      "VALIDATION_FAILED",
      {
        path: "package.site.key",
        rule: "mismatch",
      },
    );
    expectError(
      await run(root, "import", { ...filled, units: [{ ...filled.units[0], extra: 1 }] }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await run(root, "import", { ...filled, sourceLocale: "de" }),
      409,
      "CONFLICT_STATE",
      {
        path: "package.sourceLocale",
        rule: "changed",
      },
    );
    expectError(
      await run(root, "import", { ...filled, targetLocale: "de" }),
      409,
      "CONFLICT_STATE",
      {
        path: "locale",
        rule: "not_enabled",
      },
    );
    expect(await fingerprint()).toBe(fp);
  });

  it("import writes drafts only: the Dutch page is created, catalogue rows written, nothing published", async () => {
    const live = await liveFingerprint();
    const listingBefore = await owner.productSiteListing.findUniqueOrThrow({
      where: { id: listingId },
    });
    const r = await report(root, "import", filled);
    expect(r.dryRun).toBe(false);
    expect(r.written).toEqual({
      cmsPagesCreated: 1,
      cmsPagesUpdated: 0,
      listings: 1,
      categories: 1,
      specs: 1,
      images: 1,
    });
    expect(r.counts.create).toBe(11);
    const nl = await nlPage(groupA);
    expect(nl).toMatchObject({
      locale: "nl",
      kind: "TEMPLATE",
      path: "/over-ml13",
      title: "Over ML-13",
      seoTitle: "Over ML-13 SEO",
      seoDescription: null,
      version: 1,
    });
    expect(r.pages.find((p) => p.groupId === groupA)).toMatchObject({
      action: "create",
      targetPageId: nl?.id,
    });
    const enRev = await owner.cmsPageRevision.findFirstOrThrow({
      where: { pageId: groupA },
      orderBy: { revisionNumber: "desc" },
    });
    expect(nl?.translationSourceRevisionId).toBe(enRev.id);
    // The source's structure (ids, types, the empty optional fields) with the translated texts;
    // a text without a translation is empty.
    const enContent = enRev.content as { sections: Record<string, unknown>[] };
    expect(nl?.content).toEqual({
      sections: [
        { ...enContent.sections[0], title: "Over ML-13", intro: "" },
        { ...enContent.sections[1], title: "Ons verhaal", body: "Opgericht in 1990." },
      ],
    });
    // A draft only: no revision, no publication; visitors see nothing new.
    expect(await owner.cmsPageRevision.count({ where: { pageId: nl!.id } })).toBe(0);
    expect(await owner.cmsPagePublication.count({ where: { pageId: nl!.id } })).toBe(0);
    expect(await liveFingerprint()).toBe(live);
    expect(
      (
        await owner.siteLocale.findUniqueOrThrow({
          where: { siteId_locale: { siteId: BV, locale: "nl" } },
        })
      ).public,
    ).toBe(false);
    // The editor sees the page with the same structure as its source.
    expect((await pageOf(nl!.id)).page.structureWarnings).toEqual([]);

    const text = await owner.productListingText.findUniqueOrThrow({
      where: { listingId_locale: { listingId, locale: "nl" } },
    });
    expect(text).toMatchObject({
      title: "ML-13 Basisolie 4",
      summary: "Een heldere basisolie.",
      description: null,
    });
    expect(
      (await owner.productSiteListing.findUniqueOrThrow({ where: { id: listingId } })).version,
    ).toBe(listingBefore.version + 1);
    expect(
      await owner.productCategoryText.findUniqueOrThrow({
        where: { categoryId_locale: { categoryId, locale: "nl" } },
      }),
    ).toMatchObject({ name: "ML-13 Basisoliën", description: null });
    expect(
      (
        await owner.specDefinitionText.findUniqueOrThrow({
          where: { definitionId_locale: { definitionId, locale: "nl" } },
        })
      ).name,
    ).toBe("Kinematische viscositeit ML-13");
    expect(
      (
        await owner.productImageText.findUniqueOrThrow({
          where: { imageId_locale: { imageId, locale: "nl" } },
        })
      ).altText,
    ).toBe("Een blauw ML-13 vat");
    // The translation states agree: the written parts are not "outdated".
    const tr = ProductTranslationsResponseSchema.parse(
      (
        await root.get(
          `/api/v1/admin/catalog/products/${productId}/translations?siteId=${BV}&locale=nl`,
        )
      ).body,
    );
    expect(tr.listing?.state).not.toBe("OUTDATED");
    expect(tr.category?.state).not.toBe("OUTDATED");
    expect(tr.specs.find((s) => s.definitionId === definitionId)?.state).not.toBe("OUTDATED");
    expect(tr.images.find((i) => i.id === imageId)?.state).not.toBe("OUTDATED");

    // Audit: one event per written row (origin and digest) and one summary; never a text.
    const summary = await lastAudit("translation.package_imported");
    expect(summary).toMatchObject({ actorUserId: root.userId, siteId: BV, outcome: "SUCCESS" });
    expect(summary?.metadata).toMatchObject({
      digest: r.digest,
      targetLocale: "nl",
      written: r.written,
    });
    expect(await lastAudit("cms.translation_created")).toMatchObject({ resourceId: nl!.id });
    expect((await lastAudit("catalog.listing_translation_updated"))?.metadata).toMatchObject({
      origin: "translation_package",
      digest: r.digest,
      checked: ["texts", "seo"],
    });
    for (const action of [
      "translation.package_imported",
      "catalog.listing_translation_updated",
      "cms.translation_created",
    ]) {
      expect(JSON.stringify((await lastAudit(action))?.metadata)).not.toMatch(
        /Basisolie|Over ML|verhaal/,
      );
    }
  });

  it("a repeated import is idempotent: every unit unchanged, no version raised, nothing written", async () => {
    const fp = await fingerprint();
    const r = await report(root, "import", filled);
    expect(r.counts).toMatchObject({ create: 0, update: 0, unchanged: 11 });
    expect(r.written).toEqual({
      cmsPagesCreated: 0,
      cmsPagesUpdated: 0,
      listings: 0,
      categories: 0,
      specs: 0,
      images: 0,
    });
    expect(r.pages.find((p) => p.groupId === groupA)).toMatchObject({ action: "unchanged" });
    expect(await fingerprint()).toBe(fp);
  });

  it("a repeated import writes exactly one audit event, by design: the summary of the attempt (no per-row event)", async () => {
    const audits = await auditCount();
    const fp = await fingerprint();
    const r = await report(root, "import", filled);
    expect(r.counts).toMatchObject({ create: 0, update: 0 });
    // Content and versions: unchanged (as above).
    expect(await fingerprint()).toBe(fp);
    expect(await auditCount()).toBe(audits + 1);
    const events = await owner.auditEvent.findMany({ orderBy: { occurredAt: "desc" }, take: 1 });
    expect(events.map((e) => e.action)).toEqual(["translation.package_imported"]);
    expect(events[0]).toMatchObject({ actorUserId: root.userId, siteId: BV, outcome: "SUCCESS" });
    expect(events[0]?.metadata).toMatchObject({
      digest: r.digest,
      written: {
        cmsPagesCreated: 0,
        cmsPagesUpdated: 0,
        listings: 0,
        categories: 0,
        specs: 0,
        images: 0,
      },
      counts: expect.objectContaining({ create: 0, update: 0, unchanged: 11 }),
    });
  });

  it("CMS source is the published revision: a newer draft is not exported or compared; a page that is not live is out of scope", async () => {
    const unit = (pkg: Pkg, field: string) =>
      pkg.units.find((u) => u.key === key("cms", groupA, field));
    const before = await exported();
    // An English draft newer than the live revision (saved, not published).
    await saveDraft(groupA, () => ({
      title: "About ML-13 (draft only)",
      content: { sections: [{ ...HERO_A, title: "Draft-only hero" }, TEXT_A] },
    }));
    const after = await exported();
    expect(after.pages.find((p) => p.groupId === groupA)?.sourceRevisionNumber).toBe(1);
    for (const field of ["title", "content.sections.@ml13-hero-0001.title"]) {
      expect(unit(after, field)).toMatchObject({
        source: "About ML-13",
        sourceHash: unit(before, field)?.sourceHash,
      });
    }
    expect(JSON.stringify(after.units)).not.toContain("draft only");
    expect(JSON.stringify(after.units)).not.toContain("Draft-only");
    // The import compares with the same published text: nothing of the page is outdated.
    const r = await report(root, "dry-run", filled);
    const groupUnits = r.units.filter((u) => u.key.startsWith(`cms:${groupA}:`));
    expect(groupUnits.length).toBeGreaterThan(0);
    expect(groupUnits.filter((u) => u.status === "outdated")).toEqual([]);
    expect(statusOf(r)[key("cms", groupA, "title")]).toBe("unchanged");
    // The English draft is put back (the later sections publish this page).
    await saveDraft(groupA, () => ({
      title: "About ML-13",
      content: { sections: [HERO_A, TEXT_A] },
    }));

    // A page that was never published is not exported.
    const draftOnly = await bvEditor.post(`/sites/${BV}/pages`, {
      title: "Never published ML-13",
      slug: "ml13-never-published",
    });
    expect(draftOnly.status).toBe(201);
    const draftGroup = CmsPageResponseSchema.parse(draftOnly.body).page.id;
    // A live page, exported, then taken off the site.
    const liveGroup = await englishPage("ml13-unpublished", "Unpublished ML-13", [
      { id: "ml13-text-0005", type: "text", title: "Gone", body: "Soon gone." },
    ]);
    const pkg = await exported();
    expect(pkg.pages.some((p) => p.groupId === draftGroup)).toBe(false);
    expect(pkg.pages.some((p) => p.groupId === liveGroup)).toBe(true);
    const live = (await pageOf(liveGroup)).page;
    const off = await bvPublisher.post(`/pages/${liveGroup}/unpublish`, {
      publicationVersion: live.publication!.version,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect((await exported()).pages.some((p) => p.groupId === liveGroup)).toBe(false);
    // Its units in an earlier package are skipped, and nothing is created for it.
    const fp = await fingerprint();
    const r2 = await report(
      root,
      "import",
      fill(pkg, {
        [key("cms", liveGroup, "title")]: "Niet meer online ML-13",
        [key("cms", liveGroup, "content.sections.@ml13-text-0005.body")]: "Binnenkort weg.",
      }),
    );
    expect(statusOf(r2)[key("cms", liveGroup, "title")]).toBe("outdated:source_unpublished");
    expect(statusOf(r2)[key("cms", liveGroup, "content.sections.@ml13-text-0005.body")]).toBe(
      "outdated:source_unpublished",
    );
    expect(r2.pages.find((p) => p.groupId === liveGroup)).toMatchObject({
      action: "skipped",
      rule: "source_unpublished",
    });
    expect(r2.written).toMatchObject({ cmsPagesCreated: 0, cmsPagesUpdated: 0 });
    expect(await nlPage(liveGroup)).toBeNull();
    expect(await fingerprint()).toBe(fp);
  });

  it("outdated, conflicting, mis-structured and invalid units are skipped; the valid ones are written", async () => {
    const pkg = await exported();
    const nlId = (await nlPage(groupA))!.id;
    expect(pkg.pages.find((p) => p.groupId === groupA)?.targetPageId).toBe(nlId);
    expect(pkg.units.find((u) => u.key === key("cms", groupA, "title"))).toMatchObject({
      current: "Over ML-13",
    });
    // After the export: the English title changes (new revision) and an editor changes the
    // Dutch SEO title.
    await saveDraft(groupA, () => ({ title: "About ML-13 (new)" }));
    const en = (await pageOf(groupA)).page;
    expect(
      (await bvPublisher.post(`/pages/${groupA}/publish`, { version: en.version })).status,
    ).toBe(200);
    await saveDraft(nlId, (p) => ({ seo: { ...p.seo, title: "Over ML-13 (redactie)" } }));
    const r = await report(
      root,
      "import",
      fill(
        pkg,
        {
          [key("cms", groupA, "title")]: "Over ML-13 (nieuw)", // source changed → outdated
          [key("cms", groupA, "seo.title")]: "Over ML-13 SEO 2", // target changed → conflict
          [key("cms", groupA, "seo.description")]: "x".repeat(321), // → invalid too_long
          [key("cms", groupA, "content.sections.@ml13-hero-0001.intro")]: "Wie wij zijn.", // written
          [key("cms", groupA, "content.sections.@ml13-text-0002.title")]: "y".repeat(121), // too_long
          [key("listing", listingId, "description")]: "Gedeelde\u0007omschrijving", // control chars
          [key("listing", listingId, "seo.title")]: "ML-13 Basisolie 4 SEO", // written
          [key("category", categoryId, "description")]: "Groep III basisoliën", // written
        },
        // A unit of a listing that does not exist (any more).
        [
          {
            key: key("listing", "0190f2a1-0000-7000-8000-0000000000ff", "title"),
            kind: "listing",
            context: "gone",
            maxLength: 200,
            multiline: false,
            source: "Gone",
            sourceHash: createHash("sha256").update("Gone").digest("hex"),
            current: null,
            currentHash: null,
            target: "Weg",
          },
        ],
      ),
    );
    const st = statusOf(r);
    expect(st[key("cms", groupA, "title")]).toBe("outdated:source_changed");
    expect(st[key("cms", groupA, "seo.title")]).toBe("conflict:target_changed");
    expect(st[key("cms", groupA, "seo.description")]).toBe("invalid:too_long");
    expect(st[key("cms", groupA, "content.sections.@ml13-hero-0001.intro")]).toBe("create");
    expect(st[key("cms", groupA, "content.sections.@ml13-text-0002.title")]).toBe(
      "invalid:too_long",
    );
    expect(st[key("listing", listingId, "description")]).toBe("invalid:control_characters");
    expect(st[key("listing", listingId, "seo.title")]).toBe("create");
    expect(st[key("category", categoryId, "description")]).toBe("create");
    expect(st[key("listing", "0190f2a1-0000-7000-8000-0000000000ff", "title")]).toBe("not_found");
    expect(r.written).toMatchObject({ cmsPagesUpdated: 1, listings: 1, categories: 1 });
    const nl = await owner.cmsPage.findUniqueOrThrow({ where: { id: nlId } });
    expect(nl.title).toBe("Over ML-13");
    expect(nl.seoTitle).toBe("Over ML-13 (redactie)");
    expect(
      (nl.content as { sections: { intro?: string; title: string }[] }).sections[0]?.intro,
    ).toBe("Wie wij zijn.");
    // Not every source text is verified: the page still records the older source revision.
    const revs = await owner.cmsPageRevision.findMany({
      where: { pageId: groupA },
      orderBy: { revisionNumber: "asc" },
    });
    expect(revs).toHaveLength(2);
    expect(nl.translationSourceRevisionId).toBe(revs[0]?.id);
    expect(
      (
        await owner.productListingText.findUniqueOrThrow({
          where: { listingId_locale: { listingId, locale: "nl" } },
        })
      ).seoTitle,
    ).toBe("ML-13 Basisolie 4 SEO");

    // A translation whose structure differs gets no content text; its title still can.
    await saveDraft(nlId, (p) => ({
      content: { sections: [(p.content["sections"] as unknown[])[0]] },
    }));
    const pkg2 = await exported();
    const r2 = await report(
      root,
      "dry-run",
      fill(pkg2, {
        [key("cms", groupA, "title")]: "Over ML-13 (nieuw)",
        [key("cms", groupA, "content.sections.@ml13-hero-0001.intro")]: "Wie we zijn.",
      }),
    );
    expect(statusOf(r2)[key("cms", groupA, "title")]).toBe("update");
    expect(statusOf(r2)[key("cms", groupA, "content.sections.@ml13-hero-0001.intro")]).toBe(
      "conflict:structure",
    );
  });

  it("menus: a text the menu schema refuses (e.g. too long) is invalid; the others are processed", async () => {
    // The Dutch menu of the earlier sections has its own structure; give it the structure of the
    // live English menu (as "Create translation" would) so its texts can be imported.
    const enNav = await owner.cmsPage.findFirstOrThrow({
      where: { siteId: BV, templateKey: "bv.site-nav", locale: "en" },
    });
    const enRev = await owner.cmsPageRevision.findFirstOrThrow({
      where: { pageId: enNav.id },
      orderBy: { revisionNumber: "desc" },
    });
    await owner.cmsPage.updateMany({
      where: { siteId: BV, templateKey: "bv.site-nav", locale: "nl" },
      data: { content: enRev.content as never, version: { increment: 1 } },
    });
    const pkg = await exported();
    const nav = pkg.pages.find((p) => p.templateKey === "bv.site-nav")!;
    const labels = pkg.units.filter(
      (u) => u.key.startsWith(`cms:${nav.groupId}:content.`) && u.key.endsWith(".label"),
    );
    expect(labels.length).toBeGreaterThan(1);
    const [tooLong, ok] = labels as [(typeof labels)[0], (typeof labels)[0]];
    const r = await report(
      root,
      "dry-run",
      fill(pkg, {
        [key("cms", nav.groupId, "title")]: "Navigatie",
        [tooLong.key]: "x".repeat(81),
        [ok.key]: `${ok.source} (NL)`,
      }),
    );
    const st = statusOf(r);
    expect(st[tooLong.key]).toBe("invalid:schema");
    expect(["create", "update"]).toContain(st[ok.key]);
    expect(r.pages.find((p) => p.groupId === nav.groupId)?.action).toMatch(/create|update/);
  });

  it("addresses: a translated slug must be valid and free; a new page needs its title", async () => {
    const pkg = await exported();
    const r = await report(
      root,
      "dry-run",
      fill(pkg, {
        [key("cms", groupB, "title")]: "Diensten ML-13",
        [key("cms", groupB, "slug")]: "over-ml13", // the Dutch page of group A has it
        [key("cms", groupC, "content.sections.@ml13-text-0004.title")]: "Werk bij ons",
      }),
    );
    let st = statusOf(r);
    expect(st[key("cms", groupB, "slug")]).toBe("conflict:slug_taken");
    // The page is still created, at the source's address (free in Dutch).
    expect(st[key("cms", groupB, "title")]).toBe("create");
    expect(r.pages.find((p) => p.groupId === groupB)).toMatchObject({ action: "create" });
    expect(st[key("cms", groupC, "content.sections.@ml13-text-0004.title")]).toBe(
      "invalid:title_required",
    );
    expect(r.pages.find((p) => p.groupId === groupC)).toMatchObject({
      action: "skipped",
      rule: "title_required",
    });

    const bad = async (slug: string) =>
      statusOf(
        await report(
          root,
          "dry-run",
          fill(pkg, { [key("cms", groupB, "title")]: "D", [key("cms", groupB, "slug")]: slug }),
        ),
      )[key("cms", groupB, "slug")];
    expect(await bad("Over Ons")).toBe("invalid:format");
    expect(await bad("products")).toBe("invalid:reserved");

    // Two pages of the package asking for the same new address: the first in the package wins
    // (pages are exported in address order: /ml13-careers before /ml13-services); the other page
    // is still created, at its source's address.
    const r2 = await report(
      root,
      "import",
      fill(pkg, {
        [key("cms", groupB, "title")]: "Diensten ML-13",
        [key("cms", groupB, "slug")]: "ml13-nl-dubbel",
        [key("cms", groupC, "title")]: "Werken ML-13",
        [key("cms", groupC, "slug")]: "ml13-nl-dubbel",
      }),
    );
    st = statusOf(r2);
    expect(st[key("cms", groupC, "slug")]).toBe("create");
    expect(st[key("cms", groupB, "slug")]).toBe("conflict:duplicate_slug");
    expect((await nlPage(groupC))?.path).toBe("/ml13-nl-dubbel");
    expect((await nlPage(groupB))?.path).toBe("/ml13-services");
    expect(r2.written.cmsPagesCreated).toBe(2);
  });

  // --- DP-285: bounded transaction of the dry run and the import ------------------------------

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const NOTHING_WRITTEN = {
    cmsPagesCreated: 0,
    cmsPagesUpdated: 0,
    listings: 0,
    categories: 0,
    specs: 0,
    images: 0,
  };
  /** Another session holds a table lock until `release` (dp_migrator as the table owner). */
  async function holdLock(table: string, mode: "EXCLUSIVE" | "ACCESS EXCLUSIVE") {
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const done = owner.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`LOCK TABLE "${table}" IN ${mode} MODE`);
        locked();
        await released;
      },
      { timeout: 60_000, maxWait: 5_000 },
    );
    await Promise.race([isLocked, done]);
    return async () => {
      release();
      await done;
    };
  }
  /** Resolves once a session waits for a lock (the request reached the locked table). */
  async function someoneWaitsForALock() {
    for (let i = 0; i < 200; i++) {
      const [row] = await owner.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted`;
      if ((row?.n ?? 0) > 0) return;
      await sleep(25);
    }
    throw new Error("no session waits for a lock");
  }
  async function refusal(p: Promise<unknown>): Promise<unknown> {
    try {
      await p;
    } catch (e) {
      return e;
    }
    throw new Error("expected a refusal");
  }
  /** A package that updates the Dutch page of group A, the listing and the image (last write). */
  const freshPackage = async (tag: string) =>
    fill(await exported(), {
      [key("cms", groupA, "title")]: `Over ML-13 ${tag}`,
      [key("listing", listingId, "title")]: `ML-13 Basisolie 4 ${tag}`,
      [key("image", imageId, "alt")]: `Een blauw ML-13 vat ${tag}`,
    });
  const summaries = () =>
    owner.auditEvent.count({ where: { action: "translation.package_imported" } });

  it("DP-285: a write lock longer than lock_timeout ends the import with 409 {transaction, locked} in ~5 s; the CMS and catalogue rows written before it are rolled back", async () => {
    const pkg = await freshPackage("lock");
    const st = statusOf(await report(root, "dry-run", pkg));
    expect(st[key("cms", groupA, "title")]).toBe("update");
    expect(st[key("listing", listingId, "title")]).toBe("update");
    expect(st[key("image", imageId, "alt")]).toBe("update");
    const fp = await fingerprint();
    const live = await liveFingerprint();
    const audits = await auditCount();
    // The image texts are the import's last write: the page, the listing, the category and the
    // specification are written before the import meets the lock.
    const release = await holdLock("ProductImageText", "EXCLUSIVE");
    let ms = 0;
    try {
      const started = Date.now();
      const res = await run(root, "import", pkg);
      ms = Date.now() - started;
      expectError(res, 409, "CONFLICT_STATE", { path: "transaction", rule: "locked" });
    } finally {
      await release();
    }
    expect(ms).toBeGreaterThanOrEqual(IMPORT_LIMITS.lockTimeoutMs - 250);
    expect(ms).toBeLessThan(IMPORT_LIMITS.lockTimeoutMs + 5_000);
    // Rolled back as a whole: no row, no version, no audit event, nothing published.
    expect(await fingerprint()).toBe(fp);
    expect(await liveFingerprint()).toBe(live);
    expect(await auditCount()).toBe(audits);
    // After the release the same package imports normally.
    const r = await report(root, "import", pkg);
    expect(r.written).toMatchObject({ cmsPagesUpdated: 1, listings: 1, images: 1 });
    expect(await liveFingerprint()).toBe(live);
  });

  it("DP-285: the dry run reads in one read-only bounded transaction: behind an exclusive lock it is 409 {transaction, locked}, not a hang", async () => {
    const pkg = await freshPackage("dry");
    const audits = await auditCount();
    const release = await holdLock("ProductListingText", "ACCESS EXCLUSIVE");
    let ms = 0;
    try {
      const started = Date.now();
      const res = await run(root, "dry-run", pkg);
      ms = Date.now() - started;
      expectError(res, 409, "CONFLICT_STATE", { path: "transaction", rule: "locked" });
    } finally {
      await release();
    }
    expect(ms).toBeLessThan(DRY_RUN_LIMITS.lockTimeoutMs + 5_000);
    expect(await auditCount()).toBe(audits);
    expect((await report(root, "dry-run", pkg)).dryRun).toBe(true);
  });

  it("DP-285: bounded transaction — lock, statement and transaction limits are refusals the API maps; what was written is rolled back; the settings end with the transaction", async () => {
    const scope = { siteIds: [BV], includePlatform: true };
    // One pooled connection only: the settings after the transaction are read on the same one.
    const single = new PrismaClient({
      adapter: new PrismaPg({ connectionString: urls.app, max: 1 }),
    });
    const where = { categoryId, locale: "nl" };
    const catText = () =>
      owner.productCategoryText.findUniqueOrThrow({ where: { categoryId_locale: where } });
    const before = await catText();
    const limits = (l: Partial<TransactionLimits>): TransactionLimits => ({
      lockTimeoutMs: 10_000,
      statementTimeoutMs: 10_000,
      timeoutMs: 10_000,
      maxWaitMs: 2_000,
      ...l,
    });
    const writeThen =
      (next: (db: SiteScopedClient) => Promise<unknown>) => async (db: SiteScopedClient) => {
        await db.productCategoryText.updateMany({
          where,
          data: { description: "DP-285 rolled back" },
        });
        await next(db);
      };
    try {
      // lock_timeout: SQLSTATE 55P03 -> 409 locked.
      let release = await holdLock("ProductImageText", "ACCESS EXCLUSIVE");
      let e: unknown;
      let started = Date.now();
      try {
        e = await refusal(
          boundedTransaction(
            single,
            scope,
            limits({ lockTimeoutMs: 300 }),
            writeThen((db) => db.productImageText.findMany({ take: 1 })),
          ),
        );
      } finally {
        await release();
      }
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(transientDbRule(e)).toBe("locked");
      expect(transientDbError(e)).toMatchObject({
        code: "CONFLICT_STATE",
        status: 409,
        details: [{ path: "transaction", rule: "locked" }],
      });
      expect(await catText()).toEqual(before);

      // statement_timeout: a statement still waiting at its limit, SQLSTATE 57014 -> 503 timeout.
      release = await holdLock("ProductImageText", "ACCESS EXCLUSIVE");
      started = Date.now();
      try {
        e = await refusal(
          boundedTransaction(
            single,
            scope,
            limits({ statementTimeoutMs: 300 }),
            writeThen((db) => db.productImageText.findMany({ take: 1 })),
          ),
        );
      } finally {
        await release();
      }
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(transientDbRule(e)).toBe("timeout");
      expect(transientDbError(e)).toMatchObject({
        code: "DATABASE_UNAVAILABLE",
        status: 503,
        details: [{ path: "transaction", rule: "timeout" }],
      });
      expect(await catText()).toEqual(before);

      // The transaction's own limit (Prisma timeout): expired between two statements -> P2028.
      e = await refusal(
        boundedTransaction(
          single,
          scope,
          limits({ timeoutMs: 300 }),
          writeThen(async (db) => {
            await sleep(800);
            await db.productCategoryText.findMany({ take: 1 });
          }),
        ),
      );
      expect(transientDbRule(e)).toBe("timeout");
      expect(await catText()).toEqual(before);

      // The worst case holds: a statement blocked for longer than every limit still ends in time.
      const small = limits({ lockTimeoutMs: 2_000, statementTimeoutMs: 600, timeoutMs: 400 });
      release = await holdLock("ProductImageText", "ACCESS EXCLUSIVE");
      started = Date.now();
      try {
        e = await refusal(
          boundedTransaction(
            single,
            scope,
            small,
            writeThen((db) => db.productImageText.findMany({ take: 1 })),
          ),
        );
      } finally {
        await release();
      }
      expect(Date.now() - started).toBeLessThan(worstCaseMs(small) + 1_000);
      expect(transientDbRule(e)).toBe("timeout");
      expect(await catText()).toEqual(before);

      // Read only: a write is refused by the database, and that is NOT a transient refusal.
      e = await refusal(
        boundedTransaction(
          single,
          scope,
          limits({ readOnly: true }),
          writeThen(async () => {}),
        ),
      );
      expect(JSON.stringify(e, Object.getOwnPropertyNames(e)) + String(e)).toMatch(
        /read-only|25006/,
      );
      expect(transientDbRule(e)).toBeNull();
      // Other database refusals stay unexpected too (unique key -> the caller's normal mapping).
      e = await refusal(
        boundedTransaction(single, scope, limits({}), (db) =>
          db.productCategoryText.create({
            data: { categoryId, siteId: BV, locale: "nl", name: "duplicate" },
          }),
        ),
      );
      expect(transientDbRule(e)).toBeNull();
      expect(await catText()).toEqual(before);

      // A committed bounded transaction; afterwards the same connection has the defaults again.
      await boundedTransaction(single, scope, limits({ readOnly: true }), (db) =>
        db.productCategoryText.findMany({ take: 1 }),
      );
      const settings = await single.$queryRaw<{ l: string; s: string; r: string }[]>`
        SELECT current_setting('lock_timeout') AS l, current_setting('statement_timeout') AS s,
          current_setting('transaction_read_only') AS r`;
      expect(settings).toEqual([{ l: "0", s: "0", r: "off" }]);
      await expect(
        boundedTransaction(single, scope, limits({ lockTimeoutMs: 0 }), async () => 1),
      ).rejects.toThrow(/positive ms/);
    } finally {
      await single.$disconnect();
    }
  });

  it("DP-285: concurrent imports of the same package write it once; the others are stale (409) or find nothing to write; never a 500", async () => {
    const pkg = await freshPackage("parallel");
    const listingVersion = async () =>
      (await owner.productSiteListing.findUniqueOrThrow({ where: { id: listingId } })).version;
    const pageVersion = async () => (await nlPage(groupA))!.version;
    const [lv, pv, before] = [await listingVersion(), await pageVersion(), await summaries()];
    const live = await liveFingerprint();
    const results = await Promise.all([1, 2, 3].map(() => run(root, "import", pkg)));
    for (const r of results) {
      expect([200, 409], JSON.stringify(r.body).slice(0, 500)).toContain(r.status);
      if (r.status === 409) expect(r.body.error.code).toBe("CONFLICT_STATE");
    }
    const ok = results
      .filter((r) => r.status === 200)
      .map((r) => TranslationImportReportSchema.parse(r.body));
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(ok.filter((r) => r.written.listings === 1)).toHaveLength(1);
    expect(ok.filter((r) => r.written.cmsPagesUpdated === 1)).toHaveLength(1);
    expect(await listingVersion()).toBe(lv + 1);
    expect(await pageVersion()).toBe(pv + 1);
    expect(await summaries()).toBe(before + ok.length);
    expect(await liveFingerprint()).toBe(live);
    // Afterwards the package is fully imported: the repeat writes nothing.
    expect((await report(root, "import", pkg)).written).toEqual(NOTHING_WRITTEN);
  });

  it("DP-285: a lost answer — the API still commits; the dry run then shows the units unchanged and a repeated import writes nothing twice", async () => {
    const pkg = await freshPackage("lost");
    const imageAlt = async () =>
      (
        await owner.productImageText.findUnique({
          where: { imageId_locale: { imageId, locale: "nl" } },
        })
      )?.altText;
    const release = await holdLock("ProductImageText", "EXCLUSIVE");
    const giveUp = new AbortController();
    try {
      const pending = root.call("POST", `${API}/import`, { package: pkg }, giveUp.signal).then(
        () => null,
        (e: unknown) => e,
      );
      await someoneWaitsForALock(); // the import is inside its transaction
      giveUp.abort(); // the browser (or the proxy) gives up: the answer is lost
      expect(await pending).toBeInstanceOf(Error);
    } finally {
      await release(); // well within lock_timeout
    }
    // The API finishes on its own: the import is committed although nobody got the answer.
    for (let i = 0; i < 100 && (await imageAlt()) !== "Een blauw ML-13 vat lost"; i++) {
      await sleep(50);
    }
    expect(await imageAlt()).toBe("Een blauw ML-13 vat lost");
    // What the admin is told to do next: the dry run shows nothing left to write.
    const dry = await report(root, "dry-run", pkg);
    expect(dry.counts).toMatchObject({ create: 0, update: 0 });
    const st = statusOf(dry);
    expect(st[key("cms", groupA, "title")]).toBe("unchanged");
    expect(st[key("listing", listingId, "title")]).toBe("unchanged");
    expect(st[key("image", imageId, "alt")]).toBe("unchanged");
    const fp = await fingerprint();
    expect((await report(root, "import", pkg)).written).toEqual(NOTHING_WRITTEN);
    expect(await fingerprint()).toBe(fp);
  });
});

// ---------------------------------------------------------------------------------------------
// COM-1: the Corporate site on the shared CMS — its own fragments (navigation, footer, SEO
// defaults) imported and published like BV's, served only for its own key, its sitemap and SEO
// defaults, Turkish editable but hidden, and no catalogue addresses.
// ---------------------------------------------------------------------------------------------

describe("24. the Corporate site on the shared CMS (COM-1)", () => {
  let comPublisher: Staff;
  const ids: Record<string, string> = {};

  async function seo(p: string, key: string = TEST_KEYS.webCorporate): Promise<Res> {
    return parse(
      await fetch(`${base}/api/v1/public/seo${p}`, {
        headers: { "x-dp-proxy-key": key, "x-dp-client-ip": "10.20.30.47" },
      }),
    );
  }
  async function publish(id: string): Promise<Res> {
    const p = CmsPageResponseSchema.parse((await comPublisher.get(`/pages/${id}`)).body).page;
    return comPublisher.post(`/pages/${id}/publish`, { version: p.version });
  }

  beforeAll(async () => {
    comPublisher = await staff(
      "com1-publisher",
      [{ role: "content_publisher", site: COM }],
      root.userId,
    );
  });

  it("imports the corporate fragments into the Corporate site only", async () => {
    for (const key of ["corporate.site-nav", "corporate.site-footer", "corporate.site-seo"]) {
      // A corporate key is no template of the BV site.
      expectError(
        await bvEditor.post(`/sites/${BV}/import`, { key, dryRun: true }),
        400,
        "VALIDATION_FAILED",
        { path: "key", rule: "unknown_template" },
      );
      const res = await comEditor.post(`/sites/${COM}/import`, { key, dryRun: false });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      ids[key] = CmsImportResponseSchema.parse(res.body).pageId!;
      const page = CmsPageResponseSchema.parse(
        (await comEditor.get(`/pages/${ids[key]}`)).body,
      ).page;
      expect(page).toMatchObject({ kind: "FRAGMENT", templateKey: key, locale: "en", path: null });
    }
    // And a BV key is no template of the Corporate site.
    expectError(
      await comEditor.post(`/sites/${COM}/import`, { key: "bv.site-nav", dryRun: true }),
      400,
      "VALIDATION_FAILED",
      { path: "key", rule: "unknown_template" },
    );
  });

  it("serves the published corporate menus for the corporate key only, in their public shape", async () => {
    // Unpublished: no frame (nothing from code).
    const before = CmsPublicNewsSchema.parse((await pub("/news", TEST_KEYS.webCorporate)).body);
    expect(before.fragments["corporate.site-nav"]).toBeNull();
    for (const key of ["corporate.site-nav", "corporate.site-footer"]) {
      const res = await publish(ids[key]!);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    const com = CmsPublicNewsSchema.parse((await pub("/news", TEST_KEYS.webCorporate)).body);
    expect(Object.keys(com.fragments).sort()).toEqual([
      "corporate.site-footer",
      "corporate.site-nav",
    ]);
    const nav = BvNavPublicSchema.parse(com.fragments["corporate.site-nav"]!.content);
    // COM-5: imported before any corporate page, every link is "not ready" (text), never a guessed
    // address; the import points a link at its page only where that page is in the CMS.
    expect(nav.items[0]).toMatchObject({ label: "Home", href: null });
    expect(
      nav.items.flatMap((i) => [i, ...i.children]).filter((i) => i.href !== null),
    ).toHaveLength(0);
    const footer = BvFooterPublicSchema.parse(com.fragments["corporate.site-footer"]!.content);
    expect(footer.contact.email.href).toBe("mailto:info@dreampetroleum.com");
    // The BV key never sees a corporate fragment, nor the corporate key a BV one.
    const bv = CmsPublicNewsSchema.parse((await pub("/news")).body);
    expect(Object.keys(bv.fragments).some((k) => k.startsWith("corporate."))).toBe(false);
    expect(Object.keys(com.fragments).some((k) => k.startsWith("bv."))).toBe(false);
  });

  it("serves the corporate SEO defaults without an image, per site", async () => {
    const res = await publish(ids["corporate.site-seo"]!);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const com = PublicSiteSeoResponseSchema.parse((await seo("/settings")).body);
    expect(com.settings).toEqual({
      siteName: "Dream Petroleum",
      defaultTitle: "Dream Petroleum - Global Energy Markets",
      defaultDescription:
        "Dream Petroleum is a global energy and petroleum investment company operating across midstream and downstream markets.",
      defaultOgImage: null,
    });
    const bv = PublicSiteSeoResponseSchema.parse((await seo("/settings", TEST_KEYS.webBv)).body);
    expect(bv.settings?.siteName).not.toBe("Dream Petroleum");
    // The admin overview of the Corporate site shows its own defaults.
    const o = SeoOverviewResponseSchema.parse(
      (await comPublisher.get(`/api/v1/admin/seo/sites/${COM}/overview`)).body,
    );
    expect(o.settings?.pageId).toBe(ids["corporate.site-seo"]);
    expect(o.liveSettings?.siteName).toBe("Dream Petroleum");
  });

  it("lists and resolves corporate pages only, never catalogue addresses", async () => {
    const created = await comEditor.post(`/sites/${COM}/pages`, {
      title: "About",
      slug: "com1-about",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = CmsPageResponseSchema.parse(created.body).page.id;
    expect((await publish(id)).status).toBe(200);
    const com = PublicSitemapResponseSchema.parse((await seo("/sitemap")).body).entries;
    expect(com.map((e) => e.path)).toContain("/com1-about");
    expect(com.some((e) => e.kind === "products" || e.kind === "product")).toBe(false);
    expect(com.every((e) => e.locale === "en")).toBe(true);
    const bv = PublicSitemapResponseSchema.parse((await seo("/sitemap", TEST_KEYS.webBv)).body);
    expect(bv.entries.map((e) => e.path)).not.toContain("/com1-about");
    expect(bv.entries.some((e) => e.path === "/products")).toBe(true);
    expect((await seo(`/resolve?path=${encodeURIComponent("/com1-about")}`)).body).toEqual({
      path: "/com1-about",
      kind: "page",
    });
    expectError(
      await seo(`/resolve?path=${encodeURIComponent("/com1-about")}`, TEST_KEYS.webBv),
      404,
      "NOT_FOUND",
    );
    expectError(await seo(`/resolve?path=${encodeURIComponent("/products/x")}`), 404, "NOT_FOUND");
  });

  it("edits Turkish but keeps it hidden until it is made public", async () => {
    const created = await comEditor.post(`/sites/${COM}/pages`, {
      title: "Team",
      slug: "com1-team",
    });
    const en = CmsPageResponseSchema.parse(created.body).page;
    const tr = await comEditor.post(`/pages/${en.id}/translations`, {
      locale: "tr",
      title: "Ekibimiz",
      slug: "ekibimiz",
    });
    expect(tr.status, JSON.stringify(tr.body)).toBe(201);
    const trPage = CmsPageResponseSchema.parse(tr.body).page;
    expect(trPage.locale).toBe("tr");
    // A language the Corporate site does not have is refused.
    expect(
      (await comEditor.post(`/pages/${en.id}/translations`, { locale: "nl", title: "X" })).status,
    ).toBe(409);
    // Not public: nothing of it reaches the site, its sitemap or its language list.
    expectError(
      await pub(`/page?path=/ekibimiz&locale=tr`, TEST_KEYS.webCorporate),
      404,
      "NOT_FOUND",
    );
    expectError(await seo(`/resolve?path=/ekibimiz&locale=tr`), 404, "NOT_FOUND");
    expectError(await seo(`/resolve?path=${encodeURIComponent("/tr/ekibimiz")}`), 404, "NOT_FOUND");
    const locales = PublicSiteLocalesResponseSchema.parse(
      (await pub("/locales", TEST_KEYS.webCorporate)).body,
    );
    expect(locales.locales.map((l) => l.locale)).toEqual(["en"]);
  });

  // COM-2a (DP-320): each site's pages point at that site's own files; the corporate design works
  // without images, so a corporate split section may have none (BV keeps it required).
  const BV_IMAGE = "/media/services-showcase/logistics-desktop.webp";
  const splitSection = (image: string | null, imageAlt: string | null) => ({
    id: "sec-com2a-split",
    type: "split",
    eyebrow: "Services",
    title: "Logistics",
    body: "Sea and road.",
    image,
    imageAlt,
    imageNote: null,
  });
  const NO_SEO = { title: null, description: null, noindex: false };

  it("keeps each site's media apart (COM-2a, DP-320)", async () => {
    const created = await comEditor.post(`/sites/${COM}/pages`, {
      title: "Logistics",
      slug: "com2a-logistics",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const p = CmsPageResponseSchema.parse(created.body).page;
    const save = (content: unknown, seo: Record<string, unknown> = NO_SEO, version = p.version) =>
      comEditor.post(`/pages/${p.id}/draft`, {
        version,
        title: "Logistics",
        slug: "com2a-logistics",
        seo,
        content,
      });
    // A BV file on a corporate page: refused, as content and as the link-preview image.
    expectError(
      await save({ sections: [splitSection(BV_IMAGE, "A tanker.")] }),
      400,
      "VALIDATION_FAILED",
      { path: "content.sections.0.image", rule: "custom" },
    );
    expectError(
      await save({ sections: [] }, { ...NO_SEO, ogImage: BV_IMAGE }),
      400,
      "VALIDATION_FAILED",
      { path: "seo.ogImage", rule: "asset" },
    );
    // No image: valid on the corporate site, published and served as it is.
    const saved = await save({ sections: [splitSection(null, null)] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await publish(p.id)).status).toBe(200);
    const live = CmsPublicBundleSchema.parse(
      (await pub("/page?path=/com2a-logistics", TEST_KEYS.webCorporate)).body,
    );
    expect(live.page.content["sections"]).toEqual([splitSection(null, null)]);

    // BV keeps the image required.
    const bvPage = CmsPageResponseSchema.parse(
      (await bvEditor.post(`/sites/${BV}/pages`, { title: "Split", slug: "com2a-bv-split" })).body,
    ).page;
    const bvSave = (content: unknown) =>
      bvEditor.post(`/pages/${bvPage.id}/draft`, {
        version: bvPage.version,
        title: "Split",
        slug: "com2a-bv-split",
        seo: NO_SEO,
        content,
      });
    expectError(await bvSave({ sections: [splitSection(null, null)] }), 400, "VALIDATION_FAILED", {
      path: "content.sections.0.image",
      rule: "custom",
    });
    expect((await bvSave({ sections: [splitSection(BV_IMAGE, "A tanker.")] })).status).toBe(200);
  });

  it("previews a corporate draft on its own site only (COM-2a, DP-321)", async () => {
    const created = await comEditor.post(`/sites/${COM}/pages`, {
      title: "Draft only",
      slug: "com2a-preview",
    });
    const p = CmsPageResponseSchema.parse(created.body).page;
    const saved = await comEditor.post(`/pages/${p.id}/draft`, {
      version: p.version,
      title: "Draft only",
      slug: "com2a-preview",
      seo: NO_SEO,
      content: { sections: [{ id: "sec-com2a-text", type: "text", title: null, body: "Draft." }] },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const res = await comEditor.post(`/pages/${p.id}/preview`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const token = CmsPreviewResponseSchema.parse(res.body).url.split("/preview/")[1]!;
    expect(token).toMatch(/^v1\.[0-9a-f-]{36}\.CORPORATE\./);
    const view = CmsPublicBundleSchema.parse(
      (await pub(`/preview/${token}`, TEST_KEYS.webCorporate)).body,
    );
    expect(view).toMatchObject({
      preview: true,
      locale: "en",
      page: { kind: "TEMPLATE", path: "/com2a-preview", revisionNumber: null },
    });
    expect(Object.keys(view.fragments).every((k) => k.startsWith("corporate."))).toBe(true);
    // Never on the BV site, and the draft itself stays off the corporate site.
    expectError(await pub(`/preview/${token}`), 404, "NOT_FOUND");
    expectError(await pub("/page?path=/com2a-preview", TEST_KEYS.webCorporate), 404, "NOT_FOUND");
  });

  // COM-2b (DP-028, DP-094): the designed home page and the product portfolio.
  it("has no fragment preview while the corporate home is not in the CMS (COM-2b)", async () => {
    const res = await comEditor.post(`/pages/${ids["corporate.site-footer"]}/preview`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const token = CmsPreviewResponseSchema.parse(res.body).url.split("/preview/")[1]!;
    // COM-2a's stand-in (the fragment as the page) is gone: nothing to show the fragment on.
    expectError(await pub(`/preview/${token}`, TEST_KEYS.webCorporate), 404, "NOT_FOUND");
  });

  it("imports the corporate home and portfolio into the Corporate site only (COM-2b)", async () => {
    for (const [key, path] of [
      ["corporate.home", "/"],
      ["corporate.products", "/products"],
    ] as const) {
      expectError(
        await bvEditor.post(`/sites/${BV}/import`, { key, dryRun: true }),
        400,
        "VALIDATION_FAILED",
        { path: "key", rule: "unknown_template" },
      );
      const dry = await comEditor.post(`/sites/${COM}/import`, { key, dryRun: true });
      expect(dry.status, JSON.stringify(dry.body)).toBe(200);
      const res = await comEditor.post(`/sites/${COM}/import`, { key, dryRun: false });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      ids[key] = CmsImportResponseSchema.parse(res.body).pageId!;
      const page = CmsPageResponseSchema.parse(
        (await comEditor.get(`/pages/${ids[key]}`)).body,
      ).page;
      expect(page).toMatchObject({ kind: "DESIGN", templateKey: key, locale: "en", path });
      // Never twice (ADR-020 D7).
      expectError(
        await comEditor.post(`/sites/${COM}/import`, { key, dryRun: false }),
        409,
        "CONFLICT_STATE",
        { path: "key", rule: "already_imported" },
      );
      // A draft: nothing on the site before it is published.
      expectError(await pub(`/page?path=${path}`, TEST_KEYS.webCorporate), 404, "NOT_FOUND");
    }
    expectError(
      await comEditor.post(`/sites/${COM}/import`, { key: "bv.home", dryRun: true }),
      400,
      "VALIDATION_FAILED",
      { path: "key", rule: "unknown_template" },
    );
  });

  it("refuses claim fields and keeps the typical values optional (COM-2b)", async () => {
    const page = CmsPageResponseSchema.parse(
      (await comEditor.get(`/pages/${ids["corporate.home"]}`)).body,
    ).page;
    const save = (content: Record<string, unknown>, version = page.version) =>
      comEditor.post(`/pages/${page.id}/draft`, { version, title: "Home", seo: NO_SEO, content });
    const c = page.content as Record<string, Record<string, unknown>>;
    // The schema has no field for a counter or a testimonial: such content is refused.
    expectError(
      await save({
        ...c,
        hero: { ...c["hero"], counters: [{ value: "50+", label: "Countries" }] },
      }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(await save({ ...c, testimonials: [] }), 400, "VALIDATION_FAILED");
    const products = CmsPageResponseSchema.parse(
      (await comEditor.get(`/pages/${ids["corporate.products"]}`)).body,
    ).page;
    const pc = products.content as Record<string, Record<string, unknown>>;
    expect(pc["typicalValues"]?.["rows"]).toEqual([]);
    // Two groups with the same anchor would give two sections the same address.
    const groups = pc["groups"] as unknown as Record<string, unknown>[];
    expectError(
      await comEditor.post(`/pages/${products.id}/draft`, {
        version: products.version,
        title: "Products",
        seo: NO_SEO,
        content: { ...pc, groups: [groups[0], { ...groups[1], anchor: groups[0]!["anchor"] }] },
      }),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("previews the corporate home draft, and fragments on it (COM-2b, DP-321)", async () => {
    const home = await comEditor.post(`/pages/${ids["corporate.home"]}/preview`, {});
    expect(home.status, JSON.stringify(home.body)).toBe(200);
    const token = CmsPreviewResponseSchema.parse(home.body).url.split("/preview/")[1]!;
    expect(token).toMatch(/^v1\.[0-9a-f-]{36}\.CORPORATE\./);
    const view = CmsPublicBundleSchema.parse(
      (await pub(`/preview/${token}`, TEST_KEYS.webCorporate)).body,
    );
    expect(view.page).toMatchObject({
      kind: "DESIGN",
      templateKey: "corporate.home",
      path: "/",
      revisionNumber: null,
    });
    expect(view.fragments["corporate.site-nav"]).not.toBeNull();
    expectError(await pub(`/preview/${token}`), 404, "NOT_FOUND");
    // A fragment's draft is shown on the real home page now (its draft before it is published).
    const footer = await comEditor.post(`/pages/${ids["corporate.site-footer"]}/preview`, {});
    const ftoken = CmsPreviewResponseSchema.parse(footer.body).url.split("/preview/")[1]!;
    const fview = CmsPublicBundleSchema.parse(
      (await pub(`/preview/${ftoken}`, TEST_KEYS.webCorporate)).body,
    );
    expect(fview.page).toMatchObject({ kind: "DESIGN", templateKey: "corporate.home" });
    // The portfolio's preview is the portfolio.
    const products = await comEditor.post(`/pages/${ids["corporate.products"]}/preview`, {});
    const ptoken = CmsPreviewResponseSchema.parse(products.body).url.split("/preview/")[1]!;
    const pview = CmsPublicBundleSchema.parse(
      (await pub(`/preview/${ptoken}`, TEST_KEYS.webCorporate)).body,
    );
    expect(pview.page).toMatchObject({ kind: "DESIGN", templateKey: "corporate.products" });
  });

  it("publishes the corporate home and portfolio for the corporate key only (COM-2b)", async () => {
    for (const key of ["corporate.home", "corporate.products"]) {
      const res = await publish(ids[key]!);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    const home = CmsPublicBundleSchema.parse(
      (await pub("/page?path=/", TEST_KEYS.webCorporate)).body,
    );
    expect(home.page).toMatchObject({ kind: "DESIGN", templateKey: "corporate.home", path: "/" });
    expect(home.page.revisionNumber).toBe(1);
    const products = CmsPublicBundleSchema.parse(
      (await pub("/page?path=/products", TEST_KEYS.webCorporate)).body,
    );
    expect(products.page).toMatchObject({ templateKey: "corporate.products", path: "/products" });
    // The BV key never sees them (the BV site has no CMS page at /products).
    expectError(await pub("/page?path=/products"), 404, "NOT_FOUND");
    const bvHome = await pub("/page?path=/");
    expect(JSON.stringify(bvHome.body)).not.toContain("corporate.");
    // SEO: both addresses resolve on the corporate site and are listed in its sitemap.
    expect((await seo("/resolve?path=/products")).status).toBe(200);
    const entries = PublicSitemapResponseSchema.parse((await seo("/sitemap")).body).entries;
    expect(entries.find((e) => e.path === "/")).toMatchObject({ kind: "home", locale: "en" });
    expect(entries.find((e) => e.path === "/products")).toMatchObject({
      kind: "page",
      locale: "en",
    });
    const bvEntries = PublicSitemapResponseSchema.parse(
      (await seo("/sitemap", TEST_KEYS.webBv)).body,
    ).entries;
    expect(bvEntries.some((e) => e.path === "/products" && e.kind === "page")).toBe(false);
  });

  it("creates the Turkish home as a draft that stays off the site (COM-2b, ML-2)", async () => {
    const res = await comEditor.post(`/pages/${ids["corporate.home"]}/translations`, {
      locale: "tr",
      title: "Ana Sayfa",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const tr = CmsPageResponseSchema.parse(res.body).page;
    expect(tr).toMatchObject({
      kind: "DESIGN",
      templateKey: "corporate.home",
      locale: "tr",
      path: "/",
      translationGroupId: ids["corporate.home"],
      publication: null,
    });
    expectError(await pub("/page?path=/&locale=tr", TEST_KEYS.webCorporate), 404, "NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------------------------
// COM-3: the corporate news on the shared article model (DP-020) — its own list heading
// (`corporate.news-index`), its own articles in English and Turkish, served, resolved and listed
// in the sitemap for the corporate key only; the two sites never see each other's news.
// ---------------------------------------------------------------------------------------------

describe("25. corporate news (COM-3)", () => {
  let comPublisher: Staff;
  let headingId: string;

  async function seo(p: string, key: string = TEST_KEYS.webCorporate): Promise<Res> {
    return parse(
      await fetch(`${base}/api/v1/public/seo${p}`, {
        headers: { "x-dp-proxy-key": key, "x-dp-client-ip": "10.20.30.48" },
      }),
    );
  }
  async function publish(id: string): Promise<Res> {
    const p = CmsPageResponseSchema.parse((await comPublisher.get(`/pages/${id}`)).body).page;
    return comPublisher.post(`/pages/${id}/publish`, { version: p.version });
  }
  async function published(id: string): Promise<void> {
    const res = await publish(id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  const articleDraft = (version: number, slug: string, over: Record<string, unknown> = {}) => ({
    version,
    title: `Corporate ${slug}`,
    slug,
    seo: { title: null, description: null, noindex: false },
    content: {
      excerpt: `Summary of ${slug}.`,
      coverImage: null,
      coverAlt: null,
      sections: [{ id: "sec-text-0001", type: "text", title: null, body: "One.\n\nTwo." }],
      ...over,
    },
  });
  async function article(slug: string): Promise<string> {
    const res = await comEditor.post(`/sites/${COM}/pages`, {
      title: `Corporate ${slug}`,
      slug,
      template: "article",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const a = CmsPageResponseSchema.parse(res.body).page;
    const saved = await comEditor.post(`/pages/${a.id}/draft`, articleDraft(a.version, slug));
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    return a.id;
  }

  beforeAll(async () => {
    comPublisher = await staff(
      "com3-publisher",
      [{ role: "content_publisher", site: COM }],
      root.userId,
    );
  });

  afterAll(async () => {
    await owner.siteLocale.update({
      where: { siteId_locale: { siteId: COM, locale: "tr" } },
      data: { public: false },
    });
  });

  it("imports the corporate list heading into the Corporate site only", async () => {
    expectError(
      await bvEditor.post(`/sites/${BV}/import`, { key: "corporate.news-index", dryRun: true }),
      400,
      "VALIDATION_FAILED",
      { path: "key", rule: "unknown_template" },
    );
    expectError(
      await comEditor.post(`/sites/${COM}/import`, { key: "bv.news-index", dryRun: true }),
      400,
      "VALIDATION_FAILED",
      { path: "key", rule: "unknown_template" },
    );
    const res = await comEditor.post(`/sites/${COM}/import`, {
      key: "corporate.news-index",
      dryRun: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    headingId = CmsImportResponseSchema.parse(res.body).pageId!;
    const imported = CmsPageResponseSchema.parse(
      (await comEditor.get(`/pages/${headingId}`)).body,
    ).page;
    expect(imported).toMatchObject({
      kind: "DESIGN",
      templateKey: "corporate.news-index",
      path: "/news",
      locale: "en",
      publication: null,
      content: { eyebrow: "Blogs", title: "News & Insights" },
    });
    // A draft heading never reaches the site: the list has no heading yet.
    const news = CmsPublicNewsSchema.parse((await pub("/news", TEST_KEYS.webCorporate)).body);
    expect(news.page).toBeNull();
    expectError(await seo("/resolve?path=/news"), 404, "NOT_FOUND");
  });

  it("creates, publishes and lists corporate articles for the corporate key only", async () => {
    // A BV file is no cover of a corporate article (each site serves its own media).
    const a = await comEditor.post(`/sites/${COM}/pages`, {
      title: "Cover check",
      slug: "com3-cover-check",
      template: "article",
    });
    const draft = CmsPageResponseSchema.parse(a.body).page;
    expectError(
      await comEditor.post(
        `/pages/${draft.id}/draft`,
        articleDraft(draft.version, "com3-cover-check", {
          coverImage: "/media/news/why-are-oil-prices-falling.jpg",
          coverAlt: "BV image",
        }),
      ),
      400,
      "VALIDATION_FAILED",
    );

    const older = await article("com3-older");
    await published(older);
    await new Promise((r) => setTimeout(r, 20));
    const newer = await article("com3-newer");
    await published(newer);
    await published(headingId);

    const news = CmsPublicNewsSchema.parse((await pub("/news", TEST_KEYS.webCorporate)).body);
    expect(news.page).toMatchObject({ kind: "DESIGN", templateKey: "corporate.news-index" });
    expect(news.articles.map((x) => x.slug)).toEqual(["com3-newer", "com3-older"]);
    expect(news.articles[0]).toMatchObject({
      path: "/news/com3-newer",
      excerpt: "Summary of com3-newer.",
      coverImage: null,
    });
    expect(Object.keys(news.fragments).every((k) => k.startsWith("corporate."))).toBe(true);

    // Isolation: the BV list never lists a corporate article nor its heading, and back.
    const bv = CmsPublicNewsSchema.parse((await pub("/news")).body);
    expect(bv.articles.some((x) => x.slug.startsWith("com3-"))).toBe(false);
    expect(bv.page?.templateKey ?? null).not.toBe("corporate.news-index");
    expect(news.articles.some((x) => ["older-article", "newer-article"].includes(x.slug))).toBe(
      false,
    );
    expectError(await pub("/page?path=/news/com3-newer"), 404, "NOT_FOUND");
    expectError(
      await pub("/page?path=/news/older-article", TEST_KEYS.webCorporate),
      404,
      "NOT_FOUND",
    );
    const live = CmsPublicBundleSchema.parse(
      (await pub("/page?path=/news/com3-newer", TEST_KEYS.webCorporate)).body,
    );
    expect(live.page).toMatchObject({ templateKey: "article", path: "/news/com3-newer" });

    // SEO: the list and the articles resolve and are in the corporate sitemap only.
    expect((await seo("/resolve?path=/news")).body).toEqual({ path: "/news", kind: "news" });
    expect((await seo("/resolve?path=/news/com3-newer")).body).toEqual({
      path: "/news/com3-newer",
      kind: "article",
    });
    expectError(await seo("/resolve?path=/news/com3-newer", TEST_KEYS.webBv), 404, "NOT_FOUND");
    const entries = PublicSitemapResponseSchema.parse((await seo("/sitemap")).body).entries;
    expect(entries.find((e) => e.path === "/news")).toMatchObject({ kind: "news", locale: "en" });
    expect(entries.filter((e) => e.kind === "article").map((e) => e.path)).toEqual(
      expect.arrayContaining(["/news/com3-newer", "/news/com3-older"]),
    );
    const bvEntries = PublicSitemapResponseSchema.parse(
      (await seo("/sitemap", TEST_KEYS.webBv)).body,
    ).entries;
    expect(bvEntries.some((e) => e.path.startsWith("/news/com3-"))).toBe(false);
  });

  it("previews a corporate article and the heading draft on the corporate site only", async () => {
    const id = await article("com3-preview");
    const res = await comEditor.post(`/pages/${id}/preview`, {});
    const token = CmsPreviewResponseSchema.parse(res.body).url.split("/preview/")[1]!;
    expect(token).toContain(".CORPORATE.");
    const view = CmsPublicBundleSchema.parse(
      (await pub(`/preview/${token}`, TEST_KEYS.webCorporate)).body,
    );
    expect(view.page).toMatchObject({
      templateKey: "article",
      path: "/news/com3-preview",
      revisionNumber: null,
    });
    expect(view.locale).toBe("en");
    expectError(await pub(`/preview/${token}`), 404, "NOT_FOUND");
    // The draft itself stays off the site.
    expectError(
      await pub("/page?path=/news/com3-preview", TEST_KEYS.webCorporate),
      404,
      "NOT_FOUND",
    );
    const h = await comEditor.post(`/pages/${headingId}/preview`, {});
    const ht = CmsPreviewResponseSchema.parse(h.body).url.split("/preview/")[1]!;
    expect(
      CmsPublicBundleSchema.parse((await pub(`/preview/${ht}`, TEST_KEYS.webCorporate)).body).page,
    ).toMatchObject({ templateKey: "corporate.news-index", path: "/news" });
  });

  it("takes an article off the site and restores an earlier revision into the draft", async () => {
    const id = await article("com3-withdrawn");
    await published(id);
    const live = CmsPageResponseSchema.parse((await comPublisher.get(`/pages/${id}`)).body).page;
    expect(
      (
        await comPublisher.post(`/pages/${id}/unpublish`, {
          publicationVersion: live.publication!.version,
        })
      ).status,
    ).toBe(200);
    expectError(
      await pub("/page?path=/news/com3-withdrawn", TEST_KEYS.webCorporate),
      404,
      "NOT_FOUND",
      { path: "path", rule: "unpublished" },
    );
    expect((await seo("/resolve?path=/news/com3-withdrawn")).status).toBe(404);
    const list = CmsPublicNewsSchema.parse((await pub("/news", TEST_KEYS.webCorporate)).body);
    expect(list.articles.some((x) => x.slug === "com3-withdrawn")).toBe(false);
    const restored = await comEditor.post(`/pages/${id}/restore`, {
      version: live.version,
      revisionNumber: 1,
    });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
  });

  it("keeps Turkish articles apart from English ones, with counterparts (TR/EN)", async () => {
    const en = await article("com3-bilingual");
    await published(en);
    const tr = await comEditor.post(`/pages/${en}/translations`, {
      locale: "tr",
      title: "Türkçe haber",
      slug: "com3-turkce-haber",
    });
    expect(tr.status, JSON.stringify(tr.body)).toBe(201);
    const trPage = CmsPageResponseSchema.parse(tr.body).page;
    expect(trPage).toMatchObject({
      templateKey: "article",
      locale: "tr",
      path: "/news/com3-turkce-haber",
      translationGroupId: en,
    });
    const saved = await comEditor.post(`/pages/${trPage.id}/draft`, {
      ...articleDraft(trPage.version, "com3-turkce-haber"),
      title: "Türkçe haber",
      content: { ...articleDraft(0, "x").content, excerpt: "Türkçe özet." },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    await published(trPage.id);
    const hTr = await comEditor.post(`/pages/${headingId}/translations`, {
      locale: "tr",
      title: "Haberler",
    });
    expect(hTr.status, JSON.stringify(hTr.body)).toBe(201);
    const headingTr = CmsPageResponseSchema.parse(hTr.body).page;
    expect(headingTr).toMatchObject({ templateKey: "corporate.news-index", path: "/news" });
    const trHeading = await comEditor.post(`/pages/${headingTr.id}/draft`, {
      version: headingTr.version,
      title: "Haberler",
      seo: { title: null, description: null, noindex: false },
      content: {
        eyebrow: "Blog",
        title: "Haberler ve Görüşler",
        intro: "Dream Petroleum'dan haberler.",
        empty: { title: "Henüz yazı yok", text: "Yazılar yayımlandığında burada görünür." },
      },
    });
    expect(trHeading.status, JSON.stringify(trHeading.body)).toBe(200);
    await published(headingTr.id);

    // Hidden while Turkish is not public on the corporate site.
    expectError(await pub("/news?locale=tr", TEST_KEYS.webCorporate), 404, "NOT_FOUND");
    await owner.siteLocale.update({
      where: { siteId_locale: { siteId: COM, locale: "tr" } },
      data: { public: true },
    });
    const trNews = CmsPublicNewsSchema.parse(
      (await pub("/news?locale=tr", TEST_KEYS.webCorporate)).body,
    );
    expect(trNews.articles.map((x) => x.slug)).toEqual(["com3-turkce-haber"]);
    expect(trNews.page).toMatchObject({ templateKey: "corporate.news-index" });
    expect(trNews.alternates).toEqual([{ locale: "en", path: "/news", indexable: true }]);
    const enNews = CmsPublicNewsSchema.parse((await pub("/news", TEST_KEYS.webCorporate)).body);
    expect(enNews.articles.some((x) => x.slug === "com3-turkce-haber")).toBe(false);
    expect(enNews.alternates).toEqual([{ locale: "tr", path: "/news", indexable: true }]);
    const trArticle = CmsPublicBundleSchema.parse(
      (await pub("/page?path=/news/com3-turkce-haber&locale=tr", TEST_KEYS.webCorporate)).body,
    );
    expect(trArticle.alternates).toEqual([
      { locale: "en", path: "/news/com3-bilingual", indexable: true },
    ]);
    // The English address is not a Turkish page and the other way round.
    expectError(
      await pub("/page?path=/news/com3-turkce-haber", TEST_KEYS.webCorporate),
      404,
      "NOT_FOUND",
    );
    const entries = PublicSitemapResponseSchema.parse((await seo("/sitemap")).body).entries;
    expect(
      entries.find((e) => e.locale === "tr" && e.path === "/news/com3-turkce-haber"),
    ).toMatchObject({
      kind: "article",
      alternates: [{ locale: "en", path: "/news/com3-bilingual" }],
    });
    expect(entries.find((e) => e.locale === "tr" && e.path === "/news")).toMatchObject({
      kind: "news",
    });
  });
});

// ---------------------------------------------------------------------------------------------
// COM-4: the corporate contact page — imported into the Corporate site only, published at
// /contact for the corporate key, so the COM-2b links to /contact (Contact Us, COA request,
// Enquire for Availability) reach a live page.
// ---------------------------------------------------------------------------------------------

describe("26. corporate contact page (COM-4)", () => {
  let comPublisher: Staff;

  beforeAll(async () => {
    comPublisher = await staff(
      "com4-publisher",
      [{ role: "content_publisher", site: COM }],
      root.userId,
    );
  });

  it("imports corporate.contact into the Corporate site only and serves it there", async () => {
    expectError(
      await bvEditor.post(`/sites/${BV}/import`, { key: "corporate.contact", dryRun: true }),
      400,
      "VALIDATION_FAILED",
      { path: "key", rule: "unknown_template" },
    );
    const res = await comEditor.post(`/sites/${COM}/import`, {
      key: "corporate.contact",
      dryRun: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const id = CmsImportResponseSchema.parse(res.body).pageId!;
    const page = CmsPageResponseSchema.parse((await comEditor.get(`/pages/${id}`)).body).page;
    expect(page).toMatchObject({ kind: "TEMPLATE", path: "/contact", locale: "en" });
    expect((page.content as { sections: { type: string }[] }).sections.map((s) => s.type)).toEqual([
      "hero",
      "contact",
    ]);
    expectError(await pub("/page?path=/contact", TEST_KEYS.webCorporate), 404, "NOT_FOUND");
    const live = CmsPageResponseSchema.parse((await comPublisher.get(`/pages/${id}`)).body).page;
    const published = await comPublisher.post(`/pages/${id}/publish`, { version: live.version });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    const bundle = CmsPublicBundleSchema.parse(
      (await pub("/page?path=/contact", TEST_KEYS.webCorporate)).body,
    );
    expect(bundle.page).toMatchObject({ kind: "TEMPLATE", path: "/contact" });
    expect(Object.keys(bundle.fragments).every((k) => k.startsWith("corporate."))).toBe(true);
    // The BV site's /contact is its own page (or none), never the corporate one.
    const bv = await pub("/page?path=/contact");
    expect(JSON.stringify(bv.body)).not.toContain("corporate.");
  });

  it("links the menu's Contact Us and Blogs once their pages are live (COM-2b/COM-3 links)", async () => {
    const navRow = await owner.cmsPage.findFirstOrThrow({
      where: { siteId: COM, templateKey: "corporate.site-nav", locale: "en" },
    });
    const contactRow = await owner.cmsPage.findFirstOrThrow({
      where: { siteId: COM, path: "/contact", locale: "en" },
    });
    const newsRow = await owner.cmsPage.findFirstOrThrow({
      where: { siteId: COM, templateKey: "corporate.news-index", locale: "en" },
    });
    // A page created for this check, not published yet: its menu link stays text.
    const created = await comEditor.post(`/sites/${COM}/pages`, {
      title: "Our Team",
      slug: "com4-our-team",
    });
    const teamId = CmsPageResponseSchema.parse(created.body).page.id;
    const nav = CmsPageResponseSchema.parse((await comEditor.get(`/pages/${navRow.id}`)).body).page;
    const content = nav.content as {
      items: { label: string; target: unknown; children?: unknown[] }[];
      contact: { label: string; target: unknown };
    };
    const items = content.items.map((item) =>
      item.label === "Blogs"
        ? { ...item, target: { type: "page", pageId: newsRow.id } }
        : item.label === "Company"
          ? {
              ...item,
              children: [{ label: "Our Team", target: { type: "page", pageId: teamId } }],
            }
          : item,
    );
    const saved = await comEditor.post(`/pages/${navRow.id}/draft`, {
      version: nav.version,
      title: nav.title,
      seo: nav.seo,
      content: {
        ...content,
        items,
        contact: { label: "Contact Us", target: { type: "page", pageId: contactRow.id } },
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const fresh = CmsPageResponseSchema.parse(
      (await comPublisher.get(`/pages/${navRow.id}`)).body,
    ).page;
    const out = await comPublisher.post(`/pages/${navRow.id}/publish`, { version: fresh.version });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    const read = async () =>
      BvNavPublicSchema.parse(
        CmsPublicNewsSchema.parse((await pub("/news", TEST_KEYS.webCorporate)).body).fragments[
          "corporate.site-nav"
        ]!.content,
      );
    let live = await read();
    expect(live.contact).toMatchObject({ label: "Contact Us", href: "/contact" });
    expect(live.items.find((i) => i.label === "Blogs")).toMatchObject({ href: "/news" });
    const team = () =>
      live.items.find((i) => i.label === "Company")!.children.find((c) => c.label === "Our Team");
    expect(team()?.href).toBeNull();
    // Published: the same menu links it, without editing the menu again.
    const teamPage = CmsPageResponseSchema.parse(
      (await comPublisher.get(`/pages/${teamId}`)).body,
    ).page;
    expect(
      (await comPublisher.post(`/pages/${teamId}/publish`, { version: teamPage.version })).status,
    ).toBe(200);
    live = await read();
    expect(team()?.href).toBe("/com4-our-team");
  });
});

// ---------------------------------------------------------------------------------------------
// COM-5: the corporate content of the live site — imported as drafts, published only on purpose,
// articles dated and ordered by their original date (DP-327), Turkish drafts from the live
// Turkish pages through "Create translation" (the proposal), SEO of what is published.
// ---------------------------------------------------------------------------------------------

describe("27. corporate content of the live site (COM-5)", () => {
  let comPublisher: Staff;
  const ids: Record<string, string> = {};
  const PAGES = [
    "corporate.about-us",
    "corporate.logistics",
    "corporate.energy-trading",
    "corporate.storage-distribution",
    "corporate.sustainability",
    "corporate.strategic-partnership",
    "corporate.our-team",
  ];
  const articleKeys = () =>
    CORPORATE_CONTENT_REGISTRY.filter((e) => e.path!.startsWith("/news/")).map((e) => e.key);

  async function publish(id: string): Promise<void> {
    const p = CmsPageResponseSchema.parse((await comPublisher.get(`/pages/${id}`)).body).page;
    const res = await comPublisher.post(`/pages/${id}/publish`, { version: p.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  beforeAll(async () => {
    comPublisher = await staff(
      "com5-publisher",
      [{ role: "content_publisher", site: COM }],
      root.userId,
    );
  });

  afterAll(async () => {
    await owner.siteLocale.update({
      where: { siteId_locale: { siteId: COM, locale: "tr" } },
      data: { public: false },
    });
  });

  it("imports the seven pages and 19 posts into the Corporate site only, as drafts", async () => {
    expectError(
      await bvEditor.post(`/sites/${BV}/import`, { key: "corporate.about-us", dryRun: true }),
      400,
      "VALIDATION_FAILED",
      { path: "key", rule: "unknown_template" },
    );
    // Section 3 created a corporate page at /about-us: the import never overwrites it.
    expectError(
      await comEditor.post(`/sites/${COM}/import`, { key: "corporate.about-us", dryRun: true }),
      409,
      "CONFLICT_STATE",
      { path: "key", rule: "already_imported" },
    );
    for (const key of [...PAGES.filter((k) => k !== "corporate.about-us"), ...articleKeys()]) {
      const dry = await comEditor.post(`/sites/${COM}/import`, { key, dryRun: true });
      expect(dry.status, `${key} ${JSON.stringify(dry.body)}`).toBe(200);
      const res = await comEditor.post(`/sites/${COM}/import`, { key, dryRun: false });
      expect(res.status, `${key} ${JSON.stringify(res.body)}`).toBe(200);
      ids[key] = CmsImportResponseSchema.parse(res.body).pageId!;
    }
    expect(Object.keys(ids)).toHaveLength(25);
    // Drafts: nothing reaches the site until it is published.
    const live = await owner.cmsPagePublication.count({
      where: { pageId: { in: Object.values(ids) } },
    });
    expect(live).toBe(0);
    expectError(await pub("/page?path=/logistics", TEST_KEYS.webCorporate), 404, "NOT_FOUND");
    expectError(await seo("/resolve?path=/our-team"), 404, "NOT_FOUND");
    const page = CmsPageResponseSchema.parse(
      (await comEditor.get(`/pages/${ids["corporate.logistics"]}`)).body,
    ).page;
    expect(page).toMatchObject({
      kind: "TEMPLATE",
      path: "/logistics",
      locale: "en",
      publication: null,
    });
    // Never twice.
    expectError(
      await comEditor.post(`/sites/${COM}/import`, { key: "corporate.logistics", dryRun: true }),
      409,
      "CONFLICT_STATE",
      { path: "key", rule: "already_imported" },
    );
  });

  async function seo(p: string, key: string = TEST_KEYS.webCorporate): Promise<Res> {
    return parse(
      await fetch(`${base}/api/v1/public/seo${p}`, {
        headers: { "x-dp-proxy-key": key, "x-dp-client-ip": "10.20.30.49" },
      }),
    );
  }

  it("dates and orders the posts by their original date, also in a preview (DP-327)", async () => {
    const keys = articleKeys();
    const first = keys[0]!; // the oldest live post
    const last = keys.at(-1)!; // the newest live post
    const a = CmsPageResponseSchema.parse((await comEditor.get(`/pages/${ids[first]}`)).body).page;
    expect(a.content["originalDate"]).toBe("2026-04-16");
    const prev = await comEditor.post(`/pages/${ids[first]}/preview`, {});
    const token = CmsPreviewResponseSchema.parse(prev.body).url.split("/preview/")[1]!;
    expect(
      CmsPublicBundleSchema.parse((await pub(`/preview/${token}`, TEST_KEYS.webCorporate)).body)
        .page.firstPublishedAt,
    ).toBe("2026-04-16T12:00:00.000Z");
    // Published newest first by publication order, listed oldest-first by original date.
    await publish(ids[last]!);
    await publish(ids[first]!);
    const news = CmsPublicNewsSchema.parse((await pub("/news", TEST_KEYS.webCorporate)).body);
    const ours = news.articles.filter((x) => [a.path, `/news/${slugOf(last)}`].includes(x.path));
    expect(ours.map((x) => x.firstPublishedAt)).toEqual([
      "2026-08-13T12:00:00.000Z",
      "2026-04-16T12:00:00.000Z",
    ]);
    // An article without an original date keeps the date of its first publication.
    const noDate = news.articles.find((x) => x.slug === "com3-newer");
    expect(noDate?.firstPublishedAt.endsWith("T12:00:00.000Z")).toBe(false);
    // An impossible date is refused when saved.
    expectError(
      await comEditor.post(`/pages/${ids[first]}/draft`, {
        version: a.version,
        title: a.title,
        slug: a.slug,
        seo: a.seo,
        content: { ...a.content, originalDate: "2026-02-30" },
      }),
      400,
      "VALIDATION_FAILED",
    );
  });

  function slugOf(key: string): string {
    return CORPORATE_CONTENT_REGISTRY.find((e) => e.key === key)!.path!.slice("/news/".length);
  }

  it("creates Turkish drafts from the live Turkish pages (proposal), kept off the site", async () => {
    const logistics = ids["corporate.logistics"]!;
    // Without the proposal the draft is empty (ML-2); with it, the live Turkish texts.
    const res = await comEditor.post(`/pages/${logistics}/translations`, {
      locale: "tr",
      title: "Lojistik",
      proposal: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const tr = CmsPageResponseSchema.parse(res.body).page;
    expect(tr).toMatchObject({ locale: "tr", path: "/logistics", translationGroupId: logistics });
    expect(JSON.stringify(tr.content)).toContain("Hızlı Lojistik");
    expect(cmsTemplateContentSchema("CORPORATE").safeParse(tr.content).success).toBe(true);
    // An article: its Turkish slug and its own original date.
    const key = articleKeys()[0]!;
    const art = await comEditor.post(`/pages/${ids[key]}/translations`, {
      locale: "tr",
      title: "Doğru Solvent Seçimi",
      proposal: true,
    });
    expect(art.status, JSON.stringify(art.body)).toBe(201);
    const trArt = CmsPageResponseSchema.parse(art.body).page;
    expect(trArt.path).toBe(
      `/news/${CORPORATE_TR_PROPOSAL_INDEX[`article|/news/${slugOf(key)}`]!.slug}`,
    );
    expect(trArt.content["originalDate"]).toBe("2026-04-07");
    // A proposal only where one exists: none for the BV site, none in another language.
    expectError(
      await bvEditor.post(
        `/pages/${(await owner.cmsPage.findFirstOrThrow({ where: { siteId: BV, kind: "TEMPLATE", locale: "en", templateKey: "standard" } })).id}/translations`,
        {
          locale: "nl",
          title: "X",
          slug: "com5-x",
          proposal: true,
        },
      ),
      400,
      "VALIDATION_FAILED",
      { path: "proposal", rule: "unavailable" },
    );
    // Drafts in a non-public language: nothing on the site.
    expectError(
      await pub("/page?path=/about-us&locale=tr", TEST_KEYS.webCorporate),
      404,
      "NOT_FOUND",
    );
  });

  it("serves, resolves and lists a published page and its Turkish counterpart only once published", async () => {
    await publish(ids["corporate.our-team"]!);
    expect((await seo("/resolve?path=/our-team")).body).toEqual({
      path: "/our-team",
      kind: "page",
    });
    const entries = PublicSitemapResponseSchema.parse((await seo("/sitemap")).body).entries;
    expect(entries.some((e) => e.path === "/our-team")).toBe(true);
    expect(entries.some((e) => e.path === "/logistics")).toBe(false);
    const team = CmsPublicBundleSchema.parse(
      (await pub("/page?path=/our-team", TEST_KEYS.webCorporate)).body,
    );
    expect(JSON.stringify(team.page.content)).not.toMatch(/\d+\+|Experts<|world-class/);
    // Turkish article published and Turkish public: its own address, the English counterpart.
    const key = articleKeys()[0]!;
    const trRow = await owner.cmsPage.findFirstOrThrow({
      where: { siteId: COM, locale: "tr", translationGroupId: ids[key]! },
    });
    await publish(trRow.id);
    await owner.siteLocale.update({
      where: { siteId_locale: { siteId: COM, locale: "tr" } },
      data: { public: true },
    });
    const trNews = CmsPublicNewsSchema.parse(
      (await pub("/news?locale=tr", TEST_KEYS.webCorporate)).body,
    );
    expect(trNews.articles.find((x) => x.path === trRow.path)).toMatchObject({
      firstPublishedAt: "2026-04-07T12:00:00.000Z",
    });
    const trBundle = CmsPublicBundleSchema.parse(
      (await pub(`/page?path=${trRow.path}&locale=tr`, TEST_KEYS.webCorporate)).body,
    );
    expect(trBundle.alternates).toEqual([
      { locale: "en", path: `/news/${slugOf(key)}`, indexable: true },
    ]);
  });
});
