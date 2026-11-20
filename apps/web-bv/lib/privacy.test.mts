// ML-3: the policy link of a page points at a language that has the policy (English until the
// Dutch policy is approved, ADR-028 D12), never at a 404 under /nl.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { privacyPolicyHref } from "./privacy.ts";

describe("privacyPolicyHref", () => {
  it("links the English policy from English and Dutch pages", () => {
    assert.equal(privacyPolicyHref("en"), "/en/privacy");
    assert.equal(privacyPolicyHref("nl"), "/en/privacy");
  });
});
