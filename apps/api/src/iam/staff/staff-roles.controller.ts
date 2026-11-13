/**
 * Staff and role administration routes (DP-076 revision, DP-107; ADR-017 v2). Direct role
 * assignment and revocation; the API checks every permission (no-escalation, scope, last admin).
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from "@nestjs/common";
import type { AssignRoleResponse, StaffListResponse } from "@dream/contracts";
import { Ctx, type RequestContext } from "../http/request-context.js";
import { StaffRolesService } from "./staff-roles.service.js";

@Controller("api/v1/admin")
export class StaffRolesController {
  constructor(@Inject(StaffRolesService) private readonly roles: StaffRolesService) {}

  @Get("staff")
  list(@Ctx() ctx: RequestContext): Promise<StaffListResponse> {
    return this.roles.list(ctx);
  }

  @Post("staff/:id/roles")
  @HttpCode(201)
  assign(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<AssignRoleResponse> {
    return this.roles.assign(ctx, id, body);
  }

  @Post("role-assignments/:id/revoke")
  @HttpCode(204)
  async revoke(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.roles.revoke(ctx, id, body);
  }
}
