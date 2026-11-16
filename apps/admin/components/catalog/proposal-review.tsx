/**
 * DP-172 (ADR-022), DP-189: sections of the company review page. Server components (no state);
 * the tab links inside them are small client components.
 *
 * The page keeps three kinds of content apart, each with its provenance tag:
 *   1. "From current site": the product as it is in the catalogue;
 *   2. "Research proposal — not published": the proposed customer text;
 *   3. "Internal review — never published": review items, with held (DP-002) and withheld values
 *      in a block of their own, marked as not verified and never shown as product specifications.
 *
 * DP-189 places them in four tabs, each piece of data in exactly one of them:
 *   - Content Review: the product on the current site, its text against the proposal, claim risks
 *     in the wording, the catalogue preview and the decision;
 *   - Missing & Verification: conflicts, questions, held values, missing documents and the
 *     current technical data and documents they are checked against;
 *   - Sources: the research sources;
 *   - History: authors, decisions, comments and status changes.
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
import { plural, type ReviewAttention } from "../../lib/review-tabs";
import { Icon } from "../icons";
import { cx, Panel, StatusPill } from "../ui";
import { ReviewTabLink } from "./review-tabs";

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});
const when = (iso: string) => DATE_TIME.format(new Date(iso));

type Proposal = ProposalResponse["proposal"];

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

/**
 * A collapsible group of one tab, so long lists stay manageable. Open by default; the summary
 * keeps the title and the count visible when it is closed.
 */
function Group({
  id,
  title,
  count,
  extra,
  description,
  tag,
  children,
}: {
  id: string;
  title: string;
  count: number;
  extra?: string | undefined;
  description: ReactNode;
  tag: "site" | "proposal" | "review";
  children: ReactNode;
}) {
  return (
    <details
      id={id}
      open
      data-group={id}
      className="group scroll-mt-32 rounded-2xl border border-line bg-surface shadow-panel"
    >
      <summary className="flex cursor-pointer list-none items-start gap-2 px-5 py-4 sm:px-6 [&::-webkit-details-marker]:hidden">
        <Icon
          name="chevron"
          size={16}
          className="mt-1 shrink-0 text-ink-3 transition-transform group-open:rotate-90"
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="type-display text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink">
              {title}
            </span>
            <span className="tabular rounded-full bg-surface-2 px-2 text-xs text-ink-3 ring-1 ring-line">
              {count}
            </span>
            {extra ? <span className="text-xs text-ink-3">{extra}</span> : null}
          </span>
          <SourceTag kind={tag} />
        </span>
      </summary>
      <div className="space-y-3 px-5 pb-5 sm:px-6">
        <p className="text-sm text-ink-3">{description}</p>
        {children}
      </div>
    </details>
  );
}

// --- Content Review ----------------------------------------------------------------------------

/** The product as the current site shows it: identity, category and cover image. */
export function CurrentSiteData({
  detail,
  categories,
  images,
}: {
  detail: ProductDetailResponse | null;
  categories: readonly Category[];
  images: ProductImageListResponse | null;
}) {
  const product = detail?.product;
  const listing = detail?.listing;
  const cover = images?.items.find((i) => i.isCover && i.isPublic) ?? null;
  return (
    <Panel
      id="current"
      title="Current site data"
      description="The product as it is in the catalogue today. Nothing here is changed by this review."
      action={<SourceTag kind="site" />}
      className="scroll-mt-32"
    >
      {!product ? (
        <p className="text-sm text-ink-3">The product data could not be loaded.</p>
      ) : (
        <div className="flex flex-col gap-5 sm:flex-row">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${CATALOG_API}/images/${cover.id}/thumb`}
              alt={cover.altText ?? ""}
              width={160}
              height={160}
              className="size-28 shrink-0 rounded-xl border border-line object-cover sm:size-40"
            />
          ) : null}
          <dl className="min-w-0 flex-1 divide-y divide-line">
            <Row label="Product name">{product.name}</Row>
            <Row label="SKU">
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
          </dl>
        </div>
      )}
    </Panel>
  );
}

function CompareCell({ kind, children }: { kind: "site" | "proposal"; children: ReactNode }) {
  return (
    <div
      data-compare={kind}
      className={cx(
        "min-w-0 rounded-xl px-3 py-2.5 text-sm",
        kind === "site" ? "bg-surface-2 ring-1 ring-line" : "bg-petrol-soft ring-1 ring-petrol/20",
      )}
    >
      <p className="mb-1 text-xs font-semibold text-ink-3 lg:hidden">
        {kind === "site" ? "Current site" : "Research proposal"}
      </p>
      <div className="whitespace-pre-line break-words text-ink">{children}</div>
    </div>
  );
}

/**
 * The current site text and the research proposal, field by field: side by side on wide
 * screens, one under the other on phones.
 */
export function ContentComparison({
  detail,
  proposal,
}: {
  detail: ProductDetailResponse | null;
  proposal: Proposal;
}) {
  const product = detail?.product;
  const listing = detail?.listing;
  const empty = proposal.summary === null && proposal.description === null;
  const fields = [
    {
      label: "Short description",
      current: listing?.text?.summary ?? product?.summary ?? null,
      proposed: proposal.summary,
    },
    {
      label: "Description",
      current: listing?.text?.description ?? product?.description ?? null,
      proposed: proposal.description,
    },
  ];
  return (
    <section
      id="proposal"
      aria-labelledby="proposal-title"
      className="scroll-mt-32 rounded-2xl border border-line bg-surface shadow-panel"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 sm:px-6">
        <div className="min-w-0">
          <h2
            id="proposal-title"
            className="type-display text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink"
          >
            Research proposal against the current text
          </h2>
          <p className="mt-0.5 text-sm text-ink-3">
            Proposed customer text. It is applied to the site only in a later, separate step after
            approval.
          </p>
        </div>
        <span className="flex flex-wrap gap-2">
          <SourceTag kind="site" />
          <SourceTag kind="proposal" />
        </span>
      </header>
      <div className="space-y-4 px-5 pb-5 pt-4 sm:px-6">
        {empty ? (
          <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-3 text-sm text-ink-2">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            No text is proposed for this product: it is not defined well enough to describe. It
            awaits the company&apos;s confirmation (see Missing &amp; Verification).
          </div>
        ) : null}
        <div
          aria-hidden="true"
          className="hidden gap-4 text-xs font-semibold text-ink-3 lg:grid lg:grid-cols-[9rem_1fr_1fr]"
        >
          <span />
          <span>Current site</span>
          <span>Research proposal</span>
        </div>
        <dl className="space-y-4">
          {fields.map((f) => (
            <div key={f.label} className="grid gap-2 lg:grid-cols-[9rem_1fr_1fr] lg:gap-4">
              <dt className="text-sm font-medium text-ink-2 lg:pt-2.5">{f.label}</dt>
              <dd className="contents">
                <CompareCell kind="site">{f.current ?? <Missing />}</CompareCell>
                <CompareCell kind="proposal">
                  {f.proposed ?? <Missing>{empty ? "No text proposed" : "Not provided"}</Missing>}
                </CompareCell>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** One line pointing to the open points in Missing & Verification (counts only, no data). */
export function OpenPoints({ attention }: { attention: ReviewAttention }) {
  const parts = [
    { n: attention.conflicts, one: "conflict", section: "attention", danger: true },
    { n: attention.questions, one: "question", section: "questions", danger: false },
    { n: attention.held, one: "held value", section: "held", danger: false },
    { n: attention.missingDocuments, one: "missing document", section: "documents", danger: false },
  ].filter((p) => p.n > 0);
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      <span className="font-medium text-ink">Open points in the research:</span>
      {parts.map((p) => (
        <ReviewTabLink
          key={p.section}
          tab="verification"
          section={p.section}
          className={cx(
            "underline decoration-line-strong underline-offset-2 hover:decoration-current",
            p.danger ? "font-semibold text-danger" : "text-ink-2",
          )}
        >
          {plural(p.n, p.one)}
        </ReviewTabLink>
      ))}
    </div>
  );
}

function SourceLinks({ sources }: { sources: readonly ReviewSource[] }) {
  if (sources.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-ink-3">
      Sources:{" "}
      {sources.map((s, i) => (
        <span key={s.id}>
          {i > 0 ? <span>{"; "}</span> : null}
          <ReviewTabLink tab="sources" section={`source-${s.id}`} className="underline">
            {s.id}
          </ReviewTabLink>
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
        <li
          key={i}
          data-review-item={item.kind}
          className="rounded-lg border border-line px-3 py-2.5"
        >
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

function section(id: string) {
  const s = REVIEW_SECTIONS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown review section ${id}`);
  return s;
}

/** Claim risks: wording of the proposal that needs evidence (Content Review tab). */
export function ClaimRisks({ proposal }: { proposal: Proposal }) {
  const s = section("claims");
  const list = itemsOf(proposal.reviewData.items, s.kinds);
  if (list.length === 0) return null;
  return (
    <Group
      id="claim-risks"
      title={s.title}
      count={list.length}
      description={s.description}
      tag="review"
    >
      <ItemList items={list} sources={proposal.reviewData.sources} />
    </Group>
  );
}

// --- Missing & Verification --------------------------------------------------------------------

export interface VerificationGroup {
  id: string;
  label: string;
  count: number;
}

/** Jump links to the groups of the verification tab (shown when there is more than one). */
export function VerificationNav({ groups }: { groups: readonly VerificationGroup[] }) {
  const shown = groups.filter((g) => g.count > 0);
  if (shown.length < 2) return null;
  return (
    <nav aria-label="Verification groups" className="flex flex-wrap gap-2">
      {shown.map((g) => (
        <ReviewTabLink
          key={g.id}
          tab="verification"
          section={g.id}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm text-ink-2 ring-1 ring-inset ring-line-strong transition-colors hover:bg-surface-2"
        >
          {g.label}
          <span className="tabular text-xs text-ink-3">{g.count}</span>
        </ReviewTabLink>
      ))}
    </nav>
  );
}

/** Conflicts and placeholders, and questions to confirm. */
export function ReviewItems({ proposal }: { proposal: Proposal }) {
  const { items, sources } = proposal.reviewData;
  const groups = (["attention", "questions"] as const)
    .map((id) => ({ s: section(id), list: itemsOf(items, section(id).kinds) }))
    .filter((g) => g.list.length > 0);
  if (groups.length === 0) return null;
  return (
    <div id="review-items" className="scroll-mt-32 space-y-6">
      {groups.map(({ s, list }) => (
        <Group
          key={s.id}
          id={s.id}
          title={s.title}
          count={list.length}
          description={s.description}
          tag="review"
        >
          <ItemList items={list} sources={sources} />
        </Group>
      ))}
    </div>
  );
}

/** DP-002 held values and rows withheld at import: never product specifications. */
export function HeldValues({ proposal, id = "held" }: { proposal: Proposal; id?: string }) {
  // Conflicting values first: they need an answer most. Otherwise the research order.
  const held = itemsOf(proposal.reviewData.items, HELD_KINDS)
    .map((item, i) => ({ item, i, c: item.heldValue?.conflict ? 1 : 0 }))
    .sort((a, b) => b.c - a.c || a.i - b.i)
    .map((x) => x.item);
  if (held.length === 0) return null;
  const conflicts = held.filter((h) => h.heldValue?.conflict).length;
  const statusText = (item: ReviewItem) =>
    item.kind === "DP002_HELD" ? "Unverified (DP-002)" : "Not imported";
  return (
    <Group
      id={id}
      title="Held for verification — not product data"
      count={held.length}
      extra={conflicts > 0 ? `${plural(conflicts, "conflict")}, listed first` : undefined}
      tag="review"
      description="Values shown on the current site that were not imported: DP-002 held values (unverified or conflicting) and rows without a test method or temperature. They are not verified specifications and are not part of the product."
    >
      <div data-held-values="">
        {/* Phones: one card per value. */}
        <ul className="space-y-3 md:hidden">
          {held.map((item, i) => (
            <li
              key={i}
              data-review-item={item.kind}
              className="rounded-lg border border-line px-3 py-2.5 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={KIND_META[item.kind].tone}>{statusText(item)}</StatusPill>
                {item.heldValue?.conflict ? <StatusPill tone="danger">Conflict</StatusPill> : null}
              </div>
              <p className="mt-1.5 break-words text-ink">{item.heldValue?.raw ?? item.text}</p>
              {item.heldValue?.finding ? (
                <p className="mt-1 text-ink-2">{item.heldValue.finding}</p>
              ) : null}
            </li>
          ))}
        </ul>
        {/* Wider screens: a table. */}
        <table className="hidden w-full text-sm md:table">
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
                  <StatusPill tone={KIND_META[item.kind].tone}>{statusText(item)}</StatusPill>
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
    </Group>
  );
}

/** Missing original documents, next to the documents the catalogue has today. */
export function DocumentsCheck({
  proposal,
  documents,
}: {
  proposal: Proposal;
  documents: ProductDocumentListResponse | null;
}) {
  const s = section("documents");
  const missing = itemsOf(proposal.reviewData.items, s.kinds);
  const onFile = documents?.items ?? [];
  return (
    <Group
      id="documents"
      title={s.title}
      count={missing.length}
      tag="review"
      description={s.description}
    >
      {missing.length > 0 ? (
        <ItemList items={missing} sources={proposal.reviewData.sources} />
      ) : (
        <p className="text-sm text-ink-3">The research lists no missing documents.</p>
      )}
      <div className="rounded-xl bg-surface-2 px-3 py-3 ring-1 ring-line">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Documents on file in the catalogue</h3>
          <SourceTag kind="site" />
        </div>
        {onFile.length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {onFile.map((d) => (
              <li key={d.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Icon name="document" size={16} className="shrink-0 text-ink-3" />
                <span className="min-w-0 break-words text-ink">{d.title}</span>
                <StatusPill tone="neutral">
                  {d.type === "OTHER" ? "Site-generated summary" : d.type}
                </StatusPill>
                {d.type === "OTHER" ? (
                  <span className="text-xs text-ink-3">— not an original TDS/COA</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">
            No documents. No original TDS, SDS or COA is on file.
          </p>
        )}
      </div>
    </Group>
  );
}

/** The technical data the current site shows: what the held values are checked against. */
export function CurrentTechnicalData({ specs }: { specs: ProductSpecsResponse | null }) {
  const defs = new Map((specs?.definitions ?? []).map((d) => [d.id, d]));
  const values = specs?.values ?? [];
  return (
    <Group
      id="current-technical"
      title="Technical data on the current site"
      count={values.length}
      tag="site"
      description="Transcribed from documents supplied for the current site; not cross-checked against an original technical data sheet."
    >
      {values.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm" data-current-specs="">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="py-2 pr-4 font-medium">Property</th>
                <th className="py-2 pr-4 font-medium">Value</th>
                <th className="py-2 pr-4 font-medium">Basis</th>
                <th className="py-2 font-medium">Test method</th>
              </tr>
            </thead>
            <tbody>
              {values.map((v) => (
                <tr key={`${v.definitionId}-${v.basis}`} className="border-b border-line/60">
                  <td className="py-2 pr-4 text-ink">{defs.get(v.definitionId)?.name ?? "—"}</td>
                  <td className="py-2 pr-4 text-ink">{formatSpecValue(v.value, v.unit)}</td>
                  <td className="py-2 pr-4 text-ink-2">
                    {v.basis === "TYPICAL" ? "Typical" : "Specification"}
                  </td>
                  <td className="py-2 text-ink-2">{v.testMethod ?? <Missing>None</Missing>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-ink-3">
          The current site shows no technical data for this product.
        </p>
      )}
    </Group>
  );
}

// --- Sources -----------------------------------------------------------------------------------

export function SourcesPanel({ proposal, id = "sources" }: { proposal: Proposal; id?: string }) {
  const { sources, items, family } = proposal.reviewData;
  const cited = (id: string) => items.filter((i) => i.sourceIds.includes(id)).length;
  return (
    <Panel
      id={id}
      title="Research sources"
      description="The documents the research relied on. The level says how much weight a source carries; only level A is the manufacturer's own document."
      action={<SourceTag kind="review" />}
      className="scroll-mt-32"
    >
      {family ? (
        <p className="mb-4 text-sm text-ink-2">
          Research family: <span className="font-medium text-ink">{family}</span>
        </p>
      ) : null}
      {sources.length === 0 ? (
        <p className="text-sm text-ink-3">The research lists no sources for this product.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {sources.map((s) => {
            const n = cited(s.id);
            return (
              <li
                key={s.id}
                id={`${id === "sources" ? "" : `${id}-`}source-${s.id}`}
                data-research-source={s.id}
                className="scroll-mt-32 py-3 first:pt-0"
              >
                <span className="font-mono text-xs text-ink-3">{s.id}</span>{" "}
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="break-words text-ink underline"
                  >
                    {s.title}
                  </a>
                ) : (
                  <span className="text-ink">{s.title}</span>
                )}
                <span className="block text-xs text-ink-3">
                  {s.level ? SOURCE_LEVEL_TEXT[s.level] : "Level not given"}
                  {s.documentDate ? ` · ${s.documentDate}` : ""}
                  {n > 0 ? ` · cited by ${plural(n, "review item")}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// --- History -----------------------------------------------------------------------------------

const ACTION_TEXT: Readonly<Record<ProposalEvent["action"], string>> = {
  CREATED: "Proposal created",
  REVISED: "Revised and sent for review",
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
};

const ACTION_DOT: Readonly<Record<ProposalEvent["action"], string>> = {
  CREATED: "bg-ink-3",
  REVISED: "bg-petrol",
  APPROVED: "bg-success",
  CHANGES_REQUESTED: "bg-danger",
};

/** The event before this one in the history (oldest first), or null. */
function previousOf(events: readonly ProposalEvent[], e: ProposalEvent): ProposalEvent | null {
  const i = events.indexOf(e);
  return i > 0 ? (events[i - 1] ?? null) : null;
}

/**
 * DP-191: the text of the version an event produced or decided on, folded away. A text equal to
 * the previous event's is only named; a text written before DP-191 that could not be verified
 * is marked as not recorded (never guessed).
 */
function EventText({ event, previous }: { event: ProposalEvent; previous: ProposalEvent | null }) {
  if (!event.textRecorded) {
    return (
      <p className="mt-1.5 text-xs text-ink-3" data-event-text="unrecorded">
        Text of this version not recorded (saved before the history kept texts).
      </p>
    );
  }
  if (previous && previous.contentSha256 === event.contentSha256) {
    return (
      <p className="mt-1.5 text-xs text-ink-3" data-event-text="unchanged">
        Text unchanged.
      </p>
    );
  }
  return (
    <details className="group mt-1.5" data-event-text="recorded">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-petrol-strong underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
        <Icon name="chevron" size={14} className="transition-transform group-open:rotate-90" />
        Text of version {event.proposalVersion}
      </summary>
      <dl className="mt-2 space-y-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm ring-1 ring-line">
        <div>
          <dt className="text-xs font-semibold text-ink-3">Short description</dt>
          <dd className="mt-0.5 whitespace-pre-line break-words text-ink">
            {event.summary ?? <Missing>No text</Missing>}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-ink-3">Description</dt>
          <dd className="mt-0.5 whitespace-pre-line break-words text-ink">
            {event.description ?? <Missing>No text</Missing>}
          </dd>
        </div>
      </dl>
    </details>
  );
}

export function ProposalHistory({
  proposal,
  events,
}: {
  proposal: Proposal;
  events: readonly ProposalEvent[];
}) {
  return (
    <Panel
      id="history"
      title="History"
      description="Versions, decisions and comments, newest first."
      className="scroll-mt-32"
    >
      <dl className="mb-5 divide-y divide-line">
        <Row label="Current version">
          {proposal.version} · {STATUS_META[proposal.status].label}
        </Row>
        <Row label="Written by">
          {proposal.authors.length > 0 ? (
            proposal.authors.map((a) => a.name).join(", ")
          ) : (
            <Missing />
          )}
        </Row>
        <Row label="Last decision">
          {proposal.decidedBy && proposal.decidedAt ? (
            `${proposal.decidedBy.name} · ${when(proposal.decidedAt)}`
          ) : (
            <Missing>No decision yet</Missing>
          )}
        </Row>
      </dl>
      {events.length === 0 ? (
        <p className="text-sm text-ink-3">No history yet.</p>
      ) : (
        <ol className="space-y-4 border-l border-line pl-5" data-history="">
          {[...events].reverse().map((e) => (
            <li key={e.id} className="relative text-sm">
              <span
                aria-hidden="true"
                className={cx(
                  "absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full ring-4 ring-surface",
                  ACTION_DOT[e.action],
                )}
              />
              <p className="text-ink">
                <span className="font-medium">{ACTION_TEXT[e.action]}</span> · version{" "}
                {e.proposalVersion}
              </p>
              <p className="text-xs text-ink-3">
                {e.actor.name} · {when(e.createdAt)}
              </p>
              {e.comment ? (
                <p className="mt-1.5 whitespace-pre-line rounded-lg bg-surface-2 px-3 py-2 text-ink-2">
                  {e.comment}
                </p>
              ) : null}
              <EventText event={e} previous={previousOf(events, e)} />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// --- DP-180: the research notes on the product page ---------------------------------------------

/**
 * DP-180: every review item and source of the site's research proposal, read only, on the
 * product's Technical tab. The same groups as the company review, ids prefixed so they never
 * collide with the product page's own sections:
 *   questions for the company (CONFIRM), missing documents, technical conflicts (class conflicts,
 *   inconsistencies, placeholders), claim risks, held technical values (DP-002 and values the
 *   import left out: never product specifications, never published) and the research sources.
 * Editing the text and deciding stay in Company Review (linked).
 */
export function ResearchNotes({
  proposal,
  reviewHref,
}: {
  proposal: Proposal;
  reviewHref: string;
}) {
  const { items, sources } = proposal.reviewData;
  const groups = [
    { s: section("questions"), title: "Questions for the company" },
    { s: section("documents"), title: "Missing documents" },
    { s: section("attention"), title: "Technical conflicts" },
    { s: section("claims"), title: "Claim risks" },
  ]
    .map((g) => ({ ...g, list: itemsOf(items, g.s.kinds) }))
    .filter((g) => g.list.length > 0);
  const held = itemsOf(items, HELD_KINDS).length;
  return (
    <div className="space-y-4" data-research-notes={proposal.id} data-review-total={items.length}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          {plural(items.length, "review item")} and {plural(sources.length, "source")} from the
          research for this product. Read only; nothing here is published or used as product data.
        </p>
        <a
          href={reviewHref}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-petrol-strong underline underline-offset-2"
        >
          Open in Company Review
          <Icon name="chevron" size={14} />
        </a>
      </div>
      {held > 0 ? (
        <p
          data-held-warning=""
          className="flex items-start gap-2 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink ring-1 ring-inset ring-amber/30"
        >
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          {plural(held, "technical value")} held for verification: not verified, not in the
          specifications above and never published.
        </p>
      ) : null}
      {groups.map(({ s, title, list }) => (
        <Group
          key={s.id}
          id={`research-${s.id}`}
          title={title}
          count={list.length}
          description={s.description}
          tag="review"
        >
          <ItemList items={list} sources={sources} />
        </Group>
      ))}
      <HeldValues proposal={proposal} id="research-held" />
      <SourcesPanel proposal={proposal} id="research-sources" />
    </div>
  );
}
