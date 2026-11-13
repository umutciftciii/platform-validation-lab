/**
 * Brand assets of the BV site that stay in code (ADR-020 D3): the logo and the in-page home link.
 * Everything editorial (texts, links, images) comes from the CMS (lib/cms-home.ts).
 */
export const BRAND_LOGO = {
  src: "/media/brand/dream-petroleum-logo.svg",
  alt: "Dream Petroleum BV, Energy in Motion",
  width: 871,
  height: 240,
} as const;

export const HOME_HREF = "#top";
