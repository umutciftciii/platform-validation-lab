"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, navGroupsFor } from "../../lib/navigation";
import { BrandLogo, BrandMark, Icon, RingMotif } from "../icons";
import { cx } from "../ui";

/**
 * Brand-navy navigation rail. `compact` is the tablet icon rail; labels stay available to
 * assistive technology and as tooltips.
 */
export function Sidebar({
  compact = false,
  environmentLabel,
  onNavigate,
  isOwner = false,
}: {
  compact?: boolean;
  environmentLabel: string;
  onNavigate?: () => void;
  /** DP-110: the system owner also sees the owner console. */
  isOwner?: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className="on-rail relative isolate flex h-full flex-col overflow-hidden bg-rail text-rail-ink">
      {compact ? null : (
        <RingMotif
          size={220}
          corner="bottom-right"
          className="pointer-events-none absolute bottom-0 right-0 -z-10 opacity-60"
        />
      )}
      <div
        className={cx(
          "flex shrink-0 flex-col justify-center",
          compact ? "h-16 items-center" : "gap-2.5 px-5 pb-4 pt-6",
        )}
      >
        <Link
          href="/"
          onClick={onNavigate}
          className="inline-flex w-fit rounded-lg focus-visible:outline-offset-4"
          aria-label="Dream Petroleum admin console, overview"
        >
          {compact ? <BrandMark size={36} /> : <BrandLogo height={52} />}
        </Link>
        {compact ? null : (
          <span className="type-eyebrow flex items-center gap-2 text-rail-ink-dim">
            <span className="h-px w-4 bg-brand" aria-hidden="true" />
            Admin console
          </span>
        )}
      </div>

      <nav aria-label="Main" className="mt-1 flex-1 overflow-y-auto px-3 pb-4">
        {navGroupsFor(isOwner).map((group) => (
          <div key={group.label} className="mb-5">
            {compact ? (
              <div className="mx-auto mb-2 h-px w-6 bg-rail-line" aria-hidden="true" />
            ) : (
              <p className="type-eyebrow mb-2 px-3 text-rail-ink-dim">{group.label}</p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={compact ? item.label : undefined}
                      className={cx(
                        "group relative flex items-center gap-3 rounded-lg text-sm transition-colors duration-150",
                        compact ? "mx-auto size-11 justify-center" : "h-10 px-3",
                        active
                          ? "bg-rail-2 font-medium text-white"
                          : "text-rail-ink-dim hover:bg-rail-2/70 hover:text-rail-ink",
                      )}
                    >
                      {/* The petrol "flow line": the one interactive colour on the rail. */}
                      <span
                        aria-hidden="true"
                        className={cx(
                          "absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-rail-accent transition-opacity duration-200",
                          active ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <Icon
                        name={item.icon}
                        size={19}
                        className={active ? "text-rail-accent" : undefined}
                      />
                      <span className={compact ? "sr-only" : "truncate"}>{item.label}</span>
                      {!item.ready && !compact ? (
                        <span className="ml-auto rounded border border-rail-line px-1.5 text-[0.625rem] font-medium uppercase tracking-wider text-rail-ink-dim">
                          Soon
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cx("border-t border-rail-line py-4", compact ? "px-2 text-center" : "px-5")}>
        <span
          className={cx(
            "inline-flex items-center gap-2 text-xs text-rail-ink-dim",
            compact && "justify-center",
          )}
          title={`Environment: ${environmentLabel}`}
        >
          <span className="size-1.5 rounded-full bg-amber" aria-hidden="true" />
          <span className={compact ? "sr-only" : undefined}>{environmentLabel}</span>
        </span>
      </div>
    </div>
  );
}
