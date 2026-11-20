// ML-1 (DP-073, ADR-028 D2): the language lists and the publication gate over a fake reader.
import { describe, expect, it } from "vitest";
import {
  assertLocaleEnabled,
  publicLocaleSet,
  publicSiteLocales,
  siteLocalesOf,
  type LocaleReader,
} from "../../../src/cms/site-locales.js";

const BV = "0190f2a1-0000-7000-8000-0000000000b1";
const COM = "0190f2a1-0000-7000-8000-0000000000c1";
const ROWS = [
  { siteId: BV, locale: "nl", enabled: true, public: false, isDefault: false, sortOrder: 10 },
  { siteId: COM, locale: "en", enabled: true, public: true, isDefault: true, sortOrder: 0 },
  { siteId: BV, locale: "en", enabled: true, public: true, isDefault: true, sortOrder: 0 },
];

function reader(rows = ROWS): LocaleReader {
  return {
    siteLocale: {
      findMany: (async (args: { where: { siteId: { in: string[] } } }) =>
        rows.filter((r) => args.where.siteId.in.includes(r.siteId))) as never,
    },
  };
}

describe("site language lists", () => {
  it("groups by site, default first, and maps unknown sites to an empty list", async () => {
    const other = "0190f2a1-0000-7000-8000-0000000000d1";
    const map = await siteLocalesOf(reader(), [BV, COM, other]);
    expect(map.get(BV)?.map((l) => l.locale)).toEqual(["en", "nl"]);
    expect(map.get(COM)?.map((l) => l.locale)).toEqual(["en"]);
    expect(map.get(other)).toEqual([]);
    expect(map.get(BV)?.[0]).not.toHaveProperty("siteId");
  });

  it("gives the public sites only their public languages", async () => {
    expect(await publicSiteLocales(reader(), BV)).toEqual({
      defaultLocale: "en",
      locales: [{ locale: "en", isDefault: true }],
    });
  });

  it("fails closed when a site has no public default", async () => {
    await expect(publicSiteLocales(reader([]), BV)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });
});

describe("edit gate and visibility", () => {
  it("lets every enabled language be edited and published, public or not", async () => {
    await expect(assertLocaleEnabled(reader(), BV, "en")).resolves.toBeUndefined();
    await expect(assertLocaleEnabled(reader(), BV, "nl")).resolves.toBeUndefined();
    await expect(assertLocaleEnabled(reader(), BV, "de")).rejects.toMatchObject({
      code: "CONFLICT_STATE",
      details: [{ path: "locale", rule: "not_enabled" }],
    });
    const closed = ROWS.map((r) => (r.locale === "nl" ? { ...r, enabled: false } : r));
    await expect(assertLocaleEnabled(reader(closed), BV, "nl")).rejects.toMatchObject({
      details: [{ path: "locale", rule: "not_enabled" }],
    });
    // Corporate has no Dutch at all.
    await expect(assertLocaleEnabled(reader(), COM, "nl")).rejects.toMatchObject({
      details: [{ path: "locale", rule: "not_enabled" }],
    });
  });

  it("shows visitors only the public languages", async () => {
    expect([...(await publicLocaleSet(reader(), BV))]).toEqual(["en"]);
    expect([...(await publicLocaleSet(reader(), COM))]).toEqual(["en"]);
    expect([...(await publicLocaleSet(reader([]), BV))]).toEqual([]);
  });
});
