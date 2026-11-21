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
import { PageHeader } from "../../../../components/catalog/parts";
import { SpecDefinitionManager } from "../../../../components/catalog/spec-definitions";
import { EmptyState, ErrorState, Panel } from "../../../../components/ui";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export const metadata: Metadata = { title: "Specifications" };

export default async function SpecificationsPage({
  searchParams,
}: PageProps<"/products/specifications">) {
  await requireStaffSession();
  const query = await searchParams;
  // ML-8b: `?lang=` another enabled language (the specification names next to English).
  const rawLang = typeof query["lang"] === "string" ? query["lang"] : undefined;
  const asked = rawLang && LocaleTagSchema.safeParse(rawLang).success ? rawLang : undefined;
  const context = await serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="list" title="Specifications" />
        <EmptyState icon="shield" title="No access to the product catalogue">
          Your roles do not include reading products on any site.
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
          title="Specifications"
          back={{ href: "/products", label: "All products" }}
          description="Technical properties tracked for every product master: type, units, test methods and limits. Defined once for the whole platform."
        />
        <LanguageNav
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
            title={`${localeLabel(lang)} specification names`}
            description={`Shared by every product and site. Keys, units, test methods and limits are the same in every language.`}
          >
            <SourceToggle locale={source}>
              <SpecNamesTranslationForm
                key={translated.items.map((d) => `${d.id}:${d.version}`).join(",")}
                rows={translated.items}
                locale={lang}
                enabled={translated.enabled}
                canEdit={translated.canEdit}
                idPrefix={`defs-${lang}`}
                emptyText="No specifications are defined yet."
              />
            </SourceToggle>
          </Panel>
        ) : (
          <Panel
            id="definitions"
            title="Specification definitions"
            description={list.ok ? `${list.data.items.length} defined` : undefined}
            bodyClassName="px-0! pb-5! pt-3!"
          >
            {list.ok ? (
              <SpecDefinitionManager items={list.data.items} canEdit={context.data.canEditMaster} />
            ) : (
              <ErrorState title="The specifications could not be loaded">
                Try again in a moment.
              </ErrorState>
            )}
          </Panel>
        )}
      </div>
    </NoticeProvider>
  );
}
