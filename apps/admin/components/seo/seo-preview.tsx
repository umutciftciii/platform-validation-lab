"use client";

import { seoLengthText } from "../../lib/catalog-issues";
import { displayUrl, type SeoView } from "../../lib/seo-view";
import { useT } from "../i18n/locale-provider";
import { Icon } from "../icons";
import { cx } from "../ui";

/**
 * ML-12a: a client component (its texts follow the console language via useT); every prop is
 * plain data, so the SEO overview (a server page) still renders it.
 *
 * DP-209: how a page may look in a search result and in a link preview, from the values the
 * editor is typing (the BV site's fallbacks applied, lib/seo-view.ts). An approximation: search
 * engines decide themselves how much they show. Length notes are warnings only.
 */
export function SeoPreview({
  view,
  siteName,
  imageSrc,
  noindex,
  className,
}: {
  view: SeoView;
  siteName: string;
  /** The OG image as the browser can load it; null shows a placeholder. */
  imageSrc: string | null;
  noindex: boolean;
  className?: string;
}) {
  const t = useT();
  const { host, origin, crumbs } = displayUrl(view.canonical.url, view.canonical.path);
  return (
    <div className={cx("space-y-4", className)}>
      <section aria-label={t("catalog.detail.seoPreview.searchAria")} className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {t("catalog.detail.seoPreview.search")}
        </p>
        <div className="rounded-xl border border-line bg-white p-4 text-left shadow-sm">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[#f1f3f4] text-[11px] font-semibold text-[#4d5156]">
              {siteName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[13px] text-[#202124]">{siteName}</span>
              <span className="block truncate text-[12px] text-[#4d5156]">
                {crumbs ? `${origin} › ${crumbs}` : origin}
              </span>
            </span>
          </div>
          <p className="mt-2 line-clamp-1 break-words text-[18px] leading-snug text-[#1a0dab] sm:text-[20px]">
            {view.title}
          </p>
          <p className="mt-1 line-clamp-2 break-words text-[13px] leading-[1.58] text-[#4d5156] sm:text-[14px]">
            {view.description ?? t("catalog.detail.seoPreview.noDescription")}
          </p>
        </div>
        {noindex ? (
          <p className="flex items-start gap-2 text-xs text-amber-ink">
            <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
            <span>{t("catalog.detail.seoPreview.noindex")}</span>
          </p>
        ) : null}
      </section>

      <section aria-label={t("catalog.detail.seoPreview.link")} className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {t("catalog.detail.seoPreview.link")}
        </p>
        <div className="overflow-hidden rounded-xl border border-line bg-white text-left shadow-sm">
          <div className="relative aspect-[1.91/1] w-full bg-[#e9ecef]">
            {imageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- a preview of a remote site image
              <img
                key="og-image"
                src={imageSrc}
                alt=""
                className="absolute inset-0 size-full object-cover"
              />
            ) : (
              <span
                key="og-placeholder"
                className="absolute inset-0 flex items-center justify-center text-xs text-[#6b7280]"
              >
                {t("catalog.detail.seoPreview.imagePlaceholder")}
              </span>
            )}
          </div>
          <div className="space-y-0.5 border-t border-[#dadde1] bg-[#f2f3f5] px-3 py-2">
            <p className="truncate text-[11px] uppercase text-[#606770]">{host}</p>
            <p className="line-clamp-2 break-words text-[15px] font-semibold leading-snug text-[#1d2129]">
              {view.ogTitle}
            </p>
            <p className="line-clamp-1 break-words text-[13px] text-[#606770]">
              {view.ogDescription ?? ""}
            </p>
          </div>
        </div>
      </section>

      <section aria-label={t("catalog.detail.seoPreview.canonicalAria")} className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {t("catalog.detail.seoPreview.canonical")}
        </p>
        <p className="break-all font-mono text-xs text-ink-2">
          {view.canonical.url ??
            t("catalog.detail.seoPreview.noPublicAddress", { path: view.canonical.path })}
        </p>
        <p className="text-xs text-ink-3">
          {view.canonical.invalid
            ? t("catalog.detail.seoPreview.canonicalInvalid")
            : view.canonical.override
              ? t("catalog.detail.seoPreview.canonicalOverride")
              : t("catalog.detail.seoPreview.canonicalOwn")}
        </p>
      </section>

      {view.warnings.length ? (
        <ul aria-label={t("catalog.detail.seoPreview.lengthNotes")} className="space-y-1">
          {view.warnings.map((w) => (
            <li key={w.field} className="flex items-start gap-2 text-xs text-amber-ink">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
              <span>{`${t(`catalog.detail.seoPreview.fields.${w.field}`)}: ${seoLengthText(w.text, t)}`}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
