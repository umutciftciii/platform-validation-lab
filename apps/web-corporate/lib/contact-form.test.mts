// COM-4: the corporate contact form's gate, client IP and country names.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COUNTRY_CODES,
  LEGAL_TEXTS,
  privacyBlockersFor,
  privacyDeployEnv,
  privacyPublication,
} from "@dream/contracts";

import { clientIpFrom, trustedHops } from "./client-ip.ts";
import {
  CONTACT_FORM_PATH,
  contactFormState,
  countryOptions,
  formLegalTexts,
} from "./contact-form.ts";

const registry = LEGAL_TEXTS;
const base = { publish: true, registry, publicLocales: ["en"], preview: false };

describe("contact form gate (COM-4, DP-095, ML-10)", () => {
  it("offers the working form with the English notice where the texts may be published", () => {
    const state = contactFormState("en", base);
    assert.equal(state.kind, "live");
    assert.ok(state.kind === "live" && state.notice.version === registry.en!.contactNotice.version);
    assert.ok(state.kind === "live" && state.notice.text.length > 0);
  });

  it("shows the disabled form while the texts may not be published (production, drafts)", () => {
    assert.deepEqual(contactFormState("en", { ...base, publish: false }), {
      kind: "disabled",
      reason: "gate",
    });
    // No texts read from the API (fail closed): no form either.
    assert.deepEqual(contactFormState("en", { ...base, registry: {} }), {
      kind: "disabled",
      reason: "notInLanguage",
    });
  });

  it("never offers Turkish without its own approved notice, never another language's", () => {
    for (const publicLocales of [["en"], ["en", "tr"]]) {
      assert.deepEqual(contactFormState("tr", { ...base, publicLocales }), {
        kind: "disabled",
        reason: "notInLanguage",
      });
    }
    // An approved Turkish set on a public Turkish site would be offered (with its own text).
    const tr = { ...registry.en!, locale: "tr", review: "approved" as const };
    assert.equal(formLegalTexts("tr", ["en", "tr"], { ...registry, tr })?.locale, "tr");
    assert.equal(formLegalTexts("tr", ["en"], { ...registry, tr }), null);
    assert.equal(
      contactFormState("tr", { ...base, registry: { ...registry, tr }, preview: true }).kind,
      "disabled",
    );
    assert.equal(formLegalTexts("nl", ["en", "nl"], registry), null);
  });

  it("keeps the draft form on staging and closes it in production until the texts are approved", () => {
    // The contact notice still waits for its legal review (DP-095): a production blocker.
    const pending = [{ key: "CONTACT_NOTICE", locale: "en", version: "2026-11-13.en" }];
    const blockers = privacyBlockersFor(pending);
    assert.ok(blockers.length > 0);
    for (const [env, live] of [
      ["local", true],
      ["staging", true],
      ["production", false],
      // An unknown environment name counts as production (fail closed).
      ["prod", false],
    ] as const) {
      const gate = privacyPublication(privacyDeployEnv(env), blockers);
      assert.equal(
        contactFormState("en", { ...base, publish: gate.publish }).kind === "live",
        live,
        env,
      );
      if (live) assert.equal(gate.draft, true, `${env}: shown as a draft`);
    }
  });

  it("posts to this site's own route", () => {
    assert.equal(CONTACT_FORM_PATH, "/lead-form/contact");
  });
});

describe("client IP for the API's rate limit", () => {
  it("trusts only the configured number of edge hops", () => {
    assert.equal(trustedHops({}), 0);
    assert.equal(trustedHops({ DP_TRUSTED_PROXY_HOPS: "1" }), 1);
    assert.equal(trustedHops({ DP_TRUSTED_PROXY_HOPS: "9" }), 0);
    assert.equal(clientIpFrom("203.0.113.9", 0), null);
    assert.equal(clientIpFrom("198.51.100.1, 203.0.113.9", 1), "203.0.113.9");
    assert.equal(clientIpFrom("not-an-ip", 1), null);
  });
});

describe("country names", () => {
  it("names every country in the page's language, sorted, value the ISO code", () => {
    const tr = countryOptions("tr", COUNTRY_CODES);
    assert.equal(tr.length, COUNTRY_CODES.length);
    assert.equal(tr.find((c) => c.code === "DE")?.name, "Almanya");
    assert.equal(countryOptions("en", ["TR"])[0]?.name, "Türkiye");
    const names = tr.map((c) => c.name);
    assert.deepEqual(
      names,
      [...names].sort((a, b) => a.localeCompare(b, "tr-TR")),
    );
  });
});
