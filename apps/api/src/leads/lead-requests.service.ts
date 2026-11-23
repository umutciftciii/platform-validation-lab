/**
 * Public lead requests for `LEAD_REQUIRED` documents (DP-042; ADR-016 D1-D4, D7, D9).
 *
 * The site's server forwards the short form with its proxy key; the site comes from the key. In
 * order: body validation (strict; honeypot must be empty), current notice versions, rate limits
 * (IP prefix, e-mail per site, site total; before anything is written), the document must be one
 * this site lists right now, then ONE transaction writes the lead (latest details), the request
 * with its consent evidence and the pinned revision, the download grant (token hash only) and an
 * audit event without personal data. The token is returned once, to the site's server only.
 *
 * DP-095 (D-T3, D-T5): in production the form is refused like an unknown document while the
 * privacy texts are drafts (`privacyBlockers()`, e.g. the owner's controller details are missing).
 *
 * ML-10 (DP-241, ADR-028 D12): the form names its language (none: English, as older sites send).
 * A language without texts that may be offered (a translation still under DP-095 review) or that
 * is not public on the site is refused like an unknown document (404); the versions must be that
 * language's current ones (consent.ts). The request stores the language; its texts' language is
 * the one their version names (a database CHECK keeps the two equal).
 */
import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  DOWNLOAD_GRANT_MAX_DOWNLOADS,
  DOWNLOAD_GRANT_TTL_MINUTES,
  LEAD_FORM_DEFAULT_LOCALE,
  LeadDocumentRequestInputSchema,
  isFreeMailDomain,
  legalTextsFor,
  privacyPublication,
  type LeadDocumentRequestResponse,
  type LegalTextRegistry,
} from "@dream/contracts";
import { API_CONFIG, type ApiConfig } from "../iam/http/api-config.js";
import { generateToken, hashToken } from "../iam/auth/tokens.js";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { PublicSiteService } from "../iam/public-site.js";
import { PUBLIC_RATE_LIMITS, PublicRateLimitService, ipSubject } from "../iam/public-rate-limit.js";
import { writeAudit } from "../iam/staff/audit-writer.js";
import type { Db } from "../iam/db.js";
import { leadDocumentOnSite } from "../catalog/live.js";
import { consentIssue, evidenceSha256, newRequestReference } from "./consent.js";
import { LEAD_LEGAL_TEXTS, formLocaleIsPublic, leadLegalTexts } from "./form-locale.js";

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

@Injectable()
export class LeadRequestsService {
  constructor(
    @Inject(PublicSiteService) private readonly sites: PublicSiteService,
    @Inject(PublicRateLimitService) private readonly limits: PublicRateLimitService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Optional() @Inject(LEAD_LEGAL_TEXTS) private readonly legalTexts?: LegalTextRegistry,
  ) {}

  async request(ctx: RequestContext, body: unknown): Promise<LeadDocumentRequestResponse> {
    if (!privacyPublication(this.config.deployEnv).publish) throw new ApiError("NOT_FOUND");
    const input = parseBody(LeadDocumentRequestInputSchema, body);
    // ML-10: the texts of the form's language; none may be offered: no form in that language.
    const locale = input.locale ?? LEAD_FORM_DEFAULT_LOCALE;
    const texts = legalTextsFor(locale, leadLegalTexts(this.legalTexts));
    if (!texts) throw new ApiError("NOT_FOUND");
    const issue = consentIssue(input, texts);
    if (issue) throw new ApiError("VALIDATION_FAILED", [issue]);
    const site = await this.sites.begin(ctx);
    await this.limits.consume([
      { name: "lead_request_ip", subject: ipSubject(ctx), ...PUBLIC_RATE_LIMITS.leadRequestPerIp },
      {
        name: "lead_request_email",
        subject: `${site.siteId}\0${input.email}`,
        ...PUBLIC_RATE_LIMITS.leadRequestPerEmail,
      },
      { name: "lead_request_site", subject: site.siteId, ...PUBLIC_RATE_LIMITS.leadRequestPerSite },
    ]);
    // ML-10 (ADR-028 D14): a language that is not public on this site has no form (fail closed).
    if (!(await formLocaleIsPublic(site, locale))) throw new ApiError("NOT_FOUND");
    const target = await leadDocumentOnSite(site, input.documentId.toLowerCase());
    if (!target) throw new ApiError("NOT_FOUND");

    const now = this.clock.now();
    const token = generateToken();
    const expiresAt = new Date(now.getTime() + DOWNLOAD_GRANT_TTL_MINUTES * 60 * 1000);
    const ipPrefixHmac = this.limits.ipPrefixDigest(ctx);
    // DP-103: the database context is this site plus the visitor's own e-mail and the new token;
    // row-level security opens that lead and that grant only.
    const write = () =>
      site.leadData({ leadEmail: input.email, grantToken: token }, async (tx) => {
        const existing = await tx.lead.findFirst({
          where: { siteId: site.siteId, email: input.email },
          select: { id: true },
        });
        const details = {
          fullName: input.fullName,
          company: input.company,
          country: input.country,
          freeMailDomain: isFreeMailDomain(input.email),
          lastRequestAt: now,
          ...(input.marketingConsent ? { marketingConsentAt: now } : {}),
        };
        const lead = existing
          ? await tx.lead.update({
              where: { id: existing.id },
              data: { ...details, requestCount: { increment: 1 } },
              select: { id: true },
            })
          : await tx.lead.create({
              data: {
                ...details,
                siteId: site.siteId,
                email: input.email,
                requestCount: 1,
                firstRequestAt: now,
              },
              select: { id: true },
            });
        const request = await tx.leadDocumentRequest.create({
          data: {
            reference: newRequestReference(),
            leadId: lead.id,
            siteId: site.siteId,
            productId: target.productId,
            documentId: target.documentId,
            revisionId: target.revisionId,
            fullName: input.fullName,
            company: input.company,
            country: input.country,
            privacyNoticeVersion: texts.privacyNotice.version,
            privacyNoticeSha256: evidenceSha256(texts.privacyNotice.text),
            marketingConsent: input.marketingConsent,
            marketingConsentVersion: input.marketingConsent ? texts.marketingConsent.version : null,
            marketingConsentSha256: input.marketingConsent
              ? evidenceSha256(texts.marketingConsent.text)
              : null,
            locale,
            ipPrefixHmac,
            requestId: ctx.requestId,
            createdAt: now,
          },
          select: { id: true, reference: true },
        });
        const grant = await tx.documentDownloadGrant.create({
          data: {
            requestId: request.id,
            siteId: site.siteId,
            tokenHash: hashToken(token),
            expiresAt,
            createdAt: now,
          },
          select: { id: true },
        });
        await writeAudit(tx as unknown as Db, {
          actorType: "SYSTEM",
          action: "leads.document_request_created",
          resourceType: "lead_document_request",
          resourceId: request.id,
          scopeType: "SITE",
          siteId: site.siteId,
          outcome: "SUCCESS",
          metadata: {
            documentId: target.documentId,
            revisionId: target.revisionId,
            productId: target.productId,
            grantId: grant.id,
            newLead: !existing,
            marketingConsent: input.marketingConsent,
            // ML-10: the form's language and the text versions stored as evidence (no personal data).
            locale,
            privacyNoticeVersion: texts.privacyNotice.version,
            marketingConsentVersion: input.marketingConsent ? texts.marketingConsent.version : null,
          },
          requestId: ctx.requestId,
        });
        // Just written: a reference is cleared only by a later anonymisation (DP-096).
        if (request.reference === null) throw new Error("lead request written without a reference");
        return request.reference;
      });
    let reference: string;
    try {
      reference = await write();
    } catch (e) {
      // Two first requests of one e-mail at once: the second sees the new lead on retry.
      if (!isUniqueViolation(e)) throw e;
      reference = await write();
    }
    return {
      reference,
      grant: {
        token,
        expiresAt: expiresAt.toISOString(),
        maxDownloads: DOWNLOAD_GRANT_MAX_DOWNLOADS,
      },
    };
  }
}
