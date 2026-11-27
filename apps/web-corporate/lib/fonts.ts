import { Inter_Tight, Manrope } from "next/font/google";

/**
 * COM-2a: the corporate typefaces of dreampetroleum.com (the live site's own: Inter Tight for
 * headings, Manrope for text). next/font downloads them at build time and serves them from this
 * site (no request to a font service from the visitor's browser). `latin-ext` for Turkish.
 * Shared by the root layouts (`app/[locale]`, `app/(preview)`) and the global 404.
 */
export const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

/** The class names of the root `<html>` that define both font variables. */
export const fontVariables = `${interTight.variable} ${manrope.variable}`;
