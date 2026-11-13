import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { planRetention } from "./retention.js";

/**
 * DP-096 scheduled retention job, DRY-RUN only (D-R6). The API runs as dp_app, which cannot clear
 * or delete lead data at all; it only plans with the same code the operator's run uses and logs
 * the counts (no names, e-mails or ids). Real anonymisation is an operator action
 * (`stack.sh leads retention <mode> --apply`), and in production it needs the owner's separate
 * approval. Interval: LEAD_RETENTION_REPORT_INTERVAL_MINUTES (default once a day; 0 = off).
 */
@Injectable()
export class LeadRetentionReportService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("LeadRetention");
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  static intervalMinutes(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env["LEAD_RETENTION_REPORT_INTERVAL_MINUTES"];
    if (raw === undefined || raw === "") return 24 * 60;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 24 * 60;
  }

  onApplicationBootstrap(): void {
    const minutes = LeadRetentionReportService.intervalMinutes();
    if (minutes === 0) return;
    this.timer = setInterval(() => void this.tick(), minutes * 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const plan = await planRetention(this.prisma, now);
      this.logger.log(`dry-run ${JSON.stringify(plan)}`);
    } catch (error) {
      this.logger.error(`dry-run failed: ${(error as Error).name}`);
    } finally {
      this.running = false;
    }
  }
}
