import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import {
  RELATIONS,
  SITE_BOUND_MODELS,
  SiteScopeViolationError,
  scopeOperationArgs,
} from "../../../src/iam/site-scope.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BV = { siteId: { in: ["bv"] } };
/** DP-108: audit events through the scoped client are also limited to the STANDARD stream. */
const AUDIT = { AND: [BV, { stream: "STANDARD" }] };
const scope = { siteIds: ["bv"], includePlatform: false };
const rewrite = (model: string, op: string, args: unknown) =>
  scopeOperationArgs(model, op, args, scope);

/** Models, their relation fields and whether they have a siteId, parsed from schema.prisma. */
function parseSchema() {
  const text = readFileSync(path.join(API_DIR, "prisma/schema.prisma"), "utf8");
  const blocks = [...text.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  const models = new Set(blocks.map((b) => b[1] as string));
  const result: Record<
    string,
    { relations: Record<string, { model: string; list: boolean }>; siteId: boolean }
  > = {};
  for (const [, name, body] of blocks) {
    const relations: Record<string, { model: string; list: boolean }> = {};
    let siteId = false;
    for (const line of (body as string).split("\n")) {
      const m = /^\s+(\w+)\s+(\w+)(\[\])?\??/.exec(line);
      if (!m) continue;
      const [, field, type, list] = m as unknown as [string, string, string, string | undefined];
      if (field === "siteId") siteId = true;
      if (models.has(type)) relations[field] = { model: type, list: Boolean(list) };
    }
    result[name as string] = { relations, siteId };
  }
  return result;
}

describe("relation map matches prisma/schema.prisma", () => {
  const schema = parseSchema();

  it("lists every model with a siteId as site-bound, and only those", () => {
    const withSite = Object.entries(schema)
      .filter(([, m]) => m.siteId)
      .map(([n]) => n)
      .sort();
    expect(Object.keys(SITE_BOUND_MODELS).sort()).toEqual(withSite);
  });

  it("lists every relation field of every model", () => {
    for (const [model, def] of Object.entries(schema)) {
      expect(RELATIONS[model] ?? {}, model).toEqual(def.relations);
    }
    expect(Object.keys(RELATIONS).sort()).toEqual(Object.keys(schema).sort());
  });
});

describe("scopeOperationArgs: every entry point stays inside the scope", () => {
  it("filters the site-bound model itself", () => {
    expect(rewrite("Membership", "findMany", { where: { userId: "u" } })).toEqual({
      where: { userId: "u", AND: [BV] },
    });
  });

  it("filters site-bound relations in include and select, at any depth", () => {
    const out = rewrite("User", "findMany", {
      include: { memberships: true, roleAssignments: { where: { revokedAt: null } } },
    });
    expect(out["include"]).toEqual({
      memberships: { where: { AND: [BV] } },
      roleAssignments: { where: { revokedAt: null, AND: [BV] } },
    });
    const deep = rewrite("Membership", "findMany", {
      select: { user: { select: { auditEvents: true } } },
    });
    expect(deep["select"]).toEqual({
      user: { select: { auditEvents: { where: { AND: [AUDIT] } } } },
    });
    const site = rewrite("Site", "findUnique", {
      where: { key: "CORPORATE" },
      include: { memberships: true },
    });
    expect(site["include"]).toEqual({ memberships: { where: { AND: [BV] } } });
  });

  it("counts site-bound relations only inside the scope", () => {
    const out = rewrite("User", "findMany", {
      select: { _count: { select: { memberships: true } } },
    });
    expect(out["select"]).toEqual({
      _count: { select: { memberships: { where: { AND: [BV] } } } },
    });
    expect(() => rewrite("User", "findMany", { include: { _count: true } })).toThrow(
      SiteScopeViolationError,
    );
  });

  it("evaluates relation filters inside the scope (no existence oracle)", () => {
    const out = rewrite("User", "findMany", {
      where: {
        memberships: { some: { siteId: "com" } },
        auditEvents: { every: { outcome: "SUCCESS" } },
      },
    });
    expect(out["where"]).toEqual({
      memberships: { some: { siteId: "com", AND: [BV] } },
      auditEvents: { every: { OR: [{ NOT: AUDIT }, { outcome: "SUCCESS" }] } },
    });
    const nested = rewrite("User", "count", {
      where: { OR: [{ roleAssignments: { none: {} } }] },
    });
    expect(nested["where"]).toEqual({ OR: [{ roleAssignments: { none: { AND: [BV] } } }] });
    const viaOne = rewrite("Membership", "findMany", {
      where: { user: { is: { auditEvents: { some: {} } } } },
    });
    expect(viaOne["where"]).toEqual({
      user: { is: { auditEvents: { some: { AND: [AUDIT] } } } },
      AND: [BV],
    });
  });

  it("refuses ordering by a site-bound relation count", () => {
    expect(() =>
      rewrite("User", "findMany", { orderBy: { memberships: { _count: "desc" } } }),
    ).toThrow(SiteScopeViolationError);
  });

  it("refuses nested writes into site-bound models", () => {
    expect(() =>
      rewrite("User", "create", {
        data: { email: "x", memberships: { create: { siteId: "com" } } },
      }),
    ).toThrow(/nested write/);
    expect(() =>
      rewrite("Site", "update", {
        where: { key: "BV" },
        data: { auditEvents: { deleteMany: {} } },
      }),
    ).toThrow(/nested write/);
    expect(() =>
      rewrite("Membership", "create", {
        data: { siteId: "bv", user: { create: { email: "x", roleAssignments: { create: {} } } } },
      }),
    ).toThrow(/nested write/);
  });

  it("refuses writes into other sites and site changes through the relation", () => {
    expect(() => rewrite("Membership", "create", { data: { siteId: "com", userId: "u" } })).toThrow(
      /outside the scope/,
    );
    expect(() =>
      rewrite("Membership", "create", { data: { userId: "u", site: { connect: { id: "bv" } } } }),
    ).toThrow(/scalar/);
    expect(() =>
      rewrite("Membership", "update", { where: { id: "m" }, data: { siteId: "com" } }),
    ).toThrow(/outside the scope/);
  });

  it("does not treat audit metadata keys as relations", () => {
    expect(() =>
      rewrite("AuditEvent", "create", {
        data: { siteId: "bv", metadata: { site: { memberships: { create: {} } } } },
      }),
    ).not.toThrow();
  });

  it("refuses operations it does not understand on site-bound models", () => {
    expect(() => rewrite("Membership", "aggregateRaw", {})).toThrow(/not supported/);
  });
});

describe("lint guardrails (raw SQL and the unscoped client)", () => {
  const eslint = new ESLint({ cwd: API_DIR });
  const lint = async (code: string, file: string) =>
    (await eslint.lintText(code, { filePath: path.join(API_DIR, file) }))[0]?.messages.map(
      (m) => m.ruleId,
    ) ?? [];

  it("refuses raw SQL and the unscoped Prisma client in business modules", async () => {
    expect(
      await lint(
        "export const f = (db: any) => db.$queryRawUnsafe('select 1');\n",
        "src/leads/x.ts",
      ),
    ).toContain("no-restricted-syntax");
    expect(
      await lint("export const f = (db: any) => db.$executeRaw`delete`;\n", "src/cms/x.ts"),
    ).toContain("no-restricted-syntax");
    expect(
      await lint(
        'import { PrismaService } from "../prisma/prisma.service.js";\nexport { PrismaService };\n',
        "src/leads/x.ts",
      ),
    ).toContain("no-restricted-imports");
  });

  it("allows them in the reviewed infrastructure files", async () => {
    expect(
      await lint("export const f = (db: any) => db.$queryRaw`select 1`;\n", "src/iam/bootstrap.ts"),
    ).not.toContain("no-restricted-syntax");
    expect(
      await lint(
        'import { PrismaService } from "../prisma/prisma.service.js";\nexport { PrismaService };\n',
        "src/iam/x.ts",
      ),
    ).not.toContain("no-restricted-imports");
  });
});
