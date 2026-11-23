// ML-11 (DP-242, ADR-028 D15): the admin's EN/TR dictionary, `t()`, plural rules, the language
// cookie and the one format module. Rendering in both languages is in i18n-render.test.tsx.
import { DEFAULT_ERROR_MESSAGES, type ErrorCode } from "@dream/contracts";
import { describe, expect, it } from "vitest";
import { ALLOWED_COOKIES, allowedSetCookies, filterCookieHeader } from "../lib/api-proxy";
import { COOKIES_BLOCKED_MESSAGE } from "../lib/cookie-support";
import { failureMessage, POLICY_MESSAGES, recoveryCodesText } from "../lib/credential-link";
import {
  ADMIN_LOCALE_COOKIE,
  ADMIN_LOCALES,
  DEFAULT_ADMIN_LOCALE,
  isAdminLocale,
  localeCookie,
  parseAdminLocale,
} from "../lib/i18n/config";
import {
  formatClock,
  formatLinkExpiry,
  formatLongDate,
  formatNumber,
  greeting,
  relativeTime,
} from "../lib/i18n/format";
import { en } from "../lib/i18n/messages/en";
import { tr } from "../lib/i18n/messages/tr";
import { createTranslator, interpolate, lookup, pluralCategory } from "../lib/i18n/translate";
import type { Messages } from "../lib/i18n/types";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/navigation";

type Tree = { [key: string]: string | Tree };

/** Every leaf as [dotted key, text]; plural forms are leaves "key.one" / "key.other". */
function leaves(tree: Tree, prefix = ""): Array<[string, string]> {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === "string" ? [[`${prefix}${k}`, v]] : leaves(v, `${prefix}${k}.`),
  ) as Array<[string, string]>;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const EN = leaves(en as unknown as Tree);
const TR = leaves(tr as unknown as Tree);

/** Texts that are the same in both languages on purpose (names, brands, technical terms). */
const SAME_IN_TR = new Set([
  "language.english",
  "language.turkish",
  "shell.environments.staging",
  "shell.environments.production",
  "nav.items.seo.label",
  "auth.logoAlt",
  // ML-12a: a name, technical terms, or a message made only of parameters
  "catalog.common.site",
  "catalog.common.tabs.seo",
  "catalog.issues.spec.invalid_range",
  "catalog.list.review.when.known",
  "catalog.media.documents.fields.typeOption",
  "catalog.taxonomy.categories.slug",
  // ML-12b: technical terms and the word "Site" (the same in Turkish)
  "companyReview.current.sku",
  "companyReview.current.slug",
  "companyReview.detail.sku",
  "companyReview.list.site",
]);

describe("dictionary completeness (EN source, TR)", () => {
  it("TR has exactly the English keys, every text non-empty", () => {
    expect(TR.map(([k]) => k)).toEqual(EN.map(([k]) => k));
    for (const [key, text] of [...EN, ...TR]) expect(text.trim(), key).not.toBe("");
  });

  it("TR uses the same parameters as English in every message", () => {
    const english = new Map(EN);
    for (const [key, text] of TR)
      expect(placeholders(text), key).toEqual(placeholders(english.get(key)!));
  });

  it("TR is translated: only names, brands and technical terms stay English", () => {
    const english = new Map(EN);
    const same = TR.filter(([key, text]) => text === english.get(key)).map(([k]) => k);
    expect(same.sort()).toEqual([...SAME_IN_TR].sort());
  });

  it("counts the keys of this release", () => {
    // ML-11 scope: shell, navigation, auth, errors, 404 and the error boundary (ADR-028 D15);
    // ML-12a adds the Products/Catalog area (catalog.*), ML-12b the Company Review area.
    expect(EN.length).toBe(TR.length);
    expect(EN.length).toBeGreaterThan(200);
    expect(EN.filter(([k]) => k.startsWith("catalog.")).length).toBeGreaterThan(1000);
    expect(EN.filter(([k]) => k.startsWith("companyReview.")).length).toBeGreaterThan(200);
  });

  it("a missing or an extra Turkish key is a compile error", () => {
    const { tryAgain, ...common } = tr.common;
    expect(tryAgain).toBe("Tekrar dene");
    // @ts-expect-error a dictionary without `common.tryAgain` does not satisfy Messages
    const missing: Messages = { ...tr, common };
    // @ts-expect-error a key English does not have is rejected too
    const extra: Messages = { ...tr, common: { ...tr.common, unknownKey: "x" } };
    // @ts-expect-error an unknown key cannot be translated
    createTranslator("tr")("common.unknownKey");
    // @ts-expect-error a message with a parameter needs it
    createTranslator("tr")("shell.environment");
    // @ts-expect-error a plural needs its count
    createTranslator("tr")("time.days", {});
    expect(missing && extra).toBeTruthy();
  });
});

describe("error codes: the admin translates by code (ADR-028 D15)", () => {
  const codes = Object.keys(DEFAULT_ERROR_MESSAGES) as ErrorCode[];

  it("English equals the contract's text for every code", () => {
    expect(Object.keys(en.errors).sort()).toEqual([...codes].sort());
    for (const code of codes) expect(en.errors[code], code).toBe(DEFAULT_ERROR_MESSAGES[code]);
  });

  it("Turkish has a message for every code; the codes themselves never change", () => {
    for (const code of codes) expect(tr.errors[code], code).not.toBe(DEFAULT_ERROR_MESSAGES[code]);
    const t = createTranslator("tr");
    expect(failureMessage("other", "FORBIDDEN", t)).toBe(tr.errors.FORBIDDEN);
    expect(failureMessage("link", "AUTH_TOKEN_INVALID", t)).toBe(tr.link.failure.link);
  });

  it("keeps the English link messages and policy texts byte for byte", () => {
    expect(failureMessage("rate", null)).toBe(
      "Too many attempts. Wait a few minutes before trying again.",
    );
    expect(failureMessage("other", "CONFLICT_STATE")).toBe(
      "This action is not possible in the current state.",
    );
    expect(failureMessage("other", null)).toBe("Something went wrong. Try again in a moment.");
    expect(POLICY_MESSAGES.too_short).toBe("Use at least 12 characters.");
    expect(COOKIES_BLOCKED_MESSAGE).toMatch(/^This browser did not keep the secure sign-in cookie/);
  });

  it("writes the recovery-code file in the console's language", () => {
    const codes = ["ABCDE-12345"];
    expect(recoveryCodesText(codes, "r***@x.test")).toBe(
      [
        "Dream Petroleum admin console: recovery codes",
        "Account: r***@x.test",
        "",
        "Each code works once, for sign-in when your authenticator is not at hand.",
        "Keep this file offline and out of shared folders.",
        "",
        "ABCDE-12345",
        "",
      ].join("\n"),
    );
    const turkish = recoveryCodesText(codes, "r***@x.test", createTranslator("tr"));
    expect(turkish).toContain("Hesap: r***@x.test");
    expect(turkish).toContain("ABCDE-12345");
  });
});

describe("t(): parameters, plural rules, fallback", () => {
  const enT = createTranslator("en");
  const trT = createTranslator("tr");

  it("fills parameters", () => {
    expect(enT("shell.environment", { name: "Staging" })).toBe("Environment: Staging");
    expect(trT("shell.environment", { name: "Staging" })).toBe("Ortam: Staging");
    expect(interpolate("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });

  it("chooses plural forms with Intl.PluralRules", () => {
    expect(enT("time.days", { count: 1 })).toBe("1 day");
    expect(enT("time.days", { count: 2 })).toBe("2 days");
    expect(enT("time.days", { count: 0 })).toBe("0 days");
    expect(trT("time.days", { count: 1 })).toBe("1 gün");
    expect(trT("time.days", { count: 5 })).toBe("5 gün");
    expect(pluralCategory("en", 1)).toBe("one");
    expect(pluralCategory("tr", 1)).toBe("one");
    expect(pluralCategory("tr", 2)).toBe("other");
  });

  it("returns one string per key, also for nested keys", () => {
    expect(enT("nav.items.staff.label")).toBe("Staff and access");
    expect(trT("nav.items.staff.label")).toBe("Personel ve erişim");
    expect(lookup(en, "nav.items")).toBeUndefined();
  });

  it("falls back to English, then to the key, for an unknown key at run time", () => {
    const loose = trT as unknown as (k: string) => string;
    expect(loose("does.not.exist")).toBe("does.not.exist");
  });

  it("navigation keeps its English labels; every item and group has a message", () => {
    expect(NAV_ITEMS.find((i) => i.slug === "staff")?.label).toBe("Staff and access");
    for (const item of NAV_ITEMS) {
      expect(trT(`nav.items.${item.id}.label`)).not.toBe("");
      expect(item.label).toBe(en.nav.items[item.id].label);
    }
    for (const group of NAV_GROUPS) expect(group.label).toBe(en.nav.groups[group.id]);
  });
});

describe("language cookie (dp-admin-locale)", () => {
  it("accepts only en and tr; everything else is English", () => {
    expect(ADMIN_LOCALES).toEqual(["en", "tr"]);
    expect(DEFAULT_ADMIN_LOCALE).toBe("en");
    expect(parseAdminLocale("tr")).toBe("tr");
    expect(parseAdminLocale("en")).toBe("en");
    for (const bad of [
      undefined,
      null,
      "",
      "TR",
      "tr-TR",
      "nl",
      "de",
      "tr;",
      " tr",
      "<b>",
      1,
      {},
    ]) {
      expect(parseAdminLocale(bad), String(bad)).toBe("en");
      expect(isAdminLocale(bad)).toBe(false);
    }
  });

  it("is a plain display cookie: path-wide, one year, SameSite=Lax, Secure on https", () => {
    expect(ADMIN_LOCALE_COOKIE).toBe("dp-admin-locale");
    expect(localeCookie("tr", true)).toBe(
      "dp-admin-locale=tr; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
    );
    expect(localeCookie("en", false)).toBe(
      "dp-admin-locale=en; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });

  it("never reaches the API: the proxy forwards only the two session cookies", () => {
    expect(ALLOWED_COOKIES).not.toContain(ADMIN_LOCALE_COOKIE);
    expect(
      filterCookieHeader("dp-admin-locale=tr; __Host-dp_admin_session=abc; dp-admin-theme=dark"),
    ).toBe("__Host-dp_admin_session=abc");
    expect(filterCookieHeader("dp-admin-locale=tr")).toBeNull();
    expect(allowedSetCookies(["dp-admin-locale=tr; Path=/"])).toEqual([]);
  });
});

describe("format module: English unchanged, Turkish per tr-TR", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("relative times", () => {
    expect(relativeTime(ago(20_000), now)).toBe("just now");
    expect(relativeTime(ago(12 * 60_000), now)).toBe("12 min ago");
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe("3 h ago");
    expect(relativeTime(ago(86_400_000), now)).toBe("1 day ago");
    expect(relativeTime(ago(2 * 86_400_000), now)).toBe("2 days ago");
    expect(relativeTime(ago(-25 * 60_000), now)).toBe("in 25 min");
    expect(relativeTime(ago(20_000), now, "tr")).toBe("az önce");
    expect(relativeTime(ago(12 * 60_000), now, "tr")).toBe("12 dk önce");
    expect(relativeTime(ago(2 * 86_400_000), now, "tr")).toBe("2 gün önce");
    expect(relativeTime(ago(-25 * 60_000), now, "tr")).toBe("25 dk sonra");
  });

  it("numbers, clock, long date, greeting", () => {
    expect(formatNumber(12345.5)).toBe("12,345.5");
    expect(formatNumber(12345.5, "tr")).toBe("12.345,5");
    expect(formatClock(now)).toBe("13:00");
    expect(formatClock(now, undefined, "tr")).toBe("13:00");
    expect(formatLongDate(now)).toBe("Monday 23 November");
    expect(formatLongDate(now, undefined, "tr")).toBe("23 Kasım Pazartesi");
    expect(greeting(now)).toBe("Good afternoon");
    expect(greeting(now, undefined, "tr")).toBe("İyi günler");
  });

  it("the credential link expiry is the pre-ML-11 English format", () => {
    const before = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Amsterdam",
      timeZoneName: "short",
    });
    expect(formatLinkExpiry(now)).toBe(before.format(now));
    expect(formatLinkExpiry(now, "tr")).toMatch(/^23 Kas/);
  });
});
