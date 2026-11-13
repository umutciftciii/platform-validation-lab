/**
 * Product masters waiting for a review decision (PM-3), from GET /review-queue. Used by the
 * review queue page and the overview. A table on wide screens, a stacked list on phones; each
 * row opens the product's review panel. Whether the viewer may decide is the API's answer
 * (separation of duties included), shown per row.
 */
import Link from "next/link";
import type { ReviewQueueItem } from "@dream/contracts";
import { relativeTime } from "../../lib/format";
import { Icon } from "../icons";
import { Avatar, StatusPill } from "../ui";

const REASON: Record<string, string> = {
  own_change: "Your change",
  no_permission: "Reviewer needed",
};

function Decision({ item }: { item: ReviewQueueItem }) {
  if (item.blockingCount > 0) {
    return <StatusPill tone="danger">{item.blockingCount} blocking</StatusPill>;
  }
  if (item.canReview) return <StatusPill tone="petrol">Ready for you</StatusPill>;
  return (
    <StatusPill tone="neutral">{REASON[item.reviewBlockedReason ?? ""] ?? "Waiting"}</StatusPill>
  );
}

export function ReviewQueueList({
  items,
  now,
  siteParam,
}: {
  items: readonly ReviewQueueItem[];
  now: Date;
  siteParam?: string;
}) {
  const href = (i: ReviewQueueItem) =>
    `/products/${i.productId}${siteParam ? `?site=${siteParam}` : ""}#review`;
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Product masters waiting for review</caption>
          <thead>
            <tr className="type-eyebrow border-y border-line bg-surface-2 text-ink-3">
              <th scope="col" className="py-2.5 pl-6 pr-3 font-semibold">
                Product
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold">
                Submitted by
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold">
                Waiting
              </th>
              <th scope="col" className="py-2.5 pl-3 pr-6 font-semibold">
                Decision
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr
                key={i.productId}
                className="group relative border-b border-line transition-colors duration-100 last:border-b-0 focus-within:bg-surface-2/70 hover:bg-surface-2/70"
              >
                <td className="py-3.5 pl-6 pr-3">
                  <Link
                    href={href(i)}
                    className="block after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-petrol"
                  >
                    <span className="block font-medium text-ink group-hover:text-petrol-strong">
                      {i.name}
                    </span>
                    <span className="tabular block font-mono text-xs text-ink-3">
                      {i.code} · version {i.version}
                    </span>
                    {i.comment ? (
                      <span className="mt-1 line-clamp-1 block text-xs text-ink-2">
                        “{i.comment}”
                      </span>
                    ) : null}
                  </Link>
                </td>
                <td className="px-3 py-3.5">
                  <span className="flex items-center gap-2.5 text-ink-2">
                    <Avatar name={i.submittedBy?.name ?? "?"} size="sm" />
                    <span className="truncate">{i.submittedBy?.name ?? "Unknown"}</span>
                  </span>
                </td>
                <td className="tabular whitespace-nowrap px-3 py-3.5 text-ink-2">
                  {relativeTime(new Date(i.submittedAt), now)}
                </td>
                <td className="py-3.5 pl-3 pr-6">
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Decision item={i} />
                      {i.warningCount > 0 ? (
                        <span className="text-xs text-amber-ink">
                          {i.warningCount} warning{i.warningCount === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </span>
                    <Icon
                      name="chevron"
                      size={16}
                      className="text-ink-3 opacity-0 transition-[opacity,transform] duration-150 group-focus-within:opacity-100 group-hover:translate-x-0.5 group-hover:opacity-100"
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line border-t border-line md:hidden">
        {items.map((i) => (
          <li key={i.productId}>
            <Link
              href={href(i)}
              className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2/70 active:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{i.name}</span>
                <span className="mt-0.5 block text-xs text-ink-3">
                  {i.submittedBy?.name ?? "Unknown"}, {relativeTime(new Date(i.submittedAt), now)}
                </span>
              </span>
              <Decision item={i} />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
