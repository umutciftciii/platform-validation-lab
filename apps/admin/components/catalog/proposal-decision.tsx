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
import { Icon } from "../icons";
import { buttonStyles, cx, Spinner } from "../ui";
import { FormMessage, TEXTAREA } from "./parts";

const BLOCKED: Readonly<Record<string, string>> = {
  no_permission: "Your role can read this proposal but cannot decide on it.",
  not_in_review:
    "There is nothing to decide right now: the proposal is not waiting for review. It returns to review when the editor revises it.",
  own_change: "You wrote this revision, so another reviewer must decide (separation of duties).",
};

/** The reason a request for changes is refused before it is sent, or null. */
export function changeRequestProblem(comment: string): string | null {
  const t = comment.trim();
  if (t.length < 3) return "Explain what has to change (at least 3 characters).";
  if (t.length > REVIEW_COMMENT_MAX)
    return `Keep the explanation under ${REVIEW_COMMENT_MAX} characters.`;
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
  const commentId = useId();
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState<"approve" | "changes" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!canDecide) {
    return (
      <p className="flex items-start gap-2 text-sm text-ink-2">
        <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-petrol-strong" />
        {(decisionBlocked && BLOCKED[decisionBlocked]) ?? "You cannot decide on this proposal."}
      </p>
    );
  }

  async function act(kind: "approve" | "changes") {
    setError(null);
    setDone(null);
    if (kind === "changes") {
      const problem = changeRequestProblem(comment);
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
    setDone(kind === "approve" ? "Proposal approved." : "Changes requested.");
    setComment("");
    router.refresh();
  }

  const busy = pending !== null;
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={commentId} className="mb-1.5 block text-sm font-medium text-ink">
          Comment
          <span className="ml-1 font-normal text-ink-3">
            (required to request changes, optional to approve)
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
          placeholder="What has to change, or answers to the questions below…"
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
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void act("changes")}
          className={buttonStyles.secondary}
        >
          {pending === "changes" ? <Spinner /> : <Icon name="edit" size={16} />}
          Request changes
        </button>
      </div>
      <p className="text-xs text-ink-3">
        Approving accepts the proposed text for this product. It does not publish the product and is
        not a technical approval of its data.
      </p>
    </div>
  );
}
