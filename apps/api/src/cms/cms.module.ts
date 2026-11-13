import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module.js";
import { CmsController } from "./cms.controller.js";
import { CmsService } from "./cms.service.js";

// CMS pages of the public sites (S1, DP-015, ADR-020). Data access goes through IAM's
// StaffAccessService (site-scoped client, audit); this module never holds the unscoped Prisma
// client.
@Module({
  imports: [IamModule],
  controllers: [CmsController],
  providers: [CmsService],
})
export class CmsModule {}
