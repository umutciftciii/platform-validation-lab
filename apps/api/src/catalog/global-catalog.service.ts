/**
 * Global brands and global products (PM-6, DP-036; ADR-015): other manufacturers' products that
 * our product masters are cross-referenced with. Platform-wide reference data:
 *
 *  - reading and searching need `product:read` on any site (like the product masters);
 *  - creating, changing, archiving and restoring need `product_master:edit` (PLATFORM);
 *  - nothing is deleted; a brand or product that is archived can no longer be cross-referenced
 *    or shown, and an archived brand freezes its products (trigger);
 *  - every change names the version it was based on and writes its audit event in the same
 *    transaction. A change of a global product raises its version, which makes verifications
 *    based on the old version stale (xrefs.service.ts).
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  GLOBAL_SEARCH_LIMIT,
  GlobalBrandCreateRequestSchema,
  GlobalBrandUpdateRequestSchema,
  globalNameKey,
  GlobalProductCreateRequestSchema,
  GlobalProductUpdateRequestSchema,
  GlobalStateRequestSchema,
  type GlobalBrand,
  type GlobalBrandListResponse,
  type GlobalProduct,
  type GlobalProductListResponse,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { mapDbError, staleVersion } from "./errors.js";
import { MASTER, PLATFORM, requireMasterRead, uuidOr404 } from "./specs.service.js";

type Db = ReturnType<StaffAccess["db"]>;

interface BrandRow {
  id: string;
  name: string;
  manufacturer: string;
  country: string | null;
  notes: string | null;
  status: "ACTIVE" | "ARCHIVED";
  version: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { products: number };
}

export interface GlobalProductRow {
  id: string;
  brandId: string;
  name: string;
  grade: string | null;
  description: string | null;
  status: "ACTIVE" | "ARCHIVED";
  version: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  brand: { id: string; name: string; manufacturer: string; status: "ACTIVE" | "ARCHIVED" };
}

export const GLOBAL_PRODUCT_INCLUDE = {
  brand: { select: { id: true, name: true, manufacturer: true, status: true } },
} as const;

function toBrand(r: BrandRow): GlobalBrand {
  return {
    id: r.id,
    name: r.name,
    manufacturer: r.manufacturer,
    country: r.country,
    notes: r.notes,
    status: r.status,
    version: r.version,
    productCount: r._count?.products ?? 0,
    archivedAt: r.archivedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toGlobalProduct(r: GlobalProductRow): GlobalProduct {
  return {
    id: r.id,
    brand: r.brand,
    name: r.name,
    grade: r.grade,
    description: r.description,
    status: r.status,
    version: r.version,
    archivedAt: r.archivedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** A search text: trimmed, at most 100 characters, or null. */
function searchText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim().replace(/\s+/g, " ");
  return q ? q.slice(0, 100) : null;
}

const includeArchived = (raw: unknown) => raw === "1" || raw === "true";

@Injectable()
export class GlobalCatalogService {
  constructor(@Inject(StaffAccessService) private readonly access: StaffAccessService) {}

  /** Platform rows only: brands and global products have no site. */
  private static db(a: StaffAccess): Db {
    return a.db({ siteIds: [], includePlatform: true });
  }

  // --- brands ---------------------------------------------------------------------------------

  async listBrands(
    ctx: RequestContext,
    query: Record<string, unknown>,
  ): Promise<GlobalBrandListResponse> {
    const a = await this.access.begin(ctx);
    await requireMasterRead(a, { type: "global_brand", id: null });
    const q = searchText(query["q"]);
    const rows = (await GlobalCatalogService.db(a).globalBrand.findMany({
      where: {
        ...(includeArchived(query["archived"]) ? {} : { status: "ACTIVE" }),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { manufacturer: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      include: { _count: { select: { products: true } } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      take: GLOBAL_SEARCH_LIMIT,
    })) as BrandRow[];
    return { items: rows.map(toBrand), canEdit: a.allows(MASTER, PLATFORM) };
  }

  private static async brand(db: Db, id: string): Promise<GlobalBrand> {
    const row = (await db.globalBrand.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    })) as BrandRow | null;
    if (!row) throw new ApiError("NOT_FOUND");
    return toBrand(row);
  }

  async createBrand(ctx: RequestContext, body: unknown): Promise<{ brand: GlobalBrand }> {
    const a = await this.access.begin(ctx);
    await a.require(MASTER, PLATFORM, { type: "global_brand", id: null });
    const input = parseBody(GlobalBrandCreateRequestSchema, body);
    const db = GlobalCatalogService.db(a);
    let id = "";
    try {
      id = await db.$transaction(async (tx) => {
        const created = await tx.globalBrand.create({
          data: { ...input, nameKey: globalNameKey(input.name) },
        });
        await a.audit(tx, {
          action: "catalog.global_brand_created",
          resourceType: "global_brand",
          resourceId: created.id,
          siteId: null,
          permission: MASTER,
          metadata: { name: created.name, manufacturer: created.manufacturer },
        });
        return created.id;
      });
    } catch (e) {
      mapDbError(e);
    }
    return { brand: await GlobalCatalogService.brand(db, id) };
  }

  async updateBrand(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<{ brand: GlobalBrand }> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: "global_brand", id });
    const input = parseBody(GlobalBrandUpdateRequestSchema, body);
    const db = GlobalCatalogService.db(a);
    try {
      await db.$transaction(async (tx) => {
        const before = await tx.globalBrand.findUnique({ where: { id } });
        if (!before) throw new ApiError("NOT_FOUND");
        if (before.version !== input.version) throw staleVersion();
        if (before.status === "ARCHIVED") {
          throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "global_archived" }]);
        }
        const { version, ...data } = input;
        const res = await tx.globalBrand.updateMany({
          where: { id, version },
          data: { ...data, nameKey: globalNameKey(data.name), version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleVersion();
        const changed = (["name", "manufacturer", "country", "notes"] as const).filter(
          (k) => before[k] !== data[k],
        );
        await a.audit(tx, {
          action: "catalog.global_brand_updated",
          resourceType: "global_brand",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: { changed },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return { brand: await GlobalCatalogService.brand(db, id) };
  }

  async setBrandArchived(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
    archived: boolean,
  ): Promise<{ brand: GlobalBrand }> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: "global_brand", id });
    const { version } = parseBody(GlobalStateRequestSchema, body);
    const db = GlobalCatalogService.db(a);
    try {
      await db.$transaction(async (tx) => {
        const before = await tx.globalBrand.findUnique({ where: { id } });
        if (!before) throw new ApiError("NOT_FOUND");
        if (before.version !== version) throw staleVersion();
        if ((before.status === "ARCHIVED") === archived) {
          throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "transition" }]);
        }
        const res = await tx.globalBrand.updateMany({
          where: { id, version },
          data: {
            status: archived ? "ARCHIVED" : "ACTIVE",
            archivedAt: archived ? new Date() : null,
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw staleVersion();
        await a.audit(tx, {
          action: archived ? "catalog.global_brand_archived" : "catalog.global_brand_restored",
          resourceType: "global_brand",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: {},
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return { brand: await GlobalCatalogService.brand(db, id) };
  }

  // --- global products ------------------------------------------------------------------------

  async listProducts(
    ctx: RequestContext,
    query: Record<string, unknown>,
  ): Promise<GlobalProductListResponse> {
    const a = await this.access.begin(ctx);
    await requireMasterRead(a, { type: "global_product", id: null });
    const q = searchText(query["q"]);
    const brandId = typeof query["brandId"] === "string" ? uuidOr404(query["brandId"]) : undefined;
    const archived = includeArchived(query["archived"]);
    const rows = (await GlobalCatalogService.db(a).globalProduct.findMany({
      where: {
        ...(brandId ? { brandId } : {}),
        ...(archived ? {} : { status: "ACTIVE", brand: { status: "ACTIVE" } }),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { grade: { contains: q, mode: "insensitive" as const } },
                { brand: { name: { contains: q, mode: "insensitive" as const } } },
                { brand: { manufacturer: { contains: q, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      include: GLOBAL_PRODUCT_INCLUDE,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      take: GLOBAL_SEARCH_LIMIT,
    })) as GlobalProductRow[];
    return { items: rows.map(toGlobalProduct), canEdit: a.allows(MASTER, PLATFORM) };
  }

  private static async product(db: Db, id: string): Promise<GlobalProduct> {
    const row = (await db.globalProduct.findUnique({
      where: { id },
      include: GLOBAL_PRODUCT_INCLUDE,
    })) as GlobalProductRow | null;
    if (!row) throw new ApiError("NOT_FOUND");
    return toGlobalProduct(row);
  }

  async createProduct(
    ctx: RequestContext,
    rawBrandId: string,
    body: unknown,
  ): Promise<{ product: GlobalProduct }> {
    const a = await this.access.begin(ctx);
    const brandId = uuidOr404(rawBrandId);
    await a.require(MASTER, PLATFORM, { type: "global_product", id: null });
    const input = parseBody(GlobalProductCreateRequestSchema, body);
    const db = GlobalCatalogService.db(a);
    let id = "";
    try {
      id = await db.$transaction(async (tx) => {
        const brand = await tx.globalBrand.findUnique({
          where: { id: brandId },
          select: { status: true },
        });
        if (!brand) throw new ApiError("NOT_FOUND");
        if (brand.status === "ARCHIVED") {
          throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "global_archived" }]);
        }
        const created = await tx.globalProduct.create({
          data: { brandId, ...input, nameKey: globalNameKey(input.name, input.grade) },
        });
        await a.audit(tx, {
          action: "catalog.global_product_created",
          resourceType: "global_product",
          resourceId: created.id,
          siteId: null,
          permission: MASTER,
          metadata: { brandId, name: created.name, grade: created.grade },
        });
        return created.id;
      });
    } catch (e) {
      mapDbError(e);
    }
    return { product: await GlobalCatalogService.product(db, id) };
  }

  async updateProduct(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<{ product: GlobalProduct }> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: "global_product", id });
    const input = parseBody(GlobalProductUpdateRequestSchema, body);
    const db = GlobalCatalogService.db(a);
    try {
      await db.$transaction(async (tx) => {
        const before = await tx.globalProduct.findUnique({ where: { id } });
        if (!before) throw new ApiError("NOT_FOUND");
        if (before.version !== input.version) throw staleVersion();
        if (before.status === "ARCHIVED") {
          throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "global_archived" }]);
        }
        const { version, ...data } = input;
        const res = await tx.globalProduct.updateMany({
          where: { id, version },
          data: {
            ...data,
            nameKey: globalNameKey(data.name, data.grade),
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw staleVersion();
        const changed = (["name", "grade", "description"] as const).filter(
          (k) => before[k] !== data[k],
        );
        // Verifications of this product were based on the old version: they become stale.
        const verified = await tx.productCrossReference.count({
          where: { globalProductId: id, status: "VERIFIED" },
        });
        await a.audit(tx, {
          action: "catalog.global_product_updated",
          resourceType: "global_product",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: { brandId: before.brandId, changed, verifiedCrossReferencesStale: verified },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return { product: await GlobalCatalogService.product(db, id) };
  }

  async setProductArchived(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
    archived: boolean,
  ): Promise<{ product: GlobalProduct }> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: "global_product", id });
    const { version } = parseBody(GlobalStateRequestSchema, body);
    const db = GlobalCatalogService.db(a);
    try {
      await db.$transaction(async (tx) => {
        const before = await tx.globalProduct.findUnique({ where: { id } });
        if (!before) throw new ApiError("NOT_FOUND");
        if (before.version !== version) throw staleVersion();
        if ((before.status === "ARCHIVED") === archived) {
          throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "transition" }]);
        }
        const res = await tx.globalProduct.updateMany({
          where: { id, version },
          data: {
            status: archived ? "ARCHIVED" : "ACTIVE",
            archivedAt: archived ? new Date() : null,
            version: { increment: 1 },
          },
        });
        if (res.count !== 1) throw staleVersion();
        await a.audit(tx, {
          action: archived ? "catalog.global_product_archived" : "catalog.global_product_restored",
          resourceType: "global_product",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: { brandId: before.brandId },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    return { product: await GlobalCatalogService.product(db, id) };
  }
}
