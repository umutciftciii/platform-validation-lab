import type { Metadata } from "next";
import {
  CatalogContextResponseSchema,
  CategoryTranslationListResponseSchema,
  CmsContextResponseSchema,
  type SiteLocale,
} from "@dream/contracts";
import { PageHeader } from "../../../components/catalog/parts";
import { Icon } from "../../../components/icons";
import { TranslationWorkspace } from "../../../components/translations/translation-workspace";
import { EmptyState, ErrorState } from "../../../components/ui";
import { getTranslator } from "../../../lib/i18n/server";
import { serverRead } from "../../../lib/server-api";
import { requireStaffSession } from "../../../lib/server-session";
import type { TranslationSite } from "../../../lib/translation-packages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("translationPackages.metaTitle") };
}

/** The languages a package can be exported for: enabled, not the default (ML-13a `env`). */
function targetsOf(locales: readonly SiteLocale[]) {
  return locales
    .filter((l) => l.enabled && !l.isDefault)
    .map((l) => ({ locale: l.locale, public: l.public }));
}

/**
 * ML-13b (DP-244): Admin > Translations. The sites come from the CMS context (`content:read`,
 * with their languages) and the catalogue context (`product:read`, `product:edit`); a site the
 * user reads only in the catalogue gets its languages from the category translations route (any
 * valid tag answers with the site's language list). The client part exports, checks and imports;
 * the API decides every permission and unit (ML-13a).
 */
export default async function TranslationsPage() {
  await requireStaffSession();
  const t = await getTranslator();
  const [cms, catalog] = await Promise.all([
    serverRead("/api/v1/admin/cms/context", CmsContextResponseSchema),
    serverRead("/api/v1/admin/catalog/context", CatalogContextResponseSchema),
  ]);
  const header = (
    <PageHeader
      icon="translate"
      title={t("translationPackages.title")}
      description={t("translationPackages.description")}
    />
  );
  if (!cms.ok && !catalog.ok) {
    return (
      <div className="space-y-6 sm:space-y-8">
        {header}
        <ErrorState title={t("translationPackages.loadError")}>
          {t("translationPackages.tryAgain")}
        </ErrorState>
      </div>
    );
  }
  const cmsSites = cms.ok ? cms.data.sites : [];
  const catalogSites = catalog.ok ? catalog.data.sites : [];
  const ids = [...new Set([...cmsSites, ...catalogSites].map((s) => s.id))];
  const sites: TranslationSite[] = [];
  for (const id of ids) {
    const c = cmsSites.find((s) => s.id === id);
    const p = catalogSites.find((s) => s.id === id);
    let locales = c?.locales ?? [];
    if (!c && p) {
      const list = await serverRead(
        `/api/v1/admin/catalog/sites/${p.id}/categories/translations?locale=en`,
        CategoryTranslationListResponseSchema,
      );
      locales = list.ok ? list.data.locales : [];
    }
    const def = locales.find((l) => l.isDefault)?.locale ?? c?.locale;
    const base = c ?? p;
    if (!def || !base) continue;
    sites.push({
      id,
      key: base.key,
      name: base.name,
      sourceLocale: def,
      targets: targetsOf(locales),
      read: { cms: Boolean(c), catalog: Boolean(p) },
    });
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      {header}
      <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2 ring-1 ring-inset ring-line">
        <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-ink-3" />
        <span>{t("translationPackages.rulesNote")}</span>
      </p>
      {sites.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="shield" title={t("translationPackages.noAccessTitle")}>
            {t("translationPackages.noAccessText")}
          </EmptyState>
        </div>
      ) : (
        <TranslationWorkspace sites={sites} />
      )}
    </div>
  );
}
