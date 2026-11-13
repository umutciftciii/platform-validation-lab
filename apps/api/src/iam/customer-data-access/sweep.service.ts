import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { AuthCleanupService } from "../auth/cleanup.service.js";
import { runCustomerDataAccessSweep } from "./sweep.js";

/**
 * Runs the customer-data access sweep (sweep.ts) on the IAM clean-up interval
 * (IAM_CLEANUP_INTERVAL_MINUTES, default 15; 0 disables it). Failures are logged without row data.
 */
@Injectable()
export class CustomerDataAccessSweepService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("CustomerDataAccessSweep");
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
      const result = await runCustomerDataAccessSweep(this.prisma);
      if (result.requestsExpired || result.accessExpired) {
        this.logger.log(`recorded ${JSON.stringify(result)}`);
      }
    } catch (error) {
      this.logger.error(`sweep failed: ${(error as Error).name}`);
    } finally {
      this.running = false;
    }
  }
}
