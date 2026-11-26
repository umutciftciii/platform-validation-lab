/**
 * DP-290 (ADR-030 D6, D2): the budget engine of the API.
 *
 *  - `reserve` runs in the caller's staff transaction: the database checks ai:invoke, holds the AI
 *    switch, applies the local ceiling of DP_AI_TRANSPORT=live in the local deployment and moves
 *    the money atomically (ai_reserve). The caller gives token upper bounds (estimate.ts), never a
 *    text.
 *  - `start`, `settle`, `release`, `markUnknown` need no staff context (the DP-291 worker).
 *    Every one is idempotent; none ever retries a provider call.
 *  - The sweeper (every AI_SWEEP_INTERVAL_SECONDS, default 60; 0 = off) releases expired
 *    reservations and counts expired calls as spent (crash recovery = lease expiry). When the
 *    owner switches AI off, the switch listener sweeps at once: every queued reservation is
 *    CANCELLED; running calls are aborted by the DP-291 runner and end UNKNOWN or DISCARDED.
 */
import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { inStaffContext } from "../iam/iam-context.js";
import { AI_MODULE, PlatformModuleService } from "../iam/platform-modules.js";
import { AI_CONFIG } from "./config/ai-config.provider.js";
import type { AiConfig } from "./config/ai-config.js";
import {
  sqlLedgerMismatches,
  sqlMarkUnknown,
  sqlRelease,
  sqlReserve,
  sqlSettle,
  sqlStart,
  sqlSweep,
  type ReserveArgs,
  type ReserveResult,
  type SettleArgs,
} from "./ledger-sql.js";

export function sweepIntervalSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["AI_SWEEP_INTERVAL_SECONDS"];
  if (raw === undefined || raw.trim() === "") return 60;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 3600 ? n : 60;
}

@Injectable()
export class AiLedgerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("AiLedger");
  /** This API process; a reservation and a start record it (diagnostics). */
  readonly instanceId = `api-${randomUUID()}`;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private unsubscribe: (() => void) | undefined;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlatformModuleService) private readonly modules: PlatformModuleService,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.unsubscribe = this.modules.onChange(async (change) => {
      if (change.moduleKey === AI_MODULE && !change.enabled) await this.sweep();
    });
    const seconds = sweepIntervalSeconds();
    if (seconds > 0) {
      this.timer = setInterval(() => void this.sweep(), seconds * 1000);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
  }

  /** One reservation in the staff session's database context (the session token). */
  reserve(
    sessionToken: string,
    args: Omit<ReserveArgs, "instanceId" | "capDailyMicros" | "capMonthlyMicros">,
  ): Promise<ReserveResult> {
    const cap = this.config.localCap;
    return inStaffContext(this.prisma, sessionToken, (tx) =>
      sqlReserve(tx, {
        ...args,
        instanceId: this.instanceId,
        capDailyMicros: cap?.dailyMicros ?? null,
        capMonthlyMicros: cap?.monthlyMicros ?? null,
      }),
    );
  }

  start(operationId: string, leaseSec: number): Promise<string> {
    return this.prisma.$transaction((tx) => sqlStart(tx, operationId, this.instanceId, leaseSec));
  }

  settle(operationId: string, args: SettleArgs): Promise<string> {
    return this.prisma.$transaction((tx) => sqlSettle(tx, operationId, args));
  }

  release(operationId: string, reason: "cancel" | "release" | "expire"): Promise<string> {
    return this.prisma.$transaction((tx) => sqlRelease(tx, operationId, reason));
  }

  markUnknown(operationId: string, code: string): Promise<string> {
    return this.prisma.$transaction((tx) => sqlMarkUnknown(tx, operationId, code));
  }

  mismatches(): Promise<number> {
    return sqlLedgerMismatches(this.prisma);
  }

  async sweep(): Promise<{ released: number; assumed: number; cancelled: number } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const r = await this.prisma.$transaction((tx) => sqlSweep(tx));
      if (r.released || r.assumed || r.cancelled) {
        this.logger.log(
          `sweep: released ${r.released}, assumed ${r.assumed}, cancelled ${r.cancelled}`,
        );
      }
      return r;
    } catch (error) {
      this.logger.error(`sweep failed: ${(error as Error).name}`);
      return null;
    } finally {
      this.running = false;
    }
  }
}
