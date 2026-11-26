// ML-3: the policy link of a page points at a language that has the policy, never at a 404 under
// /nl. DP-298 (ADR-031 D1): the languages and the production gate come from the API's snapshot.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { privacyBlockersFor } from "@dream/contracts";

import { privacyHref, privacyPolicyHref, sitePrivacy } from "./privacy.ts";

describe("privacyPolicyHref", () => {
  it("links the English policy from English and Dutch pages while only English has one", () => {
    assert.equal(privacyPolicyHref("en", ["en"]), "/en/privacy");
    assert.equal(privacyPolicyHref("nl", ["en"]), "/en/privacy");
  });

  it("links the Dutch policy once Dutch has one", () => {
    assert.equal(privacyPolicyHref("nl", ["en", "nl"]), "/nl/privacy");
  });
});

describe("sitePrivacy (DP-298)", () => {
  const production = { DP_DEPLOY_ENV: "production" };

  it("a current version under legal review blocks production, never local or staging", () => {
    const blockers = privacyBlockersFor([
      { key: "PRIVACY_POLICY", locale: "en", version: "2026-11-12.en" },
    ]);
    assert.ok(blockers.some((b) => b.includes("PRIVACY_POLICY 2026-11-12.en")));
    assert.equal(sitePrivacy(blockers, production).publish, false);
    assert.equal(privacyHref(blockers, production), null);
    assert.equal(sitePrivacy(blockers, { DP_DEPLOY_ENV: "local" }).publish, true);
    assert.equal(sitePrivacy(blockers, { DP_DEPLOY_ENV: "staging" }).draft, true);
  });

  it("no blockers publishes in production", () => {
    assert.deepEqual(sitePrivacy([], production), { publish: true, draft: false, blockers: [] });
    assert.equal(privacyHref([], production), "/privacy");
  });
});
