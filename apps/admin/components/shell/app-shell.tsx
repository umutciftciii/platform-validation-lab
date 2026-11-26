"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NAV_ITEMS, isActive, type NavFeatures } from "../../lib/navigation";
import { trapTab } from "../dialog";
import { BrandMark, Icon } from "../icons";
import { buttonStyles, cx } from "../ui";
import { useT } from "../i18n/locale-provider";
import { LanguageSwitcher } from "./language-switcher";
import { Sidebar } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu, type ShellUser } from "./user-menu";

/**
 * Console frame. Desktop (lg+): full brand-navy sidebar. Tablet (md): icon rail.
 * Phone: top bar with a menu button that opens the sidebar as a modal drawer.
 */
export function AppShell({
  user,
  environmentLabel,
  isOwner = false,
  reviewOnly = false,
  features = {},
  children,
}: {
  user: ShellUser;
  environmentLabel: string;
  isOwner?: boolean;
  /** DP-172: a company reviewer sees only the company review. */
  reviewOnly?: boolean;
  /** DP-287: the session's feature flags (the AI Center is hidden while AI is off). */
  features?: NavFeatures;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const t = useT();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const current = NAV_ITEMS.find((i) => isActive(i, pathname));

  useEffect(() => {
    if (!drawerOpen) return;
    const menuButton = menuRef.current;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      menuButton?.focus();
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-svh">
      <a
        inert={drawerOpen}
        href="#main"
        className="sr-only z-50 rounded-lg bg-petrol px-4 py-2 text-petrol-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {t("shell.skipToContent")}
      </a>

      {/* Tablet rail and desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[76px] md:block lg:hidden">
        <Sidebar
          isOwner={isOwner}
          reviewOnly={reviewOnly}
          features={features}
          compact
          environmentLabel={environmentLabel}
        />
      </aside>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] lg:block">
        <Sidebar
          isOwner={isOwner}
          reviewOnly={reviewOnly}
          features={features}
          environmentLabel={environmentLabel}
        />
      </aside>

      {/* Phone drawer */}
      <div
        className={cx(
          "fixed inset-0 z-50 overflow-hidden md:hidden",
          drawerOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!drawerOpen}
      >
        <div
          className={cx(
            "absolute inset-0 bg-[#07121f]/55 transition-opacity duration-200",
            drawerOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setDrawerOpen(false)}
        />
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("shell.navigation")}
          inert={!drawerOpen}
          onKeyDown={(e) => trapTab(e, drawerRef.current)}
          className={cx(
            "absolute inset-y-0 left-0 w-[min(84vw,300px)] shadow-raised transition-transform duration-300 ease-out-soft",
            drawerOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <Sidebar
            isOwner={isOwner}
            reviewOnly={reviewOnly}
            features={features}
            environmentLabel={environmentLabel}
            onNavigate={() => setDrawerOpen(false)}
          />
          <button
            ref={closeRef}
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="on-rail absolute right-3 top-3.5 inline-flex size-9 items-center justify-center rounded-lg text-rail-ink-dim transition-colors hover:bg-rail-2 hover:text-white"
          >
            <Icon name="close" size={18} />
            <span className="sr-only">{t("shell.closeNavigation")}</span>
          </button>
        </div>
      </div>

      {/* DP-268: while the phone drawer is open the page behind it takes no focus. */}
      <div className="md:pl-[76px] lg:pl-[264px]" inert={drawerOpen}>
        <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2.5 px-3 sm:h-16 sm:gap-3 sm:px-6 lg:px-10">
            <button
              ref={menuRef}
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-expanded={drawerOpen}
              className={cx(buttonStyles.icon, "-ml-1.5 md:hidden")}
            >
              <Icon name="menu" />
              <span className="sr-only">{t("shell.openNavigation")}</span>
            </button>
            <span className="md:hidden">
              <BrandMark size={28} />
            </span>
            <nav aria-label={t("shell.breadcrumb")} className="min-w-0 flex-1">
              <ol className="flex items-center gap-1.5 text-sm">
                <li className="hidden text-ink-3 sm:block">{t("shell.admin")}</li>
                <li className="hidden text-ink-3 sm:block" aria-hidden="true">
                  <Icon name="chevron" size={14} />
                </li>
                <li className="truncate font-medium text-ink" aria-current="page">
                  {current ? t(`nav.items.${current.id}.label`) : t("shell.admin")}
                </li>
              </ol>
            </nav>
            <span className="hidden sm:contents">
              <LanguageSwitcher />
              <ThemeToggle />
            </span>
            <UserMenu user={user} />
          </div>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="mx-auto max-w-[1400px] px-4 pb-10 pt-5 outline-none sm:px-6 sm:py-8 lg:px-10 lg:py-10"
        >
          {children}
          <div className="mt-12 flex items-center justify-between border-t border-line pt-5 text-xs text-ink-3 sm:hidden">
            <span>{t("shell.theme")}</span>
            <ThemeToggle />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-ink-3 sm:hidden">
            <span>{t("language.label")}</span>
            <LanguageSwitcher />
          </div>
        </main>
      </div>
    </div>
  );
}
