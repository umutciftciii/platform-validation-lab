import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  CMS_SITE_REGISTRY,
  CmsHistoryResponseSchema,
  CmsMenuTargetsResponseSchema,
  CmsPageResponseSchema,
  cmsDesignTemplate,
  cmsIsArticle,
  cmsIsMenu,
} from "@dream/contracts";
import { NoticeProvider } from "../../../../components/catalog/notices";
import { PageHeader, SITE_SHORT } from "../../../../components/catalog/parts";
import { PageEditor } from "../../../../components/cms/page-editor";
import { CmsKindPill, publicationState } from "../../../../components/cms/parts";
import { languageLabel } from "../../../../components/cms/site-languages";
import { MenuLinkWarnings, TranslationTabs } from "../../../../components/cms/translation-tabs";
import { EmptyState, ErrorState, StatusPill } from "../../../../components/ui";
import { cmsText } from "../../../../lib/cms-text";
import { ADMIN_TIME_ZONE } from "../../../../lib/i18n/config";
import { dateTimeFormat } from "../../../../lib/i18n/format";
import { getAdminLocale, getTranslator } from "../../../../lib/i18n/server";
import { serverRead } from "../../../../lib/server-api";
import { bvPublicOrigin, siteSeoDefaults } from "../../../../lib/seo-server";
import { requireStaffSession } from "../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("content.pages.meta.edit") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
};

/** CMS S1/S2: the draft and publication of one page. The API answers 404 for pages outside the caller's sites. */
export default async function ContentPageEditor({ params }: PageProps<"/content/[id]">) {
  await requireStaffSession();
  const { id } = await params;
  const t = await getTranslator();
  const uiLocale = await getAdminLocale();
  if (!UUID.test(id)) notFound();
  const res = await serverRead(`/api/v1/admin/cms/pages/${id}`, CmsPageResponseSchema);
  if (!res.ok && res.status === 404) notFound();
  if (!res.ok) {
    return (
      <div className="space-y-8">
        <PageHeader
          icon="content"
          title={t("content.pages.editor.title")}
          back={{ href: "/content", label: t("content.pages.editor.allPages") }}
        />
        <ErrorState title={t("content.pages.editor.loadError")}>
          {t("content.pages.shared.tryAgain")}
        </ErrorState>
      </div>
    );
  }
  const { page, site, translations } = res.data;
  const sp = site.key.toLowerCase();
  const article = cmsIsArticle(page);
  const back = article
    ? {
        href: `/content/news?site=${sp}`,
        label: t("content.pages.editor.allArticlesOf", { site: SITE_SHORT[site.key] }),
      }
    : {
        href: `/content?site=${sp}`,
        label: t("content.pages.editor.allPagesOf", { site: SITE_SHORT[site.key] }),
      };
  const [history, siteSeo, menuTargets] = await Promise.all([
    serverRead(`/api/v1/admin/cms/pages/${page.id}/history`, CmsHistoryResponseSchema),
    siteSeoDefaults(site.id),
    // DP-219: the pages, products and categories the menu editor offers as targets.
    cmsIsMenu(page.templateKey)
      ? serverRead(`/api/v1/admin/cms/sites/${site.id}/menu-targets`, CmsMenuTargetsResponseSchema)
      : null,
  ]);
  const registry = CMS_SITE_REGISTRY.find((e) => e.key === page.templateKey);
  const editable = page.kind === "TEMPLATE" || Boolean(cmsDesignTemplate(page.templateKey));
  const state = publicationState(page, t);

  return (
    <NoticeProvider>
      <div className="space-y-6 sm:space-y-8">
        <PageHeader
          icon="content"
          title={page.title}
          back={back}
          description={
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {article ? (
                <StatusPill tone="petrol">{t("content.pages.editor.newsArticle")}</StatusPill>
              ) : (
                <CmsKindPill kind={page.kind} />
              )}
              <StatusPill tone={state.tone}>{state.label}</StatusPill>
              <StatusPill tone="neutral">{languageLabel(page.locale, uiLocale)}</StatusPill>
              <span className="font-mono text-ink-3">
                {page.path ?? t("content.common.siteWidePart")}
              </span>
              <span className="text-ink-3">
                {t("content.pages.editor.lastSaved", {
                  date: dateTimeFormat(uiLocale, DATE_OPTIONS).format(new Date(page.updatedAt)),
                  name: page.updatedBy.name,
                })}
              </span>
            </div>
          }
        />
        <TranslationTabs
          page={page}
          site={site}
          translations={translations}
          t={t}
          locale={uiLocale}
        />
        <MenuLinkWarnings page={page} t={t} locale={uiLocale} />
        {editable ? (
          // Remounted per draft version: a restore or a save from elsewhere shows the new draft.
          <PageEditor
            key={page.version}
            history={history.ok ? history.data : null}
            page={page}
            canEdit={site.canEdit}
            canPublish={site.canPublish}
            siteLabel={SITE_SHORT[site.key]}
            siteKey={site.key}
            siteSeo={siteSeo}
            menuTargets={menuTargets?.ok ? menuTargets.data : null}
            origin={site.key === "BV" ? bvPublicOrigin() : null}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
            <EmptyState icon="content" title={t("content.pages.editor.importedTitle")}>
              {t("content.pages.editor.importNotice", {
                note: cmsText(registry?.note, t) ?? t("content.pages.editor.thisDesignedPage"),
              })}
            </EmptyState>
          </div>
        )}
      </div>
    </NoticeProvider>
  );
}
