/**
 * CRM 360° routes (CRM-1, ADR-032): companies of the sites the caller reads (`crm:read`), created
 * and changed with `crm:manage`. The admin proxy forwards GET, POST and DELETE only, so an update
 * is a POST to the company. No delete route: companies are never deleted through the API.
 *
 * CRM-2 (ADR-032 D6/D7): people of a company, the CRM side of a lead (its person, the same
 * person's other leads), linking and the company history with staff notes.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import type {
  CrmActivityListResponse,
  CrmCompanyPeopleResponse,
  CrmLeadCandidatesResponse,
  CrmLeadResponse,
  CrmPersonResponse,
  CrmCompanyDetailResponse,
  CrmCompanyListResponse,
  CrmCompanyResponse,
  CrmOwnersResponse,
} from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { CrmCompaniesService } from "./crm-companies.service.js";
import { CrmPeopleService } from "./crm-people.service.js";

function single(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

@Controller("api/v1/admin/crm")
export class AdminCrmController {
  constructor(
    @Inject(CrmCompaniesService) private readonly companies: CrmCompaniesService,
    @Inject(CrmPeopleService) private readonly people: CrmPeopleService,
  ) {}

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

  // --- CRM-2 -----------------------------------------------------------------------------------

  @Get("companies/:id/people")
  companyPeople(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
  ): Promise<CrmCompanyPeopleResponse> {
    return this.people.companyPeople(ctx, id);
  }

  /** Leads that may join the company: suggestions, or a search (`q`). */
  @Get("companies/:id/candidates")
  companyCandidates(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<CrmLeadCandidatesResponse> {
    return this.people.companyCandidates(ctx, id, single(query["q"]));
  }

  @Post("companies/:id/people")
  @HttpCode(200)
  addPerson(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<CrmPersonResponse> {
    return this.people.addPerson(ctx, id, body);
  }

  @Get("companies/:id/activities")
  activities(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<CrmActivityListResponse> {
    return this.people.activities(ctx, id, single(query["cursor"]));
  }

  @Post("companies/:id/notes")
  @HttpCode(201)
  addNote(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    return this.people.addNote(ctx, id, body);
  }

  /** Move a person to another company of its site, or remove it from its company. */
  @Post("people/:id/company")
  @HttpCode(200)
  setPersonCompany(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<CrmPersonResponse> {
    return this.people.setPersonCompany(ctx, id, body);
  }

  @Get("leads/:id")
  lead(@Ctx() ctx: RequestContext, @Param("id") id: string): Promise<CrmLeadResponse> {
    return this.people.lead(ctx, id);
  }

  /** Other leads of the site that may be the same person (search `q` only). */
  @Get("leads/:id/candidates")
  leadCandidates(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<CrmLeadCandidatesResponse> {
    return this.people.leadCandidates(ctx, id, single(query["q"]));
  }

  @Post("leads/:id/person")
  @HttpCode(200)
  setLeadPerson(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<CrmLeadResponse> {
    return this.people.setLeadPerson(ctx, id, body);
  }
}
