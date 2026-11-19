import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module.js";
import { AdminLeadsService } from "./admin-leads.service.js";
import { ContactMessagesService } from "./contact-messages.service.js";
import { DocumentGrantsService } from "./document-grants.service.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import {
  AdminLeadNotificationsController,
  AdminLeadsController,
  PublicLeadsController,
} from "./leads.controller.js";
import {
  LEAD_NOTIFICATION_SENDER,
  LeadNotificationSender,
} from "./lead-notification-sender.service.js";
import { LeadNotificationSettingsService } from "./lead-notification-settings.service.js";
import { LeadRequestsService } from "./lead-requests.service.js";
import { LeadRetentionReportService } from "./retention-report.service.js";

// Lead-gated document downloads (DP-042, DP-043; ADR-016): public short form with consent
// evidence and download grants, staff read access with lead:read. The catalogue's public document
// route uses DocumentGrantsService; data access goes through IAM (site-scoped clients, audit).
// DP-151: the public contact form writes a message to the sender's lead (same consent evidence).
// DP-096: a daily dry-run retention report (counts only); anonymisation is an operator action.
// DP-221 (ADR-026): contact-form leads carry their source; staff notifications go through an
// outbox (LeadNotification) and the sender below; lead managers keep the per-site settings.
@Module({
  imports: [IamModule, NotificationsModule],
  controllers: [PublicLeadsController, AdminLeadsController, AdminLeadNotificationsController],
  providers: [
    LeadRequestsService,
    ContactMessagesService,
    AdminLeadsService,
    DocumentGrantsService,
    LeadRetentionReportService,
    LeadNotificationSender,
    LeadNotificationSettingsService,
    // Tests and operators reach the sender by name (runOnce).
    { provide: LEAD_NOTIFICATION_SENDER, useExisting: LeadNotificationSender },
  ],
  exports: [DocumentGrantsService],
})
export class LeadsModule {}
