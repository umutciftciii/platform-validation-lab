"use client";

import { useT } from "../i18n/locale-provider";
import { Icon } from "../icons";
import { cx } from "../ui";

/**
 * DP-210: the addresses of a page, article or product on the site: the one live now, the one the
 * next publication uses, and what happens to the old one. A draft address is never public; the
 * change takes effect when it is published (the BV site then answers the old address with a
 * permanent redirect, 301). Older addresses that already redirect here are listed.
 * ML-12a: a client component (plain data props) so every text, attributes included, is in the
 * console's language.
 */
export function AddressSummary({
  live,
  next,
  keepsOldAddress,
  redirectsHere,
  nextLabel,
  className,
}: {
  /** The published address, or null while not live. */
  live: string | null;
  /** The address the next publication uses (the draft or master slug). */
  next: string;
  /** Publishing a new address keeps the old one as a 301 (the BV site). */
  keepsOldAddress: boolean;
  redirectsHere: readonly string[];
  nextLabel?: string;
  className?: string;
}) {
  const t = useT();
  const moves = live !== null && live !== next;
  return (
    <section
      aria-label={t("catalog.common.address.label")}
      className={cx("space-y-2 text-sm", className)}
    >
      <dl className="grid grid-cols-1 gap-y-0.5">
        <dt className="text-ink-3">{t("catalog.common.address.live")}</dt>
        <dd className="min-w-0 break-all font-mono text-xs leading-5 text-ink" data-address="live">
          {/* DP-197: keyed single strings, so a translated page keeps no stale text node. */}
          {live !== null ? (
            <span key="live">{live}</span>
          ) : (
            <span key="not-live" className="font-sans text-sm text-ink-3">
              {t("catalog.common.address.notOnSite")}
            </span>
          )}
        </dd>
        <dt className="mt-1.5 text-ink-3">{nextLabel ?? t("catalog.common.address.next")}</dt>
        <dd className="min-w-0 break-all font-mono text-xs leading-5 text-ink" data-address="next">
          <span key={`next-${next}`}>{next}</span>
        </dd>
      </dl>
      {moves ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg bg-amber-soft px-3 py-2 text-xs text-amber-ink"
        >
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">
            {keepsOldAddress
              ? t("catalog.common.address.movesKeeps", { next, live: live ?? "" })
              : t("catalog.common.address.movesStops", { next, live: live ?? "" })}
          </span>
        </p>
      ) : null}
      {redirectsHere.length ? (
        <div className="space-y-1">
          <p className="text-xs text-ink-3">{t("catalog.common.address.older")}</p>
          <ul className="space-y-0.5" aria-label={t("catalog.common.address.olderLabel")}>
            {redirectsHere.map((p) => (
              <li key={p} className="break-all font-mono text-xs text-ink-2">
                {p}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
