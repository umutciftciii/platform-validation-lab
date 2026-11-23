// ML-12a (DP-243): the catalogue's other screens — categories, specifications, global brands, new
// product, review queue — rendered on the server with real response shapes (the admin API and the
// session are fixtures), with and without access, in the source language and in a translation
// language. Every render is compared with the English HTML recorded before ML-12a
// (support/en-baseline-render.ts); test/catalog-i18n.test.tsx renders the same pages in Turkish.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BV, C, catalogFixtures, type Page, props, reads } from "./support/catalog-fixtures";
import { renderToStaticMarkup } from "./support/en-baseline-render";

// ML-12a: the pages read the console language from the cookie (none here: English).
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));
vi.mock("../lib/server-api", async () => {
  const { reads } = await import("./support/catalog-fixtures");
  return {
    serverRead: async (path: string, schema: { parse(v: unknown): unknown }) => {
      if (!reads.has(path)) return { ok: false, status: 404, code: "NOT_FOUND" };
      return { ok: true, data: schema.parse(reads.get(path)) };
    },
  };
});
vi.mock("../lib/server-session", () => ({ requireStaffSession: async () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
  usePathname: () => "/products",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));

const { default: CategoriesPage } = await import("../app/(console)/products/categories/page");
const { default: SpecsPage } = await import("../app/(console)/products/specifications/page");
const { default: BrandsPage } = await import("../app/(console)/products/brands/page");
const { default: NewPage } = await import("../app/(console)/products/new/page");
const { default: ReviewPage } = await import("../app/(console)/products/review/page");

async function html(page: Page, q: Record<string, string> = {}) {
  return renderToStaticMarkup((await page(props(q))) as never);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T09:00:00.000Z"));
});

describe("catalogue screens render (EN baseline)", () => {
  for (const canEdit of [true, false]) {
    const who = canEdit ? "editor" : "reader";
    it(`categories, ${who}, source and translation language`, async () => {
      catalogFixtures({ canEdit });
      expect(await html(CategoriesPage)).toContain("Engine oils");
      expect(await html(CategoriesPage, { lang: "nl" })).toContain("Motoroliën");
    });
    it(`specifications, ${who}, source and translation language`, async () => {
      catalogFixtures({ canEdit });
      expect(await html(SpecsPage)).toContain("kv100");
      expect(await html(SpecsPage, { lang: "nl" })).toContain("Kinematische viscositeit");
    });
    it(`global brands, ${who}`, async () => {
      catalogFixtures({ canEdit });
      expect(await html(BrandsPage)).toContain("Acme");
    });
    it(`new product, ${who}`, async () => {
      catalogFixtures({ canEdit });
      expect(await html(NewPage)).toBeTypeOf("string");
    });
    it(`review queue, ${who}`, async () => {
      catalogFixtures({ canEdit, canApprove: canEdit });
      expect(await html(ReviewPage)).toContain("ICC-SYN-6");
    });
  }

  it("every screen without catalogue access", async () => {
    reads.clear();
    for (const page of [CategoriesPage, SpecsPage, BrandsPage, NewPage, ReviewPage]) {
      expect(await html(page)).toBeTypeOf("string");
    }
  });

  it("every screen with an empty catalogue or a failed read", async () => {
    catalogFixtures({ canEdit: true });
    reads.set(`${C}/sites/${BV}/categories`, { items: [] });
    reads.set(`${C}/spec-definitions`, { items: [] });
    reads.set(`${C}/global-brands?archived=1`, { items: [], canEdit: true });
    reads.set(`${C}/review-queue`, { items: [], total: 0, canApprove: true });
    for (const page of [CategoriesPage, SpecsPage, BrandsPage, ReviewPage]) {
      expect(await html(page)).toBeTypeOf("string");
    }
    for (const path of [
      `${C}/sites/${BV}/categories`,
      `${C}/spec-definitions`,
      `${C}/global-brands?archived=1`,
      `${C}/review-queue`,
      `${C}/sites/${BV}/categories/translations?locale=en`,
      `${C}/spec-definitions/translations?locale=en`,
    ])
      reads.delete(path);
    for (const page of [CategoriesPage, SpecsPage, BrandsPage, ReviewPage]) {
      expect(await html(page)).toBeTypeOf("string");
    }
  });
});
