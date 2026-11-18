import { Icon } from "../icons";
import { cx } from "../ui";

/**
 * DP-210: the addresses of a page, article or product on the site: the one live now, the one the
 * next publication uses, and what happens to the old one. A draft address is never public; the
 * change takes effect when it is published (the BV site then answers the old address with a
 * permanent redirect, 301). Older addresses that already redirect here are listed.
 */
export function AddressSummary({
  live,
  next,
  keepsOldAddress,
  redirectsHere,
  nextLabel = "Address after publishing",
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
  const moves = live !== null && live !== next;
  return (
    <section aria-label="Addresses" className={cx("space-y-2 text-sm", className)}>
      <dl className="grid grid-cols-1 gap-y-0.5">
        <dt className="text-ink-3">Live address</dt>
        <dd className="min-w-0 break-all font-mono text-xs leading-5 text-ink" data-address="live">
          {/* DP-197: keyed single strings, so a translated page keeps no stale text node. */}
          {live !== null ? (
            <span key="live">{live}</span>
          ) : (
            <span key="not-live" className="font-sans text-sm text-ink-3">
              Not on the site
            </span>
          )}
        </dd>
        <dt className="mt-1.5 text-ink-3">{nextLabel}</dt>
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
              ? `Publishing moves it to ${next}. ${live} keeps working: it redirects permanently (301) to the new address. Until then the site shows ${live}.`
              : `Publishing moves it to ${next}; ${live} then stops working on this site. Until then the site shows ${live}.`}
          </span>
        </p>
      ) : null}
      {redirectsHere.length ? (
        <div className="space-y-1">
          <p className="text-xs text-ink-3">Older addresses that redirect here (301)</p>
          <ul className="space-y-0.5" aria-label="Older addresses">
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
