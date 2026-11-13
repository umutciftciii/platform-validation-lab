/**
 * Site boundary in data queries (F1-001, F1-001A; DP-069/DP-075, ADR-011 section 4).
 *
 * `withSiteScope(prisma, scope)` returns the client that request code uses. It makes every query
 * entry point respect the site scope, not only queries on the site-bound model itself:
 *
 * | Entry point                                   | Treatment                                         |
 * | --------------------------------------------- | ------------------------------------------------- |
 * | read/update/delete on a site-bound model      | `AND siteId IN (scope)`; foreign ids look missing |
 * | create/upsert on a site-bound model           | scalar `siteId` must be inside the scope          |
 * | `include`/`select` of a site-bound relation   | relation filtered to the scope, at any depth      |
 * | `_count` of a site-bound relation             | counted inside the scope; bare `_count: true` refused |
 * | relation filters (`some`/`every`/`none`)      | evaluated inside the scope (no existence oracle)  |
 * | `orderBy` a site-bound relation's `_count`    | refused (would reveal foreign counts)             |
 * | nested writes into a site-bound relation      | refused; write through the site-bound model       |
 * | fluent API (`user.findUnique().memberships()`) | same rewrite (Prisma runs it as a select)         |
 * | `$queryRaw`, `$executeRaw`, `*Unsafe`, `$runCommandRaw` | refused on the scoped client, also in `$transaction` |
 * | anything not understood                       | refused (deny by default)                         |
 *
 * The relation map below is checked against prisma/schema.prisma by a unit test, so a new
 * site-bound model or relation cannot be added without updating it. Code outside the
 * infrastructure folders cannot import the unscoped PrismaService or call raw queries
 * (ESLint rules in apps/api/eslint.config.mjs). Database row-level security is the second line
 * (ADR-012B): the lead tables have it since DP-103 and are reached only through lead-data.ts.
 */
import type { PrismaClient } from "../generated/prisma/client.js";

export interface SiteScope {
  siteIds: readonly string[];
  /** Platform-level rows (siteId null) are visible too. Only for nullable site-bound models. */
  includePlatform: boolean;
}

/** Models that carry a siteId. `nullable` models also have platform-level rows. */
export const SITE_BOUND_MODELS: Readonly<Record<string, { nullable: boolean }>> = {
  Membership: { nullable: false },
  ModuleConfiguration: { nullable: false },
  RoleAssignment: { nullable: true },
  AuditEvent: { nullable: true },
  // F1-002 (ADR-013): staff sessions and tokens have no site. Only the IAM infrastructure reads
  // these tables, with the unscoped client; the app/site match is checked in code and by triggers.
  Session: { nullable: true },
  UserCredentialToken: { nullable: true },
  // PM-1: a site's categories, listings and listing texts. Product masters have no site.
  ProductCategory: { nullable: false },
  ProductSiteListing: { nullable: false },
  ProductListingText: { nullable: false },
  // PM-3: a site's publications; review events (master events have no site).
  ProductPublication: { nullable: false },
  ProductReviewEvent: { nullable: true },
  // PM-5: a site's switch that shows a technical document (documents themselves have no site).
  ProductDocumentSite: { nullable: false },
  // PM-6: a site's switch that shows a cross-reference (brands, global products, cross-references
  // and their history have no site).
  ProductCrossReferenceSite: { nullable: false },
  // DP-042/DP-043 (ADR-016): leads, their document requests, grants and downloads are customer
  // data of one site (K-02); there are no platform-level rows.
  Lead: { nullable: false },
  LeadDocumentRequest: { nullable: false },
  DocumentDownloadGrant: { nullable: false },
  LeadDocumentDownload: { nullable: false },
  // DP-041 (ADR-019): the sales history of a lead belongs to the lead's site.
  LeadActivity: { nullable: false },
  // DP-076/DP-077 (ADR-017): access requests for a site role carry the site; requests for the
  // platform customer-data officer have none. Read by the IAM infrastructure only.
  CustomerDataAccessRequest: { nullable: true },
  // CMS S1 (DP-015, ADR-020): a site's pages and fragments; there are no platform-level pages.
  CmsPage: { nullable: false },
  // CMS S2 (DP-017): revisions and publications of a site's pages.
  CmsPageRevision: { nullable: false },
  CmsPagePublication: { nullable: false },
};

export interface RelationDef {
  model: string;
  list: boolean;
}

/** Every relation field of every model (unit-tested against schema.prisma). */
export const RELATIONS: Readonly<Record<string, Readonly<Record<string, RelationDef>>>> = {
  User: {
    memberships: { model: "Membership", list: true },
    roleAssignments: { model: "RoleAssignment", list: true },
    grantedAssignments: { model: "RoleAssignment", list: true },
    revokedAssignments: { model: "RoleAssignment", list: true },
    customerDataAccessRequests: { model: "CustomerDataAccessRequest", list: true },
    customerDataAccessRequested: { model: "CustomerDataAccessRequest", list: true },
    customerDataAccessDecided: { model: "CustomerDataAccessRequest", list: true },
    moduleChanges: { model: "ModuleConfiguration", list: true },
    auditEvents: { model: "AuditEvent", list: true },
    sessions: { model: "Session", list: true },
    credentialTokens: { model: "UserCredentialToken", list: true },
    issuedCredentialTokens: { model: "UserCredentialToken", list: true },
    mfaFactors: { model: "MfaFactor", list: true },
    recoveryCodes: { model: "MfaRecoveryCode", list: true },
    productsSubmitted: { model: "Product", list: true },
    productsApproved: { model: "Product", list: true },
    productReviewEvents: { model: "ProductReviewEvent", list: true },
    publicationsPublished: { model: "ProductPublication", list: true },
    publicationsUnpublished: { model: "ProductPublication", list: true },
    documentRevisions: { model: "ProductDocumentRevision", list: true },
    crossReferencesRequested: { model: "ProductCrossReference", list: true },
    crossReferencesVerified: { model: "ProductCrossReference", list: true },
    crossReferenceEvents: { model: "ProductCrossReferenceEvent", list: true },
    // DP-108: the owner record and designations (no site; only the IAM infrastructure reads them).
    systemOwner: { model: "SystemOwner", list: false },
    ownerDesignations: { model: "SystemOwnerDesignation", list: true },
    // DP-041: leads assigned to the user and sales activity (site-bound, filtered like any lead).
    assignedLeads: { model: "Lead", list: true },
    leadActivities: { model: "LeadActivity", list: true },
    leadAssignmentsFrom: { model: "LeadActivity", list: true },
    leadAssignmentsTo: { model: "LeadActivity", list: true },
    cmsPagesCreated: { model: "CmsPage", list: true },
    cmsPagesUpdated: { model: "CmsPage", list: true },
    cmsRevisionsCreated: { model: "CmsPageRevision", list: true },
    cmsPublicationsPublished: { model: "CmsPagePublication", list: true },
    cmsPublicationsUnpublished: { model: "CmsPagePublication", list: true },
  },
  SystemOwner: {
    user: { model: "User", list: false },
    designation: { model: "SystemOwnerDesignation", list: false },
  },
  SystemOwnerDesignation: {
    user: { model: "User", list: false },
    owner: { model: "SystemOwner", list: false },
  },
  Site: {
    memberships: { model: "Membership", list: true },
    roleAssignments: { model: "RoleAssignment", list: true },
    moduleConfigurations: { model: "ModuleConfiguration", list: true },
    auditEvents: { model: "AuditEvent", list: true },
    sessions: { model: "Session", list: true },
    credentialTokens: { model: "UserCredentialToken", list: true },
    productCategories: { model: "ProductCategory", list: true },
    productListings: { model: "ProductSiteListing", list: true },
    productListingTexts: { model: "ProductListingText", list: true },
    productPublications: { model: "ProductPublication", list: true },
    productReviewEvents: { model: "ProductReviewEvent", list: true },
    productDocumentSites: { model: "ProductDocumentSite", list: true },
    crossReferenceSites: { model: "ProductCrossReferenceSite", list: true },
    leads: { model: "Lead", list: true },
    leadDocumentRequests: { model: "LeadDocumentRequest", list: true },
    documentGrants: { model: "DocumentDownloadGrant", list: true },
    leadDocumentDownloads: { model: "LeadDocumentDownload", list: true },
    leadActivities: { model: "LeadActivity", list: true },
    customerDataAccessRequests: { model: "CustomerDataAccessRequest", list: true },
    cmsPages: { model: "CmsPage", list: true },
    cmsPageRevisions: { model: "CmsPageRevision", list: true },
    cmsPagePublications: { model: "CmsPagePublication", list: true },
  },
  Membership: {
    user: { model: "User", list: false },
    site: { model: "Site", list: false },
  },
  FeatureModule: {
    permissions: { model: "Permission", list: true },
    configurations: { model: "ModuleConfiguration", list: true },
  },
  ModuleConfiguration: {
    module: { model: "FeatureModule", list: false },
    site: { model: "Site", list: false },
    updatedBy: { model: "User", list: false },
  },
  Permission: {
    module: { model: "FeatureModule", list: false },
    roles: { model: "RolePermission", list: true },
  },
  Role: {
    permissions: { model: "RolePermission", list: true },
    assignments: { model: "RoleAssignment", list: true },
    customerDataAccessRequests: { model: "CustomerDataAccessRequest", list: true },
  },
  RolePermission: {
    role: { model: "Role", list: false },
    permission: { model: "Permission", list: false },
  },
  RoleAssignment: {
    user: { model: "User", list: false },
    role: { model: "Role", list: false },
    site: { model: "Site", list: false },
    grantedBy: { model: "User", list: false },
    revokedBy: { model: "User", list: false },
    extensionRequests: { model: "CustomerDataAccessRequest", list: true },
  },
  AuditEvent: {
    actor: { model: "User", list: false },
    site: { model: "Site", list: false },
  },
  UserCredentialToken: {
    user: { model: "User", list: false },
    site: { model: "Site", list: false },
    createdBy: { model: "User", list: false },
  },
  MfaFactor: {
    user: { model: "User", list: false },
  },
  MfaRecoveryCode: {
    user: { model: "User", list: false },
  },
  Session: {
    user: { model: "User", list: false },
    site: { model: "Site", list: false },
    rotatedFrom: { model: "Session", list: false },
    rotatedTo: { model: "Session", list: true },
  },
  AuthThrottle: {},
  // DP-042: public rate-limit counters (keys are HMACs; no site, no relation).
  PublicRateLimit: {},
  Product: {
    listings: { model: "ProductSiteListing", list: true },
    specValues: { model: "ProductSpecValue", list: true },
    images: { model: "ProductImage", list: true },
    submittedBy: { model: "User", list: false },
    approvedBy: { model: "User", list: false },
    reviewEvents: { model: "ProductReviewEvent", list: true },
    publications: { model: "ProductPublication", list: true },
    documents: { model: "ProductDocument", list: true },
    crossReferences: { model: "ProductCrossReference", list: true },
    leadDocumentRequests: { model: "LeadDocumentRequest", list: true },
  },
  // PM-2: platform-wide master data (no site).
  SpecDefinition: {
    values: { model: "ProductSpecValue", list: true },
  },
  ProductSpecValue: {
    product: { model: "Product", list: false },
    definition: { model: "SpecDefinition", list: false },
  },
  ProductImage: {
    product: { model: "Product", list: false },
  },
  ProductCategory: {
    site: { model: "Site", list: false },
    parent: { model: "ProductCategory", list: false },
    children: { model: "ProductCategory", list: true },
    listings: { model: "ProductSiteListing", list: true },
  },
  ProductSiteListing: {
    product: { model: "Product", list: false },
    site: { model: "Site", list: false },
    category: { model: "ProductCategory", list: false },
    texts: { model: "ProductListingText", list: true },
    publications: { model: "ProductPublication", list: true },
  },
  ProductListingText: {
    listing: { model: "ProductSiteListing", list: false },
    site: { model: "Site", list: false },
  },
  // PM-3: review history and per-site publications.
  ProductReviewEvent: {
    product: { model: "Product", list: false },
    site: { model: "Site", list: false },
    actor: { model: "User", list: false },
  },
  ProductPublication: {
    product: { model: "Product", list: false },
    site: { model: "Site", list: false },
    listing: { model: "ProductSiteListing", list: false },
    publishedBy: { model: "User", list: false },
    unpublishedBy: { model: "User", list: false },
  },
  // PM-5: technical documents of a master and the per-site switch.
  ProductDocument: {
    product: { model: "Product", list: false },
    revisions: { model: "ProductDocumentRevision", list: true },
    sites: { model: "ProductDocumentSite", list: true },
    leadRequests: { model: "LeadDocumentRequest", list: true },
  },
  ProductDocumentRevision: {
    document: { model: "ProductDocument", list: false },
    uploadedBy: { model: "User", list: false },
    // DP-086: site rows pinned to the revision.
    sites: { model: "ProductDocumentSite", list: true },
    crossReferences: { model: "ProductCrossReference", list: true },
    leadRequests: { model: "LeadDocumentRequest", list: true },
  },
  ProductDocumentSite: {
    document: { model: "ProductDocument", list: false },
    site: { model: "Site", list: false },
    revision: { model: "ProductDocumentRevision", list: false },
  },
  // PM-6: global brands, their products and cross-references.
  GlobalBrand: {
    products: { model: "GlobalProduct", list: true },
  },
  GlobalProduct: {
    brand: { model: "GlobalBrand", list: false },
    crossReferences: { model: "ProductCrossReference", list: true },
  },
  ProductCrossReference: {
    product: { model: "Product", list: false },
    globalProduct: { model: "GlobalProduct", list: false },
    sourceRevision: { model: "ProductDocumentRevision", list: false },
    requestedBy: { model: "User", list: false },
    verifiedBy: { model: "User", list: false },
    events: { model: "ProductCrossReferenceEvent", list: true },
    sites: { model: "ProductCrossReferenceSite", list: true },
  },
  ProductCrossReferenceEvent: {
    crossReference: { model: "ProductCrossReference", list: false },
    actor: { model: "User", list: false },
  },
  ProductCrossReferenceSite: {
    crossReference: { model: "ProductCrossReference", list: false },
    site: { model: "Site", list: false },
  },
  // DP-042/DP-043: leads and lead-gated downloads.
  Lead: {
    site: { model: "Site", list: false },
    requests: { model: "LeadDocumentRequest", list: true },
    assignedTo: { model: "User", list: false },
    activities: { model: "LeadActivity", list: true },
  },
  LeadActivity: {
    site: { model: "Site", list: false },
    lead: { model: "Lead", list: false },
    actor: { model: "User", list: false },
    fromAssignee: { model: "User", list: false },
    toAssignee: { model: "User", list: false },
  },
  LeadDocumentRequest: {
    lead: { model: "Lead", list: false },
    site: { model: "Site", list: false },
    product: { model: "Product", list: false },
    document: { model: "ProductDocument", list: false },
    revision: { model: "ProductDocumentRevision", list: false },
    grant: { model: "DocumentDownloadGrant", list: false },
    downloads: { model: "LeadDocumentDownload", list: true },
  },
  DocumentDownloadGrant: {
    request: { model: "LeadDocumentRequest", list: false },
    site: { model: "Site", list: false },
    downloads: { model: "LeadDocumentDownload", list: true },
  },
  LeadDocumentDownload: {
    request: { model: "LeadDocumentRequest", list: false },
    grant: { model: "DocumentDownloadGrant", list: false },
    site: { model: "Site", list: false },
  },
  CustomerDataAccessRequest: {
    user: { model: "User", list: false },
    role: { model: "Role", list: false },
    site: { model: "Site", list: false },
    extends: { model: "RoleAssignment", list: false },
    requestedBy: { model: "User", list: false },
    decidedBy: { model: "User", list: false },
  },
  CmsPage: {
    site: { model: "Site", list: false },
    createdBy: { model: "User", list: false },
    updatedBy: { model: "User", list: false },
    revisions: { model: "CmsPageRevision", list: true },
    publication: { model: "CmsPagePublication", list: false },
  },
  CmsPageRevision: {
    page: { model: "CmsPage", list: false },
    site: { model: "Site", list: false },
    createdBy: { model: "User", list: false },
    publications: { model: "CmsPagePublication", list: true },
  },
  CmsPagePublication: {
    page: { model: "CmsPage", list: false },
    revision: { model: "CmsPageRevision", list: false },
    site: { model: "Site", list: false },
    publishedBy: { model: "User", list: false },
    unpublishedBy: { model: "User", list: false },
  },
};

/** Json columns: their content is data, never relation arguments. */
const JSON_FIELDS: Readonly<Record<string, readonly string[]>> = {
  AuditEvent: ["metadata"],
  ProductImage: ["variants"],
  ProductPublication: ["snapshot"],
  CmsPage: ["content"],
  CmsPageRevision: ["content"],
};

export const RAW_METHODS = [
  "$queryRaw",
  "$queryRawUnsafe",
  "$executeRaw",
  "$executeRawUnsafe",
  "$runCommandRaw",
  "$queryRawTyped",
] as const;

export class SiteScopeViolationError extends Error {
  override name = "SiteScopeViolationError";
}

const WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);
const CREATE_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
const siteBound = (model: string) => model in SITE_BOUND_MODELS;
const refuse = (msg: string): never => {
  throw new SiteScopeViolationError(msg);
};

export function siteFilter(model: string, scope: SiteScope): Obj {
  const inSites = { siteId: { in: [...scope.siteIds] } };
  const filter =
    SITE_BOUND_MODELS[model]?.nullable && scope.includePlatform
      ? { OR: [inSites, { siteId: null }] }
      : inSites;
  // DP-108 (ADR-018): the PROTECTED audit stream never reaches request code through the scoped
  // client; only the owner console (IAM infrastructure) reads it.
  return model === "AuditEvent" ? { AND: [filter, { stream: "STANDARD" }] } : filter;
}

export function siteAllowed(model: string, scope: SiteScope, siteId: unknown): boolean {
  if (siteId === null) return Boolean(SITE_BOUND_MODELS[model]?.nullable && scope.includePlatform);
  return typeof siteId === "string" && scope.siteIds.includes(siteId);
}

function andWhere(where: unknown, filter: Obj): Obj {
  const base = isObj(where) ? where : {};
  const and = base["AND"];
  const existing = and === undefined ? [] : Array.isArray(and) ? and : [and];
  return { ...base, AND: [...existing, filter] };
}

/** Rewrites a `where` of `model` so relation filters into site-bound models stay in scope. */
export function scopeWhere(model: string, where: unknown, scope: SiteScope): unknown {
  if (!isObj(where)) return where;
  const out: Obj = {};
  for (const [key, value] of Object.entries(where)) {
    if (key === "AND" || key === "OR" || key === "NOT") {
      out[key] = Array.isArray(value)
        ? value.map((w) => scopeWhere(model, w, scope))
        : scopeWhere(model, value, scope);
      continue;
    }
    const rel = RELATIONS[model]?.[key];
    if (!rel || !isObj(value)) {
      out[key] = value;
      continue;
    }
    if (!rel.list) {
      if (siteBound(rel.model)) refuse(`${model}.${key}: to-one filter into a site-bound model`);
      const one: Obj = {};
      for (const [op, f] of Object.entries(value)) {
        one[op] = op === "is" || op === "isNot" ? scopeWhere(rel.model, f, scope) : f;
      }
      // A direct filter (`{ user: { email: … } }`) has no is/isNot wrapper.
      out[key] = "is" in value || "isNot" in value ? one : scopeWhere(rel.model, value, scope);
      continue;
    }
    const filter = siteBound(rel.model) ? siteFilter(rel.model, scope) : null;
    const list: Obj = {};
    for (const [op, f] of Object.entries(value)) {
      const inner = scopeWhere(rel.model, f, scope);
      if (!filter) list[op] = inner;
      else if (op === "some" || op === "none") list[op] = andWhere(inner, filter);
      else if (op === "every") list[op] = { OR: [{ NOT: filter }, inner ?? {}] };
      else refuse(`${model}.${key}: unsupported list filter ${op}`);
    }
    out[key] = list;
  }
  return out;
}

/** Rewrites `include`/`select` (and nested ones) of `model`. */
function scopeProjection(model: string, projection: unknown, scope: SiteScope): unknown {
  if (!isObj(projection)) return projection;
  const out: Obj = {};
  for (const [key, value] of Object.entries(projection)) {
    if (key === "_count") {
      out[key] = scopeCount(model, value, scope);
      continue;
    }
    const rel = RELATIONS[model]?.[key];
    if (!rel || value === false || value === undefined) {
      out[key] = value;
      continue;
    }
    const args: Obj = isObj(value) ? { ...value } : {};
    if (siteBound(rel.model)) {
      if (!rel.list) refuse(`${model}.${key}: to-one relation into a site-bound model`);
      args["where"] = andWhere(
        scopeWhere(rel.model, args["where"], scope),
        siteFilter(rel.model, scope),
      );
    } else if ("where" in args) {
      args["where"] = scopeWhere(rel.model, args["where"], scope);
    }
    out[key] = scopeNested(rel.model, args, scope);
  }
  return out;
}

function scopeCount(model: string, value: unknown, scope: SiteScope): unknown {
  const relations = Object.entries(RELATIONS[model] ?? {});
  if (value === true) {
    if (relations.some(([, r]) => r.list && siteBound(r.model))) {
      refuse(`${model}._count: count site-bound relations explicitly with _count.select`);
    }
    return value;
  }
  if (!isObj(value) || !isObj(value["select"])) return value;
  const select: Obj = {};
  for (const [key, v] of Object.entries(value["select"])) {
    const rel = RELATIONS[model]?.[key];
    if (!rel || v === false) {
      select[key] = v;
      continue;
    }
    const args: Obj = isObj(v) ? { ...v } : {};
    args["where"] = siteBound(rel.model)
      ? andWhere(scopeWhere(rel.model, args["where"], scope), siteFilter(rel.model, scope))
      : scopeWhere(rel.model, args["where"], scope);
    select[key] = args;
  }
  return { ...value, select };
}

function scopeOrderBy(model: string, orderBy: unknown): void {
  const items = Array.isArray(orderBy) ? orderBy : [orderBy];
  for (const item of items) {
    if (!isObj(item)) continue;
    for (const [key, value] of Object.entries(item)) {
      const rel = RELATIONS[model]?.[key];
      if (!rel) continue;
      if (rel.list && siteBound(rel.model))
        refuse(`${model}.${key}: ordering by a site-bound relation`);
      if (!rel.list) scopeOrderBy(rel.model, value);
    }
  }
}

/** Refuses nested writes that reach a site-bound model through a relation. */
export function assertNoSiteBoundNestedWrite(model: string, data: unknown): void {
  if (Array.isArray(data)) {
    for (const d of data) assertNoSiteBoundNestedWrite(model, d);
    return;
  }
  if (!isObj(data)) return;
  for (const [key, value] of Object.entries(data)) {
    if (JSON_FIELDS[model]?.includes(key)) continue;
    const rel = RELATIONS[model]?.[key];
    if (rel) {
      if (siteBound(rel.model)) refuse(`${model}.${key}: nested write into a site-bound model`);
      assertNoSiteBoundNestedWrite(rel.model, value);
    } else if (typeof value === "object" && value !== null) {
      // Wrapper keys of nested writes (create, update, data, upsert, …) keep the model.
      assertNoSiteBoundNestedWrite(model, value);
    }
  }
}

function assertWritableData(model: string, scope: SiteScope, data: unknown, create: boolean): void {
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    const record = isObj(row) ? row : {};
    if ("site" in record) refuse(`${model}: set siteId as a scalar, not through the site relation`);
    if (!create && !("siteId" in record)) continue; // update that does not move the row
    if (create && !("siteId" in record)) refuse(`${model}: create needs a scalar siteId`);
    if (!siteAllowed(model, scope, record["siteId"]))
      refuse(`${model}: siteId is outside the scope`);
  }
}

function scopeNested(model: string, args: Obj, scope: SiteScope): Obj {
  const out: Obj = { ...args };
  if ("include" in out) out["include"] = scopeProjection(model, out["include"], scope);
  if ("select" in out) out["select"] = scopeProjection(model, out["select"], scope);
  if ("orderBy" in out) scopeOrderBy(model, out["orderBy"]);
  return out;
}

/** The full rewrite of one operation's arguments. Exported for unit tests. */
export function scopeOperationArgs(
  model: string,
  operation: string,
  args: unknown,
  scope: SiteScope,
): Obj {
  const a = scopeNested(model, isObj(args) ? { ...args } : {}, scope);
  for (const key of ["data", "create", "update"]) {
    if (key in a) assertNoSiteBoundNestedWrite(model, a[key]);
  }
  if ("where" in a || WHERE_OPERATIONS.has(operation) || operation === "upsert") {
    a["where"] = scopeWhere(model, a["where"], scope);
  }
  if (!siteBound(model)) return a;
  const filter = siteFilter(model, scope);
  if (WHERE_OPERATIONS.has(operation)) {
    a["where"] = andWhere(a["where"], filter);
    if ("data" in a) assertWritableData(model, scope, a["data"], false);
    return a;
  }
  if (CREATE_OPERATIONS.has(operation)) {
    assertWritableData(model, scope, a["data"], true);
    return a;
  }
  if (operation === "upsert") {
    a["where"] = andWhere(a["where"], filter);
    assertWritableData(model, scope, a["create"], true);
    assertWritableData(model, scope, a["update"], false);
    return a;
  }
  return refuse(`${model}.${operation} is not supported on a site-scoped client`);
}

/** Proxies a client so raw queries are refused, also inside its interactive transactions. */
export function withoutRaw<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && (RAW_METHODS as readonly string[]).includes(prop)) {
        return () => refuse(`${prop} is not available on a site-scoped client`);
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      if (prop === "$transaction" && typeof value === "function") {
        return (arg: unknown, ...rest: unknown[]) =>
          typeof arg === "function"
            ? value.call(
                target,
                (tx: object) => (arg as (t: object) => unknown)(withoutRaw(tx)),
                ...rest,
              )
            : value.call(target, arg, ...rest);
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The site-scope query extension without the raw-query guard (lead-data.ts needs raw once). */
export function siteScopedExtension(prisma: PrismaClient, scope: SiteScope) {
  return prisma.$extends({
    name: "site-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopeOperationArgs(model, operation, args, scope) as typeof args);
        },
      },
    },
  });
}

export function withSiteScope(prisma: PrismaClient, scope: SiteScope) {
  return withoutRaw(siteScopedExtension(prisma, scope));
}

export type SiteScopedClient = ReturnType<typeof withSiteScope>;
