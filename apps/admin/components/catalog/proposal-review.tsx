/**
 * DP-172 (ADR-022): sections of the company review page. Server components only (no state).
 *
 * The page keeps three kinds of content in separate, labelled sections:
 *   1. "Current site data": the product as it is in the catalogue (from the current site);
 *   2. "Research proposal": the proposed customer text, not published;
 *   3. review items, with held (DP-002) and withheld values in a block of their own, marked as
 *      not verified and never shown as product specifications.
 */
import type {
  Category,
  ProductDetailResponse,
  ProductDocumentListResponse,
  ProductImageListResponse,
  ProductSpecsResponse,
  ProposalEvent,
  ProposalResponse,
  ProposalStatus,
  ReviewItem,
  ReviewSource,
} from "@dream/contracts";
import { CATALOG_API } from "@dream/contracts";
import type { ReactNode } from "react";
import { categoryPath } from "../../lib/catalog-view";
import {
  fieldLabel,
  formatSpecValue,
  HELD_KINDS,
  itemsOf,
  KIND_META,
  REVIEW_SECTIONS,
  SOURCE_LEVEL_TEXT,
  sourcesFor,
  STATUS_META,
} from "../../lib/proposals-view";
import { Icon } from "../icons";
import { cx, Panel, StatusPill } from "../ui";

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});
const when = (iso: string) => DATE_TIME.format(new Date(iso));

export function ProposalStatusPill({ status }: { status: ProposalStatus }) {
  const m = STATUS_META[status];
  return <StatusPill tone={m.tone}>{m.label}</StatusPill>;
}

/** The provenance tag every section carries. */
export function SourceTag({ kind }: { kind: "site" | "proposal" | "review" }) {
  const text =
    kind === "site"
      ? "From current site"
      : kind === "proposal"
        ? "Research proposal — not published"
        : "Internal review — never published";
  const tone =
    kind === "site"
      ? "bg-surface-2 text-ink-2 ring-line-strong"
      : kind === "proposal"
        ? "bg-petrol-soft text-petrol-strong ring-petrol/25"
        : "bg-amber-soft text-amber-ink ring-amber/30";
  return (
    <span
      data-provenance={kind}
      className={cx(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset",
        tone,
      )}
    >
      {text}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-ink">{children}</dd>
    </div>
  );
}

const Missing = ({ children = "Not provided" }: { children?: ReactNode }) => (
  <span className="text-ink-3">{children}</span>
);

// --- 1. current site data ----------------------------------------------------------------------

export function CurrentSiteData({
  detail,
  categories,
  specs,
  images,
  documents,
}: {
  detail: ProductDetailResponse | null;
  categories: readonly Category[];
  specs: ProductSpecsResponse | null;
  images: ProductImageListResponse | null;
  documents: ProductDocumentListResponse | null;
}) {
  const product = detail?.product;
  const listing = detail?.listing;
  const defs = new Map((specs?.definitions ?? []).map((d) => [d.id, d]));
  const cover = images?.items.find((i) => i.isCover && i.isPublic) ?? null;
  return (
    <Panel
      id="current"
      title="Current site data"
      description="The product as it is in the catalogue today. Nothing here is changed by this review."
      action={<SourceTag kind="site" />}
    >
      {!product ? (
        <p className="text-sm text-ink-3">The product data could not be loaded.</p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-5 sm:flex-row">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${CATALOG_API}/images/${cover.id}/thumb`}
                alt={cover.altText ?? ""}
                width={160}
                height={160}
                className="size-40 shrink-0 rounded-xl border border-line object-cover"
              />
            ) : null}
            <dl className="min-w-0 flex-1 divide-y divide-line">
              <Row label="Product name">{product.name}</Row>
              <Row label="Code">
                <span className="font-mono">{product.code}</span>
              </Row>
              <Row label="Slug">
                <span className="font-mono">{product.slug}</span>
              </Row>
              <Row label="Category">
                {listing ? (
                  categoryPath(categories, listing.categoryId) || <Missing />
                ) : (
                  <Missing>Not listed</Missing>
                )}
              </Row>
              <Row label="Short description">
                {listing?.text?.summary ?? product.summary ?? <Missing />}
              </Row>
              <Row label="Description">
                {listing?.text?.description ?? product.description ?? <Missing />}
              </Row>
            </dl>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">
              Technical data on the current site
            </h3>
            {specs && specs.values.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-ink-3">
                      <th className="py-2 pr-4 font-medium">Property</th>
                      <th className="py-2 pr-4 font-medium">Value</th>
                      <th className="py-2 pr-4 font-medium">Basis</th>
                      <th className="py-2 font-medium">Test method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {specs.values.map((v) => (
                      <tr key={`${v.definitionId}-${v.basis}`} className="border-b border-line/60">
                        <td className="py-2 pr-4 text-ink">
                          {defs.get(v.definitionId)?.name ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-ink">{formatSpecValue(v.value, v.unit)}</td>
                        <td className="py-2 pr-4 text-ink-2">
                          {v.basis === "TYPICAL" ? "Typical" : "Specification"}
                        </td>
                        <td className="py-2 text-ink-2">
                          {v.testMethod ?? <Missing>None</Missing>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-ink-3">
                  Transcribed from documents supplied for the current site; not cross-checked
                  against an original technical data sheet.
                </p>
              </div>
            ) : (
              <p className="text-sm text-ink-3">
                The current site shows no technical data for this product.
              </p>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Documents</h3>
            {documents && documents.items.length > 0 ? (
              <ul className="space-y-1.5 text-sm">
                {documents.items.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <Icon name="document" size={16} className="text-ink-3" />
                    <span className="text-ink">{d.title}</span>
                    <StatusPill tone="neutral">
                      {d.type === "OTHER"
                        ? "Site-generated summary — not an original TDS/COA"
                        : d.type}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">
                No documents. No original TDS, SDS or COA is on file.
              </p>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

// --- 2. research proposal ----------------------------------------------------------------------

export function ResearchProposal({ proposal }: { proposal: ProposalResponse["proposal"] }) {
  const empty = proposal.summary === null && proposal.description === null;
  return (
    <Panel
      id="proposal"
      title="Research proposal"
      description="Proposed customer text. It is applied to the site only in a later, separate step after approval."
      action={<SourceTag kind="proposal" />}
    >
      {empty ? (
        <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-3 text-sm text-ink-2">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          No text is proposed for this product: it is not defined well enough to describe. It awaits
          the company&apos;s confirmation (see the review items).
        </div>
      ) : (
        <dl className="divide-y divide-line">
          <Row label="Short description">{proposal.summary ?? <Missing />}</Row>
          <Row label="Description">
            <span className="whitespace-pre-line">{proposal.description ?? <Missing />}</span>
          </Row>
        </dl>
      )}
    </Panel>
  );
}

// --- 3. review items ---------------------------------------------------------------------------

function SourceLinks({ sources }: { sources: readonly ReviewSource[] }) {
  if (sources.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-ink-3">
      Sources:{" "}
      {sources.map((s, i) => (
        <span key={s.id}>
          {i > 0 ? "; " : null}
          {s.url ? (
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline"
            >
              {s.id}
            </a>
          ) : (
            s.id
          )}
        </span>
      ))}
    </p>
  );
}

function ItemList({
  items,
  sources,
}: {
  items: readonly ReviewItem[];
  sources: readonly ReviewSource[];
}) {
  return (
    <ul className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="rounded-lg border border-line px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={KIND_META[item.kind].tone}>{KIND_META[item.kind].label}</StatusPill>
            {fieldLabel(item.field) ? (
              <span className="text-xs text-ink-3">{fieldLabel(item.field)}</span>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm text-ink">{item.text}</p>
          <SourceLinks sources={sourcesFor(item, sources)} />
        </li>
      ))}
    </ul>
  );
}

export function ReviewItems({ proposal }: { proposal: ProposalResponse["proposal"] }) {
  const { items, sources } = proposal.reviewData;
  const sections = REVIEW_SECTIONS.map((s) => ({ ...s, list: itemsOf(items, s.kinds) })).filter(
    (s) => s.list.length > 0,
  );
  return (
    <Panel
      id="review-items"
      title="Review items"
      description="Questions and findings of the research for the company. Internal; never shown on a public site."
      action={<SourceTag kind="review" />}
    >
      {sections.length === 0 ? (
        <p className="text-sm text-ink-3">No review items.</p>
      ) : (
        <div className="space-y-6">
          {sections.map((s) => (
            <section key={s.id} aria-labelledby={`ri-${s.id}`}>
              <h3 id={`ri-${s.id}`} className="text-sm font-semibold text-ink">
                {s.title} <span className="font-normal text-ink-3">({s.list.length})</span>
              </h3>
              <p className="mb-2 text-xs text-ink-3">{s.description}</p>
              <ItemList items={s.list} sources={sources} />
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}

/** DP-002 held values and rows withheld at import: never product specifications. */
export function HeldValues({ proposal }: { proposal: ProposalResponse["proposal"] }) {
  const held = itemsOf(proposal.reviewData.items, HELD_KINDS);
  if (held.length === 0) return null;
  return (
    <Panel
      id="held"
      title="Held for verification — not product data"
      description="Values shown on the current site that were not imported: DP-002 held values (unverified or conflicting) and rows without a test method or temperature. They are not verified specifications and are not part of the product."
      action={<SourceTag kind="review" />}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm" data-held-values="">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Value as printed on the source</th>
              <th className="py-2 pr-4 font-medium">Conflict</th>
              <th className="py-2 font-medium">Finding</th>
            </tr>
          </thead>
          <tbody>
            {held.map((item, i) => (
              <tr key={i} className="border-b border-line/60 align-top">
                <td className="py-2 pr-4">
                  <StatusPill tone={KIND_META[item.kind].tone}>
                    {item.kind === "DP002_HELD" ? "Unverified (DP-002)" : "Not imported"}
                  </StatusPill>
                </td>
                <td className="py-2 pr-4 text-ink">{item.heldValue?.raw ?? item.text}</td>
                <td className="py-2 pr-4">
                  {item.heldValue?.conflict ? (
                    <StatusPill tone="danger">Conflict</StatusPill>
                  ) : (
                    <span className="text-ink-3">No</span>
                  )}
                </td>
                <td className="py-2 text-ink-2">{item.heldValue?.finding ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function SourcesPanel({ sources }: { sources: readonly ReviewSource[] }) {
  if (sources.length === 0) return null;
  return (
    <Panel id="sources" title="Research sources" action={<SourceTag kind="review" />}>
      <ul className="space-y-2 text-sm">
        {sources.map((s) => (
          <li key={s.id}>
            <span className="font-mono text-xs text-ink-3">{s.id}</span>{" "}
            {s.url ? (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-ink underline"
              >
                {s.title}
              </a>
            ) : (
              <span className="text-ink">{s.title}</span>
            )}
            <span className="block text-xs text-ink-3">
              {s.level ? SOURCE_LEVEL_TEXT[s.level] : "Level not given"}
              {s.documentDate ? ` · ${s.documentDate}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const ACTION_TEXT: Readonly<Record<ProposalEvent["action"], string>> = {
  CREATED: "Proposal created",
  REVISED: "Revised and sent for review",
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
};

export function ProposalHistory({ events }: { events: readonly ProposalEvent[] }) {
  return (
    <ol className="space-y-3">
      {[...events].reverse().map((e) => (
        <li key={e.id} className="text-sm">
          <p className="text-ink">
            <span className="font-medium">{ACTION_TEXT[e.action]}</span> · version{" "}
            {e.proposalVersion}
          </p>
          <p className="text-xs text-ink-3">
            {e.actor.name} · {when(e.createdAt)}
          </p>
          {e.comment ? <p className="mt-1 whitespace-pre-line text-ink-2">{e.comment}</p> : null}
        </li>
      ))}
    </ol>
  );
}
