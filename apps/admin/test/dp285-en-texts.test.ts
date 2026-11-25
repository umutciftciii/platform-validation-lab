// DP-285: the API error code DATABASE_UNAVAILABLE (503) is new, so the Staff client's table of
// every error code (staff-en, "explains every refusal a call can meet") has one more entry and
// staff-en was recorded again with DP285_RECORD_EN=1. This test proves that this entry is the only
// change against the recording it replaces, kept in fixtures/dp285-en/staff-en.json.gz.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (dir: string): Record<string, string> =>
  JSON.parse(
    gunzipSync(readFileSync(path.join(FIXTURES, dir, "staff-en.json.gz"))).toString("utf8"),
  );

describe("DP-285: staff-en changed only by the new error code", () => {
  it("one render gains the DATABASE_UNAVAILABLE entry; everything else is byte-identical", () => {
    const before = load("dp285-en");
    const after = load("catalog-en");
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    const key = "Staff client messages (EN) > explains every refusal a call can meet #1";
    const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
    expect(changed).toEqual([key]);
    const entry = [
      " &quot;code:DATABASE_UNAVAILABLE&quot;: {",
      "  &quot;ok&quot;: false,",
      "  &quot;status&quot;: 400,",
      "  &quot;message&quot;: &quot;The database is not available right now. Try again later.&quot;,",
      "  &quot;stepUp&quot;: false",
      " },",
      "",
    ].join("\n");
    expect(after[key]).toContain(entry);
    expect(after[key]!.replace(entry, "")).toBe(before[key]);
  });
});
