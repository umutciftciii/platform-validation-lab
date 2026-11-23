import type { Metadata } from "next";
import {
  CatalogContextResponseSchema,
  CategoryListResponseSchema,
  CategoryTranslationListResponseSchema,
  LocaleTagSchema,
  type CatalogSite,
} from "@dream/contracts";
import { CategoryManager } from "../../../../components/catalog/category-manager";
import { LanguageNav } from "../../../../components/catalog/language-nav";
import { NoticeProvider } from "../../../../components/catalog/notices";
import {
  CategoryTranslationForm,
  SourceToggle,
  TranslationStatePill,
} from "../../../../components/catalog/translation-editor";
import { flattenTree } from "../../../../lib/catalog-view";
import { localeLabel } from "../../../../lib/translations";
import { getTranslator } from "../../../../lib/i18n/server";
import {
  PageHeader,
  pickSite,
  SITE_SHORT,
  SiteSwitcher,
  siteParam,
} from "../../../../components/catalog/parts";
import { EmptyState, ErrorState, Panel } from "../../../../components/ui";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("catalog.taxonomy.categoriesPage.title") };
}

export default async function CategoriesPage({ searchParams }: PageProps<"/products/categories">) {
  await requireStaffSession();
  const t = await getTranslator();
  const query = await searchParams;
  const context = await serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="folder" title={t("catalog.taxonomy.categoriesPage.title")} />
        <EmptyState icon="shield" title={t("catalog.taxonomy.shared.noAccessTitle")}>
          {t("catalog.taxonomy.shared.noAccessBody")}
        </EmptyState>
      </div>
    );
  }
  const { sites } = context.data;
  const site = pickSite(sites, typeof query["site"] === "string" ? query["site"] : undefined);
  const sp = siteParam(site);
  // ML-8b: `?lang=` another language of the site (its category names next to the source).
  const rawLang = typeof query["lang"] === "string" ? query["lang"] : undefined;
  const asked = rawLang && LocaleTagSchema.safeParse(rawLang).success ? rawLang : undefined;
  const [list, texts] = await Promise.all([
    serverRead(`/api/v1/admin/catalog/sites/${site.id}/categories`, CategoryListResponseSchema),
    serverRead(
      `/api/v1/admin/catalog/sites/${site.id}/categories/translations?locale=${asked ?? "en"}`,
      CategoryTranslationListResponseSchema,
    ),
  ]);
  const hrefFor = (s: CatalogSite) => `/products/categories?site=${siteParam(s)}`;
  const enabled = texts.ok ? texts.data.locales.filter((l) => l.enabled).map((l) => l.locale) : [];
  const defaultLocale = texts.ok ? texts.data.defaultLocale : "en";
  const lang = asked && enabled.includes(asked) ? asked : defaultLocale;
  const translated =
    texts.ok && lang !== defaultLocale && texts.data.locale === lang ? texts.data : null;
  const order = list.ok ? flattenTree(list.data.items) : [];

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="folder"
        title={t("catalog.taxonomy.categoriesPage.title")}
        back={{ href: `/products?site=${sp}`, label: t("catalog.taxonomy.shared.allProducts") }}
        description={t("catalog.taxonomy.categoriesPage.description")}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SiteSwitcher
          sites={sites}
          current={site.id}
          hrefFor={hrefFor}
          label={t("catalog.common.site")}
        />
        <LanguageNav
          label={t("catalog.list.language.label")}
          locales={enabled}
          current={lang}
          sourceLocale={defaultLocale}
          hrefFor={(l) =>
            `/products/categories?site=${sp}${l === defaultLocale ? "" : `&lang=${l}`}`
          }
        />
      </div>
      {translated ? (
        <NoticeProvider>
          <Panel
            id="categories-translation"
            title={t("catalog.taxonomy.categoriesPage.translationTitle", {
              language: localeLabel(lang, t),
              site: SITE_SHORT[site.key],
            })}
            description={t("catalog.taxonomy.categoriesPage.translationDescription", {
              source: localeLabel(defaultLocale, t),
              language: localeLabel(lang, t),
            })}
          >
            <SourceToggle locale={defaultLocale}>
              <ul className="divide-y divide-line">
                {order.map(({ category, depth }) => {
                  const item = translated.items.find((x) => x.id === category.id);
                  if (!item) return null;
                  return (
                    <li
                      key={item.id}
                      className="space-y-2 py-4"
                      style={{ paddingLeft: `${depth * 1.25}rem` }}
                      data-category={item.slug}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-ink">{category.name}</span>
                        <code className="font-mono text-xs text-ink-3">{item.slug}</code>
                        <TranslationStatePill state={item.state} />
                        <span className="text-xs text-ink-3">
                          {t("catalog.taxonomy.categoriesPage.liveProducts", {
                            count: item.liveProducts,
                          })}
                        </span>
                      </div>
                      <CategoryTranslationForm
                        key={`${item.id}-${item.version}`}
                        category={item}
                        locale={lang}
                        enabled={translated.enabled}
                        canEdit={translated.canEdit}
                        // i18n-ignore: DOM element id, not UI text
                        idPrefix={`cat-${lang}-${item.id}`}
                      />
                    </li>
                  );
                })}
              </ul>
            </SourceToggle>
          </Panel>
        </NoticeProvider>
      ) : (
        <Panel
          id="categories"
          title={t("catalog.taxonomy.categoriesPage.panelTitle", { site: SITE_SHORT[site.key] })}
          description={
            list.ok
              ? t("catalog.taxonomy.categoriesPage.count", { count: list.data.items.length })
              : undefined
          }
          // i18n-ignore: CSS class list
          bodyClassName="px-0! pb-5! pt-3!"
        >
          {list.ok ? (
            <CategoryManager
              key={site.id}
              siteId={site.id}
              siteName={SITE_SHORT[site.key]}
              items={list.data.items}
              canEdit={site.canEdit}
            />
          ) : (
            <ErrorState title={t("catalog.taxonomy.categoriesPage.loadErrorTitle")}>
              {t("catalog.taxonomy.categoriesPage.loadErrorBody")}
            </ErrorState>
          )}
        </Panel>
      )}
    </div>
  );
}
