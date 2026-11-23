"use client";

/**
 * ML-8b (ADR-028 D8, DP-239): the product page's language tabs and the editors of one language
 * other than the site's default.
 *
 * - `LanguageTabs`: EN / NL tabs inside a product tab (Content, SEO). Every language panel stays
 *   mounted (hidden when inactive), so typed text survives a language switch; arrow keys, Home
 *   and End move between the tabs; the active language is kept in the URL (`?lang=`, replaced).
 * - The editors write ONE language through the ML-8a endpoints (contracts
 *   catalog-translations.ts). Each shows the English source next to every field (beside it on a
 *   wide screen, below it on a phone; "Hide English source" folds it), marks fields that have an
 *   English text but none here, reports unsaved changes (tab dot, leave-page check) and announces
 *   the save result. Nothing is copied or translated automatically: an empty field stays empty
 *   until someone writes it (no AI translation, DP-255).
 * - Saving never publishes: the Publication tab chooses the languages of a publication.
 */
import {
  ALT_TEXT_MAX,
  DESCRIPTION_MAX,
  SEO_TEXT_LIMITS,
  type ProductTranslationsResponse,
  type SiteLocale,
  type TranslationState,
} from "@dream/contracts";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { callCatalog } from "../../lib/catalog-client";
import { formHasChanges } from "../../lib/product-tabs";
import {
  localeLabel,
  localeShort,
  missingLabel,
  TRANSLATION_STATE_TONES,
  translationStateHint,
  translationStateLabel,
} from "../../lib/translations";
import { useT } from "../i18n/locale-provider";
import { Icon } from "../icons";
import { buttonStyles, cx, Spinner, StatusPill } from "../ui";
import { FIELD, FormMessage, TEXTAREA } from "./parts";
import { useNotice } from "./notices";
import { useUnsavedChanges } from "./product-tabs";

// --- tabs ----------------------------------------------------------------------------------------

export function TranslationStatePill({ state }: { state: TranslationState | null }) {
  const t = useT();
  if (!state) return null;
  return (
    <span title={translationStateHint(state, t)} data-translation-state={state}>
      <StatusPill tone={TRANSLATION_STATE_TONES[state]}>
        {translationStateLabel(state, t)}
      </StatusPill>
    </span>
  );
}

/**
 * Language tabs of one product tab. `panels` maps each enabled language to its content; the
 * default language's panel is the existing (English) editor.
 */
export function LanguageTabs({
  label,
  locales,
  initial,
  states = {},
  panels,
}: {
  /** The accessible name, e.g. "Language of the product text". */
  label: string;
  locales: readonly SiteLocale[];
  initial: string;
  /** Optional state per language, shown on its tab. */
  states?: Readonly<Record<string, TranslationState | null>>;
  panels: Readonly<Record<string, ReactNode>>;
}) {
  const shown = locales.filter((l) => l.enabled && panels[l.locale] !== undefined);
  const [active, setActive] = useState(
    shown.some((l) => l.locale === initial) ? initial : (shown[0]?.locale ?? initial),
  );
  const base = useId();
  const t = useT();
  // One language (or none known, e.g. no listing yet): the default editor alone, no tabs.
  if (shown.length <= 1) return <>{panels[shown[0]?.locale ?? initial] ?? null}</>;

  function select(locale: string) {
    setActive(locale);
    const url = new URL(window.location.href);
    const def = shown.find((l) => l.isDefault)?.locale;
    if (locale === def) url.searchParams.delete("lang");
    else url.searchParams.set("lang", locale);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = shown.findIndex((l) => l.locale === active);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % shown.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + shown.length) % shown.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = shown.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const locale = shown[next]!.locale;
    select(locale);
    document.getElementById(`${base}-tab-${locale}`)?.focus();
  }

  return (
    <div className="space-y-4" data-language-tabs="">
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface-2 p-1"
      >
        {shown.map((l) => {
          const selected = l.locale === active;
          const state = states[l.locale] ?? null;
          return (
            <button
              key={l.locale}
              id={`${base}-tab-${l.locale}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${base}-panel-${l.locale}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(l.locale)}
              data-lang-tab={l.locale}
              className={cx(
                "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-petrol/40",
                selected
                  ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-line"
                  : "text-ink-3 hover:text-ink",
              )}
            >
              <span className="font-mono text-xs">{localeShort(l.locale)}</span>
              <span>{localeLabel(l.locale, t)}</span>
              {l.isDefault ? (
                <span key="source" className="text-xs font-normal text-ink-3">
                  {t("catalog.translations.tabs.source")}
                </span>
              ) : null}
              {state ? (
                <span key={`state-${state}`} className="sr-only">
                  {`, ${translationStateLabel(state, t)}`}
                </span>
              ) : null}
              {state && !l.isDefault ? (
                <span
                  key={`dot-${state}`}
                  aria-hidden="true"
                  title={translationStateLabel(state, t)}
                  className={cx(
                    "size-2 rounded-full",
                    state === "PUBLISHED"
                      ? "bg-success"
                      : state === "DRAFT"
                        ? "bg-petrol"
                        : state === "OUTDATED"
                          ? "bg-amber"
                          : "bg-danger",
                  )}
                />
              ) : null}
            </button>
          );
        })}
      </div>
      {shown.map((l) => (
        <div
          key={l.locale}
          id={`${base}-panel-${l.locale}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${l.locale}`}
          hidden={l.locale !== active}
          lang={l.locale}
          data-lang-panel={l.locale}
          className="space-y-4"
        >
          {panels[l.locale]}
        </div>
      ))}
    </div>
  );
}

// --- source column -----------------------------------------------------------------------------

const SourceContext = createContext<{ show: boolean; locale: string }>({
  show: true,
  locale: "en",
});

/** The English source of one field, next to (wide) or below (phone) the translation. */
function SourceText({ text, shared }: { text: string | null; shared?: boolean }) {
  const { show, locale } = useContext(SourceContext);
  const t = useT();
  if (!show) return null;
  return (
    <div
      lang={locale}
      className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2 ring-1 ring-inset ring-line"
      data-source-text=""
    >
      <p className="type-eyebrow mb-1 text-ink-3">
        {t(
          shared
            ? "catalog.translations.source.headingShared"
            : "catalog.translations.source.heading",
          { name: localeLabel(locale, t) },
        )}
      </p>
      {text ? (
        <p key="text" className="whitespace-pre-line break-words">
          {text}
        </p>
      ) : (
        <p key="none" className="text-ink-3">
          {t("catalog.translations.source.none")}
        </p>
      )}
    </div>
  );
}

/** One translated field with its source and the "missing" marker. */
function TranslationField({
  id,
  label,
  source,
  shared,
  missing,
  hint,
  children,
}: {
  id: string;
  label: string;
  source: string | null;
  shared?: boolean;
  /** The source has a text and the saved translation has none. */
  missing: boolean;
  hint?: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-4" data-field={id}>
      <div className="min-w-0">
        <label
          htmlFor={id}
          className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-medium text-ink"
        >
          <span>{label}</span>
          {missing ? (
            <span
              key="missing"
              id={`${id}-missing`}
              className="rounded-full bg-amber-soft px-2 text-xs font-medium text-amber-ink ring-1 ring-inset ring-amber/30"
              data-missing=""
            >
              {t("catalog.translations.field.missing")}
            </span>
          ) : null}
        </label>
        {children}
        {hint ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
      </div>
      <SourceText text={source} shared={shared} />
    </div>
  );
}

const missingRing = (missing: boolean) =>
  missing ? "border-amber ring-2 ring-amber/20" : undefined;

// --- the language overview ------------------------------------------------------------------------

/** What the language needs and where it stands, at the top of its panel. */
export function LanguageSummary({ data }: { data: ProductTranslationsResponse }) {
  const t = useT();
  const name = localeLabel(data.locale, t);
  const specs = Object.fromEntries(
    data.specs.map((s) => [s.key, s.name.source ?? s.key]),
  ) as Record<string, string>;
  const images = Object.fromEntries(
    data.images.map((i) => [i.id, i.altText.source ?? i.originalFilename]),
  ) as Record<string, string>;
  const optional = data.missing.filter(
    (m) => !data.requiredMissing.includes(m) && !(m.startsWith("spec:") || m === "category.name"),
  );
  return (
    <div
      className="space-y-3 rounded-xl border border-line bg-surface-2/40 p-4"
      data-language-summary=""
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-ink">
          {t("catalog.translations.summary.onSite", { name })}
        </span>
        {data.public ? (
          <StatusPill key="public" tone="success">
            {t("catalog.translations.summary.public")}
          </StatusPill>
        ) : (
          <StatusPill key="not-public" tone="neutral">
            {t("catalog.translations.summary.notPublic")}
          </StatusPill>
        )}
        {data.live.hasLocale ? (
          <span key="live" className="text-ink-3">
            {t("catalog.translations.summary.liveHas", { name })}
          </span>
        ) : (
          <span key="not-live" className="text-ink-3">
            {data.live.published
              ? t("catalog.translations.summary.liveHasNot", { name })
              : t("catalog.translations.summary.notLive")}
          </span>
        )}
      </div>
      {!data.public ? (
        <p key="not-public-note" className="text-xs text-ink-3">
          {t("catalog.translations.summary.notPublicNote", { name })}
        </p>
      ) : null}
      {data.requiredMissing.length ? (
        <div key="required" className="space-y-1" data-required-missing="">
          <p className="text-xs font-semibold text-danger">
            {t("catalog.translations.summary.requiredHeading", { name })}
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-2">
            {data.requiredMissing.map((m) => (
              <li key={m}>{missingLabel(m, t, { specs, images })}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p key="complete" className="flex items-center gap-1.5 text-xs font-medium text-success">
          <Icon name="check" size={13} />
          <span>{t("catalog.translations.summary.complete", { name })}</span>
        </p>
      )}
      {optional.length ? (
        <details key="optional" className="text-xs">
          <summary className="cursor-pointer font-medium text-amber-ink">
            {t("catalog.translations.summary.optional", { count: optional.length })}
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-2">
            {optional.map((m) => (
              <li key={m}>{missingLabel(m, t, { specs, images })}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="text-xs text-ink-3">{t("catalog.translations.summary.noAutomatic")}</p>
    </div>
  );
}

/** Folds the source column of every editor inside it. */
export function SourceToggle({ locale, children }: { locale: string; children: ReactNode }) {
  const [show, setShow] = useState(true);
  const t = useT();
  return (
    <SourceContext.Provider value={{ show, locale }}>
      <div className="flex justify-end">
        <button
          type="button"
          aria-pressed={show}
          onClick={() => setShow((v) => !v)}
          className={cx(buttonStyles.ghost, "text-xs")}
        >
          <Icon name="eye" size={14} />
          <span key={String(show)}>
            {show
              ? t("catalog.translations.toggle.hide", { name: localeLabel(locale, t) })
              : t("catalog.translations.toggle.show", { name: localeLabel(locale, t) })}
          </span>
        </button>
      </div>
      {children}
    </SourceContext.Provider>
  );
}

// --- shared form plumbing --------------------------------------------------------------------

function useTranslationForm(formRef: RefObject<HTMLFormElement | null>, enabled: boolean) {
  const router = useRouter();
  const notify = useNotice();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(enabled && dirty);
  // Outside the product tabs (categories, specifications) the page has no guard of its own:
  // leaving or reloading with unsaved text asks first.
  useEffect(() => {
    if (!(enabled && dirty)) return;
    const stop = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [enabled, dirty]);
  const track = (e: FormEvent<HTMLFormElement>) => setDirty(formHasChanges(e.currentTarget));
  function discard() {
    formRef.current?.reset();
    setDirty(false);
    setError(null);
  }
  async function save(
    calls: readonly { path: string; body: unknown }[],
    done: string,
  ): Promise<boolean> {
    setPending(true);
    setError(null);
    for (const c of calls) {
      const r = await callCatalog("POST", c.path, c.body);
      if (!r.ok) {
        setPending(false);
        setError(r.message);
        notify?.(r.message, "error");
        if (calls.length > 1) router.refresh();
        return false;
      }
    }
    setPending(false);
    setDirty(false);
    notify?.(done);
    router.refresh();
    return true;
  }
  return { pending, error, dirty, track, discard, save };
}

function FormButtons({
  pending,
  dirty,
  canEdit,
  outdated,
  onDiscard,
  onConfirm,
  saveLabel,
  readOnlyText,
}: {
  pending: boolean;
  dirty: boolean;
  canEdit: boolean;
  outdated: boolean;
  onDiscard: () => void;
  onConfirm: () => void;
  saveLabel: string;
  readOnlyText: string;
}) {
  const t = useT();
  if (!canEdit) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-3">
        <Icon name="shield" size={16} />
        <span>{readOnlyText}</span>
      </p>
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {outdated && !dirty ? (
        <button
          key="confirm"
          type="button"
          disabled={pending}
          onClick={onConfirm}
          className={buttonStyles.secondary}
        >
          <Icon name="check" size={16} />
          <span>{t("catalog.translations.buttons.confirm")}</span>
        </button>
      ) : null}
      {dirty ? (
        <button
          key="discard"
          type="button"
          disabled={pending}
          onClick={onDiscard}
          className={buttonStyles.ghost}
        >
          {t("catalog.translations.buttons.discard")}
        </button>
      ) : null}
      <button type="submit" disabled={pending || !dirty} className={buttonStyles.primary}>
        {pending ? <Spinner key="spin" /> : <Icon key="icon" name="edit" size={17} />}
        <span>{pending ? t("catalog.translations.buttons.saving") : saveLabel}</span>
      </button>
    </div>
  );
}

const val = (form: FormData, name: string) => String(form.get(name) ?? "");

// --- listing texts ---------------------------------------------------------------------------------

export function ListingTranslationForm({
  productId,
  data,
  canEdit,
}: {
  productId: string;
  data: ProductTranslationsResponse;
  canEdit: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const listing = data.listing;
  const editable = canEdit && data.enabled && listing !== null;
  const f = useTranslationForm(formRef, editable);
  const t = useT();
  const name = localeLabel(data.locale, t);
  // i18n-ignore: DOM element id, not UI text
  const id = (n: string) => `tr-${data.locale}-listing-${n}`;
  if (!listing) {
    return <p className="text-sm text-ink-3">{t("catalog.translations.listing.noListing")}</p>;
  }
  const body = (form: FormData | null) => ({
    version: listing.version,
    sections: ["texts"],
    title: form ? val(form, "title") : listing.title.value,
    summary: form ? val(form, "summary") : listing.summary.value,
    description: form ? val(form, "description") : listing.description.value,
    // The SEO texts are saved on the SEO tab: their saved values go back unchanged.
    seo: {
      title: listing.seo.title.value,
      description: listing.seo.description.value,
      ogTitle: listing.seo.ogTitle.value,
      ogDescription: listing.seo.ogDescription.value,
    },
  });
  const path = `/products/${productId}/listings/${data.siteId}/texts/${data.locale}`;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editable) return;
    await f.save(
      [{ path, body: body(new FormData(e.currentTarget)) }],
      t("catalog.translations.listing.saved", { name }),
    );
  }
  const miss = (n: "title" | "summary" | "description") => data.missing.includes(n);
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onInput={f.track}
      onChange={f.track}
      noValidate
      className="space-y-4"
    >
      <fieldset disabled={!editable} className="space-y-4">
        <legend className="sr-only">{t("catalog.translations.listing.legend", { name })}</legend>
        <TranslationField
          id={id("title")}
          label={t("catalog.translations.listing.title", { name })}
          source={listing.title.source}
          shared={listing.sharedSource.title}
          missing={miss("title")}
          hint={t("catalog.translations.listing.titleHint")}
        >
          <input
            id={id("title")}
            name="title"
            maxLength={200}
            defaultValue={listing.title.value ?? ""}
            aria-describedby={miss("title") ? `${id("title")}-missing` : undefined}
            className={cx(FIELD, missingRing(miss("title")))}
          />
        </TranslationField>
        <TranslationField
          id={id("summary")}
          label={t("catalog.translations.listing.summary", { name })}
          source={listing.summary.source}
          shared={listing.sharedSource.summary}
          missing={miss("summary")}
        >
          <textarea
            id={id("summary")}
            name="summary"
            rows={3}
            maxLength={500}
            defaultValue={listing.summary.value ?? ""}
            aria-describedby={miss("summary") ? `${id("summary")}-missing` : undefined}
            className={cx(
              FIELD,
              "field-sizing-content h-auto min-h-16 py-2 leading-relaxed",
              missingRing(miss("summary")),
            )}
          />
        </TranslationField>
        <TranslationField
          id={id("description")}
          label={t("catalog.translations.listing.description", { name })}
          source={listing.description.source}
          shared={listing.sharedSource.description}
          missing={miss("description")}
        >
          <textarea
            id={id("description")}
            name="description"
            rows={8}
            maxLength={DESCRIPTION_MAX}
            defaultValue={listing.description.value ?? ""}
            aria-describedby={miss("description") ? `${id("description")}-missing` : undefined}
            className={cx(
              TEXTAREA,
              "field-sizing-content min-h-48 max-h-[36rem]",
              missingRing(miss("description")),
            )}
          />
        </TranslationField>
      </fieldset>
      {f.error ? <FormMessage kind="error">{f.error}</FormMessage> : null}
      <FormButtons
        pending={f.pending}
        dirty={f.dirty}
        canEdit={editable}
        outdated={listing.state === "OUTDATED"}
        onDiscard={f.discard}
        onConfirm={() =>
          void f.save(
            [{ path, body: body(null) }],
            t("catalog.translations.listing.checked", { name }),
          )
        }
        saveLabel={t("catalog.translations.listing.save", { name })}
        readOnlyText={
          data.enabled
            ? t("catalog.translations.listing.readOnly")
            : t("catalog.translations.notEnabled", { name })
        }
      />
    </form>
  );
}

// --- SEO texts ---------------------------------------------------------------------------------

/** The label of each is catalog.translations.seo.fields.<key>. */
const SEO_FIELDS = [
  { key: "title", max: SEO_TEXT_LIMITS.title.max, area: false },
  { key: "description", max: SEO_TEXT_LIMITS.description.max, area: true },
  { key: "ogTitle", max: SEO_TEXT_LIMITS.ogTitle.max, area: false },
  { key: "ogDescription", max: SEO_TEXT_LIMITS.ogDescription.max, area: true },
] as const;

export function ListingSeoTranslationForm({
  productId,
  data,
  canEdit,
}: {
  productId: string;
  data: ProductTranslationsResponse;
  canEdit: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const listing = data.listing;
  const editable = canEdit && data.enabled && listing !== null;
  const f = useTranslationForm(formRef, editable);
  const t = useT();
  const name = localeLabel(data.locale, t);
  if (!listing) {
    return <p className="text-sm text-ink-3">{t("catalog.translations.seo.noListing")}</p>;
  }
  const body = (form: FormData | null) => ({
    version: listing.version,
    sections: ["seo"],
    // The product text is saved on the Content tab: its saved values go back unchanged.
    title: listing.title.value,
    summary: listing.summary.value,
    description: listing.description.value,
    seo: Object.fromEntries(
      SEO_FIELDS.map((s) => [s.key, form ? val(form, s.key) : listing.seo[s.key].value]),
    ),
  });
  const path = `/products/${productId}/listings/${data.siteId}/texts/${data.locale}`;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editable) return;
    await f.save(
      [{ path, body: body(new FormData(e.currentTarget)) }],
      t("catalog.translations.seo.saved", { name }),
    );
  }
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onInput={f.track}
      onChange={f.track}
      noValidate
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
        <span>{t("catalog.translations.seo.heading", { name })}</span>
        <TranslationStatePill state={listing.seoState} />
      </div>
      <p className="text-xs text-ink-3">{t("catalog.translations.seo.note", { name })}</p>
      <fieldset disabled={!editable} className="space-y-4">
        <legend className="sr-only">{t("catalog.translations.seo.heading", { name })}</legend>
        {SEO_FIELDS.map((s) => {
          // i18n-ignore: DOM element id, not UI text
          const fid = `tr-${data.locale}-seo-${s.key}`;
          const miss = data.missing.includes(`seo.${s.key}`);
          const value = listing.seo[s.key].value ?? "";
          return (
            <TranslationField
              key={s.key}
              id={fid}
              label={t(`catalog.translations.seo.fields.${s.key}`, { name })}
              source={listing.seo[s.key].source}
              missing={miss}
              hint={t("catalog.translations.seo.maxHint", { max: s.max })}
            >
              {s.area ? (
                <textarea
                  id={fid}
                  name={s.key}
                  rows={3}
                  maxLength={s.max}
                  defaultValue={value}
                  className={cx(
                    FIELD,
                    "field-sizing-content h-auto min-h-16 py-2",
                    missingRing(miss),
                  )}
                />
              ) : (
                <input
                  id={fid}
                  name={s.key}
                  maxLength={s.max}
                  defaultValue={value}
                  className={cx(FIELD, missingRing(miss))}
                />
              )}
            </TranslationField>
          );
        })}
      </fieldset>
      {f.error ? <FormMessage kind="error">{f.error}</FormMessage> : null}
      <FormButtons
        pending={f.pending}
        dirty={f.dirty}
        canEdit={editable}
        outdated={listing.seoState === "OUTDATED"}
        onDiscard={f.discard}
        onConfirm={() =>
          void f.save([{ path, body: body(null) }], t("catalog.translations.seo.checked", { name }))
        }
        saveLabel={t("catalog.translations.seo.save", { name })}
        readOnlyText={
          data.enabled
            ? t("catalog.translations.seo.readOnly")
            : t("catalog.translations.notEnabled", { name })
        }
      />
    </form>
  );
}

// --- category ----------------------------------------------------------------------------------

export function CategoryTranslationForm({
  category,
  locale,
  enabled,
  canEdit,
  idPrefix,
}: {
  category: {
    id: string;
    version: number;
    state: TranslationState | null;
    name: { value: string | null; source: string | null };
    description: { value: string | null; source: string | null };
  };
  locale: string;
  enabled: boolean;
  canEdit: boolean;
  idPrefix: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const editable = canEdit && enabled;
  const f = useTranslationForm(formRef, editable);
  const t = useT();
  const name = localeLabel(locale, t);
  const id = (n: string) => `${idPrefix}-${n}`;
  const path = `/categories/${category.id}/texts/${locale}`;
  const missName = category.name.value === null && category.name.source !== null;
  const missDesc = !category.description.value && !!category.description.source;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editable) return;
    const form = new FormData(e.currentTarget);
    const n = val(form, "name").trim();
    const d = val(form, "description").trim();
    await f.save(
      [
        {
          path,
          body: { version: category.version, name: n || null, description: n ? d || null : null },
        },
      ],
      n
        ? t("catalog.translations.category.savedName", { name })
        : t("catalog.translations.category.removedName", { name }),
    );
  }
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onInput={f.track}
      onChange={f.track}
      noValidate
      className="space-y-3"
    >
      <fieldset disabled={!editable} className="space-y-3">
        <legend className="sr-only">{t("catalog.translations.category.legend", { name })}</legend>
        <TranslationField
          id={id("name")}
          label={t("catalog.translations.category.name", { name })}
          source={category.name.source}
          missing={missName}
        >
          <input
            id={id("name")}
            name="name"
            maxLength={120}
            defaultValue={category.name.value ?? ""}
            className={cx(FIELD, missingRing(missName))}
          />
        </TranslationField>
        <TranslationField
          id={id("description")}
          label={t("catalog.translations.category.description", { name })}
          source={category.description.source}
          missing={missDesc}
          hint={t("catalog.translations.category.descriptionHint")}
        >
          <textarea
            id={id("description")}
            name="description"
            rows={2}
            maxLength={1000}
            defaultValue={category.description.value ?? ""}
            className={cx(
              FIELD,
              "field-sizing-content h-auto min-h-16 py-2",
              missingRing(missDesc),
            )}
          />
        </TranslationField>
      </fieldset>
      {f.error ? <FormMessage kind="error">{f.error}</FormMessage> : null}
      <FormButtons
        pending={f.pending}
        dirty={f.dirty}
        canEdit={editable}
        outdated={category.state === "OUTDATED"}
        onDiscard={f.discard}
        onConfirm={() =>
          void f.save(
            [
              {
                path,
                body: {
                  version: category.version,
                  name: category.name.value,
                  description: category.description.value,
                },
              },
            ],
            t("catalog.translations.category.checked", { name }),
          )
        }
        saveLabel={t("catalog.translations.category.save", { name })}
        readOnlyText={
          enabled
            ? t("catalog.translations.category.readOnly")
            : t("catalog.translations.notEnabled", { name })
        }
      />
    </form>
  );
}

// --- specification names -----------------------------------------------------------------------

export interface SpecNameRow {
  id: string;
  key: string;
  version: number;
  state: TranslationState | null;
  name: { value: string | null; source: string | null };
}

/** Names of several specifications in one language; Save writes the changed ones. */
export function SpecNamesTranslationForm({
  rows,
  locale,
  enabled,
  canEdit,
  idPrefix,
  emptyText,
}: {
  rows: readonly SpecNameRow[];
  locale: string;
  enabled: boolean;
  canEdit: boolean;
  idPrefix: string;
  emptyText?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const editable = canEdit && enabled;
  const f = useTranslationForm(formRef, editable);
  const t = useT();
  const name = localeLabel(locale, t);
  if (rows.length === 0)
    return (
      <p className="text-sm text-ink-3">{emptyText ?? t("catalog.translations.specs.empty")}</p>
    );
  const outdated = rows.filter((r) => r.state === "OUTDATED");
  const call = (r: SpecNameRow, value: string | null) => ({
    path: `/spec-definitions/${r.id}/texts/${locale}`,
    body: { version: r.version, name: value },
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editable) return;
    const form = new FormData(e.currentTarget);
    const calls = rows
      .map((r) => ({ r, v: val(form, `spec-${r.id}`).trim() || null }))
      .filter(({ r, v }) => v !== r.name.value)
      .map(({ r, v }) => call(r, v));
    if (calls.length)
      await f.save(calls, t("catalog.translations.specs.saved", { count: calls.length, name }));
  }
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onInput={f.track}
      onChange={f.track}
      noValidate
      className="space-y-3"
    >
      <fieldset disabled={!editable} className="space-y-3">
        <legend className="sr-only">{t("catalog.translations.specs.legend", { name })}</legend>
        {rows.map((r) => {
          const fid = `${idPrefix}-spec-${r.id}`;
          const miss = r.name.value === null && r.name.source !== null;
          return (
            <div key={r.id} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <code className="font-mono">{r.key}</code>
                <TranslationStatePill state={r.state} />
              </div>
              <TranslationField
                id={fid}
                label={t("catalog.translations.specs.name", { name })}
                source={r.name.source}
                missing={miss}
              >
                <input
                  id={fid}
                  name={`spec-${r.id}`}
                  maxLength={120}
                  defaultValue={r.name.value ?? ""}
                  className={cx(FIELD, missingRing(miss))}
                />
              </TranslationField>
            </div>
          );
        })}
      </fieldset>
      <p className="text-xs text-ink-3">{t("catalog.translations.specs.note")}</p>
      {f.error ? <FormMessage kind="error">{f.error}</FormMessage> : null}
      <FormButtons
        pending={f.pending}
        dirty={f.dirty}
        canEdit={editable}
        outdated={outdated.length > 0}
        onDiscard={f.discard}
        onConfirm={() =>
          void f.save(
            outdated.map((r) => call(r, r.name.value)),
            t("catalog.translations.specs.checked", { count: outdated.length, name }),
          )
        }
        saveLabel={t("catalog.translations.specs.save", { name })}
        readOnlyText={
          enabled
            ? t("catalog.translations.specs.readOnly")
            : t("catalog.translations.notEnabledAnySite", { name })
        }
      />
    </form>
  );
}

// --- image alt texts ---------------------------------------------------------------------------

export function ImageAltTranslationForm({
  data,
  canEdit,
}: {
  data: ProductTranslationsResponse;
  canEdit: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const editable = canEdit && data.enabled;
  const f = useTranslationForm(formRef, editable);
  const t = useT();
  const name = localeLabel(data.locale, t);
  if (data.images.length === 0)
    return <p className="text-sm text-ink-3">{t("catalog.translations.images.empty")}</p>;
  const outdated = data.images.filter((i) => i.state === "OUTDATED");
  const call = (i: ProductTranslationsResponse["images"][number], value: string | null) => ({
    path: `/images/${i.id}/texts/${data.locale}`,
    body: { version: i.version, altText: value },
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editable) return;
    const form = new FormData(e.currentTarget);
    const calls = data.images
      .map((i) => ({ i, v: val(form, `alt-${i.id}`).trim() || null }))
      .filter(({ i, v }) => v !== i.altText.value)
      .map(({ i, v }) => call(i, v));
    if (calls.length)
      await f.save(calls, t("catalog.translations.images.saved", { count: calls.length, name }));
  }
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onInput={f.track}
      onChange={f.track}
      noValidate
      className="space-y-3"
    >
      <fieldset disabled={!editable} className="space-y-3">
        <legend className="sr-only">{t("catalog.translations.images.legend", { name })}</legend>
        {data.images.map((i) => {
          // i18n-ignore: DOM element id, not UI text
          const fid = `tr-${data.locale}-alt-${i.id}`;
          const miss = data.missing.includes(`image:${i.id}`);
          return (
            <div key={i.id} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <span className="break-all">{i.originalFilename}</span>
                {i.isPublic ? null : (
                  <span key="hidden" className="rounded bg-surface-2 px-1.5 ring-1 ring-line">
                    {t("catalog.translations.images.hidden")}
                  </span>
                )}
                <TranslationStatePill state={i.state} />
              </div>
              <TranslationField
                id={fid}
                label={t("catalog.translations.images.alt", { name })}
                source={i.altText.source}
                missing={miss}
              >
                <input
                  id={fid}
                  name={`alt-${i.id}`}
                  maxLength={ALT_TEXT_MAX}
                  defaultValue={i.altText.value ?? ""}
                  className={cx(FIELD, missingRing(miss))}
                />
              </TranslationField>
            </div>
          );
        })}
      </fieldset>
      <p className="text-xs text-ink-3">{t("catalog.translations.images.note")}</p>
      {f.error ? <FormMessage kind="error">{f.error}</FormMessage> : null}
      <FormButtons
        pending={f.pending}
        dirty={f.dirty}
        canEdit={editable}
        outdated={outdated.length > 0}
        onDiscard={f.discard}
        onConfirm={() =>
          void f.save(
            outdated.map((i) => call(i, i.altText.value)),
            t("catalog.translations.images.checked", { count: outdated.length, name }),
          )
        }
        saveLabel={t("catalog.translations.images.save", { name })}
        readOnlyText={
          data.enabled
            ? t("catalog.translations.images.readOnly")
            : t("catalog.translations.notEnabled", { name })
        }
      />
    </form>
  );
}

/** A titled section of a language panel with its state. */
export function TranslationSection({
  title,
  state,
  description,
  children,
}: {
  title: string;
  state: TranslationState | null;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-ink">{title}</h3>
        <TranslationStatePill state={state} />
      </header>
      {description ? <p className="text-xs text-ink-3">{description}</p> : null}
      <div>{children}</div>
    </section>
  );
}
