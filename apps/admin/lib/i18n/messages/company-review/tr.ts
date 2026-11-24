/**
 * ML-12b (DP-243): Şirket incelemesi alanının Türkçe metinleri. Anahtarlar İngilizce sözlükle
 * birebir aynıdır (eksik/fazla anahtar derleme hatası). Terimler docs/i18n/admin-glossary.md:
 * company review = şirket incelemesi (modül adı metin içinde "Şirket İncelemesi"), proposal =
 * öneri, approve = onayla, request changes = değişiklik iste, conflict = çelişki (ML-12a ile aynı).
 */
import type { Messages } from "../../types";

export const companyReview: Messages["companyReview"] = {
  title: "Şirket incelemesi",
  allProposals: "Tüm öneriler",

  status: {
    REVIEW_PENDING: "İnceleme bekliyor",
    CHANGES_REQUESTED: "Değişiklik istendi",
    APPROVED: "Onaylandı",
  },
  statusHint: {
    REVIEW_PENDING: "Şirketin kararı bekleniyor.",
    CHANGES_REQUESTED: "Şirket değişiklik istedi; editör öneriyi revize eder.",
    APPROVED: "Şirket tarafından onaylandı. Yayınlanmadı ve teknik onay değildir.",
  },

  blocked: {
    no_permission: {
      title: "Bu öneriyi okuyabilirsiniz ancak karar veremezsiniz",
      body: "Rolünüz bu öneriyi okuyabilir ancak öneri hakkında karar veremez. Onaylamak veya değişiklik istemek için bu sitede öneri inceleme yetkisi gerekir; öneri incelemeniz gerekiyorsa bir site yöneticisine başvurun.",
    },
    not_in_review: {
      title: "Şu anda karar verilecek bir şey yok",
      body: "Şu anda karar verilecek bir şey yok: öneri incelemede beklemiyor. Editör öneriyi revize ettiğinde yeniden incelemeye döner.",
    },
    own_change: {
      title: "Kararı başka bir inceleyici vermeli",
      body: "Bu revizyonu siz yazdınız; bu nedenle kararı başka bir inceleyici vermeli (görevler ayrılığı). Bu kural her rol için geçerlidir.",
    },
    unknown: {
      title: "Bu öneri hakkında karar veremezsiniz",
      body: "Bu öneri hakkında karar veremezsiniz.",
    },
  },

  kind: {
    CONFIRM: "Onaylanacak soru",
    INCONSISTENCY: "Tutarsızlık",
    DP002_HELD: "Doğrulama için bekletiliyor (DP-002)",
    SITE_VALUE_WITHHELD: "Mevcut siteden aktarılmadı",
    CLASS_CONFLICT: "Sınıflandırma çelişkisi",
    CLAIM_RISK: "İddia riski",
    MISSING_DOCUMENT: "Eksik belge",
    PLACEHOLDER: "Yer tutucu ürün",
  },

  section: {
    attention: {
      title: "Çelişkiler ve yer tutucular",
      description:
        "Mevcut verinin, sınıf etiketinin veya ürünün kendisinin şüpheli olduğu noktalar.",
    },
    claims: {
      title: "İddia riskleri",
      description: "Yayınlanmadan önce bir sertifika veya başka bir kanıt gerektiren ifadeler.",
    },
    questions: {
      title: "Onaylanacak sorular",
      description: "Lütfen bu noktaları yorumunuzda onaylayın veya düzeltin.",
    },
    documents: {
      title: "Eksik belgeler",
      description: "Katalogda henüz bulunmayan orijinal belgeler.",
    },
  },

  sourceLevel: {
    A: "A · üreticinin kendi belgesi",
    B: "B · standart veya mevzuat",
    C: "C · başka bir üretici (yalnız makullük kontrolü)",
    D: "D · site tarafından üretilmiş özet (orijinal değil)",
    E: "E · tüccar veya pazar yeri (kanıt değil)",
  },

  spec: {
    range: "{from} – {to}",
    yes: "Evet",
    no: "Hayır",
  },

  count: {
    conflicts: { one: "{count} çelişki", other: "{count} çelişki" },
    questions: { one: "{count} soru", other: "{count} soru" },
    heldValues: { one: "{count} bekletilen değer", other: "{count} bekletilen değer" },
    missingDocuments: { one: "{count} eksik belge", other: "{count} eksik belge" },
    products: { one: "{count} ürün", other: "{count} ürün" },
    reviewItems: { one: "{count} inceleme maddesi", other: "{count} inceleme maddesi" },
    sources: { one: "{count} kaynak", other: "{count} kaynak" },
    technicalValues: { one: "{count} teknik değer", other: "{count} teknik değer" },
  },

  tabs: {
    content: "İçerik incelemesi",
    verification: "Eksikler ve doğrulama",
    sources: "Kaynaklar",
    history: "Geçmiş",
    label: "İnceleme bölümleri",
    unsaved: "Kaydedilmemiş değişiklikler",
    unsavedSr: ", kaydedilmemiş değişiklikler",
    leave:
      "Önerilen metinde kaydedilmemiş değişiklikleriniz var. Sayfadan çıkıp değişiklikleri atmak istiyor musunuz?",
  },

  list: {
    noAccessTitle: "Şirket incelemesine erişiminiz yok",
    noAccessText: "Rolleriniz hiçbir sitede ürünleri okuma yetkisi içermiyor.",
    description:
      "{site} kataloğu için araştırmaya dayanarak hazırlanan önerilen İngilizce metinler. Mevcut site verisini öneriyle karşılaştırmak için bir ürünü açın, açık noktaları kontrol edin, ardından onaylayın veya değişiklik isteyin. Onay, ürünü yayınlamaz ve teknik verilerini onaylamaz.",
    site: "Site",
    loadErrorTitle: "Öneriler yüklenemedi",
    loadErrorText:
      "Sayfayı yeniden yükleyin. Sorun devam ederse rolünüz bu siteyi kapsamıyor olabilir.",
    products: "Ürünler",
    counts: "{pending} bekliyor · {changes} değişiklik istendi · {approved} onaylandı",
    filterLabel: "Önerileri filtrele",
    searchLabel: "Ürün adı veya ürün koduyla ara",
    searchPlaceholder: "Ürün adı veya ürün kodu ara",
    category: "Kategori",
    allCategories: "Tüm kategoriler",
    search: "Ara",
    clear: "Temizle",
    statusFilter: "İnceleme durumuna göre filtrele",
    all: "Tümü",
    categoriesIncomplete: "Ürünlerin kategorileri yüklenemedi; kategori filtresi eksik olabilir.",
    showing: {
      one: "{total} üründen {count} tanesi gösteriliyor",
      other: "{total} üründen {count} tanesi gösteriliyor",
    },
    noMatch: "Bu aramayla eşleşen ürün yok. Aramayı değiştirin veya filtreleri temizleyin.",
    empty: "Bu görünümde öneri yok.",
    noText: "Metin önerilmedi",
  },

  detail: {
    loadErrorTitle: "Bu öneri yüklenemedi",
    loadErrorText:
      "Rolünüz bu siteyi kapsamıyor olabilir. Tekrar denemek için sayfayı yeniden yükleyin.",
    sku: "Ürün kodu",
    versionHint: "Sürüm {version} · {hint}",
    seeWhy: "Nedenini görün",
    decision: "Karar",
    previewTitle: "Katalog önizlemesi",
    previewText:
      "Bu ürün, mevcut veri ve öneri ayrı tutularak BV katalog tasarımında gösterilir. Salt okunur; bağlantı kısa süre geçerlidir.",
    nav: {
      conflicts: "Çelişkiler",
      questions: "Sorular",
      held: "Bekletilen değerler",
      documents: "Eksik belgeler",
      technical: "Mevcut teknik veriler",
    },
    nothingToVerify:
      "Araştırma bu ürün için çelişki, soru, bekletilen değer veya eksik belge listelemiyor.",
  },

  tag: {
    site: "Mevcut siteden",
    proposal: "Araştırma önerisi — yayınlanmadı",
    review: "Dahili inceleme — asla yayınlanmaz",
  },

  notProvided: "Belirtilmedi",
  notListed: "Listelenmedi",
  currentSite: "Mevcut site",
  researchProposal: "Araştırma önerisi",
  noText: "Metin yok",
  fields: {
    summary: "Kısa açıklama",
    description: "Açıklama",
  },

  current: {
    title: "Mevcut site verisi",
    description: "Ürünün bugün katalogdaki hâli. Bu inceleme buradaki hiçbir şeyi değiştirmez.",
    loadError: "Ürün verisi yüklenemedi.",
    productName: "Ürün adı",
    sku: "Ürün kodu",
    slug: "Slug",
    category: "Kategori",
  },
  comparison: {
    title: "Araştırma önerisi ve mevcut metin",
    description:
      "Önerilen müşteri metni. Siteye yalnız onaydan sonra, ayrı ve sonraki bir adımda uygulanır.",
    empty:
      "Bu ürün için metin önerilmedi: ürün, tanımlanabilecek kadar net değil. Şirketin onayını bekliyor (bkz. Eksikler ve doğrulama).",
    noTextProposed: "Metin önerilmedi",
  },
  openPoints: "Araştırmadaki açık noktalar:",
  sources: "Kaynaklar:",

  verification: {
    navLabel: "Doğrulama grupları",
    heldTitle: "Doğrulama için bekletilenler — ürün verisi değil",
    heldExtra: {
      one: "{count} çelişki, önce listelenir",
      other: "{count} çelişki, önce listelenir",
    },
    heldDescription:
      "Mevcut sitede gösterilen ancak aktarılmayan değerler: DP-002 kapsamında bekletilen değerler (doğrulanmamış veya çelişkili) ve test yöntemi ya da sıcaklığı olmayan satırlar. Doğrulanmış teknik özellik değildir ve ürünün parçası değildir.",
    unverified: "Doğrulanmadı (DP-002)",
    notImported: "Aktarılmadı",
    conflict: "Çelişki",
    no: "Hayır",
    status: "Durum",
    valueAsPrinted: "Kaynakta yazıldığı şekliyle değer",
    finding: "Bulgu",
    noMissingDocuments: "Araştırma eksik belge listelemiyor.",
    documentsOnFile: "Katalogda kayıtlı belgeler",
    siteSummary: "Site tarafından üretilmiş özet",
    notOriginal: "— orijinal bir TDS/COA değil",
    noDocuments: "Belge yok. Kayıtlı orijinal TDS, SDS veya COA bulunmuyor.",
    technicalTitle: "Mevcut sitedeki teknik veriler",
    technicalDescription:
      "Mevcut site için sağlanan belgelerden aktarıldı; orijinal bir teknik bilgi föyüyle karşılaştırılmadı.",
    property: "Özellik",
    value: "Değer",
    basis: "Esas",
    testMethod: "Test yöntemi",
    typical: "Tipik",
    specification: "Teknik özellik",
    none: "Yok",
    noTechnical: "Mevcut site bu ürün için teknik veri göstermiyor.",
  },

  researchSources: {
    title: "Araştırma kaynakları",
    description:
      "Araştırmanın dayandığı belgeler. Seviye, bir kaynağın ne kadar ağırlık taşıdığını gösterir; yalnız A seviyesi üreticinin kendi belgesidir.",
    family: "Araştırma ailesi:",
    none: "Araştırma bu ürün için kaynak listelemiyor.",
    levelNotGiven: "Seviye belirtilmedi",
    citedBy: {
      one: " · {count} inceleme maddesinde atıf var",
      other: " · {count} inceleme maddesinde atıf var",
    },
  },

  history: {
    title: "Geçmiş",
    description: "Sürümler, kararlar ve yorumlar; en yenisi önce.",
    currentVersion: "Güncel sürüm",
    writtenBy: "Yazan",
    lastDecision: "Son karar",
    noDecision: "Henüz karar yok",
    none: "Henüz geçmiş yok.",
    version: "sürüm {version}",
    action: {
      CREATED: "Öneri oluşturuldu",
      REVISED: "Revize edildi ve incelemeye gönderildi",
      APPROVED: "Onaylandı",
      CHANGES_REQUESTED: "Değişiklik istendi",
    },
    textUnrecorded:
      "Bu sürümün metni kaydedilmedi (geçmiş, metinleri saklamaya başlamadan önce kaydedildi).",
    textUnchanged: "Metin değişmedi.",
    textOfVersion: "Sürüm {version} metni",
  },

  decision: {
    unavailable: "Onayla ve Değişiklik iste bu sürüm için size açık değil.",
    comment: "Yorum",
    commentHint: "(değişiklik istemek için zorunlu, onaylamak için isteğe bağlı)",
    commentPlaceholder:
      "Neyin değişmesi gerektiği veya Eksikler ve doğrulama bölümündeki sorulara yanıtlar…",
    approve: "Onayla",
    requestChanges: "Değişiklik iste",
    approved: "Öneri onaylandı.",
    changesRequested: "Değişiklik istendi.",
    note: "Onaylamak, bu ürün için önerilen metni kabul eder. Ürünü yayınlamaz ve ürün verilerinin teknik onayı değildir.",
    explain: "Neyin değişmesi gerektiğini açıklayın (en az 3 karakter).",
    tooLong: "Açıklamayı {max} karakterin altında tutun.",
  },

  editor: {
    title: "Önerilen metin",
    description:
      "Önerilen müşteri metnini mevcut site metninin yanında düzenleyin. Sitenin kendisi yalnız sonraki, ayrı bir adımda değişir.",
    placeholderNote:
      "Araştırma metin önermiyor: bu ürün, tanımlanabilecek kadar net değil. Yalnız şirketin onayladığı bilgilere dayanarak metin yazın (bkz. Eksikler ve doğrulama).",
    edited: "düzenlendi",
    noTextYet: "Henüz metin yok",
    emptySaved: "Boş: metin yok olarak kaydedilir.",
    unsaved: "Kaydedilmemiş değişiklikler.",
    savingApproved: "Kaydetmek yeni bir sürüm oluşturur; şirketin onayı önceki sürümü kapsar.",
    savingCreates: "Kaydettiğinizde sürüm {version} oluşturulur.",
    saved: "Sürüm {version} kaydedildi. Her sürüm Geçmiş'te saklanır.",
    savedAs: "Sürüm {version} olarak kaydedildi.",
    cancel: "İptal",
    save: "Kaydet",
    saving: "Kaydediliyor…",
    tooLong: "En fazla {max} karakter yazın (şu an {now}).",
    reviewNotes:
      "İnceleme notları ([CONFIRM …]) müşteri metnine değil, Eksikler ve doğrulama bölümüne aittir.",
    stale:
      "Bu sırada biri bu önerinin daha yeni bir sürümünü kaydetti. Yeni sürüm yüklendi ve düzenlemeleriniz korundu: Kaydet bunları yeni sürüme ekler, İptal ise atar.",
    tooLarge:
      "Bu metin tek istekte gönderilemeyecek kadar uzun. Açıklamayı kısaltıp yeniden kaydedin.",
    forbidden: "Bu sitede önerileri düzenleme yetkiniz yok.",
  },

  notes: {
    intro:
      "Bu ürünün araştırmasından {items} ve {sources}. Salt okunur; buradaki hiçbir şey yayınlanmaz veya ürün verisi olarak kullanılmaz.",
    open: "Şirket İncelemesi'nde aç",
    held: "{values} doğrulama için bekletiliyor: doğrulanmadı, yukarıdaki teknik özelliklerde yer almaz ve asla yayınlanmaz.",
    questions: "Şirkete sorular",
    documents: "Eksik belgeler",
    conflicts: "Teknik çelişkiler",
    claims: "İddia riskleri",
  },
};
