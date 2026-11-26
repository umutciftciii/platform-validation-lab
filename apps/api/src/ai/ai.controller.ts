/**
 * DP-287 (ADR-030): `/api/v1/admin/ai/*`. Every route sits behind AiGateGuard (404 while AI is
 * off); each handler authorises again in the service.
 */
import { Controller, Get, Header, Inject, UseGuards } from "@nestjs/common";
import type { AiOverviewResponse } from "@dream/contracts";
import { Ctx, type RequestContext } from "../iam/http/request-context.js";
import { AiGateGuard } from "./ai-gate.guard.js";
import { AiService } from "./ai.service.js";

@Controller("api/v1/admin/ai")
@UseGuards(AiGateGuard)
export class AiController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}

  @Get("overview")
  @Header("Cache-Control", "no-store")
  overview(@Ctx() ctx: RequestContext): Promise<AiOverviewResponse> {
    return this.ai.overview(ctx);
  }
}
