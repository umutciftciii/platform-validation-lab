/**
 * CRM-1 (ADR-032): CRM alanının Türkçe metinleri — firmalar ve müşteri sorumluları. Anahtarlar
 * İngilizce sözlükle birebir aynıdır (eksik/fazla anahtar derleme hatası). Terimler
 * docs/i18n/admin-glossary.md: company = firma, account owner = müşteri sorumlusu.
 *
 * Veri çevrilmez: firma adları, adresler, telefonlar, e-posta adresleri, web siteleri, notlar,
 * personel adları ve site adları kayıtlı haliyle gösterilir.
 */
import type { Messages } from "../../types";

export const crm: Messages["crm"] = {
  common: {
    noAccess: "CRM'e erişiminiz yok",
    tryAgainLater:
      "Lütfen daha sonra tekrar deneyin. Sorun sürerse bir platform yöneticisine başvurun.",
    noOwner: "Müşteri sorumlusu yok",
    noLongerAccess: "(artık erişimi yok)",
    formerStaff: "Eski personel",
    notSet: "Girilmedi",
  },
  list: {
    title: "Firmalar",
    description:
      "Her sitenin firmaları ve müşteri sorumluları. Müşteri verisidir: her görüntüleme ve değişiklik denetim kaydına yazılır.",
    newCompany: "Yeni firma",
    filterLabel: "Firmaları filtrele",
    searchLabel: "Firma ara",
    searchPlaceholder: "Ad, şehir, web sitesi veya e-posta",
    site: "Site",
    allSites: "Tüm siteler",
    owner: "Müşteri sorumlusu",
    anyOwner: "Tüm sorumlular",
    ownedByMe: "Benim firmalarım",
    noOwner: "Sorumlusu olmayanlar",
    country: "Ülke",
    anyCountry: "Tüm ülkeler",
    apply: "Uygula",
    clearFilters: "Filtreleri temizle",
    shown: "{n} kayıt gösteriliyor",
    shownMore: "{n} kayıt gösteriliyor · devamı sonraki sayfada",
    empty: "Henüz firma yok",
    emptyText: "Eklediğiniz firmalar burada ada göre sıralanır.",
    noMatches: "Eşleşen firma yok",
    noMatchesText: "Filtreleri değiştirin veya temizleyin.",
    loadError: "Firmalar yüklenemedi",
    noAccessText:
      "Firmalar müşteri verisidir. Sitenizde bir CRM rolü için platform yöneticisine başvurun.",
    firstPage: "İlk sayfa",
    nextPage: "Sonraki sayfa",
    updated: "Güncellendi: {date}",
  },
  form: {
    name: "Firma adı",
    nameHint: "Sitede tekildir; büyük/küçük harf ve fazla boşluk dikkate alınmaz.",
    site: "Site",
    country: "Ülke",
    noCountry: "Ülke yok",
    city: "Şehir",
    address: "Adres",
    website: "Web sitesi",
    websiteHint: "https:// veya http:// ile başlar",
    phone: "Genel telefon",
    email: "Genel e-posta",
    emailHint: "Firmanın ortak adresi; bir kişinin adresi değil.",
    description: "Açıklama",
    internalNotes: "Dahili notlar",
    internalNotesHint: "Yalnız personel görür.",
    owner: "Müşteri sorumlusu",
    ownerHint: "Bu sitenin CRM'ini yöneten personel.",
    create: "Firmayı oluştur",
    creating: "Oluşturuluyor…",
    save: "Değişiklikleri kaydet",
    saving: "Kaydediliyor…",
    saved: "Değişiklikler kaydedildi.",
    discard: "Değişiklikleri geri al",
  },
  detail: {
    back: "Tüm firmalar",
    profile: "Firma profili",
    contact: "İletişim bilgileri",
    account: "Hesap",
    edit: "Firmayı düzenle",
    editDescription:
      "Tüm alanlar birlikte kaydedilir; müşteri sorumlusu bu sitenin CRM'ini yönetebilmelidir.",
    readOnly:
      "Bu firmayı görüntüleyebilirsiniz. Değiştirmek için sitesinde CRM yönetim yetkisi gerekir.",
    created: "{date} tarihinde {name} oluşturdu",
    changed: "Son değişiklik: {date}, {name}",
    version: "Sürüm {n}",
    notFound: "Firma bulunamadı",
    notFoundText: "Firma yok ya da CRM'ini okuyamadığınız bir siteye ait.",
    loadError: "Firma yüklenemedi",
  },
  create: {
    title: "Yeni firma",
    description: "Firma, talepleri gibi tek bir siteye aittir. Kişiler daha sonra bağlanır.",
    noSites: "Firma oluşturamazsınız",
    noSitesText: "Firma oluşturmak için bir sitede CRM yönetim yetkisi gerekir.",
  },
  errors: {
    duplicate_name: "Bu sitede aynı ada sahip başka bir firma var.",
    owner_not_eligible: "Bu kişi bu sitenin firmalarına sorumlu olamaz.",
    stale: "Firmayı başka biri değiştirdi. Sayfayı yenileyip tekrar deneyin.",
    unchanged: "Değişiklik yok.",
    db_guard: "Değişiklik reddedildi. Sayfayı yenileyip tekrar deneyin.",
    invalidField: "Bu alanı kontrol edin: {field}.",
    saveFailed: "Firma kaydedilemedi.",
  },
};
