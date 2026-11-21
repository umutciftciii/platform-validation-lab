import Link from "next/link";
import {
  cmsTranslationHasProposal,
  type CmsMenuLinkWarningRule,
  type CmsPage,
  type CmsSite,
  type CmsTranslation,
  type CmsTranslationState,
} from "@dream/contracts";
import { StatusPill, cx, type PillTone } from "../ui";
import { languageLabel } from "./site-languages";
import { TranslationActions } from "./translation-actions";

/**
 * ML-2 (DP-074, ADR-028 D6): the languages of a page's translation group as tabs above the
 * editor. Each language is its own page (own draft, preview, publication and history); a tab
 * opens that page, a missing language offers "Create translation" (content:edit). A plain module
 * without "use client": the server page renders it, the actions are a client island.
 */

const STATE: Readonly<Record<CmsTranslationState, { tone: PillTone; label: string }>> = {
  missing: { tone: "neutral", label: "Not translated" },
  draft: { tone: "amber", label: "Draft" },
  published: { tone: "success", label: "Published" },
  outdated: { tone: "amber", label: "Published, out of date" },
};

/** The state of one language as a pill label (also used by the page lists). */
export function translationStateLabel(t: Pick<CmsTranslation, "state" | "outdated">): {
  tone: PillTone;
  label: string;
} {
  if (t.state === "draft" && t.outdated) return { tone: "amber", label: "Draft, out of date" };
  return STATE[t.state];
}

export function TranslationTabs({
  page,
  site,
  translations,
}: {
  page: CmsPage;
  site: CmsSite;
  translations: readonly CmsTranslation[];
}) {
  if (translations.length < 2) return null;
  const sp = site.key.toLowerCase();
  const current = translations.find((t) => t.pageId === page.id);
  const source = translations.find((t) => t.isSource);
  const missing = translations.filter((t) => t.pageId === null);
  const isTranslation = current !== undefined && !current.isSource;
  const notPublic = site.locales.filter((l) => !l.public).map((l) => l.locale);

  return (
    <section
      aria-label="Languages of this page"
      className="space-y-3 rounded-2xl border border-line bg-surface p-4 sm:p-5"
    >
      <nav aria-label="Page language" className="flex flex-wrap gap-1 border-b border-line">
        {translations.map((t) => {
          const state = translationStateLabel(t);
          const active = t.pageId === page.id;
          return t.pageId ? (
            <Link
              key={`tab-${t.locale}`}
              href={`/content/${t.pageId}?site=${sp}`}
              aria-current={active ? "page" : undefined}
              className={cx(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-petrol text-petrol-strong"
                  : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              <span>{languageLabel(t.locale)}</span>
              <StatusPill tone={state.tone}>{t.isSource ? "Source" : state.label}</StatusPill>
            </Link>
          ) : (
            <span
              key={`tab-${t.locale}`}
              className="-mb-px flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm text-ink-3"
            >
              <span>{languageLabel(t.locale)}</span>
              <StatusPill tone={state.tone}>{state.label}</StatusPill>
            </span>
          );
        })}
      </nav>

      {isTranslation && current ? <TranslationSummary current={current} source={source} /> : null}

      {page.structureWarnings.length > 0 ? (
        <p
          key="structure"
          role="note"
          className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-ink ring-1 ring-inset ring-amber/30"
        >
          {`The structure differs from the source page (${page.structureWarnings.join(", ")}). This is allowed; check the preview before publishing.`}
        </p>
      ) : null}

      {notPublic.length > 0 ? (
        <p key="not-public" className="text-xs text-ink-3">
          {`Not public on the site yet: ${notPublic.map(languageLabel).join(", ")}. Published content in these languages is visible to staff only (preview), never to visitors.`}
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
        missing={missing.map((t) => ({
          locale: t.locale,
          label: languageLabel(t.locale),
          proposal: cmsTranslationHasProposal(page.templateKey, t.locale),
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

function TranslationSummary({
  current,
  source,
}: {
  current: CmsTranslation;
  source: CmsTranslation | undefined;
}) {
  const from = current.sourceRevisionNumber;
  const latest = current.sourceLatestRevisionNumber;
  const sourceName = source ? languageLabel(source.locale) : "the source language";
  const text =
    latest === null
      ? `The ${sourceName} page has not been published yet.`
      : current.outdated
        ? `${sourceName} has revision ${latest}; this translation was made from ${from === null ? "an earlier draft" : `revision ${from}`}. Update the texts, then mark it as up to date.`
        : `Up to date with revision ${latest} of ${sourceName}.`;
  return (
    <p key="summary" className="text-sm text-ink-2">
      {text}
    </p>
  );
}

const MENU_WARNING: Readonly<Record<CmsMenuLinkWarningRule, string>> = {
  not_live: "its content is not live: shown as text with the note “not ready yet”",
  no_translation: "the page has no published version in this language: left out of the menu",
  not_in_language: "this address or catalogue item does not exist in this language yet: left out",
  unknown_target: "the linked page, product or category no longer exists",
};

/**
 * ML-7 (DP-238): links of this menu draft that the site will not show as links in the menu's
 * language, so the editor sees them before publishing (a warning, never a refusal, like the
 * structure warning). Rendered by the server page; no state.
 */
export function MenuLinkWarnings({ page }: { page: CmsPage }) {
  const warnings = page.menuWarnings;
  if (warnings.length === 0) return null;
  return (
    <section
      aria-label="Links to check before publishing"
      className="space-y-2 rounded-2xl bg-amber-soft p-4 text-sm text-ink ring-1 ring-inset ring-amber/30 sm:p-5"
    >
      <h2 className="font-semibold">
        {`${warnings.length === 1 ? "1 link" : `${warnings.length} links`} will not be shown as ${warnings.length === 1 ? "a link" : "links"} in ${languageLabel(page.locale)}`}
      </h2>
      <ul className="list-disc space-y-1 pl-5">
        {warnings.map((w) => (
          <li key={`${w.path}-${w.rule}`}>
            <span className="font-medium">{w.label}</span>
            <span className="text-ink-2">{` — ${MENU_WARNING[w.rule]}`}</span>
          </li>
        ))}
      </ul>
      <p className="text-ink-2">
        {`Publishing is still possible. Check the preview; translate or publish the missing pages first where the link is needed.`}
      </p>
    </section>
  );
}
