// CRM-1 (ADR-032 D1): the English renders of the Owner Console changed only where approved.
//
// owner-en was recorded again with CRM1_RECORD_EN=1; the recording it replaces is kept in
// fixtures/crm1-en. CRM 360° is standard scope and a core module now, no longer the optional sales
// pipeline, so the console names the module "CRM 360°" with its new description, and the session's
// navigation (shown in one render as JSON) has the new CRM entry after Leads. Nothing else changed:
// not one tag or attribute.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function load(dir: string, file: string): Record<string, string> {
  return JSON.parse(
    gunzipSync(readFileSync(path.join(FIXTURES, dir, `${file}.json.gz`))).toString("utf8"),
  );
}

/** The old render with the approved changes applied. */
function approved(html: string): string {
  return html
    .replaceAll(
      "Sales pipeline on top of leads (optional)",
      "Companies, contacts, account owners and contact history",
    )
    .replaceAll("&quot;/leads&quot;,\n  ", "&quot;/leads&quot;,\n  &quot;/crm&quot;,\n  ")
    .replace(/(?<=[> ])CRM(?=[<" ])(?! User)/g, "CRM 360°");
}

describe("CRM-1: EN renders of the Owner Console changed only where approved", () => {
  const before = load("crm1-en", "owner-en");
  const after = load("catalog-en", "owner-en");

  it("keeps every render and changes only the CRM module's name and description", () => {
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    const changed = Object.keys(before).filter((k) => after[k] !== before[k]);
    expect(changed.length).toBeGreaterThan(0);
    for (const k of Object.keys(before)) expect(after[k], k).toBe(approved(before[k]!));
  });

  it("names CRM 360° and never the old optional pipeline", () => {
    const all = Object.values(after).join("\n");
    expect(all).toContain("CRM 360°");
    expect(all).not.toContain("Sales pipeline on top of leads");
  });
});
