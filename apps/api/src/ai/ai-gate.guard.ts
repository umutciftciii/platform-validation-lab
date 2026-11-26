/**
 * DP-287 (ADR-030 D2): every `/api/v1/admin/ai/*` route answers 404 while the system owner keeps
 * AI off, as if the area did not exist. A signed-out caller still gets 401 first (as on every admin
 * route); a signed-in caller's refusal is audited as `ai.access_denied` (reason `ai_disabled`).
 *
 * The guard is the first line only. `decide` refuses every `ai:*` permission while AI is off
 * (authorization.ts), so a route that passed the guard just before the switch-off is still
 * refused, and work that must not start once AI is off (a provider call, DP-291) runs inside
 * `PlatformModuleService.whileEnabled`.
 */
import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { ApiError } from "../iam/http/api-error.js";
import type { RequestWithContext } from "../iam/http/request-context.js";
import { AI_MODULE, PlatformModuleService } from "../iam/platform-modules.js";
import { StaffAccessService } from "../iam/staff/access.js";

@Injectable()
export class AiGateGuard implements CanActivate {
  constructor(
    @Inject(StaffAccessService) private readonly access: StaffAccessService,
    @Inject(PlatformModuleService) private readonly modules: PlatformModuleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithContext & { path?: string }>();
    if (!req.dp) throw new Error("request context missing: security middleware not installed");
    const access = await this.access.begin(req.dp);
    if (await this.modules.isEnabled(AI_MODULE)) return true;
    await access.denied("ai:read", { type: "ai_center", id: null }, "ai_disabled");
    throw new ApiError("NOT_FOUND");
  }
}
