import Link from "next/link";
import {
  cmsTranslationProposal,
  type CmsMenuLinkWarningRule,
  type CmsPage,
  type CmsSite,
  type CmsTranslation,
  type CmsTranslationState,
} from "@dream/contracts";
import type { AdminLocale } from "../../lib/i18n/config";
import type { Translate } from "../../lib/i18n/types";
import { StatusPill, cx, type PillTone } from "../ui";
import { languageLabel } from "./site-languages";
import { TranslationActions } from "./translation-actions";

/**
 * ML-2 (DP-074, ADR-028 D6): the languages of a page's translation group as tabs above the
 * editor. Each language is its own page (own draft, preview, publication and history); a tab
 * opens that page, a missing language offers "Create translation" (content:edit). A plain module
 * without "use client": the server page renders it, the actions are a client island.
 */

const STATE_TONE: Readonly<Record<CmsTranslationState, PillTone>> = {
  missing: "neutral",
  draft: "amber",
  published: "success",
  outdated: "amber",
};

/**
 * The state of one language as a pill label (also used by the page lists). ML-12c: `t` is the
 * translator of the UI language (content.common.translationState).
 */
export function translationStateLabel(
  x: Pick<CmsTranslation, "state" | "outdated">,
  t: Translate,
): {
  tone: PillTone;
  label: string;
} {
  if (x.state === "draft" && x.outdated)
    return { tone: "amber", label: t("content.common.translationState.draftOutdated") };
  return { tone: STATE_TONE[x.state], label: t(`content.common.translationState.${x.state}`) };
}

export function TranslationTabs({
  page,
  site,
  translations,
  t,
  locale,
}: {
  page: CmsPage;
  site: CmsSite;
  translations: readonly CmsTranslation[];
  /** ML-12c: the translator and the language of the admin UI (the server page passes them). */
  t: Translate;
  locale: AdminLocale;
}) {
  if (translations.length < 2) return null;
  const sp = site.key.toLowerCase();
  const current = translations.find((x) => x.pageId === page.id);
  const source = translations.find((x) => x.isSource);
  const missing = translations.filter((x) => x.pageId === null);
  const isTranslation = current !== undefined && !current.isSource;
  const notPublic = site.locales.filter((l) => !l.public).map((l) => l.locale);

  return (
    <section
      aria-label={t("content.editor.translationTabs.label")}
      className="space-y-3 rounded-2xl border border-line bg-surface p-4 sm:p-5"
    >
      <nav
        aria-label={t("content.editor.translationTabs.nav")}
        className="flex flex-wrap gap-1 border-b border-line"
      >
        {translations.map((x) => {
          const state = translationStateLabel(x, t);
          const active = x.pageId === page.id;
          return x.pageId ? (
            <Link
              key={`tab-${x.locale}`}
              href={`/content/${x.pageId}?site=${sp}`}
              aria-current={active ? "page" : undefined}
              className={cx(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-petrol text-petrol-strong"
                  : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              <span>{languageLabel(x.locale, locale)}</span>
              <StatusPill tone={state.tone}>
                {x.isSource ? t("content.editor.translationTabs.source") : state.label}
              </StatusPill>
            </Link>
          ) : (
            <span
              key={`tab-${x.locale}`}
              className="-mb-px flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm text-ink-3"
            >
              <span>{languageLabel(x.locale, locale)}</span>
              <StatusPill tone={state.tone}>{state.label}</StatusPill>
            </span>
          );
        })}
      </nav>

      {isTranslation && current ? (
        <TranslationSummary current={current} source={source} t={t} locale={locale} />
      ) : null}

      {page.structureWarnings.length > 0 ? (
        <p
          key="structure"
          role="note"
          className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-ink ring-1 ring-inset ring-amber/30"
        >
          {t("content.editor.translationTabs.structure", {
            list: page.structureWarnings
              .map((w) => t(`content.editor.translationTabs.structureWarning.${w}`))
              .join(", "),
          })}
        </p>
      ) : null}

      {notPublic.length > 0 ? (
        <p key="not-public" className="text-xs text-ink-3">
          {t("content.editor.translationTabs.notPublic", {
            languages: notPublic.map((l) => languageLabel(l, locale)).join(", "),
          })}
        </p>
      ) : null}

      <TranslationActions
        pageId={page.id}
        version={page.version}
        siteParam={sp}
        canEdit={site.canEdit}
        slugEditable={page.kind === "TEMPLATE"}
        slug={page.slug}
        slugPrefix={page.templateKey === "article" ? "/news/" : "/"}
        missing={missing.map((x) => ({
          locale: x.locale,
          label: languageLabel(x.locale, locale),
          ...proposalOf(cmsTranslationProposal(site.key, page, x.locale)),
        }))}
        outdated={
          isTranslation && current?.outdated && current.sourceLatestRevisionNumber !== null
            ? { latest: current.sourceLatestRevisionNumber }
            : null
        }
      />
    </section>
  );
}

/**
 * The one-line state of a translation against its source page. DP-270: without a source-language
 * row the fallback name is never put into the "The {source} page" sentence (it read "The the
 * source language page …"); that case has its own message.
 */
export function translationSummaryText(
  current: CmsTranslation,
  source: CmsTranslation | undefined,
  t: Translate,
  locale: AdminLocale,
): string {
  const from = current.sourceRevisionNumber;
  const latest = current.sourceLatestRevisionNumber;
  const sourceName = source
    ? languageLabel(source.locale, locale)
    : t("content.editor.translationTabs.summary.sourceFallback");
  if (latest === null)
    return source
      ? t("content.editor.translationTabs.summary.notPublished", { source: sourceName })
      : t("content.editor.translationTabs.summary.notPublishedNoSource");
  return current.outdated
    ? t("content.editor.translationTabs.summary.outdated", {
        source: sourceName,
        latest,
        from:
          from === null
            ? t("content.editor.translationTabs.summary.fromEarlierDraft")
            : t("content.editor.translationTabs.summary.fromRevision", { n: from }),
      })
    : t("content.editor.translationTabs.summary.upToDate", { latest, source: sourceName });
}

function TranslationSummary({
  current,
  source,
  t,
  locale,
}: {
  current: CmsTranslation;
  source: CmsTranslation | undefined;
  t: Translate;
  locale: AdminLocale;
}) {
  return (
    <p key="summary" className="text-sm text-ink-2">
      {translationSummaryText(current, source, t, locale)}
    </p>
  );
}

/**
 * ML-7 (DP-238): links of this menu draft that the site will not show as links in the menu's
 * language, so the editor sees them before publishing (a warning, never a refusal, like the
 * structure warning). Rendered by the server page; no state.
 */
export function MenuLinkWarnings({
  page,
  t,
  locale,
}: {
  page: CmsPage;
  /** ML-12c: the translator and the language of the admin UI (the server page passes them). */
  t: Translate;
  locale: AdminLocale;
}) {
  const warnings = page.menuWarnings;
  if (warnings.length === 0) return null;
  return (
    <section
      aria-label={t("content.editor.translationTabs.menuWarnings.label")}
      className="space-y-2 rounded-2xl bg-amber-soft p-4 text-sm text-ink ring-1 ring-inset ring-amber/30 sm:p-5"
    >
      <h2 className="font-semibold">
        {t("content.editor.translationTabs.menuWarnings.heading", {
          count: warnings.length,
          language: languageLabel(page.locale, locale),
        })}
      </h2>
      <ul className="list-disc space-y-1 pl-5">
        {warnings.map((w) => (
          <li key={`${w.path}-${w.rule}`}>
            <span className="font-medium">{w.label}</span>
            <span className="text-ink-2">
              {t("content.editor.translationTabs.menuWarnings.item", {
                text: menuWarning(w.rule, t),
              })}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-ink-2">{t("content.editor.translationTabs.menuWarnings.footer")}</p>
    </section>
  );
}

/** ML-7 rule → its explanation in the UI language (content.editor.translationTabs.menuWarnings.rule). */
function menuWarning(rule: CmsMenuLinkWarningRule, t: Translate): string {
  return t(`content.editor.translationTabs.menuWarnings.rule.${rule}`);
}

/** ML-7 / COM-5: whether a proposal is offered, and its title and slug where it has them. */
function proposalOf(p: { title: string | null; slug: string | null } | null) {
  return p ? { proposal: true, proposalTitle: p.title, proposalSlug: p.slug } : { proposal: false };
}
