/**
 * DP-287…DP-291 (ADR-030): `/api/v1/admin/ai/*`. Every route sits behind AiGateGuard (404 while
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
  AiBudget,
  AiBudgetsResponse,
  AiOperationsResponse,
  AiOperationCancelResponse,
  AiOperationCreated,
  AiOperationDetail,
  AiPrice,
  AiPricesResponse,
  AiReconciliationResponse,
  AiSettingsDto,
  AiTaskSettingDto,
  AiTasksResponse,
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
import { AiBudgetsService } from "./budgets.service.js";
import { AiOperationsService } from "./operations.service.js";

@Controller("api/v1/admin/ai")
@UseGuards(AiGateGuard)
export class AiController {
  constructor(
    @Inject(AiService) private readonly ai: AiService,
    @Inject(AiProvidersService) private readonly providers: AiProvidersService,
    @Inject(AiBudgetsService) private readonly budgets: AiBudgetsService,
    @Inject(AiOperationsService) private readonly operations: AiOperationsService,
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

  // --- DP-290: settings, prices, tasks, budgets, usage, reconciliation --------------------------

  @Get("settings")
  @Header("Cache-Control", "no-store")
  getSettings(@Ctx() ctx: RequestContext): Promise<AiSettingsDto> {
    return this.budgets.settings(ctx);
  }

  @Post("settings")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  updateSettings(@Ctx() ctx: RequestContext, @Body() body: unknown): Promise<AiSettingsDto> {
    return this.budgets.updateSettings(ctx, body);
  }

  @Get("models/:id/prices")
  @Header("Cache-Control", "no-store")
  listPrices(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<AiPricesResponse> {
    return this.budgets.prices(ctx, id);
  }

  @Post("models/:id/prices")
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  addPrice(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<AiPrice> {
    return this.budgets.addPrice(ctx, id, body);
  }

  @Get("tasks")
  @Header("Cache-Control", "no-store")
  listTasks(@Ctx() ctx: RequestContext): Promise<AiTasksResponse> {
    return this.budgets.tasks(ctx);
  }

  @Post("tasks/:task")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  updateTask(
    @Ctx() ctx: RequestContext,
    @Param("task") task: string,
    @Body() body: unknown,
  ): Promise<AiTaskSettingDto> {
    return this.budgets.updateTask(ctx, task, body);
  }

  @Get("budgets")
  @Header("Cache-Control", "no-store")
  listBudgets(@Ctx() ctx: RequestContext): Promise<AiBudgetsResponse> {
    return this.budgets.budgets(ctx);
  }

  @Post("budgets")
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  createBudget(@Ctx() ctx: RequestContext, @Body() body: unknown): Promise<AiBudget> {
    return this.budgets.createBudget(ctx, body);
  }

  @Post("budgets/:id")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  updateBudget(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<AiBudget> {
    return this.budgets.updateBudget(ctx, id, body);
  }

  @Get("operations")
  @Header("Cache-Control", "no-store")
  listOperations(
    @Ctx() ctx: RequestContext,
    @Query("before") before?: string,
    @Query("limit") limit?: string,
  ): Promise<AiOperationsResponse> {
    return this.budgets.operations(ctx, {
      ...(before ? { before } : {}),
      ...(limit ? { limit } : {}),
    });
  }

  // --- DP-291: the operation service ------------------------------------------------------------

  @Post("operations")
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  runOperation(@Ctx() ctx: RequestContext, @Body() body: unknown): Promise<AiOperationCreated> {
    return this.operations.run(ctx, body);
  }

  @Get("operations/:id")
  @Header("Cache-Control", "no-store")
  getOperation(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<AiOperationDetail> {
    return this.operations.get(ctx, id);
  }

  @Post("operations/:id/cancel")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  cancelOperation(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
  ): Promise<AiOperationCancelResponse> {
    return this.operations.cancel(ctx, id);
  }

  @Get("reconciliation")
  @Header("Cache-Control", "no-store")
  reconciliation(
    @Ctx() ctx: RequestContext,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<AiReconciliationResponse> {
    return this.budgets.reconciliation(ctx, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
  }

  @Post("reconciliation")
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  recordProviderFigure(
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ): Promise<{ recorded: true }> {
    return this.budgets.recordProviderFigure(ctx, body);
  }
}
