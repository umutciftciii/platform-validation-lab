/** ML-12a: Turkish UI texts (see ../en/translations.ts). */
import type { Messages } from "../../../types";

export const translations: Messages["catalog"]["translations"] = {
  /** LanguageTabs. */
  tabs: {
    source: "kaynak",
  },
  /** SourceText. */
  source: {
    heading: "{name} kaynak metin",
    headingShared: "{name} kaynak metin · ortak ürün metni",
    none: "Kaynak dilde metin yok.",
  },
  /** TranslationField. */
  field: {
    missing: "Eksik",
  },
  /** LanguageSummary. */
  summary: {
    onSite: "Bu sitede {name}",
    public: "Herkese açık",
    notPublic: "Henüz herkese açık değil",
    liveHas: "Yayındaki sürümde {name} metinler var.",
    liveHasNot: "Yayındaki sürümde henüz {name} metin yok.",
    notLive: "Ürün bu sitede yayında değil.",
    notPublicNote:
      "Ziyaretçiler {name} sayfaları henüz açamaz. Kaydedilen ve yayınlanan {name} metinler, dil herkese açık yapılana kadar yalnızca personele görünür.",
    requiredHeading: "{name} yayınlanmadan önce gerekenler:",
    complete: "{name} yayın için yeterince tamamlandı.",
    optional: {
      one: "{count} isteğe bağlı metin henüz çevrilmedi",
      other: "{count} isteğe bağlı metin henüz çevrilmedi",
    },
    noAutomatic:
      "Hiçbir metin otomatik olarak çevrilmez veya kopyalanmaz: boş alanlar siz yazana kadar boş kalır. Kaydetmek hiçbir zaman yayınlamaz.",
  },
  /** SourceToggle. */
  toggle: {
    hide: "{name} kaynak metni gizle",
    show: "{name} kaynak metni göster",
  },
  /** FormButtons. */
  buttons: {
    confirm: "Hâlâ doğru: kontrol edildi olarak işaretle",
    discard: "Değişiklikleri at",
    saving: "Kaydediliyor…",
  },
  notEnabled: "{name} bu sitede etkin değil.",
  notEnabledAnySite: "{name} sitelerinizin hiçbirinde etkin değil.",
  /** ListingTranslationForm. */
  listing: {
    noListing: "Önce ürünü bu sitenin listesine ekleyin (İngilizce sekmesi).",
    legend: "{name} ürün metni",
    title: "Başlık ({name})",
    titleHint: "Boş bırakılırsa ürün adı kullanılır (adlar ve kodlar çevrilmez).",
    summary: "Özet ({name})",
    description: "Açıklama ({name})",
    saved: "{name} ürün metni kaydedildi.",
    checked: "{name} ürün metni kontrol edildi olarak işaretlendi.",
    save: "{name} metni kaydet",
    readOnly:
      "Salt okunur: bu sitenin site listelerini düzenlemek için sitede product:edit yetkisi gerekir.",
  },
  /** ListingSeoTranslationForm. */
  seo: {
    noListing: "Önce ürünü bu sitenin listesine ekleyin (İçerik sekmesi).",
    heading: "{name} SEO metinleri",
    note: "Canonical yol, dizine ekleme ve bağlantı önizleme görseli her dilde aynıdır (İngilizce sekmesi). Boş alanlarda sitedeki {name} ürün başlığı ve özeti kullanılır.",
    fields: {
      title: "SEO başlığı ({name})",
      description: "SEO açıklaması ({name})",
      ogTitle: "Bağlantı önizleme başlığı ({name})",
      ogDescription: "Bağlantı önizleme açıklaması ({name})",
    },
    maxHint: "En fazla {max} karakter.",
    saved: "{name} SEO metinleri kaydedildi.",
    checked: "{name} SEO metinleri kontrol edildi olarak işaretlendi.",
    save: "{name} SEO metinlerini kaydet",
    readOnly:
      "Salt okunur: bu sitenin SEO metinlerini düzenlemek için sitede product:edit yetkisi gerekir.",
  },
  /** CategoryTranslationForm. */
  category: {
    legend: "{name} kategori",
    name: "Kategori adı ({name})",
    description: "Kategori açıklaması ({name})",
    descriptionHint: "Ad gerekir; adı kaldırmak çeviriyi de kaldırır.",
    savedName: "{name} kategori adı kaydedildi.",
    removedName: "{name} kategori adı kaldırıldı.",
    checked: "{name} kategori kontrol edildi olarak işaretlendi.",
    save: "{name} kategoriyi kaydet",
    readOnly: "Salt okunur: kategori metinleri için sitede product:edit yetkisi gerekir.",
  },
  /** SpecNamesTranslationForm. */
  specs: {
    empty: "Bu ürünün henüz teknik değeri yok.",
    legend: "{name} teknik özellik adları",
    name: "Ad ({name})",
    note: "Teknik özellik adları tüm ürünler ve siteler için ortaktır. Birimler, değerler, test yöntemleri ve standartlar hiçbir zaman çevrilmez.",
    saved: {
      one: "{count} {name} teknik özellik adı kaydedildi.",
      other: "{count} {name} teknik özellik adı kaydedildi.",
    },
    checked: {
      one: "{count} {name} ad kontrol edildi olarak işaretlendi.",
      other: "{count} {name} ad kontrol edildi olarak işaretlendi.",
    },
    save: "{name} adları kaydet",
    readOnly: "Salt okunur: teknik özellik adları için ürün ana kaydı düzenleme yetkisi gerekir.",
  },
  /** ImageAltTranslationForm. */
  images: {
    empty: "Bu ürünün görseli yok.",
    legend: "{name} görsel alternatif metinleri",
    hidden: "gizli",
    alt: "Alternatif metin ({name})",
    note: "Alternatif metinler ortak ürüne aittir: birini değiştirmek, İngilizce bir alternatif metinde olduğu gibi ürün ana kaydının onayını sıfırlar.",
    saved: {
      one: "{count} {name} alternatif metin kaydedildi.",
      other: "{count} {name} alternatif metin kaydedildi.",
    },
    checked: {
      one: "{count} {name} alternatif metin kontrol edildi olarak işaretlendi.",
      other: "{count} {name} alternatif metin kontrol edildi olarak işaretlendi.",
    },
    save: "{name} alternatif metinleri kaydet",
    readOnly: "Salt okunur: alternatif metinler için ürün ana kaydı düzenleme yetkisi gerekir.",
  },
};
