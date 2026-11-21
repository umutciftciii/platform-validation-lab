/**
 * ML-7 (DP-238, ADR-028 D6/D12): the Dutch PROPOSAL for the texts of the BV menus (header
 * `bv.site-nav`, footer `bv.site-footer`), used only by "Create translation" with
 * `proposal: true`. It fills a NEW DRAFT; nothing here is ever published by itself, and the draft
 * goes through the normal review, preview and publication of the CMS (DP-252: Dutch language
 * review before `nl` becomes public).
 *
 * Written by hand for B2B petroleum and energy trading (formal register, "u"/"wij"); no machine
 * translation. Brand names, product codes, international designations ("Group I, II & III",
 * "CTL"), units, addresses, telephone numbers and e-mail addresses stay as they are.
 *
 * Matching is by the exact English text of the source (trimmed); a text without an entry stays
 * empty in the draft for the editor to write. `MENU_NL_BY_PLACE` wins over `MENU_NL` for a text
 * whose Dutch form depends on where it stands.
 */

/** English menu text → Dutch proposal. */
export const MENU_NL: Readonly<Record<string, string>> = {
  // header
  Home: "Startpagina",
  Products: "Producten",
  Services: "Diensten",
  Company: "Bedrijf",
  Blogs: "Nieuws",
  "Contact Us": "Neem contact op",
  Contact: "Contact opnemen",
  "This page isn't ready yet.": "Deze pagina is nog niet beschikbaar.",
  "CTL Technology": "CTL-technologie",
  Applications: "Toepassingen",
  // footer
  "Let’s Move Energy Forward.": "Samen brengen we energie in beweging.",
  "Get in Touch": "Neem contact op",
  "Dream Petroleum BV is a global leader in the trading and distribution of high-quality base oils and petrochemical products. We add value to the energy sector through our strategic Rotterdam-based logistics network.":
    "Dream Petroleum BV is wereldwijd toonaangevend in de handel in en distributie van hoogwaardige basisoliën en petrochemische producten. Via ons strategische logistieke netwerk vanuit Rotterdam voegen wij waarde toe aan de energiesector.",
  "Base Oils (Group I, II & III)": "Basisoliën (Group I, II & III)",
  "High-Quality Solvents": "Hoogwaardige oplosmiddelen",
  Petrochemicals: "Petrochemische producten",
  "Sea & Road Logistics": "Logistiek over zee en weg",
  "Energy Trading & Supply": "Energiehandel en -levering",
  "Storage & Distribution": "Opslag en distributie",
  "Company & Resources": "Bedrijf en informatie",
  "About Us": "Over ons",
  "Strategic Partnership": "Strategisch partnerschap",
  Sustainability: "Duurzaamheid",
  "Leadership Team": "Directieteam",
  "News & Insights": "Nieuws en inzichten",
  "We reply within 24h": "Wij reageren binnen 24 uur",
  "Mon–Fri 08:30–18:30": "ma–vr 08:30–18:30",
  "© 2026 Dream Petroleum BV. All rights reserved.":
    "© 2026 Dream Petroleum BV. Alle rechten voorbehouden.",
  "Privacy Policy": "Privacybeleid",
  "Terms & Conditions": "Algemene voorwaarden",
  "page not available yet": "pagina nog niet beschikbaar",
};

/** Place-dependent forms: `<templateKey>:<content path without list indexes>` → English → Dutch. */
export const MENU_NL_BY_PLACE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "bv.site-footer:contact.title": { "Contact Us": "Contactgegevens" },
};

/** The Dutch proposal for one menu text at `path` (e.g. `columns.2.links.5.label`); "" without one. */
export function menuNlProposal(templateKey: string, path: string, english: string): string {
  const en = english.trim();
  const place = `${templateKey}:${path.replace(/\.\d+(?=\.|$)/g, "")}`;
  return MENU_NL_BY_PLACE[place]?.[en] ?? MENU_NL[en] ?? "";
}
