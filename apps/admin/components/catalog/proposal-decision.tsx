"use client";

/**
 * DP-172: the company's decision on one proposal. Approve, or request changes with a required
 * explanation. Each button sends the version the reviewer saw; the API decides (permission,
 * separation of duties, stale versions) and the page reloads its server data on success.
 *
 * A decision changes nothing in the product: it is neither a technical approval nor a publication.
 */
import { REVIEW_COMMENT_MAX, type ProposalResponse } from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { callCatalog } from "../../lib/catalog-client";
import { createTranslator } from "../../lib/i18n/translate";
import type { Translate } from "../../lib/i18n/types";
import { decisionBlockedText } from "../../lib/proposals-view";
import { useT } from "../i18n/locale-provider";
import { Icon } from "../icons";
import { buttonStyles, cx, Spinner } from "../ui";
import { FormMessage, TEXTAREA } from "./parts";

/** The reason a request for changes is refused before it is sent, or null. */
export function changeRequestProblem(
  comment: string,
  t: Translate = createTranslator("en"),
): string | null {
  const text = comment.trim();
  if (text.length < 3) return t("companyReview.decision.explain");
  if (text.length > REVIEW_COMMENT_MAX)
    return t("companyReview.decision.tooLong", { max: REVIEW_COMMENT_MAX });
  return null;
}

export function ProposalDecision({
  proposalId,
  version,
  canDecide,
  decisionBlocked,
}: {
  proposalId: string;
  version: number;
  canDecide: boolean;
  decisionBlocked: ProposalResponse["decisionBlocked"];
}) {
  const router = useRouter();
  const t = useT();
  const commentId = useId();
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState<"approve" | "changes" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!canDecide) {
    const why = decisionBlockedText(decisionBlocked, t);
    return (
      <div
        role="note"
        data-decision-blocked={decisionBlocked ?? "unknown"}
        className="flex items-start gap-2.5 rounded-lg bg-surface-2 px-3 py-3 text-sm ring-1 ring-inset ring-line-strong"
      >
        <Icon name="shield" size={17} className="mt-0.5 shrink-0 text-petrol-strong" />
        <div className="min-w-0">
          <p className="font-semibold text-ink">{why.title}</p>
          <p className="mt-1 text-ink-2">{why.body}</p>
          <p className="mt-2 text-xs text-ink-3">{t("companyReview.decision.unavailable")}</p>
        </div>
      </div>
    );
  }

  async function act(kind: "approve" | "changes") {
    setError(null);
    setDone(null);
    if (kind === "changes") {
      const problem = changeRequestProblem(comment, t);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setPending(kind);
    const trimmed = comment.trim();
    const result = await callCatalog<ProposalResponse>(
      "POST",
      `/proposals/${proposalId}/${kind === "approve" ? "approve" : "request-changes"}`,
      kind === "approve" ? { version, comment: trimmed || null } : { version, comment: trimmed },
    );
    setPending(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDone(
      kind === "approve"
        ? t("companyReview.decision.approved")
        : t("companyReview.decision.changesRequested"),
    );
    setComment("");
    router.refresh();
  }

  const busy = pending !== null;
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={commentId} className="mb-1.5 block text-sm font-medium text-ink">
          {t("companyReview.decision.comment")}
          <span className="ml-1 font-normal text-ink-3">
            {t("companyReview.decision.commentHint")}
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
          rows={4}
          className={cx(TEXTAREA, "min-h-24")}
          placeholder={t("companyReview.decision.commentPlaceholder")}
        />
      </div>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {done ? <FormMessage kind="success">{done}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void act("approve")}
          className={buttonStyles.primary}
        >
          {pending === "approve" ? <Spinner /> : <Icon name="check" size={17} />}
          <span>{t("companyReview.decision.approve")}</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void act("changes")}
          className={buttonStyles.secondary}
        >
          {pending === "changes" ? <Spinner /> : <Icon name="edit" size={16} />}
          <span>{t("companyReview.decision.requestChanges")}</span>
        </button>
      </div>
      <p className="text-xs text-ink-3">{t("companyReview.decision.note")}</p>
    </div>
  );
}
