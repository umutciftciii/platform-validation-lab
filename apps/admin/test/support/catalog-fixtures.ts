// ML-12a (DP-243): shared fixtures of the catalogue screen tests (catalog-pages-render.test.tsx in
// English, catalog-i18n.test.tsx in Turkish): real response shapes behind a mocked serverRead.
export const reads = new Map<string, unknown>();

export const C = "/api/v1/admin/catalog";
export const BV = "22222222-2222-4222-8222-222222222222";
export const CORP = "33333333-3333-4333-8333-333333333333";
export const CAT = "44444444-4444-4444-8444-444444444444";
export const CAT2 = "44444444-4444-4444-8444-444444444445";
export const DEF = "55555555-5555-4555-8555-555555555555";
export const DEF2 = "55555555-5555-4555-8555-555555555556";
export const BRAND = "77777777-7777-4777-8777-777777777777";
export const BRAND2 = "77777777-7777-4777-8777-777777777778";
export const P1 = "0190a8c4-7c1e-7000-8000-000000000001";
export const P2 = "0190a8c4-7c1e-7000-8000-000000000002";
export const U = "88888888-8888-4888-8888-888888888888";
export const T = "2026-11-17T10:00:00.000Z";

export type Page = (props: never) => Promise<unknown>;
export const props = (q: Record<string, string> = {}) =>
  ({ searchParams: Promise.resolve(q), params: Promise.resolve({}) }) as never;

export function catalogFixtures(opts: { canEdit: boolean; canApprove?: boolean }) {
  reads.clear();
  reads.set(`${C}/context`, {
    sites: [
      { id: BV, key: "BV", name: "Dream Petroleum BV", canEdit: opts.canEdit, canPublish: true },
      { id: CORP, key: "CORPORATE", name: "Corporate", canEdit: false, canPublish: false },
    ],
    canEditMaster: opts.canEdit,
    canApprove: opts.canApprove ?? false,
  });
  const category = (id: string, name: string, parentId: string | null, extra = {}) => ({
    id,
    siteId: BV,
    parentId,
    name,
    slug: name.toLowerCase().replaceAll(" ", "-"),
    description: null,
    sortOrder: 0,
    isDefault: parentId === null,
    version: 1,
    listingCount: parentId ? 0 : 3,
    childCount: parentId ? 0 : 1,
    updatedAt: T,
    ...extra,
  });
  reads.set(`${C}/sites/${BV}/categories`, {
    items: [category(CAT, "Engine oils", null), category(CAT2, "Gear oils", CAT)],
  });
  const locales = [
    { locale: "en", enabled: true, public: true, isDefault: true, sortOrder: 0 },
    { locale: "nl", enabled: true, public: false, isDefault: false, sortOrder: 1 },
  ];
  const catText = (locale: string) => ({
    siteId: BV,
    locale,
    defaultLocale: "en",
    locales,
    enabled: true,
    canEdit: opts.canEdit,
    items: [
      {
        id: CAT,
        slug: "engine-oils",
        parentId: null,
        version: 1,
        liveProducts: 2,
        state: locale === "en" ? null : "OUTDATED",
        name: { value: locale === "en" ? null : "Motoroliën", source: "Engine oils" },
        description: { value: null, source: null },
      },
      {
        id: CAT2,
        slug: "gear-oils",
        parentId: CAT,
        version: 1,
        liveProducts: 0,
        state: locale === "en" ? null : "MISSING",
        name: { value: null, source: "Gear oils" },
        description: { value: null, source: "Oils for gearboxes." },
      },
    ],
  });
  reads.set(`${C}/sites/${BV}/categories/translations?locale=en`, catText("en"));
  reads.set(`${C}/sites/${BV}/categories/translations?locale=nl`, catText("nl"));
  const def = (id: string, key: string, name: string, extra = {}) => ({
    id,
    key,
    name,
    dataType: "NUMBER",
    units: ["mm²/s"],
    testMethods: ["ASTM D445"],
    required: true,
    minValue: 0,
    maxValue: 1000,
    decimals: 2,
    maxLength: null,
    sortOrder: 0,
    archived: false,
    version: 1,
    valueCount: 4,
    updatedAt: T,
    ...extra,
  });
  reads.set(`${C}/spec-definitions`, {
    items: [
      def(DEF, "kv100", "Kinematic viscosity at 100 °C"),
      def(DEF2, "appearance", "Appearance", {
        dataType: "TEXT",
        units: [],
        testMethods: [],
        required: false,
        minValue: null,
        maxValue: null,
        decimals: null,
        maxLength: 120,
        archived: true,
        valueCount: 0,
      }),
    ],
  });
  const specText = (locale: string) => ({
    locale,
    sourceLocale: "en",
    locales: ["en", "nl"],
    enabled: true,
    canEdit: opts.canEdit,
    items: [
      {
        id: DEF,
        key: "kv100",
        archived: false,
        version: 1,
        liveProducts: 3,
        state: locale === "en" ? null : "PUBLISHED",
        name: {
          value: locale === "en" ? null : "Kinematische viscositeit",
          source: "Kinematic viscosity at 100 °C",
        },
      },
      {
        id: DEF2,
        key: "appearance",
        archived: true,
        version: 1,
        liveProducts: 0,
        state: locale === "en" ? null : "DRAFT",
        name: { value: locale === "en" ? null : "Uiterlijk", source: "Appearance" },
      },
    ],
  });
  reads.set(`${C}/spec-definitions/translations?locale=en`, specText("en"));
  reads.set(`${C}/spec-definitions/translations?locale=nl`, specText("nl"));
  const brand = (id: string, name: string, extra = {}) => ({
    id,
    name,
    manufacturer: `${name} Lubricants`,
    country: "NL",
    notes: null,
    status: "ACTIVE",
    version: 1,
    productCount: 2,
    archivedAt: null,
    createdAt: T,
    updatedAt: T,
    ...extra,
  });
  reads.set(`${C}/global-brands?archived=1`, {
    items: [
      brand(BRAND, "Acme"),
      brand(BRAND2, "Oldco", { status: "ARCHIVED", archivedAt: T, productCount: 0 }),
    ],
    canEdit: opts.canEdit,
  });
  reads.set(`${C}/review-queue`, {
    items: [
      {
        productId: P1,
        code: "ICC-SYN-6",
        name: "ICCSYN 6 Synthetic",
        version: 3,
        submittedAt: T,
        submittedBy: { id: U, name: "Fixture editor" },
        comment: "Ready for review.",
        blockingCount: 0,
        warningCount: 2,
        canReview: true,
        reviewBlockedReason: null,
      },
      {
        productId: P2,
        code: "GEAR-80",
        name: "Gear 80W-90",
        version: 1,
        submittedAt: T,
        submittedBy: null,
        comment: null,
        blockingCount: 1,
        warningCount: 0,
        canReview: false,
        reviewBlockedReason: "own_change",
      },
    ],
    total: 2,
    canApprove: opts.canApprove ?? false,
  });
}
