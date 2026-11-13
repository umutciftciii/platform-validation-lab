import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module.js";
import { LeadsModule } from "../leads/leads.module.js";
import { MediaModule } from "../media/media.module.js";
import { CatalogController } from "./catalog.controller.js";
import { CatalogService } from "./catalog.service.js";
import { DocumentStampers } from "./document-delivery.js";
import { LEAD_WATERMARK_STAMPER } from "./watermark.js";
import { DocumentsController } from "./documents.controller.js";
import { DocumentsService } from "./documents.service.js";
import { ImagesService } from "./images.service.js";
import { SpecsImagesController } from "./specs-images.controller.js";
import { SpecsService } from "./specs.service.js";
import { PublicCatalogService } from "./public-catalog.service.js";
import { PublicCatalogController, WorkflowController } from "./workflow.controller.js";
import { WorkflowService } from "./workflow.service.js";
import { GlobalCatalogService } from "./global-catalog.service.js";
import { CrossReferencesController } from "./xrefs.controller.js";
import { CrossReferencesService } from "./xrefs.service.js";

// Product catalogue administration (PM-1, PM-2), review/publication and public content (PM-3),
// technical documents (PM-5), global brands and cross-references (PM-6).
// Data access goes through IAM's StaffAccessService and PublicSiteService (site-scoped client,
// audit); files through the MediaModule's storage. This module never holds the unscoped Prisma
// client.
@Module({
  imports: [IamModule, MediaModule, LeadsModule],
  controllers: [
    CatalogController,
    SpecsImagesController,
    WorkflowController,
    PublicCatalogController,
    DocumentsController,
    CrossReferencesController,
  ],
  providers: [
    CatalogService,
    SpecsService,
    ImagesService,
    WorkflowService,
    PublicCatalogService,
    DocumentsService,
    GlobalCatalogService,
    CrossReferencesService,
    // PM-5: one stamper registry per process; DP-043: the watermark stamper of LEAD_REQUIRED.
    {
      provide: DocumentStampers,
      useFactory: () => {
        const stampers = new DocumentStampers();
        stampers.register("LEAD_REQUIRED", LEAD_WATERMARK_STAMPER);
        return stampers;
      },
    },
  ],
})
export class CatalogModule {}
