import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module.js";
import { AdminRedirectsController } from "./admin-redirects.controller.js";
import { AdminRedirectsService } from "./admin-redirects.service.js";
import { AdminSeoController } from "./admin-seo.controller.js";
import { AdminSeoService } from "./admin-seo.service.js";
import { PublicSeoController } from "./public-seo.controller.js";
import { PublicSeoService } from "./public-seo.service.js";

// DP-207: technical SEO of the public sites (existence check before rendering, sitemap); DP-209:
// the site SEO defaults and the admin SEO overview; DP-211: redirect management. Reads
// through IAM's PublicSiteService (site-scoped client); never the unscoped Prisma client.
@Module({
  imports: [IamModule],
  controllers: [PublicSeoController, AdminSeoController, AdminRedirectsController],
  providers: [PublicSeoService, AdminSeoService, AdminRedirectsService],
})
export class SeoModule {}
