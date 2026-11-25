/**
 * ML-13a (DP-244): pure helpers of the translation packages — text hashes, the normal form a text
 * is compared in, the checks of a translated text and the decision for one unit. No database.
 */
import { createHash } from "node:crypto";
import type { TranslationUnitStatus } from "@dream/contracts";

/** SHA-256 (hex) of one text, UTF-8. */
export function textHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** SHA-256 (hex) of a value as canonical JSON (object keys sorted): the package digest. */
export function canonicalDigest(value: unknown): string {
  const json = JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
  return createHash("sha256").update(json, "utf8").digest("hex");
}

/** A stored or translated text as compared: trimmed; blank and null are "no text". */
export function norm(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

/** The hash of a normal-form text (null for none). */
export const normHash = (value: string | null): string | null =>
  value === null ? null : textHash(value);

// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Why a translated text cannot be stored (null: it can). Same rules as the editors. */
export function textProblem(text: string, max: number | null): string | null {
  if (CONTROL.test(text)) return "control_characters";
  if (max !== null && text.length > max) return "too_long";
  return null;
}

export interface UnitDecision {
  status: TranslationUnitStatus;
  rule: string | null;
}

/**
 * The decision for one unit whose resource exists, in this order: the source changed since the
 * export (outdated), no translation (empty), the translation is not valid (invalid), the target
 * already holds it (unchanged), the target changed since the export (conflict), else write.
 *
 * @param sourceNow  the source text today (null: the source no longer has this text)
 * @param currentNow the target language's text today (normal form, null for none)
 * @param problem    why the translated text cannot be stored (from `textProblem` or a field rule)
 */
export function decideUnit(input: {
  sourceHash: string;
  sourceNow: string | null;
  target: string | null;
  problem: string | null;
  currentHash: string | null;
  currentNow: string | null;
}): UnitDecision {
  if (input.sourceNow === null) return { status: "outdated", rule: "source_removed" };
  if (textHash(input.sourceNow) !== input.sourceHash) {
    return { status: "outdated", rule: "source_changed" };
  }
  if (input.target === null) return { status: "empty", rule: null };
  if (input.problem) return { status: "invalid", rule: input.problem };
  if (input.currentNow === input.target) return { status: "unchanged", rule: null };
  if (normHash(input.currentNow) !== input.currentHash) {
    return { status: "conflict", rule: "target_changed" };
  }
  return { status: input.currentNow === null ? "create" : "update", rule: null };
}

/** Whether a decision verified the unit against today's source (written or already equal). */
export const verified = (d: UnitDecision | undefined): boolean =>
  !!d && (d.status === "create" || d.status === "update" || d.status === "unchanged");

export const writes = (d: UnitDecision | undefined): boolean =>
  !!d && (d.status === "create" || d.status === "update");

/**
 * The zod issue path of a content text (`sections.@<id>.heading` → `sections.3.heading`), with the
 * positions of the sections in `content`.
 */
export function issuePathOf(path: string, content: Record<string, unknown>): string {
  const m = /^sections\.@([a-z0-9-]+)(\..*)?$/.exec(path);
  if (!m) return path;
  const sections = Array.isArray(content["sections"]) ? (content["sections"] as unknown[]) : [];
  const index = sections.findIndex((s) => (s as { id?: unknown } | null)?.id === m[1]);
  return index < 0 ? path : `sections.${index}${m[2] ?? ""}`;
}
