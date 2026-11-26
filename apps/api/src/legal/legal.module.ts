import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module.js";
import { AdminLegalTextsController, PublicLegalTextsController } from "./legal-texts.controller.js";
import { LegalTextsService } from "./legal-texts.service.js";

// DP-298 (ADR-031): versioned legal and consent texts managed in the admin; the published
// versions are the runtime source of the forms, the privacy pages and the evidence check.
@Module({
  imports: [IamModule],
  controllers: [AdminLegalTextsController, PublicLegalTextsController],
  providers: [LegalTextsService],
  exports: [LegalTextsService],
})
export class LegalModule {}
