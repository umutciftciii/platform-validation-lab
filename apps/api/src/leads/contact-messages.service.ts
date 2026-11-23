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
 *
 * ML-10 (DP-241, ADR-028 D12): the form names its language (none: English). A language without
 * a notice that may be offered (a translation under DP-095 review) or that is not public on the
 * site is refused (404, like the production gate); the notice version must be that language's
 * current one. The message stores the language.
 *
 * DP-221 (ADR-026): a lead this form creates has the source CONTACT_FORM (an existing lead keeps
 * its own). The same transaction writes a PENDING staff notification (the outbox the
 * notification sender delivers afterwards), so the visitor's 201 means the message is in the CRM
 * whatever happens to the e-mail. The same message (subject and text) from the same e-mail within
 * DUPLICATE_WINDOW_MS is a resend (double click, reload, retry after a lost answer): it answers
 * 201 again without a second message or notification, audited as a duplicate.
 */
import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  LEAD_FORM_DEFAULT_LOCALE,
  LeadContactMessageInputSchema,
  isFreeMailDomain,
  legalTextsFor,
  privacyPublication,
  type LeadContactMessageResponse,
  type LegalTextRegistry,
} from "@dream/contracts";
import { API_CONFIG, type ApiConfig } from "../iam/http/api-config.js";
import { ApiError, parseBody } from "../iam/http/api-error.js";
import { Clock } from "../iam/http/clock.js";
import type { RequestContext } from "../iam/http/request-context.js";
import { PublicSiteService } from "../iam/public-site.js";
import { PUBLIC_RATE_LIMITS, PublicRateLimitService, ipSubject } from "../iam/public-rate-limit.js";
import { writeAudit } from "../iam/staff/audit-writer.js";
import type { Db } from "../iam/db.js";
import { contactNoticeIssue, evidenceSha256 } from "./consent.js";
import { LEAD_LEGAL_TEXTS, formLocaleIsPublic, leadLegalTexts } from "./form-locale.js";

/** A resend of the same message within this window is not stored twice (DP-221). */
export const DUPLICATE_WINDOW_MS = 10 * 60_000;

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
    @Optional() @Inject(LEAD_LEGAL_TEXTS) private readonly legalTexts?: LegalTextRegistry,
  ) {}

  async send(ctx: RequestContext, body: unknown): Promise<LeadContactMessageResponse> {
    if (!privacyPublication(this.config.deployEnv).publish) throw new ApiError("NOT_FOUND");
    const input = parseBody(LeadContactMessageInputSchema, body);
    // ML-10: the notice of the form's language; none may be offered: no form in that language.
    const locale = input.locale ?? LEAD_FORM_DEFAULT_LOCALE;
    const texts = legalTextsFor(locale, leadLegalTexts(this.legalTexts));
    if (!texts) throw new ApiError("NOT_FOUND");
    const issue = contactNoticeIssue(input, texts);
    if (issue) throw new ApiError("VALIDATION_FAILED", [issue]);
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
    // ML-10 (ADR-028 D14): a language that is not public on this site has no form (fail closed).
    if (!(await formLocaleIsPublic(site, locale))) throw new ApiError("NOT_FOUND");

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
        // DP-221: the same message again shortly after (double submit, retry): already stored.
        if (existing) {
          const same = await tx.leadContactMessage.findFirst({
            where: {
              leadId: existing.id,
              siteId: site.siteId,
              subject: input.subject,
              message: input.message,
              createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          if (same) {
            await writeAudit(tx as unknown as Db, {
              actorType: "SYSTEM",
              action: "leads.contact_message_duplicate",
              resourceType: "lead_contact_message",
              resourceId: same.id,
              scopeType: "SITE",
              siteId: site.siteId,
              outcome: "SUCCESS",
              metadata: { leadId: existing.id },
              requestId: ctx.requestId,
            });
            return;
          }
        }
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
                source: "CONTACT_FORM",
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
            privacyNoticeVersion: texts.contactNotice.version,
            privacyNoticeSha256: evidenceSha256(texts.contactNotice.text),
            locale,
            ipPrefixHmac,
            requestId: ctx.requestId,
            createdAt: now,
          },
          select: { id: true },
        });
        // DP-221: the staff notification, delivered after commit by LeadNotificationSender.
        const notification = await tx.leadNotification.create({
          data: { siteId: site.siteId, leadId: lead.id, contactMessageId: message.id },
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
            notificationId: notification.id,
            // ML-10: the form's language and the notice version stored as evidence.
            locale,
            privacyNoticeVersion: texts.contactNotice.version,
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
