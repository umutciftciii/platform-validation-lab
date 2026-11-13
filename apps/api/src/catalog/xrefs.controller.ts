/**
 * Routes of global brands, global products and product cross-references (PM-6, DP-036), under
 * /api/v1/admin/catalog. Only the admin proxy key reaches them. Changes use POST (the methods
 * the admin proxy forwards); every change names the version it was based on.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { GlobalCatalogService } from "./global-catalog.service.js";
import { CrossReferencesService } from "./xrefs.service.js";

@Controller("api/v1/admin/catalog")
export class CrossReferencesController {
  constructor(
    @Inject(GlobalCatalogService) private readonly global: GlobalCatalogService,
    @Inject(CrossReferencesService) private readonly xrefs: CrossReferencesService,
  ) {}

  // --- global brands -------------------------------------------------------------------------

  @Get("global-brands")
  brands(@Ctx() ctx: RequestContext, @Query() query: Record<string, unknown>) {
    return this.global.listBrands(ctx, query);
  }

  @Post("global-brands")
  @HttpCode(201)
  createBrand(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.global.createBrand(ctx, body);
  }

  @Post("global-brands/:id")
  @HttpCode(200)
  updateBrand(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.global.updateBrand(ctx, id, body);
  }

  @Post("global-brands/:id/archive")
  @HttpCode(200)
  archiveBrand(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.global.setBrandArchived(ctx, id, body, true);
  }

  @Post("global-brands/:id/restore")
  @HttpCode(200)
  restoreBrand(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.global.setBrandArchived(ctx, id, body, false);
  }

  @Post("global-brands/:id/products")
  @HttpCode(201)
  createGlobalProduct(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.global.createProduct(ctx, id, body);
  }

  // --- global products -----------------------------------------------------------------------

  @Get("global-products")
  globalProducts(@Ctx() ctx: RequestContext, @Query() query: Record<string, unknown>) {
    return this.global.listProducts(ctx, query);
  }

  @Post("global-products/:id")
  @HttpCode(200)
  updateGlobalProduct(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.global.updateProduct(ctx, id, body);
  }

  @Post("global-products/:id/archive")
  @HttpCode(200)
  archiveGlobalProduct(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.global.setProductArchived(ctx, id, body, true);
  }

  @Post("global-products/:id/restore")
  @HttpCode(200)
  restoreGlobalProduct(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.global.setProductArchived(ctx, id, body, false);
  }

  // --- cross-references ----------------------------------------------------------------------

  @Get("products/:id/cross-references")
  list(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.xrefs.list(ctx, id);
  }

  @Post("products/:id/cross-references")
  @HttpCode(201)
  create(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.xrefs.create(ctx, id, body);
  }

  @Post("cross-references/:id")
  @HttpCode(200)
  update(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.xrefs.update(ctx, id, body);
  }

  @Post("cross-references/:id/request-verification")
  @HttpCode(200)
  request(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.xrefs.requestVerification(ctx, id, body);
  }

  @Post("cross-references/:id/verify")
  @HttpCode(200)
  verify(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.xrefs.decide(ctx, id, body, "VERIFIED");
  }

  @Post("cross-references/:id/reject")
  @HttpCode(200)
  reject(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.xrefs.decide(ctx, id, body, "REJECTED");
  }

  @Post("cross-references/:id/mark-similar")
  @HttpCode(200)
  markSimilar(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.xrefs.markSimilar(ctx, id, body);
  }

  @Post("cross-references/:id/remove")
  @HttpCode(200)
  remove(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.xrefs.remove(ctx, id, body);
  }

  @Post("cross-references/:id/restore")
  @HttpCode(200)
  restore(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.xrefs.restore(ctx, id, body);
  }

  @Post("cross-references/:id/sites/:siteId")
  @HttpCode(200)
  setSite(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ) {
    return this.xrefs.setSite(ctx, id, siteId, body);
  }
}
