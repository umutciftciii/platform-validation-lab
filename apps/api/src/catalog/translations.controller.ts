/**
 * ML-8a (ADR-028 D8): routes of the catalogue texts per language, under /api/v1/admin/catalog
 * (contracts catalog-translations.ts). Changes use POST, the method the admin proxy forwards;
 * every handler authorises inside the service.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import type {
  CategoryTranslationResponse,
  ImageTranslationResponse,
  ListingTranslationResponse,
  ProductTranslationsResponse,
  SpecDefinitionTranslationResponse,
} from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { CatalogTranslationsService } from "./translations.service.js";

@Controller("api/v1/admin/catalog")
export class CatalogTranslationsController {
  constructor(
    @Inject(CatalogTranslationsService) private readonly texts: CatalogTranslationsService,
  ) {}

  @Get("products/:id/translations")
  product(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<ProductTranslationsResponse> {
    return this.texts.product(ctx, id, query);
  }

  @Post("products/:id/listings/:siteId/texts/:locale")
  @HttpCode(200)
  listing(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Param("siteId") siteId: string,
    @Param("locale") locale: string,
    @Body() body: unknown,
  ): Promise<ListingTranslationResponse> {
    return this.texts.saveListing(ctx, id, siteId, locale, body);
  }

  @Post("categories/:id/texts/:locale")
  @HttpCode(200)
  category(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Param("locale") locale: string,
    @Body() body: unknown,
  ): Promise<CategoryTranslationResponse> {
    return this.texts.saveCategory(ctx, id, locale, body);
  }

  @Post("spec-definitions/:id/texts/:locale")
  @HttpCode(200)
  definition(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Param("locale") locale: string,
    @Body() body: unknown,
  ): Promise<SpecDefinitionTranslationResponse> {
    return this.texts.saveDefinition(ctx, id, locale, body);
  }

  @Post("images/:imageId/texts/:locale")
  @HttpCode(200)
  image(
    @Ctx() ctx: RequestContext,
    @Param("imageId") id: string,
    @Param("locale") locale: string,
    @Body() body: unknown,
  ): Promise<ImageTranslationResponse> {
    return this.texts.saveImage(ctx, id, locale, body);
  }
}
