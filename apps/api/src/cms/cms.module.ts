import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module.js";
import { CmsController, PublicCmsController } from "./cms.controller.js";
import { CmsService } from "./cms.service.js";
import { PublicCmsService } from "./public-cms.service.js";

// CMS pages of the public sites (S1/S2: DP-015, DP-017, DP-134; ADR-020). Data access goes through IAM's
// StaffAccessService (site-scoped client, audit); this module never holds the unscoped Prisma
// client.
@Module({
  imports: [IamModule],
  controllers: [CmsController, PublicCmsController],
  providers: [CmsService, PublicCmsService],
})
export class CmsModule {}
