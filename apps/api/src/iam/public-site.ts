/**
 * Data access for the public sites (PM-3). The site is decided by the proxy key alone (the
 * security middleware derived `ctx.app` from it): the BV site's server reaches BV data only and
 * the Corporate site's server Corporate data only. No request value (path, query, header) can
 * select another site, so a public route cannot be used across sites.
 *
 * Callers get the site-scoped client for that one site (site-scope.ts): site-bound rows of the
 * other site look missing. The admin app has no public site (404).
 */
import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { ApiError } from "./http/api-error.js";
import type { RequestContext } from "./http/request-context.js";
import { inLeadContext } from "./lead-data.js";
import { withSiteScope, type SiteScopedClient } from "./site-scope.js";

export interface PublicLeadKey {
  /** The normalised e-mail of the submitted form. */
  leadEmail?: string | null;
  /** The raw download token the visitor presented (or was just issued). */
  grantToken?: string | null;
}

export interface PublicSite {
  siteId: string;
  siteKey: "BV" | "CORPORATE";
  db: SiteScopedClient;
  /**
   * DP-103: lead-table work in ONE transaction whose database context is this site plus the
   * visitor's own key; row-level security opens only that lead or that grant (lead-data.ts).
   */
  leadData<T>(key: PublicLeadKey, fn: (db: SiteScopedClient) => Promise<T>): Promise<T>;
}

const SITE_OF_APP = { WEB_BV: "BV", WEB_CORPORATE: "CORPORATE" } as const;

@Injectable()
export class PublicSiteService {
  private readonly ids = new Map<string, string>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async begin(ctx: RequestContext): Promise<PublicSite> {
    const siteKey = ctx.app === "ADMIN" ? null : SITE_OF_APP[ctx.app];
    if (!siteKey) throw new ApiError("NOT_FOUND");
    let siteId = this.ids.get(siteKey);
    if (!siteId) {
      const site = await this.prisma.site.findUnique({
        where: { key: siteKey },
        select: { id: true },
      });
      if (!site) throw new ApiError("NOT_FOUND");
      siteId = site.id;
      this.ids.set(siteKey, siteId);
    }
    const scope = { siteIds: [siteId], includePlatform: false };
    const site = siteId;
    return {
      siteId,
      siteKey,
      db: withSiteScope(this.prisma, scope),
      leadData: (key, fn) =>
        inLeadContext(this.prisma, scope, { kind: "public", siteId: site, ...key }, fn),
    };
  }
}
