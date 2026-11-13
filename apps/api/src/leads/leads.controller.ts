/**
 * Lead routes (DP-042; ADR-016). Public: the site's server forwards the short form (site from its
 * proxy key). Admin: list and detail with lead:read; the sales workflow (status, assignment,
 * notes, contacts) with lead:manage (DP-041, ADR-019). Export: DP-126.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import type {
  LeadActivityResponse,
  LeadDetailResponse,
  LeadDocumentRequestResponse,
  LeadListResponse,
  LeadWorkflowResponse,
} from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { AdminLeadsService } from "./admin-leads.service.js";
import { LeadRequestsService } from "./lead-requests.service.js";

function single(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

@Controller("api/v1/public/leads")
export class PublicLeadsController {
  constructor(@Inject(LeadRequestsService) private readonly leads: LeadRequestsService) {}

  @Post("document-requests")
  @HttpCode(201)
  request(@Ctx() ctx: RequestContext, @Body() body: unknown): Promise<LeadDocumentRequestResponse> {
    return this.leads.request(ctx, body);
  }
}

@Controller("api/v1/admin/leads")
export class AdminLeadsController {
  constructor(@Inject(AdminLeadsService) private readonly leads: AdminLeadsService) {}

  @Get()
  list(
    @Ctx() ctx: RequestContext,
    @Query("siteId") siteId: unknown,
    @Query("cursor") cursor: unknown,
    @Query("q") q: unknown,
    @Query("status") status: unknown,
    @Query("assignee") assignee: unknown,
  ): Promise<LeadListResponse> {
    return this.leads.list(ctx, {
      siteId: single(siteId),
      cursor: single(cursor),
      q: single(q),
      status: single(status),
      assignee: single(assignee),
    });
  }

  @Get(":id")
  detail(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<LeadDetailResponse> {
    return this.leads.detail(ctx, id);
  }

  /** DP-041: status and/or assignment (lead:manage, optimistic `version`). */
  @Post(":id/workflow")
  @HttpCode(200)
  workflow(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<LeadWorkflowResponse> {
    return this.leads.workflow(ctx, id, body);
  }

  /** DP-041: a note or a contact record (lead:manage). */
  @Post(":id/activities")
  @HttpCode(201)
  addActivity(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<LeadActivityResponse> {
    return this.leads.addActivity(ctx, id, body);
  }
}
