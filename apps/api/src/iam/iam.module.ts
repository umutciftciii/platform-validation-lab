import { Module } from "@nestjs/common";
import { AuthCleanupService } from "./auth/cleanup.service.js";
import { AuthorizationService } from "./authorization.service.js";
import { CustomerDataAccessSweepService } from "./customer-data-access/sweep.service.js";
import { API_CONFIG, loadApiConfig } from "./http/api-config.js";
import { Clock, FaultInjector } from "./http/clock.js";
import { ProxyKeyMetrics } from "./http/proxy-keys.js";
import { PublicSiteService } from "./public-site.js";
import { PublicRateLimitService } from "./public-rate-limit.js";
import { StaffAccessService } from "./staff/access.js";
import { EnrolmentService } from "./staff/enrolment.service.js";
import { StaffSessionService } from "./staff/sessions.js";
import { StaffAuthController, UserAdminController } from "./staff/staff-auth.controller.js";
import { StaffAuthService } from "./staff/staff-auth.service.js";
import { UserAdminService } from "./staff/user-admin.service.js";
import { StaffRolesController } from "./staff/staff-roles.controller.js";
import { StaffRolesService } from "./staff/staff-roles.service.js";
import { OwnerController } from "./owner/owner.controller.js";
import { OwnerService } from "./owner/owner.service.js";

// IAM (F1-001), authentication foundation (F1-002 Group 1) and staff authentication end to end
// (F1-002 Group 2, DP-011), direct role assignment (DP-076 revision, ADR-017 v2) and the system
// owner console (DP-108, ADR-018). API_CONFIG validates proxy keys, IAM secrets and TLS when the module
// is created: with a missing or weak secret the API does not start (ADR-013 D19, NT-L4).
@Module({
  controllers: [StaffAuthController, UserAdminController, StaffRolesController, OwnerController],
  providers: [
    { provide: API_CONFIG, useFactory: () => loadApiConfig(process.env) },
    { provide: ProxyKeyMetrics, useFactory: () => new ProxyKeyMetrics() },
    Clock,
    FaultInjector,
    AuthorizationService,
    AuthCleanupService,
    StaffSessionService,
    StaffAuthService,
    EnrolmentService,
    UserAdminService,
    StaffAccessService,
    PublicSiteService,
    PublicRateLimitService,
    StaffRolesService,
    OwnerService,
    CustomerDataAccessSweepService,
  ],
  exports: [
    AuthorizationService,
    API_CONFIG,
    ProxyKeyMetrics,
    Clock,
    FaultInjector,
    StaffAccessService,
    PublicSiteService,
    PublicRateLimitService,
  ],
})
export class IamModule {}
