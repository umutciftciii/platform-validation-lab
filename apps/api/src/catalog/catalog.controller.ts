/**
 * Routes of the product catalogue administration (PM-1), under /api/v1/admin/catalog. Only the
 * admin proxy key reaches them (security middleware); every handler authorises inside the
 * service. Changes use POST (and DELETE for an empty category), the methods the admin proxy
 * forwards; updates replace the editable record and carry its version.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import type {
  CatalogContextResponse,
  CategoryListResponse,
  CategoryResponse,
  ListingResponse,
  ProductDetailResponse,
  ProductListResponse,
} from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { CatalogService } from "./catalog.service.js";

@Controller("api/v1/admin/catalog")
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get("context")
  context(@Ctx() ctx: RequestContext): Promise<CatalogContextResponse> {
    return this.catalog.context(ctx);
  }

  @Get("products")
  listProducts(
    @Ctx() ctx: RequestContext,
    @Query() query: Record<string, unknown>,
  ): Promise<ProductListResponse> {
    return this.catalog.listProducts(ctx, query);
  }

  @Post("products")
  @HttpCode(201)
  createProduct(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.catalog.createProduct(ctx, body);
  }

  @Get("products/:id")
  getProduct(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Query("siteId") siteId: unknown,
  ): Promise<ProductDetailResponse> {
    return this.catalog.getProduct(ctx, id, siteId);
  }

  @Post("products/:id")
  @HttpCode(200)
  updateProduct(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.catalog.updateProduct(ctx, id, body);
  }

  @Post("products/:id/archive")
  @HttpCode(200)
  archive(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.catalog.setProductArchived(ctx, id, body, true);
  }

  @Post("products/:id/restore")
  @HttpCode(200)
  restore(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.catalog.setProductArchived(ctx, id, body, false);
  }

  @Post("products/:id/listings/:siteId")
  @HttpCode(200)
  upsertListing(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ): Promise<ListingResponse> {
    return this.catalog.upsertListing(ctx, id, siteId, body);
  }

  @Get("sites/:siteId/categories")
  listCategories(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
  ): Promise<CategoryListResponse> {
    return this.catalog.listCategories(ctx, siteId);
  }

  @Post("sites/:siteId/categories")
  @HttpCode(201)
  createCategory(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ): Promise<CategoryResponse> {
    return this.catalog.createCategory(ctx, siteId, body);
  }

  @Post("categories/:id")
  @HttpCode(200)
  updateCategory(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<CategoryResponse> {
    return this.catalog.updateCategory(ctx, id, body);
  }

  @Post("categories/:id/default")
  @HttpCode(200)
  setDefault(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<CategoryResponse> {
    return this.catalog.setDefaultCategory(ctx, id, body);
  }

  @Delete("categories/:id")
  @HttpCode(204)
  async deleteCategory(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<void> {
    await this.catalog.deleteCategory(ctx, id);
  }
}
