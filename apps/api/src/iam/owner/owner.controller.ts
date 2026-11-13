/**
 * System owner (God Mode) routes (DP-108, ADR-018). Under the admin prefix, so only the admin app
 * reaches them; every route except the designation confirmation answers 404 to anyone but the
 * system owner (owner.service.ts).
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import type {
  OwnerChainStatus,
  OwnerDesignationConfirmResponse,
  OwnerModuleChangeResponse,
  OwnerOverviewResponse,
  ProtectedAuditListResponse,
} from "@dream/contracts";
import { Ctx, type RequestContext } from "../http/request-context.js";
import { OwnerService } from "./owner.service.js";

@Controller("api/v1/admin/owner")
export class OwnerController {
  constructor(@Inject(OwnerService) private readonly owner: OwnerService) {}

  @Get("overview")
  overview(@Ctx() ctx: RequestContext): Promise<OwnerOverviewResponse> {
    return this.owner.overview(ctx);
  }

  @Post("modules/:moduleKey/sites/:siteId")
  @HttpCode(200)
  changeModule(
    @Ctx() ctx: RequestContext,
    @Param("moduleKey") moduleKey: string,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ): Promise<OwnerModuleChangeResponse> {
    return this.owner.changeModule(ctx, moduleKey, siteId, body);
  }

  @Get("audit")
  audit(
    @Ctx() ctx: RequestContext,
    @Query("before") before?: string,
    @Query("limit") limit?: string,
  ): Promise<ProtectedAuditListResponse> {
    return this.owner.audit(ctx, {
      ...(before !== undefined ? { before } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
  }

  @Get("audit/verify")
  verify(@Ctx() ctx: RequestContext): Promise<OwnerChainStatus> {
    return this.owner.verify(ctx);
  }

  @Post("designation/confirm")
  @HttpCode(200)
  confirm(
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ): Promise<OwnerDesignationConfirmResponse> {
    return this.owner.confirmDesignation(ctx, body);
  }
}
