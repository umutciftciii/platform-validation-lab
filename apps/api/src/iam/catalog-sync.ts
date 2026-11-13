/**
 * Mirrors the code catalogue (catalog.ts) into the database. Idempotent: run by the bootstrap and
 * after deploys that change the catalogue. It never deletes users, assignments, modules, sites or
 * permissions; it only aligns the permission set of each system role. A core module can never be
 * downgraded (database trigger), so a catalogue change that tries it fails the sync.
 */
import { MODULES, PERMISSIONS, ROLES, SITES } from "./catalog.js";
import type { Db } from "./db.js";

export interface CatalogSyncResult {
  modules: number;
  sites: number;
  permissions: number;
  roles: number;
  rolePermissionsAdded: number;
  rolePermissionsRemoved: number;
}

export async function syncCatalog(db: Db): Promise<CatalogSyncResult> {
  for (const m of MODULES) {
    await db.featureModule.upsert({
      where: { key: m.key },
      create: { key: m.key, name: m.name, description: m.description, isCore: m.isCore },
      update: { name: m.name, description: m.description, isCore: m.isCore },
    });
  }
  for (const s of SITES) {
    await db.site.upsert({
      where: { key: s.key },
      create: { ...s },
      update: { name: s.name, primaryDomain: s.primaryDomain, defaultLocale: s.defaultLocale },
    });
  }
  const permissionIds = new Map<string, string>();
  for (const p of PERMISSIONS) {
    const data = {
      resource: p.resource,
      action: p.action,
      description: p.description,
      audience: p.audience,
      scopeType: p.scopeType,
      moduleKey: p.module,
      sensitive: p.sensitive,
    };
    const row = await db.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, ...data },
      update: data,
      select: { id: true },
    });
    permissionIds.set(p.key, row.id);
  }
  let added = 0;
  let removed = 0;
  for (const r of ROLES) {
    const data = {
      name: r.name,
      description: r.description,
      audience: r.audience,
      scopeType: r.scopeType,
      isSystem: true,
    };
    const role = await db.role.upsert({
      where: { key: r.key },
      create: { key: r.key, ...data },
      update: data,
      select: { id: true },
    });
    const wanted = r.permissions
      .map((k) => permissionIds.get(k))
      .filter((id): id is string => !!id);
    const gone = await db.rolePermission.deleteMany({
      where: { roleId: role.id, permissionId: { notIn: wanted } },
    });
    removed += gone.count;
    const made = await db.rolePermission.createMany({
      data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
    added += made.count;
  }
  return {
    modules: MODULES.length,
    sites: SITES.length,
    permissions: PERMISSIONS.length,
    roles: ROLES.length,
    rolePermissionsAdded: added,
    rolePermissionsRemoved: removed,
  };
}

/**
 * Read-only comparison of the catalogue tables with the code catalogue (ADR-012A). Returns one
 * line per difference; an empty list means the database mirrors the code. Used where writing the
 * catalogue is not allowed, e.g. the bootstrap, whose database role may only read it: the guard
 * triggers decide with these rows, so they must match before an administrator is created.
 */
export async function catalogProblems(db: Db): Promise<string[]> {
  const problems: string[] = [];
  const modules = new Map(
    (await db.featureModule.findMany({ select: { key: true, isCore: true } })).map((m) => [
      m.key,
      m.isCore,
    ]),
  );
  for (const m of MODULES) {
    if (!modules.has(m.key)) problems.push(`module ${m.key} missing`);
    else if (modules.get(m.key) !== m.isCore) problems.push(`module ${m.key} isCore differs`);
  }
  const permissions = await db.permission.findMany({
    select: {
      id: true,
      key: true,
      audience: true,
      scopeType: true,
      moduleKey: true,
      sensitive: true,
    },
  });
  const permissionKeyById = new Map(permissions.map((p) => [p.id, p.key]));
  const permissionByKey = new Map(permissions.map((p) => [p.key, p]));
  for (const p of PERMISSIONS) {
    const row = permissionByKey.get(p.key);
    if (!row) problems.push(`permission ${p.key} missing`);
    else if (
      row.audience !== p.audience ||
      row.scopeType !== p.scopeType ||
      row.moduleKey !== p.module ||
      row.sensitive !== p.sensitive
    ) {
      problems.push(`permission ${p.key} differs`);
    }
  }
  const roles = await db.role.findMany({
    select: {
      key: true,
      audience: true,
      scopeType: true,
      permissions: { select: { permissionId: true } },
    },
  });
  const roleByKey = new Map(roles.map((r) => [r.key, r]));
  for (const r of ROLES) {
    const row = roleByKey.get(r.key);
    if (!row) {
      problems.push(`role ${r.key} missing`);
      continue;
    }
    if (row.audience !== r.audience || row.scopeType !== r.scopeType) {
      problems.push(`role ${r.key} differs`);
    }
    const held = new Set(row.permissions.map((p) => permissionKeyById.get(p.permissionId) ?? "?"));
    const wanted = new Set<string>(r.permissions);
    const same = held.size === wanted.size && [...wanted].every((k) => held.has(k));
    if (!same) problems.push(`role ${r.key} permission set differs`);
  }
  return problems;
}
