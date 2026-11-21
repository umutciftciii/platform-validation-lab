/**
 * DP-173 (ADR-022 D5): routes of the company catalogue preview.
 *
 *  - Admin (admin proxy key): POST /api/v1/admin/catalog/sites/:siteId/preview-link issues a
 *    short-lived signed link (product_proposal:review on the site, audited).
 *  - Public (the BV proxy key; GET only): /api/v1/public/catalog-preview/:token/... answers only
 *    for a valid link whose issuing session is still live with the review permission
 *    (preview.service.ts). Never cached, never indexed; no documents, forms or writes. ML-8b:
 *    `?locale=` names an enabled language (default: the site's default language).
 */
import { Controller, Get, Header, HttpCode, Inject, Param, Post, Query, Res } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import type {
  CatalogPreviewLinkResponse,
  CatalogPreviewListResponse,
  CatalogPreviewProductResponse,
} from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { CatalogPreviewService } from "./preview.service.js";

const NOINDEX = "noindex, nofollow, noarchive";

@Controller("api/v1/admin/catalog")
export class CatalogPreviewLinkController {
  constructor(@Inject(CatalogPreviewService) private readonly preview: CatalogPreviewService) {}

  @Post("sites/:siteId/preview-link")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  link(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
  ): Promise<CatalogPreviewLinkResponse> {
    return this.preview.link(ctx, siteId);
  }
}

@Controller("api/v1/public/catalog-preview")
export class PublicCatalogPreviewController {
  constructor(@Inject(CatalogPreviewService) private readonly preview: CatalogPreviewService) {}

  @Get(":token/products")
  @Header("Cache-Control", "no-store")
  @Header("X-Robots-Tag", NOINDEX)
  list(
    @Ctx() ctx: RequestContext,
    @Param("token") token: string,
    @Query() query: Record<string, unknown>,
  ): Promise<CatalogPreviewListResponse> {
    return this.preview.list(ctx, token, query);
  }

  @Get(":token/products/:slug")
  @Header("Cache-Control", "no-store")
  @Header("X-Robots-Tag", NOINDEX)
  product(
    @Ctx() ctx: RequestContext,
    @Param("token") token: string,
    @Param("slug") slug: string,
    @Query() query: Record<string, unknown>,
  ): Promise<CatalogPreviewProductResponse> {
    return this.preview.product(ctx, token, slug, query);
  }

  /** WebP bytes of a public image variant of a listed product; never cached. */
  @Get(":token/images/:id/:variant")
  async image(
    @Ctx() ctx: RequestContext,
    @Param("token") token: string,
    @Param("id") id: string,
    @Param("variant") variant: string,
    @Res() res: ServerResponse,
  ): Promise<void> {
    const file = await this.preview.image(ctx, token, id, variant);
    res.statusCode = 200;
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Length", String(file.data.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename="${variant}.webp"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", NOINDEX);
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.end(file.data);
  }
}
