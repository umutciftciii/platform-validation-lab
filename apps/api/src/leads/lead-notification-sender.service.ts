/**
 * Sends the staff notifications of new contact-form messages (DP-221, ADR-026 D4).
 *
 * The public form writes the message, its lead and a PENDING "LeadNotification" in ONE
 * transaction and answers the visitor; this sender delivers afterwards. So a slow or broken mail
 * server never loses, delays or fails the CRM record, and a crash between the two leaves a row
 * that the next run picks up.
 *
 * One run: take due PENDING rows (oldest first), claim each one (`lockedUntil`, so a second API
 * instance skips it), then:
 *  - transport `off`                         → SKIPPED `transport_off`
 *  - no settings / notifications switched off → SKIPPED `disabled`
 *  - nobody on the list reads the site's leads now (lead:read, checked by the database on every
 *    run, so revoked staff stop getting mail at once) → SKIPPED `no_recipients`
 *  - otherwise one e-mail to the eligible people → SENT, or on failure a retry after 1, 5, 15
 *    and 60 minutes; a permanent failure or the fifth failed attempt → FAILED.
 *
 * The e-mail carries no personal data and no message text: the site, the time and a link to the
 * lead in the admin console (sign-in and lead:read required). The log and the audit trail carry
 * ids, counts and reason codes only.
 *
 * Cross-site by design and outside any request: uses the unscoped client (eslint
 * INFRASTRUCTURE). The notification rows and settings hold no customer data (their row-level
 * security lets dp_app read them); the lead tables are not read here.
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { API_CONFIG, type ApiConfig } from "../iam/http/api-config.js";
import { Clock } from "../iam/http/clock.js";
import { notificationEligible } from "../iam/iam-context.js";
import { writeAudit } from "../iam/staff/audit-writer.js";
import type { Db } from "../iam/db.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  MAIL_SENDER,
  MailDeliveryError,
  type MailMessage,
  type MailSender,
} from "../notifications/mail.js";

export const LEAD_NOTIFICATION_SENDER = "DP_LEAD_NOTIFICATION_SENDER";

/** Minutes to wait after the 1st, 2nd, 3rd and 4th failed attempt; the 5th is final. */
export const RETRY_MINUTES = [1, 5, 15, 60] as const;
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
const CLAIM_MS = 2 * 60_000;
const BATCH = 20;

export interface SenderRun {
  sent: number;
  skipped: number;
  retried: number;
  failed: number;
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Amsterdam",
});

/** The notification e-mail: no personal data, no message text (ADR-026 D6). */
export function notificationMail(input: {
  to: readonly string[];
  siteName: string;
  receivedAt: Date;
  leadUrl: string;
}): MailMessage {
  return {
    to: input.to,
    subject: `New contact form message – ${input.siteName}`,
    text: [
      `A new message arrived through the contact form of ${input.siteName}`,
      `on ${DATE.format(input.receivedAt)} (Amsterdam time).`,
      "",
      "It is stored in the CRM. Open the lead in the admin console (sign-in required):",
      input.leadUrl,
      "",
      "For privacy, this e-mail does not contain the sender's details or the message.",
      `You receive it because you are on the contact-form notification list of ${input.siteName}.`,
      "Lead managers change that list under Leads › Notifications.",
    ].join("\n"),
  };
}

@Injectable()
export class LeadNotificationSender implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("LeadNotifications");
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<SenderRun> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  /** LEAD_NOTIFICATION_INTERVAL_SECONDS (default 30; 0 = no timer, tests call runOnce). */
  static intervalSeconds(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env["LEAD_NOTIFICATION_INTERVAL_SECONDS"];
    if (raw === undefined || raw === "") return 30;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 30;
  }

  onApplicationBootstrap(): void {
    const seconds = LeadNotificationSender.intervalSeconds();
    if (seconds === 0) return;
    this.timer = setInterval(() => void this.runOnce().catch(() => undefined), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over the due notifications. Concurrent calls share the running pass. */
  runOnce(): Promise<SenderRun> {
    if (!this.running) {
      this.running = this.pass().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async pass(): Promise<SenderRun> {
    const result: SenderRun = { sent: 0, skipped: 0, retried: 0, failed: 0 };
    try {
      const now = this.clock.now();
      const due = await this.prisma.leadNotification.findMany({
        where: {
          status: "PENDING",
          nextAttemptAt: { lte: now },
          OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
        },
        orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
        take: BATCH,
        select: { id: true },
      });
      for (const { id } of due) {
        const outcome = await this.deliver(id);
        if (outcome) result[outcome] += 1;
      }
    } catch (error) {
      this.logger.error(`run failed: ${(error as Error).name}`);
    }
    if (result.sent + result.skipped + result.retried + result.failed > 0) {
      this.logger.log(`run ${JSON.stringify(result)}`);
    }
    return result;
  }

  private async deliver(id: string): Promise<keyof SenderRun | null> {
    const now = this.clock.now();
    const claimed = await this.prisma.leadNotification.updateMany({
      where: {
        id,
        status: "PENDING",
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: { lockedUntil: new Date(now.getTime() + CLAIM_MS) },
    });
    if (claimed.count !== 1) return null;
    const row = await this.prisma.leadNotification.findUniqueOrThrow({
      where: { id },
      select: { id: true, siteId: true, leadId: true, attempts: true, createdAt: true },
    });

    if (this.mail.transport === "off") return this.skip(row, "transport_off");
    const setting = await this.prisma.leadNotificationSetting.findUnique({
      where: { siteId: row.siteId },
      select: { enabled: true, recipientUserIds: true },
    });
    if (!setting?.enabled) return this.skip(row, "disabled");
    const eligible = await notificationEligible(
      this.prisma as unknown as Db,
      row.siteId,
      setting.recipientUserIds,
    );
    const people = await this.prisma.user.findMany({
      where: { id: { in: eligible }, status: "ACTIVE", kind: "STAFF" },
      select: { id: true, email: true },
      orderBy: { id: "asc" },
    });
    if (people.length === 0) return this.skip(row, "no_recipients");
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: row.siteId },
      select: { name: true },
    });

    const attempt = row.attempts + 1;
    try {
      await this.mail.send(
        notificationMail({
          to: people.map((p) => p.email),
          siteName: site.name,
          receivedAt: row.createdAt,
          leadUrl: `${this.config.adminBaseUrl}/leads/${row.leadId}`,
        }),
      );
    } catch (error) {
      const failure =
        error instanceof MailDeliveryError ? error : new MailDeliveryError("smtp_error", false);
      const final = failure.permanent || attempt >= MAX_ATTEMPTS;
      const later = this.clock.now();
      await this.prisma.leadNotification.update({
        where: { id: row.id },
        data: final
          ? { status: "FAILED", attempts: attempt, reason: failure.code, lockedUntil: null }
          : {
              attempts: attempt,
              reason: failure.code,
              lockedUntil: null,
              nextAttemptAt: new Date(
                later.getTime() + (RETRY_MINUTES[attempt - 1] ?? 60) * 60_000,
              ),
            },
      });
      this.logger.warn(
        `notification ${row.id}: attempt ${attempt} failed (${failure.code})${final ? ", final" : ", will retry"}`,
      );
      if (final) {
        await this.audit(row, "leads.notification_failed", "FAILURE", {
          attempts: attempt,
          reason: failure.code,
        });
        return "failed";
      }
      return "retried";
    }
    await this.prisma.leadNotification.update({
      where: { id: row.id },
      data: {
        status: "SENT",
        attempts: attempt,
        sentAt: this.clock.now(),
        recipientCount: people.length,
        reason: null,
        lockedUntil: null,
      },
    });
    await this.audit(row, "leads.notification_sent", "SUCCESS", {
      attempts: attempt,
      transport: this.mail.transport,
      recipientUserIds: people.map((p) => p.id),
    });
    return "sent";
  }

  private async skip(
    row: { id: string; siteId: string; leadId: string; attempts: number },
    reason: string,
  ): Promise<"skipped"> {
    await this.prisma.leadNotification.update({
      where: { id: row.id },
      data: { status: "SKIPPED", reason, lockedUntil: null },
    });
    await this.audit(row, "leads.notification_skipped", "SUCCESS", { reason });
    return "skipped";
  }

  private audit(
    row: { id: string; siteId: string; leadId: string },
    action: string,
    outcome: "SUCCESS" | "FAILURE",
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return writeAudit(this.prisma as unknown as Db, {
      actorType: "SYSTEM",
      action,
      resourceType: "lead_notification",
      resourceId: row.id,
      scopeType: "SITE",
      siteId: row.siteId,
      outcome,
      ...(outcome === "FAILURE" ? { reason: String(metadata["reason"] ?? "failed") } : {}),
      // Ids, counts and codes only: no address, no name, no message text.
      metadata: { leadId: row.leadId, ...metadata },
      requestId: null,
    });
  }
}
