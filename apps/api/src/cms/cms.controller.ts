/**
 * Routes of the CMS administration (S1, DP-015), under /api/v1/admin/cms. Only the admin proxy
 * key reaches them (security middleware); every handler authorises inside the service. Changes
 * use POST, the method the admin proxy forwards; a draft save replaces the whole draft and names
 * its version.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from "@nestjs/common";
import type { CmsContextResponse, CmsPageListResponse, CmsPageResponse } from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { CmsService } from "./cms.service.js";

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
  ): Promise<CmsPageListResponse> {
    return this.cms.listPages(ctx, siteId);
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
}
