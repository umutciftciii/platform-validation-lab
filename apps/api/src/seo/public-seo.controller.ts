import { Controller, Get, Header, Inject, Query } from "@nestjs/common";
import type { PublicSeoResolveResponse, PublicSitemapResponse } from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { PublicSeoService } from "./public-seo.service.js";

/**
 * DP-207: technical SEO reads under /api/v1/public/seo (the site proxy keys only, GET only; the
 * site comes from the key). Not cached by intermediaries: a publication change shows at once.
 */
@Controller("api/v1/public/seo")
export class PublicSeoController {
  constructor(@Inject(PublicSeoService) private readonly seo: PublicSeoService) {}

  /** Whether an address has live content (200) or not (404, `unpublished` when taken off). */
  @Get("resolve")
  @Header("Cache-Control", "no-store")
  resolve(
    @Ctx() ctx: RequestContext,
    @Query("path") path: unknown,
  ): Promise<PublicSeoResolveResponse> {
    return this.seo.resolve(ctx, path);
  }

  /** The indexable live addresses of the site (sitemap.xml). */
  @Get("sitemap")
  @Header("Cache-Control", "no-store")
  sitemap(@Ctx() ctx: RequestContext): Promise<PublicSitemapResponse> {
    return this.seo.sitemap(ctx);
  }
}
