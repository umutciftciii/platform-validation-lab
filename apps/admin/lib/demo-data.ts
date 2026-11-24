/**
 * SAMPLE DATA for the DP-U dashboard prototype.
 *
 * Nothing here comes from the API or the database, and none of it describes real people, real
 * enquiries or real figures. Every dataset carries `demo: true`, and every component that shows it
 * renders the sample-data marker. Replace each dataset with an API call when its module exists;
 * do not mix sample and real values in one widget.
 *
 * ML-12e: the sample texts (labels, hints, events, fictitious names) are dashboard UI text and live
 * in the dictionary (`dashboard.demo.*`). The samples here hold their keys; `demoDatasets(t)` gives
 * the datasets the widgets show, in the UI language, with the same shape as before.
 */
import type { Translate } from "./i18n/types";

export interface DemoDataset<T> {
  readonly demo: true;
  readonly items: readonly T[];
}

function demo<T>(items: readonly T[]): DemoDataset<T> {
  return { demo: true, items };
}

export type KpiTone = "neutral" | "attention";

/** A KPI as the strip shows it. */
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

type KpiId = "pages" | "products" | "enquiries" | "reviews";
type KpiSample = Omit<Kpi, "id" | "label" | "hint"> & { id: KpiId };

export const DEMO_KPIS = demo<KpiSample>([
  {
    id: "pages",
    value: 48,
    deltaPercent: 4.2,
    higherIsBetter: true,
    tone: "neutral",
    trend: [38, 39, 39, 41, 41, 42, 43, 44, 44, 46, 46, 48],
  },
  {
    id: "products",
    value: 126,
    deltaPercent: 1.6,
    higherIsBetter: true,
    tone: "neutral",
    trend: [118, 118, 119, 120, 120, 121, 122, 122, 123, 124, 124, 126],
  },
  {
    id: "enquiries",
    value: 17,
    deltaPercent: -8,
    higherIsBetter: false,
    tone: "neutral",
    trend: [24, 22, 25, 21, 20, 22, 19, 18, 20, 19, 18, 17],
  },
  {
    id: "reviews",
    value: 6,
    deltaPercent: 50,
    higherIsBetter: false,
    tone: "attention",
    trend: [2, 3, 2, 4, 3, 3, 4, 2, 3, 4, 4, 6],
  },
]);

export type SiteKey = "bv" | "corporate";

/** Site names in the UI language: the BV domain is a name and never changes. */
export function siteLabels(t: Translate): Readonly<Record<SiteKey, string>> {
  return {
    // i18n-ignore: domain name of the BV site (data)
    bv: "dreampetroleumbv.com",
    corporate: t("dashboard.demo.sites.corporate"),
  };
}

export type ActivityKind = "publish" | "edit" | "access" | "security";

/** An event as the feed shows it. */
export interface ActivityEvent {
  id: string;
  actor: string;
  kind: ActivityKind;
  text: string;
  target: string;
  minutesAgo: number;
}

type Person = "sanne" | "jonas" | "lotte" | "mehmet";
type EventKey = "ev1" | "ev2" | "ev3" | "ev4" | "ev5" | "ev6";
interface ActivitySample {
  id: string;
  actor: Person;
  kind: ActivityKind;
  /** dashboard.demo.activity.<event>: the text and target of the event. */
  event: EventKey;
  minutesAgo: number;
}

export const DEMO_ACTIVITY = demo<ActivitySample>([
  { id: "ev-1", actor: "sanne", kind: "publish", event: "ev1", minutesAgo: 34 },
  { id: "ev-2", actor: "jonas", kind: "edit", event: "ev2", minutesAgo: 205 },
  { id: "ev-3", actor: "lotte", kind: "access", event: "ev3", minutesAgo: 380 },
  { id: "ev-4", actor: "mehmet", kind: "edit", event: "ev4", minutesAgo: 1_380 },
  { id: "ev-5", actor: "jonas", kind: "security", event: "ev5", minutesAgo: 2_900 },
  { id: "ev-6", actor: "sanne", kind: "publish", event: "ev6", minutesAgo: 4_400 },
]);

export type SiteState = "live" | "maintenance" | "preparing";

/** A site as the status panel shows it. */
export interface SiteStatus {
  key: SiteKey;
  name: string;
  state: SiteState;
  lastPublishedMinutesAgo: number | null;
  pages: number;
  drafts: number;
}

export const DEMO_SITES = demo<Omit<SiteStatus, "name">>([
  { key: "bv", state: "live", lastPublishedMinutesAgo: 34, pages: 31, drafts: 4 },
  { key: "corporate", state: "preparing", lastPublishedMinutesAgo: null, pages: 17, drafts: 9 },
]);

export const ALL_DEMO_DATASETS = {
  DEMO_KPIS,
  DEMO_ACTIVITY,
  DEMO_SITES,
} as const;

/** The sample datasets as the widgets show them, in the language of `t`. */
export function demoDatasets(t: Translate): {
  DEMO_KPIS: DemoDataset<Kpi>;
  DEMO_ACTIVITY: DemoDataset<ActivityEvent>;
  DEMO_SITES: DemoDataset<SiteStatus>;
} {
  const labels = siteLabels(t);
  return {
    DEMO_KPIS: demo(
      DEMO_KPIS.items.map(({ id, value, deltaPercent, higherIsBetter, tone, trend }) => ({
        id,
        label: t(`dashboard.demo.kpis.${id}.label`),
        value,
        deltaPercent,
        higherIsBetter,
        tone,
        hint: t(`dashboard.demo.kpis.${id}.hint`),
        trend,
      })),
    ),
    DEMO_ACTIVITY: demo(
      DEMO_ACTIVITY.items.map(({ id, actor, kind, event, minutesAgo }) => ({
        id,
        actor: t(`dashboard.demo.people.${actor}`),
        kind,
        text: t(`dashboard.demo.activity.${event}.text`),
        target: t(`dashboard.demo.activity.${event}.target`),
        minutesAgo,
      })),
    ),
    DEMO_SITES: demo(
      DEMO_SITES.items.map(({ key, state, lastPublishedMinutesAgo, pages, drafts }) => ({
        key,
        name: labels[key],
        state,
        lastPublishedMinutesAgo,
        pages,
        drafts,
      })),
    ),
  };
}
