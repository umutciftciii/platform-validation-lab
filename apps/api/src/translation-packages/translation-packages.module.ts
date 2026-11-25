import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module.js";
import { TranslationPackagesController } from "./translation-packages.controller.js";
import { TranslationPackagesService } from "./translation-packages.service.js";

// ML-13a (DP-244, ADR-028 D13): translation packages (export, dry run, import as drafts). Data
// access goes through IAM's StaffAccessService (site-scoped client, audit); no unscoped client.
@Module({
  imports: [IamModule],
  controllers: [TranslationPackagesController],
  providers: [TranslationPackagesService],
})
export class TranslationPackagesModule {}
