// DP-125 performance comparison: the IAM paths of the API before and after row-level security,
// on the same seeded *_test database. Run by tools/perf/dp125-rls-bench.sh (disposable Postgres,
// toolbox); never against an application database (assertTestDatabaseUrl).
//
// "before": RLS switched off on the five IAM tables (test database only) and the pre-DP-125 code
//           path: plain queries, no transaction, no context.
// "after":  RLS on (migration 20261125090000) and the DP-125 code path: one interactive
//           transaction, leads_rls_set_staff_context(token), the same queries.
// Each scenario: warm-up, then N timed iterations; p50/p95/p99/mean in milliseconds, end to end
// from the API process (Prisma client and pg driver included), as the API sees it.
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertTestDatabaseUrl } from "@dream/test-utils";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = (p) => pathToFileURL(path.join(API_DIR, "dist", p)).href;
const { PrismaClient } = await import(dist("generated/prisma/client.js"));
const { syncCatalog } = await import(dist("iam/catalog-sync.js"));
const { loadAuthorizationSnapshot } = await import(dist("iam/repository.js"));
const { inStaffContext } = await import(dist("iam/iam-context.js"));
const { writeAudit } = await import(dist("iam/staff/audit-writer.js"));

const urls = {
  app: assertTestDatabaseUrl(process.env.PERF_APP_URL).toString(),
  owner: assertTestDatabaseUrl(process.env.PERF_MIGRATE_URL).toString(),
  su: assertTestDatabaseUrl(process.env.PERF_SUPERUSER_URL).toString(),
};
const WARMUP = Number(process.env.PERF_WARMUP ?? 100);
const N = Number(process.env.PERF_ITERATIONS ?? 1000);
const STAFF = Number(process.env.PERF_STAFF ?? 400);
const EVENTS = Number(process.env.PERF_EVENTS ?? 50000);
const OUT = process.env.PERF_OUT ?? "";
const ARGON = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";

const client = (url) => new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const owner = client(urls.owner);
const su = client(urls.su);
const app = client(urls.app);

// --- seed (superuser, triggers off: a perf fixture, not a behaviour test) -------------------
await syncCatalog(owner);
const sites = await owner.site.findMany({ orderBy: { key: "asc" } });
const [BV, COM] = [
  sites.find((s) => s.key === "BV").id,
  sites.find((s) => s.key === "CORPORATE").id,
];
const roles = new Map((await owner.role.findMany()).map((r) => [r.key, r.id]));
const now = new Date();
const users = [];
await su.$transaction(
  async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    // The grantor of every fixture assignment (a grant needs a grantor other than the holder).
    const rootId = (
      await tx.user.create({
        data: {
          email: "perf-root@staff.dp.test",
          emailNormalized: "perf-root@staff.dp.test",
          kind: "STAFF",
          status: "ACTIVE",
          emailVerifiedAt: now,
          passwordHash: ARGON,
          mfaEnrolledAt: now,
        },
      })
    ).id;
    for (let i = 0; i < STAFF; i++) {
      const id = (
        await tx.user.create({
          data: {
            email: `perf-${i}@staff.dp.test`,
            emailNormalized: `perf-${i}@staff.dp.test`,
            kind: "STAFF",
            status: "ACTIVE",
            displayName: `Perf ${i}`,
            emailVerifiedAt: now,
            passwordHash: ARGON,
            passwordUpdatedAt: now,
            mfaEnrolledAt: now,
          },
        })
      ).id;
      users.push(id);
      const site = i % 3 === 0 ? [BV, COM] : i % 3 === 1 ? [BV] : [COM];
      for (const siteId of site) {
        await tx.membership.create({ data: { userId: id, siteId, status: "ACTIVE" } });
        const key = i < 2 ? "site_admin" : ["content_editor", "product_editor", "read_only"][i % 3];
        await tx.roleAssignment.create({
          data: {
            userId: id,
            roleId: roles.get(key),
            scopeType: "SITE",
            siteId,
            grantedById: rootId,
          },
        });
      }
      if (i >= 2 && i < 22) {
        await tx.roleAssignment.create({
          data: {
            userId: id,
            roleId: roles.get("platform_super_admin"),
            scopeType: "PLATFORM",
            grantedById: rootId,
          },
        });
      }
    }
    await tx.$executeRawUnsafe(`
      INSERT INTO "AuditEvent" ("id", "actorType", "actorUserId", "action", "resourceType",
        "scopeType", "siteId", "outcome", "metadata", "stream")
      SELECT gen_random_uuid(), 'USER', u.ids[1 + (g % ${STAFF})], 'perf.event', 'probe',
        CASE WHEN g % 4 = 0 THEN 'PLATFORM'::"ScopeType" ELSE 'SITE'::"ScopeType" END,
        CASE WHEN g % 4 = 0 THEN NULL WHEN g % 2 = 0 THEN '${BV}'::uuid ELSE '${COM}'::uuid END,
        'SUCCESS', '{}'::jsonb, 'STANDARD'
      FROM generate_series(1, ${EVENTS}) g, (SELECT array_agg("id") AS ids FROM "User") u`);
  },
  { timeout: 600_000 },
);
await su.$executeRawUnsafe(`ANALYZE`);

async function sessionFor(userId) {
  const token = randomBytes(32).toString("base64url");
  await owner.session.create({
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      userId,
      kind: "STAFF",
      app: "ADMIN",
      securityVersion: 0,
      lastSeenAt: now,
      idleExpiresAt: new Date(Date.now() + 8 * 3_600_000),
      absoluteExpiresAt: new Date(Date.now() + 8 * 3_600_000),
      mfaVerifiedAt: now,
    },
  });
  return token;
}
const siteAdmin = { id: users[0], token: await sessionFor(users[0]) }; // site_admin on BV and COM
const platformAdmin = { id: users[2], token: await sessionFor(users[2]) };
const editor = { id: users[4], token: await sessionFor(users[4]) }; // product_editor on BV

const staffList = (db, siteIds) =>
  db.user.findMany({
    where: {
      kind: "STAFF",
      ...(siteIds
        ? { memberships: { some: { siteId: { in: siteIds }, status: { not: "REVOKED" } } } }
        : {}),
    },
    orderBy: [{ status: "asc" }, { email: "asc" }],
    take: 1000,
    select: {
      id: true,
      email: true,
      memberships: { select: { siteId: true, status: true } },
      roleAssignments: {
        where: { revokedAt: null },
        select: {
          id: true,
          scopeType: true,
          siteId: true,
          expiresAt: true,
          role: { select: { key: true, name: true } },
          grantedBy: { select: { id: true, email: true, displayName: true } },
        },
      },
    },
  });
const event = (actor) => ({
  actorType: "USER",
  actorUserId: actor,
  action: "perf.write",
  resourceType: "probe",
  scopeType: "SITE",
  siteId: BV,
  outcome: "SUCCESS",
});

const scenarios = [
  {
    name: "authorization loader, site admin",
    before: () => loadAuthorizationSnapshot(app, siteAdmin.id, { mfaVerified: true }),
    after: () =>
      inStaffContext(app, siteAdmin.token, (tx) =>
        loadAuthorizationSnapshot(tx, siteAdmin.id, { mfaVerified: true }),
      ),
  },
  {
    name: "authorization loader, platform admin",
    before: () => loadAuthorizationSnapshot(app, platformAdmin.id, { mfaVerified: true }),
    after: () =>
      inStaffContext(app, platformAdmin.token, (tx) =>
        loadAuthorizationSnapshot(tx, platformAdmin.id, { mfaVerified: true }),
      ),
  },
  {
    name: "staff list, site admin (BV)",
    before: () => staffList(app, [BV]),
    after: () => inStaffContext(app, siteAdmin.token, (tx) => staffList(tx, [BV])),
  },
  {
    name: "staff list, platform admin (all)",
    before: () => staffList(app, null),
    after: () => inStaffContext(app, platformAdmin.token, (tx) => staffList(tx, null)),
  },
  {
    name: "audit write, outside a context",
    before: () => writeAudit(app, event(editor.id)),
    after: () => writeAudit(app, event(editor.id)),
  },
  {
    name: "audit write, inside the staff context",
    before: () => writeAudit(app, event(editor.id)),
    after: () => inStaffContext(app, editor.token, (tx) => writeAudit(tx, event(editor.id))),
  },
];

function stats(ms) {
  const s = [...ms].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const r = (x) => Math.round(x * 1000) / 1000;
  return { p50: r(q(50)), p95: r(q(95)), p99: r(q(99)), mean: r(mean) };
}
async function measure(fn) {
  for (let i = 0; i < WARMUP; i++) await fn();
  const out = [];
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    out.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return stats(out);
}

const TABLES = `"Membership", "RoleAssignment", "ModuleConfiguration", "AuditEvent", "CustomerDataAccessRequest"`;
const setRls = async (on) => {
  for (const t of TABLES.split(", ")) {
    await su.$executeRawUnsafe(`ALTER TABLE ${t} ${on ? "ENABLE" : "DISABLE"} ROW LEVEL SECURITY`);
  }
};

const results = [];
await setRls(false);
// Sanity: "before" really sees the rows without a context, "after" only with one.
if ((await app.roleAssignment.count()) === 0) throw new Error("before: RLS still on");
for (const sc of scenarios) results.push({ name: sc.name, before: await measure(sc.before) });
await setRls(true);
if ((await app.roleAssignment.count()) !== 0) throw new Error("after: RLS is off");
for (const [i, sc] of scenarios.entries()) results[i].after = await measure(sc.after);

// The plans of the staff list under RLS (InitPlans once per statement).
const plan = await app.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT leads_rls_set_staff_context(${siteAdmin.token})`;
  return tx.$queryRawUnsafe(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT "id","userId","siteId" FROM "RoleAssignment" WHERE "revokedAt" IS NULL`,
  );
});

const lines = [
  `DP-125 RLS benchmark: ${STAFF} staff, ${EVENTS} audit events, warm-up ${WARMUP}, ${N} iterations`,
  "",
  "| scenario | before p50 | before p95 | after p50 | after p95 | Δ p50 | Δ p95 |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...results.map((r) => {
    const d = (a, b) => `${b - a >= 0 ? "+" : ""}${(Math.round((b - a) * 1000) / 1000).toFixed(3)}`;
    return `| ${r.name} | ${r.before.p50} | ${r.before.p95} | ${r.after.p50} | ${r.after.p95} | ${d(r.before.p50, r.after.p50)} | ${d(r.before.p95, r.after.p95)} |`;
  }),
  "",
  "EXPLAIN ANALYZE (site admin context, open role assignments):",
  ...plan.map((p) => `    ${p["QUERY PLAN"]}`),
];
console.log(lines.join("\n"));
console.log(JSON.stringify({ results }));
if (OUT) writeFileSync(OUT, lines.join("\n") + "\n");
await Promise.all([app, owner, su].map((c) => c.$disconnect()));
