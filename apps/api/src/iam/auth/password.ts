/**
 * Password hashing and policy (F1-002; ADR-013, design 3.1, owner decisions A5 and A11).
 *
 * - Argon2id, m = 19 MiB, t = 2, p = 1 (OWASP baseline). A stored hash with other parameters is
 *   reported by `verifyPassword` as `needsRehash`, so the login can upgrade it.
 * - At most four hashes run at once (semaphore; Docker VM memory ceiling, T18).
 * - Unicode NFKC normalisation before hashing and checking; no composition rules.
 * - Length: staff >= 12 (MFA is mandatory); customers >= 15 without MFA, >= 12 with MFA; at most
 *   128 characters (code points after NFKC).
 * - Refused: passwords on the local breached list, and passwords containing a part of the e-mail
 *   local part or the display name (see `identityParts`; compared after `foldIdentity`, so case,
 *   accents and Turkish dotted/dotless i do not matter, and separators are ignored).
 * - The policy runs only when a password is set or changed; stored hashes are never re-checked.
 * - Unknown users: `dummyVerify` spends the same work as a real verification (T3).
 */
import argon2 from "argon2";
import type { UserKindValue } from "../catalog.js";
import { MAX_PASSWORD_LENGTH, minPasswordLength } from "../session-policy.js";
import { isBreachedPassword } from "./breached-passwords.js";
import { Semaphore } from "./semaphore.js";

export const ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export const MAX_CONCURRENT_HASHES = 4;
export const hashSemaphore = new Semaphore(MAX_CONCURRENT_HASHES);

export function normalizePassword(password: string): string {
  return password.normalize("NFKC");
}

export async function hashPassword(password: string): Promise<string> {
  const normalized = normalizePassword(password);
  return hashSemaphore.run(() => argon2.hash(normalized, ARGON2_PARAMS));
}

export interface VerifyResult {
  ok: boolean;
  /** The hash uses other parameters than ARGON2_PARAMS; re-hash after a successful login. */
  needsRehash: boolean;
}

export async function verifyPassword(storedHash: string, password: string): Promise<VerifyResult> {
  if (!storedHash.startsWith("$argon2id$")) return { ok: false, needsRehash: false };
  const normalized = normalizePassword(password);
  let ok = false;
  try {
    ok = await hashSemaphore.run(() => argon2.verify(storedHash, normalized));
  } catch {
    ok = false; // malformed hash: deny
  }
  return { ok, needsRehash: ok && argon2.needsRehash(storedHash, ARGON2_PARAMS) };
}

let dummyHash: Promise<string> | undefined;
/**
 * Same cost as `verifyPassword` for a login with an unknown e-mail, so response time does not
 * reveal whether an account exists. Always returns false.
 */
export async function dummyVerify(password: string): Promise<false> {
  dummyHash ??= argon2.hash("dummy-password-for-timing-equalisation", ARGON2_PARAMS);
  await verifyPassword(await dummyHash, password);
  return false;
}

export type PasswordPolicyDetail = "too_short" | "too_long" | "breached" | "contains_identity";

export interface PasswordContext {
  kind: UserKindValue;
  /** The account has (or is enrolling) MFA; staff always count as MFA users. */
  hasMfa: boolean;
  email?: string | null;
  displayName?: string | null;
}

/** Identity parts shorter than this are ignored: too common inside unrelated words. */
export const MIN_IDENTITY_PART = 4;

/**
 * Generic mailbox words (`info@`, `first.admin@`) say nothing about the person; as single parts they
 * would only refuse unrelated passwords. They still count inside a joined form (`firstadmin`).
 */
const GENERIC_IDENTITY_PARTS: ReadonlySet<string> = new Set([
  "admin",
  "contact",
  "hello",
  "info",
  "mail",
  "noreply",
  "office",
  "sales",
  "staff",
  "support",
  "team",
  "test",
  "user",
]);

/**
 * Folds text for identity comparisons: NFKD, combining marks removed, lower case, and the Turkish
 * dotless i mapped to i. So "ÇİFTÇİ", "Çiftci", "ciftci" and "CIFTCI" all fold to "ciftci" ("İ" is
 * I + U+0307 under NFKD; "ı" has no decomposition). Used only for this check, never for hashing.
 */
export function foldIdentity(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/ı/g, "i");
}

/** Runs of letters in folded text; digits, punctuation and separators split and are dropped. */
function letterRuns(value: string): string[] {
  return foldIdentity(value).match(/\p{L}+/gu) ?? [];
}

/**
 * Identity parts a new password may not contain, from the e-mail local part and the display name:
 * every letter run of at least MIN_IDENTITY_PART letters (generic mailbox words excepted) and, when
 * there are several runs, all of them joined. For "Ezgi Çiftci" / ezgi.ciftci@…: ezgi, ciftci,
 * ezgiciftci. Digits never form a part, so `john1985@` does not refuse every password with 1985.
 */
export function identityParts(ctx: Pick<PasswordContext, "email" | "displayName">): string[] {
  const parts = new Set<string>();
  const email = ctx.email ?? "";
  const at = email.lastIndexOf("@");
  const local = at >= 0 ? email.slice(0, at) : email;
  for (const source of [local, ctx.displayName ?? ""]) {
    const runs = letterRuns(source);
    for (const run of runs) {
      if (run.length >= MIN_IDENTITY_PART && !GENERIC_IDENTITY_PARTS.has(run)) parts.add(run);
    }
    const joined = runs.join("");
    if (runs.length > 1 && joined.length >= MIN_IDENTITY_PART) parts.add(joined);
  }
  return [...parts];
}

/** Policy problems of a new password; empty means acceptable (422 AUTH_PASSWORD_POLICY). */
export function passwordPolicyProblems(
  password: string,
  ctx: PasswordContext,
): PasswordPolicyDetail[] {
  const normalized = normalizePassword(password);
  const length = [...normalized].length;
  const problems: PasswordPolicyDetail[] = [];
  const min = minPasswordLength(ctx.kind, ctx.kind === "STAFF" || ctx.hasMfa);
  if (length < min) problems.push("too_short");
  if (length > MAX_PASSWORD_LENGTH) problems.push("too_long");
  if (isBreachedPassword(normalized)) problems.push("breached");
  // Letters only, folded: "Ezgi_Çiftci", "e.z.g.i" and "ÇİFTÇİ" compare like "ezgiciftci".
  const letters = letterRuns(normalized).join("");
  if (identityParts(ctx).some((part) => letters.includes(part))) problems.push("contains_identity");
  return problems;
}
