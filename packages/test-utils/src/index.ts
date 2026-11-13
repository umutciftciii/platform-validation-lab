import type { HealthResponse } from "@dream/contracts";

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

/** Polls a health URL until it answers 200 with status "ok", or throws after the timeout. */
export async function waitForHealthy(
  url: string,
  options: WaitOptions = {},
): Promise<HealthResponse> {
  const { timeoutMs = 60_000, intervalMs = 1_000 } = options;
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) {
        const body = (await res.json()) as HealthResponse;
        if (body.status === "ok") return body;
        lastError = `status ${body.status}`;
      } else {
        lastError = `HTTP ${res.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${url} not healthy after ${timeoutMs} ms: ${lastError}`);
}

export * from "./database-guard.js";
