/**
 * Public contact-form messages (DP-151). Same path as a document request (DP-042, ADR-016):
 *
 * The site's server forwards the form with its proxy key; the site comes from the key. In order:
 * publication gate (drafts never in production, DP-095), strict body validation (honeypot empty),
 * the current notice version (shown next to the form; information, not consent: no tick box and
 * no marketing consent on this form, owner decision 2026-11-13), rate limits (IP prefix, e-mail per site, site total; before anything
 * is written), then ONE transaction in the lead context of this site and e-mail (DP-103 row-level
 * security) writes the lead with the latest details, the message with its consent evidence and an
 * audit event without personal data or message text. A message never touches the lead's
 * marketing consent. The visitor gets no data back.
 *
 * The message moves the lead's `lastRequestAt` (the retention clock starts at the last contact,
 * as the notice says); `requestCount` keeps counting document requests only.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  LeadContactMessageInputSchema,
  isFreeMailDomain,
  privacyPublication,
  type LeadContactMessageResponse,
} from "@dream/contracts";
import { API_CONFIG, type ApiConfig } from "../iam/http/api-config.js";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { PublicSiteService } from "../iam/public-site.js";
import { PUBLIC_RATE_LIMITS, PublicRateLimitService, ipSubject } from "../iam/public-rate-limit.js";
import { writeAudit } from "../iam/staff/audit-writer.js";
import type { Db } from "../iam/db.js";
import { CONTACT_NOTICE_SHA256, contactNoticeVersionProblem } from "./consent.js";

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

@Injectable()
export class ContactMessagesService {
  constructor(
    @Inject(PublicSiteService) private readonly sites: PublicSiteService,
    @Inject(PublicRateLimitService) private readonly limits: PublicRateLimitService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async send(ctx: RequestContext, body: unknown): Promise<LeadContactMessageResponse> {
    if (!privacyPublication(this.config.deployEnv).publish) throw new ApiError("NOT_FOUND");
    const input = parseBody(LeadContactMessageInputSchema, body);
    const problem = contactNoticeVersionProblem(input);
    if (problem) throw new ApiError("VALIDATION_FAILED", [{ path: problem, rule: "outdated" }]);
    const site = await this.sites.begin(ctx);
    await this.limits.consume([
      {
        name: "contact_message_ip",
        subject: ipSubject(ctx),
        ...PUBLIC_RATE_LIMITS.contactMessagePerIp,
      },
      {
        name: "contact_message_email",
        subject: `${site.siteId}\0${input.email}`,
        ...PUBLIC_RATE_LIMITS.contactMessagePerEmail,
      },
      {
        name: "contact_message_site",
        subject: site.siteId,
        ...PUBLIC_RATE_LIMITS.contactMessagePerSite,
      },
    ]);

    const now = this.clock.now();
    const ipPrefixHmac = this.limits.ipPrefixDigest(ctx);
    // DP-103: the database context is this site plus the visitor's own e-mail; row-level security
    // opens that lead and its new message only.
    const write = () =>
      site.leadData({ leadEmail: input.email }, async (tx) => {
        // An anonymised lead never changes again: the same e-mail then starts a new lead.
        const existing = await tx.lead.findFirst({
          where: { siteId: site.siteId, email: input.email, anonymisedAt: null },
          select: { id: true },
        });
        const details = {
          fullName: input.fullName,
          company: input.company,
          country: input.country,
          freeMailDomain: isFreeMailDomain(input.email),
          lastRequestAt: now,
        };
        const lead = existing
          ? await tx.lead.update({
              where: { id: existing.id },
              data: details,
              select: { id: true },
            })
          : await tx.lead.create({
              data: {
                ...details,
                siteId: site.siteId,
                email: input.email,
                requestCount: 0,
                firstRequestAt: now,
              },
              select: { id: true },
            });
        const message = await tx.leadContactMessage.create({
          data: {
            leadId: lead.id,
            siteId: site.siteId,
            fullName: input.fullName,
            company: input.company,
            country: input.country,
            phone: input.phone,
            subject: input.subject,
            message: input.message,
            privacyNoticeVersion: input.privacyNoticeVersion,
            privacyNoticeSha256: CONTACT_NOTICE_SHA256,
            ipPrefixHmac,
            requestId: ctx.requestId,
            createdAt: now,
          },
          select: { id: true },
        });
        await writeAudit(tx as unknown as Db, {
          actorType: "SYSTEM",
          action: "leads.contact_message_created",
          resourceType: "lead_contact_message",
          resourceId: message.id,
          scopeType: "SITE",
          siteId: site.siteId,
          outcome: "SUCCESS",
          // No personal data and no message text in the audit trail.
          metadata: {
            leadId: lead.id,
            newLead: !existing,
            hasPhone: input.phone !== null,
            hasSubject: input.subject !== null,
          },
          requestId: ctx.requestId,
        });
      });
    try {
      await write();
    } catch (e) {
      // Two first messages of one e-mail at once: the second sees the new lead on retry.
      if (!isUniqueViolation(e)) throw e;
      await write();
    }
    return { received: true };
  }
}
