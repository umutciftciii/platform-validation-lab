/**
 * Download grants of lead requests (DP-043; ADR-016 D4, D5). Used by the public document route:
 *
 *  - `find` resolves a token (SHA-256 lookup) to its grant, request and revision on THIS site,
 *    only while it is unexpired, not used up and for the asked document; otherwise null (the
 *    caller answers 404 like an unknown id);
 *  - `consume` takes one download with a conditional UPDATE (never past the limit under
 *    concurrency) and writes the download row (size and SHA-256 of the stamped bytes) and an
 *    audit event in the same transaction, before the bytes leave.
 */
import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { DOWNLOAD_GRANT_MAX_DOWNLOADS } from "@dream/contracts";
import { hashToken, isWellFormedToken } from "../iam/auth/tokens.js";
import type { Db } from "../iam/db.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import type { PublicSite } from "../iam/public-site.js";
import type { SiteScopedClient } from "../iam/site-scope.js";
import { writeAudit } from "../iam/staff/audit-writer.js";

export interface GrantForDownload {
  /** The raw token the visitor presented: the database context of `consume` (DP-103). */
  token: string;
  grantId: string;
  requestId: string;
  reference: string;
  documentId: string;
  revision: { id: string; revisionNumber: number; storageKey: string };
  recipientLabel: string;
  issuedAt: Date;
}

@Injectable()
export class DocumentGrantsService {
  constructor(@Inject(Clock) private readonly clock: Clock) {}

  async find(
    site: PublicSite,
    token: string | undefined,
    documentId: string,
  ): Promise<GrantForDownload | null> {
    if (!token || !isWellFormedToken(token)) return null;
    // DP-103: row-level security opens only the grant of this token (and its request).
    return site.leadData({ grantToken: token }, (db) => this.findIn(db, site, token, documentId));
  }

  private async findIn(
    db: SiteScopedClient,
    site: PublicSite,
    token: string,
    documentId: string,
  ): Promise<GrantForDownload | null> {
    const now = this.clock.now();
    const grant = await db.documentDownloadGrant.findFirst({
      where: { siteId: site.siteId, tokenHash: hashToken(token) },
      select: { id: true, requestId: true, expiresAt: true, downloadCount: true, createdAt: true },
    });
    if (!grant || grant.expiresAt <= now || grant.downloadCount >= DOWNLOAD_GRANT_MAX_DOWNLOADS) {
      return null;
    }
    const request = await db.leadDocumentRequest.findFirst({
      where: { id: grant.requestId, siteId: site.siteId },
      select: {
        reference: true,
        documentId: true,
        revisionId: true,
        fullName: true,
        company: true,
      },
    });
    // An anonymised request has no reference (DP-096): nothing can be stamped for it any more.
    if (!request || request.documentId !== documentId || request.reference === null) return null;
    const revision = await db.productDocumentRevision.findUnique({
      where: { id: request.revisionId },
      select: { id: true, revisionNumber: true, storageKey: true, documentId: true },
    });
    if (!revision || revision.documentId !== documentId) return null;
    return {
      token,
      grantId: grant.id,
      requestId: grant.requestId,
      reference: request.reference,
      documentId,
      revision: {
        id: revision.id,
        revisionNumber: revision.revisionNumber,
        storageKey: revision.storageKey,
      },
      recipientLabel: `${request.fullName} (${request.company})`,
      issuedAt: grant.createdAt,
    };
  }

  /** Counts one download and records it; false when the grant expired or was used up meanwhile. */
  async consume(
    site: PublicSite,
    grant: GrantForDownload,
    delivered: Buffer,
    ctx: RequestContext,
  ): Promise<boolean> {
    const now = this.clock.now();
    const sha256 = createHash("sha256").update(delivered).digest("hex");
    return site.leadData({ grantToken: grant.token }, async (tx) => {
      const taken = await tx.documentDownloadGrant.updateMany({
        where: {
          id: grant.grantId,
          siteId: site.siteId,
          downloadCount: { lt: DOWNLOAD_GRANT_MAX_DOWNLOADS },
          expiresAt: { gt: now },
        },
        data: { downloadCount: { increment: 1 }, lastDownloadAt: now },
      });
      if (taken.count !== 1) return false;
      const download = await tx.leadDocumentDownload.create({
        data: {
          requestId: grant.requestId,
          grantId: grant.grantId,
          siteId: site.siteId,
          byteSize: delivered.length,
          sha256,
          httpRequestId: ctx.requestId,
          deliveredAt: now,
        },
        select: { id: true },
      });
      await writeAudit(tx as unknown as Db, {
        actorType: "SYSTEM",
        action: "catalog.document_lead_download",
        resourceType: "product_document",
        resourceId: grant.documentId,
        scopeType: "SITE",
        siteId: site.siteId,
        outcome: "SUCCESS",
        metadata: {
          requestId: grant.requestId,
          grantId: grant.grantId,
          downloadId: download.id,
          revisionId: grant.revision.id,
          sha256,
        },
        requestId: ctx.requestId,
      });
      return true;
    });
  }
}
