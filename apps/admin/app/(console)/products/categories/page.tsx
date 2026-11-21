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

export const metadata: Metadata = { title: "Product categories" };

export default async function CategoriesPage({ searchParams }: PageProps<"/products/categories">) {
  await requireStaffSession();
  const query = await searchParams;
  const context = await serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema);
  if (!context.ok || context.data.sites.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader icon="folder" title="Product categories" />
        <EmptyState icon="shield" title="No access to the product catalogue">
          Your roles do not include reading products on any site.
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
        title="Product categories"
        back={{ href: `/products?site=${sp}`, label: "All products" }}
        description="Each site has its own category tree, up to three levels. The default category receives new listings that name no category."
      />
      <div className="flex flex-wrap items-center gap-3">
        <SiteSwitcher sites={sites} current={site.id} hrefFor={hrefFor} />
        <LanguageNav
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
            title={`${localeLabel(lang)} category names on ${SITE_SHORT[site.key]}`}
            description={`Each name next to its ${localeLabel(defaultLocale)} source. A product page in ${localeLabel(lang)} needs its category name; the tree, slugs and order are the same in every language.`}
          >
            <SourceToggle locale={defaultLocale}>
              <ul className="divide-y divide-line">
                {order.map(({ category, depth }) => {
                  const t = translated.items.find((x) => x.id === category.id);
                  if (!t) return null;
                  return (
                    <li
                      key={t.id}
                      className="space-y-2 py-4"
                      style={{ paddingLeft: `${depth * 1.25}rem` }}
                      data-category={t.slug}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-ink">{category.name}</span>
                        <code className="font-mono text-xs text-ink-3">{t.slug}</code>
                        <TranslationStatePill state={t.state} />
                        <span className="text-xs text-ink-3">{`${t.liveProducts} live product${t.liveProducts === 1 ? "" : "s"}`}</span>
                      </div>
                      <CategoryTranslationForm
                        key={`${t.id}-${t.version}`}
                        category={t}
                        locale={lang}
                        enabled={translated.enabled}
                        canEdit={translated.canEdit}
                        idPrefix={`cat-${lang}-${t.id}`}
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
          title={`Categories on ${SITE_SHORT[site.key]}`}
          description={
            list.ok
              ? `${list.data.items.length} categor${list.data.items.length === 1 ? "y" : "ies"}`
              : undefined
          }
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
            <ErrorState title="The categories could not be loaded">
              You are not allowed to read this site&apos;s catalogue.
            </ErrorState>
          )}
        </Panel>
      )}
    </div>
  );
}
