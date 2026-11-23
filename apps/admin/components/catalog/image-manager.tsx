"use client";

import {
  ALT_TEXT_MAX,
  CATALOG_API,
  ErrorBodySchema,
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  IMAGE_MIN_HEIGHT,
  IMAGE_MIN_WIDTH,
  UPLOAD_FILENAME_HEADER,
  type ProductImage,
} from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { callCatalog } from "../../lib/catalog-client";
import { formatBytes } from "../../lib/catalog-view";
import { createTranslator } from "../../lib/i18n/translate";
import type { Translate } from "../../lib/i18n/types";
import { useAdminLocale, useT } from "../i18n/locale-provider";
import { Icon } from "../icons";
import { buttonStyles, cx, EmptyState, Spinner, StatusPill } from "../ui";
import { FIELD } from "./parts";
import { useNotice } from "./notices";

interface Upload {
  id: number;
  name: string;
  size: number;
  progress: number; // 0..1
  state: "queued" | "uploading" | "done" | "failed";
  error?: string;
}

/** English, for callers without a console language (tests). */
const EN: Translate = createTranslator("en");

/** API rule codes with their own wording (catalog.media.images.uploadRules). */
const UPLOAD_RULES = [
  "unsupported_type",
  "type_mismatch",
  "too_many_pixels",
  "corrupt",
  "too_many_images",
  "archived",
] as const;
type UploadRule = (typeof UPLOAD_RULES)[number];

/** The wording of one API rule code, or undefined for a code without its own text. */
function ruleMessage(rule: string, t: Translate): string | undefined {
  if (rule === "too_small") {
    return t("catalog.media.images.tooSmall", { width: IMAGE_MIN_WIDTH, height: IMAGE_MIN_HEIGHT });
  }
  if (rule === "empty") return t("catalog.media.upload.empty");
  if ((UPLOAD_RULES as readonly string[]).includes(rule)) {
    return t(`catalog.media.images.uploadRules.${rule as UploadRule}`);
  }
  return undefined;
}

/** Message for a failed upload answer (status + error body). */
export function uploadMessage(status: number, body: unknown, t: Translate = EN): string {
  if (status === 413) return t("catalog.media.images.tooLarge");
  if (status === 0) return t("catalog.media.upload.interrupted");
  const parsed = ErrorBodySchema.safeParse(body);
  if (!parsed.success) return t("catalog.media.upload.failed");
  for (const d of parsed.data.error.details) {
    const message = typeof d === "object" ? ruleMessage(d.rule, t) : undefined;
    if (message) return message;
  }
  return t(`errors.${parsed.data.error.code}`);
}

/** Checks the browser can make before uploading (the API checks the real content again). */
export function precheck(file: { type: string; size: number }, t: Translate = EN): string | null {
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type))
    return t("catalog.media.images.uploadRules.unsupported_type");
  if (file.size === 0) return t("catalog.media.upload.empty");
  if (file.size > IMAGE_MAX_BYTES) return t("catalog.media.images.tooLarge");
  return null;
}

const src = (id: string, variant: "thumb" | "display" | "original") =>
  `${CATALOG_API}/images/${id}/${variant}`;

/** Moves one id of a list one step (keyboard reordering). */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return [...list];
  const out = [...list];
  [out[index], out[target]] = [out[target] as T, out[index] as T];
  return out;
}

export function ImageManager({
  productId,
  initial,
  canEdit,
  archived,
}: {
  productId: string;
  initial: readonly ProductImage[];
  canEdit: boolean;
  archived: boolean;
}) {
  const router = useRouter();
  const notify = useNotice();
  const t = useT();
  const locale = useAdminLocale();
  const [images, setImages] = useState<ProductImage[]>([...initial]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const editable = canEdit && !archived;
  const cover = images.find((i) => i.isCover) ?? null;

  function patchUpload(id: number, patch: Partial<Upload>) {
    setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }

  function sendOne(file: File, id: number): Promise<ProductImage | null> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/catalog-upload/${productId}`);
      // i18n-ignore: HTTP header name
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.setRequestHeader(UPLOAD_FILENAME_HEADER, encodeURIComponent(file.name).slice(0, 1024));
      // i18n-ignore: HTTP header name
      xhr.setRequestHeader("Accept", "application/json");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) patchUpload(id, { progress: e.loaded / e.total });
      };
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = null;
        }
        if (xhr.status === 201) {
          patchUpload(id, { state: "done", progress: 1 });
          resolve((body as { image: ProductImage }).image);
        } else {
          patchUpload(id, { state: "failed", error: uploadMessage(xhr.status, body, t) });
          resolve(null);
        }
      };
      xhr.onerror = () => {
        patchUpload(id, { state: "failed", error: uploadMessage(0, null, t) });
        resolve(null);
      };
      patchUpload(id, { state: "uploading" });
      xhr.send(file);
    });
  }

  async function addFiles(files: FileList | File[]) {
    if (!editable) return;
    const queue: Array<{ file: File; id: number }> = [];
    const fresh: Upload[] = [];
    for (const file of Array.from(files)) {
      const id = ++seq.current;
      const problem = precheck(file, t);
      fresh.push({
        id,
        name: file.name,
        size: file.size,
        progress: 0,
        state: problem ? "failed" : "queued",
        ...(problem ? { error: problem } : {}),
      });
      if (!problem) queue.push({ file, id });
    }
    setUploads((list) => [
      ...list.filter((u) => u.state === "uploading" || u.state === "queued"),
      ...fresh,
    ]);
    let added = 0;
    for (const { file, id } of queue) {
      const image = await sendOne(file, id);
      if (image) {
        added++;
        setImages((list) => [...list, image]);
      }
    }
    if (added) {
      notify?.(t("catalog.media.images.notices.uploaded", { count: added }));
      router.refresh();
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
  }

  async function act<T>(
    key: string,
    run: () => Promise<{ ok: true; data: T } | { ok: false; message: string }>,
    done: (data: T) => void,
    message: string,
  ) {
    setBusy(key);
    const r = await run();
    setBusy(null);
    if (!r.ok) {
      notify?.(r.message, "error");
      router.refresh();
      return;
    }
    done(r.data);
    notify?.(message);
    router.refresh();
  }

  const setCover = (img: ProductImage) =>
    act(
      img.id,
      () =>
        callCatalog<{ items: ProductImage[] }>("POST", `/images/${img.id}/cover`, {
          version: img.version,
        }),
      (d) => setImages(d.items),
      t("catalog.media.images.notices.coverChanged"),
    );

  // DP-166: hide from (or show again on) the sites; the image stays here, nothing is deleted.
  const setVisibility = (img: ProductImage, isPublic: boolean) =>
    act(
      img.id,
      () =>
        callCatalog<{ items: ProductImage[] }>("POST", `/images/${img.id}/visibility`, {
          isPublic,
          version: img.version,
        }),
      (d) => setImages(d.items),
      isPublic
        ? t("catalog.media.images.notices.shownAgain")
        : t("catalog.media.images.notices.hidden"),
    );

  const remove = (img: ProductImage) => {
    if (!window.confirm(t("catalog.media.images.removeConfirm", { name: img.originalFilename })))
      return;
    void act(
      img.id,
      () => callCatalog<undefined>("DELETE", `/images/${img.id}`),
      () => setImages((list) => list.filter((i) => i.id !== img.id)),
      t("catalog.media.images.notices.removed"),
    );
  };

  const saveOrder = (next: ProductImage[]) => {
    setImages(next);
    void act(
      "order",
      () =>
        callCatalog<{ items: ProductImage[] }>("POST", `/products/${productId}/images/order`, {
          imageIds: next.map((i) => i.id),
        }),
      (d) => setImages(d.items),
      t("catalog.media.images.notices.orderSaved"),
    );
  };

  function saveAlt(e: FormEvent<HTMLFormElement>, img: ProductImage) {
    e.preventDefault();
    const altText = String(new FormData(e.currentTarget).get("altText") ?? "");
    void act(
      img.id,
      () =>
        callCatalog<{ image: ProductImage }>("POST", `/images/${img.id}`, {
          altText,
          version: img.version,
        }),
      (d) => setImages((list) => list.map((i) => (i.id === img.id ? d.image : i))),
      t("catalog.media.images.notices.altSaved"),
    );
  }

  function onCardDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = images.findIndex((i) => i.id === dragId);
    const to = images.findIndex((i) => i.id === targetId);
    const next = [...images];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved as ProductImage);
    setDragId(null);
    saveOrder(next);
  }

  return (
    <div className="space-y-5">
      {cover ? (
        <figure className="overflow-hidden rounded-xl border border-line bg-surface-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- private, session-bound bytes */}
          <img
            src={src(cover.id, "display")}
            alt={cover.altText ?? ""}
            className="mx-auto max-h-80 w-auto max-w-full object-contain"
          />
          <figcaption className="flex flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-2 text-xs text-ink-3">
            <StatusPill tone="petrol">{t("catalog.media.images.cover")}</StatusPill>
            <span className="min-w-0 truncate">{cover.originalFilename}</span>
          </figcaption>
        </figure>
      ) : null}

      {editable ? (
        <div
          onDragOver={(e) => {
            if (dragId) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cx(
            "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors",
            dragOver ? "border-petrol bg-petrol-soft" : "border-line-strong bg-surface-2/50",
          )}
        >
          <Icon name="upload" size={24} className="text-ink-3" />
          <p className="text-sm text-ink-2">
            {t("catalog.media.images.dropBefore")}
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="font-medium text-petrol-strong underline-offset-2 hover:underline"
            >
              {t("catalog.media.images.chooseFiles")}
            </button>
          </p>
          <p className="text-xs text-ink-3">
            {t("catalog.media.images.rules", { width: IMAGE_MIN_WIDTH, height: IMAGE_MIN_HEIGHT })}
          </p>
          <input
            ref={input}
            type="file"
            multiple
            accept={IMAGE_MIME_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-label={t("catalog.media.images.inputLabel")}
            onChange={(e) => {
              if (e.currentTarget.files?.length) void addFiles(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />
        </div>
      ) : null}

      {uploads.length ? (
        <ul className="space-y-2" aria-label={t("catalog.media.images.uploadsLabel")}>
          {uploads.map((u) => (
            <li key={u.id} className="rounded-lg border border-line px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-ink">{u.name}</span>
                <span className="tabular shrink-0 text-xs text-ink-3">
                  {formatBytes(u.size, locale)}
                </span>
              </div>
              {u.state === "failed" ? (
                <p role="alert" className="mt-1 flex items-center gap-1.5 text-xs text-danger">
                  <Icon name="alert" size={13} />
                  {u.error}
                </p>
              ) : (
                <div
                  role="progressbar"
                  aria-label={t("catalog.media.images.uploadingLabel", { name: u.name })}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(u.progress * 100)}
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"
                >
                  <div
                    className={cx(
                      "h-full rounded-full transition-[width]",
                      u.state === "done" ? "bg-success" : "bg-petrol",
                    )}
                    style={{ width: `${Math.round(u.progress * 100)}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {images.length === 0 ? (
        <EmptyState icon="image" title={t("catalog.media.images.emptyTitle")}>
          {editable
            ? t("catalog.media.images.emptyEditable")
            : t("catalog.media.images.emptyReadOnly")}
        </EmptyState>
      ) : (
        <ol
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          aria-label={t("catalog.media.images.galleryLabel")}
        >
          {images.map((img, index) => (
            <li
              key={img.id}
              draggable={editable}
              onDragStart={() => setDragId(img.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (dragId) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                onCardDrop(img.id);
              }}
              className={cx(
                "overflow-hidden rounded-xl border bg-surface transition-shadow",
                img.isCover ? "border-petrol ring-2 ring-petrol/20" : "border-line",
                dragId === img.id && "opacity-50",
                !img.isPublic && "border-dashed",
              )}
            >
              <div className="relative aspect-[4/3] bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- private, session-bound bytes */}
                <img
                  src={src(img.id, "thumb")}
                  alt={img.altText ?? ""}
                  loading="lazy"
                  className={cx("size-full object-contain", !img.isPublic && "opacity-45")}
                />
                <span className="absolute left-2 top-2 flex gap-1">
                  <span className="tabular rounded-md bg-surface/90 px-1.5 py-0.5 text-xs font-medium text-ink ring-1 ring-line">
                    {index + 1}
                  </span>
                  {img.isCover ? (
                    <StatusPill tone="petrol">{t("catalog.media.images.cover")}</StatusPill>
                  ) : null}
                  {!img.isPublic ? (
                    <StatusPill tone="neutral">
                      {t("catalog.media.images.hiddenFromSite")}
                    </StatusPill>
                  ) : null}
                </span>
                {editable ? (
                  <Icon
                    name="grip"
                    size={18}
                    className="absolute right-2 top-2 cursor-grab text-ink-3"
                    aria-hidden="true"
                  />
                ) : null}
              </div>
              <div className="space-y-2 p-3">
                <p className="truncate text-sm font-medium text-ink" title={img.originalFilename}>
                  {img.originalFilename}
                </p>
                <p className="tabular text-xs text-ink-3">
                  {img.width}×{img.height} · {formatBytes(img.byteSize, locale)} ·{" "}
                  {img.mimeType.replace("image/", "").toUpperCase()}
                </p>
                <form onSubmit={(e) => saveAlt(e, img)} className="flex gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">
                      {t("catalog.media.images.altLabel", { number: index + 1 })}
                    </span>
                    <input
                      name="altText"
                      defaultValue={img.altText ?? ""}
                      maxLength={ALT_TEXT_MAX}
                      readOnly={!editable}
                      placeholder={
                        editable
                          ? t("catalog.media.images.altPlaceholder")
                          : t("catalog.media.images.altPlaceholderReadOnly")
                      }
                      aria-invalid={!img.altText || undefined}
                      className={cx(FIELD, "h-9 text-sm")}
                    />
                  </label>
                  {editable ? (
                    <button
                      type="submit"
                      disabled={busy !== null}
                      className={cx(buttonStyles.secondary, "h-9 px-3")}
                    >
                      {t("catalog.media.images.save")}
                      <span className="sr-only">
                        {t("catalog.media.images.saveSr", { number: index + 1 })}
                      </span>
                    </button>
                  ) : null}
                </form>
                {!img.altText ? (
                  <p className="flex items-center gap-1.5 text-xs text-amber-ink">
                    <Icon name="alert" size={13} />
                    {t("catalog.media.images.altMissing")}
                  </p>
                ) : null}
                {editable ? (
                  <div className="flex flex-wrap items-center gap-1">
                    {busy === img.id ? <Spinner /> : null}
                    {!img.isCover && img.isPublic ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => setCover(img)}
                        className={buttonStyles.ghost}
                      >
                        <Icon name="star" size={16} />
                        {t("catalog.media.images.makeCover")}
                        <span className="sr-only">
                          {t("catalog.media.images.imageSr", { number: index + 1 })}
                        </span>
                      </button>
                    ) : null}
                    {!img.isCover ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => setVisibility(img, !img.isPublic)}
                        className={buttonStyles.ghost}
                      >
                        <Icon name="eye" size={16} />
                        {img.isPublic
                          ? t("catalog.media.images.hide")
                          : t("catalog.media.images.show")}
                        <span className="sr-only">
                          {t("catalog.media.images.imageSr", { number: index + 1 })}
                        </span>
                      </button>
                    ) : null}
                    <span className="ml-auto flex">
                      <button
                        type="button"
                        disabled={busy !== null || index === 0}
                        onClick={() => saveOrder(moveItem(images, index, -1))}
                        className={buttonStyles.icon}
                      >
                        <Icon name="back" size={16} />
                        <span className="sr-only">
                          {t("catalog.media.images.moveEarlier", { number: index + 1 })}
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null || index === images.length - 1}
                        onClick={() => saveOrder(moveItem(images, index, 1))}
                        className={buttonStyles.icon}
                      >
                        <Icon name="chevron" size={16} />
                        <span className="sr-only">
                          {t("catalog.media.images.moveLater", { number: index + 1 })}
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => remove(img)}
                        className={cx(buttonStyles.icon, "hover:text-danger")}
                      >
                        <Icon name="trash" size={16} />
                        <span className="sr-only">
                          {t("catalog.media.images.remove", { number: index + 1 })}
                        </span>
                      </button>
                    </span>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      {!editable && canEdit && archived ? (
        <p className="text-sm text-ink-3">{t("catalog.media.images.productArchived")}</p>
      ) : null}
    </div>
  );
}
