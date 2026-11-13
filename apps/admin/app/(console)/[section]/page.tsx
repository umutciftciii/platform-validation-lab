import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon } from "../../../components/icons";
import { EmptyState } from "../../../components/ui";
import { findSection } from "../../../lib/navigation";
import { requireStaffSession } from "../../../lib/server-session";

export async function generateMetadata({ params }: PageProps<"/[section]">): Promise<Metadata> {
  const { section } = await params;
  return { title: findSection(section)?.label ?? "Not found" };
}

/** Placeholder for modules that are not built yet. Unknown slugs are a 404. */
export default async function SectionPage({ params }: PageProps<"/[section]">) {
  await requireStaffSession();
  const { section } = await params;
  const item = findSection(section);
  if (!item || item.ready) notFound();
  const icon = item.icon;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="type-display flex items-center gap-3 text-[1.75rem] font-semibold text-ink sm:text-[2rem]">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-petrol-soft text-petrol-strong ring-1 ring-inset ring-petrol/25">
            <Icon name={icon} size={21} />
          </span>
          {item.label}
        </h1>
        <p className="mt-2 max-w-[60ch] text-ink-2">{item.summary}</p>
      </header>
      <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
        <EmptyState
          icon={icon}
          title={`${item.label} is not available yet`}
          action={{ href: "/", label: "Back to overview" }}
        >
          This module is planned for a later release of the admin console. Nothing here can be
          changed yet.
        </EmptyState>
      </div>
    </div>
  );
}
