/**
 * ML-13a (DP-244): routes of the translation packages under /api/v1/admin/translation-packages
 * (contracts translation-packages.ts). The dry run and the import use POST, the method the admin
 * proxy forwards, with the larger JSON body limit of these two routes (security.middleware.ts);
 * every handler authorises inside the service.
 */
import { Body, Controller, Get, Header, HttpCode, Inject, Post, Query } from "@nestjs/common";
import type { TranslationImportReport, TranslationPackage } from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { TranslationPackagesService } from "./translation-packages.service.js";

@Controller("api/v1/admin/translation-packages")
export class TranslationPackagesController {
  constructor(
    @Inject(TranslationPackagesService) private readonly packages: TranslationPackagesService,
  ) {}

  @Get("export")
  @Header("Cache-Control", "no-store")
  exportPackage(
    @Ctx() ctx: RequestContext,
    @Query() query: Record<string, unknown>,
  ): Promise<TranslationPackage> {
    return this.packages.exportPackage(ctx, query);
  }

  @Post("dry-run")
  @HttpCode(200)
  dryRun(@Ctx() ctx: RequestContext, @Body() body: unknown): Promise<TranslationImportReport> {
    return this.packages.dryRun(ctx, body);
  }

  @Post("import")
  @HttpCode(200)
  importPackage(
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ): Promise<TranslationImportReport> {
    return this.packages.importPackage(ctx, body);
  }
}
