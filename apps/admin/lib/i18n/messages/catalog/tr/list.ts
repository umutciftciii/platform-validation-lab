/** ML-12a: Turkish UI texts (see ../en/list.ts). */
import type { Messages } from "../../../types";

export const list: Messages["catalog"]["list"] = {
  noAccess: {
    title: "Ürün kataloğuna erişiminiz yok",
    text: "Rolleriniz hiçbir sitede ürünleri okuma yetkisi içermiyor.",
    textAsk:
      "Rolleriniz hiçbir sitede ürünleri okuma yetkisi içermiyor. Erişim için bir site veya platform yöneticisine başvurun.",
  },
  products: {
    title: "Ürünler",
    description:
      "Platform genelindeki ürün ana kayıtları ve her sitenin bunları nasıl listelediği.",
    actions: {
      categories: "Kategoriler",
      specifications: "Teknik özellikler",
      brands: "Küresel markalar",
      reviewQueue: "İnceleme kuyruğu",
      newProduct: "Yeni ürün",
    },
    siteCanEdit: "Bu sitenin site listelerini ve kategorilerini düzenleyebilirsiniz.",
    siteReadOnly: "Bu sitede yalnızca okuma yetkiniz var.",
    panelTitle: "Katalog",
    count: { one: "{count} ürün", other: "{count} ürün" },
    countFiltered: {
      one: "Filtrelere uyan {count} ürün",
      other: "Filtrelere uyan {count} ürün",
    },
    filters: {
      label: "Ürünleri filtrele",
      search: "Ad, kod veya slug ile arayın",
      searchPlaceholder: "Ad, kod veya slug arayın",
      category: "Kategori",
      allCategories: "Tüm kategoriler",
      listing: "Bu sitedeki listeleme",
      listingAll: "Listelenen veya listelenmeyen",
      listingListed: "Bu sitede listelenen",
      listingUnlisted: "Bu sitede listelenmeyen",
      sort: "Sıralama",
      sortName: "Ada göre sırala",
      sortCode: "Koda göre sırala",
      sortUpdated: "Son değişiklik",
      sortCreated: "Oluşturulma",
      order: "Yön",
      asc: "Artan",
      desc: "Azalan",
      apply: "Uygula",
      masterStatus: "Ana kayıt durumu",
      any: "Tümü",
      clear: "Filtreleri temizle",
    },
    error: {
      title: "Ürün listesi yüklenemedi",
      forbidden: "Bu sitede ürünleri okuma yetkiniz yok.",
      retry: "Birazdan tekrar deneyin.",
    },
    empty: {
      filteredTitle: "Bu filtrelere uyan ürün yok",
      title: "Henüz ürün yok",
      filteredText: "Daha fazla ürün görmek için filtreleri değiştirin veya temizleyin.",
      canCreate: "İlk ürün ana kaydını “Yeni ürün” ile oluşturun.",
      cannotCreate: "Ürün ana kayıtlarını platform ürün ekibi oluşturur.",
    },
    table: {
      caption: "{site} sitesindeki ürünler",
      product: "Ürün",
      category: "Bu sitedeki kategori",
      status: "Durum",
      changed: "Son değişiklik",
    },
    pagination: {
      label: "Sayfalar",
      range: "{from}–{to} / {total}",
      previous: "Önceki",
      next: "Sonraki",
    },
  },
  newProduct: {
    title: "Yeni ürün",
    back: "Tüm ürünler",
    noAccessTitle: "Ürün ana kaydı oluşturamazsınız",
    noAccessText:
      "Ürün ana kayıtları platform genelinde geçerlidir. Oluşturmak için {permission} platform yetkisi gerekir (Platform Product Manager veya Platform Super Admin).",
    description:
      "Platform genelindeki ana kaydı oluşturun. Her site onu daha sonra ayrıca listeler.",
    panelTitle: "Ürün ana kaydı",
  },
  review: {
    title: "İnceleme kuyruğu",
    back: "Tüm ürünler",
    description:
      "Onaya gönderilen ürün ana kayıtları, en eskisi önce. Bir revizyonu değiştiren veya gönderen inceleyici onun hakkında karar veremez.",
    panelTitle: "Karar bekleyenler",
    inReview: "İncelemede: {n}",
    inReviewFollowOnly: "İncelemede: {n} · takip edebilirsiniz, karar veremezsiniz",
    error: {
      title: "İnceleme kuyruğu yüklenemedi",
      forbidden: "Rolleriniz ürünleri okuma yetkisi içermiyor.",
      retry: "Birazdan tekrar deneyin.",
    },
    empty: {
      title: "İnceleme bekleyen kayıt yok",
      text: "Bir ürün ana kaydı gönderildiğinde onay için burada görünür.",
    },
    table: {
      caption: "İnceleme bekleyen ürün ana kayıtları",
      product: "Ürün",
      submitter: "Gönderen",
      waiting: "Bekleme süresi",
      decision: "Karar",
    },
    version: "{code} · sürüm {version}",
    unknown: "Bilinmiyor",
    /** Phones: who submitted it and when. */
    when: { known: "{name}, {time}", unknown: "Bilinmiyor, {time}" },
    blocking: "{n} engelleyici",
    ready: "Kararınızı bekliyor",
    reason: {
      own_change: "Sizin değişikliğiniz",
      no_permission: "İnceleyici gerekli",
    },
    waiting: "Bekliyor",
    warnings: { one: "{count} uyarı", other: "{count} uyarı" },
  },
  preview: {
    open: "Katalog önizlemesini aç",
  },
  language: {
    label: "Dil",
    source: "kaynak",
  },
  notices: {
    dismiss: "Kapat",
  },
};
