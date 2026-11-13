/**
 * SAMPLE DATA for the DP-U dashboard prototype.
 *
 * Nothing here comes from the API or the database, and none of it describes real people, real
 * enquiries or real figures. Every dataset carries `demo: true`, and every component that shows it
 * renders the sample-data marker. Replace each dataset with an API call when its module exists;
 * do not mix sample and real values in one widget.
 */

export interface DemoDataset<T> {
  readonly demo: true;
  readonly items: readonly T[];
}

function demo<T>(items: readonly T[]): DemoDataset<T> {
  return { demo: true, items };
}

export type KpiTone = "neutral" | "attention";

export interface Kpi {
  id: string;
  label: string;
  value: number;
  /** Change against the previous 30 days, in percent. */
  deltaPercent: number;
  /** Whether a rising value is good news (drives the delta colour). */
  higherIsBetter: boolean;
  tone: KpiTone;
  hint: string;
  /** Last 12 weekly values, oldest first. */
  trend: readonly number[];
}

export const DEMO_KPIS = demo<Kpi>([
  {
    id: "pages",
    label: "Published pages",
    value: 48,
    deltaPercent: 4.2,
    higherIsBetter: true,
    tone: "neutral",
    hint: "Across both sites",
    trend: [38, 39, 39, 41, 41, 42, 43, 44, 44, 46, 46, 48],
  },
  {
    id: "products",
    label: "Product data sheets",
    value: 126,
    deltaPercent: 1.6,
    higherIsBetter: true,
    tone: "neutral",
    hint: "Current versions",
    trend: [118, 118, 119, 120, 120, 121, 122, 122, 123, 124, 124, 126],
  },
  {
    id: "enquiries",
    label: "Open enquiries",
    value: 17,
    deltaPercent: -8,
    higherIsBetter: false,
    tone: "neutral",
    hint: "Waiting for a reply",
    trend: [24, 22, 25, 21, 20, 22, 19, 18, 20, 19, 18, 17],
  },
  {
    id: "reviews",
    label: "Awaiting review",
    value: 6,
    deltaPercent: 50,
    higherIsBetter: false,
    tone: "attention",
    hint: "Oldest submitted 3 days ago",
    trend: [2, 3, 2, 4, 3, 3, 4, 2, 3, 4, 4, 6],
  },
]);

export type SiteKey = "bv" | "corporate";

export const SITE_LABELS: Readonly<Record<SiteKey, string>> = {
  bv: "dreampetroleumbv.com",
  corporate: "Corporate site",
};

export type ActivityKind = "publish" | "edit" | "access" | "security";

export interface ActivityEvent {
  id: string;
  actor: string;
  kind: ActivityKind;
  text: string;
  target: string;
  minutesAgo: number;
}

export const DEMO_ACTIVITY = demo<ActivityEvent>([
  {
    id: "ev-1",
    actor: "Sanne de Vries",
    kind: "publish",
    text: "published",
    target: "Contact and offices",
    minutesAgo: 34,
  },
  {
    id: "ev-2",
    actor: "Jonas Peters",
    kind: "edit",
    text: "submitted for review",
    target: "Quality and certification",
    minutesAgo: 205,
  },
  {
    id: "ev-3",
    actor: "Lotte Bakker",
    kind: "access",
    text: "was given the editor role on",
    target: "Corporate site",
    minutesAgo: 380,
  },
  {
    id: "ev-4",
    actor: "Mehmet Kaya",
    kind: "edit",
    text: "updated",
    target: "Base oil SN 500 data sheet",
    minutesAgo: 1_380,
  },
  {
    id: "ev-5",
    actor: "Jonas Peters",
    kind: "security",
    text: "set up a new authenticator",
    target: "own account",
    minutesAgo: 2_900,
  },
  {
    id: "ev-6",
    actor: "Sanne de Vries",
    kind: "publish",
    text: "published",
    target: "Marine fuels overview (draft 3)",
    minutesAgo: 4_400,
  },
]);

export type SiteState = "live" | "maintenance" | "preparing";

export interface SiteStatus {
  key: SiteKey;
  name: string;
  state: SiteState;
  lastPublishedMinutesAgo: number | null;
  pages: number;
  drafts: number;
}

export const DEMO_SITES = demo<SiteStatus>([
  {
    key: "bv",
    name: SITE_LABELS.bv,
    state: "live",
    lastPublishedMinutesAgo: 34,
    pages: 31,
    drafts: 4,
  },
  {
    key: "corporate",
    name: SITE_LABELS.corporate,
    state: "preparing",
    lastPublishedMinutesAgo: null,
    pages: 17,
    drafts: 9,
  },
]);

export const ALL_DEMO_DATASETS = {
  DEMO_KPIS,
  DEMO_ACTIVITY,
  DEMO_SITES,
} as const;
