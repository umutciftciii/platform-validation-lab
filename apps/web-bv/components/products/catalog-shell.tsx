import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { cache, Suspense, type ReactNode } from "react";

import SiteFooter from "@/components/ui/site-footer";
import SiteNav from "@/components/ui/site-nav";
import { BRAND_LOGO } from "@/content/brand";
import { getSiteChrome } from "@/lib/cms-home";
import { privacyHref } from "@/lib/privacy";

/** One read of the published navigation and footer per request (both slots use it). */
const chrome = cache((path: string) => getSiteChrome(path));

/**
 * Frame of the product pages. DP-155: the published BV site navigation and footer (the same CMS
 * fragments as every other page), the page in the shared `tp` layout and type scale, and the
 * breadcrumb under the navigation. While the CMS cannot be read, the minimal brand header and
 * legal footer of PM-3 stand in, so the catalogue never depends on the CMS being up.
 */
export function CatalogShell({
  crumbs,
  path = "/products",
  children,
}: {
  crumbs: { label: string; href?: string }[];
  /** The page's path: marks the current navigation item. */
  path?: string;
  children: ReactNode;
}) {
  return (
    <>
      <Suspense fallback={<MinimalHeader />}>
        <CatalogNav path={path} />
      </Suspense>
      <main id="top" className="tp catalog">
        <div className="tp-inner pb-24">
          <Breadcrumb crumbs={crumbs} />
          {children}
        </div>
      </main>
      <Suspense fallback={<MinimalFooter />}>
        <CatalogFooter path={path} />
      </Suspense>
    </>
  );
}

async function CatalogNav({ path }: { path: string }) {
  await connection();
  const { nav } = await chrome(path);
  return nav ? <SiteNav content={nav} /> : <MinimalHeader />;
}

async function CatalogFooter({ path }: { path: string }) {
  await connection();
  const { footer } = await chrome(path);
  return footer ? <SiteFooter content={footer} /> : <MinimalFooter />;
}

function Breadcrumb({ crumbs }: { crumbs: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="pt-8 text-sm text-steel sm:pt-10">
      <ol className="flex flex-wrap items-center gap-2">
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
  );
}

/** PM-3 frame, kept as the fallback while the published navigation cannot be read. */
function MinimalHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex h-[72px] max-w-6xl items-center px-4 sm:px-8">
        <Link href="/" aria-label="Dream Petroleum BV home" className="shrink-0">
          <Image
            src={BRAND_LOGO.src}
            alt={BRAND_LOGO.alt}
            width={BRAND_LOGO.width}
            height={BRAND_LOGO.height}
            className="h-8 w-auto sm:h-10"
            priority
          />
        </Link>
      </div>
    </header>
  );
}

/** DP-095 D-T5: the legal line under every catalogue page; the policy link only where published. */
function MinimalFooter() {
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
