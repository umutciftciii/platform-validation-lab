/**
 * Product catalogue administration (PM-1: DP-031, DP-032, DP-033, DP-034).
 *
 * Authorization model (owner decisions for PM-1):
 *  - Product masters are platform-wide. Creating, editing, archiving and restoring them needs the
 *    PLATFORM permission `product_master:edit`; the SITE permission `product:edit` never grants it.
 *  - Reading is always done in the view of one site and needs `product:read` of that site. Only
 *    that site's listing and categories are loaded (site-scoped client).
 *  - Listings and categories are changed with `product:edit` of their site. A category or listing
 *    of another site is simply not found (404) through the scoped client (IDOR).
 *  - Every change and its audit event are written in one transaction. Refusals are audited by
 *    StaffAccess.require.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  CATALOG_CONTENT_LOCALE,
  CategoryCreateRequestSchema,
  CategoryDefaultRequestSchema,
  CategoryUpdateRequestSchema,
  ListingUpsertRequestSchema,
  ProductCreateRequestSchema,
  ProductListQuerySchema,
  ProductStateRequestSchema,
  ProductUpdateRequestSchema,
  type Category,
  type CatalogContextResponse,
  type Listing,
  type Product,
  type ProductDetailResponse,
  type ProductListResponse,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { mapDbError, staleVersion } from "./errors.js";
import { changeMaster } from "./master.js";
import { parentProblem, subtreeIds } from "./tree.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MASTER = "product_master:edit";
const READ = "product:read";
const EDIT = "product:edit";
const APPROVE = "product:approve";
const PUBLISH = "product:publish";
const PLATFORM = { scope: "platform" } as const;
const site = (siteId: string) => ({ scope: "site", siteId }) as const;

interface ProductRow {
  id: string;
  code: string;
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "ARCHIVED";
  version: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ListingRow {
  id: string;
  siteId: string;
  categoryId: string;
  visibility: "VISIBLE" | "HIDDEN";
  sortOrder: number;
  version: number;
  updatedAt: Date;
  texts: { title: string | null; summary: string | null; description: string | null }[];
}

interface CategoryRow {
  id: string;
  siteId: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isDefault: boolean;
  version: number;
  updatedAt: Date;
}

function toProduct(p: ProductRow): Product {
  return {
    id: p.id,
    code: p.code,
    slug: p.slug,
    name: p.name,
    summary: p.summary,
    description: p.description,
    status: p.status,
    version: p.version,
    archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toListing(l: ListingRow): Listing {
  const text = l.texts[0];
  return {
    id: l.id,
    siteId: l.siteId,
    categoryId: l.categoryId,
    visibility: l.visibility,
    sortOrder: l.sortOrder,
    version: l.version,
    text: text ? { title: text.title, summary: text.summary, description: text.description } : null,
    updatedAt: l.updatedAt.toISOString(),
  };
}

function toCategory(c: CategoryRow, all: readonly CategoryRow[], listingCount: number): Category {
  return {
    id: c.id,
    siteId: c.siteId,
    parentId: c.parentId,
    name: c.name,
    slug: c.slug,
    description: c.description,
    sortOrder: c.sortOrder,
    isDefault: c.isDefault,
    version: c.version,
    listingCount,
    childCount: all.filter((x) => x.parentId === c.id).length,
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Field names whose value differs (audit metadata: names only, never values). */
function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => before[k] !== after[k]);
}

const LISTING_SELECT = {
  id: true,
  siteId: true,
  categoryId: true,
  visibility: true,
  sortOrder: true,
  version: true,
  updatedAt: true,
  texts: {
    where: { locale: CATALOG_CONTENT_LOCALE },
    select: { title: true, summary: true, description: true },
  },
} as const;

@Injectable()
export class CatalogService {
  constructor(@Inject(StaffAccessService) private readonly access: StaffAccessService) {}

  private static uuidOr404(id: string): string {
    if (!UUID.test(id)) throw new ApiError("NOT_FOUND");
    return id.toLowerCase();
  }

  /** Validates a site id from the request and requires `permission` there (403 otherwise). */
  private static async requireSite(
    a: StaffAccess,
    permission: string,
    siteId: string,
    resource: { type: string; id: string | null },
  ): Promise<string> {
    const id = UUID.test(siteId) ? siteId.toLowerCase() : "00000000-0000-0000-0000-000000000000";
    await a.require(permission, site(id), resource);
    return id;
  }

  // --- context -------------------------------------------------------------------------------

  async context(ctx: RequestContext): Promise<CatalogContextResponse> {
    const a = await this.access.begin(ctx);
    const readable = new Set(a.sitesWith(READ));
    const editable = new Set(a.sitesWith(EDIT));
    const publishable = new Set(a.sitesWith(PUBLISH));
    return {
      sites: a.sites
        .filter((s) => readable.has(s.id))
        .map((s) => ({
          id: s.id,
          key: s.key,
          name: s.name,
          canEdit: editable.has(s.id),
          canPublish: publishable.has(s.id),
        })),
      canEditMaster: a.allows(MASTER, PLATFORM),
      canApprove: a.allows(APPROVE, PLATFORM),
    };
  }

  // --- products ------------------------------------------------------------------------------

  async listProducts(
    ctx: RequestContext,
    rawQuery: Record<string, unknown>,
  ): Promise<ProductListResponse> {
    const a = await this.access.begin(ctx);
    const query = parseBody(ProductListQuerySchema, rawQuery);
    const siteId = await CatalogService.requireSite(a, READ, query.siteId, {
      type: "product",
      id: null,
    });
    const db = a.db({ siteIds: [siteId], includePlatform: false });

    let categoryIds: string[] | undefined;
    if (query.categoryId) {
      const nodes = await db.productCategory.findMany({
        where: { siteId },
        select: { id: true, parentId: true },
      });
      if (!nodes.some((n) => n.id === query.categoryId)) {
        return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
      }
      categoryIds = subtreeIds(nodes, query.categoryId);
    }

    const listingFilter = {
      siteId,
      ...(query.visibility ? { visibility: query.visibility } : {}),
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    };
    const needsListing = query.listing === "listed" || Boolean(query.visibility || categoryIds);
    if (query.listing === "unlisted" && needsListing) {
      return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
    }
    const q = query.q?.trim();
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { code: { contains: q.toUpperCase() } },
              { slug: { contains: q.toLowerCase() } },
            ],
          }
        : {}),
      ...(needsListing ? { listings: { some: listingFilter } } : {}),
      ...(query.listing === "unlisted" ? { listings: { none: { siteId } } } : {}),
    };

    const [total, rows] = await Promise.all([
      db.product.count({ where }),
      db.product.findMany({
        where,
        orderBy: [{ [query.sort]: query.order }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          code: true,
          slug: true,
          name: true,
          status: true,
          version: true,
          updatedAt: true,
          listings: {
            where: { siteId },
            select: { id: true, visibility: true, categoryId: true, updatedAt: true },
          },
          publications: {
            where: { siteId },
            select: { status: true, productVersion: true },
          },
        },
      }),
    ]);
    const usedCategories = [...new Set(rows.flatMap((r) => r.listings.map((l) => l.categoryId)))];
    const names = new Map(
      (usedCategories.length
        ? await db.productCategory.findMany({
            where: { id: { in: usedCategories } },
            select: { id: true, name: true },
          })
        : []
      ).map((c) => [c.id, c.name]),
    );
    return {
      items: rows.map((r) => {
        const l = r.listings[0];
        const pub = r.publications[0];
        return {
          id: r.id,
          code: r.code,
          slug: r.slug,
          name: r.name,
          status: r.status,
          version: r.version,
          updatedAt: r.updatedAt.toISOString(),
          listing: l
            ? {
                id: l.id,
                visibility: l.visibility,
                categoryId: l.categoryId,
                categoryName: names.get(l.categoryId) ?? "",
                updatedAt: l.updatedAt.toISOString(),
              }
            : null,
          publication: pub ? { status: pub.status, productVersion: pub.productVersion } : null,
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getProduct(
    ctx: RequestContext,
    rawId: string,
    rawSiteId: unknown,
  ): Promise<ProductDetailResponse> {
    const a = await this.access.begin(ctx);
    const id = CatalogService.uuidOr404(rawId);
    const siteId = await CatalogService.requireSite(
      a,
      READ,
      typeof rawSiteId === "string" ? rawSiteId : "",
      { type: "product", id },
    );
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    const product = await db.product.findUnique({ where: { id } });
    if (!product) throw new ApiError("NOT_FOUND");
    const listing = await db.productSiteListing.findUnique({
      where: { productId_siteId: { productId: id, siteId } },
      select: LISTING_SELECT,
    });
    return { product: toProduct(product), listing: listing ? toListing(listing) : null };
  }

  async createProduct(ctx: RequestContext, body: unknown): Promise<{ product: Product }> {
    const a = await this.access.begin(ctx);
    await a.require(MASTER, PLATFORM, { type: "product", id: null });
    const input = parseBody(ProductCreateRequestSchema, body);
    const db = a.db({ siteIds: [], includePlatform: true });
    try {
      const product = await db.$transaction(async (tx) => {
        // PM-3: the creator is the first editor of the revision (separation of duties).
        const created = await tx.product.create({
          data: { ...input, revisionEditorIds: [a.userId] },
        });
        await a.audit(tx, {
          action: "catalog.product_created",
          resourceType: "product",
          resourceId: created.id,
          siteId: null,
          permission: MASTER,
          metadata: { code: created.code },
        });
        return created;
      });
      return { product: toProduct(product) };
    } catch (e) {
      return mapDbError(e);
    }
  }

  async updateProduct(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<{ product: Product }> {
    const a = await this.access.begin(ctx);
    const id = CatalogService.uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: "product", id });
    const { version, ...input } = parseBody(ProductUpdateRequestSchema, body);
    const db = a.db({ siteIds: [], includePlatform: true });
    try {
      const product = await db.$transaction(async (tx) => {
        const before = await tx.product.findUnique({ where: { id } });
        if (!before) throw new ApiError("NOT_FOUND");
        if (before.status === "ARCHIVED") {
          throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "archived" }]);
        }
        // PM-3: locks, bumps the version, records the editor, resets a review or approval.
        await changeMaster(tx, a, id, { expectedVersion: version, data: input, cause: "master" });
        const after = await tx.product.findUniqueOrThrow({ where: { id } });
        await a.audit(tx, {
          action: "catalog.product_updated",
          resourceType: "product",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: { changed: changedFields(before, input), version: after.version },
        });
        return after;
      });
      return { product: toProduct(product) };
    } catch (e) {
      return mapDbError(e);
    }
  }

  async setProductArchived(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
    archive: boolean,
  ): Promise<{ product: Product }> {
    const a = await this.access.begin(ctx);
    const id = CatalogService.uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: "product", id });
    const { version } = parseBody(ProductStateRequestSchema, body);
    const db = a.db({ siteIds: [], includePlatform: true });
    try {
      const product = await db.$transaction(async (tx) => {
        const before = await tx.product.findUnique({ where: { id } });
        if (!before) throw new ApiError("NOT_FOUND");
        if ((before.status === "ARCHIVED") === archive) {
          throw new ApiError("CONFLICT_STATE", [
            { path: "status", rule: archive ? "archived" : "not_archived" },
          ]);
        }
        const res = await tx.product.updateMany({
          where: { id, version },
          data: archive
            ? { status: "ARCHIVED", archivedAt: new Date(), version: { increment: 1 } }
            : { status: "DRAFT", archivedAt: null, version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleVersion();
        const after = await tx.product.findUniqueOrThrow({ where: { id } });
        await a.audit(tx, {
          action: archive ? "catalog.product_archived" : "catalog.product_restored",
          resourceType: "product",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: { version: after.version },
        });
        return after;
      });
      return { product: toProduct(product) };
    } catch (e) {
      return mapDbError(e);
    }
  }

  // --- listings ------------------------------------------------------------------------------

  async upsertListing(
    ctx: RequestContext,
    rawProductId: string,
    rawSiteId: string,
    body: unknown,
  ): Promise<{ listing: Listing }> {
    const a = await this.access.begin(ctx);
    const productId = CatalogService.uuidOr404(rawProductId);
    const siteId = await CatalogService.requireSite(a, EDIT, rawSiteId, {
      type: "product_listing",
      id: productId,
    });
    const input = parseBody(ListingUpsertRequestSchema, body);
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    try {
      const listing = await db.$transaction(async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { id: true, status: true },
        });
        if (!product) throw new ApiError("NOT_FOUND");
        if (product.status === "ARCHIVED" && input.visibility === "VISIBLE") {
          throw new ApiError("CONFLICT_STATE", [{ path: "visibility", rule: "product_archived" }]);
        }
        const existing = await tx.productSiteListing.findUnique({
          where: { productId_siteId: { productId, siteId } },
          select: LISTING_SELECT,
        });
        if (existing && input.version === null) {
          throw new ApiError("CONFLICT_STATE", [{ path: "listing", rule: "unique" }]);
        }
        if (!existing && input.version !== null) throw staleVersion();

        let categoryId = input.categoryId ?? null;
        if (!categoryId && existing) categoryId = existing.categoryId;
        if (!categoryId) {
          const def = await tx.productCategory.findFirst({
            where: { siteId, isDefault: true },
            select: { id: true },
          });
          if (!def) {
            throw new ApiError("VALIDATION_FAILED", [{ path: "categoryId", rule: "required" }]);
          }
          categoryId = def.id;
        } else {
          const cat = await tx.productCategory.findFirst({
            where: { id: categoryId, siteId },
            select: { id: true },
          });
          if (!cat) {
            throw new ApiError("VALIDATION_FAILED", [{ path: "categoryId", rule: "unknown" }]);
          }
        }

        const fields = {
          categoryId,
          visibility: input.visibility,
          sortOrder: input.sortOrder,
        };
        const text = { title: input.title, summary: input.summary, description: input.description };
        let listingId: string;
        if (!existing) {
          const created = await tx.productSiteListing.create({
            data: { productId, siteId, ...fields },
            select: { id: true },
          });
          listingId = created.id;
        } else {
          const res = await tx.productSiteListing.updateMany({
            where: { id: existing.id, version: input.version as number },
            data: { ...fields, version: { increment: 1 } },
          });
          if (res.count !== 1) throw staleVersion();
          listingId = existing.id;
        }
        const hasText = Boolean(text.title || text.summary || text.description);
        if (hasText || existing?.texts[0]) {
          await tx.productListingText.upsert({
            where: { listingId_locale: { listingId, locale: CATALOG_CONTENT_LOCALE } },
            create: { listingId, siteId, locale: CATALOG_CONTENT_LOCALE, ...text },
            update: text,
          });
        }
        const after = await tx.productSiteListing.findUniqueOrThrow({
          where: { id: listingId },
          select: LISTING_SELECT,
        });
        const beforeFlat = existing
          ? {
              categoryId: existing.categoryId,
              visibility: existing.visibility,
              sortOrder: existing.sortOrder,
              title: existing.texts[0]?.title ?? null,
              summary: existing.texts[0]?.summary ?? null,
              description: existing.texts[0]?.description ?? null,
            }
          : {};
        await a.audit(tx, {
          action: existing ? "catalog.listing_updated" : "catalog.listing_created",
          resourceType: "product_listing",
          resourceId: listingId,
          siteId,
          permission: EDIT,
          metadata: {
            productId,
            changed: changedFields(beforeFlat, { ...fields, ...text }),
            visibility: after.visibility,
            version: after.version,
          },
        });
        return after;
      });
      return { listing: toListing(listing) };
    } catch (e) {
      return mapDbError(e);
    }
  }

  // --- categories ----------------------------------------------------------------------------

  private static async listingCounts(
    db: ReturnType<StaffAccess["db"]>,
    siteId: string,
  ): Promise<Map<string, number>> {
    const groups = await db.productSiteListing.groupBy({
      by: ["categoryId"],
      where: { siteId },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.categoryId, g._count._all]));
  }

  async listCategories(ctx: RequestContext, rawSiteId: string): Promise<{ items: Category[] }> {
    const a = await this.access.begin(ctx);
    const siteId = await CatalogService.requireSite(a, READ, rawSiteId, {
      type: "product_category",
      id: null,
    });
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    const rows = await db.productCategory.findMany({
      where: { siteId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    const counts = await CatalogService.listingCounts(db, siteId);
    return { items: rows.map((c) => toCategory(c, rows, counts.get(c.id) ?? 0)) };
  }

  private static async categoryResponse(
    db: ReturnType<StaffAccess["db"]>,
    siteId: string,
    id: string,
  ): Promise<{ category: Category }> {
    const rows = await db.productCategory.findMany({ where: { siteId } });
    const row = rows.find((r) => r.id === id);
    if (!row) throw new ApiError("NOT_FOUND");
    const counts = await CatalogService.listingCounts(db, siteId);
    return { category: toCategory(row, rows, counts.get(id) ?? 0) };
  }

  async createCategory(
    ctx: RequestContext,
    rawSiteId: string,
    body: unknown,
  ): Promise<{ category: Category }> {
    const a = await this.access.begin(ctx);
    const siteId = await CatalogService.requireSite(a, EDIT, rawSiteId, {
      type: "product_category",
      id: null,
    });
    const input = parseBody(CategoryCreateRequestSchema, body);
    const db = a.db({ siteIds: [siteId], includePlatform: false });
    try {
      const id = await db.$transaction(async (tx) => {
        const nodes = await tx.productCategory.findMany({
          where: { siteId },
          select: { id: true, parentId: true },
        });
        const problem = parentProblem(nodes, null, input.parentId);
        if (problem) throw new ApiError("VALIDATION_FAILED", [{ path: "parentId", rule: problem }]);
        const created = await tx.productCategory.create({
          data: { siteId, ...input, isDefault: nodes.length === 0 },
          select: { id: true, isDefault: true },
        });
        await a.audit(tx, {
          action: "catalog.category_created",
          resourceType: "product_category",
          resourceId: created.id,
          siteId,
          permission: EDIT,
          metadata: { isDefault: created.isDefault },
        });
        return created.id;
      });
      return CatalogService.categoryResponse(db, siteId, id);
    } catch (e) {
      return mapDbError(e);
    }
  }

  /** Loads a category through the scope of the sites where the caller holds product:edit. */
  private static async editableCategory(a: StaffAccess, rawId: string) {
    const id = CatalogService.uuidOr404(rawId);
    const sites = a.sitesWith(EDIT);
    const db = a.db({ siteIds: sites, includePlatform: false });
    const row = sites.length
      ? await db.productCategory.findUnique({ where: { id }, select: { id: true, siteId: true } })
      : null;
    if (!row) {
      // Out of scope and unknown look the same (IDOR). The attempt is audited.
      await a.denied(EDIT, { type: "product_category", id }, "not_found_in_scope");
      throw new ApiError("NOT_FOUND");
    }
    return {
      id,
      siteId: row.siteId,
      db: a.db({ siteIds: [row.siteId], includePlatform: false }),
    };
  }

  async updateCategory(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<{ category: Category }> {
    const a = await this.access.begin(ctx);
    const { id, siteId, db } = await CatalogService.editableCategory(a, rawId);
    const { version, ...input } = parseBody(CategoryUpdateRequestSchema, body);
    try {
      await db.$transaction(async (tx) => {
        const nodes = await tx.productCategory.findMany({ where: { siteId } });
        const before = nodes.find((n) => n.id === id);
        if (!before) throw new ApiError("NOT_FOUND");
        const problem = parentProblem(nodes, id, input.parentId);
        if (problem) throw new ApiError("VALIDATION_FAILED", [{ path: "parentId", rule: problem }]);
        const res = await tx.productCategory.updateMany({
          where: { id, version },
          data: { ...input, version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleVersion();
        await a.audit(tx, {
          action: "catalog.category_updated",
          resourceType: "product_category",
          resourceId: id,
          siteId,
          permission: EDIT,
          metadata: { changed: changedFields(before, input), version: version + 1 },
        });
      });
      return CatalogService.categoryResponse(db, siteId, id);
    } catch (e) {
      return mapDbError(e);
    }
  }

  async setDefaultCategory(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<{ category: Category }> {
    const a = await this.access.begin(ctx);
    const { id, siteId, db } = await CatalogService.editableCategory(a, rawId);
    const { version } = parseBody(CategoryDefaultRequestSchema, body);
    try {
      await db.$transaction(async (tx) => {
        const previous = await tx.productCategory.findFirst({
          where: { siteId, isDefault: true },
          select: { id: true },
        });
        if (previous?.id === id) return;
        if (previous) {
          await tx.productCategory.updateMany({
            where: { id: previous.id },
            data: { isDefault: false, version: { increment: 1 } },
          });
        }
        const res = await tx.productCategory.updateMany({
          where: { id, version },
          data: { isDefault: true, version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleVersion();
        await a.audit(tx, {
          action: "catalog.category_default_set",
          resourceType: "product_category",
          resourceId: id,
          siteId,
          permission: EDIT,
          metadata: { previousDefaultId: previous?.id ?? null },
        });
      });
      return CatalogService.categoryResponse(db, siteId, id);
    } catch (e) {
      return mapDbError(e);
    }
  }

  async deleteCategory(ctx: RequestContext, rawId: string): Promise<void> {
    const a = await this.access.begin(ctx);
    const { id, siteId, db } = await CatalogService.editableCategory(a, rawId);
    try {
      await db.$transaction(async (tx) => {
        const children = await tx.productCategory.count({ where: { siteId, parentId: id } });
        if (children > 0) {
          throw new ApiError("CONFLICT_STATE", [{ path: "(root)", rule: "has_children" }]);
        }
        const listings = await tx.productSiteListing.count({ where: { siteId, categoryId: id } });
        if (listings > 0) {
          throw new ApiError("CONFLICT_STATE", [{ path: "(root)", rule: "has_listings" }]);
        }
        const row = await tx.productCategory.findUnique({
          where: { id },
          select: { slug: true, isDefault: true },
        });
        if (!row) throw new ApiError("NOT_FOUND");
        await tx.productCategory.deleteMany({ where: { id } });
        await a.audit(tx, {
          action: "catalog.category_deleted",
          resourceType: "product_category",
          resourceId: id,
          siteId,
          permission: EDIT,
          metadata: { slug: row.slug, wasDefault: row.isDefault },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
  }
}
