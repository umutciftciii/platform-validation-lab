/**
 * Routes of staff authentication (design 11.2) and staff administration (design 11.3). Only the
 * admin proxy key reaches them (security middleware). Request bodies are validated with the
 * `@dream/contracts` schemas inside the services; 204 responses have no body.
 */
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Res } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import type {
  EnrolInspectResponse,
  EnrolMfaConfirmResponse,
  EnrolMfaSetupResponse,
  EnrolmentLinkResponse,
  InviteUserResponse,
  MfaResetResponse,
  RecoveryCodesResponse,
  StaffLoginResponse,
  StaffSessionListResponse,
  StaffSessionResponse,
} from "@dream/contracts";
import { Ctx, type RequestContext } from "../http/request-context.js";
import { EnrolmentService } from "./enrolment.service.js";
import { StaffAuthService, type AuthResult } from "./staff-auth.service.js";
import { UserAdminService } from "./user-admin.service.js";

function withCookies<T>(res: ServerResponse, result: AuthResult<T>): T {
  if (result.setCookies.length) res.setHeader("Set-Cookie", result.setCookies);
  return result.body;
}

@Controller("api/v1/auth/staff")
export class StaffAuthController {
  constructor(
    @Inject(StaffAuthService) private readonly auth: StaffAuthService,
    @Inject(EnrolmentService) private readonly enrolment: EnrolmentService,
  ) {}

  @Post("login")
  @HttpCode(200)
  async login(
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<StaffLoginResponse> {
    return withCookies(res, await this.auth.login(ctx, body));
  }

  @Post("login/mfa")
  @HttpCode(204)
  async loginMfa(
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<void> {
    withCookies(res, await this.auth.loginMfa(ctx, body));
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<void> {
    withCookies(res, await this.auth.logout(ctx));
  }

  @Get("session")
  session(@Ctx() ctx: RequestContext): Promise<StaffSessionResponse> {
    return this.auth.session(ctx);
  }

  @Post("step-up")
  @HttpCode(204)
  async stepUp(
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<void> {
    withCookies(res, await this.auth.stepUp(ctx, body));
  }

  @Get("sessions")
  sessions(@Ctx() ctx: RequestContext): Promise<StaffSessionListResponse> {
    return this.auth.listSessions(ctx);
  }

  @Post("sessions/revoke-others")
  @HttpCode(204)
  async revokeOthers(@Ctx() ctx: RequestContext): Promise<void> {
    await this.auth.revokeOtherSessions(ctx);
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  async revokeOne(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<void> {
    withCookies(res, await this.auth.revokeOwnSession(ctx, id));
  }

  @Post("password/change")
  @HttpCode(204)
  async changePassword(
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<void> {
    withCookies(res, await this.auth.changePassword(ctx, body));
  }

  @Post("password/reset")
  @HttpCode(204)
  async resetPassword(@Ctx() ctx: RequestContext, @Body() body: unknown): Promise<void> {
    await this.auth.resetPassword(ctx, body);
  }

  @Post("mfa/recovery-codes")
  @HttpCode(200)
  recoveryCodes(@Ctx() ctx: RequestContext): Promise<RecoveryCodesResponse> {
    return this.auth.regenerateRecoveryCodes(ctx);
  }

  @Post("enrol/inspect")
  @HttpCode(200)
  inspect(@Body() body: unknown): Promise<EnrolInspectResponse> {
    return this.enrolment.inspect(body);
  }

  @Post("enrol/password")
  @HttpCode(204)
  async enrolPassword(@Ctx() ctx: RequestContext, @Body() body: unknown): Promise<void> {
    await this.enrolment.password(ctx, body);
  }

  @Post("enrol/mfa/setup")
  @HttpCode(200)
  enrolMfaSetup(@Body() body: unknown): Promise<EnrolMfaSetupResponse> {
    return this.enrolment.mfaSetup(body);
  }

  @Post("enrol/mfa/confirm")
  @HttpCode(200)
  enrolMfaConfirm(
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ): Promise<EnrolMfaConfirmResponse> {
    return this.enrolment.mfaConfirm(ctx, body);
  }
}

@Controller("api/v1/admin/users")
export class UserAdminController {
  constructor(@Inject(UserAdminService) private readonly admin: UserAdminService) {}

  @Post("invite")
  @HttpCode(201)
  invite(@Ctx() ctx: RequestContext, @Body() body: unknown): Promise<InviteUserResponse> {
    return this.admin.invite(ctx, body);
  }

  @Post(":id/enrolment-link")
  @HttpCode(200)
  enrolmentLink(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
  ): Promise<EnrolmentLinkResponse> {
    return this.admin.enrolmentLink(ctx, id);
  }

  @Post(":id/mfa-reset")
  @HttpCode(200)
  mfaReset(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<MfaResetResponse> {
    return this.admin.mfaReset(ctx, id, body);
  }

  @Post(":id/suspend")
  @HttpCode(204)
  async suspend(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    await this.admin.suspend(ctx, id, body);
  }

  @Post(":id/reactivate")
  @HttpCode(204)
  async reactivate(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    await this.admin.reactivate(ctx, id, body);
  }

  @Post(":id/unlock")
  @HttpCode(204)
  async unlock(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    await this.admin.unlock(ctx, id, body);
  }

  @Post(":id/sessions/revoke")
  @HttpCode(204)
  async revokeSessions(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    await this.admin.revokeSessions(ctx, id, body);
  }

  @Post(":id/deactivate")
  @HttpCode(204)
  async deactivate(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    await this.admin.deactivate(ctx, id, body);
  }
}
