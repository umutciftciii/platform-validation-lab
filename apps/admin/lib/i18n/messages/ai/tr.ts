/**
 * DP-287 (ADR-030): Yapay Zekâ Merkezi'nin Türkçe metinleri (kaynak: ./en.ts). Alan yalnız sistem
 * sahibi yapay zekâyı açık tuttuğunda görünür (Sistem sahibi konsolu); aksi halde API 404 döner.
 * Sağlayıcı adları (OpenAI, Claude, Gemini) ve "API" çevrilmez.
 */
import type { Messages } from "../../types";

export const ai: Messages["ai"] = {
  metaTitle: "Yapay Zekâ Merkezi",
  title: "Yapay Zekâ Merkezi",
  description:
    "Yapay zekâ sağlayıcıları, modeller, bütçeler ve kullanım. Yapay zekâyı yalnız sistem sahibi, Sistem sahibi konsolundan açıp kapatabilir. Yapay zekâ hiçbir şeyi yayımlamaz: önerileri bir kişi tarafından taslak olarak kaydedilir.",
  loadError: "Yapay Zekâ Merkezi yüklenemedi",
  loadErrorText: "Biraz sonra tekrar deneyin.",
  statePanel: "Durum",
  stateOn: "Yapay zekâ açık",
  stateOnText:
    "Sistem sahibi tarafından açıldı. Yapay Zekâ Merkezi, görüntüleme yetkisi olan personele görünür.",
  callsPanel: "Yapay zekâ çağrıları",
  callsImpossible: "Yapay zekâ çağrısı yapılamaz",
  callsImpossibleText:
    "Bir çağrı için aşağıdaki öğelerin hepsi gerekir. O zamana kadar hiçbir yapay zekâ sağlayıcısına bir şey gönderilmez ve harcama yapılmaz.",
  blockerMissing: "Eksik",
  blockers: {
    no_provider_key:
      "Bir sağlayıcının (OpenAI, Claude veya Gemini) etkin ve test edilmiş API anahtarı",
    no_enabled_model: "Tarihli birim fiyatı olan etkin bir model",
    no_budget: "Günlük ve aylık bütçe",
  },
};
