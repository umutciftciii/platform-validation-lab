// ML-12a (DP-243): the Products/Catalog screens in Turkish. Every screen and state is rendered twice
// on the server with the same fixtures — once in English, once with the `dp-admin-locale=tr` cookie
// — and compared text by text. A visible text (text node, aria-label, title, placeholder, alt) that
// is the same in both languages is English left behind, unless it is data from the fixtures
// (product, category, specification and brand names, codes, units, file names) or a name or a
// technical term that never changes (SAME_IN_BOTH). English itself is covered byte for byte by the
// EN baseline (support/en-baseline-render.ts); this file proves the Turkish side.
import type { ProductListItem } from "@dream/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/i18n/locale-provider";
import type { AdminLocale } from "../lib/i18n/config";
import {
  BV,
  C,
  catalogFixtures,
  CORP as CORP_ID,
  type Page,
  props,
  reads,
} from "./support/catalog-fixtures";
import { fixtures as productFixtures, PRODUCT } from "./support/product-fixtures";

const ui = vi.hoisted(() => ({ locale: "en" as AdminLocale }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "dp-admin-locale" ? { value: ui.locale } : undefined),
    has: () => false,
  }),
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

const pages = {
  list: (await import("../app/(console)/products/page")).default,
  product: (await import("../app/(console)/products/[id]/page")).default,
  categories: (await import("../app/(console)/products/categories/page")).default,
  specifications: (await import("../app/(console)/products/specifications/page")).default,
  brands: (await import("../app/(console)/products/brands/page")).default,
  new: (await import("../app/(console)/products/new/page")).default,
  review: (await import("../app/(console)/products/review/page")).default,
};
const metadataOf = {
  list: (await import("../app/(console)/products/page")) as Meta,
  categories: (await import("../app/(console)/products/categories/page")) as Meta,
  specifications: (await import("../app/(console)/products/specifications/page")) as Meta,
  brands: (await import("../app/(console)/products/brands/page")) as Meta,
  new: (await import("../app/(console)/products/new/page")) as Meta,
  review: (await import("../app/(console)/products/review/page")) as Meta,
};
type Meta = { generateMetadata?: (p: never) => Promise<{ title?: unknown }> };

/** Names, technical terms and symbols that are the same in English and Turkish on purpose. */
const SAME_IN_BOTH = new Set([
  "Dream Petroleum BV",
  "Corporate",
  "BV",
  "EN",
  "NL",
  "SEO",
  "Site",
  "URL",
  "PDF",
  "CSV",
  "Open Graph",
  "noindex",
  "slug",
  "Slug",
  "°C",
  "mm²/s",
  "kv100",
]);

async function render(page: Page, locale: AdminLocale, q: Record<string, string> = {}) {
  ui.locale = locale;
  const tree = (await page({
    ...(props(q) as object),
    params: Promise.resolve({ id: PRODUCT }),
  } as never)) as ReactElement;
  return renderToStaticMarkup(<LocaleProvider locale={locale}>{tree}</LocaleProvider>);
}

const decode = (s: string) =>
  s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&nbsp;", " ");

/** Visible texts: text nodes and the attributes people read or hear. */
function texts(html: string): string[] {
  const out: string[] = [];
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "");
  for (const m of body.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g))
    out.push(decode(m[1] as string));
  for (const m of body.replace(/<[^>]+>/g, "\u0000").split("\u0000")) out.push(decode(m));
  return out.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => /[A-Za-z]{2,}/.test(t));
}

/** Every string value of the API fixtures: data that is shown as it is. */
function fixtureData(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const v of reads.values()) walk(v);
  return out;
}

function isData(text: string, data: readonly string[]): boolean {
  if (SAME_IN_BOTH.has(text)) return true;
  // a quoted value, initials of a person (avatar), an address or a URL shown as it is
  const unquoted = text.replace(/^[“"‘']|[”"’']$/g, "");
  if (unquoted !== text) return isData(unquoted, data);
  if (/^[A-Z]{1,2}$/.test(text)) return true;
  if (/^(?:https?:\/\/|localhost)|\s›\s/.test(text)) return true;
  if (data.some((d) => d === text || (text.length > 3 && d.includes(text)))) return true;
  // a composition of data and fixed tokens, e.g. "ICC-SYN-6 · BV" or "ASTM D445, ISO 3104"
  const rest = text.split(/\s*(?:·|,|\/|—|–|:|\(|\)|\|)\s*/).filter((p) => /[A-Za-z]{2,}/.test(p));
  return rest.length > 1 && rest.every((p) => isData(p, data));
}

/** English left in the Turkish render: texts equal in both renders that are not data. */
async function englishLeft(page: Page, q: Record<string, string> = {}) {
  const enTexts = new Set(texts(await render(page, "en", q)));
  const trHtml = await render(page, "tr", q);
  const data = fixtureData();
  const left = [...new Set(texts(trHtml))].filter((t) => enTexts.has(t) && !isData(t, data));
  return { left, trHtml };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T09:00:00.000Z"));
});

function listFixtures() {
  const T = "2026-11-17T10:00:00.000Z";
  const item = (n: number, name: string, status: ProductListItem["status"]): ProductListItem => ({
    id: `0190a8c4-7c1e-7000-8000-${String(n).padStart(12, "0")}`,
    code: `P-${n}`,
    slug: `p-${n}`,
    name,
    status,
    version: 1,
    updatedAt: T,
    listing:
      n === 3
        ? null
        : {
            id: `0190a8c4-7c1e-7000-8000-${String(n + 100).padStart(12, "0")}`,
            visibility: "VISIBLE",
            categoryId: "44444444-4444-4444-8444-444444444444",
            categoryName: "Engine oils",
            updatedAt: T,
          },
    publication: n === 2 ? { status: "PUBLISHED", productVersion: 1 } : null,
  });
  const query = "sort=name&order=asc&page=1&pageSize=25";
  const items = [
    item(1, "Fresh draft oil", "DRAFT"),
    item(2, "Live approved oil", "APPROVED"),
    item(3, "Unlisted oil", "IN_REVIEW"),
    item(4, "Old oil", "ARCHIVED"),
  ];
  reads.set(`${C}/products?siteId=${BV}&${query}`, { items, page: 1, pageSize: 25, total: 60 });
  reads.set(`${C}/products?siteId=${CORP_ID}&${query}`, {
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  });
}

describe("Products/Catalog in Turkish: no English left (ML-12a)", () => {
  const cases: Array<[string, () => void, Page, Record<string, string>]> = [
    ["list, editor", () => (catalogFixtures({ canEdit: true }), listFixtures()), pages.list, {}],
    [
      "list, empty search",
      () => (catalogFixtures({ canEdit: true }), listFixtures()),
      pages.list,
      { q: "zzz", site: "corporate" },
    ],
    ["new product", () => catalogFixtures({ canEdit: true }), pages.new, {}],
    ["new product, reader", () => catalogFixtures({ canEdit: false }), pages.new, {}],
    ["review queue", () => catalogFixtures({ canEdit: true, canApprove: true }), pages.review, {}],
    ["categories", () => catalogFixtures({ canEdit: true }), pages.categories, {}],
    [
      "categories, Dutch",
      () => catalogFixtures({ canEdit: true }),
      pages.categories,
      { lang: "nl" },
    ],
    ["specifications", () => catalogFixtures({ canEdit: true }), pages.specifications, {}],
    [
      "specifications, Dutch",
      () => catalogFixtures({ canEdit: false }),
      pages.specifications,
      { lang: "nl" },
    ],
    ["global brands", () => catalogFixtures({ canEdit: true }), pages.brands, {}],
    ["product, content", () => productFixtures({ canEditMaster: true }), pages.product, {}],
    [
      "product, technical",
      () => productFixtures({ canEditMaster: true }),
      pages.product,
      { tab: "technical" },
    ],
    [
      "product, media",
      () => productFixtures({ canEditMaster: true }),
      pages.product,
      { tab: "media" },
    ],
    ["product, SEO", () => productFixtures({ canEditMaster: true }), pages.product, { tab: "seo" }],
    [
      "product, publication",
      () => productFixtures({ canEditMaster: true }),
      pages.product,
      { tab: "publication" },
    ],
    [
      "product, Dutch",
      () => productFixtures({ canEditMaster: true }),
      pages.product,
      { lang: "nl" },
    ],
    ["product, reader", () => productFixtures({ canEditMaster: false }), pages.product, {}],
    ["no access", () => reads.clear(), pages.list, {}],
  ];

  for (const [name, setup, page, q] of cases) {
    it(name, async () => {
      setup();
      const { left, trHtml } = await englishLeft(page, q);
      expect(trHtml.length).toBeGreaterThan(100);
      expect(left).toEqual([]);
    });
  }

  it("titles of the pages (metadata) are Turkish", async () => {
    catalogFixtures({ canEdit: true });
    for (const [name, mod] of Object.entries(metadataOf)) {
      expect(mod.generateMetadata, name).toBeTypeOf("function");
      ui.locale = "en";
      const en = await mod.generateMetadata!(props() as never);
      ui.locale = "tr";
      const tr = await mod.generateMetadata!(props() as never);
      expect(tr.title, name).not.toEqual(en.title);
    }
  });

  it("product data, codes and standards stay as they are in Turkish", async () => {
    productFixtures({ canEditMaster: true });
    const html = await render(pages.product, "tr", { tab: "technical" });
    expect(html).toContain("ICCSYN 6 Synthetic");
    expect(html).toContain("ICC-SYN-6");
    expect(html).toContain("Kinematic viscosity");
  });
});
