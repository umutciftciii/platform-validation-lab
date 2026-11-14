"use client";

import type { CmsPage, CmsPageResponse, CmsPreviewResponse } from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callCms } from "../../lib/cms-client";
import { FormMessage } from "../catalog/parts";
import { useNotice } from "../catalog/notices";
import { Icon } from "../icons";
import { buttonStyles, cx, Panel, Spinner, StatusPill } from "../ui";
import { publicationState } from "./parts";

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});

type Confirm = "publish" | "unpublish" | null;

/**
 * CMS S2 (DP-017): preview, publish, republish and unpublish (ADR-020 D6). Publishing copies the
 * saved draft into a new revision; unsaved changes must be saved first. Publish and unpublish
 * need `content:publish` on the site (the API decides; the buttons only follow it).
 */
export function PublicationPanel({
  page,
  version,
  dirty,
  canPublish,
  previewable,
}: {
  page: CmsPage;
  version: number;
  dirty: boolean;
  canPublish: boolean;
  previewable: boolean;
}) {
  const router = useRouter();
  const notify = useNotice();
  const [pending, setPending] = useState<"preview" | "publish" | "unpublish" | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const p = page.publication;
  const live = p?.status === "PUBLISHED";
  const upToDate = live && p.pageVersion === version;
  const state = publicationState({ version, publication: p });

  async function preview() {
    setPending("preview");
    setError(null);
    const res = await callCms<CmsPreviewResponse>(`/pages/${page.id}/preview`, {});
    setPending(null);
    if (!res.ok) return setError(res.message);
    setPreviewUrl(res.data.url);
    window.open(res.data.url, "_blank", "noopener,noreferrer");
  }

  async function run(action: "publish" | "unpublish") {
    setPending(action);
    setError(null);
    const res = await callCms<CmsPageResponse>(
      `/pages/${page.id}/${action}`,
      action === "publish" ? { version } : { publicationVersion: p?.version ?? 0 },
    );
    setPending(null);
    setConfirm(null);
    if (!res.ok) return setError(res.message);
    const msg =
      action === "publish"
        ? `Published as revision ${res.data.page.publication?.revisionNumber ?? ""}.`
        : "Unpublished. The page is no longer shown on the site.";
    if (notify) notify(msg);
    router.refresh();
  }

  return (
    <Panel id="publication" title="Publication">
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={state.tone}>{state.label}</StatusPill>
          {p ? <span className="text-ink-3">revision {p.revisionNumber}</span> : null}
        </div>
        {p ? (
          <p className="text-ink-3">
            {p.status === "PUBLISHED"
              ? `Published ${DATE.format(new Date(p.publishedAt))} by ${p.publishedBy.name}, from draft version ${p.pageVersion}.`
              : `Unpublished ${p.unpublishedAt ? DATE.format(new Date(p.unpublishedAt)) : ""} by ${p.unpublishedBy?.name ?? "staff"}. Publish again to show the current draft.`}
          </p>
        ) : (
          <p className="text-ink-3">Not on the site yet. The site shows nothing for this page.</p>
        )}
        {dirty ? (
          <p className="rounded-lg bg-amber-soft px-3 py-2 text-amber-ink">
            Save the draft first: preview and publishing use the saved version.
          </p>
        ) : null}
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}

        {previewable ? (
          <button
            type="button"
            onClick={preview}
            disabled={dirty || pending !== null}
            className={cx(buttonStyles.secondary, "w-full")}
          >
            {pending === "preview" ? <Spinner /> : <Icon name="eye" size={17} />}
            Preview draft
          </button>
        ) : (
          <p className="text-ink-3">
            Preview shows pages of the BV site; this site has no pages yet.
          </p>
        )}
        {previewUrl ? (
          <p className="text-xs text-ink-3">
            Opened in a new tab.{" "}
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-petrol-strong hover:underline"
            >
              Open the preview again
            </a>{" "}
            (valid for 15 minutes).
          </p>
        ) : null}

        {canPublish ? (
          confirm === "publish" ? (
            <ConfirmBox
              text={`Publish draft version ${version} to the live site?`}
              action="Publish now"
              pending={pending === "publish"}
              onConfirm={() => run("publish")}
              onCancel={() => setConfirm(null)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setConfirm("publish")}
              disabled={dirty || upToDate || pending !== null}
              className={cx(buttonStyles.primary, "w-full")}
            >
              <Icon name="publish" size={17} />
              {p ? "Publish changes" : "Publish"}
            </button>
          )
        ) : (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-ink-2">
            Publishing needs a publisher of this site (content:publish).
          </p>
        )}

        {canPublish && live ? (
          confirm === "unpublish" ? (
            <ConfirmBox
              text="Take this page off the site? Visitors see the page as unavailable until it is published again."
              action="Unpublish"
              danger
              pending={pending === "unpublish"}
              onConfirm={() => run("unpublish")}
              onCancel={() => setConfirm(null)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setConfirm("unpublish")}
              disabled={pending !== null}
              className={cx(buttonStyles.ghost, "w-full")}
            >
              Unpublish
            </button>
          )
        ) : null}
      </div>
    </Panel>
  );
}

export function ConfirmBox({
  text,
  action,
  danger = false,
  pending,
  onConfirm,
  onCancel,
}: {
  text: string;
  action: string;
  danger?: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label={action}
      className={cx(
        "space-y-2 rounded-lg p-3 ring-1 ring-inset",
        danger ? "bg-danger-soft ring-danger/25" : "bg-petrol-soft ring-petrol/25",
      )}
    >
      <p className={danger ? "text-danger" : "text-ink"}>{text}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={cx(buttonStyles.primary, "flex-1")}
        >
          {pending ? <Spinner /> : null}
          {action}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className={buttonStyles.secondary}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
