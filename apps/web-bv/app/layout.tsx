import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

// Temporary: no official ICCSYN typeface has been supplied. The width axis gives
// the wordmark an expanded industrial voice from a single family.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: "ICCSYN hero prototype",
  description: "Scroll hero prototype for Dream Petroleum B.V.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
