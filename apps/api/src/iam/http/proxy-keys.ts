/**
 * Per-app proxy keys (F1-002 Group 2; ADR-013 D2, design 2.2, 2.3, 2.9).
 *
 * Each Next app has its own 256-bit key, sent by its server-side proxy as `X-DP-Proxy-Key`. The
 * API derives the calling app from the key alone; there is no client-settable "app" header. Each
 * app has a `current` key and an optional `next` key for rotation: both are accepted until `next`
 * is promoted and the old value removed (runbook: docs/security/proxy-key-rotation.md).
 *
 * Start-up rules (the API refuses to start otherwise; AC-PX-3, NT-P9): every key is base64url
 * with at least 43 characters (32 bytes), the three `current` keys are set, and all configured
 * values (three apps, current and next) are different. Values are never logged: errors name the
 * variable only, and the metrics count slots, not values (NT-P12).
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const AUTH_APPS = ["ADMIN", "WEB_BV", "WEB_CORPORATE"] as const;
export type AuthAppValue = (typeof AUTH_APPS)[number];
export type KeySlot = "current" | "next";

export const PROXY_KEY_ENV: Readonly<Record<AuthAppValue, string>> = {
  ADMIN: "DP_PROXY_KEY_ADMIN",
  WEB_BV: "DP_PROXY_KEY_WEB_BV",
  WEB_CORPORATE: "DP_PROXY_KEY_WEB_CORPORATE",
};

export const MIN_PROXY_KEY_LENGTH = 43;
const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

export class ProxyKeyConfigError extends Error {
  override name = "ProxyKeyConfigError";
}

interface KeyEntry {
  app: AuthAppValue;
  slot: KeySlot;
  digest: Buffer;
}

export interface ProxyKeyring {
  readonly entries: readonly KeyEntry[];
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

function readKey(env: NodeJS.ProcessEnv, name: string, required: boolean): string | null {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    if (required) throw new ProxyKeyConfigError(`${name} is not set`);
    return null;
  }
  const value = raw.trim();
  if (!KEY_PATTERN.test(value)) throw new ProxyKeyConfigError(`${name} must be base64url`);
  if (value.length < MIN_PROXY_KEY_LENGTH) {
    throw new ProxyKeyConfigError(
      `${name} must have at least ${MIN_PROXY_KEY_LENGTH} characters (32 random bytes)`,
    );
  }
  return value;
}

/** Reads `DP_PROXY_KEY_<APP>` and `DP_PROXY_KEY_<APP>_NEXT` for the three apps. */
export function parseProxyKeys(env: NodeJS.ProcessEnv = process.env): ProxyKeyring {
  const entries: KeyEntry[] = [];
  const seen = new Map<string, string>();
  for (const app of AUTH_APPS) {
    const base = PROXY_KEY_ENV[app];
    for (const [slot, name, required] of [
      ["current", base, true],
      ["next", `${base}_NEXT`, false],
    ] as const) {
      const value = readKey(env, name, required);
      if (value === null) continue;
      const d = digest(value);
      const hex = d.toString("hex");
      const other = seen.get(hex);
      if (other) throw new ProxyKeyConfigError(`${name} must differ from ${other}`);
      seen.set(hex, name);
      entries.push({ app, slot, digest: d });
    }
  }
  return { entries };
}

/**
 * The app and slot of a presented key, or null. Every configured key is compared, in constant
 * time over equal-length digests, whatever matches first, so timing does not reveal which app or
 * slot a near-miss belongs to.
 */
export function matchProxyKey(
  keyring: ProxyKeyring,
  presented: string | undefined,
): { app: AuthAppValue; slot: KeySlot } | null {
  if (typeof presented !== "string" || presented.length === 0 || presented.length > 512) {
    return null;
  }
  const d = digest(presented);
  let match: { app: AuthAppValue; slot: KeySlot } | null = null;
  for (const entry of keyring.entries) {
    if (timingSafeEqual(entry.digest, d) && match === null) {
      match = { app: entry.app, slot: entry.slot };
    }
  }
  return match;
}

/** Counters published at /health/metrics (values are never part of them). */
export class ProxyKeyMetrics {
  rejected = 0;
  readonly accepted: Record<AuthAppValue, Record<KeySlot, number>> = {
    ADMIN: { current: 0, next: 0 },
    WEB_BV: { current: 0, next: 0 },
    WEB_CORPORATE: { current: 0, next: 0 },
  };

  snapshot() {
    return {
      rejected: this.rejected,
      accepted: JSON.parse(JSON.stringify(this.accepted)) as ProxyKeyMetrics["accepted"],
    };
  }
}
