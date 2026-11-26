/**
 * DP-287 (ADR-030 D2): PlatformModuleService without a database — `whileEnabled` refuses before
 * the work runs when the module is off (and never reads "on" from a missing answer), holds the
 * switch inside the same transaction, and listeners hear about committed changes without one
 * failing listener stopping the others. The real locks and the switch-off race are tested in
 * test/integration/owner.int.test.ts (DP-287 block).
 */
import { describe, expect, it, vi } from "vitest";
import {
  PlatformModuleDisabledError,
  PlatformModuleService,
  isPlatformModuleEnabled,
} from "../../../src/iam/platform-modules.js";

type Answer = { enabled: boolean | null }[];

function fakePrisma(answer: Answer) {
  const statements: string[] = [];
  const tx = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
      statements.push(strings.join("?"));
      return 1;
    }),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      statements.push(strings.join("?"));
      return answer;
    }),
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>, opts: unknown) => {
      statements.push(`BEGIN ${JSON.stringify(opts)}`);
      return fn(tx);
    }),
  };
  return { prisma, statements };
}

describe("DP-287: PlatformModuleService", () => {
  it("refuses before the work runs when the module is off or the answer is missing", async () => {
    for (const answer of [[{ enabled: false }], [{ enabled: null }], []] as Answer[]) {
      const { prisma, statements } = fakePrisma(answer);
      const service = new PlatformModuleService(prisma as never);
      const work = vi.fn(async () => "ran");
      await expect(service.whileEnabled("ai", work)).rejects.toBeInstanceOf(
        PlatformModuleDisabledError,
      );
      expect(work).not.toHaveBeenCalled();
      expect(statements.some((s) => s.includes("platform_module_hold_enabled("))).toBe(true);
    }
  });

  it("runs the work in the transaction that holds the switch, with bounded waits", async () => {
    const { prisma, statements } = fakePrisma([{ enabled: true }]);
    const service = new PlatformModuleService(prisma as never);
    const work = vi.fn(async (tx: unknown) => (tx === undefined ? "no tx" : "ran"));
    await expect(service.whileEnabled("ai", work)).resolves.toBe("ran");
    expect(statements[0]).toBe('BEGIN {"timeout":10000,"maxWait":5000}');
    expect(statements[1]).toContain("set_config('lock_timeout'");
    expect(statements[2]).toContain("platform_module_hold_enabled(");
  });

  it("reads 'on' only from an explicit true", async () => {
    for (const [answer, expected] of [
      [[{ enabled: true }], true],
      [[{ enabled: false }], false],
      [[{ enabled: null }], false],
      [[], false],
    ] as [Answer, boolean][]) {
      const { prisma } = fakePrisma(answer);
      expect(await isPlatformModuleEnabled(prisma as never, "ai")).toBe(expected);
    }
  });

  it("tells every listener about a committed change; a failing listener stops no other", async () => {
    const { prisma } = fakePrisma([]);
    const service = new PlatformModuleService(prisma as never);
    const heard: string[] = [];
    service.onChange(() => {
      throw new Error("boom");
    });
    const off = service.onChange((c) => {
      heard.push(`${c.moduleKey}:${c.enabled}`);
    });
    await service.changed({ moduleKey: "ai", enabled: false });
    expect(heard).toEqual(["ai:false"]);
    off();
    await service.changed({ moduleKey: "ai", enabled: true });
    expect(heard).toEqual(["ai:false"]);
  });
});
