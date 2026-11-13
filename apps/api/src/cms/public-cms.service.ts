/**
 * Public read model of CMS pages (S2, ADR-020 D6/D7), for the site servers through their proxy
 * keys; the site comes from the key (PublicSiteService), never from the request.
 *
 *  - `page(path)`: the PUBLISHED revision of the page at that path, with the published revisions
 *    of the site-wide fragments. A page that is not published is 404; a fragment that is not
 *    published is null, and the site shows nothing in its place. Nothing falls back to content in
 *    code, and a draft never leaves the API here.
 *  - `preview(token)`: the current DRAFT of the page a signed preview token names (15 minutes,
 *    one page, this site only). Fragments come from their published revision, or their draft
 *    when they have none yet (a preview of a site that is not live yet).
 *
 * Content read back is validated again against its template; a row that no longer matches is not
 * served (logged, 404), so a schema change can never break the site with half-valid content.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { BV_FRAGMENT_KEYS, type CmsPublicBundle, type CmsPublicPage } from "@dream/contracts";
import { API_CONFIG, type ApiConfig } from "../iam/http/api-config.js";
import { ApiError } from "../iam/http/api-error.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { PublicSiteService, type PublicSite } from "../iam/public-site.js";
import {
  contentIsValid,
  liveRows,
  publicPage,
  verifyPreviewToken,
  type LiveRow,
} from "./cms-content.js";

const PATH = /^\/([a-z0-9]+(-[a-z0-9]+)*)?$/;
const FRAGMENTS: Readonly<Record<"BV" | "CORPORATE", readonly string[]>> = {
  BV: BV_FRAGMENT_KEYS,
  CORPORATE: [],
};

@Injectable()
export class PublicCmsService {
  private readonly log = new Logger("PublicCms");

  constructor(
    @Inject(PublicSiteService) private readonly sites: PublicSiteService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  private served(row: LiveRow): CmsPublicPage | null {
    const { kind, templateKey } = row.page;
    if (!contentIsValid(kind, templateKey, row.revision.content)) {
      this.log.error(`a published ${templateKey} revision does not match its schema; not served`);
      return null;
    }
    return publicPage(
      { kind, templateKey, ...row.revision },
      { revisionNumber: row.revision.revisionNumber, publishedAt: row.publishedAt },
    );
  }

  private liveFragments(site: PublicSite, live: LiveRow[]): Record<string, CmsPublicPage | null> {
    const out: Record<string, CmsPublicPage | null> = {};
    for (const key of FRAGMENTS[site.siteKey]) {
      const row = live.find((r) => r.page.kind === "FRAGMENT" && r.page.templateKey === key);
      out[key] = row ? this.served(row) : null;
    }
    return out;
  }

  async page(ctx: RequestContext, rawPath: unknown): Promise<CmsPublicBundle> {
    const path = typeof rawPath === "string" ? rawPath : "";
    if (!PATH.test(path)) throw new ApiError("NOT_FOUND");
    const site = await this.sites.begin(ctx);
    const live = await liveRows(site.db, site.siteId);
    const row = live.find((r) => r.page.kind !== "FRAGMENT" && r.revision.path === path);
    const page = row ? this.served(row) : null;
    if (!page) throw new ApiError("NOT_FOUND");
    return { page, fragments: this.liveFragments(site, live), preview: false };
  }

  async preview(ctx: RequestContext, rawToken: string): Promise<CmsPublicBundle> {
    const site = await this.sites.begin(ctx);
    const pageId = verifyPreviewToken(
      this.config.secrets.hmacKey,
      rawToken,
      site.siteKey,
      this.clock.now(),
    );
    if (!pageId) throw new ApiError("NOT_FOUND");
    const draft = await site.db.cmsPage.findUnique({
      where: { id: pageId },
      select: {
        kind: true,
        templateKey: true,
        path: true,
        title: true,
        seoTitle: true,
        seoDescription: true,
        noindex: true,
        content: true,
      },
    });
    if (!draft || !contentIsValid(draft.kind, draft.templateKey, draft.content)) {
      throw new ApiError("NOT_FOUND");
    }
    const target = publicPage(draft, null);
    const live = await liveRows(site.db, site.siteId);
    const fragments = this.liveFragments(site, live);
    const missing = Object.keys(fragments).filter((k) => !fragments[k]);
    if (missing.length) {
      const drafts = await site.db.cmsPage.findMany({
        where: { siteId: site.siteId, templateKey: { in: missing } },
        select: {
          kind: true,
          templateKey: true,
          path: true,
          title: true,
          seoTitle: true,
          seoDescription: true,
          noindex: true,
          content: true,
        },
      });
      for (const d of drafts) {
        if (contentIsValid(d.kind, d.templateKey, d.content))
          fragments[d.templateKey] = publicPage(d, null);
      }
    }
    if (target.kind === "FRAGMENT") {
      // Previewing a fragment shows it on the home page: the fragment's draft around the home page
      // (published, or its draft before the first publication).
      fragments[target.templateKey] = target;
      const home = await this.homeForFragmentPreview(site, live);
      if (!home) throw new ApiError("NOT_FOUND");
      return { page: home, fragments, preview: true };
    }
    return { page: target, fragments, preview: true };
  }

  private async homeForFragmentPreview(
    site: PublicSite,
    live: LiveRow[],
  ): Promise<CmsPublicPage | null> {
    const row = live.find((r) => r.page.kind !== "FRAGMENT" && r.revision.path === "/");
    if (row) return this.served(row);
    const draft = await site.db.cmsPage.findFirst({
      where: { siteId: site.siteId, path: "/" },
      select: {
        kind: true,
        templateKey: true,
        path: true,
        title: true,
        seoTitle: true,
        seoDescription: true,
        noindex: true,
        content: true,
      },
    });
    return draft && contentIsValid(draft.kind, draft.templateKey, draft.content)
      ? publicPage(draft, null)
      : null;
  }
}
