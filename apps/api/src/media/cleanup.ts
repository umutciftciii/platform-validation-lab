/**
 * Orphan clean-up of the media storage (PM-3). An object is an orphan when no ProductImage row
 * refers to it (as its original or a derived variant). Orphans appear when deleting a file after
 * its row failed, or when the process stopped between writing the files of an upload and
 * committing its row (the upload itself removes its files on every handled failure).
 *
 * Safety rules:
 *  - only valid keys (KEY_PATTERN) and the adapter's own temporary names (STRAY_PATTERN) are
 *    ever deleted; any other name is reported and left alone;
 *  - objects younger than the grace period (default 24 h) are skipped: an upload in progress has
 *    written its files but not yet committed its row;
 *  - the default is a dry run; deleting needs `apply`.
 *
 * The referenced keys come from the database (media-cli.ts); this module only compares.
 */
import { KEY_PATTERN, STRAY_PATTERN, type MediaStorage, type StoredObject } from "./storage.js";

export const DEFAULT_GRACE_HOURS = 24;

export interface CleanupPlan {
  scanned: number;
  referenced: number;
  /** Unreferenced keys and stray temporary files older than the grace period. */
  orphans: (StoredObject & { kind: "orphan" | "stray" })[];
  /** Unreferenced, but younger than the grace period. */
  young: number;
  /** Names that are neither keys nor stray files: never deleted. */
  unknown: string[];
  orphanBytes: number;
}

export async function planCleanup(
  storage: MediaStorage,
  referenced: ReadonlySet<string>,
  now: Date,
  graceHours = DEFAULT_GRACE_HOURS,
): Promise<CleanupPlan> {
  const cutoff = now.getTime() - graceHours * 3_600_000;
  const plan: CleanupPlan = {
    scanned: 0,
    referenced: 0,
    orphans: [],
    young: 0,
    unknown: [],
    orphanBytes: 0,
  };
  for await (const obj of storage.list()) {
    plan.scanned++;
    const isKey = KEY_PATTERN.test(obj.key);
    const isStray = !isKey && STRAY_PATTERN.test(obj.key);
    if (!isKey && !isStray) {
      plan.unknown.push(obj.key);
      continue;
    }
    if (isKey && referenced.has(obj.key)) {
      plan.referenced++;
      continue;
    }
    if (obj.lastModified.getTime() > cutoff) {
      plan.young++;
      continue;
    }
    plan.orphans.push({ ...obj, kind: isKey ? "orphan" : "stray" });
    plan.orphanBytes += obj.size;
  }
  return plan;
}

export interface CleanupResult {
  deleted: number;
  failed: number;
}

export async function applyCleanup(
  storage: MediaStorage,
  plan: CleanupPlan,
): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: 0, failed: 0 };
  for (const o of plan.orphans) {
    try {
      if (o.kind === "orphan") await storage.delete(o.key);
      else await storage.deleteStray(o.key);
      result.deleted++;
    } catch {
      result.failed++;
    }
  }
  return result;
}

/** Every key a ProductImage row refers to: its original and its derived variants. */
export function referencedKeys(
  rows: readonly { storageKey: string; variants: unknown }[],
): Set<string> {
  const keys = new Set<string>();
  for (const r of rows) {
    keys.add(r.storageKey);
    const v = r.variants;
    if (v && typeof v === "object") {
      for (const entry of Object.values(v as Record<string, unknown>)) {
        const key = (entry as { key?: unknown } | null)?.key;
        if (typeof key === "string") keys.add(key);
      }
    }
  }
  return keys;
}
