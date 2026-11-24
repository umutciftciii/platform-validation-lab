"use client";
/**
 * The sample-data marker (DP-U), required on every widget that shows lib/demo-data.ts values.
 * ML-12e (DP-243): a client component so its text and its tooltip follow the admin UI language
 * (`common.sampleData`, `common.sampleDataTitle`); the English markup is unchanged.
 */
import { useT } from "./i18n/locale-provider";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export function DemoBadge({ className }: { className?: string }) {
  const t = useT();
  return (
    <span
      data-demo-marker=""
      title={t("common.sampleDataTitle")}
      className={cx(
        "demo-hatch inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber/40 px-2 py-0.5 text-xs font-medium text-amber-ink",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-amber" aria-hidden="true" />
      {t("common.sampleData")}
    </span>
  );
}
