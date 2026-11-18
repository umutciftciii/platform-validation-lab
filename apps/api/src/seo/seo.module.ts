import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module.js";
import { PublicSeoController } from "./public-seo.controller.js";
import { PublicSeoService } from "./public-seo.service.js";

// DP-207: technical SEO of the public sites (existence check before rendering, sitemap). Reads
// through IAM's PublicSiteService (site-scoped client); never the unscoped Prisma client.
@Module({
  imports: [IamModule],
  controllers: [PublicSeoController],
  providers: [PublicSeoService],
})
export class SeoModule {}
