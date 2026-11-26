import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
} from "@nestjs/common";
import type {
  LegalTextHistoryResponse,
  LegalTextVersionResponse,
  LegalTextsOverview,
  PublicLegalTextsResponse,
} from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { LegalTextsService } from "./legal-texts.service.js";

/** DP-298 (ADR-031 D1): the admin "Legal texts" screen (legal_text:edit / legal_text:publish). */
@Controller("api/v1/admin/legal-texts")
export class AdminLegalTextsController {
  constructor(@Inject(LegalTextsService) private readonly texts: LegalTextsService) {}

  @Get()
  overview(@Ctx() ctx: RequestContext): Promise<LegalTextsOverview> {
    return this.texts.overview(ctx);
  }

  @Get("documents/:key/:locale")
  history(
    @Ctx() ctx: RequestContext,
    @Param("key") key: string,
    @Param("locale") locale: string,
  ): Promise<LegalTextHistoryResponse> {
    return this.texts.history(ctx, key, locale);
  }

  @Get("versions/:id")
  get(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<LegalTextVersionResponse> {
    return this.texts.get(ctx, id);
  }

  @Post("drafts")
  @HttpCode(201)
  create(@Ctx() ctx: RequestContext, @Body() body: unknown): Promise<LegalTextVersionResponse> {
    return this.texts.createDraft(ctx, body);
  }

  /** POST, like every other admin change (the admin proxy forwards GET, POST and DELETE only). */
  @Post("drafts/:id")
  @HttpCode(200)
  update(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<LegalTextVersionResponse> {
    return this.texts.updateDraft(ctx, id, body);
  }

  @Delete("drafts/:id")
  @HttpCode(204)
  remove(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<void> {
    return this.texts.deleteDraft(ctx, id);
  }

  @Post("versions/:id/publish")
  @HttpCode(200)
  publish(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<LegalTextVersionResponse> {
    return this.texts.publish(ctx, id, body);
  }

  @Post("versions/:id/legal-review")
  @HttpCode(200)
  review(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<LegalTextVersionResponse> {
    return this.texts.approveReview(ctx, id, body);
  }
}

/** DP-298: the published texts the sites render and check (proxy key; never cached). */
@Controller("api/v1/public/legal-texts")
export class PublicLegalTextsController {
  constructor(@Inject(LegalTextsService) private readonly texts: LegalTextsService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  snapshot(@Ctx() ctx: RequestContext): Promise<PublicLegalTextsResponse> {
    return this.texts.publicSnapshot(ctx);
  }
}
