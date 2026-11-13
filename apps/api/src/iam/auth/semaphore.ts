/**
 * Counting semaphore (F1-002, design 3.1). Argon2id needs 19 MiB per hash; at most four run at
 * once so a burst of logins cannot exhaust the API container's memory (T18). Waiters are served
 * in arrival order. `maxObserved` lets the tests prove the bound (NT-T6).
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  maxObserved = 0;

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("semaphore limit must be >= 1");
  }

  get inUse(): number {
    return this.active;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.take();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.take();
        resolve();
      });
    });
  }

  private take(): void {
    this.active++;
    this.maxObserved = Math.max(this.maxObserved, this.active);
  }

  private release(): void {
    this.active--;
    this.waiters.shift()?.();
  }
}
