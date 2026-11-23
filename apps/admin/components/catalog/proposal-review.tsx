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
 * ML-12b: every text comes from the dictionary (`companyReview.*`). These are server components
 * rendered by server pages, so each takes the page's `t` (and `locale` for dates and numbers) as
 * a prop; data (research items, sources, names, codes, values) is never translated.
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
import { ADMIN_TIME_ZONE, type AdminLocale } from "../../lib/i18n/config";
import { dateTimeFormat } from "../../lib/i18n/format";
import type { Translate } from "../../lib/i18n/types";
import {
  fieldLabel,
  formatSpecValue,
  HELD_KINDS,
  itemsOf,
  KIND_TONE,
  kindLabel,
  REVIEW_SECTIONS,
  sectionText,
  sourceLevelText,
  sourcesFor,
  statusLabel,
  STATUS_TONE,
  type ReviewSectionId,
} from "../../lib/proposals-view";
import type { ReviewAttention } from "../../lib/review-tabs";
import { Icon } from "../icons";
import { cx, Panel, StatusPill } from "../ui";
import { ReviewTabLink } from "./review-tabs";

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
};
const when = (iso: string, locale: AdminLocale) =>
  dateTimeFormat(locale, DATE_TIME).format(new Date(iso));

type Proposal = ProposalResponse["proposal"];

export function ProposalStatusPill({ status, t }: { status: ProposalStatus; t: Translate }) {
  return <StatusPill tone={STATUS_TONE[status]}>{statusLabel(status, t)}</StatusPill>;
}

/** The provenance tag every section carries. */
export function SourceTag({ kind, t }: { kind: "site" | "proposal" | "review"; t: Translate }) {
  const text = t(`companyReview.tag.${kind}`);
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

const Missing = ({ children }: { children: ReactNode }) => (
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
  t,
  children,
}: {
  id: string;
  title: string;
  count: number;
  extra?: string | undefined;
  description: ReactNode;
  tag: "site" | "proposal" | "review";
  t: Translate;
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
          <SourceTag kind={tag} t={t} />
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
  t,
}: {
  detail: ProductDetailResponse | null;
  categories: readonly Category[];
  images: ProductImageListResponse | null;
  t: Translate;
}) {
  const product = detail?.product;
  const listing = detail?.listing;
  const cover = images?.items.find((i) => i.isCover && i.isPublic) ?? null;
  return (
    <Panel
      id="current"
      title={t("companyReview.current.title")}
      description={t("companyReview.current.description")}
      action={<SourceTag kind="site" t={t} />}
      className="scroll-mt-32"
    >
      {!product ? (
        <p className="text-sm text-ink-3">{t("companyReview.current.loadError")}</p>
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
            <Row label={t("companyReview.current.productName")}>{product.name}</Row>
            <Row label={t("companyReview.current.sku")}>
              <span className="font-mono">{product.code}</span>
            </Row>
            <Row label={t("companyReview.current.slug")}>
              <span className="font-mono">{product.slug}</span>
            </Row>
            <Row label={t("companyReview.current.category")}>
              {listing ? (
                categoryPath(categories, listing.categoryId) || (
                  <Missing>{t("companyReview.notProvided")}</Missing>
                )
              ) : (
                <Missing>{t("companyReview.notListed")}</Missing>
              )}
            </Row>
          </dl>
        </div>
      )}
    </Panel>
  );
}

function CompareCell({
  kind,
  t,
  children,
}: {
  kind: "site" | "proposal";
  t: Translate;
  children: ReactNode;
}) {
  return (
    <div
      data-compare={kind}
      className={cx(
        "min-w-0 rounded-xl px-3 py-2.5 text-sm",
        kind === "site" ? "bg-surface-2 ring-1 ring-line" : "bg-petrol-soft ring-1 ring-petrol/20",
      )}
    >
      <p className="mb-1 text-xs font-semibold text-ink-3 lg:hidden">
        {kind === "site" ? t("companyReview.currentSite") : t("companyReview.researchProposal")}
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
  t,
}: {
  detail: ProductDetailResponse | null;
  proposal: Proposal;
  t: Translate;
}) {
  const product = detail?.product;
  const listing = detail?.listing;
  const empty = proposal.summary === null && proposal.description === null;
  const fields = [
    {
      key: "summary",
      label: t("companyReview.fields.summary"),
      current: listing?.text?.summary ?? product?.summary ?? null,
      proposed: proposal.summary,
    },
    {
      key: "description",
      label: t("companyReview.fields.description"),
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
            {t("companyReview.comparison.title")}
          </h2>
          <p className="mt-0.5 text-sm text-ink-3">{t("companyReview.comparison.description")}</p>
        </div>
        <span className="flex flex-wrap gap-2">
          <SourceTag kind="site" t={t} />
          <SourceTag kind="proposal" t={t} />
        </span>
      </header>
      <div className="space-y-4 px-5 pb-5 pt-4 sm:px-6">
        {empty ? (
          <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-3 text-sm text-ink-2">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            {t("companyReview.comparison.empty")}
          </div>
        ) : null}
        <div
          aria-hidden="true"
          className="hidden gap-4 text-xs font-semibold text-ink-3 lg:grid lg:grid-cols-[9rem_1fr_1fr]"
        >
          <span />
          <span>{t("companyReview.currentSite")}</span>
          <span>{t("companyReview.researchProposal")}</span>
        </div>
        <dl className="space-y-4">
          {fields.map((f) => (
            <div key={f.key} className="grid gap-2 lg:grid-cols-[9rem_1fr_1fr] lg:gap-4">
              <dt className="text-sm font-medium text-ink-2 lg:pt-2.5">{f.label}</dt>
              <dd className="contents">
                <CompareCell kind="site" t={t}>
                  {f.current ?? <Missing>{t("companyReview.notProvided")}</Missing>}
                </CompareCell>
                <CompareCell kind="proposal" t={t}>
                  {f.proposed ?? (
                    <Missing>
                      {empty
                        ? t("companyReview.comparison.noTextProposed")
                        : t("companyReview.notProvided")}
                    </Missing>
                  )}
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
export function OpenPoints({ attention, t }: { attention: ReviewAttention; t: Translate }) {
  const parts = [
    { n: attention.conflicts, key: "conflicts", section: "attention", danger: true },
    { n: attention.questions, key: "questions", section: "questions", danger: false },
    { n: attention.held, key: "heldValues", section: "held", danger: false },
    { n: attention.missingDocuments, key: "missingDocuments", section: "documents", danger: false },
  ].filter((p) => p.n > 0);
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      <span className="font-medium text-ink">{t("companyReview.openPoints")}</span>
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
          {t(
            `companyReview.count.${p.key as "conflicts" | "questions" | "heldValues" | "missingDocuments"}`,
            { count: p.n },
          )}
        </ReviewTabLink>
      ))}
    </div>
  );
}

function SourceLinks({ sources, t }: { sources: readonly ReviewSource[]; t: Translate }) {
  if (sources.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-ink-3">
      {t("companyReview.sources")}{" "}
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
  t,
}: {
  items: readonly ReviewItem[];
  sources: readonly ReviewSource[];
  t: Translate;
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
            <StatusPill tone={KIND_TONE[item.kind]}>{kindLabel(item.kind, t)}</StatusPill>
            {fieldLabel(item.field) ? (
              <span className="text-xs text-ink-3">{fieldLabel(item.field)}</span>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm text-ink">{item.text}</p>
          <SourceLinks sources={sourcesFor(item, sources)} t={t} />
        </li>
      ))}
    </ul>
  );
}

function section(id: ReviewSectionId, t: Translate) {
  const s = REVIEW_SECTIONS.find((x) => x.id === id);
  // i18n-ignore: a programming error, never shown to a person
  if (!s) throw new Error(`unknown review section ${id}`);
  return { ...s, ...sectionText(id, t) };
}

/** Claim risks: wording of the proposal that needs evidence (Content Review tab). */
export function ClaimRisks({ proposal, t }: { proposal: Proposal; t: Translate }) {
  const s = section("claims", t);
  const list = itemsOf(proposal.reviewData.items, s.kinds);
  if (list.length === 0) return null;
  return (
    <Group
      id="claim-risks"
      title={s.title}
      count={list.length}
      description={s.description}
      tag="review"
      t={t}
    >
      <ItemList items={list} sources={proposal.reviewData.sources} t={t} />
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
export function VerificationNav({
  groups,
  t,
}: {
  groups: readonly VerificationGroup[];
  t: Translate;
}) {
  const shown = groups.filter((g) => g.count > 0);
  if (shown.length < 2) return null;
  return (
    <nav aria-label={t("companyReview.verification.navLabel")} className="flex flex-wrap gap-2">
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
export function ReviewItems({ proposal, t }: { proposal: Proposal; t: Translate }) {
  const { items, sources } = proposal.reviewData;
  const groups = (["attention", "questions"] as const)
    .map((id) => ({ s: section(id, t), list: itemsOf(items, section(id, t).kinds) }))
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
          t={t}
        >
          <ItemList items={list} sources={sources} t={t} />
        </Group>
      ))}
    </div>
  );
}

/** DP-002 held values and rows withheld at import: never product specifications. */
export function HeldValues({
  proposal,
  t,
  id = "held",
}: {
  proposal: Proposal;
  t: Translate;
  id?: string;
}) {
  // Conflicting values first: they need an answer most. Otherwise the research order.
  const held = itemsOf(proposal.reviewData.items, HELD_KINDS)
    .map((item, i) => ({ item, i, c: item.heldValue?.conflict ? 1 : 0 }))
    .sort((a, b) => b.c - a.c || a.i - b.i)
    .map((x) => x.item);
  if (held.length === 0) return null;
  const conflicts = held.filter((h) => h.heldValue?.conflict).length;
  const statusText = (item: ReviewItem) =>
    item.kind === "DP002_HELD"
      ? t("companyReview.verification.unverified")
      : t("companyReview.verification.notImported");
  return (
    <Group
      id={id}
      title={t("companyReview.verification.heldTitle")}
      count={held.length}
      extra={
        conflicts > 0 ? t("companyReview.verification.heldExtra", { count: conflicts }) : undefined
      }
      tag="review"
      t={t}
      description={t("companyReview.verification.heldDescription")}
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
                <StatusPill tone={KIND_TONE[item.kind]}>{statusText(item)}</StatusPill>
                {item.heldValue?.conflict ? (
                  <StatusPill tone="danger">{t("companyReview.verification.conflict")}</StatusPill>
                ) : null}
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
              <th className="py-2 pr-4 font-medium">{t("companyReview.verification.status")}</th>
              <th className="py-2 pr-4 font-medium">
                {t("companyReview.verification.valueAsPrinted")}
              </th>
              <th className="py-2 pr-4 font-medium">{t("companyReview.verification.conflict")}</th>
              <th className="py-2 font-medium">{t("companyReview.verification.finding")}</th>
            </tr>
          </thead>
          <tbody>
            {held.map((item, i) => (
              <tr key={i} className="border-b border-line/60 align-top">
                <td className="py-2 pr-4">
                  <StatusPill tone={KIND_TONE[item.kind]}>{statusText(item)}</StatusPill>
                </td>
                <td className="py-2 pr-4 text-ink">{item.heldValue?.raw ?? item.text}</td>
                <td className="py-2 pr-4">
                  {item.heldValue?.conflict ? (
                    <StatusPill tone="danger">
                      {t("companyReview.verification.conflict")}
                    </StatusPill>
                  ) : (
                    <span className="text-ink-3">{t("companyReview.verification.no")}</span>
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
  t,
}: {
  proposal: Proposal;
  documents: ProductDocumentListResponse | null;
  t: Translate;
}) {
  const s = section("documents", t);
  const missing = itemsOf(proposal.reviewData.items, s.kinds);
  const onFile = documents?.items ?? [];
  return (
    <Group
      id="documents"
      title={s.title}
      count={missing.length}
      tag="review"
      t={t}
      description={s.description}
    >
      {missing.length > 0 ? (
        <ItemList items={missing} sources={proposal.reviewData.sources} t={t} />
      ) : (
        <p className="text-sm text-ink-3">{t("companyReview.verification.noMissingDocuments")}</p>
      )}
      <div className="rounded-xl bg-surface-2 px-3 py-3 ring-1 ring-line">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">
            {t("companyReview.verification.documentsOnFile")}
          </h3>
          <SourceTag kind="site" t={t} />
        </div>
        {onFile.length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {onFile.map((d) => (
              <li key={d.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Icon name="document" size={16} className="shrink-0 text-ink-3" />
                <span className="min-w-0 break-words text-ink">{d.title}</span>
                <StatusPill tone="neutral">
                  {d.type === "OTHER" ? t("companyReview.verification.siteSummary") : d.type}
                </StatusPill>
                {d.type === "OTHER" ? (
                  <span className="text-xs text-ink-3">
                    {t("companyReview.verification.notOriginal")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">{t("companyReview.verification.noDocuments")}</p>
        )}
      </div>
    </Group>
  );
}

/** The technical data the current site shows: what the held values are checked against. */
export function CurrentTechnicalData({
  specs,
  t,
  locale,
}: {
  specs: ProductSpecsResponse | null;
  t: Translate;
  locale: AdminLocale;
}) {
  const defs = new Map((specs?.definitions ?? []).map((d) => [d.id, d]));
  const values = specs?.values ?? [];
  return (
    <Group
      id="current-technical"
      title={t("companyReview.verification.technicalTitle")}
      count={values.length}
      tag="site"
      t={t}
      description={t("companyReview.verification.technicalDescription")}
    >
      {values.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm" data-current-specs="">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="py-2 pr-4 font-medium">
                  {t("companyReview.verification.property")}
                </th>
                <th className="py-2 pr-4 font-medium">{t("companyReview.verification.value")}</th>
                <th className="py-2 pr-4 font-medium">{t("companyReview.verification.basis")}</th>
                <th className="py-2 font-medium">{t("companyReview.verification.testMethod")}</th>
              </tr>
            </thead>
            <tbody>
              {values.map((v) => (
                <tr key={`${v.definitionId}-${v.basis}`} className="border-b border-line/60">
                  <td className="py-2 pr-4 text-ink">{defs.get(v.definitionId)?.name ?? "—"}</td>
                  <td className="py-2 pr-4 text-ink">
                    {formatSpecValue(v.value, v.unit, t, locale)}
                  </td>
                  <td className="py-2 pr-4 text-ink-2">
                    {v.basis === "TYPICAL"
                      ? t("companyReview.verification.typical")
                      : t("companyReview.verification.specification")}
                  </td>
                  <td className="py-2 text-ink-2">
                    {v.testMethod ?? <Missing>{t("companyReview.verification.none")}</Missing>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-ink-3">{t("companyReview.verification.noTechnical")}</p>
      )}
    </Group>
  );
}

// --- Sources -----------------------------------------------------------------------------------

export function SourcesPanel({
  proposal,
  t,
  id = "sources",
}: {
  proposal: Proposal;
  t: Translate;
  id?: string;
}) {
  const { sources, items, family } = proposal.reviewData;
  const cited = (id: string) => items.filter((i) => i.sourceIds.includes(id)).length;
  return (
    <Panel
      id={id}
      title={t("companyReview.researchSources.title")}
      description={t("companyReview.researchSources.description")}
      action={<SourceTag kind="review" t={t} />}
      className="scroll-mt-32"
    >
      {family ? (
        <p className="mb-4 text-sm text-ink-2">
          {t("companyReview.researchSources.family")}{" "}
          <span className="font-medium text-ink">{family}</span>
        </p>
      ) : null}
      {sources.length === 0 ? (
        <p className="text-sm text-ink-3">{t("companyReview.researchSources.none")}</p>
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
                  {s.level
                    ? sourceLevelText(s.level, t)
                    : t("companyReview.researchSources.levelNotGiven")}
                  {s.documentDate ? ` · ${s.documentDate}` : ""}
                  {n > 0 ? t("companyReview.researchSources.citedBy", { count: n }) : ""}
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
function EventText({
  event,
  previous,
  t,
}: {
  event: ProposalEvent;
  previous: ProposalEvent | null;
  t: Translate;
}) {
  if (!event.textRecorded) {
    return (
      <p className="mt-1.5 text-xs text-ink-3" data-event-text="unrecorded">
        {t("companyReview.history.textUnrecorded")}
      </p>
    );
  }
  if (previous && previous.contentSha256 === event.contentSha256) {
    return (
      <p className="mt-1.5 text-xs text-ink-3" data-event-text="unchanged">
        {t("companyReview.history.textUnchanged")}
      </p>
    );
  }
  return (
    <details className="group mt-1.5" data-event-text="recorded">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-petrol-strong underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
        <Icon name="chevron" size={14} className="transition-transform group-open:rotate-90" />
        {t("companyReview.history.textOfVersion", { version: event.proposalVersion })}
      </summary>
      <dl className="mt-2 space-y-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm ring-1 ring-line">
        <div>
          <dt className="text-xs font-semibold text-ink-3">{t("companyReview.fields.summary")}</dt>
          <dd className="mt-0.5 whitespace-pre-line break-words text-ink">
            {event.summary ?? <Missing>{t("companyReview.noText")}</Missing>}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-ink-3">
            {t("companyReview.fields.description")}
          </dt>
          <dd className="mt-0.5 whitespace-pre-line break-words text-ink">
            {event.description ?? <Missing>{t("companyReview.noText")}</Missing>}
          </dd>
        </div>
      </dl>
    </details>
  );
}

export function ProposalHistory({
  proposal,
  events,
  t,
  locale,
}: {
  proposal: Proposal;
  events: readonly ProposalEvent[];
  t: Translate;
  locale: AdminLocale;
}) {
  return (
    <Panel
      id="history"
      title={t("companyReview.history.title")}
      description={t("companyReview.history.description")}
      className="scroll-mt-32"
    >
      <dl className="mb-5 divide-y divide-line">
        <Row label={t("companyReview.history.currentVersion")}>
          {proposal.version} · {statusLabel(proposal.status, t)}
        </Row>
        <Row label={t("companyReview.history.writtenBy")}>
          {proposal.authors.length > 0 ? (
            proposal.authors.map((a) => a.name).join(", ")
          ) : (
            <Missing>{t("companyReview.notProvided")}</Missing>
          )}
        </Row>
        <Row label={t("companyReview.history.lastDecision")}>
          {proposal.decidedBy && proposal.decidedAt ? (
            `${proposal.decidedBy.name} · ${when(proposal.decidedAt, locale)}`
          ) : (
            <Missing>{t("companyReview.history.noDecision")}</Missing>
          )}
        </Row>
      </dl>
      {events.length === 0 ? (
        <p className="text-sm text-ink-3">{t("companyReview.history.none")}</p>
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
                <span className="font-medium">{t(`companyReview.history.action.${e.action}`)}</span>
                {" · "}
                {t("companyReview.history.version", { version: e.proposalVersion })}
              </p>
              <p className="text-xs text-ink-3">
                {e.actor.name} · {when(e.createdAt, locale)}
              </p>
              {e.comment ? (
                <p className="mt-1.5 whitespace-pre-line rounded-lg bg-surface-2 px-3 py-2 text-ink-2">
                  {e.comment}
                </p>
              ) : null}
              <EventText event={e} previous={previousOf(events, e)} t={t} />
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
  t,
}: {
  proposal: Proposal;
  reviewHref: string;
  t: Translate;
}) {
  const { items, sources } = proposal.reviewData;
  const groups = [
    { s: section("questions", t), title: t("companyReview.notes.questions") },
    { s: section("documents", t), title: t("companyReview.notes.documents") },
    { s: section("attention", t), title: t("companyReview.notes.conflicts") },
    { s: section("claims", t), title: t("companyReview.notes.claims") },
  ]
    .map((g) => ({ ...g, list: itemsOf(items, g.s.kinds) }))
    .filter((g) => g.list.length > 0);
  const held = itemsOf(items, HELD_KINDS).length;
  return (
    <div className="space-y-4" data-research-notes={proposal.id} data-review-total={items.length}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          {t("companyReview.notes.intro", {
            items: t("companyReview.count.reviewItems", { count: items.length }),
            sources: t("companyReview.count.sources", { count: sources.length }),
          })}
        </p>
        <a
          href={reviewHref}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-petrol-strong underline underline-offset-2"
        >
          {t("companyReview.notes.open")}
          <Icon name="chevron" size={14} />
        </a>
      </div>
      {held > 0 ? (
        <p
          data-held-warning=""
          className="flex items-start gap-2 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink ring-1 ring-inset ring-amber/30"
        >
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          {t("companyReview.notes.held", {
            values: t("companyReview.count.technicalValues", { count: held }),
          })}
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
          t={t}
        >
          <ItemList items={list} sources={sources} t={t} />
        </Group>
      ))}
      <HeldValues proposal={proposal} t={t} id="research-held" />
      <SourcesPanel proposal={proposal} t={t} id="research-sources" />
    </div>
  );
}
