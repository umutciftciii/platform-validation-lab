import type { ReactNode } from "react";
import { BrandLogo, RingMotif } from "../icons";
import { ThemeToggle } from "../shell/theme-toggle";
import { cx } from "../ui";

/**
 * The signed-out frame shared by sign-in, enrolment and password reset (DP-U, DP-114): a brand
 * navy rail on large screens, a slim brand band on phones and tablets, the theme switch, and a
 * centred column for the form.
 */
export function AuthFrame({
  railTitle = "One console for both sites.",
  railText = "Pages, product data sheets and staff access for dreampetroleumbv.com and the corporate site.",
  width = "narrow",
  children,
}: {
  railTitle?: string;
  railText?: string;
  /** narrow: sign-in forms; wide: the enrolment steps with a QR code and recovery codes. */
  width?: "narrow" | "wide";
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="on-rail relative isolate hidden overflow-hidden bg-masthead text-rail-ink lg:flex lg:flex-col lg:justify-between lg:p-12">
        <BrandLogo height={60} alt="Dream Petroleum BV, Energy in Motion" />
        <div className="relative z-10 max-w-[30ch]">
          <p className="type-eyebrow flex items-center gap-2 text-rail-ink-dim">
            <span className="h-px w-5 bg-brand" aria-hidden="true" />
            Admin console
          </p>
          <p className="type-display mt-4 text-[2.75rem] font-semibold text-white">{railTitle}</p>
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-rail-ink-dim">{railText}</p>
        </div>
        <p className="flex items-center gap-2 text-xs text-rail-ink-dim">
          <span className="size-1.5 rounded-full bg-rail-accent" aria-hidden="true" />
          Staff only. Every sign-in is recorded.
        </p>
        {/* Signature: concentric rings in the corners, echoing the ring of the DP mark. */}
        <RingMotif size={300} className="pointer-events-none absolute right-0 top-0 -z-10" />
        <RingMotif
          size={420}
          rings={6}
          corner="bottom-right"
          className="pointer-events-none absolute bottom-0 right-0 -z-10 opacity-40"
        />
      </aside>

      <main className="flex min-w-0 flex-col">
        {/* Phones and tablets: a slim brand-navy band carries the full logo, which needs a dark
            background (its wordmark is light grey). */}
        <div className="on-rail relative isolate flex items-center justify-between overflow-hidden bg-masthead px-5 py-3.5 sm:px-10 lg:hidden">
          <BrandLogo height={40} alt="Dream Petroleum BV, Energy in Motion" />
          <RingMotif
            size={120}
            rings={4}
            className="pointer-events-none absolute right-0 top-0 -z-10"
          />
        </div>
        <div className="flex justify-end px-5 pt-5 sm:px-10 lg:pt-6">
          <ThemeToggle />
        </div>
        <div
          className={cx(
            "mx-auto flex w-full flex-1 flex-col justify-center px-5 pb-12 pt-6 lg:py-12",
            width === "narrow" ? "max-w-[400px] sm:px-0" : "max-w-[520px] sm:px-0",
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
