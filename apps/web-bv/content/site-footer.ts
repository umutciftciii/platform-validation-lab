/**
 * Footer copy and destinations. A CMS can fill this same structure later.
 *
 * Everything except the headline and the column titles is copied from the live footer
 * at https://dreampetroleumbv.com/en (checked 2026-11-06). Keep the address, phone and
 * email identical to that source.
 *
 * Inner pages don't exist in this prototype, so links go to the live site, as the
 * Services cards do. `href: null` marks a page that exists nowhere yet: it renders as
 * plain text, which can't lead to a 404 and needs no script. The live site's Privacy
 * Policy and Terms & Conditions links both point to "#". Privacy Policy now has its own
 * page (DP-095), shown only where it is published; Terms & Conditions has none yet.
 */

import { SITE_NAV } from "@/content/site-nav";

const SITE = "https://dreampetroleumbv.com/en";

export type FooterLink = { label: string; href: string | null };

export type FooterColumn = { title: string; links: FooterLink[] };

export type SiteFooterContent = {
  headline: string;
  cta: { label: string; href: string };
  logo: { src: string; alt: string; width: number; height: number };
  homeHref: string;
  homeLabel: string;
  intro: string;
  contact: {
    title: string;
    company: string;
    addressLines: string[];
    phone: { label: string; href: string; note: string };
    email: { label: string; href: string; note: string };
  };
  navLabel: string;
  columns: FooterColumn[];
  copyright: string;
  legalLabel: string;
  legal: FooterLink[];
  pendingNote: string;
};

export const SITE_FOOTER: SiteFooterContent = {
  headline: "Let’s Move Energy Forward.",
  cta: { label: "Get in Touch", href: `${SITE}/contact` },
  logo: SITE_NAV.logo,
  homeHref: "#top",
  homeLabel: "back to top of page",
  intro:
    "Dream Petroleum BV is a global leader in the trading and distribution of high-quality base oils and petrochemical products. We add value to the energy sector through our strategic Rotterdam-based logistics network.",
  contact: {
    title: "Contact Us",
    company: "Dream Petroleum B.V.",
    addressLines: ["Herengracht 420", "1017 AMSTERDAM"],
    phone: {
      label: "020 210 13 50",
      href: "tel:+31202101350",
      note: "Mon–Fri 08:30–18:30",
    },
    email: {
      label: "info@dreampetroleumbv.com",
      href: "mailto:info@dreampetroleumbv.com",
      note: "We reply within 24h",
    },
  },
  navLabel: "Footer",
  columns: [
    {
      title: "Products",
      links: [
        { label: "Base Oils (Group I, II & III)", href: `${SITE}/products` },
        { label: "High-Quality Solvents", href: `${SITE}/products` },
        { label: "Petrochemicals", href: `${SITE}/products` },
      ],
    },
    {
      title: "Services",
      links: [
        { label: "Sea & Road Logistics", href: `${SITE}/logistics` },
        { label: "Energy Trading & Supply", href: `${SITE}/energy-trading` },
        { label: "Storage & Distribution", href: `${SITE}/storage-distribution` },
      ],
    },
    {
      title: "Company & Resources",
      links: [
        { label: "About Us", href: `${SITE}/about-us` },
        { label: "Strategic Partnership", href: `${SITE}/strategic-partnership` },
        { label: "Sustainability", href: `${SITE}/sustainability` },
        { label: "Leadership Team", href: `${SITE}/our-team` },
        { label: "News & Insights", href: `${SITE}/blog` },
        { label: "Contact Us", href: `${SITE}/contact` },
      ],
    },
  ],
  copyright: "© 2026 Dream Petroleum BV. All rights reserved.",
  legalLabel: "Legal",
  legal: [
    // DP-095 D-T5: the component drops this link where the policy is not published.
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms & Conditions", href: null },
  ],
  pendingNote: "page not available yet",
};
