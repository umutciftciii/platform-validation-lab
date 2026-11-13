import Link from "next/link";
import type { ReactNode } from "react";
import { initials } from "../lib/format";
import { Icon, type IconKey } from "./icons";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// --- buttons --------------------------------------------------------------------------------

// One interaction language for every button: colour shifts on hover, a 1px press on click, the
// global focus ring on keyboard focus, and a muted, non-pressing look when disabled.
const BUTTON_BASE =
  "inline-flex select-none items-center justify-center gap-2 rounded-lg text-sm font-medium transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-out-soft enabled:active:translate-y-px aria-disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-55";

export const buttonStyles = {
  primary: cx(
    BUTTON_BASE,
    "h-10 px-4 bg-petrol text-petrol-ink hover:bg-petrol-strong disabled:hover:bg-petrol shadow-[inset_0_-1px_0_rgb(0_0_0/0.14),0_1px_2px_rgb(0_0_0/0.08)]",
  ),
  secondary: cx(
    BUTTON_BASE,
    "h-10 px-4 border border-line-strong bg-surface text-ink hover:border-ink-3 hover:bg-surface-2 disabled:hover:border-line-strong disabled:hover:bg-surface",
  ),
  ghost: cx(BUTTON_BASE, "h-9 px-3 text-ink-2 hover:bg-surface-2 hover:text-ink"),
  icon: cx(BUTTON_BASE, "size-9 text-ink-2 hover:bg-surface-2 hover:text-ink"),
} as const;

// --- sample-data marker ---------------------------------------------------------------------

/** Required on every widget that shows lib/demo-data.ts values. */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      data-demo-marker=""
      title="Sample data for the design prototype. Not connected to any system."
      className={cx(
        "demo-hatch inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber/40 px-2 py-0.5 text-xs font-medium text-amber-ink",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-amber" aria-hidden="true" />
      Sample data
    </span>
  );
}

// --- panels ---------------------------------------------------------------------------------

export function Panel({
  title,
  description,
  action,
  demo = false,
  children,
  className,
  bodyClassName,
  id,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  demo?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cx("rounded-2xl border border-line bg-surface shadow-panel", className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id={headingId}
              className="type-display text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink"
            >
              {title}
            </h2>
            {demo ? <DemoBadge /> : null}
          </div>
          {description ? <p className="mt-0.5 text-sm text-ink-3">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className={cx("px-5 pb-5 pt-4 sm:px-6", bodyClassName)}>{children}</div>
    </section>
  );
}

// --- status ---------------------------------------------------------------------------------

export type PillTone = "petrol" | "amber" | "success" | "danger" | "neutral";

// Tinted fill plus a hairline ring in the same hue, so pills keep their edge on any surface and
// in both themes. The dot repeats the tone for readers who scan by colour.
const PILL_TONES: Record<PillTone, string> = {
  petrol: "bg-petrol-soft text-petrol-strong ring-petrol/25",
  amber: "bg-amber-soft text-amber-ink ring-amber/30",
  success: "bg-success-soft text-success ring-success/25",
  danger: "bg-danger-soft text-danger ring-danger/25",
  neutral: "bg-surface-2 text-ink-2 ring-line-strong",
};

export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        PILL_TONES[tone],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-surface-2 font-semibold text-ink-2 ring-1 ring-line",
        size === "sm" ? "size-7 text-[0.6875rem]" : "size-9 text-xs",
      )}
    >
      {initials(name)}
    </span>
  );
}

// --- states ---------------------------------------------------------------------------------

export function EmptyState({
  icon = "inbox",
  title,
  children,
  action,
}: {
  icon?: IconKey;
  title: string;
  children?: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="relative mb-5 inline-flex size-14 items-center justify-center rounded-2xl border border-line bg-surface-2 text-ink-2">
        <span
          aria-hidden="true"
          className="absolute -inset-2 rounded-[1.4rem] border border-dashed border-line-strong"
        />
        <Icon name={icon} size={22} />
      </span>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {children ? <p className="mt-1.5 max-w-[46ch] text-sm text-ink-3">{children}</p> : null}
      {action ? (
        <Link href={action.href} className={cx(buttonStyles.secondary, "mt-5")}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function ErrorState({
  title,
  children,
  onRetry,
}: {
  title: string;
  children?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-5 inline-flex size-14 items-center justify-center rounded-2xl bg-danger-soft text-danger ring-1 ring-inset ring-danger/25">
        <Icon name="alert" size={22} />
      </span>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {children ? <p className="mt-1.5 max-w-[50ch] text-sm text-ink-3">{children}</p> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className={cx(buttonStyles.secondary, "mt-5")}>
          <Icon name="refresh" size={16} />
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** Inline busy indicator for buttons. Decorative: the button's text says what is happening. */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className="shrink-0 animate-spin motion-reduce:animate-none"
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.75" />
      <path
        d="M8 1.75A6.25 6.25 0 0 1 14.25 8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("skeleton block rounded-md", className)} />;
}

// --- charts ---------------------------------------------------------------------------------

/**
 * Tiny trend line. Values are plotted to the box; the last point is marked. `fluid` stretches the
 * line to its container's width (the stroke keeps its weight; the end marker is dropped because a
 * stretched circle would distort).
 */
export function Sparkline({
  values,
  tone = "petrol",
  width = 112,
  height = 32,
  fluid = false,
  label,
  className,
}: {
  values: readonly number[];
  tone?: "petrol" | "amber";
  width?: number;
  height?: number;
  fluid?: boolean;
  label: string;
  className?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const step = (width - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => [
    pad + i * step,
    pad + (height - pad * 2) * (1 - (v - min) / span),
  ]);
  const d = points
    .map(([x, y], i) => `${i ? "L" : "M"}${x!.toFixed(1)} ${y!.toFixed(1)}`)
    .join(" ");
  const area = `${d} L${points.at(-1)![0]!.toFixed(1)} ${height} L${pad} ${height} Z`;
  const [lx, ly] = points.at(-1)!;
  const color = tone === "amber" ? "var(--amber)" : "var(--petrol)";
  return (
    <svg
      width={fluid ? "100%" : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? "none" : undefined}
      role="img"
      aria-label={label}
      className={className}
    >
      <path d={area} fill={color} opacity={0.1} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {fluid ? null : <circle cx={lx} cy={ly} r={2.6} fill={color} />}
    </svg>
  );
}
