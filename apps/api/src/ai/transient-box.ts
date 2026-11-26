/**
 * DP-297 (ADR-030 D10): encryption of the texts an operation holds for at most 15 minutes in
 * "AiTransient" (migration dp_297) — the job's input and the draft answer. AES-256-GCM
 * (secret-box) with keys DERIVED from DP_AI_ENC_KEYS. The key is never in the database: a dump, a
 * copy of the volume or a database user without the API's environment reads nothing.
 *
 * Domain separation from the provider-key encryption (DP-289, which uses each DP_AI_ENC_KEYS key
 * K directly as its AES-256-GCM key):
 *   - the transient key is HKDF-SHA256 (RFC 5869) of K with a FIXED, NON-EMPTY salt
 *     (SHA-256 of "dream-petroleum/ai-transient/hkdf-salt/v1") and the info
 *     "dp-ai-transient|aes-256-gcm|v1|key-version:<n>". In HKDF-Extract K is only the message of
 *     HMAC-SHA256 keyed by that salt — K is never an HMAC key and never the transient AES key —
 *     and the output is a PRF value independent of K's use as an AES key;
 *   - the purpose, the cipher, the format version and the keyring version are bound in the info,
 *     so every key version gets its own transient key and a future format gets a new one;
 *   - the additional authenticated data has disjoint prefixes ("ai-transient|…" here,
 *     "ai-credential|…" for provider keys), so a ciphertext of one domain never authenticates in
 *     the other even under the same key.
 * The binding AAD is kind | operation | actor: an answer copied to another operation or user does
 * not decrypt (it is then treated as absent).
 */
import { createHash, hkdfSync } from "node:crypto";
import { decryptSecret, encryptSecret, type Keyring } from "../iam/auth/secret-box.js";

/** The fixed HKDF salt of the transient domain (public; it separates, it is not a secret). */
export const TRANSIENT_HKDF_SALT = createHash("sha256")
  .update("dream-petroleum/ai-transient/hkdf-salt/v1")
  .digest();
/** The HKDF info of one keyring version. */
export const transientHkdfInfo = (version: number) =>
  `dp-ai-transient|aes-256-gcm|v1|key-version:${version}`;
const cache = new WeakMap<Keyring, Keyring>();

/** The transient keyring: one derived key per DP_AI_ENC_KEYS version (memoised). */
export function transientKeyring(aiKeyring: Keyring): Keyring {
  const hit = cache.get(aiKeyring);
  if (hit) return hit;
  const keys = new Map<number, Buffer>();
  for (const [version, key] of aiKeyring.keys) {
    keys.set(
      version,
      Buffer.from(hkdfSync("sha256", key, TRANSIENT_HKDF_SALT, transientHkdfInfo(version), 32)),
    );
  }
  const derived = { current: aiKeyring.current, keys };
  cache.set(aiKeyring, derived);
  return derived;
}

export type TransientKind = "INPUT" | "RESULT";

export function transientAad(
  kind: TransientKind,
  operationId: string,
  actorUserId: string,
): string {
  return `ai-transient|${kind}|${operationId}|${actorUserId}`;
}

/** What a worker needs to run a job; the reservation's limits travel with the input. */
export interface JobPayload {
  input: string;
  maxOutputTokens: number;
  thinkingBudget: number;
  temperature: number | null;
}

export function sealInput(
  aiKeyring: Keyring,
  operationId: string,
  actorUserId: string,
  payload: JobPayload,
): string {
  return encryptSecret(
    transientKeyring(aiKeyring),
    Buffer.from(JSON.stringify({ v: 1, ...payload }), "utf8"),
    transientAad("INPUT", operationId, actorUserId),
  );
}

/** The payload, or null when it does not decrypt or is not a payload (never thrown). */
export function openInput(
  aiKeyring: Keyring,
  operationId: string,
  actorUserId: string,
  stored: string,
): JobPayload | null {
  try {
    const raw = decryptSecret(
      transientKeyring(aiKeyring),
      stored,
      transientAad("INPUT", operationId, actorUserId),
    );
    const p = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    if (
      p["v"] !== 1 ||
      typeof p["input"] !== "string" ||
      !Number.isInteger(p["maxOutputTokens"]) ||
      !Number.isInteger(p["thinkingBudget"]) ||
      !(p["temperature"] === null || typeof p["temperature"] === "number")
    ) {
      return null;
    }
    return {
      input: p["input"],
      maxOutputTokens: p["maxOutputTokens"] as number,
      thinkingBudget: p["thinkingBudget"] as number,
      temperature: p["temperature"] as number | null,
    };
  } catch {
    return null;
  }
}

export function sealResult(
  aiKeyring: Keyring,
  operationId: string,
  actorUserId: string,
  text: string,
): string {
  return encryptSecret(
    transientKeyring(aiKeyring),
    Buffer.from(text, "utf8"),
    transientAad("RESULT", operationId, actorUserId),
  );
}

export function openResult(
  aiKeyring: Keyring,
  operationId: string,
  actorUserId: string,
  stored: string,
): string | null {
  try {
    return decryptSecret(
      transientKeyring(aiKeyring),
      stored,
      transientAad("RESULT", operationId, actorUserId),
    ).toString("utf8");
  } catch {
    return null;
  }
}
