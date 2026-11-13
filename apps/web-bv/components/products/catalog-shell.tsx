import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { SITE_NAV } from "@/content/site-nav";
import { privacyHref } from "@/lib/privacy";

/** Header and frame of the product pages (PM-3): the brand, a way home and the breadcrumb. */
export function CatalogShell({
  crumbs,
  children,
}: {
  crumbs: { label: string; href?: string }[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,var(--color-navy),var(--color-ink)_70%)]">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <Link href="/" aria-label="Dream Petroleum BV home" className="shrink-0">
          <Image
            src={SITE_NAV.logo.src}
            alt={SITE_NAV.logo.alt}
            width={SITE_NAV.logo.width}
            height={SITE_NAV.logo.height}
            className="h-8 w-auto sm:h-10"
            priority
          />
        </Link>
        <nav aria-label="Breadcrumb" className="min-w-0 text-sm text-steel">
          <ol className="flex items-center gap-2">
            {crumbs.map((c, i) => (
              <li key={c.label} className="flex min-w-0 items-center gap-2">
                {i > 0 ? <span aria-hidden="true">/</span> : null}
                {c.href ? (
                  <Link href={c.href} className="truncate hover:text-glass">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="truncate text-glass">
                    {c.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-24 sm:px-8">{children}</main>
      <ShellFooter />
    </div>
  );
}

/** DP-095 D-T5: the legal line under every catalogue page; the policy link only where published. */
function ShellFooter() {
  const href = privacyHref();
  return (
    <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-glass/10 px-4 py-6 text-xs text-steel sm:px-8">
      <p>© 2026 Dream Petroleum BV</p>
      {href ? (
        <a href={href} className="hover:text-glass">
          Privacy Policy
        </a>
      ) : null}
    </footer>
  );
}

/** A quiet panel for empty and error states. */
export function CatalogNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-glass/10 bg-glass/[0.03] px-6 py-14 text-center">
      <p className="text-lg font-medium text-glass">{title}</p>
      <p className="mx-auto mt-2 max-w-[48ch] text-sm text-steel">{children}</p>
    </div>
  );
}
