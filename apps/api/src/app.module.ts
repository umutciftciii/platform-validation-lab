import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { CatalogModule } from "./catalog/catalog.module.js";
import { CmsModule } from "./cms/cms.module.js";
import { HealthController } from "./health/health.controller.js";
import { ApiExceptionFilter } from "./iam/http/api-error.js";
import { IamModule } from "./iam/iam.module.js";
import { MediaModule } from "./media/media.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";

// Modular monolith root. Business modules (CMS, catalog, leads) are added per backlog item.
// Start the API through createApiApp (app.factory.ts): it installs the proxy-key, CSRF and body
// limits in front of every route.
@Module({
  imports: [PrismaModule, IamModule, MediaModule, CatalogModule, CmsModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
