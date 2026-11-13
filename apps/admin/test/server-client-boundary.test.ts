// CMS S2 regression (2026-11-13 DEV acceptance): a server component called a plain function
// exported by a "use client" module, and /content and /content/[id] failed at runtime with
// "Attempted to call publicationState() from the server". Vitest does not enforce that boundary,
// so this test does, statically: a module without "use client" may import only components
// (PascalCase) and types from a "use client" module.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["app", "components", "lib"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const isClient = (source: string) =>
  /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(source);

function resolve(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** `import { a, B, type C } from "./x"` and `import D from "./x"`: the value names. */
function valueImports(source: string): { names: string[]; spec: string }[] {
  const out: { names: string[]; spec: string }[] = [];
  const re = /import\s+(type\s+)?([\s\S]*?)\s+from\s+["'](\.[^"']+)["']/g;
  for (const m of source.matchAll(re)) {
    if (m[1]) continue;
    const clause = m[2] ?? "";
    const names: string[] = [];
    const def = /^([A-Za-z_$][\w$]*)/.exec(clause.trim());
    if (def && !clause.trim().startsWith("{")) names.push(def[1]!);
    const braces = /\{([\s\S]*)\}/.exec(clause);
    for (const part of braces?.[1]?.split(",") ?? []) {
      const p = part.trim();
      if (!p || p.startsWith("type ")) continue;
      // `a as b`: the exported name decides (a function stays a function under any alias).
      names.push(p.split(/\s+as\s+/)[0]!.trim());
    }
    out.push({ names, spec: m[3]! });
  }
  return out;
}

describe("server/client module boundary", () => {
  const all = DIRS.flatMap((d) => files(path.join(ROOT, d)));

  it("finds the console's server pages (sanity)", () => {
    const pages = all.filter(
      (f) => f.includes(`${path.sep}content${path.sep}`) && f.endsWith("page.tsx"),
    );
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const p of pages) expect(isClient(readFileSync(p, "utf8")), p).toBe(false);
  });

  it("server modules import only components and types from client modules", () => {
    const problems: string[] = [];
    for (const file of all) {
      const source = readFileSync(file, "utf8");
      if (isClient(source)) continue;
      for (const { names, spec } of valueImports(source)) {
        const target = resolve(file, spec);
        if (!target || !isClient(readFileSync(target, "utf8"))) continue;
        for (const name of names) {
          if (!/^[A-Z]/.test(name)) {
            problems.push(
              `${path.relative(ROOT, file)}: ${name} from ${path.relative(ROOT, target)}`,
            );
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("would have caught the S2 defect", () => {
    const source = 'import { publicationState } from "./publication-panel";';
    expect(valueImports(source)).toEqual([
      { names: ["publicationState"], spec: "./publication-panel" },
    ]);
  });
});
