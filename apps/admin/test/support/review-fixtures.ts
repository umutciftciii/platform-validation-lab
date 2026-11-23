// ML-12b (DP-243): Company Review response fixtures shared by the EN regression and the EN/TR
// render tests. Real response shapes (parsed by the contract schemas in the mocked serverRead);
// every review item kind, every source level, held values with and without a conflict, all three
// proposal states and every decision-block reason.
export const C = "/api/v1/admin/catalog";
export const BV = "0190f2a1-0000-7000-8000-0000000000b1";
export const P1 = "0190f2a1-0000-7000-8000-000000000311"; // text, every kind, pending
export const P2 = "0190f2a1-0000-7000-8000-000000000312"; // placeholder, approved
export const P3 = "0190f2a1-0000-7000-8000-000000000313"; // changes requested, history with texts
export const PR1 = "0190f2a1-0000-7000-8000-000000000411";
export const PR2 = "0190f2a1-0000-7000-8000-000000000412";
export const PR3 = "0190f2a1-0000-7000-8000-000000000413";
export const CAT = "0190f2a1-0000-7000-8000-000000000511";
export const DEF = "0190f2a1-0000-7000-8000-000000000611";
export const DEF2 = "0190f2a1-0000-7000-8000-000000000612";
export const AUTHOR = {
  id: "0190f2a1-0000-7000-8000-000000000211",
  name: "Research editor (fixture)",
};
export const REVIEWER = {
  id: "0190f2a1-0000-7000-8000-000000000212",
  name: "Company reviewer (fixture)",
};
export const AT = "2026-11-15T12:00:00.000Z";
export const LATER = "2026-11-18T09:30:00.000Z";
const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);

export const counts = (over: Record<string, number> = {}) => ({
  CONFIRM: 0,
  INCONSISTENCY: 0,
  DP002_HELD: 0,
  SITE_VALUE_WITHHELD: 0,
  CLASS_CONFLICT: 0,
  CLAIM_RISK: 0,
  MISSING_DOCUMENT: 0,
  PLACEHOLDER: 0,
  ...over,
});

const item = (
  kind: string,
  field: string | null,
  text: string,
  sourceIds: string[] = [],
  heldValue: Record<string, unknown> | null = null,
) => ({ kind, field, text, sourceIds, heldValue });

/** Every kind once (held values twice: with and without a conflict). */
export const fullReviewData = {
  schemaVersion: 1,
  language: "en",
  family: "Group II base oil",
  items: [
    item("PLACEHOLDER", "name", "The product name covers several grades.", ["S-A"]),
    item("CLASS_CONFLICT", "category", "VI 124 is in the Group III range under API 1509.", [
      "S-A",
      "S-B",
    ]),
    item("INCONSISTENCY", "spec:viscosity_index", "Two VI values on one page.", ["S-D"]),
    item("CLAIM_RISK", "description", "'Pharmaceutical grade' needs a certificate.", ["S-E"]),
    item("CONFIRM", "summary", "Is the grade sold in drums?"),
    item("CONFIRM", null, "Which refinery supplies it?", ["S-C"]),
    item("MISSING_DOCUMENT", "documents", "SDS (REACH/CLP)"),
    item("DP002_HELD", "spec:pour_point", "DP-002: held value.", [], {
      definition: "pour_point",
      basis: "SPECIFICATION",
      raw: "Pour Point, max: Minus 15 °C [GOST 20287]",
      conflict: true,
      finding: "Two rows in one document.",
    }),
    item("SITE_VALUE_WITHHELD", "spec:flash_point", "Not imported: no test method.", [], {
      definition: "flash_point",
      basis: "TYPICAL",
      raw: "Flash point: 220 °C",
      conflict: false,
      finding: null,
    }),
  ],
  sources: [
    {
      id: "S-A",
      title: "Manufacturer TDS",
      url: "https://example.test/a.pdf",
      level: "A",
      documentDate: "2024",
    },
    { id: "S-B", title: "API 1509 Annex E", url: null, level: "B", documentDate: null },
    { id: "S-C", title: "Other producer sheet", url: null, level: "C", documentDate: null },
    { id: "S-D", title: "Dream site summary", url: null, level: "D", documentDate: null },
    { id: "S-E", title: "Marketplace listing", url: null, level: "E", documentDate: null },
    { id: "S-F", title: "Unrated note", url: null, level: null, documentDate: null },
  ],
};

const event = (
  n: number,
  action: string,
  version: number,
  actor: { id: string; name: string },
  over: Record<string, unknown> = {},
) => ({
  id: `0190f2a1-0000-7000-8000-00000000070${n}`,
  action,
  proposalVersion: version,
  actor,
  comment: null,
  contentSha256: SHA,
  textRecorded: true,
  summary: "Group II base oil for blending.",
  description: "A base oil.",
  createdAt: AT,
  ...over,
});

export type Decision = {
  canDecide: boolean;
  canRevise: boolean;
  decisionBlocked: "no_permission" | "not_in_review" | "own_change" | null;
};

export const proposal = (
  id: string,
  productId: string,
  over: Record<string, unknown> = {},
  decision: Partial<Decision> = {},
  events: unknown[] = [
    event(1, "CREATED", 1, AUTHOR, { textRecorded: false, summary: null, description: null }),
  ],
) => ({
  proposal: {
    id,
    siteId: BV,
    productId,
    productCode: "G2-HVI-6",
    productName: "Group II Base Oil HVI 6",
    locale: "en",
    summary: "Group II base oil in the HVI 6 grade, for lubricant blending.",
    description: "Group II Base Oil HVI 6 is a base oil offered as a blending component.",
    reviewData: fullReviewData,
    sourceRef: "docs/catalog/proposals/bv-content-proposals.json",
    sourceSha256: SHA,
    status: "REVIEW_PENDING",
    version: 1,
    authors: [AUTHOR],
    decidedAt: null,
    decidedBy: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  },
  events,
  canRevise: false,
  canDecide: true,
  decisionBlocked: null,
  ...decision,
});

/** A history with every action, an unchanged text and an unrecorded one. */
export const fullHistory = [
  event(1, "CREATED", 1, AUTHOR, { textRecorded: false, summary: null, description: null }),
  event(2, "CHANGES_REQUESTED", 1, REVIEWER, {
    comment: "Please remove the pharmaceutical claim.",
    textRecorded: false,
    summary: null,
    description: null,
  }),
  event(3, "REVISED", 2, AUTHOR, { contentSha256: SHA2, summary: null }),
  event(4, "APPROVED", 2, REVIEWER, { contentSha256: SHA2, summary: null, createdAt: LATER }),
  event(5, "REVISED", 3, AUTHOR, { createdAt: LATER }),
  event(6, "CHANGES_REQUESTED", 3, REVIEWER, { comment: "Shorter, please.", createdAt: LATER }),
];

export const product = (id: string, code: string, text = true) => ({
  product: {
    id,
    code,
    slug: code.toLowerCase(),
    name: `Product ${code}`,
    summary: text ? "Master summary." : null,
    description: null,
    status: "DRAFT",
    version: 3,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
  },
  listing: {
    id: "0190f2a1-0000-7000-8000-000000000811",
    siteId: BV,
    categoryId: CAT,
    visibility: "HIDDEN",
    sortOrder: 10,
    version: 1,
    text: { title: `Product ${code}`, summary: text ? "Site summary." : null, description: null },
    updatedAt: AT,
  },
});

const definition = (id: string, key: string, name: string, dataType: string) => ({
  id,
  key,
  name,
  dataType,
  units: [],
  testMethods: [],
  required: false,
  minValue: null,
  maxValue: null,
  decimals: null,
  maxLength: null,
  sortOrder: 10,
  archived: false,
  version: 1,
  valueCount: 1,
  updatedAt: AT,
});

export const specs = (empty = false) => ({
  productVersion: 3,
  definitions: [
    definition(DEF, "kv100", "Kinematic viscosity at 100 °C", "RANGE"),
    definition(DEF2, "pao", "Contains PAO", "BOOLEAN"),
  ],
  values: empty
    ? []
    : [
        {
          definitionId: DEF,
          basis: "SPECIFICATION",
          value: { type: "RANGE", min: 5.5, max: 7.25, minExclusive: false, maxExclusive: true },
          unit: "mm²/s",
          testMethod: "ASTM D445",
          updatedAt: AT,
        },
        {
          definitionId: DEF,
          basis: "TYPICAL",
          value: { type: "NUMBER", number: 1234.5 },
          unit: "mm²/s",
          testMethod: null,
          updatedAt: AT,
        },
        {
          definitionId: DEF2,
          basis: "TYPICAL",
          value: { type: "BOOLEAN", boolean: false },
          unit: null,
          testMethod: null,
          updatedAt: AT,
        },
      ],
  validation: { ok: true, blocking: [], warnings: [] },
});

const doc = (n: number, type: string, title: string) => ({
  id: `0190f2a1-0000-7000-8000-00000000091${n}`,
  productId: PR1,
  type,
  title,
  description: null,
  language: "en",
  accessPolicy: "PUBLIC",
  status: "ACTIVE",
  version: 1,
  revisionCount: 0,
  activeRevision: null,
  revisions: [],
  sites: [],
  archivedAt: null,
  createdAt: AT,
  updatedAt: AT,
});

export const documents = (withFiles: boolean) => ({
  items: withFiles
    ? [doc(1, "TDS", "HVI 6 technical data sheet"), doc(2, "OTHER", "Site summary sheet")]
    : [],
  canEdit: false,
});

export const context = (over: Record<string, unknown> = {}, sites?: unknown[]) => ({
  sites: sites ?? [
    {
      id: BV,
      key: "BV",
      name: "Dream Petroleum BV",
      canRead: true,
      canReview: true,
      canRevise: false,
      ...over,
    },
  ],
  reviewOnly: false,
});

export const categories = {
  items: [
    {
      id: CAT,
      siteId: BV,
      parentId: null,
      name: "Base Oil",
      slug: "base-oil",
      description: null,
      sortOrder: 0,
      isDefault: false,
      version: 1,
      listingCount: 1,
      childCount: 0,
      updatedAt: AT,
    },
  ],
};

/** A failed read (HTTP 500) in the mocked serverRead. */
export const FAIL = Symbol("fail");

/** The list, the three proposals and their products, as the API answers them. */
export const productQuery = (category?: string) =>
  `${C}/products?siteId=${BV}&sort=name&order=asc&page=1&pageSize=100${category ? `&categoryId=${category}` : ""}`;

const listItem = (id: string, productId: string, code: string, status: string, over = {}) => ({
  id,
  siteId: BV,
  productId,
  productCode: code,
  productName: `Product ${code}`,
  locale: "en",
  status,
  version: 1,
  hasText: true,
  itemCounts: counts(),
  updatedAt: AT,
  ...over,
});

export function seedReviewReads(reads: Map<string, unknown>): void {
  reads.clear();
  reads.set(`${C}/proposals/context`, context());
  const list = {
    proposals: [
      listItem(P1, PR1, "G2-HVI-6", "REVIEW_PENDING", {
        itemCounts: counts({ CLASS_CONFLICT: 1, INCONSISTENCY: 1, DP002_HELD: 1 }),
      }),
      listItem(P2, PR2, "SAF", "APPROVED", {
        hasText: false,
        itemCounts: counts({ PLACEHOLDER: 1, SITE_VALUE_WITHHELD: 2 }),
      }),
      listItem(P3, PR3, "LUB-1", "CHANGES_REQUESTED"),
    ],
    counts: { REVIEW_PENDING: 1, CHANGES_REQUESTED: 1, APPROVED: 1 },
  };
  reads.set(`${C}/proposals?siteId=${BV}`, list);
  reads.set(`${C}/proposals?siteId=${BV}&status=APPROVED`, {
    proposals: [list.proposals[1]],
    counts: list.counts,
  });
  reads.set(`${C}/sites/${BV}/categories`, categories);
  const page = {
    items: [PR1, PR2, PR3].map((id, i) => ({
      id,
      code: ["G2-HVI-6", "SAF", "LUB-1"][i],
      slug: `p-${i}`,
      name: `Product ${i}`,
      status: "DRAFT",
      version: 3,
      updatedAt: AT,
      listing:
        i === 2
          ? null
          : {
              id: "0190f2a1-0000-7000-8000-000000000811",
              visibility: "HIDDEN",
              categoryId: CAT,
              categoryName: "Base Oil",
              updatedAt: AT,
            },
      publication: null,
    })),
    page: 1,
    pageSize: 100,
    total: 3,
  };
  reads.set(productQuery(), page);
  reads.set(productQuery(CAT), { ...page, items: [page.items[0]], total: 1 });
  reads.set(`${C}/proposals/${P1}`, proposal(P1, PR1));
  reads.set(
    `${C}/proposals/${P2}`,
    proposal(
      P2,
      PR2,
      {
        productCode: "SAF",
        summary: null,
        description: null,
        status: "APPROVED",
        version: 2,
        decidedAt: LATER,
        decidedBy: REVIEWER,
        reviewData: { ...fullReviewData, family: null, items: [fullReviewData.items[0]] },
      },
      { canDecide: false, decisionBlocked: "not_in_review" },
      [],
    ),
  );
  reads.set(
    `${C}/proposals/${P3}`,
    proposal(
      P3,
      PR3,
      { status: "CHANGES_REQUESTED", version: 3, decidedAt: LATER, decidedBy: REVIEWER },
      {},
      fullHistory,
    ),
  );
  for (const id of [PR1, PR2, PR3]) {
    reads.set(
      `${C}/products/${id}?siteId=${BV}`,
      product(id, id === PR2 ? "SAF" : "G2-HVI-6", id !== PR2),
    );
    reads.set(`${C}/products/${id}/images`, { items: [] });
    reads.set(`${C}/products/${id}/documents`, documents(id === PR1));
    reads.set(`${C}/products/${id}/specs`, specs(id === PR2));
  }
}
