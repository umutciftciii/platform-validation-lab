import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module.js";
import { AdminCrmController } from "./crm.controller.js";
import { CrmCompaniesService } from "./crm-companies.service.js";
import { CrmPeopleService } from "./crm-people.service.js";

// CRM 360° (CRM-1, ADR-032): companies and account owners on top of the lead core. Core module
// "crm" (always on); data access through IAM (session database context, row-level security,
// audit). CRM-2 (CrmPeopleService) groups leads into people, links them to companies and keeps
// the CRM history; CRM-4 adds the unified contact history.
@Module({
  imports: [IamModule],
  controllers: [AdminCrmController],
  providers: [CrmCompaniesService, CrmPeopleService],
})
export class CrmModule {}
