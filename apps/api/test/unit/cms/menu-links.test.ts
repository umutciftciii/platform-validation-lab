// ML-8c (DP-239): catalogue links of a menu in a language other than the default one. A product,
// a category and the product list are links only while the language has published products
// there; everything else is left out (MENU_HIDDEN), never an English or draft page.
import { describe, expect, it } from "vitest";
import { MENU_HIDDEN, type MenuLinkRef, type MenuTarget } from "@dream/contracts";
import { menuLinkStates } from "../../../src/cms/menu-links.js";
import type { CmsDb } from "../../../src/cms/cms-content.js";

const SITE = "11111111-1111-4111-8111-111111111111";
const P_NL = "22222222-2222-4222-8222-222222222222";
const P_EN = "33333333-3333-4333-8333-333333333333";
const C_ROOT = "44444444-4444-4444-8444-444444444444";
const C_BASE = "55555555-5555-4555-8555-555555555555";
const C_GREASE = "66666666-6666-4666-8666-666666666666";
const IMG = "77777777-7777-4777-8777-777777777777";

const texts = (name: string, categoryName: string | null) => ({
  name,
  summary: null,
  description: null,
  categoryName,
  specNames: { kv100: name === "WO" ? "Kinematic viscosity" : "Kinematische viscositeit" },
  imageAlts: {},
  seo: { title: null, description: null, ogTitle: null, ogDescription: null },
});
const snapshot = (slug: string, category: string, nl: boolean) => ({
  schemaVersion: 2,
  defaultLocale: "en",
  slug,
  code: slug.toUpperCase(),
  category: { slug: category },
  sortOrder: 0,
  specs: [
    {
      key: "kv100",
      basis: "SPECIFICATION",
      value: { type: "NUMBER", number: 6.12 },
      unit: "mm²/s",
      testMethod: "ASTM D445",
    },
  ],
  images: [{ id: IMG, isCover: true, width: 10, height: 10 }],
  seo: { canonicalPath: null, noindex: false, ogImageId: null },
  locales: {
    en: texts("WO", "Base oils"),
    ...(nl ? { nl: texts("Witte olie", "Basisoliën") } : {}),
  },
});

function fakeDb(): CmsDb {
  const pubs = [
    {
      productId: P_NL,
      listingId: "l1",
      snapshot: snapshot("white-oil", "base-oils", true),
      publishedAt: new Date(),
    },
    {
      productId: P_EN,
      listingId: "l2",
      snapshot: snapshot("grease-x", "greases", false),
      publishedAt: new Date(),
    },
  ];
  const categories = [
    { id: C_ROOT, slug: "oils", parentId: null },
    { id: C_BASE, slug: "base-oils", parentId: C_ROOT },
    { id: C_GREASE, slug: "greases", parentId: null },
  ];
  return {
    productPublication: { findMany: async () => pubs },
    productSiteListing: { findMany: async () => [{ id: "l1" }, { id: "l2" }] },
    productCategory: {
      findMany: async ({ where }: { where: { id?: { in: string[] } } }) =>
        where.id ? categories.filter((c) => where.id!.in.includes(c.id)) : categories,
    },
    cmsPage: { findMany: async () => [] },
  } as unknown as CmsDb;
}

const ref = (label: string, target: MenuTarget): MenuLinkRef => ({
  path: `items.${label}`,
  place: label,
  link: { label, target },
});

const LINKS: MenuLinkRef[] = [
  ref("nl-product", { type: "product", productId: P_NL }),
  ref("en-product", { type: "product", productId: P_EN }),
  ref("base", { type: "category", categoryId: C_BASE }),
  ref("root", { type: "category", categoryId: C_ROOT }),
  ref("grease", { type: "category", categoryId: C_GREASE }),
  ref("list", { type: "path", path: "/products" }),
  ref("list-base", { type: "path", path: "/products?category=base-oils" }),
  ref("list-grease", { type: "path", path: "/products?category=greases" }),
];

describe("ML-8c menu catalogue links in Dutch", () => {
  it("links only what is published in Dutch; hides the rest", async () => {
    const state = await menuLinkStates(fakeDb(), SITE, [], LINKS, {
      locale: "nl",
      defaultLocale: "en",
    });
    const href = (i: number) => state(LINKS[i]!.link.target).href;
    expect(href(0)).toBe("/nl/products/white-oil");
    expect(href(1)).toBe(MENU_HIDDEN);
    expect(state(LINKS[1]!.link.target).rule).toBe("not_in_language");
    expect(href(2)).toBe("/nl/products?category=base-oils");
    // the parent of a category with a Dutch product is a link too
    expect(href(3)).toBe("/nl/products?category=oils");
    expect(href(4)).toBe(MENU_HIDDEN);
    expect(href(5)).toBe("/nl/products");
    expect(href(6)).toBe("/nl/products?category=base-oils");
    expect(href(7)).toBe(MENU_HIDDEN);
  });

  it("a language without Dutch products hides the product list as well", async () => {
    const db = fakeDb();
    (
      db as unknown as { productPublication: { findMany: () => Promise<unknown[]> } }
    ).productPublication.findMany = async () => [];
    const state = await menuLinkStates(db, SITE, [], LINKS, { locale: "nl", defaultLocale: "en" });
    for (const l of LINKS) expect(state(l.link.target).href).toBe(MENU_HIDDEN);
  });

  it("the default language is unchanged: live products link, categories always link", async () => {
    const state = await menuLinkStates(fakeDb(), SITE, [], LINKS, {
      locale: "en",
      defaultLocale: "en",
    });
    expect(state(LINKS[0]!.link.target).href).toBe("/products/white-oil");
    expect(state(LINKS[1]!.link.target).href).toBe("/products/grease-x");
    expect(state(LINKS[4]!.link.target).href).toBe("/products?category=greases");
    expect(state(LINKS[5]!.link.target).href).toBe("/products");
  });
});
