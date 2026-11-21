"use client";

/**
 * Review, approval and publication of one product (PM-3). Every button maps to one API
 * transition and names the version the user saw; the API (and the database) decide. The panels
 * only show the actions the caller's permissions allow and say why the others are missing.
 *
 * DP-193 (ADR-023): publication is built around three actions per site — Preview, Publish and
 * Unpublish — with no confirmation dialog. A user with approval and publishing rights publishes
 * the current version directly (the API's `publishMode`); the second-person review stays
 * available as an optional step.
 */
import {
  REVIEW_COMMENT_MAX,
  type ProductWorkflowResponse,
  type PublicationIssue,
  type ReviewAction,
  type ReviewEvent,
  type SitePublication,
} from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { callCatalog } from "../../lib/catalog-client";
import { fixForIssue, productTabLabel } from "../../lib/product-tabs";
import { planPublication, submitOffer } from "../../lib/publication-status";
import { Icon, type IconKey } from "../icons";
import { buttonStyles, cx, Spinner } from "../ui";
import { FormMessage, SITE_SHORT, SiteStatusPill, TEXTAREA } from "./parts";
import { PreviewLinkButton } from "./preview-link-button";
import { LanguageChoices } from "./language-publication";
import { canPublishLanguages, languageOptions } from "../../lib/translations";
import { AddressSummary } from "../seo/address-summary";
import { useNotice } from "./notices";
import { TabLink, useUnsavedChanges } from "./product-tabs";

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});
const when = (iso: string) => DATE_TIME.format(new Date(iso));

/** Runs one transition and refreshes the server-rendered page on success. */
function useWorkflowCall() {
  const router = useRouter();
  const notify = useNotice();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(key: string, path: string, body: unknown, done: string): Promise<boolean> {
    setPending(key);
    setError(null);
    const result = await callCatalog<ProductWorkflowResponse>("POST", path, body);
    setPending(null);
    if (!result.ok) {
      setError(result.message);
      notify?.(result.message, "error");
      return false;
    }
    notify?.(done);
    router.refresh();
    return true;
  }
  return { pending, error, run, setError };
}

// --- review ------------------------------------------------------------------------------------

const STEPS = [
  { status: "DRAFT", label: "Draft" },
  { status: "IN_REVIEW", label: "In review" },
  { status: "APPROVED", label: "Approved" },
] as const;

function Stepper({ status }: { status: ProductWorkflowResponse["status"] }) {
  if (status === "ARCHIVED") return null;
  const current = STEPS.findIndex((s) => s.status === status);
  return (
    <ol className="flex items-center gap-1.5 text-xs font-medium" aria-label="Review progress">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.status} className="flex min-w-0 items-center gap-1.5">
            <span
              aria-current={active ? "step" : undefined}
              className={cx(
                "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 ring-1 ring-inset",
                active && "bg-petrol text-petrol-ink ring-petrol",
                done && "bg-petrol-soft text-petrol-strong ring-petrol/25",
                !active && !done && "bg-surface-2 text-ink-3 ring-line",
              )}
            >
              {done ? <Icon name="check" size={13} /> : <span className="tabular">{i + 1}</span>}
              <span>{s.label}</span>
            </span>
            {i < STEPS.length - 1 ? (
              <span
                aria-hidden="true"
                className={cx("h-px w-4 sm:w-8", i < current ? "bg-petrol/50" : "bg-line-strong")}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

const BLOCKED_TEXT: Record<string, string> = {
  own_change:
    "You changed or submitted this revision, so another reviewer must decide (separation of duties).",
  no_permission: "Waiting for a reviewer with platform-wide product approval.",
  archived: "Archived products are not reviewed.",
};

export function ReviewPanel({ data }: { data: ProductWorkflowResponse }) {
  const { pending, error, run, setError } = useWorkflowCall();
  const [comment, setComment] = useState("");
  const commentId = useId();
  const p = data.permissions;
  const base = `/products/${data.productId}`;
  const blocking = data.validation.blocking.length;
  const warnings = data.validation.warnings.length;
  const busy = pending !== null;
  const trimmed = comment.trim();
  // DP-187: a typed note survives a tab change and a save in another tab.
  useUnsavedChanges(trimmed.length > 0);

  async function act(key: string, path: string, done: string, withComment: boolean) {
    const ok = await run(
      key,
      `${base}/${path}`,
      withComment ? { version: data.version, comment: trimmed || null } : { version: data.version },
      done,
    );
    if (ok) setComment("");
  }

  // DP-203: no "Submit for review" for a user who publishes directly on every readable site
  // (the review changes nothing for them); secondary when direct on some sites only.
  const offer = submitOffer(data);
  const canSubmit = offer !== "hidden";
  const directOnly = p.canSubmit && !canSubmit;
  const showComment = canSubmit || p.canReview;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {directOnly ? null : <Stepper status={data.status} />}
        <span className="text-xs text-ink-3">Master version {data.version}</span>
      </div>

      {directOnly ? (
        <p
          key="direct-only"
          className="flex items-start gap-2 text-sm text-ink-2"
          data-review-direct=""
        >
          <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-petrol-strong" />
          <span>You publish directly on every site you can open, so no review is needed.</span>
        </p>
      ) : null}

      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line text-sm sm:grid-cols-2">
        <div className="bg-surface p-3.5">
          <dt className="type-eyebrow text-ink-3">Submitted</dt>
          <dd className="mt-1 text-ink">
            {data.submittedAt && data.submittedBy ? (
              <>
                {data.submittedBy.name}
                <span className="block text-xs text-ink-3">
                  {when(data.submittedAt)} · version {data.submittedVersion}
                </span>
              </>
            ) : (
              <span className="text-ink-3">Not yet</span>
            )}
          </dd>
        </div>
        <div className="bg-surface p-3.5">
          <dt className="type-eyebrow text-ink-3">Last approval</dt>
          <dd className="mt-1 text-ink">
            {data.approvedAt && data.approvedBy ? (
              <>
                {data.approvedBy.name}
                <span className="block text-xs text-ink-3">
                  {when(data.approvedAt)} · version {data.approvedVersion}
                  {data.status !== "APPROVED" ? " (no longer current)" : ""}
                </span>
              </>
            ) : (
              <span className="text-ink-3">Never approved</span>
            )}
          </dd>
        </div>
      </dl>

      <p
        className={cx(
          "flex items-start gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-inset",
          blocking
            ? "bg-danger-soft text-danger ring-danger/25"
            : warnings
              ? "bg-amber-soft text-amber-ink ring-amber/30"
              : "bg-success-soft text-success ring-success/25",
        )}
      >
        <Icon
          name={blocking || warnings ? "alert" : "check"}
          size={16}
          className="mt-0.5 shrink-0"
        />
        <span>
          {blocking
            ? `${blocking} blocking issue${blocking === 1 ? "" : "s"} in the saved data: it cannot be submitted or approved.`
            : warnings
              ? `No blocking issue in the saved data; ${warnings} warning${warnings === 1 ? "" : "s"} for the reviewer.`
              : "The saved data has no blocking issue and no warning."}{" "}
          <TabLink
            tab="technical"
            section="specs"
            className="font-medium underline underline-offset-2"
          >
            Validation report (Technical)
          </TabLink>
        </span>
      </p>

      {data.status === "APPROVED" ? (
        <p className="flex items-start gap-2 text-sm text-ink-2">
          <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-petrol-strong" />
          Approved in version {data.approvedVersion}. Any change to the master, its specifications
          or images returns it to draft; the live sites keep the approved snapshot.
        </p>
      ) : null}

      {data.status === "IN_REVIEW" && !p.canReview && p.reviewBlockedReason ? (
        <p className="flex items-start gap-2 text-sm text-ink-2">
          <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-petrol-strong" />
          {BLOCKED_TEXT[p.reviewBlockedReason] ?? "You cannot decide on this review."}
        </p>
      ) : null}

      {showComment ? (
        <div>
          <label htmlFor={commentId} className="mb-1.5 block text-sm font-medium text-ink">
            {canSubmit ? "Note for the reviewer" : "Review comment"}
            <span className="ml-1 font-normal text-ink-3">
              {canSubmit ? "(optional)" : "(required to request changes)"}
            </span>
          </label>
          <textarea
            id={commentId}
            value={comment}
            maxLength={REVIEW_COMMENT_MAX}
            onChange={(e) => {
              setComment(e.currentTarget.value);
              setError(null);
            }}
            rows={3}
            className={cx(TEXTAREA, "min-h-20")}
            placeholder={
              canSubmit ? "What changed, what to check…" : "Reason, or what has to change…"
            }
          />
        </div>
      ) : null}

      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      {canSubmit || p.canWithdraw || p.canReview ? (
        <div className="flex flex-wrap gap-2">
          {canSubmit ? (
            <button
              type="button"
              disabled={busy || blocking > 0}
              onClick={() => act("submit", "submit", "Submitted for review.", true)}
              className={offer === "primary" ? buttonStyles.primary : buttonStyles.secondary}
            >
              {pending === "submit" ? <Spinner /> : <Icon name="publish" size={17} />}
              <span>Submit for review</span>
            </button>
          ) : null}
          {p.canReview ? (
            <>
              <button
                type="button"
                disabled={busy || blocking > 0}
                onClick={() => act("approve", "approve", "Product master approved.", true)}
                className={buttonStyles.primary}
              >
                {pending === "approve" ? <Spinner /> : <Icon name="check" size={17} />}
                <span>Approve</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (trimmed.length < 3) {
                    setError("Say what has to change (at least 3 characters).");
                    return;
                  }
                  void act("changes", "request-changes", "Changes requested.", true);
                }}
                className={buttonStyles.secondary}
              >
                {pending === "changes" ? <Spinner /> : <Icon name="edit" size={16} />}
                <span>Request changes</span>
              </button>
            </>
          ) : null}
          {p.canWithdraw ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => act("withdraw", "withdraw", "Review withdrawn.", false)}
              className={buttonStyles.ghost}
            >
              {pending === "withdraw" ? <Spinner /> : <Icon name="back" size={16} />}
              <span>Withdraw from review</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// --- history -----------------------------------------------------------------------------------

const ACTION: Record<ReviewAction, { label: string; icon: IconKey; tone: string }> = {
  SUBMITTED: { label: "Submitted for review", icon: "publish", tone: "text-petrol-strong" },
  WITHDRAWN: { label: "Withdrawn from review", icon: "back", tone: "text-ink-3" },
  APPROVED: { label: "Approved", icon: "check", tone: "text-success" },
  CHANGES_REQUESTED: { label: "Changes requested", icon: "edit", tone: "text-danger" },
  REVIEW_RESET: { label: "Returned to draft by a change", icon: "refresh", tone: "text-amber-ink" },
  PUBLISHED: { label: "Published", icon: "eye", tone: "text-success" },
  UNPUBLISHED: { label: "Unpublished", icon: "archive", tone: "text-ink-3" },
};

export function ReviewHistory({
  events,
  siteKeys,
}: {
  events: readonly ReviewEvent[];
  siteKeys: Readonly<Record<string, "BV" | "CORPORATE">>;
}) {
  if (events.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-3">
        <Icon name="inbox" size={16} />
        No review or publication yet.
      </p>
    );
  }
  return (
    <ol className="relative space-y-4 before:absolute before:inset-y-1 before:left-[13px] before:w-px before:bg-line">
      {events.map((e) => {
        const direct = e.action === "PUBLISHED" && e.comment?.startsWith("Direct publication");
        const a = direct ? { ...ACTION.PUBLISHED, label: "Published directly" } : ACTION[e.action];
        const site = e.siteId ? siteKeys[e.siteId] : undefined;
        return (
          <li key={e.id} className="relative flex gap-3">
            <span
              className={cx(
                "relative z-10 mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface ring-1 ring-line",
                a.tone,
              )}
            >
              <Icon name={a.icon} size={14} />
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-ink">
                <span className="font-medium">{a.label}</span>
                {site ? <span className="text-ink-2"> on {SITE_SHORT[site]}</span> : null}
                <span className="text-ink-3"> · version {e.productVersion}</span>
              </p>
              <p className="text-xs text-ink-3">
                {e.actor.name} · {when(e.createdAt)}
              </p>
              {e.comment ? (
                <p className="mt-1.5 whitespace-pre-line rounded-lg bg-surface-2 px-3 py-2 text-[0.8125rem] text-ink-2 ring-1 ring-inset ring-line">
                  {e.comment}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// --- publication -------------------------------------------------------------------------------

/**
 * DP-187: each issue says what it means, what to do and links to the tab where it is fixed.
 * The text only explains the API's readiness check (checkPublication); it decides nothing.
 */
function IssueList({
  issues,
  tone,
  site,
}: {
  issues: readonly PublicationIssue[];
  tone: "danger" | "amber";
  site: string;
}) {
  return (
    <ul className={cx("space-y-1.5 text-xs", tone === "danger" ? "text-danger" : "text-amber-ink")}>
      {issues.map((i) => {
        const fix = fixForIssue(i.code);
        return (
          <li key={`${i.target}-${i.code}`} className="flex items-start gap-1.5">
            <Icon name="alert" size={13} className="mt-px shrink-0" />
            <span className="min-w-0">
              {i.message}
              {fix ? (
                <span className="block text-ink-2">
                  {fix.hint}{" "}
                  <TabLink
                    tab={fix.tab}
                    section={fix.section}
                    {...(fix.perSite ? { site } : {})}
                    className="font-medium text-petrol-strong underline underline-offset-2"
                  >
                    Go to {productTabLabel(fix.tab)}
                  </TabLink>
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * DP-204: warnings that only matter for the next (re)publication — how it is authorised, the
 * listing it switches on, the optional company review. On a live, up-to-date site there is
 * nothing to publish, so they are not shown; data gaps and claim warnings always stay.
 */
const BEFORE_PUBLISHING_ONLY = new Set([
  "not_reviewed",
  "listing_shown_on_publish",
  "company_review_pending",
]);

/** DP-193: warnings the publisher must see without opening anything. */
const ATTENTION = new Set([
  "sensitive_claim",
  "summary_missing",
  "description_missing",
  "not_reviewed",
  "listing_shown_on_publish",
  "company_review_pending",
  "specs_missing",
]);

function SiteCard({
  site,
  data,
  productSlug,
  canList,
}: {
  site: SitePublication;
  data: ProductWorkflowResponse;
  productSlug: string;
  /** DP-203: product:edit on the site — the user can list the product there (Content tab). */
  canList: boolean;
}) {
  const { pending, error, run } = useWorkflowCall();
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const pub = site.publication;
  const plan = planPublication(site, { productStatus: data.status });
  const live = plan.status === "PUBLISHED";
  const base = `/products/${data.productId}/publications/${site.siteId}`;
  const name = SITE_SHORT[site.siteKey];
  const siteKey = site.siteKey.toLowerCase();
  const notListed = plan.notListed;
  const direct = site.publishMode === "DIRECT";
  // DP-204: a live, up-to-date site has nothing to publish: no pre-publication checks there.
  const warnings = plan.upToDate
    ? plan.warnings.filter((w) => !BEFORE_PUBLISHING_ONLY.has(w.code))
    : plan.warnings;
  const attention = warnings.filter((w) => ATTENTION.has(w.code));
  const notes = warnings.filter((w) => !ATTENTION.has(w.code));
  const attentionTitle = plan.upToDate
    ? "Notes on the live version:"
    : live
      ? "Check before republishing:"
      : "Check before publishing:";
  const busy = pending !== null;
  // DP-187: a typed reason survives a tab change.
  useUnsavedChanges(reason.trim().length > 0);
  // ML-8b: the other languages this publication writes, and their confirmed manual checks.
  const [chosen, setChosen] = useState<string[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const languagesReady = canPublishLanguages(
    plan,
    site,
    languageOptions(site.languages),
    chosen,
    checked,
  );

  async function publish() {
    if (!site.listing) return;
    // DP-198 (R-29): one request in both modes. The API shows a hidden listing (makeVisible)
    // and publishes in one transaction, so a refusal leaves the listing and the site unchanged.
    const ok = await run(
      "publish",
      `${base}/publish`,
      {
        version: data.version,
        listingVersion: site.listing.version,
        approvalMode: site.publishMode,
        makeVisible: plan.showListing,
        // ML-8b: chosen languages only; the others keep their live texts.
        locales: chosen,
        manualReview: checked.filter((l) => chosen.includes(l)),
      },
      live ? `Republished on ${name}.` : `Published on ${name}.`,
    );
    if (ok) {
      setChosen([]);
      setChecked([]);
    }
  }
  async function unpublish() {
    if (!pub) return;
    const ok = await run(
      "unpublish",
      `${base}/unpublish`,
      { version: pub.version, comment: reason.trim() || null },
      `Unpublished on ${name}.`,
    );
    if (ok) setReason("");
  }

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface-2/40 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-medium text-ink">
          <Icon name="sites" size={16} className="text-ink-3" />
          {name}
        </h3>
        <SiteStatusPill status={plan.status} />
      </header>

      {/* DP-197: one keyed line per state, each a single string, so a state change replaces the
          lines instead of editing their text nodes (a translated page keeps no stale node). */}
      {pub ? (
        <p className="text-xs text-ink-3">
          {live ? (
            <>
              {/* DP-204: date and person; no version numbers or publication-mode names. */}
              <span key="live-2" className="block">
                {`Published ${when(pub.publishedAt)} by ${pub.publishedBy.name}`}
              </span>
            </>
          ) : pub.status === "UNPUBLISHED" ? (
            <>
              <span key="off-1" className="block">
                {`Unpublished${pub.unpublishedAt ? ` ${when(pub.unpublishedAt)}` : ""}${pub.unpublishedBy ? ` by ${pub.unpublishedBy.name}` : ""}`}
              </span>
              <span key="off-3" className="block">
                {`Last published ${when(pub.publishedAt)}`}
              </span>
            </>
          ) : (
            <span key="hidden-1" className="block">
              {`Not shown on this site at the moment. Last published ${when(pub.publishedAt)}.`}
            </span>
          )}
        </p>
      ) : notListed ? (
        /* DP-203: information, not an alarm — the site does not list the product. */
        <div
          key="not-listed"
          className="flex items-start gap-1.5 rounded-lg bg-surface px-2.5 py-1.5 text-xs text-ink-2 ring-1 ring-inset ring-line"
          data-not-listed=""
        >
          <Icon name="list" size={13} className="mt-px shrink-0 text-ink-3" />
          <span className="min-w-0">
            <span key="nl-1" className="block">
              {`${name} does not list this product.`}
            </span>
            {canList ? (
              <span key="nl-2" className="block text-ink-3">
                {`To publish it here, list it on ${name} first. `}
                <TabLink
                  tab="content"
                  section="listing"
                  site={siteKey}
                  className="font-medium text-petrol-strong underline underline-offset-2"
                >
                  Go to Content
                </TabLink>
              </span>
            ) : (
              <span key="nl-3" className="block text-ink-3">
                Listing it here needs edit rights on this site.
              </span>
            )}
          </span>
        </div>
      ) : (
        <p key="never" className="text-xs text-ink-3">
          Never published on this site.
        </p>
      )}

      {live && (site.outdated.master || site.outdated.listing) ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-soft px-2.5 py-1.5 text-xs text-amber-ink ring-1 ring-inset ring-amber/30">
          <Icon name="refresh" size={13} className="mt-px shrink-0" />
          <span key="outdated">
            Changes since publication are not live yet: the site shows the published version until
            it is republished.
          </span>
        </p>
      ) : null}

      {/* DP-210: the live address, the one the next publication uses, and the redirect rule (sites
          that list the product). */}
      {site.listing ? (
        <AddressSummary
          live={site.addresses.live}
          next={site.addresses.next}
          nextLabel={
            site.addresses.live ? "Address after republishing" : "Address after publishing"
          }
          keepsOldAddress={site.addresses.keepsOldAddress}
          redirectsHere={site.addresses.redirectsHere}
          className="text-xs"
        />
      ) : null}

      {notListed ? (
        // DP-203: the other blockers stay visible, as what publishing here would also need —
        // amber, not red: nobody has to act while the site does not list the product.
        plan.blocking.length ? (
          <div key="also-needed" className="space-y-1" data-also-needed="">
            <p className="text-xs font-semibold text-amber-ink">Publishing here would also need:</p>
            <IssueList issues={plan.blocking} tone="amber" site={siteKey} />
          </div>
        ) : null
      ) : plan.blocking.length ? (
        <div key="blocked" className="space-y-1">
          <p className="text-xs font-semibold text-danger">
            {live ? "Republishing is blocked:" : "Publishing is blocked:"}
          </p>
          <IssueList issues={plan.blocking} tone="danger" site={siteKey} />
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs font-medium text-success">
          <Icon name="check" size={13} />
          <span key={`${plan.upToDate}-${live}`}>
            {plan.upToDate ? "Live and up to date." : `Ready to ${live ? "republish" : "publish"}.`}
          </span>
        </p>
      )}
      {!notListed && attention.length ? (
        <div className="space-y-1" data-attention="">
          <p key={attentionTitle} className="text-xs font-semibold text-amber-ink">
            {attentionTitle}
          </p>
          <IssueList issues={attention} tone="amber" site={site.siteKey.toLowerCase()} />
        </div>
      ) : null}
      {!notListed && notes.length ? (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-amber-ink">
            {notes.length} more note{notes.length === 1 ? "" : "s"} (not blocking)
          </summary>
          <div className="mt-1.5">
            <IssueList issues={notes} tone="amber" site={site.siteKey.toLowerCase()} />
          </div>
        </details>
      ) : null}

      {!notListed ? (
        <LanguageChoices
          languages={site.languages}
          chosen={chosen}
          checked={checked}
          onChosen={setChosen}
          onChecked={setChecked}
          canPublish={site.canPublish}
          productId={data.productId}
          siteId={site.siteId}
        />
      ) : null}

      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      <div className="mt-auto flex flex-wrap items-start gap-2 pt-1">
        {site.canPreview && !notListed ? (
          <PreviewLinkButton siteId={site.siteId} productSlug={productSlug} label="Preview" />
        ) : null}
        {site.canPublish && !notListed ? (
          <>
            <button
              type="button"
              disabled={busy || !languagesReady}
              onClick={publish}
              className={buttonStyles.primary}
            >
              {pending === "publish" ? <Spinner /> : <Icon name="publish" size={17} />}
              <span key={plan.publishLabel}>{plan.publishLabel}</span>
            </button>
            {plan.canUnpublish ? (
              <button
                type="button"
                disabled={busy}
                onClick={unpublish}
                className={cx(
                  buttonStyles.secondary,
                  "border-danger/40 text-danger hover:bg-danger-soft",
                )}
              >
                {pending === "unpublish" ? <Spinner /> : <Icon name="archive" size={16} />}
                <span>Unpublish</span>
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      {plan.canUnpublish ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-ink-3">
            Reason for unpublishing (optional)
          </summary>
          <input
            id={reasonId}
            aria-label={`Reason for unpublishing on ${name}`}
            value={reason}
            maxLength={REVIEW_COMMENT_MAX}
            onChange={(e) => setReason(e.currentTarget.value)}
            className="mt-1.5 block h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink focus:border-petrol focus:outline-none focus:ring-4 focus:ring-petrol/15"
          />
        </details>
      ) : null}
      {/* DP-204: say why there is no Preview button (BV only; publisher or company reviewer). */}
      {!notListed && !site.canPreview ? (
        <p
          key="no-preview"
          className="flex items-start gap-1.5 text-xs text-ink-3"
          data-no-preview=""
        >
          <Icon name="eye" size={13} className="mt-px shrink-0" />
          <span>
            {site.siteKey === "BV"
              ? "Preview needs publishing or content review rights on this site."
              : "Preview is available for the BV site only."}
          </span>
        </p>
      ) : null}
      {notListed ? null : site.canPublish ? (
        <p className="flex items-start gap-1.5 text-xs text-ink-3">
          <Icon name="shield" size={13} className="mt-px shrink-0" />
          <span>
            {direct
              ? "You publish this version directly; no second review is needed. Unpublishing takes it off the site at once."
              : data.status === "APPROVED"
                ? "Publishes the approved version. Unpublishing takes it off the site at once."
                : "Publishing needs an approved master (second-person review)."}
          </span>
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-ink-3">
          <Icon name="shield" size={13} />
          <span>Publishing on this site needs the publisher role of the site.</span>
        </p>
      )}
    </article>
  );
}

export function PublicationPanel({
  data,
  productSlug,
  canEditSite,
}: {
  data: ProductWorkflowResponse;
  productSlug: string;
  /** DP-203: product:edit per site id (catalogue context), for the "list it first" hint. */
  canEditSite: Readonly<Record<string, boolean>>;
}) {
  if (data.sites.length === 0) {
    return <p className="text-sm text-ink-3">You cannot read any site of this product.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {data.sites.map((s) => (
        <SiteCard
          key={s.siteId}
          site={s}
          data={data}
          productSlug={productSlug}
          canList={canEditSite[s.siteId] === true}
        />
      ))}
    </div>
  );
}
