// DP-219: the header and footer menus of the BV site — content schema version 2, the reading of
// version 1 content, the public shape the site renders and the reference conversion.
import { describe, expect, it } from "vitest";
import {
  BV_FOOTER_KEY,
  BV_NAV_KEY,
  BvFooterMenuSchema,
  BvFooterPublicSchema,
  BvNavMenuSchema,
  BvNavPublicSchema,
  CMS_DESIGN_TEMPLATES,
  MENU_LIMITS,
  cmsIsMenu,
  footerLinks,
  menuPublicFooter,
  menuPublicNav,
  menuReferencePlan,
  menuReferences,
  menuTargetCheck,
  menuTargetOfHref,
  navLinks,
  type CmsMenuTargetsResponse,
  type MenuTarget,
} from "../src/index.js";

const PAGE = "0190f2a1-0000-7000-8000-000000000001";
const PAGE_OFF = "0190f2a1-0000-7000-8000-000000000002";
const CAT = "0190f2a1-0000-7000-8000-000000000003";
const PRODUCT = "0190f2a1-0000-7000-8000-000000000004";

/** The navigation as DEV holds it today (DP-134, content version 1). */
const NAV_V1 = {
  items: [
    { label: "Home", href: "#top" },
    { label: "Products", href: "/products" },
    { label: "Services", href: "#services" },
    { label: "Company", href: "/about-us" },
    { label: "Blogs", href: "/news" },
    { label: "Contact Us", href: "/contact" },
  ],
  contact: { label: "Contact", href: "/contact" },
  noScriptLinks: [
    { label: "Home", href: "#top" },
    { label: "Products", href: "/products" },
    { label: "Services", href: "/#services" },
  ],
  pendingNote: "This page isn't ready yet.",
};

const FOOTER_V1 = {
  headline: "Let’s Move Energy Forward.",
  cta: { label: "Get in Touch", href: "/contact" },
  intro: "Intro.",
  contact: {
    title: "Contact Us",
    company: "Dream Petroleum B.V.",
    addressLines: [{ text: "Herengracht 420" }, { text: "1017 AMSTERDAM" }],
    phone: { label: "020 210 13 50", href: "tel:+31202101350", note: "Mon–Fri" },
    email: {
      label: "info@dreampetroleumbv.com",
      href: "mailto:info@dreampetroleumbv.com",
      note: "24h",
    },
  },
  columns: [
    {
      title: "Products",
      links: [
        { label: "Base Oils", href: "/products?category=base-oil" },
        { label: "Solvents", href: "/products?category=solvent-oil" },
        { label: "Petrochemicals", href: "/products" },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "About Us", href: "/about-us" },
        { label: "CTL", href: "/products/iccsyn-10-ctl-technology#documents" },
      ],
    },
  ],
  copyright: "© 2026 Dream Petroleum BV.",
  legal: [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms & Conditions", href: null },
  ],
  pendingNote: "page not available yet",
};

const TARGETS: CmsMenuTargetsResponse = {
  pages: [
    {
      id: PAGE,
      title: "About Us",
      kind: "TEMPLATE",
      path: "/about-us",
      livePath: "/about-us",
      status: "PUBLISHED",
    },
    {
      id: PAGE_OFF,
      title: "Old",
      kind: "TEMPLATE",
      path: "/old",
      livePath: null,
      status: "UNPUBLISHED",
    },
  ],
  products: [
    {
      id: PRODUCT,
      name: "ICCSYN 10",
      code: "ICCSYN-10",
      livePath: "/products/iccsyn-10-ctl-technology",
    },
  ],
  productsComplete: true,
  categories: [
    {
      id: CAT,
      name: "Base oil",
      slug: "base-oil",
      parentId: null,
      path: "/products?category=base-oil",
      liveProducts: 3,
    },
  ],
};

const fixed = (t: MenuTarget) => (t.type === "path" ? t.path : t.type === "url" ? t.url : null);

describe("menu content version 1 (DP-134) is read as version 2", () => {
  it("keeps every label, address and order; visible, same tab, no submenu", () => {
    const nav = BvNavMenuSchema.parse(NAV_V1);
    expect(nav.items.map((i) => [i.label, fixed(i.target)])).toEqual(
      NAV_V1.items.map((i) => [i.label, i.href]),
    );
    expect(nav.items.every((i) => i.visible && !i.newTab && i.children.length === 0)).toBe(true);
    expect(nav.contact.target).toEqual({ type: "path", path: "/contact" });

    const footer = BvFooterMenuSchema.parse(FOOTER_V1);
    expect(footer.columns.flatMap((c) => c.links.map((l) => fixed(l.target)))).toEqual(
      FOOTER_V1.columns.flatMap((c) => c.links.map((l) => l.href)),
    );
    expect(footer.legal[1]?.target).toEqual({ type: "none" });
    expect(footer.social).toEqual([]);
    expect(footer.contact.phone.visible).toBe(true);
    expect(footer.columns.every((c) => c.visible)).toBe(true);
  });

  it("renders exactly the addresses version 1 rendered", () => {
    const resolve = (t: MenuTarget) => fixed(t);
    const nav = menuPublicNav(BvNavMenuSchema.parse(NAV_V1), resolve);
    expect(nav.items.map((i) => ({ label: i.label, href: i.href }))).toEqual(NAV_V1.items);
    expect(nav.contact).toEqual({ ...NAV_V1.contact, newTab: false });
    expect(nav.noScriptLinks.map((l) => l.href)).toEqual(NAV_V1.noScriptLinks.map((l) => l.href));
    const footer = menuPublicFooter(BvFooterMenuSchema.parse(FOOTER_V1), resolve);
    expect(footer.cta).toEqual({ ...FOOTER_V1.cta, newTab: false });
    expect(footer.columns).toEqual(
      FOOTER_V1.columns.map((c) => ({
        title: c.title,
        links: c.links.map((l) => ({ ...l, newTab: false })),
      })),
    );
    expect(footer.legal.map((l) => l.href)).toEqual(["/privacy", null]);
    expect(BvNavPublicSchema.safeParse(nav).success).toBe(true);
    expect(BvFooterPublicSchema.safeParse(footer).success).toBe(true);
  });

  it("maps an href of version 1 to its target", () => {
    expect(menuTargetOfHref(null)).toEqual({ type: "none" });
    expect(menuTargetOfHref("")).toEqual({ type: "none" });
    expect(menuTargetOfHref("#top")).toEqual({ type: "path", path: "#top" });
    expect(menuTargetOfHref("tel:+3120")).toEqual({ type: "url", url: "tel:+3120" });
  });

  it("leaves version 2 content as it is (idempotent)", () => {
    const once = BvNavMenuSchema.parse(NAV_V1);
    expect(BvNavMenuSchema.parse(once)).toEqual(once);
    const f = BvFooterMenuSchema.parse(FOOTER_V1);
    expect(BvFooterMenuSchema.parse(f)).toEqual(f);
  });
});

describe("menu content version 2", () => {
  const nav = () => structuredClone(BvNavMenuSchema.parse(NAV_V1));

  it("accepts references, submenus, new tab and hidden links", () => {
    const n = nav();
    n.items[1]!.children = [
      {
        label: "Base oil",
        target: { type: "category", categoryId: CAT },
        newTab: false,
        visible: true,
      },
      {
        label: "ICCSYN",
        target: { type: "product", productId: PRODUCT },
        newTab: true,
        visible: true,
      },
    ];
    n.items[3]!.target = { type: "page", pageId: PAGE.toUpperCase() };
    const parsed = BvNavMenuSchema.parse(n);
    // Ids are stored lower case.
    expect(parsed.items[3]!.target).toEqual({ type: "page", pageId: PAGE });
    expect(menuReferences(navLinks(parsed))).toEqual({
      pageIds: [PAGE],
      productIds: [PRODUCT],
      categoryIds: [CAT],
    });
  });

  it("refuses unsafe addresses, unknown kinds, a second submenu level and broken limits", () => {
    const bad = (mutate: (n: ReturnType<typeof nav>) => void) => {
      const n = nav() as unknown as ReturnType<typeof nav>;
      mutate(n);
      return BvNavMenuSchema.safeParse(n).success;
    };
    for (const url of [
      "javascript:alert(1)",
      "http://x.example",
      "//x.example",
      "data:text/html,x",
      "/x",
    ]) {
      expect(
        bad((n) => (n.items[0]!.target = { type: "url", url })),
        url,
      ).toBe(false);
    }
    for (const path of ["https://x.example", "javascript:x", "//x", "x"]) {
      expect(
        bad((n) => (n.items[0]!.target = { type: "path", path })),
        path,
      ).toBe(false);
    }
    expect(bad((n) => (n.items[0]!.target = { type: "page", pageId: "x" } as never))).toBe(false);
    expect(bad((n) => (n.items[0]!.target = { type: "file", id: "x" } as never))).toBe(false);
    expect(bad((n) => (n.items[0]!.label = " "))).toBe(false);
    expect(bad((n) => (n.items[0]!.label = "x".repeat(MENU_LIMITS.label + 1)))).toBe(false);
    expect(
      bad((n) => {
        n.items[0]!.children = [{ ...n.items[1]!, children: [] } as never];
      }),
    ).toBe(false);
    expect(
      bad((n) => {
        n.items[0]!.children = Array.from({ length: MENU_LIMITS.navChildren + 1 }, () => ({
          label: "x",
          target: { type: "none" } as const,
          newTab: false,
          visible: true,
        }));
      }),
    ).toBe(false);
    expect(bad((n) => (n.items = []))).toBe(false);
    expect(
      bad((n) => (n.items = Array.from({ length: MENU_LIMITS.navItems + 1 }, () => n.items[0]!))),
    ).toBe(false);
    expect(bad((n) => ((n as unknown as Record<string, unknown>)["extra"] = 1))).toBe(false);
  });

  it("footer: the button needs a destination; social links are https; contact links tel/mailto", () => {
    const f = () => structuredClone(BvFooterMenuSchema.parse(FOOTER_V1));
    const ok = (x: unknown) => BvFooterMenuSchema.safeParse(x).success;
    expect(ok({ ...f(), cta: { ...f().cta, target: { type: "none" } } })).toBe(false);
    expect(
      ok({ ...f(), social: [{ network: "x", label: "X", url: "http://x.com/a", visible: true }] }),
    ).toBe(false);
    expect(
      ok({ ...f(), social: [{ network: "x", label: "X", url: "https://x.com/a", visible: true }] }),
    ).toBe(true);
    const c = f();
    c.contact.phone.href = "https://x.example";
    expect(ok(c)).toBe(false);
    expect(ok({ ...f(), columns: [] })).toBe(false);
    expect(
      ok({
        ...f(),
        columns: Array.from({ length: MENU_LIMITS.footerColumns + 1 }, () => f().columns[0]),
      }),
    ).toBe(false);
  });
});

describe("public shape", () => {
  it("drops hidden links and columns, resolves targets and keeps the order", () => {
    const n = BvNavMenuSchema.parse(NAV_V1);
    n.items[0]!.visible = false;
    n.items[1]!.children = [
      { label: "A", target: { type: "page", pageId: PAGE }, newTab: true, visible: true },
      { label: "B", target: { type: "page", pageId: PAGE_OFF }, newTab: true, visible: true },
      { label: "C", target: { type: "path", path: "/c" }, newTab: false, visible: false },
    ];
    n.contact.visible = false;
    const resolve = (t: MenuTarget) => menuTargetCheck(t, TARGETS).href;
    const pub = menuPublicNav(n, resolve);
    expect(pub.items.map((i) => i.label)).toEqual([
      "Products",
      "Services",
      "Company",
      "Blogs",
      "Contact Us",
    ]);
    expect(pub.items[0]!.children).toEqual([
      { label: "A", href: "/about-us", newTab: true },
      // Not live: text, and never "new tab" for a text.
      { label: "B", href: null, newTab: false },
    ]);
    expect(pub.contact).toBeNull();

    const f = BvFooterMenuSchema.parse(FOOTER_V1);
    f.columns[0]!.visible = false;
    f.columns[1]!.links.forEach((l) => (l.visible = false));
    f.social = [
      { network: "linkedin", label: "LinkedIn", url: "https://linkedin.com/x", visible: true },
      { network: "x", label: "X", url: "https://x.com/x", visible: false },
    ];
    f.contact.email.visible = false;
    const pf = menuPublicFooter(f, resolve);
    // A column whose links are all hidden is left out.
    expect(pf.columns).toEqual([]);
    expect(pf.social).toEqual([
      { network: "linkedin", label: "LinkedIn", href: "https://linkedin.com/x" },
    ]);
    // Contact details always travel (the contact page uses them); the flag is the footer's.
    expect(pf.contact.email).toMatchObject({
      visible: false,
      href: "mailto:info@dreampetroleumbv.com",
    });
  });

  it("never leaks a reference", () => {
    const n = BvNavMenuSchema.parse(NAV_V1);
    n.items[0]!.target = { type: "product", productId: PRODUCT };
    const text = JSON.stringify(menuPublicNav(n, (t) => menuTargetCheck(t, TARGETS).href));
    expect(text).not.toMatch(/productId|pageId|categoryId|target|visible/);
  });
});

describe("admin checks and the reference conversion", () => {
  it("names what is wrong with a target", () => {
    const check = (t: MenuTarget) => menuTargetCheck(t, TARGETS).problem;
    expect(check({ type: "page", pageId: PAGE })).toBeNull();
    expect(check({ type: "page", pageId: PAGE_OFF })).toBe("page_unpublished");
    expect(check({ type: "page", pageId: CAT })).toBe("page_missing");
    expect(check({ type: "product", productId: PAGE })).toBe("product_missing");
    expect(check({ type: "category", categoryId: CAT })).toBeNull();
    expect(
      menuTargetCheck(
        { type: "category", categoryId: CAT },
        { ...TARGETS, categories: [{ ...TARGETS.categories[0]!, liveProducts: 0 }] },
      ).problem,
    ).toBe("category_empty");
  });

  it("turns live page, category and product paths into references, keeping every address", () => {
    const footer = BvFooterMenuSchema.parse(FOOTER_V1);
    const plan = menuReferencePlan(BV_FOOTER_KEY, footer, TARGETS);
    expect(plan.changes.map((c) => [c.from, c.to.type])).toEqual([
      ["/products?category=base-oil", "category"],
      ["/about-us", "page"],
    ]);
    // Unknown category slug, a site route, an anchor link to a product section and the privacy
    // route stay fixed paths; the input is not changed.
    expect(footer.columns[0]!.links[0]!.target.type).toBe("path");
    const resolve = (t: MenuTarget) => menuTargetCheck(t, TARGETS).href ?? fixed(t);
    expect(footerLinks(plan.content).map((l) => resolve(l.link.target))).toEqual(
      footerLinks(footer).map((l) => resolve(l.link.target)),
    );
    // Idempotent.
    expect(menuReferencePlan(BV_FOOTER_KEY, plan.content, TARGETS).changes).toEqual([]);

    const nav = BvNavMenuSchema.parse({
      ...NAV_V1,
      items: [...NAV_V1.items, { label: "ICCSYN", href: "/products/iccsyn-10-ctl-technology" }],
    });
    const navPlan = menuReferencePlan(BV_NAV_KEY, nav, TARGETS);
    expect(navPlan.changes.map((c) => [c.place, c.to])).toEqual([
      ["Header › Company", { type: "page", pageId: PAGE }],
      ["Header › ICCSYN", { type: "product", productId: PRODUCT }],
    ]);
  });

  it("registers both menus with their own schema", () => {
    for (const key of [BV_NAV_KEY, BV_FOOTER_KEY]) {
      expect(cmsIsMenu(key)).toBe(true);
      const t = CMS_DESIGN_TEMPLATES.find((x) => x.key === key);
      expect(t?.kind).toBe("FRAGMENT");
      expect(t?.schema).toBeDefined();
      expect(t?.fields).toEqual([]);
    }
    expect(cmsIsMenu("bv.home")).toBe(false);
  });
});
