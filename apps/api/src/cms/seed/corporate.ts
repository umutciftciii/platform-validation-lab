/**
 * COM-1: import source of the dreampetroleum.com fragments (navigation, footer, SEO defaults),
 * through the same "Import into CMS" path as the BV fragments (ADR-020 D7). Used by the import and
 * nothing else; it never overwrites a fragment that exists (the CMS is the single source).
 *
 * Every text and value is taken from the live English site (https://dreampetroleum.com/en, header
 * and footer, read 2026-11-27); nothing is invented:
 *  - menu labels and their order are the live header's; the live pages do not exist on the new
 *    site yet (COM-5 imports them), so every link except the home page is "not ready yet" (shown
 *    as text) until an editor points it at the imported page;
 *  - the footer's company text, head office address, phone, e-mail and social profiles are the live
 *    footer's (the e-mail address is the one the live page protects against scrapers);
 *  - the SEO defaults are the live site's title and its company overview sentence (the live pages
 *    have no meta description). No default Open Graph image: the corporate site has no media of
 *    its own yet (COM-2/COM-5).
 * Turkish versions are translations made in the admin (ML-2 "Create translation"), not seeds.
 */
import type { BvFooterMenuInput, BvNavMenuInput, BvSiteSeoContent } from "@dream/contracts";

const NONE = { type: "none" } as const;
const HOME = { type: "path", path: "/" } as const;

const PENDING = "Coming soon";

export const CORPORATE_NAV_SEED: BvNavMenuInput = {
  items: [
    { label: "Home", target: HOME },
    { label: "Products", target: NONE },
    {
      label: "Services",
      target: NONE,
      children: [
        { label: "Logistics", target: NONE },
        { label: "Energy Trading & Supply", target: NONE },
        { label: "Storage & Distribution", target: NONE },
      ],
    },
    {
      label: "Company",
      target: NONE,
      children: [
        { label: "About Us", target: NONE },
        { label: "Strategic Partnership", target: NONE },
        { label: "Sustainability", target: NONE },
        { label: "Our Team", target: NONE },
      ],
    },
    { label: "Blogs", target: NONE },
  ],
  contact: { label: "Contact Us", target: NONE },
  noScriptLinks: [{ label: "Home", target: HOME }],
  pendingNote: PENDING,
};

const OVERVIEW =
  "Dream Petroleum is a global energy and petroleum investment company operating across midstream and downstream markets.";

export const CORPORATE_FOOTER_SEED: BvFooterMenuInput = {
  headline: "Global Energy Markets",
  cta: {
    label: "Email Us",
    target: { type: "url", url: "mailto:info@dreampetroleum.com" },
  },
  intro: OVERVIEW,
  contact: {
    title: "Contact Us",
    company: "Dream Petroleum",
    addressLines: [
      { text: "Head Office Quasar Residence, Floor 15 Apt. 1507" },
      { text: "Büyükdere Ave. No:76, Fulya Neighborhood" },
      { text: "Mecidiyeköy, Şişli — Istanbul, Türkiye" },
    ],
    phone: { label: "+90 212 218 13 57", href: "tel:+902122181357", note: "Call Us" },
    email: {
      label: "info@dreampetroleum.com",
      href: "mailto:info@dreampetroleum.com",
      note: "Email Us",
    },
  },
  columns: [
    {
      title: "Core Areas",
      links: [
        { label: "Transportation, Storage & Wholesale Marketing", target: NONE },
        { label: "Energy Trading & Supply", target: NONE },
        { label: "Storage & Distribution", target: NONE },
        { label: "Base Oils (Group I, II and III)", target: NONE },
        { label: "Petrochemical Products", target: NONE },
        { label: "Sea & Road Logistics", target: NONE },
      ],
    },
    {
      title: "Company Profile",
      links: [
        { label: "About Us", target: NONE },
        { label: "Our Team", target: NONE },
        { label: "Strategic Partnership", target: NONE },
        { label: "Core Strengths", target: NONE },
        { label: "Contact Us", target: NONE },
      ],
    },
  ],
  social: [
    {
      network: "linkedin",
      label: "LinkedIn",
      url: "https://www.linkedin.com/company/dream-petroleum-kim-ltd-%C5%9Fti%CC%87",
    },
    { network: "instagram", label: "Instagram", url: "https://www.instagram.com/dream.petroleum" },
  ],
  copyright: "© 2026 - Dream Petroleum",
  // The site hides the Privacy Policy link where the policy is not published (DP-095).
  legal: [{ label: "Privacy Policy", target: { type: "path", path: "/privacy" } }],
  pendingNote: PENDING,
};

export const CORPORATE_SITE_SEO_SEED: Omit<BvSiteSeoContent, "defaultOgImage"> & {
  defaultOgImage: null;
} = {
  siteName: "Dream Petroleum",
  defaultTitle: "Dream Petroleum - Global Energy Markets",
  defaultDescription: OVERVIEW,
  defaultOgImage: null,
};

export const CORPORATE_SEEDS: Readonly<Record<string, { title: string; content: unknown }>> = {
  "corporate.site-nav": { title: "Navigation", content: CORPORATE_NAV_SEED },
  "corporate.site-footer": { title: "Footer", content: CORPORATE_FOOTER_SEED },
  "corporate.site-seo": { title: "SEO defaults", content: CORPORATE_SITE_SEO_SEED },
};
