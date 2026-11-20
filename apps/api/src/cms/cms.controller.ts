/**
 * Routes of the CMS administration (S1, DP-015), under /api/v1/admin/cms. Only the admin proxy
 * key reaches them (security middleware); every handler authorises inside the service. Changes
 * use POST, the method the admin proxy forwards; a draft save replaces the whole draft and names
 * its version.
 */
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import type {
  CmsContextResponse,
  CmsHistoryResponse,
  CmsImportResponse,
  CmsMenuTargetsResponse,
  CmsPageListResponse,
  CmsPageResponse,
  CmsPreviewResponse,
  CmsPublicBundle,
  CmsPublicNews,
  PublicSiteLocalesResponse,
} from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { CmsService } from "./cms.service.js";
import { PublicCmsService } from "./public-cms.service.js";

@Controller("api/v1/admin/cms")
export class CmsController {
  constructor(@Inject(CmsService) private readonly cms: CmsService) {}

  @Get("context")
  context(@Ctx() ctx: RequestContext): Promise<CmsContextResponse> {
    return this.cms.context(ctx);
  }

  @Get("sites/:siteId/pages")
  listPages(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
    @Query("locale") locale: unknown,
  ): Promise<CmsPageListResponse> {
    return this.cms.listPages(ctx, siteId, locale);
  }

  /** DP-219: the pages, products and categories a menu of the site may link to. */
  @Get("sites/:siteId/menu-targets")
  menuTargets(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
  ): Promise<CmsMenuTargetsResponse> {
    return this.cms.menuTargets(ctx, siteId);
  }

  @Post("sites/:siteId/pages")
  @HttpCode(201)
  createPage(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ): Promise<CmsPageResponse> {
    return this.cms.createPage(ctx, siteId, body);
  }

  @Get("pages/:id")
  getPage(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<CmsPageResponse> {
    return this.cms.getPage(ctx, id);
  }

  @Post("pages/:id/draft")
  @HttpCode(200)
  saveDraft(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<CmsPageResponse> {
    return this.cms.saveDraft(ctx, id, body);
  }

  @Post("sites/:siteId/import")
  @HttpCode(200)
  importPage(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ): Promise<CmsImportResponse> {
    return this.cms.importPage(ctx, siteId, body);
  }

  @Post("pages/:id/preview")
  @HttpCode(200)
  preview(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<CmsPreviewResponse> {
    return this.cms.preview(ctx, id);
  }

  @Post("pages/:id/publish")
  @HttpCode(200)
  publish(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<CmsPageResponse> {
    return this.cms.publish(ctx, id, body);
  }

  /** ML-2 (DP-074): creates the page in another language of its site (empty texts, a draft). */
  @Post("pages/:id/translations")
  @HttpCode(201)
  createTranslation(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<CmsPageResponse> {
    return this.cms.createTranslation(ctx, id, body);
  }

  /** ML-2 (DP-074): the source revision a translation matches now (clears "outdated"). */
  @Post("pages/:id/translation-source")
  @HttpCode(200)
  setTranslationSource(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<CmsPageResponse> {
    return this.cms.setTranslationSource(ctx, id, body);
  }

  @Get("pages/:id/history")
  history(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<CmsHistoryResponse> {
    return this.cms.history(ctx, id);
  }

  @Post("pages/:id/restore")
  @HttpCode(200)
  restore(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<CmsPageResponse> {
    return this.cms.restore(ctx, id, body);
  }

  @Post("pages/:id/unpublish")
  @HttpCode(200)
  unpublish(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<CmsPageResponse> {
    return this.cms.unpublish(ctx, id, body);
  }
}

/**
 * Public CMS content (S2) under /api/v1/public/cms: only the site proxy keys reach it, and the
 * site comes from the key. Responses are not cached by intermediaries: a publication change must
 * show on the next request.
 */
@Controller("api/v1/public/cms")
export class PublicCmsController {
  constructor(@Inject(PublicCmsService) private readonly cms: PublicCmsService) {}

  /** ML-1 (DP-073): the public languages of the site (default first). */
  @Get("locales")
  @Header("Cache-Control", "no-store")
  locales(@Ctx() ctx: RequestContext): Promise<PublicSiteLocalesResponse> {
    return this.cms.locales(ctx);
  }

  /** ML-2: `locale` (default: the site's default language); a language that is not public is 404. */
  @Get("page")
  @Header("Cache-Control", "no-store")
  page(
    @Ctx() ctx: RequestContext,
    @Query("path") path: unknown,
    @Query("locale") locale: unknown,
  ): Promise<CmsPublicBundle> {
    return this.cms.page(ctx, path, locale);
  }

  /** DP-020: the published news articles, newest first (ML-2: per `locale`). */
  @Get("news")
  @Header("Cache-Control", "no-store")
  news(@Ctx() ctx: RequestContext, @Query("locale") locale: unknown): Promise<CmsPublicNews> {
    return this.cms.news(ctx, locale);
  }

  @Get("preview/:token")
  @Header("Cache-Control", "no-store")
  preview(@Ctx() ctx: RequestContext, @Param("token") token: string): Promise<CmsPublicBundle> {
    return this.cms.preview(ctx, token);
  }
}
