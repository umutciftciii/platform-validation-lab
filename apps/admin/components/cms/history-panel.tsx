"use client";

import type { CmsHistoryResponse, CmsPageResponse, CmsRestoreRequest } from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callCms } from "../../lib/cms-client";
import { FormMessage } from "../catalog/parts";
import { useNotice } from "../catalog/notices";
import { Panel, StatusPill } from "../ui";
import { ConfirmBox } from "./publication-panel";

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});

/**
 * DP-020: the publication history of a page (one immutable revision per publication, newest
 * first) and restoring a revision into the draft. A restore is a normal draft save (content:edit,
 * audited); it publishes nothing. Unsaved changes must be saved first.
 */
export function HistoryPanel({
  pageId,
  version,
  dirty,
  canEdit,
  history,
}: {
  pageId: string;
  version: number;
  dirty: boolean;
  canEdit: boolean;
  history: CmsHistoryResponse | null;
}) {
  const router = useRouter();
  const notify = useNotice();
  const [confirm, setConfirm] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore(revisionNumber: number) {
    setPending(true);
    setError(null);
    const body: CmsRestoreRequest = { version, revisionNumber };
    const res = await callCms<CmsPageResponse>(`/pages/${pageId}/restore`, body);
    setPending(false);
    setConfirm(null);
    if (!res.ok) return setError(res.message);
    if (notify) notify(`Revision ${revisionNumber} restored into the draft. Publish to show it.`);
    router.refresh();
  }

  const revisions = history?.revisions ?? [];
  return (
    <Panel
      id="history"
      title="Publication history"
      description="Every publication is kept as a revision."
    >
      <div className="space-y-3 text-sm">
        {!history ? (
          <p className="text-ink-3">The history could not be loaded. Try again in a moment.</p>
        ) : revisions.length === 0 ? (
          <p className="text-ink-3">Not published yet. Each publication adds a revision here.</p>
        ) : (
          <ol className="divide-y divide-line" aria-label="Revisions, newest first">
            {revisions.map((r) => (
              <li key={r.revisionNumber} className="space-y-1.5 py-2.5 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">Revision {r.revisionNumber}</span>
                  {r.live ? <StatusPill tone="success">Live</StatusPill> : null}
                </div>
                <p className="text-ink-3">
                  {DATE.format(new Date(r.publishedAt))} by {r.publishedBy.name} · draft version{" "}
                  {r.pageVersion}
                </p>
                <p className="truncate text-ink-2" title={r.title}>
                  {r.title}
                  {r.path ? (
                    <span className="ml-1 font-mono text-xs text-ink-3">{r.path}</span>
                  ) : null}
                </p>
                {canEdit ? (
                  confirm === r.revisionNumber ? (
                    <ConfirmBox
                      text={`Replace the current draft with revision ${r.revisionNumber}? The site does not change until you publish.`}
                      action="Restore into draft"
                      pending={pending}
                      onConfirm={() => restore(r.revisionNumber)}
                      onCancel={() => setConfirm(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirm(r.revisionNumber)}
                      disabled={dirty || pending}
                      className="text-sm font-medium text-petrol-strong hover:underline disabled:cursor-not-allowed disabled:text-ink-3 disabled:no-underline"
                    >
                      Restore into draft
                    </button>
                  )
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {dirty && revisions.length ? (
          <p className="text-xs text-ink-3">Save the draft before restoring a revision.</p>
        ) : null}
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      </div>
    </Panel>
  );
}
