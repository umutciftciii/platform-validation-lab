import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module.js";
import { AiGateGuard } from "./ai-gate.guard.js";
import { AiController } from "./ai.controller.js";
import { AiService } from "./ai.service.js";

// DP-287 (ADR-030): the AI Center. Off by default; only the system owner switches it
// (Owner Console). No provider, key, budget or translation link yet (DP-288…DP-294).
@Module({
  imports: [IamModule],
  controllers: [AiController],
  providers: [AiService, AiGateGuard],
})
export class AiModule {}
