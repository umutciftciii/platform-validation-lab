/**
 * DP-287 (ADR-030 D1, D2): platform-wide module switches. The first platform module is the AI
 * Center (`ai`); its state lives in "PlatformModuleState" (migration dp_287), OFF by default, and
 * only the system owner changes it in the Owner Console (`module:manage`, owner.service.ts).
 *
 * Reading (SECURITY DEFINER functions of the migration; booleans and keys only, tagged templates):
 *  - `isPlatformModuleEnabled`: the current state. A missing row is off (fail closed); a database
 *    error is never read as "on" (it propagates).
 *  - `enabledPlatformModules`: the enabled keys, for the authorization snapshot (`decide` refuses
 *    every permission of a platform module that is off, whoever holds it).
 *  - `PlatformModuleService.whileEnabled`: runs work in ONE transaction that holds the module's
 *    switch (a shared advisory lock of the module, then its state row FOR SHARE). The owner's
 *    switch takes the exclusive advisory lock first (`lockPlatformModuleSwitch`): it waits only
 *    for the holders already running (new holders queue behind it, so a stream of AI work cannot
 *    starve the switch-off), and every transaction that starts after the switch-off COMMIT sees
 *    "off" and is refused. The AI budget reservation and the start of a provider call (DP-290,
 *    DP-291) run inside it, so no new provider call can start once the owner has switched AI
 *    off.
 *
 * Listeners (`onChange`) hear about a committed change in this process (e.g. DP-291 cancels its
 * queue and aborts running calls when AI is switched off). They are a fast path only: correctness
 * comes from `whileEnabled`, which every start must pass.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { Db } from "./db.js";

/** The AI Center (ADR-030). */
export const AI_MODULE = "ai";

/** Limits of a `whileEnabled` transaction: the switch is held only for short work. */
export const WHILE_ENABLED_LOCK_TIMEOUT_MS = 5_000;
export const WHILE_ENABLED_TIMEOUT_MS = 10_000;

export async function isPlatformModuleEnabled(db: Db, moduleKey: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ enabled: boolean | null }[]>`
    SELECT platform_module_enabled(${moduleKey}) AS "enabled"`;
  return rows[0]?.enabled === true;
}

/** The state, holding the row with FOR SHARE until the transaction of `tx` ends. */
export async function holdPlatformModuleEnabled(
  tx: Prisma.TransactionClient,
  moduleKey: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ enabled: boolean | null }[]>`
    SELECT platform_module_hold_enabled(${moduleKey}) AS "enabled"`;
  return rows[0]?.enabled === true;
}

/** The owner's switch: waits for the running holders, then keeps new ones out until COMMIT. */
export async function lockPlatformModuleSwitch(
  tx: Prisma.TransactionClient,
  moduleKey: string,
): Promise<void> {
  await tx.$queryRaw`SELECT platform_module_switch_lock(${moduleKey}) AS "locked"`;
}

export async function enabledPlatformModules(db: Db): Promise<Set<string>> {
  const rows = await db.$queryRaw<{ keys: string[] | null }[]>`
    SELECT platform_modules_enabled() AS "keys"`;
  return new Set(rows[0]?.keys ?? []);
}

export class PlatformModuleDisabledError extends Error {
  override name = "PlatformModuleDisabledError";
  constructor(readonly moduleKey: string) {
    super(`platform module ${moduleKey} is off`);
  }
}

export interface PlatformModuleChange {
  moduleKey: string;
  enabled: boolean;
}
export type PlatformModuleListener = (change: PlatformModuleChange) => void | Promise<void>;

@Injectable()
export class PlatformModuleService {
  private readonly logger = new Logger("PlatformModules");
  private readonly listeners = new Set<PlatformModuleListener>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  isEnabled(moduleKey: string): Promise<boolean> {
    return isPlatformModuleEnabled(this.prisma, moduleKey);
  }

  /**
   * Runs `fn` in one transaction that holds the module switch (see the file comment). Refuses
   * with PlatformModuleDisabledError, before `fn` runs, when the module is off.
   */
  whileEnabled<T>(moduleKey: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${String(WHILE_ENABLED_LOCK_TIMEOUT_MS)}, true)`;
        if (!(await holdPlatformModuleEnabled(tx, moduleKey))) {
          throw new PlatformModuleDisabledError(moduleKey);
        }
        return fn(tx);
      },
      { timeout: WHILE_ENABLED_TIMEOUT_MS, maxWait: WHILE_ENABLED_LOCK_TIMEOUT_MS },
    );
  }

  /** Subscribes to committed changes in this process; returns the unsubscribe function. */
  onChange(listener: PlatformModuleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called by the Owner Console after the change COMMITTED. A failing listener is logged only. */
  async changed(change: PlatformModuleChange): Promise<void> {
    for (const listener of [...this.listeners]) {
      try {
        await listener(change);
      } catch (error) {
        this.logger.error(
          `listener failed for ${change.moduleKey}: ${(error as Error).name ?? "Error"}`,
        );
      }
    }
  }
}
