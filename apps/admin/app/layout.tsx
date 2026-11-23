import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { LocaleProvider } from "../components/i18n/locale-provider";
import { getAdminLocale } from "../lib/i18n/server";
import { THEME_INIT_SCRIPT } from "../lib/theme";
import "./globals.css";

// Archivo is the family web-bv already uses; its width axis gives headings and the wordmark an
// expanded industrial voice while body text stays at normal width.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Dream Petroleum Admin", template: "%s · Dream Petroleum Admin" },
  icons: { icon: "/brand/dream-petroleum-mark.svg" },
  // Staff-only console: never indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1119" },
  ],
};

// ML-11: `lang` and every text follow the dp-admin-locale cookie (English by default). Reading it
// makes each route render per request; the console's routes already did (session cookie).
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getAdminLocale();
  return (
    <html lang={locale} className={archivo.variable} suppressHydrationWarning>
      <head>
        {/* Sets data-theme before first paint so a stored dark theme never flashes light. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
