/**
 * CRM 360° routes (CRM-1, ADR-032): companies of the sites the caller reads (`crm:read`), created
 * and changed with `crm:manage`. The admin proxy forwards GET, POST and DELETE only, so an update
 * is a POST to the company. No delete route: companies are never deleted through the API.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import type {
  CrmCompanyDetailResponse,
  CrmCompanyListResponse,
  CrmCompanyResponse,
  CrmOwnersResponse,
} from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { CrmCompaniesService } from "./crm-companies.service.js";

function single(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

@Controller("api/v1/admin/crm")
export class AdminCrmController {
  constructor(@Inject(CrmCompaniesService) private readonly companies: CrmCompaniesService) {}

  @Get("companies")
  list(
    @Ctx() ctx: RequestContext,
    @Query() query: Record<string, unknown>,
  ): Promise<CrmCompanyListResponse> {
    return this.companies.list(ctx, {
      siteId: single(query["siteId"]),
      q: single(query["q"]),
      owner: single(query["owner"]),
      country: single(query["country"]),
      cursor: single(query["cursor"]),
    });
  }

  @Post("companies")
  @HttpCode(201)
  create(@Ctx() ctx: RequestContext, @Body() body: unknown): Promise<CrmCompanyResponse> {
    return this.companies.create(ctx, body);
  }

  /** Possible account owners of the sites where the caller may create companies. */
  @Get("owners")
  owners(@Ctx() ctx: RequestContext): Promise<CrmOwnersResponse> {
    return this.companies.owners(ctx);
  }

  @Get("companies/:id")
  detail(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<CrmCompanyDetailResponse> {
    return this.companies.detail(ctx, id);
  }

  /** Saves every editable field (optimistic concurrency with `version`). */
  @Post("companies/:id")
  @HttpCode(200)
  update(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<CrmCompanyResponse> {
    return this.companies.update(ctx, id, body);
  }
}
