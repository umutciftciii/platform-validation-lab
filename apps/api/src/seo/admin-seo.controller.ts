import { Controller, Get, Header, Inject, Param, Query } from "@nestjs/common";
import type { SeoOverviewResponse } from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { AdminSeoService } from "./admin-seo.service.js";

/**
 * DP-209: the SEO section of the admin under /api/v1/admin/seo (admin proxy key only). Read only;
 * changes go through the existing CMS and catalogue routes.
 */
@Controller("api/v1/admin/seo")
export class AdminSeoController {
  constructor(@Inject(AdminSeoService) private readonly seo: AdminSeoService) {}

  @Get("sites/:siteId/overview")
  @Header("Cache-Control", "no-store")
  overview(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
    @Query("part") part: unknown,
  ): Promise<SeoOverviewResponse> {
    return this.seo.overview(ctx, siteId, part === "settings" ? "settings" : "all");
  }
}
