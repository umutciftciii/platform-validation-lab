"use client";

/**
 * Review, approval and publication of one product (PM-3). Every button maps to one API
 * transition and names the version the user saw; the API (and the database) decide. The panels
 * only show the actions the caller's permissions allow and say why the others are missing.
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
import { Icon, type IconKey } from "../icons";
import { buttonStyles, cx, Spinner } from "../ui";
import { FormMessage, PublicationPill, SITE_SHORT, TEXTAREA } from "./parts";
import { useNotice } from "./notices";

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
              {s.label}
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

  async function act(key: string, path: string, done: string, withComment: boolean) {
    const ok = await run(
      key,
      `${base}/${path}`,
      withComment ? { version: data.version, comment: trimmed || null } : { version: data.version },
      done,
    );
    if (ok) setComment("");
  }

  const showComment = p.canSubmit || p.canReview;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Stepper status={data.status} />
        <span className="text-xs text-ink-3">Master version {data.version}</span>
      </div>

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
          <a href="#specs" className="font-medium underline underline-offset-2">
            Validation report
          </a>
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
            {p.canSubmit ? "Note for the reviewer" : "Review comment"}
            <span className="ml-1 font-normal text-ink-3">
              {p.canSubmit ? "(optional)" : "(required to request changes)"}
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
              p.canSubmit ? "What changed, what to check…" : "Reason, or what has to change…"
            }
          />
        </div>
      ) : null}

      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      {p.canSubmit || p.canWithdraw || p.canReview ? (
        <div className="flex flex-wrap gap-2">
          {p.canSubmit ? (
            <button
              type="button"
              disabled={busy || blocking > 0}
              onClick={() => act("submit", "submit", "Submitted for review.", true)}
              className={buttonStyles.primary}
            >
              {pending === "submit" ? <Spinner /> : <Icon name="publish" size={17} />}
              Submit for review
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
                Approve
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
                Request changes
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
              Withdraw from review
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
        const a = ACTION[e.action];
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

function IssueList({
  issues,
  tone,
}: {
  issues: readonly PublicationIssue[];
  tone: "danger" | "amber";
}) {
  return (
    <ul className={cx("space-y-0.5 text-xs", tone === "danger" ? "text-danger" : "text-amber-ink")}>
      {issues.map((i) => (
        <li key={`${i.target}-${i.code}`} className="flex items-start gap-1.5">
          <Icon name="alert" size={13} className="mt-px shrink-0" />
          {i.message}
        </li>
      ))}
    </ul>
  );
}

function SiteCard({ site, data }: { site: SitePublication; data: ProductWorkflowResponse }) {
  const { pending, error, run } = useWorkflowCall();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const pub = site.publication;
  const live = pub?.status === "PUBLISHED";
  const r = site.readiness;
  const base = `/products/${data.productId}/publications/${site.siteId}`;
  const name = SITE_SHORT[site.siteKey];

  async function publish() {
    if (!site.listing) return;
    await run(
      "publish",
      `${base}/publish`,
      { version: data.version, listingVersion: site.listing.version },
      live ? `Republished on ${name}.` : `Published on ${name}.`,
    );
  }
  async function unpublish() {
    if (!pub) return;
    const ok = await run(
      "unpublish",
      `${base}/unpublish`,
      { version: pub.version, comment: reason.trim() || null },
      `Unpublished on ${name}.`,
    );
    if (ok) {
      setConfirming(false);
      setReason("");
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2/40 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-medium text-ink">
          <Icon name="sites" size={16} className="text-ink-3" />
          {name}
        </h3>
        <PublicationPill publication={pub} />
      </header>

      {pub ? (
        <p className="text-xs text-ink-3">
          {live ? (
            <>
              Live: master version {pub.productVersion}, listing version {pub.listingVersion}
              <br />
              Published {when(pub.publishedAt)} by {pub.publishedBy.name}
            </>
          ) : (
            <>
              Unpublished {pub.unpublishedAt ? when(pub.unpublishedAt) : ""}
              {pub.unpublishedBy ? ` by ${pub.unpublishedBy.name}` : ""}
              <br />
              Last live: master version {pub.productVersion}
            </>
          )}
        </p>
      ) : (
        <p className="text-xs text-ink-3">Never published on this site.</p>
      )}

      {live && (site.outdated.master || site.outdated.listing) ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-soft px-2.5 py-1.5 text-xs text-amber-ink ring-1 ring-inset ring-amber/30">
          <Icon name="refresh" size={13} className="mt-px shrink-0" />
          {site.outdated.master
            ? `The master changed since publication (live version ${pub?.productVersion}, now ${data.version}).`
            : "The site listing changed since publication."}{" "}
          The site shows the published snapshot until it is republished.
        </p>
      ) : null}

      {r.blocking.length ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-danger">
            {live ? "Republishing is blocked:" : "Publishing is blocked:"}
          </p>
          <IssueList issues={r.blocking} tone="danger" />
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs font-medium text-success">
          <Icon name="check" size={13} />
          Ready to {live ? "republish" : "publish"}.
        </p>
      )}
      {r.warnings.length ? (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-amber-ink">
            {r.warnings.length} warning{r.warnings.length === 1 ? "" : "s"} (shown, not blocking)
          </summary>
          <div className="mt-1.5">
            <IssueList issues={r.warnings} tone="amber" />
          </div>
        </details>
      ) : null}

      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      {site.canPublish ? (
        confirming ? (
          <div className="space-y-2 rounded-lg border border-line bg-surface p-3">
            <label htmlFor={reasonId} className="block text-sm font-medium text-ink">
              Take the product off {name}?
              <span className="ml-1 font-normal text-ink-3">Reason (optional)</span>
            </label>
            <input
              id={reasonId}
              value={reason}
              maxLength={REVIEW_COMMENT_MAX}
              onChange={(e) => setReason(e.currentTarget.value)}
              className="block h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink focus:border-petrol focus:outline-none focus:ring-4 focus:ring-petrol/15"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending !== null}
                onClick={unpublish}
                className={cx(
                  buttonStyles.secondary,
                  "border-danger/40 text-danger hover:bg-danger-soft",
                )}
              >
                {pending === "unpublish" ? <Spinner /> : <Icon name="archive" size={16} />}
                Unpublish
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={buttonStyles.ghost}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={
                pending !== null ||
                !r.ok ||
                (live && !site.outdated.master && !site.outdated.listing)
              }
              onClick={publish}
              className={buttonStyles.primary}
            >
              {pending === "publish" ? <Spinner /> : <Icon name="publish" size={17} />}
              {live ? "Republish" : "Publish"}
            </button>
            {live ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className={buttonStyles.secondary}
              >
                <Icon name="archive" size={16} />
                Unpublish…
              </button>
            ) : null}
          </div>
        )
      ) : (
        <p className="mt-auto flex items-center gap-1.5 pt-1 text-xs text-ink-3">
          <Icon name="shield" size={13} />
          Publishing on this site needs the publisher role of the site.
        </p>
      )}
    </article>
  );
}

export function PublicationPanel({ data }: { data: ProductWorkflowResponse }) {
  if (data.sites.length === 0) {
    return <p className="text-sm text-ink-3">You cannot read any site of this product.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {data.sites.map((s) => (
        <SiteCard key={s.siteId} site={s} data={data} />
      ))}
    </div>
  );
}
