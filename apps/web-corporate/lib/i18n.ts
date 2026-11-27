/**
 * COM-1: the corporate site's own interface texts (frame, language selector, 404, placeholder
 * home), per language. Content texts (menus, footer, pages) come from the CMS, never from here.
 * The Turkish texts are interface labels only. COM-2a adds the labels of the designed frame
 * (menu buttons, submenus, footer, contact details, preview); the home page comes with COM-2b.
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
  home: { title: string; text: string };
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
  home: {
    title: "Dream Petroleum",
    text: "The new dreampetroleum.com is being prepared. Its pages are published here as they are completed.",
  },
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
  home: {
    title: "Dream Petroleum",
    text: "Yeni dreampetroleum.com hazırlanıyor. Sayfalar tamamlandıkça burada yayımlanacak.",
  },
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
