import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  LEGAL_DOCUMENT_KEYS,
  LEGAL_TEXTS_API,
  LegalDocumentKeySchema,
  LegalTextHistoryResponseSchema,
  LegalTextsOverviewSchema,
  type LegalDocumentKey,
  type LegalTextsOverview,
} from "@dream/contracts";
import { PageHeader } from "../../../components/catalog/parts";
import {
  LegalTextLocaleRow,
  VersionMeta,
  ViewTextButton,
} from "../../../components/legal/legal-texts";
import { buttonStyles, EmptyState, ErrorState, Panel, StatusPill } from "../../../components/ui";
import { getTranslator } from "../../../lib/i18n/server";
import type { Translate } from "../../../lib/i18n/types";
import {
  documentTitle,
  isFutureUse,
  kindLabel,
  languageLabel,
  usedByLabel,
} from "../../../lib/legal-texts-view";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("legal.texts.metaTitle") };
}

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * DP-298 (ADR-031 D1): Content > Legal texts. The privacy policy, the form notices and the consent
 * texts as versions per language: the current published version (immutable evidence) and the
 * draft of each, the production blockers, and per text and language its history
 * (`?doc=<KEY>&locale=<xx>`). Reading needs legal_text:edit or legal_text:publish; what a user may
 * change comes from the overview's `permissions`, and the API decides every call again.
 */
export default async function LegalTextsPage({
  searchParams,
}: {
  searchParams?: Promise<Search>;
} = {}) {
  await requireStaffSession();
  const t = await getTranslator();
  const sp: Search = (await searchParams) ?? {};
  const header = (
    <PageHeader
      icon="shield"
      title={t("legal.texts.title")}
      description={t("legal.texts.description")}
    />
  );
  const res = await serverRead(LEGAL_TEXTS_API, LegalTextsOverviewSchema);
  if (!res.ok) {
    return (
      <div className="space-y-8">
        {header}
        {res.status === 403 ? (
          <EmptyState key="forbidden" icon="shield" title={t("legal.texts.noAccessTitle")}>
            {t("legal.texts.noAccessText")}
          </EmptyState>
        ) : (
          <ErrorState key="failed" title={t("legal.texts.loadError")}>
            {t("legal.texts.loadErrorText")}
          </ErrorState>
        )}
      </div>
    );
  }
  const overview = res.data;
  const doc = LegalDocumentKeySchema.safeParse(one(sp["doc"]));
  const locale = one(sp["locale"]);
  if (doc.success && /^[a-z]{2}$/.test(locale)) {
    // Called, not rendered: an async part of this server page (as the AI Center's tabs).
    return await History({ docKey: doc.data, locale, t, header });
  }
  const can = overview.permissions;
  return (
    <div className="space-y-6 sm:space-y-8">
      {header}
      <div
        role="note"
        className="space-y-1 rounded-xl bg-petrol-soft px-4 py-3 text-sm text-petrol-strong ring-1 ring-inset ring-petrol/25"
      >
        <p>{t("legal.texts.immutable")}</p>
        {!can.edit || !can.publish ? (
          <p key="readOnly" className="text-ink-2">
            {t("legal.texts.readOnly")}
          </p>
        ) : null}
      </div>
      <Blockers blockers={overview.blockers} t={t} />
      {LEGAL_DOCUMENT_KEYS.map((key) => (
        <DocumentPanel key={key} docKey={key} overview={overview} t={t} />
      ))}
    </div>
  );
}

function Blockers({ blockers, t }: { blockers: readonly string[]; t: Translate }) {
  return (
    <Panel
      id="legal-blockers"
      title={t("legal.texts.blockers.title")}
      description={t("legal.texts.blockers.description")}
    >
      {blockers.length ? (
        <ul key="list" className="space-y-1.5 text-sm">
          {blockers.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <StatusPill tone="amber">{t("legal.texts.blockers.pill")}</StatusPill>
              {/* The API's blocker lines are technical English codes (data). */}
              <code lang="en" className="break-words font-mono text-xs text-ink-2">
                {b}
              </code>
            </li>
          ))}
        </ul>
      ) : (
        <p key="none" className="text-sm text-ink-2">
          {t("legal.texts.blockers.none")}
        </p>
      )}
    </Panel>
  );
}

function DocumentPanel({
  docKey,
  overview,
  t,
}: {
  docKey: LegalDocumentKey;
  overview: LegalTextsOverview;
  t: Translate;
}) {
  const entry = overview.documents.find((d) => d.key === docKey);
  const locales = entry?.locales ?? [];
  const englishCurrent = locales.find((l) => l.locale === "en")?.current ?? null;
  return (
    <Panel
      id={`legal-${docKey.toLowerCase()}`}
      title={documentTitle(docKey, t)}
      description={kindLabel(docKey, t)}
      action={
        <StatusPill tone={isFutureUse(docKey) ? "neutral" : "petrol"}>
          {usedByLabel(docKey, t)}
        </StatusPill>
      }
    >
      <div className="divide-y divide-line">
        {locales.map((l) => (
          <LegalTextLocaleRow
            key={l.locale}
            docKey={docKey}
            locale={l.locale}
            current={l.current}
            draft={l.draft}
            can={overview.permissions}
            englishCurrent={englishCurrent}
          />
        ))}
      </div>
    </Panel>
  );
}

async function History({
  docKey,
  locale,
  t,
  header,
}: {
  docKey: LegalDocumentKey;
  locale: string;
  t: Translate;
  header: ReactNode;
}) {
  const res = await serverRead(
    `${LEGAL_TEXTS_API}/documents/${docKey}/${locale}`,
    LegalTextHistoryResponseSchema,
  );
  const names = { document: documentTitle(docKey, t), language: languageLabel(locale, t) };
  return (
    <div className="space-y-6 sm:space-y-8">
      {header}
      <Link href="/legal-texts" className={buttonStyles.secondary}>
        {t("legal.texts.history.back")}
      </Link>
      <Panel
        id="legal-history"
        title={t("legal.texts.history.showLabel", names)}
        description={t("legal.texts.history.description", names)}
      >
        {!res.ok ? (
          <ErrorState key="failed" title={t("legal.texts.history.loadError")} />
        ) : res.data.versions.length === 0 ? (
          <p key="empty" className="text-sm text-ink-2">
            {t("legal.texts.history.empty")}
          </p>
        ) : (
          <ol key="list" className="divide-y divide-line">
            {res.data.versions.map((v) => {
              const label = v.version ?? t("legal.texts.draft.unnamed");
              return (
                <li key={v.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium text-ink">{label}</span>
                      <StatusPill tone={v.status === "PUBLISHED" ? "petrol" : "neutral"}>
                        {t(`legal.texts.history.status.${v.status}`)}
                      </StatusPill>
                    </p>
                    <ViewTextButton
                      id={v.id}
                      title={`${names.document} (${names.language}) ${label}`}
                    />
                  </div>
                  <VersionMeta version={v} />
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </div>
  );
}
