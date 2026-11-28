"use client";
/**
 * CRM-3 (ADR-032 D11): the sections of the CRM — overview, companies, people — as one bar on top
 * of every CRM page. Links, so each section has its own address.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "../i18n/locale-provider";
import { Icon, type IconKey } from "../icons";
import { cx } from "../ui";

const SECTIONS: readonly {
  href: string;
  key: "overview" | "companies" | "people";
  icon: IconKey;
}[] = [
  { href: "/crm", key: "overview", icon: "overview" },
  { href: "/crm/companies", key: "companies", icon: "building" },
  { href: "/crm/people", key: "people", icon: "staff" },
];

export function CrmNav() {
  const t = useT();
  const pathname = usePathname();
  return (
    <nav
      aria-label={t("crm.nav.label")}
      className="-mx-4 border-b border-line px-4 sm:mx-0 sm:px-0"
    >
      <ul className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SECTIONS.map((s) => {
          const active = s.href === "/crm" ? pathname === "/crm" : pathname.startsWith(`${s.href}`);
          return (
            <li key={s.key} className="shrink-0">
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-flex h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors",
                  active
                    ? "border-petrol text-ink"
                    : "border-transparent text-ink-3 hover:border-line-strong hover:text-ink",
                )}
              >
                <Icon name={s.icon} size={16} />
                {t(`crm.nav.${s.key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
