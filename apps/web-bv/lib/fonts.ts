import { Archivo } from "next/font/google";

// Temporary: no official ICCSYN typeface has been supplied. The width axis gives
// the wordmark an expanded industrial voice from a single family.
// ML-3: shared by the root layouts (`app/[locale]`, `app/(preview)`) and the global 404.
export const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});
