import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { runAuthCleanup } from "./cleanup.js";

/**
 * Runs the authentication clean-up periodically inside the API (design 8.6). Interval from
 * IAM_CLEANUP_INTERVAL_MINUTES (default 15; 0 disables it, e.g. for a one-off tool process).
 * The first round runs one interval after start. Timers are unref'd, so they never keep the
 * process alive, and failures are logged without row data.
 */
@Injectable()
export class AuthCleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("AuthCleanup");
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  static intervalMinutes(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env["IAM_CLEANUP_INTERVAL_MINUTES"];
    if (raw === undefined || raw === "") return 15;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 15;
  }

  onApplicationBootstrap(): void {
    const minutes = AuthCleanupService.intervalMinutes();
    if (minutes === 0) return;
    this.timer = setInterval(() => void this.tick(), minutes * 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await runAuthCleanup(this.prisma);
      if (result) this.logger.log(`removed ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error(`clean-up failed: ${(error as Error).name}`);
    } finally {
      this.running = false;
    }
  }
}
