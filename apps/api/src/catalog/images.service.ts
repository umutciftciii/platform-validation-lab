/**
 * Product images (PM-2), attached to the platform-wide product master.
 *
 *  - Upload: the body is streamed with a 10 MB cap, checked (image-inspect.ts), the original and
 *    two WebP variants are written to the media storage under fresh random keys, then the row and
 *    its audit event are written in one transaction. If anything fails after a write, every key
 *    of this upload is deleted again (no orphans); a storage failure answers 503.
 *  - Read: the bytes come only through this API (private by default), to staff with
 *    `product:read` on any site, with a fixed Content-Type, `nosniff` and an inline disposition.
 *  - Changes (alt text, cover, order, delete) need `product_master:edit` (PLATFORM).
 *  - One cover per product (partial unique index): the first image becomes the cover; deleting
 *    the cover promotes the next image in gallery order.
 *  - PM-3: images are part of the reviewed content. Every change goes through changeMaster
 *    (version bump, editor recorded, review/approval reset). An image shown by a live
 *    publication cannot be deleted (database trigger, 409). Uploads pass the image processing
 *    gate (media/image-gate.ts): one decode at a time, a short queue, 429 beyond it.
 *  - Public copies are the derived WebP variants only: re-encoded by libvips, which writes no
 *    EXIF, XMP, IPTC or ICC metadata (GPS, camera, author); originals never leave the admin API.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import {
  IMAGE_MAX_BYTES,
  IMAGES_PER_PRODUCT_MAX,
  ImageCoverRequestSchema,
  ImageVisibilityRequestSchema,
  ImageOrderRequestSchema,
  ImageUpdateRequestSchema,
  UPLOAD_FILENAME_HEADER,
  type ImageVariant,
  type ProductImage,
} from "@dream/contracts";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import { FaultInjector } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";
import { MEDIA_STORAGE } from "../media/media.module.js";
import { newImageKeys, type ImageKeys, type MediaStorage } from "../media/storage.js";
import { ImageGateBusy, ImageProcessingGate } from "../media/image-gate.js";
import { mapDbError, staleVersion } from "./errors.js";
import { changeMaster } from "./master.js";
import { ImageRejected, inspectImage, sanitizeFilename } from "./image-inspect.js";
import { MASTER, PLATFORM, requireMasterRead, uuidOr404 } from "./specs.service.js";

interface VariantInfo {
  key: string;
  width: number;
  height: number;
  bytes: number;
}

interface ImageRow {
  id: string;
  productId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
  originalFilename: string;
  altText: string | null;
  sortOrder: number;
  isCover: boolean;
  isPublic: boolean;
  variants: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function toImage(r: ImageRow): ProductImage {
  return {
    id: r.id,
    productId: r.productId,
    mimeType: r.mimeType as ProductImage["mimeType"],
    byteSize: r.byteSize,
    width: r.width,
    height: r.height,
    sha256: r.sha256,
    originalFilename: r.originalFilename,
    altText: r.altText,
    sortOrder: r.sortOrder,
    isCover: r.isCover,
    isPublic: r.isPublic,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function variantsOf(r: ImageRow): Partial<Record<"display" | "thumb", VariantInfo>> {
  const v = r.variants as Record<string, VariantInfo> | null;
  return v && typeof v === "object" ? v : {};
}

const REJECTED_STATUS: Record<string, "UNSUPPORTED_MEDIA_TYPE" | "VALIDATION_FAILED"> = {
  unsupported_type: "UNSUPPORTED_MEDIA_TYPE",
  type_mismatch: "UNSUPPORTED_MEDIA_TYPE",
  too_small: "VALIDATION_FAILED",
  too_many_pixels: "VALIDATION_FAILED",
  corrupt: "VALIDATION_FAILED",
};

/** Reads at most `max` bytes of a request body; more is 413. */
export async function readLimited(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > max) {
      req.resume();
      throw new ApiError("PAYLOAD_TOO_LARGE");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, size);
}

/** Content-Disposition with an ASCII fallback and the UTF-8 name (RFC 6266). */
export function inlineDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

@Injectable()
export class ImagesService {
  private readonly log = new Logger("ProductImages");

  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(FaultInjector) private readonly faults: FaultInjector,
    @Inject(ImageProcessingGate) private readonly gate: ImageProcessingGate,
  ) {}

  private static db(a: StaffAccess) {
    return a.db({ siteIds: [], includePlatform: true });
  }

  private storageError(op: string, e: unknown): ApiError {
    this.log.warn(`media storage ${op} failed (${(e as Error).name})`);
    return new ApiError("STORAGE_UNAVAILABLE");
  }

  /** Best-effort removal of every key of one image (orphan clean-up); failures are logged. */
  private async removeKeys(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch (e) {
        this.log.warn(`media orphan left behind, delete failed (${(e as Error).name})`);
      }
    }
  }

  async list(ctx: RequestContext, rawProductId: string): Promise<{ items: ProductImage[] }> {
    const a = await this.access.begin(ctx);
    const productId = uuidOr404(rawProductId);
    await requireMasterRead(a, { type: "product", id: productId });
    const db = ImagesService.db(a);
    if (!(await db.product.findUnique({ where: { id: productId }, select: { id: true } }))) {
      throw new ApiError("NOT_FOUND");
    }
    const rows = await db.productImage.findMany({
      where: { productId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return { items: rows.map(toImage) };
  }

  async upload(
    ctx: RequestContext,
    rawProductId: string,
    req: IncomingMessage,
  ): Promise<{ image: ProductImage }> {
    const a = await this.access.begin(ctx);
    const productId = uuidOr404(rawProductId);
    await a.require(MASTER, PLATFORM, { type: "product_image", id: productId });
    const db = ImagesService.db(a);
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { status: true, _count: { select: { images: true } } },
    });
    if (!product) {
      req.resume();
      throw new ApiError("NOT_FOUND");
    }
    if (product.status === "ARCHIVED") {
      req.resume();
      throw new ApiError("CONFLICT_STATE", [{ path: "status", rule: "archived" }]);
    }
    if (product._count.images >= IMAGES_PER_PRODUCT_MAX) {
      req.resume();
      throw new ApiError("CONFLICT_STATE", [{ path: "(root)", rule: "too_many_images" }]);
    }
    let data: Buffer;
    let inspected: Awaited<ReturnType<typeof inspectImage>>;
    try {
      // The body is read only once a processing slot is free (memory bound, image-gate.ts).
      ({ data, inspected } = await this.gate.run(async () => {
        const body = await readLimited(req, IMAGE_MAX_BYTES);
        if (body.length === 0) {
          throw new ApiError("VALIDATION_FAILED", [{ path: "file", rule: "empty" }]);
        }
        return {
          data: body,
          inspected: await inspectImage(body, String(req.headers["content-type"] ?? "")),
        };
      }));
    } catch (e) {
      if (e instanceof ImageGateBusy) {
        req.resume();
        throw new ApiError("RATE_LIMITED", [{ path: "file", rule: "busy" }]);
      }
      if (e instanceof ImageRejected) {
        throw new ApiError(REJECTED_STATUS[e.reason] ?? "VALIDATION_FAILED", [
          { path: "file", rule: e.reason },
        ]);
      }
      throw e;
    }
    const rawName = req.headers[UPLOAD_FILENAME_HEADER];
    const filename = sanitizeFilename(Array.isArray(rawName) ? rawName[0] : rawName);
    const keys: ImageKeys = newImageKeys();
    const written: string[] = [];
    try {
      await this.storage.put(keys.original, data, inspected.mimeType);
      written.push(keys.original);
      this.faults.check("media.put.display");
      await this.storage.put(keys.display, inspected.display.data, "image/webp");
      written.push(keys.display);
      await this.storage.put(keys.thumb, inspected.thumb.data, "image/webp");
      written.push(keys.thumb);
    } catch (e) {
      await this.removeKeys(
        [...written, keys.display, keys.thumb].filter((k, i, all) => all.indexOf(k) === i),
      );
      throw this.storageError("write", e);
    }
    try {
      this.faults.check("media.db.insert");
      const row = await db.$transaction(async (tx) => {
        await changeMaster(tx, a, productId, { cause: "image_uploaded" });
        const count = await tx.productImage.count({ where: { productId } });
        const last = await tx.productImage.findFirst({
          where: { productId },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        });
        const created = await tx.productImage.create({
          data: {
            productId,
            storageKey: keys.original,
            mimeType: inspected.mimeType,
            byteSize: data.length,
            width: inspected.width,
            height: inspected.height,
            sha256: inspected.sha256,
            originalFilename: filename,
            sortOrder: (last?.sortOrder ?? -1) + 1,
            isCover: count === 0,
            variants: {
              display: {
                key: keys.display,
                width: inspected.display.width,
                height: inspected.display.height,
                bytes: inspected.display.data.length,
              },
              thumb: {
                key: keys.thumb,
                width: inspected.thumb.width,
                height: inspected.thumb.height,
                bytes: inspected.thumb.data.length,
              },
            },
          },
        });
        await a.audit(tx, {
          action: "catalog.image_uploaded",
          resourceType: "product_image",
          resourceId: created.id,
          siteId: null,
          permission: MASTER,
          metadata: {
            productId,
            mimeType: created.mimeType,
            byteSize: created.byteSize,
            width: created.width,
            height: created.height,
            sha256: created.sha256,
            isCover: created.isCover,
          },
        });
        return created;
      });
      return { image: toImage(row) };
    } catch (e) {
      await this.removeKeys(written);
      return mapDbError(e);
    }
  }

  async file(
    ctx: RequestContext,
    rawImageId: string,
    variant: string,
  ): Promise<{ data: Buffer; contentType: string; filename: string }> {
    const a = await this.access.begin(ctx);
    const id = uuidOr404(rawImageId);
    await requireMasterRead(a, { type: "product_image", id });
    if (!(["original", "display", "thumb"] as readonly string[]).includes(variant)) {
      throw new ApiError("NOT_FOUND");
    }
    const row = await ImagesService.db(a).productImage.findUnique({ where: { id } });
    if (!row) throw new ApiError("NOT_FOUND");
    const v = variant as ImageVariant;
    const key = v === "original" ? row.storageKey : variantsOf(row)[v]?.key;
    if (!key) throw new ApiError("NOT_FOUND");
    let data: Buffer | null;
    try {
      data = await this.storage.get(key);
    } catch (e) {
      throw this.storageError("read", e);
    }
    if (!data) {
      this.log.warn("media object missing for an existing image row");
      throw new ApiError("NOT_FOUND");
    }
    const base = row.originalFilename.replace(/\.[^.]*$/, "");
    return {
      data,
      contentType: v === "original" ? row.mimeType : "image/webp",
      filename: v === "original" ? row.originalFilename : `${base}-${v}.webp`,
    };
  }

  /** Loads an image for a change; out of reach and unknown look the same (404). */
  private static async editable(a: StaffAccess, rawId: string) {
    const id = uuidOr404(rawId);
    await a.require(MASTER, PLATFORM, { type: "product_image", id });
    return { id, db: ImagesService.db(a) };
  }

  async update(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<{ image: ProductImage }> {
    const a = await this.access.begin(ctx);
    const { id, db } = await ImagesService.editable(a, rawId);
    const { altText, version } = parseBody(ImageUpdateRequestSchema, body);
    try {
      const row = await db.$transaction(async (tx) => {
        const before = await tx.productImage.findUnique({ where: { id } });
        if (!before) throw new ApiError("NOT_FOUND");
        if (before.version !== version) throw staleVersion();
        if (before.altText !== altText) {
          await changeMaster(tx, a, before.productId, { cause: "image_updated" });
        }
        const res = await tx.productImage.updateMany({
          where: { id, version },
          data: { altText, version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleVersion();
        await a.audit(tx, {
          action: "catalog.image_updated",
          resourceType: "product_image",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: {
            productId: before.productId,
            changed: before.altText === altText ? [] : ["altText"],
          },
        });
        return tx.productImage.findUniqueOrThrow({ where: { id } });
      });
      return { image: toImage(row) };
    } catch (e) {
      return mapDbError(e);
    }
  }

  async setCover(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<{ items: ProductImage[] }> {
    const a = await this.access.begin(ctx);
    const { id, db } = await ImagesService.editable(a, rawId);
    const { version } = parseBody(ImageCoverRequestSchema, body);
    try {
      const productId = await db.$transaction(async (tx) => {
        const row = await tx.productImage.findUnique({ where: { id } });
        if (!row) throw new ApiError("NOT_FOUND");
        if (row.version !== version) throw staleVersion();
        if (row.isCover) return row.productId;
        // DP-166: the cover is what visitors see first; a hidden image must be shown first.
        if (!row.isPublic) {
          throw new ApiError("CONFLICT_STATE", [{ path: "isPublic", rule: "hidden_image" }]);
        }
        await changeMaster(tx, a, row.productId, { cause: "image_cover_set" });
        const previous = await tx.productImage.findFirst({
          where: { productId: row.productId, isCover: true },
          select: { id: true },
        });
        await tx.productImage.updateMany({
          where: { productId: row.productId, isCover: true },
          data: { isCover: false, version: { increment: 1 } },
        });
        const res = await tx.productImage.updateMany({
          where: { id, version },
          data: { isCover: true, version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleVersion();
        await a.audit(tx, {
          action: "catalog.image_cover_set",
          resourceType: "product_image",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: { productId: row.productId, previousCoverId: previous?.id ?? null },
        });
        return row.productId;
      });
      return this.listAfterChange(db, productId);
    } catch (e) {
      return mapDbError(e);
    }
  }

  /**
   * DP-166: show or hide an image on the sites. Hidden images stay here (list, file, alt text)
   * and are left out of the next publication; live snapshots do not change until a new approval
   * and publication. Like every image change it is part of the reviewed content (changeMaster).
   * The cover cannot be hidden. Showing it again is the rollback.
   */
  async setVisibility(
    ctx: RequestContext,
    rawId: string,
    body: unknown,
  ): Promise<{ items: ProductImage[] }> {
    const a = await this.access.begin(ctx);
    const { id, db } = await ImagesService.editable(a, rawId);
    const { isPublic, version } = parseBody(ImageVisibilityRequestSchema, body);
    try {
      const productId = await db.$transaction(async (tx) => {
        const row = await tx.productImage.findUnique({ where: { id } });
        if (!row) throw new ApiError("NOT_FOUND");
        if (row.version !== version) throw staleVersion();
        if (row.isPublic === isPublic) return row.productId;
        if (!isPublic && row.isCover) {
          throw new ApiError("CONFLICT_STATE", [
            { path: "isPublic", rule: "cover_cannot_be_hidden" },
          ]);
        }
        await changeMaster(tx, a, row.productId, { cause: "image_visibility_set" });
        const res = await tx.productImage.updateMany({
          where: { id, version },
          data: { isPublic, version: { increment: 1 } },
        });
        if (res.count !== 1) throw staleVersion();
        await a.audit(tx, {
          action: "catalog.image_visibility_set",
          resourceType: "product_image",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: { productId: row.productId, isPublic },
        });
        return row.productId;
      });
      return this.listAfterChange(db, productId);
    } catch (e) {
      return mapDbError(e);
    }
  }

  async reorder(
    ctx: RequestContext,
    rawProductId: string,
    body: unknown,
  ): Promise<{ items: ProductImage[] }> {
    const a = await this.access.begin(ctx);
    const productId = uuidOr404(rawProductId);
    await a.require(MASTER, PLATFORM, { type: "product_image", id: productId });
    const { imageIds } = parseBody(ImageOrderRequestSchema, body);
    const db = ImagesService.db(a);
    try {
      await db.$transaction(async (tx) => {
        const rows = await tx.productImage.findMany({ where: { productId }, select: { id: true } });
        if (rows.length === 0 && !(await tx.product.findUnique({ where: { id: productId } }))) {
          throw new ApiError("NOT_FOUND");
        }
        const current = new Set(rows.map((r) => r.id));
        const wanted = imageIds.map((i) => i.toLowerCase());
        if (
          new Set(wanted).size !== wanted.length ||
          wanted.length !== current.size ||
          wanted.some((i) => !current.has(i))
        ) {
          // Another product's image, a missing one or a duplicate: the list must be exactly this
          // product's gallery (IDOR guard; a concurrent upload or delete also lands here).
          throw new ApiError("CONFLICT_STATE", [{ path: "imageIds", rule: "not_the_gallery" }]);
        }
        await changeMaster(tx, a, productId, { cause: "images_reordered" });
        for (const [index, imageId] of wanted.entries()) {
          await tx.productImage.updateMany({
            where: { id: imageId, productId },
            data: { sortOrder: index },
          });
        }
        await a.audit(tx, {
          action: "catalog.images_reordered",
          resourceType: "product",
          resourceId: productId,
          siteId: null,
          permission: MASTER,
          metadata: { count: wanted.length },
        });
      });
      return this.listAfterChange(db, productId);
    } catch (e) {
      return mapDbError(e);
    }
  }

  async remove(ctx: RequestContext, rawId: string): Promise<void> {
    const a = await this.access.begin(ctx);
    const { id, db } = await ImagesService.editable(a, rawId);
    let keys: string[] = [];
    try {
      await db.$transaction(async (tx) => {
        const row = await tx.productImage.findUnique({ where: { id } });
        if (!row) throw new ApiError("NOT_FOUND");
        keys = [row.storageKey, ...Object.values(variantsOf(row)).map((v) => v.key)];
        await changeMaster(tx, a, row.productId, { cause: "image_deleted" });
        await tx.productImage.deleteMany({ where: { id } });
        let promoted: string | null = null;
        if (row.isCover) {
          const next = await tx.productImage.findFirst({
            where: { productId: row.productId, isPublic: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: { id: true },
          });
          if (next) {
            await tx.productImage.updateMany({
              where: { id: next.id },
              data: { isCover: true, version: { increment: 1 } },
            });
            promoted = next.id;
          }
        }
        await a.audit(tx, {
          action: "catalog.image_deleted",
          resourceType: "product_image",
          resourceId: id,
          siteId: null,
          permission: MASTER,
          metadata: {
            productId: row.productId,
            sha256: row.sha256,
            wasCover: row.isCover,
            promoted,
          },
        });
      });
    } catch (e) {
      mapDbError(e);
    }
    // After the commit: a failed file delete leaves an orphan file (logged), never a broken row.
    await this.removeKeys(keys);
  }

  private async listAfterChange(
    db: ReturnType<StaffAccess["db"]>,
    productId: string,
  ): Promise<{ items: ProductImage[] }> {
    const rows = await db.productImage.findMany({
      where: { productId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return { items: rows.map(toImage) };
  }
}
