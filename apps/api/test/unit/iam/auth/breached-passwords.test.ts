// A11 breached-password list (F1-002): provenance, integrity, normalisation consistent with the
// password policy, and server-side only. Independent of scripts/build-breached-passwords.mjs.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BREACHED_PASSWORDS_COUNT,
  BREACHED_PASSWORDS_TEXT,
} from "../../../../src/iam/auth/breached-passwords.data.js";
import {
  breachedPasswordCount,
  isBreachedPassword,
  normalizeForBreachCheck,
} from "../../../../src/iam/auth/breached-passwords.js";
import { passwordPolicyProblems } from "../../../../src/iam/auth/password.js";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const REPO = path.resolve(API_DIR, "../..");
const DATA = path.join(API_DIR, "data/breached-passwords");
const RAW_FILE = "seclists-xato-net-10-million-passwords-100000.txt";
const RAW_SHA256 = "1472aafa2561df5e3293aee252aee3ca660c12b399a283cf808bb01b39be388b";
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

const raw = readFileSync(path.join(DATA, RAW_FILE));
const rawLines = raw.toString("utf8").split("\n");
const entries = BREACHED_PASSWORDS_TEXT.split("\n");

describe("provenance and integrity", () => {
  it("is the pinned SecLists file, byte for byte (SHA-256, 100,000 lines, LF only)", () => {
    expect(sha256(raw)).toBe(RAW_SHA256);
    expect(raw.length).toBe(781_879);
    expect(raw.includes(0x0d)).toBe(false);
    expect(rawLines.filter((l, i) => l !== "" || i < rawLines.length - 1)).toHaveLength(100_000);
  });

  it("keeps the MIT licence and the attribution", () => {
    const licence = readFileSync(path.join(DATA, "SECLISTS-LICENSE"), "utf8");
    expect(licence).toMatch(/^MIT License/);
    expect(licence).toContain("Copyright (c) 2018 Daniel Miessler");
    expect(licence).toContain(
      "The above copyright notice and this permission notice shall be included",
    );
    const source = readFileSync(path.join(DATA, "SOURCE.md"), "utf8");
    for (const fact of [
      RAW_SHA256,
      "3a3b801dd916d0c37c5a52eac440153416d2c54f",
      "fa9a7c2e9f930c99b125aa96b7d87b3b9fcbe333",
      "Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt",
      "Mark Burnett",
    ]) {
      expect(source).toContain(fact);
    }
  });

  it("embeds exactly the normalised, de-duplicated union of the file and the seed (module up to date)", () => {
    const seed = readFileSync(path.join(DATA, "seed.txt"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"));
    const expected = [
      ...new Set([...rawLines, ...seed].map(normalizeForBreachCheck).filter((l) => l.length > 0)),
    ].sort();
    expect(entries).toEqual(expected);
    expect(BREACHED_PASSWORDS_COUNT).toBe(expected.length);
    expect(breachedPasswordCount()).toBe(expected.length);
    expect(expected.length).toBeGreaterThan(95_000);
    expect(new Set(entries).size).toBe(entries.length);
    expect(entries.includes("")).toBe(false);
  });
});

describe("normalisation matches the password policy", () => {
  it("stores only fixed points of the check's normalisation", () => {
    const off = entries.filter((e) => normalizeForBreachCheck(e) !== e);
    expect(off).toEqual([]);
  });

  it("finds every list entry whatever its case, width or surrounding spaces", () => {
    const fullWidth = (s: string) =>
      [...s]
        .map((c) => (c >= "!" && c <= "~" ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c))
        .join("");
    let checked = 0;
    for (let i = 0; i < rawLines.length; i += 997) {
      const e = rawLines[i]?.trim();
      if (!e) continue;
      checked++;
      for (const variant of [e, e.toUpperCase(), fullWidth(e), ` ${e}\t`]) {
        expect(isBreachedPassword(variant), JSON.stringify(variant)).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(90);
  });

  it("applies the same Unicode rules to non-ASCII input (NFKC, Turkish dotted I)", () => {
    expect(isBreachedPassword("ＰＡＳＳＷＯＲＤ１２３")).toBe(true);
    expect(isBreachedPassword("PASSWORD1234")).toBe(true);
    // toLowerCase() maps "İ" to "i̇" (i + combining dot), so "İSTANBUL" is not the seed's "istanbul":
    // the check and the list use the identical function, so the result is consistent, not lenient.
    expect(normalizeForBreachCheck("İSTANBUL")).toBe("i\u0307stanbul");
    expect(isBreachedPassword("ISTANBUL")).toBe(true);
    expect(isBreachedPassword("istanbul")).toBe(true);
  });

  it("makes the policy report long list entries as breached, and accepts a strong password", () => {
    const long = entries.filter((e) => [...e].length >= 15 && [...e].length <= 128).slice(0, 50);
    expect(long.length).toBe(50);
    for (const e of long) {
      expect(
        passwordPolicyProblems(e.toUpperCase(), { kind: "CUSTOMER", hasMfa: false }),
        e,
      ).toEqual(["breached"]);
    }
    expect(passwordPolicyProblems("Kq7#vLw2!pZm4Rt9", { kind: "CUSTOMER", hasMfa: false })).toEqual(
      [],
    );
  });
});

describe("server-side only", () => {
  const FORBIDDEN = /breached-passwords|BREACHED_PASSWORDS/;
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".next", "dist", ".turbo", "coverage"].includes(name)) continue;
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) out.push(...sources(p));
      else if (/\.(ts|tsx|js|mjs|cjs|json)$/.test(name)) out.push(p);
    }
    return out;
  }

  it("is referenced by no web app or shared package (no client bundle)", () => {
    const roots = ["apps/admin", "apps/web-bv", "apps/web-corporate", "packages"].map((r) =>
      path.join(REPO, r),
    );
    const hits = roots.flatMap(sources).filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(REPO, f))).toEqual([]);
  });

  it("lives outside every public directory and is loaded without file or network access", () => {
    expect(path.relative(API_DIR, DATA).split(path.sep)).not.toContain("public");
    const module = readFileSync(path.join(API_DIR, "src/iam/auth/breached-passwords.ts"), "utf8");
    expect(module).not.toMatch(/node:fs|readFile|fetch\(|node:https?|node:net/);
  });
});
