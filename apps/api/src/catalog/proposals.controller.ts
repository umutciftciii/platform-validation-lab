/**
 * Routes of the content proposals (DP-171, ADR-022), under /api/v1/admin/catalog (admin proxy key
 * only). Every handler authorises inside ProposalsService. Changes use POST, the method the admin
 * proxy forwards, and name the version they were based on.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import type { ProposalListResponse, ProposalResponse } from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { ProposalsService } from "./proposals.service.js";

@Controller("api/v1/admin/catalog")
export class ProposalsController {
  constructor(@Inject(ProposalsService) private readonly proposals: ProposalsService) {}

  @Get("proposals")
  list(
    @Ctx() ctx: RequestContext,
    @Query("siteId") siteId?: string,
    @Query("status") status?: string,
  ): Promise<ProposalListResponse> {
    return this.proposals.list(ctx, { siteId, status });
  }

  @Get("proposals/:id")
  get(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<ProposalResponse> {
    return this.proposals.get(ctx, id);
  }

  @Post("sites/:siteId/proposals")
  @HttpCode(201)
  create(
    @Ctx() ctx: RequestContext,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ): Promise<ProposalResponse> {
    return this.proposals.create(ctx, siteId, body);
  }

  @Post("proposals/:id/revise")
  @HttpCode(200)
  revise(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ProposalResponse> {
    return this.proposals.revise(ctx, id, body);
  }

  @Post("proposals/:id/approve")
  @HttpCode(200)
  approve(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ProposalResponse> {
    return this.proposals.decide(ctx, id, body, "APPROVED");
  }

  @Post("proposals/:id/request-changes")
  @HttpCode(200)
  requestChanges(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ProposalResponse> {
    return this.proposals.decide(ctx, id, body, "CHANGES_REQUESTED");
  }
}
