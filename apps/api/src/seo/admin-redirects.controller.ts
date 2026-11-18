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
  SeoRedirectHistoryResponse,
  SeoRedirectImportResponse,
  SeoRedirectListResponse,
  SeoRedirectResponse,
} from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { AdminRedirectsService } from "./admin-redirects.service.js";

/**
 * DP-211: Admin > SEO > Redirects under /api/v1/admin/seo/sites/:siteId/redirects (admin proxy
 * key only; POST for every change, like the other admin routes).
 */
@Controller("api/v1/admin/seo/sites/:siteId/redirects")
export class AdminRedirectsController {
  constructor(@Inject(AdminRedirectsService) private readonly redirects: AdminRedirectsService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
    @Query() query: unknown,
  ): Promise<SeoRedirectListResponse> {
    return this.redirects.list(ctx, siteId, query);
  }

  @Post()
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  create(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ): Promise<SeoRedirectResponse> {
    return this.redirects.create(ctx, siteId, body);
  }

  /** CSV dry-run (`dryRun: true`) or import of the confirmed plan. */
  @Post("import")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  import(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ): Promise<SeoRedirectImportResponse> {
    return this.redirects.import(ctx, siteId, body);
  }

  @Post(":id")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  update(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<SeoRedirectResponse> {
    return this.redirects.update(ctx, siteId, id, body);
  }

  @Post(":id/delete")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  remove(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<{ deleted: true }> {
    return this.redirects.remove(ctx, siteId, id, body);
  }

  @Get(":id/history")
  @Header("Cache-Control", "no-store")
  history(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
    @Param("id") id: string,
  ): Promise<SeoRedirectHistoryResponse> {
    return this.redirects.history(ctx, siteId, id);
  }
}
