/**
 * Local breached-password check (F1-002, owner decision A11, design 3.1). The list (the top
 * 100,000 of the xato.net ten-million corpus from SecLists, pinned by commit and SHA-256, plus a
 * curated seed; see data/breached-passwords/SOURCE.md) is embedded in the API build and loaded
 * once into a hash set. No network lookup and no file access at runtime: passwords never leave
 * the API. Server-side only; nothing outside apps/api imports it.
 */
import { BREACHED_PASSWORDS_TEXT } from "./breached-passwords.data.js";

let set: ReadonlySet<string> | undefined;

function load(): ReadonlySet<string> {
  set ??= new Set(BREACHED_PASSWORDS_TEXT.split("\n"));
  return set;
}

/** The normalisation the list was built with (scripts/build-breached-passwords.mjs). */
export function normalizeForBreachCheck(password: string): string {
  return password.trim().normalize("NFKC").toLowerCase();
}

export function breachedPasswordCount(): number {
  return load().size;
}

/** Whole-password match after trimming, NFKC and lower-casing (case-insensitive). */
export function isBreachedPassword(password: string): boolean {
  return load().has(normalizeForBreachCheck(password));
}
