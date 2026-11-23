import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon } from "../../../components/icons";
import { EmptyState } from "../../../components/ui";
import { findSection } from "../../../lib/navigation";
import { requireStaffSession } from "../../../lib/server-session";
import { getTranslator } from "../../../lib/i18n/server";

export async function generateMetadata({ params }: PageProps<"/[section]">): Promise<Metadata> {
  const { section } = await params;
  const [t, item] = [await getTranslator(), findSection(section)];
  return { title: item ? t(`nav.items.${item.id}.label`) : t("section.notFound") };
}

/** Placeholder for modules that are not built yet. Unknown slugs are a 404. */
export default async function SectionPage({ params }: PageProps<"/[section]">) {
  await requireStaffSession();
  const { section } = await params;
  const item = findSection(section);
  if (!item || item.ready) notFound();
  const t = await getTranslator();
  const icon = item.icon;
  const label = t(`nav.items.${item.id}.label`);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="type-display flex items-center gap-3 text-[1.75rem] font-semibold text-ink sm:text-[2rem]">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-petrol-soft text-petrol-strong ring-1 ring-inset ring-petrol/25">
            <Icon name={icon} size={21} />
          </span>
          {label}
        </h1>
        <p className="mt-2 max-w-[60ch] text-ink-2">{t(`nav.items.${item.id}.summary`)}</p>
      </header>
      <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
        <EmptyState
          icon={icon}
          title={t("section.notAvailable", { label })}
          action={{ href: "/", label: t("common.backToOverview") }}
        >
          {t("section.planned")}
        </EmptyState>
      </div>
    </div>
  );
}
