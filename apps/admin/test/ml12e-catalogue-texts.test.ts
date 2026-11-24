// ML-12e (DP-243): the owner console translates module names and descriptions by module key, and
// Staff translates role names and descriptions by role key, falling back to the API's text for a
// key without a dictionary entry. This test keeps the dictionaries complete: every module and role
// of the API's catalogue (apps/api/src/iam/catalog.ts, read as text) has an entry whose English is
// the API's text word for word, so English never changes and Turkish never silently falls back.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { owner } from "../lib/i18n/messages/owner/en";
import { staff } from "../lib/i18n/messages/staff/en";

const CATALOG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../api/src/iam/catalog.ts",
);
const source = readFileSync(CATALOG, "utf8");

/** `export const NAME = "value";` constants used as keys in the catalogue. */
const constants = new Map(
  [...source.matchAll(/export const (\w+) = "([^"]+)";/g)].map((m) => [m[1]!, m[2]!]),
);

function section(name: string): string {
  const start = source.indexOf(`export const ${name}:`);
  const end = source.indexOf("\n];", start);
  expect(start, name).toBeGreaterThan(-1);
  return source.slice(start, end);
}

/** `{ key, name, description }` of every entry of a catalogue array. */
function entries(name: string): { key: string; name: string; description: string }[] {
  const text = section(name);
  const out: { key: string; name: string; description: string }[] = [];
  const re =
    /key:\s*(?:"([^"]+)"|(\w+)),\s*name:\s*"([^"]+)",\s*description:\s*(?:"((?:[^"\\]|\\.)*)"|\n\s*"((?:[^"\\]|\\.)*)")/g;
  for (const m of text.matchAll(re)) {
    const key = m[1] ?? constants.get(m[2]!) ?? m[2]!;
    out.push({ key, name: m[3]!, description: (m[4] ?? m[5])!.replaceAll('\\"', '"') });
  }
  return out;
}

describe("API catalogue texts in the dictionaries (ML-12e)", () => {
  it("has every module of the API with its English text (owner.modules.*)", () => {
    const modules = entries("MODULES");
    expect(modules.length).toBe(12);
    const dict = owner.modules as Record<string, { name: string; description: string }>;
    for (const m of modules)
      expect(dict[m.key], m.key).toEqual({ name: m.name, description: m.description });
    expect(Object.keys(dict).sort()).toEqual(modules.map((m) => m.key).sort());
  });

  it("has every role of the API with its English text (staff.roles.*)", () => {
    const roles = entries("ROLES");
    expect(roles.length).toBeGreaterThan(10);
    const dict = staff.roles as Record<string, { name: string; description?: string }>;
    for (const r of roles) {
      expect(dict[r.key]?.name, r.key).toBe(r.name);
      if (dict[r.key]?.description !== undefined)
        expect(dict[r.key]?.description, r.key).toBe(r.description);
    }
  });
});
