import Link from "next/link";
import type { ReactNode } from "react";
import type { CatalogSite, ListingVisibility, ProductStatus } from "@dream/contracts";
import { Icon, type IconKey } from "../icons";
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
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}

/** A site publication at a glance (product list, site cards). */
export function PublicationPill({
  publication,
}: {
  publication: { status: "PUBLISHED" | "UNPUBLISHED" } | null;
}) {
  if (!publication) return <StatusPill tone="neutral">Not published</StatusPill>;
  return publication.status === "PUBLISHED" ? (
    <StatusPill tone="success">Live</StatusPill>
  ) : (
    <StatusPill tone="neutral">Unpublished</StatusPill>
  );
}

export function VisibilityPill({ visibility }: { visibility: ListingVisibility | null }) {
  if (!visibility) return <StatusPill tone="neutral">Not listed</StatusPill>;
  return visibility === "VISIBLE" ? (
    <StatusPill tone="success">Visible</StatusPill>
  ) : (
    <StatusPill tone="petrol">Hidden</StatusPill>
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
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger ring-1 ring-inset ring-danger/25"
    >
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
      {children}
    </p>
  ) : (
    <p
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
