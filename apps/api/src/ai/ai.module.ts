import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module.js";
import { API_CONFIG, type ApiConfig } from "../iam/http/api-config.js";
import { AI_ADAPTERS, AI_CONFIG } from "./config/ai-config.provider.js";
import { loadAiConfig, type AiConfig } from "./config/ai-config.js";
import { createAdapters } from "./providers/registry.js";
import { AiProvidersService } from "./providers.service.js";
import { AiBudgetsService } from "./budgets.service.js";
import { AiLedgerService } from "./ledger.service.js";
import { AiGateGuard } from "./ai-gate.guard.js";
import { AiController } from "./ai.controller.js";
import { AiService } from "./ai.service.js";
import { AiOperationsService } from "./operations.service.js";
import { AiRunnerService } from "./runner/runner.service.js";

// DP-287/DP-288 (ADR-030): the AI Center. Off by default; only the system owner switches it
// (Owner Console). AI_CONFIG is validated at start-up: with DP_AI_TRANSPORT=off (default) no AI
// variable is needed. DP-289: providers, keys and models; DP-290: the budget engine; DP-291: the
// shared operation service (queue, worker, generation). Other modules use AiOperationsService only.
@Module({
  imports: [IamModule],
  controllers: [AiController],
  exports: [AiLedgerService, AiOperationsService],
  providers: [
    {
      provide: AI_CONFIG,
      inject: [API_CONFIG],
      useFactory: (api: ApiConfig) => loadAiConfig(process.env, api.deployEnv),
    },
    {
      provide: AI_ADAPTERS,
      inject: [AI_CONFIG],
      useFactory: (config: AiConfig) => createAdapters(config.transport),
    },
    AiService,
    AiProvidersService,
    AiBudgetsService,
    AiLedgerService,
    AiRunnerService,
    AiOperationsService,
    AiGateGuard,
  ],
})
export class AiModule {}
