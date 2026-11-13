/**
 * Image processing gate (PM-3, image safety). Decoding an image costs far more memory than its
 * file: a 25 MP upload (the largest accepted) is about 75-100 MB of pixels in libvips, plus the
 * 10 MB request body. Without a bound, a handful of parallel uploads could push the API past its
 * container limit. The gate therefore:
 *
 *  - runs at most `concurrency` uploads at a time (default 1), from reading the body to the
 *    last derived variant, so at most that many bodies and decodes are in memory;
 *  - lets at most `maxQueue` more wait (default 4); their bodies are not read yet (the socket
 *    applies back-pressure), and anything beyond is refused at once with 429 (busy);
 *  - measures every run: resident memory before, the peak while it runs (sampled every 20 ms)
 *    and the duration. The figures are exposed by /health/metrics (private network only).
 *
 * Configured with DP_IMAGE_CONCURRENCY (1..4) and DP_IMAGE_QUEUE (0..32).
 */

export class ImageGateBusy extends Error {
  override name = "ImageGateBusy";
}

export interface ImageGateMetrics {
  concurrency: number;
  maxQueue: number;
  active: number;
  queued: number;
  processed: number;
  failed: number;
  rejectedBusy: number;
  /** Resident memory growth of the last run, and the largest seen (bytes). */
  lastRssDeltaBytes: number;
  maxRssDeltaBytes: number;
  /** Highest resident memory observed while an image was processed (bytes). */
  peakRssBytes: number;
  lastDurationMs: number;
}

export class ImageProcessingGate {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  private readonly stats = {
    processed: 0,
    failed: 0,
    rejectedBusy: 0,
    lastRssDeltaBytes: 0,
    maxRssDeltaBytes: 0,
    peakRssBytes: 0,
    lastDurationMs: 0,
  };

  constructor(
    readonly concurrency = 1,
    readonly maxQueue = 4,
    private readonly rss: () => number = () => process.memoryUsage.rss(),
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency >= 1");
    if (!Number.isInteger(maxQueue) || maxQueue < 0) throw new Error("maxQueue >= 0");
  }

  /** Runs `fn` when a slot is free; throws ImageGateBusy at once when the queue is full. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiters.length >= this.maxQueue) {
        this.stats.rejectedBusy++;
        throw new ImageGateBusy("image processing is busy");
      }
      // The finishing run hands its slot over (active stays the same).
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.active++;
    }
    const started = Date.now();
    const before = this.rss();
    let peak = before;
    const sample = setInterval(() => {
      peak = Math.max(peak, this.rss());
    }, 20);
    sample.unref();
    try {
      const result = await fn();
      this.stats.processed++;
      return result;
    } catch (e) {
      this.stats.failed++;
      throw e;
    } finally {
      clearInterval(sample);
      peak = Math.max(peak, this.rss());
      const delta = Math.max(0, peak - before);
      this.stats.lastRssDeltaBytes = delta;
      this.stats.maxRssDeltaBytes = Math.max(this.stats.maxRssDeltaBytes, delta);
      this.stats.peakRssBytes = Math.max(this.stats.peakRssBytes, peak);
      this.stats.lastDurationMs = Date.now() - started;
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }

  snapshot(): ImageGateMetrics {
    return {
      concurrency: this.concurrency,
      maxQueue: this.maxQueue,
      active: this.active,
      queued: this.waiters.length,
      ...this.stats,
    };
  }
}

export function imageGateFromEnv(env: Record<string, string | undefined>): ImageProcessingGate {
  const int = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new Error(`${name} must be an integer from ${min} to ${max}`);
    }
    return n;
  };
  return new ImageProcessingGate(
    int("DP_IMAGE_CONCURRENCY", 1, 1, 4),
    int("DP_IMAGE_QUEUE", 4, 0, 32),
  );
}
