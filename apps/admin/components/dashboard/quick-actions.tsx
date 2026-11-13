import Link from "next/link";
import { Icon, type IconKey } from "../icons";

interface QuickAction {
  href: string;
  label: string;
  detail: string;
  icon: IconKey;
}

// Each action opens its module. Until a module ships, its page says so; the API still decides
// whether the person may do the action once it exists.
const ACTIONS: readonly QuickAction[] = [
  { href: "/content", label: "Write a page", detail: "Draft for either site", icon: "content" },
  {
    href: "/products",
    label: "Update a data sheet",
    detail: "Product specifications",
    icon: "products",
  },
  { href: "/staff", label: "Invite a colleague", detail: "Staff account and role", icon: "staff" },
  { href: "/audit", label: "Open the audit log", detail: "Who changed what, when", icon: "audit" },
];

export function QuickActions() {
  return (
    <section aria-labelledby="quick-title">
      <h2 id="quick-title" className="sr-only">
        Quick actions
      </h2>
      <ul className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {ACTIONS.map((a) => (
          <li key={a.href}>
            <Link
              href={a.href}
              className="group flex h-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-3 transition-[border-color,background-color,box-shadow] duration-150 hover:border-petrol/50 hover:bg-petrol-soft/40 hover:shadow-panel sm:gap-3.5 sm:px-4 sm:py-3.5"
            >
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2 ring-1 ring-inset ring-line transition-colors duration-150 group-hover:bg-petrol group-hover:text-petrol-ink group-hover:ring-petrol sm:size-10">
                <Icon name={a.icon} size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.8125rem] font-semibold leading-snug text-ink sm:text-sm">
                  {a.label}
                </span>
                <span className="hidden truncate text-xs text-ink-3 sm:block">{a.detail}</span>
              </span>
              <Icon
                name="arrow"
                size={16}
                className="hidden shrink-0 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-petrol sm:block"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
