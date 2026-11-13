import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module.js";
import { AdminLeadsService } from "./admin-leads.service.js";
import { ContactMessagesService } from "./contact-messages.service.js";
import { DocumentGrantsService } from "./document-grants.service.js";
import { AdminLeadsController, PublicLeadsController } from "./leads.controller.js";
import { LeadRequestsService } from "./lead-requests.service.js";
import { LeadRetentionReportService } from "./retention-report.service.js";

// Lead-gated document downloads (DP-042, DP-043; ADR-016): public short form with consent
// evidence and download grants, staff read access with lead:read. The catalogue's public document
// route uses DocumentGrantsService; data access goes through IAM (site-scoped clients, audit).
// DP-151: the public contact form writes a message to the sender's lead (same consent evidence).
// DP-096: a daily dry-run retention report (counts only); anonymisation is an operator action.
@Module({
  imports: [IamModule],
  controllers: [PublicLeadsController, AdminLeadsController],
  providers: [
    LeadRequestsService,
    ContactMessagesService,
    AdminLeadsService,
    DocumentGrantsService,
    LeadRetentionReportService,
  ],
  exports: [DocumentGrantsService],
})
export class LeadsModule {}
