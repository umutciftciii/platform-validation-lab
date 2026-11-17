import Link from "next/link";
import type { ReactNode } from "react";
import type { CatalogSite, ProductStatus } from "@dream/contracts";
import { Icon, type IconKey } from "../icons";
import {
  SITE_STATUS_LABEL,
  type HeaderStatus,
  type ListRowStatus,
  type SiteDisplayStatus,
  type SiteStatus,
} from "../../lib/publication-status";
import { cx, StatusPill, type PillTone } from "../ui";

/** Text inputs and selects of the console's forms (same look as the sign-in form). */
export const FIELD =
  "block h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[0.9375rem] text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 hover:border-ink-3 focus:border-petrol focus:outline-none focus:ring-4 focus:ring-petrol/15 aria-invalid:border-danger aria-invalid:focus:ring-danger/15 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3";
export const TEXTAREA = cx(FIELD, "h-auto min-h-28 py-2 leading-relaxed");

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function PageHeader({
  icon,
  title,
  description,
  back,
  actions,
}: {
  icon: IconKey;
  title: string;
  description?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <header className="space-y-3">
      {back ? (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-3 transition-colors hover:text-petrol-strong"
        >
          <Icon name="back" size={16} />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="type-display flex items-center gap-3 text-[1.625rem] font-semibold text-ink sm:text-[2rem]">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-petrol-soft text-petrol-strong ring-1 ring-inset ring-petrol/25">
              <Icon name={icon} size={21} />
            </span>
            <span className="min-w-0 break-words">{title}</span>
          </h1>
          {description ? <div className="mt-2 max-w-[65ch] text-ink-2">{description}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export const SITE_SHORT: Readonly<Record<CatalogSite["key"], string>> = {
  BV: "Dream Petroleum BV",
  CORPORATE: "Corporate",
};

/** The site the catalogue is viewed for; a segmented control of the readable sites. */
export function SiteSwitcher({
  sites,
  current,
  hrefFor,
}: {
  sites: readonly CatalogSite[];
  current: string;
  hrefFor: (site: CatalogSite) => string;
}) {
  return (
    <nav aria-label="Site" className="inline-flex rounded-xl border border-line bg-surface-2 p-1">
      {sites.map((s) => {
        const active = s.id === current;
        return (
          <Link
            key={s.id}
            href={hrefFor(s)}
            aria-current={active ? "page" : undefined}
            className={cx(
              "inline-flex h-8 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
              active
                ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-line"
                : "text-ink-3 hover:text-ink",
            )}
          >
            <Icon name="sites" size={15} />
            {SITE_SHORT[s.key]}
            {!s.canEdit ? <span className="text-xs font-normal text-ink-3">(read)</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

const STATUS_PILL: Readonly<Record<ProductStatus, { tone: PillTone; label: string }>> = {
  DRAFT: { tone: "amber", label: "Draft" },
  IN_REVIEW: { tone: "petrol", label: "In review" },
  APPROVED: { tone: "success", label: "Approved" },
  ARCHIVED: { tone: "neutral", label: "Archived" },
};

export function ProductStatusPill({ status }: { status: ProductStatus }) {
  const s = STATUS_PILL[status];
  // Keyed like SiteStatusPill (DP-196): a status change replaces the pill and its text.
  return (
    <StatusPill key={status} tone={s.tone}>
      {s.label}
    </StatusPill>
  );
}

const SITE_STATUS_TONE: Readonly<Record<SiteStatus, PillTone>> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  UNPUBLISHED: "petrol",
};

/**
 * DP-197: the product on one site at a glance (product list, listing panel, site cards): Draft,
 * Published or Unpublished. The listing's technical visibility is not shown (lib/publication-status).
 * DP-203: Not listed is no step of the publication, so it is drawn apart from Draft — a dashed,
 * dot-less outline with muted text — never as an alarm.
 */
export function SiteStatusPill({ status }: { status: SiteDisplayStatus }) {
  // Keyed by the status: a change replaces the pill, so a page translated by the browser
  // (DP-196) never keeps the old label in its own copy of the text.
  if (status === "NOT_LISTED") {
    return (
      <span
        key={status}
        data-site-status="not-listed"
        className="inline-flex items-center whitespace-nowrap rounded-full border border-dashed border-line-strong px-2.5 py-0.5 text-xs font-medium text-ink-3"
      >
        {SITE_STATUS_LABEL[status]}
      </span>
    );
  }
  return (
    <StatusPill key={status} tone={SITE_STATUS_TONE[status]}>
      {SITE_STATUS_LABEL[status]}
    </StatusPill>
  );
}

/** DP-200: short site names for the product list, so a row fits 320 px. */
const LIST_SITE: Readonly<Record<CatalogSite["key"], string>> = {
  BV: "BV",
  CORPORATE: "Corporate",
};

/**
 * DP-200: the status of one product-list row, the same on wide screens and phones. The site's
 * status always shows, named after the site; the master's only when it adds something
 * (lib/publication-status listRowStatus), named "Master". One string per label (DP-196/199).
 */
export function ProductListStatus({
  siteKey,
  status,
}: {
  siteKey: CatalogSite["key"];
  status: ListRowStatus;
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span key="site" className="inline-flex items-center gap-1.5" data-status="site">
        <span className="text-xs font-medium text-ink-3">{LIST_SITE[siteKey]}</span>
        <SiteStatusPill status={status.site} />
      </span>
      {status.master ? (
        <span key="master" className="inline-flex items-center gap-1.5" data-status="master">
          <span className="text-xs font-medium text-ink-3">Master</span>
          <ProductStatusPill status={status.master} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * DP-203: the product header's status line. The publication status on each readable site comes
 * first (the primary fact, named after the site); the master's review status follows, apart and
 * labelled "Master", only when it adds something (lib/publication-status headerStatus). One
 * string per label (DP-196/199).
 */
export function ProductHeaderStatus({ status }: { status: HeaderStatus }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-header-status="">
      {status.sites.map((s) => (
        <span
          key={s.siteKey}
          className="inline-flex items-center gap-1.5"
          data-status="site"
          data-site={s.siteKey}
        >
          <span className="text-xs font-medium text-ink-3">{LIST_SITE[s.siteKey]}</span>
          <SiteStatusPill status={s.status} />
        </span>
      ))}
      {status.master ? (
        <span
          key="master"
          className={cx(
            "inline-flex items-center gap-1.5",
            status.sites.length > 0 && "sm:border-l sm:border-line sm:pl-3",
          )}
          data-status="master"
        >
          <span className="text-xs font-medium text-ink-3">Master</span>
          <ProductStatusPill status={status.master} />
        </span>
      ) : null}
    </span>
  );
}

/** Inline result line for forms: an error (role=alert) or a success note (role=status). */
export function FormMessage({
  kind,
  children,
}: {
  kind: "error" | "success";
  children: ReactNode;
}) {
  return kind === "error" ? (
    <p
      key="error"
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger ring-1 ring-inset ring-danger/25"
    >
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
      {children}
    </p>
  ) : (
    <p
      key="success"
      role="status"
      className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success ring-1 ring-inset ring-success/25"
    >
      {children}
    </p>
  );
}

/** Pick the site from `?site=bv|corporate`; the first readable site otherwise. */
export function pickSite(sites: readonly CatalogSite[], param: string | undefined): CatalogSite {
  const wanted = param?.toUpperCase();
  return sites.find((s) => s.key === wanted) ?? (sites[0] as CatalogSite);
}

export function siteParam(site: CatalogSite): string {
  return site.key.toLowerCase();
}
