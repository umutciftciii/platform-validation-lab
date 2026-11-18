import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module.js";
import { AdminSeoController } from "./admin-seo.controller.js";
import { AdminSeoService } from "./admin-seo.service.js";
import { PublicSeoController } from "./public-seo.controller.js";
import { PublicSeoService } from "./public-seo.service.js";

// DP-207: technical SEO of the public sites (existence check before rendering, sitemap); DP-209:
// the site SEO defaults and the admin SEO overview. Reads
// through IAM's PublicSiteService (site-scoped client); never the unscoped Prisma client.
@Module({
  imports: [IamModule],
  controllers: [PublicSeoController, AdminSeoController],
  providers: [PublicSeoService, AdminSeoService],
})
export class SeoModule {}
