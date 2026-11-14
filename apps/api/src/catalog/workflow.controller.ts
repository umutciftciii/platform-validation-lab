/**
 * Routes of the product review and publication workflow (PM-3), under /api/v1/admin/catalog
 * (admin proxy key only), and the public product content of the sites under
 * /api/v1/public/catalog (the BV and Corporate proxy keys only; GET only). Every handler
 * authorises inside its service.
 */
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Res } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import type {
  ProductWorkflowResponse,
  PublicCrossReferenceListResponse,
  PublicDocumentListResponse,
  PublicCategoryListResponse,
  PublicProductListResponse,
  PublicProductResponse,
  ReviewQueueResponse,
} from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { PublicCatalogService } from "./public-catalog.service.js";
import { WorkflowService } from "./workflow.service.js";

@Controller("api/v1/admin/catalog")
export class WorkflowController {
  constructor(@Inject(WorkflowService) private readonly workflow: WorkflowService) {}

  @Get("review-queue")
  queue(@Ctx() ctx: RequestContext): Promise<ReviewQueueResponse> {
    return this.workflow.queue(ctx);
  }

  @Get("products/:id/workflow")
  get(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<ProductWorkflowResponse> {
    return this.workflow.workflow(ctx, id);
  }

  @Post("products/:id/submit")
  @HttpCode(200)
  submit(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.workflow.submit(ctx, id, body);
  }

  @Post("products/:id/withdraw")
  @HttpCode(200)
  withdraw(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.workflow.withdraw(ctx, id, body);
  }

  @Post("products/:id/approve")
  @HttpCode(200)
  approve(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.workflow.decide(ctx, id, body, "APPROVED");
  }

  @Post("products/:id/request-changes")
  @HttpCode(200)
  requestChanges(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.workflow.decide(ctx, id, body, "CHANGES_REQUESTED");
  }

  @Post("products/:id/publications/:siteId/publish")
  @HttpCode(200)
  publish(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ) {
    return this.workflow.publish(ctx, id, siteId, body);
  }

  @Post("products/:id/publications/:siteId/unpublish")
  @HttpCode(200)
  unpublish(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ) {
    return this.workflow.unpublish(ctx, id, siteId, body);
  }
}

@Controller("api/v1/public/catalog")
export class PublicCatalogController {
  constructor(@Inject(PublicCatalogService) private readonly catalog: PublicCatalogService) {}

  @Get("products")
  list(@Ctx() ctx: RequestContext): Promise<PublicProductListResponse> {
    return this.catalog.list(ctx);
  }

  /** DP-160: the category tree of the live products, with their counts. */
  @Get("categories")
  categories(@Ctx() ctx: RequestContext): Promise<PublicCategoryListResponse> {
    return this.catalog.categories(ctx);
  }

  @Get("products/:slug")
  product(@Ctx() ctx: RequestContext, @Param("slug") slug: string): Promise<PublicProductResponse> {
    return this.catalog.product(ctx, slug);
  }

  /** WebP bytes of a published image; short public caching, never the original upload. */
  @Get("images/:id/:variant")
  async image(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Param("variant") variant: string,
    @Res() res: ServerResponse,
  ): Promise<void> {
    const file = await this.catalog.image(ctx, id, variant);
    res.statusCode = 200;
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Length", String(file.data.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename="${variant}.webp"`);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.end(file.data);
  }

  /** PM-6: cross-references a live product shows on this site (names and relation level). */
  @Get("products/:slug/cross-references")
  crossReferences(
    @Ctx() ctx: RequestContext,
    @Param("slug") slug: string,
  ): Promise<PublicCrossReferenceListResponse> {
    return this.catalog.crossReferences(ctx, slug);
  }

  /** PM-5: documents a live product shows on this site (metadata; downloadable flag). */
  @Get("products/:slug/documents")
  documents(
    @Ctx() ctx: RequestContext,
    @Param("slug") slug: string,
  ): Promise<PublicDocumentListResponse> {
    return this.catalog.documents(ctx, slug);
  }

  /**
   * PM-5: the pinned revision of a PUBLIC document, as an attachment. DP-043: a LEAD_REQUIRED
   * document with the site server's download grant header, stamped for its recipient.
   */
  @Get("documents/:id/file")
  async documentFile(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Headers("x-dp-download-grant") grant: string | undefined,
    @Res() res: ServerResponse,
  ): Promise<void> {
    const file = await this.catalog.documentFile(ctx, id, grant);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(file.data.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.end(file.data);
  }
}
