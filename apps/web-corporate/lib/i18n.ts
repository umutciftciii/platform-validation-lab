/**
 * COM-1: the corporate site's own interface texts (frame, language selector, 404), per language. Content texts (menus, footer, pages) come from the CMS, never from here.
 * The Turkish texts are interface labels only. COM-2a adds the labels of the designed frame
 * (menu buttons, submenus, footer, contact details, preview); COM-2b the labels of the product
 * portfolio around its CMS content (section list, table headings). The COM-2a placeholder home
 * is gone: the home page is the CMS page `corporate.home`.
 *
 * Pure (no Next.js, no `@/` imports) so `node --test` runs it as is.
 */
import type { RouteLocale } from "./locale-routing.ts";

export interface SiteDictionary {
  skipToContent: string;
  menu: string;
  languages: string;
  comingSoon: string;
  footerContact: string;
  /** COM-2a: the phone menu's buttons and the label of a submenu button ({label}: the item). */
  openMenu: string;
  closeMenu: string;
  openSubmenu: string;
  /** Read after a link that opens in a new tab. */
  newTab: string;
  homeLink: string;
  footer: { label: string; social: string; legal: string };
  contact: { phone: string; email: string; address: string; map: string };
  preview: { badge: string; text: string; unavailable: string };
  notFound: { title: string; text: string; home: string };
  /** COM-2b: the product portfolio's own labels (its texts come from the CMS). */
  portfolio: { onThisPage: string; property: string; unit: string };
  privacy: { title: string; draft: string; draftText: string; version: string };
  unavailable: string;
}

const EN: SiteDictionary = {
  skipToContent: "Skip to content",
  menu: "Main menu",
  languages: "Language",
  comingSoon: "coming soon",
  footerContact: "Contact",
  openMenu: "Open menu",
  closeMenu: "Close menu",
  openSubmenu: "Show the {label} submenu",
  newTab: "(opens in a new tab)",
  homeLink: "Dream Petroleum home page",
  footer: { label: "Site footer", social: "Follow us", legal: "Legal" },
  contact: {
    phone: "Phone",
    email: "E-mail",
    address: "Address",
    map: "View on map",
  },
  preview: {
    badge: "Preview",
    text: "Draft preview. Not published and not indexed; the link expires after 15 minutes.",
    unavailable: "This preview link is invalid or has expired. Open a new preview from the admin.",
  },
  notFound: {
    title: "Page not found",
    text: "The page you are looking for does not exist or has moved.",
    home: "Go to the home page",
  },
  portfolio: { onThisPage: "On this page", property: "Property", unit: "Unit" },
  privacy: {
    title: "Privacy Policy",
    draft: "Draft — not for publication",
    draftText: "Not shown in production until these are settled:",
    version: "Version",
  },
  unavailable: "This page is temporarily unavailable. Please try again in a moment.",
};

const TR: SiteDictionary = {
  skipToContent: "İçeriğe geç",
  menu: "Ana menü",
  languages: "Dil",
  comingSoon: "yakında",
  footerContact: "İletişim",
  openMenu: "Menüyü aç",
  closeMenu: "Menüyü kapat",
  openSubmenu: "{label} alt menüsünü göster",
  newTab: "(yeni sekmede açılır)",
  homeLink: "Dream Petroleum ana sayfası",
  footer: { label: "Site alt bilgisi", social: "Bizi takip edin", legal: "Yasal" },
  contact: {
    phone: "Telefon",
    email: "E-posta",
    address: "Adres",
    map: "Haritada göster",
  },
  preview: {
    badge: "Önizleme",
    text: "Taslak önizlemesi. Yayımlanmadı ve dizine eklenmez; bağlantı 15 dakika sonra geçersiz olur.",
    unavailable:
      "Bu önizleme bağlantısı geçersiz veya süresi dolmuş. Yönetim panelinden yeni bir önizleme açın.",
  },
  notFound: {
    title: "Sayfa bulunamadı",
    text: "Aradığınız sayfa mevcut değil veya taşındı.",
    home: "Ana sayfaya git",
  },
  portfolio: { onThisPage: "Bu sayfada", property: "Özellik", unit: "Birim" },
  privacy: {
    title: "Gizlilik Politikası",
    draft: "Taslak — yayın için değil",
    draftText: "Bunlar tamamlanana kadar production ortamında gösterilmez:",
    version: "Sürüm",
  },
  unavailable: "Bu sayfa geçici olarak kullanılamıyor. Lütfen biraz sonra tekrar deneyin.",
};

const DICTIONARIES: Record<RouteLocale, SiteDictionary> = { en: EN, tr: TR };

export function dictionary(locale: RouteLocale): SiteDictionary {
  return DICTIONARIES[locale];
}

/** `{name}` placeholders filled from `values` (unknown names stay as they are). */
export function interpolate(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, name: string) => values[name] ?? m);
}
