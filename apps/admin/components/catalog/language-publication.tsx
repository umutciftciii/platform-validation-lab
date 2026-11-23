"use client";

/**
 * ML-8b (ADR-028 D8, DP-257): the languages of one site's publication on the Publication tab.
 *
 * The default language is always published from its current texts. Each other language is
 * published from its current texts only when the publisher ticks it (complete languages only);
 * otherwise the live texts of that language stay as they are. A language without a reviewed
 * sensitive-claim word list needs a ticked manual check before Publish is possible (the API
 * refuses it otherwise). "Preview" shows one language as the next publication would carry it,
 * next to what is live — clearly labelled with the language, never mixed with another one.
 */
import {
  type PublicationPreviewResponse,
  type PublishedSnapshot,
  type SiteLanguagePublication,
} from "@dream/contracts";
import { useEffect, useId, useState } from "react";
import { getCatalog } from "../../lib/catalog-client";
import {
  languageOptions,
  localeLabel,
  localeShort,
  missingLabel,
  type LanguagePlanOption,
} from "../../lib/translations";
import { useT } from "../i18n/locale-provider";
import { Icon } from "../icons";
import { buttonStyles, cx, Spinner, StatusPill } from "../ui";
import { FormMessage } from "./parts";
import { TranslationStatePill } from "./translation-editor";

export function LanguageChoices({
  languages,
  chosen,
  checked,
  onChosen,
  onChecked,
  canPublish,
  productId,
  siteId,
}: {
  languages: readonly SiteLanguagePublication[];
  chosen: readonly string[];
  checked: readonly string[];
  onChosen: (next: string[]) => void;
  onChecked: (next: string[]) => void;
  canPublish: boolean;
  productId: string;
  siteId: string;
}) {
  const t = useT();
  const base = useId();
  const options = languageOptions(languages, t);
  const [preview, setPreview] = useState<string | null>(null);
  if (languages.length <= 1) return null;
  const toggle = (list: readonly string[], v: string, on: boolean) =>
    on ? [...new Set([...list, v])] : list.filter((x) => x !== v);
  return (
    <div
      className="space-y-2 rounded-lg bg-surface px-3 py-2.5 ring-1 ring-inset ring-line"
      data-languages=""
    >
      <p className="text-xs font-semibold text-ink">{t("catalog.workflow.languages.title")}</p>
      <ul className="space-y-2.5">
        {languages.map((l) => {
          const o: LanguagePlanOption | undefined = options.find((x) => x.locale === l.locale);
          const name = localeLabel(l.locale, t);
          const isChosen = chosen.includes(l.locale);
          const cid = `${base}-choose-${l.locale}`;
          const rid = `${base}-review-${l.locale}`;
          return (
            <li key={l.locale} className="space-y-1.5 text-xs" data-language={l.locale}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-ink-3">{localeShort(l.locale)}</span>
                <span className="font-medium text-ink">{name}</span>
                <TranslationStatePill state={l.state} />
                {l.public ? null : (
                  <StatusPill key="np" tone="neutral">
                    {t("catalog.workflow.languages.notPublic")}
                  </StatusPill>
                )}
                <button
                  type="button"
                  onClick={() => setPreview(preview === l.locale ? null : l.locale)}
                  aria-expanded={preview === l.locale}
                  className={cx(buttonStyles.ghost, "ml-auto h-8 px-2 text-xs")}
                  data-preview-language={l.locale}
                >
                  <Icon name="eye" size={13} />
                  <span key={String(preview === l.locale)}>
                    {preview === l.locale
                      ? t("catalog.workflow.languages.closePreview", { name })
                      : t("catalog.workflow.languages.preview", { name })}
                  </span>
                </button>
              </div>
              {l.isDefault ? (
                <p key="default" className="text-ink-3">
                  {t("catalog.workflow.languages.defaultLanguage")}
                </p>
              ) : (
                <div key="other" className="space-y-1.5">
                  {canPublish ? (
                    <label htmlFor={cid} className="flex items-start gap-2 text-ink-2">
                      <input
                        id={cid}
                        type="checkbox"
                        checked={isChosen}
                        disabled={!o?.selectable}
                        onChange={(e) => {
                          onChosen(toggle(chosen, l.locale, e.currentTarget.checked));
                          if (!e.currentTarget.checked) onChecked(toggle(checked, l.locale, false));
                        }}
                        className="mt-0.5 size-4 accent-petrol"
                      />
                      <span>{t("catalog.workflow.languages.publishWith", { name })}</span>
                    </label>
                  ) : null}
                  <p className="text-ink-3">
                    {isChosen
                      ? t("catalog.workflow.languages.chosen", { name })
                      : l.live
                        ? t("catalog.workflow.languages.keepLive", { name })
                        : t("catalog.workflow.languages.noneLive", { name })}
                  </p>
                  {o && o.blockers.length ? (
                    <div key="blockers" className="space-y-0.5">
                      <p className="font-medium text-danger">
                        {t("catalog.workflow.languages.needs", { name })}
                      </p>
                      <ul className="list-disc pl-5 text-ink-2">
                        {l.requiredMissing.map((u) => (
                          <li key={u}>{missingLabel(u, t)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {l.claims.length ? (
                    <p key="claims" className="flex items-start gap-1.5 text-amber-ink">
                      <Icon name="alert" size={13} className="mt-px shrink-0" />
                      <span>
                        {t("catalog.workflow.languages.claims", {
                          name,
                          claims: l.claims.map((c) => c.label).join(", "),
                        })}
                      </span>
                    </p>
                  ) : null}
                  {isChosen && o?.needsManualReview ? (
                    <label
                      key="manual"
                      htmlFor={rid}
                      className="flex items-start gap-2 rounded-md bg-amber-soft px-2 py-1.5 text-amber-ink ring-1 ring-inset ring-amber/30"
                      data-manual-review={l.locale}
                    >
                      <input
                        id={rid}
                        type="checkbox"
                        checked={checked.includes(l.locale)}
                        onChange={(e) =>
                          onChecked(toggle(checked, l.locale, e.currentTarget.checked))
                        }
                        className="mt-0.5 size-4 accent-petrol"
                      />
                      <span>{t("catalog.workflow.languages.manualCheck", { name })}</span>
                    </label>
                  ) : null}
                </div>
              )}
              {preview === l.locale ? (
                <LanguagePreview
                  key={`preview-${l.locale}-${l.state}-${l.live}`}
                  productId={productId}
                  siteId={siteId}
                  locale={l.locale}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SnapshotView({ s }: { s: PublishedSnapshot }) {
  const t = useT();
  return (
    <dl className="space-y-1.5 break-words">
      <div>
        <dt className="text-ink-3">{t("catalog.workflow.snapshot.name")}</dt>
        <dd className="text-ink">{s.name}</dd>
      </div>
      <div>
        <dt className="text-ink-3">{t("catalog.workflow.snapshot.summary")}</dt>
        <dd className="whitespace-pre-line text-ink-2">{s.summary ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-ink-3">{t("catalog.workflow.snapshot.description")}</dt>
        <dd className="line-clamp-6 whitespace-pre-line text-ink-2">{s.description ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-ink-3">{t("catalog.workflow.snapshot.category")}</dt>
        <dd className="text-ink-2">{s.category.name}</dd>
      </div>
      <div>
        <dt className="text-ink-3">{t("catalog.workflow.snapshot.specNames")}</dt>
        <dd className="text-ink-2">
          {s.specs.length ? s.specs.map((x) => x.name).join(" · ") : "—"}
        </dd>
      </div>
      <div>
        <dt className="text-ink-3">{t("catalog.workflow.snapshot.imageAlts")}</dt>
        <dd className="text-ink-2">
          {s.images
            .filter((i) => i.altText)
            .map((i) => i.altText)
            .join(" · ") || "—"}
        </dd>
      </div>
      <div>
        <dt className="text-ink-3">{t("catalog.workflow.snapshot.seo")}</dt>
        <dd className="text-ink-2">{`${s.seo?.title ?? "—"} / ${s.seo?.description ?? "—"}`}</dd>
      </div>
    </dl>
  );
}

function LanguagePreview({
  productId,
  siteId,
  locale,
}: {
  productId: string;
  siteId: string;
  locale: string;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ok"; data: PublicationPreviewResponse }
  >({ kind: "loading" });
  const t = useT();
  const name = localeLabel(locale, t);
  // Read once when opened (the panel remounts each time it is opened).
  useEffect(() => {
    let live = true;
    void getCatalog<PublicationPreviewResponse>(
      `/products/${productId}/sites/${siteId}/publication-preview?locale=${encodeURIComponent(locale)}`,
    ).then((r) => {
      if (live)
        setState(r.ok ? { kind: "ok", data: r.data } : { kind: "error", message: r.message });
    });
    return () => {
      live = false;
    };
  }, [productId, siteId, locale]);
  return (
    <section
      lang={locale}
      aria-label={t("catalog.workflow.languagePreview.aria", { name })}
      className="space-y-2 rounded-lg border border-line bg-surface-2/50 p-3"
      data-language-preview={locale}
    >
      <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
        <Icon name="eye" size={13} />
        <span>
          {t("catalog.workflow.languagePreview.title", { name, short: localeShort(locale) })}
        </span>
      </p>
      {state.kind === "loading" ? (
        <p key="loading" className="flex items-center gap-2 text-ink-3">
          <Spinner />
          <span>{t("catalog.workflow.languagePreview.loading")}</span>
        </p>
      ) : state.kind === "error" ? (
        <FormMessage key="error" kind="error">
          {state.message}
        </FormMessage>
      ) : (
        <div key="ok" className="space-y-2">
          {state.data.public ? null : (
            <p key="np" className="text-ink-3">
              {t("catalog.workflow.languagePreview.notPublic", { name })}
            </p>
          )}
          {state.data.claimScan === "MANUAL" ? (
            <p key="manual" className="text-amber-ink">
              {t("catalog.workflow.languagePreview.manual", { name })}
            </p>
          ) : null}
          {state.data.claims.length ? (
            <p key="claims" className="text-amber-ink">
              {t("catalog.workflow.languagePreview.found", {
                claims: state.data.claims.map((c) => c.label).join(", "),
              })}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="type-eyebrow text-ink-3">
                {t("catalog.workflow.languagePreview.next")}
              </p>
              {state.data.next ? (
                <SnapshotView key="next" s={state.data.next} />
              ) : (
                <div key="next-missing" className="text-ink-2">
                  <p>{t("catalog.workflow.languagePreview.notPublishable", { name })}</p>
                  <ul className="list-disc pl-5">
                    {state.data.requiredMissing.map((u) => (
                      <li key={u}>{missingLabel(u, t)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <p className="type-eyebrow text-ink-3">
                {t("catalog.workflow.languagePreview.live")}
              </p>
              {state.data.live ? (
                <SnapshotView key="live" s={state.data.live} />
              ) : (
                <p key="live-none" className="text-ink-3">
                  {t("catalog.workflow.languagePreview.nothingLive", { name })}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
