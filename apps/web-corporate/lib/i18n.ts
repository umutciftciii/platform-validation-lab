/**
 * COM-1: the corporate site's own interface texts (frame, language selector, 404, placeholder
 * home), per language. Content texts (menus, footer, pages) come from the CMS, never from here.
 * The Turkish texts are interface labels only; the visual design and the home page come with
 * COM-2.
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
