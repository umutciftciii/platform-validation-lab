/** ML-12a: Turkish words shared by the Products/Catalog screens (see ../en/common.ts). */
import type { Messages } from "../../../types";

export const common: Messages["catalog"]["common"] = {
  productStatus: {
    DRAFT: "Taslak",
    IN_REVIEW: "İncelemede",
    APPROVED: "Onaylandı",
    ARCHIVED: "Arşivlendi",
  },
  siteStatus: {
    DRAFT: "Taslak",
    PUBLISHED: "Yayında",
    UNPUBLISHED: "Yayından kaldırıldı",
    NOT_LISTED: "Listelenmedi",
  },
  master: "Ana kayıt",
  readOnly: "(salt okunur)",
  site: "Site",
  languages: {
    en: "İngilizce",
    nl: "Felemenkçe",
  },
  translationState: {
    MISSING: "Eksik",
    DRAFT: "Taslak",
    PUBLISHED: "Yayında",
    OUTDATED: "Güncel değil",
  },
  translationStateHint: {
    MISSING: "Bu dilde henüz metin yok.",
    DRAFT: "Kaydedildi, bu dilde henüz yayınlanmadı (veya sonradan değişti).",
    PUBLISHED: "Yayındaki sitenin bu dilde taşıdığı metnin aynısı.",
    OUTDATED:
      "Bu metin kaydedildikten sonra İngilizce kaynak değişti: kontrol edip yeniden kaydedin.",
  },
  missing: {
    listing: "Ürün metni (başlık, özet veya açıklama)",
    categoryName: "Kategori adı",
    categoryDescription: "Kategori açıklaması",
    title: "Başlık",
    summary: "Özet",
    description: "Açıklama",
    seoTitle: "SEO başlığı",
    seoDescription: "SEO açıklaması",
    ogTitle: "Bağlantı önizleme başlığı",
    ogDescription: "Bağlantı önizleme açıklaması",
    specName: "Teknik özellik adı: {name}",
    imageAlt: "Görsel alternatif metni: {name}",
    image: "görsel",
  },
  tabs: {
    content: "İçerik",
    technical: "Teknik",
    media: "Medya ve Belgeler",
    seo: "SEO",
    publication: "Yayın",
  },
  fix: {
    not_approved:
      "Ürün ana kaydını incelemeye gönderin; başka bir inceleyici onaylar. Onay ve yayın yetkisi olan bir yönetici doğrudan yayınlayabilir.",
    not_reviewed: "İsteğe bağlı: önce ikinci bir kişiden incelemesini isteyin.",
    company_review_pending:
      "İsteğe bağlı: şirket öneriyi Şirket İncelemesi bölümünde inceleyebilir.",
    sensitive_claim:
      "Bu ifadeyi yalnızca bir sertifika veya kaynak belge varsa koruyun; yoksa site metinlerinden kaldırın.",
    archived: "Ürünü sayfanın üstündeki düğmeyle geri yükleyin.",
    listing_missing: "Ürünü bu sitede listeleyin (site listesi).",
    cover_missing: "Bir görsel yükleyin ve kapak yapın.",
    alt_text_missing: "Her görsele alternatif metin ekleyin.",
    summary_missing:
      "Bu sitenin ürün metnine bir özet ekleyin (veya araştırma önerisini kopyalayın).",
    description_missing:
      "Bu sitenin ürün metnine bir açıklama ekleyin (veya araştırma önerisini kopyalayın).",
    required_missing: "Bu zorunlu teknik özelliği doldurup kaydedin.",
    complete: "Teknik verileri tamamlayın.",
    correct: "Bu değeri düzeltip kaydedin.",
  },
  siteText: {
    own: {
      title: "{site} sitesinde ürün adı olarak gösterilir.",
      summary: "{site} ürün kartında ve ürün sayfasında gösterilir.",
      description: "{site} ürün sayfasında gösterilir. Şimdilik yalnız İngilizce.",
    },
    shared: {
      title: "Boş: {site}, aşağıdaki “Ortak ürün içeriği” bölümündeki ortak adı gösterir.",
      summary: "Boş: {site}, aşağıdaki “Ortak ürün içeriği” bölümündeki ortak özeti gösterir.",
      description:
        "Boş: {site}, aşağıdaki “Ortak ürün içeriği” bölümündeki ortak açıklamayı gösterir.",
    },
    none: {
      title: "Boş: {site} ortak ürün adını gösterir.",
      summary: "Boş: {site} ürün kartı ve sayfası özet göstermez.",
      description: "Boş: {site} ürün sayfası açıklama göstermez.",
    },
  },
  address: {
    label: "Adresler",
    live: "Yayındaki adres",
    notOnSite: "Sitede değil",
    next: "Yayından sonraki adres",
    movesKeeps:
      "Yayınlamak adresi {next} olarak değiştirir. {live} çalışmaya devam eder: yeni adrese kalıcı olarak (301) yönlenir. O zamana kadar site {live} adresini gösterir.",
    movesStops:
      "Yayınlamak adresi {next} olarak değiştirir; {live} bundan sonra bu sitede çalışmaz. O zamana kadar site {live} adresini gösterir.",
    older: "Buraya yönlenen eski adresler (301)",
    olderLabel: "Eski adresler",
  },
  seoLength: {
    long: "{n} karakter: yaklaşık {recommended} karakteri gösterilir, kalanı kesilebilir.",
    short: "{n} karakter: {short}–{recommended} karakterlik bir açıklama en iyi sonucu verir.",
  },
};
