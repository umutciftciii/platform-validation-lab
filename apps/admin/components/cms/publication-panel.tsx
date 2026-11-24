"use client";

import type { CmsPage, CmsPageResponse, CmsPreviewResponse } from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callCms } from "../../lib/cms-client";
import { ADMIN_TIME_ZONE } from "../../lib/i18n/config";
import { dateTimeFormat } from "../../lib/i18n/format";
import { useAdminLocale, useT } from "../i18n/locale-provider";
import { FormMessage } from "../catalog/parts";
import { useNotice } from "../catalog/notices";
import { ConfirmDialog } from "../dialog";
import { Icon } from "../icons";
import { buttonStyles, cx, Panel, Spinner, StatusPill } from "../ui";
import { publicationState } from "./parts";

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
};

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
  const t = useT();
  const locale = useAdminLocale();
  const DATE = dateTimeFormat(locale, DATE_OPTIONS);
  const router = useRouter();
  const notify = useNotice();
  const [pending, setPending] = useState<"preview" | "publish" | "unpublish" | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const p = page.publication;
  const live = p?.status === "PUBLISHED";
  const upToDate = live && p.pageVersion === version;
  const state = publicationState({ version, publication: p }, t);

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
        ? t("content.editor.publication.notice.published", {
            n: res.data.page.publication?.revisionNumber ?? "",
          })
        : t("content.editor.publication.notice.unpublished");
    if (notify) notify(msg);
    router.refresh();
  }

  return (
    <Panel id="publication" title={t("content.editor.publication.title")}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={state.tone}>{state.label}</StatusPill>
          {p ? (
            <span className="text-ink-3">
              {t("content.editor.publication.revision", { n: p.revisionNumber })}
            </span>
          ) : null}
        </div>
        {p ? (
          <p className="text-ink-3">
            {p.status === "PUBLISHED"
              ? t("content.editor.publication.published", {
                  date: DATE.format(new Date(p.publishedAt)),
                  name: p.publishedBy.name,
                  version: p.pageVersion,
                })
              : t("content.editor.publication.unpublished", {
                  date: p.unpublishedAt ? DATE.format(new Date(p.unpublishedAt)) : "",
                  name:
                    p.unpublishedBy?.name ?? t("content.editor.publication.unpublishedByFallback"),
                })}
          </p>
        ) : (
          <p className="text-ink-3">{t("content.editor.publication.notOnSite")}</p>
        )}
        {dirty ? (
          <p className="rounded-lg bg-amber-soft px-3 py-2 text-amber-ink">
            {t("content.editor.publication.saveFirst")}
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
            <span>{t("content.editor.publication.preview")}</span>
          </button>
        ) : (
          <p className="text-ink-3">{t("content.editor.publication.previewUnavailable")}</p>
        )}
        {previewUrl ? (
          <p className="text-xs text-ink-3">
            {t("content.editor.publication.previewOpened.before")}
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-petrol-strong hover:underline"
            >
              {t("content.editor.publication.previewOpened.link")}
            </a>
            {t("content.editor.publication.previewOpened.after")}
          </p>
        ) : null}

        {canPublish ? (
          <>
            <button
              type="button"
              onClick={() => setConfirm("publish")}
              disabled={dirty || upToDate || pending !== null}
              aria-haspopup="dialog"
              className={cx(buttonStyles.primary, "w-full")}
            >
              <Icon name="publish" size={17} />
              {p
                ? t("content.editor.publication.publishChanges")
                : t("content.editor.publication.publish")}
            </button>
            {confirm === "publish" ? (
              <ConfirmBox
                text={t("content.editor.publication.confirmPublish", { version })}
                action={t("content.editor.publication.publishNow")}
                pending={pending === "publish"}
                onConfirm={() => run("publish")}
                onCancel={() => setConfirm(null)}
              />
            ) : null}
          </>
        ) : (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-ink-2">
            {t("content.editor.publication.needsPublisher")}
          </p>
        )}

        {canPublish && live ? (
          <>
            <button
              type="button"
              onClick={() => setConfirm("unpublish")}
              disabled={pending !== null}
              aria-haspopup="dialog"
              className={cx(buttonStyles.ghost, "w-full")}
            >
              {t("content.editor.publication.unpublish")}
            </button>
            {confirm === "unpublish" ? (
              <ConfirmBox
                text={t("content.editor.publication.confirmUnpublish")}
                action={t("content.editor.publication.unpublish")}
                danger
                pending={pending === "unpublish"}
                onConfirm={() => run("unpublish")}
                onCancel={() => setConfirm(null)}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * A confirmation of a publication action (publish, unpublish, restore; also the redirect delete).
 * DP-268: opens as the console's modal dialog (components/dialog.tsx) with the same texts; the
 * button that opened it stays on the page and gets focus back when it closes.
 */
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
  const t = useT();
  return (
    <ConfirmDialog
      title={action}
      text={text}
      confirmLabel={action}
      cancelLabel={t("content.editor.publication.cancel")}
      danger={danger}
      pending={pending}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
