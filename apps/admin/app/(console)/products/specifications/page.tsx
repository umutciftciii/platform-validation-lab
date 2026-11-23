import type { Metadata } from "next";
import {
  CatalogContextResponseSchema,
  LocaleTagSchema,
  SpecDefinitionListResponseSchema,
  SpecDefinitionTranslationListResponseSchema,
} from "@dream/contracts";
import { LanguageNav } from "../../../../components/catalog/language-nav";
import { NoticeProvider } from "../../../../components/catalog/notices";
import {
  SourceToggle,
  SpecNamesTranslationForm,
} from "../../../../components/catalog/translation-editor";
import { localeLabel } from "../../../../lib/translations";
import { getTranslator } from "../../../../lib/i18n/server";
import { PageHeader } from "../../../../components/catalog/parts";
import { SpecDefinitionManager } from "../../../../components/catalog/spec-definitions";
import { EmptyState, ErrorState, Panel } from "../../../../components/ui";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("catalog.taxonomy.specificationsPage.title") };
}

export default async function SpecificationsPage({
  searchParams,
}: PageProps<"/products/specifications">) {
  await requireStaffSession();
  const t = await getTranslator();
  const query = await searchParams;
  // ML-8b: `?lang=` another enabled language (the specification names next to English).
  const rawLang = typeof query["lang"] === "string" ? query["lang"] : undefined;
  const asked = rawLang && LocaleTagSchema.safeParse(rawLang).success ? rawLang : undefined;
  const context = await serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="list" title={t("catalog.taxonomy.specificationsPage.title")} />
        <EmptyState icon="shield" title={t("catalog.taxonomy.shared.noAccessTitle")}>
          {t("catalog.taxonomy.shared.noAccessBody")}
        </EmptyState>
      </div>
    );
  }
  const [list, texts] = await Promise.all([
    serverRead("/api/v1/admin/catalog/spec-definitions", SpecDefinitionListResponseSchema),
    serverRead(
      `/api/v1/admin/catalog/spec-definitions/translations?locale=${asked ?? "en"}`,
      SpecDefinitionTranslationListResponseSchema,
    ),
  ]);
  const locales = texts.ok ? texts.data.locales : [];
  const source = texts.ok ? texts.data.sourceLocale : "en";
  const lang = asked && locales.includes(asked) ? asked : source;
  const translated = texts.ok && lang !== source && texts.data.locale === lang ? texts.data : null;
  return (
    <NoticeProvider>
      <div className="space-y-6 sm:space-y-8">
        <PageHeader
          icon="list"
          title={t("catalog.taxonomy.specificationsPage.title")}
          back={{ href: "/products", label: t("catalog.taxonomy.shared.allProducts") }}
          description={t("catalog.taxonomy.specificationsPage.description")}
        />
        <LanguageNav
          label={t("catalog.list.language.label")}
          locales={locales}
          current={lang}
          sourceLocale={source}
          hrefFor={(l) =>
            l === source ? "/products/specifications" : `/products/specifications?lang=${l}`
          }
        />
        {translated ? (
          <Panel
            id="definitions-translation"
            title={t("catalog.taxonomy.specificationsPage.translationTitle", {
              language: localeLabel(lang, t),
            })}
            description={t("catalog.taxonomy.specificationsPage.translationDescription")}
          >
            <SourceToggle locale={source}>
              <SpecNamesTranslationForm
                key={translated.items.map((d) => `${d.id}:${d.version}`).join(",")}
                rows={translated.items}
                locale={lang}
                enabled={translated.enabled}
                canEdit={translated.canEdit}
                idPrefix={`defs-${lang}`}
                emptyText={t("catalog.taxonomy.specificationsPage.translationEmpty")}
              />
            </SourceToggle>
          </Panel>
        ) : (
          <Panel
            id="definitions"
            title={t("catalog.taxonomy.specificationsPage.panelTitle")}
            description={
              list.ok
                ? t("catalog.taxonomy.specificationsPage.defined", { n: list.data.items.length })
                : undefined
            }
            // i18n-ignore: CSS class list
            bodyClassName="px-0! pb-5! pt-3!"
          >
            {list.ok ? (
              <SpecDefinitionManager items={list.data.items} canEdit={context.data.canEditMaster} />
            ) : (
              <ErrorState title={t("catalog.taxonomy.specificationsPage.loadErrorTitle")}>
                {t("catalog.taxonomy.specificationsPage.loadErrorBody")}
              </ErrorState>
            )}
          </Panel>
        )}
      </div>
    </NoticeProvider>
  );
}
