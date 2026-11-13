// PM-3: the image processing gate bounds parallel decodes, refuses beyond its queue and measures
// memory per run.
import { describe, expect, it } from "vitest";
import {
  ImageGateBusy,
  ImageProcessingGate,
  imageGateFromEnv,
} from "../../../src/media/image-gate.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("image processing gate", () => {
  it("runs one at a time, queues up to the limit and refuses the rest at once", async () => {
    const gate = new ImageProcessingGate(1, 2);
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const blockers = [deferred(), deferred(), deferred()];
    const job = (name: string, i: number) =>
      gate.run(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        order.push(`start ${name}`);
        await blockers[i]!.promise;
        running--;
        return name;
      });
    const a = job("a", 0);
    const b = job("b", 1);
    const c = job("c", 2);
    await expect(gate.run(async () => "d")).rejects.toBeInstanceOf(ImageGateBusy);
    expect(gate.snapshot()).toMatchObject({ active: 1, queued: 2, rejectedBusy: 1 });
    blockers.forEach((d) => d.resolve());
    expect(await Promise.all([a, b, c])).toEqual(["a", "b", "c"]);
    expect(maxRunning).toBe(1);
    expect(order).toEqual(["start a", "start b", "start c"]);
    expect(gate.snapshot()).toMatchObject({ active: 0, queued: 0, processed: 3 });
  });

  it("frees the slot when a run fails and counts the failure", async () => {
    const gate = new ImageProcessingGate(1, 0);
    await expect(gate.run(async () => Promise.reject(new Error("bad image")))).rejects.toThrow();
    expect(await gate.run(async () => 42)).toBe(42);
    expect(gate.snapshot()).toMatchObject({ active: 0, failed: 1, processed: 1 });
  });

  it("records the memory growth and the peak of a run", async () => {
    let rss = 100;
    const gate = new ImageProcessingGate(1, 0, () => rss);
    await gate.run(async () => {
      rss = 400;
      await new Promise((r) => setTimeout(r, 60));
      rss = 150;
    });
    const m = gate.snapshot();
    expect(m.peakRssBytes).toBe(400);
    expect(m.lastRssDeltaBytes).toBe(300);
    expect(m.maxRssDeltaBytes).toBe(300);
  });

  it("reads its limits from the environment and refuses nonsense", () => {
    expect(imageGateFromEnv({}).snapshot()).toMatchObject({ concurrency: 1, maxQueue: 4 });
    expect(
      imageGateFromEnv({ DP_IMAGE_CONCURRENCY: "2", DP_IMAGE_QUEUE: "0" }).snapshot(),
    ).toMatchObject({ concurrency: 2, maxQueue: 0 });
    expect(() => imageGateFromEnv({ DP_IMAGE_CONCURRENCY: "0" })).toThrow(/DP_IMAGE_CONCURRENCY/);
    expect(() => imageGateFromEnv({ DP_IMAGE_QUEUE: "x" })).toThrow(/DP_IMAGE_QUEUE/);
  });
});
