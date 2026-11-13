import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={archivo.variable} suppressHydrationWarning>
      <head>
        {/* Sets data-theme before first paint so a stored dark theme never flashes light. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
