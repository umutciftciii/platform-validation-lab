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
  const base = useId();
  const options = languageOptions(languages);
  const [preview, setPreview] = useState<string | null>(null);
  if (languages.length <= 1) return null;
  const toggle = (list: readonly string[], v: string, on: boolean) =>
    on ? [...new Set([...list, v])] : list.filter((x) => x !== v);
  return (
    <div
      className="space-y-2 rounded-lg bg-surface px-3 py-2.5 ring-1 ring-inset ring-line"
      data-languages=""
    >
      <p className="text-xs font-semibold text-ink">Languages</p>
      <ul className="space-y-2.5">
        {languages.map((l) => {
          const o: LanguagePlanOption | undefined = options.find((x) => x.locale === l.locale);
          const name = localeLabel(l.locale);
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
                    Not public yet
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
                    {preview === l.locale ? `Close ${name} preview` : `Preview ${name}`}
                  </span>
                </button>
              </div>
              {l.isDefault ? (
                <p key="default" className="text-ink-3">
                  Always published from the current texts (the default language).
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
                      <span>{`Publish the current ${name} texts with this publication`}</span>
                    </label>
                  ) : null}
                  <p className="text-ink-3">
                    {isChosen
                      ? `The ${name} texts saved now are published.`
                      : l.live
                        ? `Not chosen: the live ${name} texts stay exactly as published.`
                        : `Not chosen: no ${name} texts are published.`}
                  </p>
                  {o && o.blockers.length ? (
                    <div key="blockers" className="space-y-0.5">
                      <p className="font-medium text-danger">{`${name} needs before publishing:`}</p>
                      <ul className="list-disc pl-5 text-ink-2">
                        {l.requiredMissing.map((u) => (
                          <li key={u}>{missingLabel(u)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {l.claims.length ? (
                    <p key="claims" className="flex items-start gap-1.5 text-amber-ink">
                      <Icon name="alert" size={13} className="mt-px shrink-0" />
                      <span>
                        {`The ${name} text mentions ${l.claims.map((c) => c.label).join(", ")}: publish it only with a certificate or source document.`}
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
                      <span>
                        {`I checked the ${name} text by hand for claims that need a certificate or source document (SAF, pharmaceutical, food contact, CTL, approvals, environmental claims). The automatic check knows English words only.`}
                      </span>
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
  return (
    <dl className="space-y-1.5 break-words">
      <div>
        <dt className="text-ink-3">Name</dt>
        <dd className="text-ink">{s.name}</dd>
      </div>
      <div>
        <dt className="text-ink-3">Summary</dt>
        <dd className="whitespace-pre-line text-ink-2">{s.summary ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-ink-3">Description</dt>
        <dd className="line-clamp-6 whitespace-pre-line text-ink-2">{s.description ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-ink-3">Category</dt>
        <dd className="text-ink-2">{s.category.name}</dd>
      </div>
      <div>
        <dt className="text-ink-3">Specification names</dt>
        <dd className="text-ink-2">
          {s.specs.length ? s.specs.map((x) => x.name).join(" · ") : "—"}
        </dd>
      </div>
      <div>
        <dt className="text-ink-3">Image alt texts</dt>
        <dd className="text-ink-2">
          {s.images
            .filter((i) => i.altText)
            .map((i) => i.altText)
            .join(" · ") || "—"}
        </dd>
      </div>
      <div>
        <dt className="text-ink-3">SEO title / description</dt>
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
  const name = localeLabel(locale);
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
      aria-label={`${name} preview`}
      className="space-y-2 rounded-lg border border-line bg-surface-2/50 p-3"
      data-language-preview={locale}
    >
      <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
        <Icon name="eye" size={13} />
        <span>{`Preview · ${name} (${localeShort(locale)})`}</span>
      </p>
      {state.kind === "loading" ? (
        <p key="loading" className="flex items-center gap-2 text-ink-3">
          <Spinner />
          <span>Loading…</span>
        </p>
      ) : state.kind === "error" ? (
        <FormMessage key="error" kind="error">
          {state.message}
        </FormMessage>
      ) : (
        <div key="ok" className="space-y-2">
          {state.data.public ? null : (
            <p key="np" className="text-ink-3">
              {`${name} is not public: visitors cannot open these pages yet.`}
            </p>
          )}
          {state.data.claimScan === "MANUAL" ? (
            <p key="manual" className="text-amber-ink">
              {`No reviewed ${name} claim check exists yet: read the text for claims yourself.`}
            </p>
          ) : null}
          {state.data.claims.length ? (
            <p key="claims" className="text-amber-ink">
              {`Found: ${state.data.claims.map((c) => c.label).join(", ")}.`}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="type-eyebrow text-ink-3">Next publication</p>
              {state.data.next ? (
                <SnapshotView key="next" s={state.data.next} />
              ) : (
                <div key="next-missing" className="text-ink-2">
                  <p>{`Not publishable in ${name} yet:`}</p>
                  <ul className="list-disc pl-5">
                    {state.data.requiredMissing.map((u) => (
                      <li key={u}>{missingLabel(u)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <p className="type-eyebrow text-ink-3">Live now</p>
              {state.data.live ? (
                <SnapshotView key="live" s={state.data.live} />
              ) : (
                <p key="live-none" className="text-ink-3">
                  {`Nothing live in ${name}.`}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
