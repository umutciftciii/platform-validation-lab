/**
 * DP-287/DP-289 (ADR-030): `/api/v1/admin/ai/*`. Every route sits behind AiGateGuard (404 while
 * AI is off); each handler authorises again in its service. GET/POST/DELETE only (the admin proxy
 * forwards no other method); responses are never cached and never carry an API key.
 */
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
  Query,
  UseGuards,
} from "@nestjs/common";
import type {
  AiCredentialResult,
  AiCredentialSummary,
  AiModelRefreshResponse,
  AiModelSummary,
  AiModelsResponse,
  AiOverviewResponse,
  AiProviderSummary,
  AiProvidersResponse,
} from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { AiGateGuard } from "./ai-gate.guard.js";
import { AiService } from "./ai.service.js";
import { AiProvidersService } from "./providers.service.js";

@Controller("api/v1/admin/ai")
@UseGuards(AiGateGuard)
export class AiController {
  constructor(
    @Inject(AiService) private readonly ai: AiService,
    @Inject(AiProvidersService) private readonly providers: AiProvidersService,
  ) {}

  @Get("overview")
  @Header("Cache-Control", "no-store")
  overview(@Ctx() ctx: RequestContext): Promise<AiOverviewResponse> {
    return this.ai.overview(ctx);
  }

  // --- DP-289: providers and keys ---------------------------------------------------------------

  @Get("providers")
  @Header("Cache-Control", "no-store")
  listProviders(@Ctx() ctx: RequestContext): Promise<AiProvidersResponse> {
    return this.providers.providers(ctx);
  }

  @Post("providers/:provider/settings")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  updateProvider(
    @Ctx() ctx: RequestContext,
    @Param("provider") provider: string,
    @Body() body: unknown,
  ): Promise<AiProviderSummary> {
    return this.providers.updateProvider(ctx, provider, body);
  }

  @Post("providers/:provider/credentials")
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  addCredential(
    @Ctx() ctx: RequestContext,
    @Param("provider") provider: string,
    @Body() body: unknown,
  ): Promise<AiCredentialResult> {
    return this.providers.addCredential(ctx, provider, body);
  }

  @Post("credentials/:id/test")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  testCredential(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<AiCredentialResult> {
    return this.providers.testCredential(ctx, id, false);
  }

  @Post("credentials/:id/activate")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  activateCredential(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
  ): Promise<AiCredentialResult> {
    return this.providers.testCredential(ctx, id, true);
  }

  @Post("credentials/:id/disable")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  disableCredential(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
  ): Promise<AiCredentialSummary> {
    return this.providers.disableCredential(ctx, id);
  }

  @Delete("credentials/:id")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  revokeCredential(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
  ): Promise<AiCredentialSummary> {
    return this.providers.revokeCredential(ctx, id);
  }

  // --- DP-289: models ---------------------------------------------------------------------------

  @Get("models")
  @Header("Cache-Control", "no-store")
  listModels(
    @Ctx() ctx: RequestContext,
    @Query("provider") provider?: string,
  ): Promise<AiModelsResponse> {
    return this.providers.models(ctx, provider);
  }

  @Post("providers/:provider/models/refresh")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  refreshModels(
    @Ctx() ctx: RequestContext,
    @Param("provider") provider: string,
  ): Promise<AiModelRefreshResponse> {
    return this.providers.refreshModels(ctx, provider);
  }

  @Post("models/:id/verify")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  verifyModel(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<AiModelSummary> {
    return this.providers.verifyModel(ctx, id);
  }

  @Post("models/:id/enable")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  enableModel(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<AiModelSummary> {
    return this.providers.setModelEnabled(ctx, id, true, body);
  }

  @Post("models/:id/disable")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  disableModel(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<AiModelSummary> {
    return this.providers.setModelEnabled(ctx, id, false);
  }
}
