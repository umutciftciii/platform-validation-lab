// DP-298 (ADR-031 D1): the API's legal texts answer as the site renders it, fail closed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SEED_LEGAL_TEXTS, type LegalTextSet } from "@dream/contracts";

import { legalTextsSnapshotFrom, unavailableLegalTexts } from "./legal-texts-snapshot.ts";
import { sitePrivacy } from "./privacy.ts";
import { privacyLocalesOf } from "./proxy-routes.ts";

/** One language as `GET /api/v1/public/legal-texts` lists it. */
function wire(set: LegalTextSet) {
  return {
    locale: set.locale,
    privacyNotice: { version: set.privacyNotice.version, text: set.privacyNotice.text },
    marketingConsent: { version: set.marketingConsent.version, text: set.marketingConsent.text },
    contactNotice: { version: set.contactNotice.version, text: set.contactNotice.text },
    privacyPolicy: {
      version: set.privacyPolicy.version,
      sections: set.privacyPolicy.sections.map((s) => ({ ...s })),
    },
    translates: set.translates,
  };
}

const EN = wire(SEED_LEGAL_TEXTS["en"]!);
const production = { DP_DEPLOY_ENV: "production" };

describe("legalTextsSnapshotFrom", () => {
  it("a response outside the contract is no snapshot; the fallback offers nothing", () => {
    for (const bad of [null, {}, "x", { sets: [EN] }, { sets: [{ ...EN, extra: 1 }], pendingReview: [] }]) {
      assert.equal(legalTextsSnapshotFrom(bad), null);
    }
    const none = unavailableLegalTexts();
    assert.deepEqual(none.registry, {});
    assert.ok(none.blockers.includes("DP-298: legal texts unavailable"));
    assert.deepEqual(privacyLocalesOf(none.registry), []);
    assert.equal(sitePrivacy(none.blockers, production).publish, false);
  });

  it("builds the registry of the published languages", () => {
    const snap = legalTextsSnapshotFrom({ sets: [EN], pendingReview: [] });
    assert.ok(snap);
    assert.deepEqual(Object.keys(snap.registry), ["en"]);
    assert.equal(snap.registry["en"]!.privacyNotice.version, SEED_LEGAL_TEXTS["en"]!.privacyNotice.version);
    assert.deepEqual(privacyLocalesOf(snap.registry), ["en"]);
    assert.ok(!snap.blockers.some((b) => b.startsWith("DP-298:")));
  });

  it("a current version under legal review keeps production unpublished", () => {
    const snap = legalTextsSnapshotFrom({
      sets: [EN],
      pendingReview: [{ key: "CONTACT_NOTICE", locale: "en", version: EN.contactNotice.version }],
    });
    assert.ok(snap);
    assert.ok(snap.blockers.includes(`DP-298: legal review of CONTACT_NOTICE ${EN.contactNotice.version}`));
    assert.equal(sitePrivacy(snap.blockers, production).publish, false);
    assert.equal(sitePrivacy(snap.blockers, { DP_DEPLOY_ENV: "local" }).publish, true);
  });
});
