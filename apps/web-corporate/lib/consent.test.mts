// COM-6: the cookie choice and GA4 behind it: no script before consent, accept / refuse /
// change, the choice kept for the next visit, withdrawal stops every further hit.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE,
  analyticsCookieNames,
  applyConsent,
  consentCookie,
  decide,
  expireCookie,
  ga4ScriptUrl,
  measurementIdOf,
  readConsent,
  type ConsentEnv,
} from "./consent.ts";

const ID = "G-TEST12345";

/** A browser with a cookie jar (name=value; attributes ignored except Max-Age=0) and scripts. */
function browser(initial = "") {
  const jar = new Map<string, string>();
  for (const part of initial.split(";").filter((p) => p.trim())) {
    const [n, v = ""] = part.trim().split("=");
    jar.set(n!, v);
  }
  const scripts: string[] = [];
  const writes: string[] = [];
  const env: ConsentEnv = {
    readCookies: () => [...jar].map(([n, v]) => `${n}=${v}`).join("; "),
    writeCookie: (a) => {
      writes.push(a);
      const [pair = ""] = a.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      if (/Max-Age=0/.test(a)) jar.delete(name);
      else jar.set(name, pair.slice(eq + 1));
    },
    hostname: "www.dreampetroleum.com",
    secure: true,
    win: {},
    addScript: (src) => void scripts.push(src),
    hasScript: (src) => scripts.includes(src),
  };
  /** The commands the page gave gtag, as plain arrays. */
  const commands = () =>
    ((env.win["dataLayer"] as IArguments[] | undefined) ?? []).map((a) => Array.from(a));
  return { env, jar, scripts, writes, commands };
}

describe("measurementIdOf (configuration, never in code)", () => {
  it("reads a GA4 id from the environment, or nothing", () => {
    assert.equal(measurementIdOf({ DP_GA4_MEASUREMENT_ID_CORPORATE: "G-ABC1234" }), "G-ABC1234");
    assert.equal(measurementIdOf({ DP_GA4_MEASUREMENT_ID_CORPORATE: " g-abc1234 " }), "G-ABC1234");
    for (const v of [undefined, "", "UA-1234-1", "G-", "G-abc def", "<script>"]) {
      assert.equal(measurementIdOf({ DP_GA4_MEASUREMENT_ID_CORPORATE: v }), null, String(v));
    }
    assert.equal(measurementIdOf({}), null);
  });
});

describe("the stored choice", () => {
  it("round-trips through the cookie and is kept 180 days", () => {
    const c = consentCookie({ analytics: true, decidedAt: 1764331200 }, true);
    assert.equal(
      c,
      `${CONSENT_COOKIE}=v1.a1.1764331200; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax; Secure`,
    );
    assert.equal(CONSENT_MAX_AGE, 15552000);
    assert.deepEqual(readConsent(`x=1; ${c.split(";")[0]}; y=2`), {
      analytics: true,
      decidedAt: 1764331200,
    });
    assert.deepEqual(readConsent("dp_consent=v1.a0.5"), { analytics: false, decidedAt: 5 });
    assert.ok(!consentCookie({ analytics: false, decidedAt: 1 }, false).includes("Secure"));
  });

  it("asks again without a choice, with an unknown version or a broken value", () => {
    for (const v of [undefined, "", "a=b", "dp_consent=", "dp_consent=v2.a1.1", "dp_consent=yes"]) {
      assert.equal(readConsent(v), null, String(v));
    }
  });
});

describe("GA4 behind the choice", () => {
  it("loads nothing before the visitor decides, nor without a configured id", () => {
    const b = browser();
    assert.equal(applyConsent(b.env, ID, null), "off");
    assert.deepEqual(b.scripts, []);
    assert.equal(b.env.win["gtag"], undefined);
    assert.equal(b.env.win[`ga-disable-${ID}`], true);
    const none = browser("dp_consent=v1.a1.1");
    assert.equal(applyConsent(none.env, null, readConsent(none.env.readCookies())), "off");
    assert.deepEqual(none.scripts, []);
  });

  it("accept: stores the choice and loads GA4 once, with ad features off", () => {
    const b = browser();
    assert.equal(decide(b.env, ID, true, 1764331200_000), "loaded");
    assert.deepEqual(readConsent(b.env.readCookies()), { analytics: true, decidedAt: 1764331200 });
    assert.deepEqual(b.scripts, [ga4ScriptUrl(ID)]);
    assert.equal(ga4ScriptUrl(ID), "https://www.googletagmanager.com/gtag/js?id=G-TEST12345");
    const cmds = b.commands();
    assert.deepEqual(cmds[0], [
      "consent",
      "default",
      {
        analytics_storage: "granted",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      },
    ]);
    assert.equal(cmds[1]?.[0], "js");
    assert.deepEqual(cmds[2], [
      "config",
      ID,
      { allow_google_signals: false, allow_ad_personalization_signals: false },
    ]);
    assert.equal(b.env.win[`ga-disable-${ID}`], false);
  });

  it("refuse: stores the choice, loads nothing", () => {
    const b = browser();
    assert.equal(decide(b.env, ID, false), "off");
    assert.equal(readConsent(b.env.readCookies())?.analytics, false);
    assert.deepEqual(b.scripts, []);
  });

  it("the next visit applies the stored choice without asking", () => {
    const granted = browser("dp_consent=v1.a1.1764331200");
    assert.equal(applyConsent(granted.env, ID, readConsent(granted.env.readCookies())), "loaded");
    const refused = browser("dp_consent=v1.a0.1764331200");
    assert.equal(applyConsent(refused.env, ID, readConsent(refused.env.readCookies())), "off");
    assert.deepEqual(refused.scripts, []);
  });

  it("withdrawal stops every further hit and removes the GA4 cookies", () => {
    const b = browser("_ga=GA1.1.1.1; _ga_TEST12345=GS1.1; other=1");
    decide(b.env, ID, true);
    assert.equal(decide(b.env, ID, false), "stopped");
    // gtag.js sends nothing while this flag is true (Google's documented opt-out).
    assert.equal(b.env.win[`ga-disable-${ID}`], true);
    assert.deepEqual(b.commands().at(-1), ["consent", "update", { analytics_storage: "denied" }]);
    assert.deepEqual(analyticsCookieNames(b.env.readCookies()), []);
    assert.ok(b.jar.has("other"));
    assert.ok(
      b.writes.some((w) => w.startsWith("_ga=;") && w.endsWith("Domain=.dreampetroleum.com")),
    );
    // Granted again in the same page: resumed, the script is not added twice.
    assert.equal(decide(b.env, ID, true), "resumed");
    assert.equal(b.scripts.length, 1);
    assert.equal(b.env.win[`ga-disable-${ID}`], false);
  });

  it("removes GA4 cookies on every parent domain, never on an IP address", () => {
    assert.deepEqual(
      expireCookie("_ga", "www.dreampetroleum.com").map((a) => a.split("; ").at(-1)),
      [
        "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        "Domain=.www.dreampetroleum.com",
        "Domain=.dreampetroleum.com",
      ],
    );
    assert.equal(expireCookie("_ga", "127.0.0.1").length, 1);
    assert.equal(expireCookie("_ga", "localhost").length, 1);
    assert.deepEqual(analyticsCookieNames("_ga=1; _ga_ABC=2; _gid=3; _gat_UA-1=4; _gax=5; ga=6"), [
      "_ga",
      "_ga_ABC",
      "_gid",
      "_gat_UA-1",
    ]);
  });
});
