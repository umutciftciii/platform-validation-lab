// ML-13b (DP-244): a translation package (ML-13a format, real SHA-256 hashes) and its dry-run
// report with one unit of every status, for the admin tests.
import { createHash } from "node:crypto";
import type {
  TranslationImportReport,
  TranslationPackage,
  TranslationUnit,
  TranslationUnitStatus,
} from "@dream/contracts";

export const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export const BV_ID = "11111111-1111-4111-8111-111111111111";
export const CORP_ID = "22222222-2222-4222-8222-222222222222";
export const GROUP = "33333333-3333-4333-8333-333333333333";
export const PAGE = "44444444-4444-4444-8444-444444444444";
export const LISTING = "55555555-5555-4555-8555-555555555555";
export const LISTING_GONE = "66666666-6666-4666-8666-666666666666";
export const CATEGORY = "77777777-7777-4777-8777-777777777777";
export const SPEC = "88888888-8888-4888-8888-888888888888";
export const IMAGE = "99999999-9999-4999-8999-999999999999";

export function unit(
  key: string,
  source: string,
  target: string | null,
  current: string | null = null,
  context = "Context",
): TranslationUnit {
  const kind = key.split(":")[0] as TranslationUnit["kind"];
  return {
    key,
    kind,
    context,
    maxLength: 200,
    multiline: false,
    source,
    sourceHash: sha(source),
    current,
    currentHash: current === null ? null : sha(current),
    target,
  };
}

/** One unit per status, in report order. */
export const ROWS: readonly {
  unit: TranslationUnit;
  status: TranslationUnitStatus;
  rule: string | null;
}[] = [
  {
    unit: unit(`cms:${GROUP}:title`, "About us", "Over ons", null, "/about-us · About us"),
    status: "create",
    rule: null,
  },
  {
    unit: unit(
      `cms:${GROUP}:content.sections.@hero.heading`,
      "Energy in motion",
      "Energie in beweging",
      "Energie",
      "/about-us · Hero",
    ),
    status: "update",
    rule: null,
  },
  {
    unit: unit(
      `listing:${LISTING}:title`,
      "Engine oil 5W-30",
      "Motorolie 5W-30",
      "Motorolie 5W-30",
      "Engine oil 5W-30",
    ),
    status: "unchanged",
    rule: null,
  },
  {
    unit: unit(`listing:${LISTING}:summary`, "For petrol engines", null, null, "Engine oil 5W-30"),
    status: "empty",
    rule: null,
  },
  {
    unit: unit(
      `category:${CATEGORY}:name`,
      "Lubricants",
      "Smeermiddelen",
      null,
      "Category Lubricants",
    ),
    status: "outdated",
    rule: "source_changed",
  },
  {
    unit: unit(
      `spec:${SPEC}:name`,
      "Viscosity",
      "Viscositeit",
      "Viscositeit (oud)",
      "Specification Viscosity",
    ),
    status: "conflict",
    rule: "target_changed",
  },
  {
    unit: unit(
      `image:${IMAGE}:alt`,
      "Bottle",
      "Fles ".repeat(60),
      null,
      "Image of Engine oil 5W-30",
    ),
    status: "invalid",
    rule: "too_long",
  },
  {
    unit: unit(`listing:${LISTING_GONE}:description`, "Gone product", "Weg", null, "Gone product"),
    status: "not_found",
    rule: null,
  },
];

export function pkg(overrides: Partial<TranslationPackage> = {}): TranslationPackage {
  return {
    format: "dream-translation-package",
    version: 1,
    site: { id: BV_ID, key: "BV" },
    sourceLocale: "en",
    targetLocale: "nl",
    exportedAt: "2026-11-25T10:15:00.000Z",
    types: ["cms", "catalog"],
    pages: [
      {
        groupId: GROUP,
        sourcePageId: PAGE,
        sourceRevisionNumber: 3,
        kind: "DESIGN",
        templateKey: "about",
        path: "/about-us",
        targetPageId: null,
      },
    ],
    units: ROWS.map((r) => r.unit),
    ...overrides,
  };
}

export function report(overrides: Partial<TranslationImportReport> = {}): TranslationImportReport {
  const counts = {
    create: 0,
    update: 0,
    unchanged: 0,
    empty: 0,
    outdated: 0,
    conflict: 0,
    invalid: 0,
    not_found: 0,
  } as Record<TranslationUnitStatus, number>;
  for (const r of ROWS) counts[r.status] += 1;
  return {
    dryRun: true,
    digest: "a".repeat(64),
    siteId: BV_ID,
    sourceLocale: "en",
    targetLocale: "nl",
    canImport: true,
    missingPermissions: [],
    counts,
    pages: [{ groupId: GROUP, targetPageId: null, action: "create", rule: null }],
    units: ROWS.map((r) => ({ key: r.unit.key, status: r.status, rule: r.rule })),
    written: {
      cmsPagesCreated: 0,
      cmsPagesUpdated: 0,
      listings: 0,
      categories: 0,
      specs: 0,
      images: 0,
    },
    ...overrides,
  };
}

export const BV_LOCALES = [
  { locale: "en", enabled: true, public: true, isDefault: true, sortOrder: 0 },
  { locale: "nl", enabled: true, public: false, isDefault: false, sortOrder: 1 },
  { locale: "de", enabled: false, public: false, isDefault: false, sortOrder: 2 },
];
