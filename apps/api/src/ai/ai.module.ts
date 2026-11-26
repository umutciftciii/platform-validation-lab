import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module.js";
import { API_CONFIG, type ApiConfig } from "../iam/http/api-config.js";
import { AI_CONFIG } from "./config/ai-config.provider.js";
import { loadAiConfig } from "./config/ai-config.js";
import { AiGateGuard } from "./ai-gate.guard.js";
import { AiController } from "./ai.controller.js";
import { AiService } from "./ai.service.js";

// DP-287/DP-288 (ADR-030): the AI Center. Off by default; only the system owner switches it
// (Owner Console). AI_CONFIG is validated at start-up: with DP_AI_TRANSPORT=off (default) no AI
// variable is needed. No provider call, key screen or budget engine yet (DP-289…DP-293).
@Module({
  imports: [IamModule],
  controllers: [AiController],
  providers: [
    {
      provide: AI_CONFIG,
      inject: [API_CONFIG],
      useFactory: (api: ApiConfig) => loadAiConfig(process.env, api.deployEnv),
    },
    AiService,
    AiGateGuard,
  ],
})
export class AiModule {}
