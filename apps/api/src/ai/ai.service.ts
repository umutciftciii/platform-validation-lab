/**
 * DP-287 (ADR-030): the AI Center's first route, the overview. While AI is off the guard answers
 * 404 (ai-gate.guard.ts); a refusal that `decide` gives because AI went off meanwhile is a 404 too.
 * No provider key, model or budget exists before DP-288…DP-290, so no AI call is possible.
 */
import { Inject, Injectable } from "@nestjs/common";
import { AI_BLOCKERS, type AiOverviewResponse } from "@dream/contracts";
import { ApiError } from "../iam/http/api-error.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { StaffAccessService, type StaffAccess } from "../iam/staff/access.js";

const PLATFORM = { scope: "platform" } as const;
const RESOURCE = { type: "ai_center", id: null };

@Injectable()
export class AiService {
  constructor(@Inject(StaffAccessService) private readonly access: StaffAccessService) {}

  /** ai:read, with "AI is off" answered as 404 like the guard does. */
  private async read(ctx: RequestContext): Promise<StaffAccess> {
    const access = await this.access.begin(ctx);
    if (access.refusal("ai:read", PLATFORM) === "module_disabled") {
      await access.denied("ai:read", RESOURCE, "ai_disabled");
      throw new ApiError("NOT_FOUND");
    }
    await access.require("ai:read", PLATFORM, RESOURCE);
    return access;
  }

  async overview(ctx: RequestContext): Promise<AiOverviewResponse> {
    await this.read(ctx);
    return { enabled: true, callsPossible: false, blockers: [...AI_BLOCKERS] };
  }
}
