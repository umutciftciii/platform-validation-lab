/**
 * ML-12e (DP-243): Leads alanının Türkçe metinleri. Anahtarlar İngilizce sözlükle birebir aynıdır
 * (eksik/fazla anahtar derleme hatası). Terimler docs/i18n/admin-glossary.md: lead = talep
 * (gezinmedeki "Talepler" ile aynı), document request = belge talebi, contact form = iletişim formu.
 *
 * Veri çevrilmez: adlar, şirketler, e-posta adresleri, mesajlar, konular, belge adları, site adları,
 * onay metni sürümleri ve SHA-256 değerleri, dil kodları ve API kodları kayıtlı haliyle gösterilir.
 */
import type { Messages } from "../../types";

export const leads: Messages["leads"] = {
  // --- Ekranların ortak etiketleri (lib/leads-view.ts), API kodlarına göre ----------------------
  status: {
    NEW: "Yeni",
    CONTACTED: "İletişime geçildi",
    QUALIFIED: "Nitelikli",
    UNQUALIFIED: "Niteliksiz",
    CONVERTED: "Müşteriye dönüştü",
  },
  statusHint: {
    NEW: "Henüz üzerinde çalışılmadı.",
    CONTACTED: "Kendisine ulaştık veya görüştük.",
    QUALIFIED: "Gerçek bir fırsat. Otomatik anonimleştirmenin dışında tutulur.",
    UNQUALIFIED: "Uygun değil. Yeniden açılabilir.",
    CONVERTED: "Müşteri oldu. Kesin; otomatik anonimleştirmenin dışında tutulur.",
  },
  source: {
    DOCUMENT_REQUEST: "Belge talebi",
    CONTACT_FORM: "İletişim formu",
  },
  notification: {
    PENDING: "E-posta bekliyor",
    SENT: "Personele e-posta gönderildi",
    SKIPPED: "E-posta yok",
    FAILED: "E-posta gönderilemedi",
  },
  notificationReason: {
    disabled: "bu site için bildirimler kapalı",
    no_recipients: "listedeki hiç kimse bu sitenin taleplerini okuyamıyor",
    transport_off: "bu ortamda e-posta gönderimi kapalı",
    smtp_auth: "posta sunucusu oturum açmamızı reddetti",
    smtp_rejected: "posta sunucusu e-postayı reddetti",
    smtp_deferred: "posta sunucusu daha sonra denememizi istedi",
    smtp_timeout: "posta sunucusu zamanında yanıt vermedi",
    smtp_unavailable: "posta sunucusuna ulaşılamadı",
    smtp_error: "e-posta gönderilemedi",
  },
  channel: {
    EMAIL: "E-posta",
    PHONE: "Telefon",
    MEETING: "Toplantı",
    OTHER: "Diğer",
  },
  docType: {
    TDS: "Teknik bilgi föyü",
    SDS: "Güvenlik bilgi formu",
    COA: "Analiz sertifikası",
    OTHER: "Belge",
  },
  language: {
    en: "İngilizce",
    nl: "Felemenkçe",
    notRecorded: "İngilizce (kaydedilmedi, ML-10 öncesi)",
  },
  count: { one: "{n} talep", other: "{n} talep" },
  exportSummary: {
    noneFiltered: "Bu filtrelere uyan talep yok; dışa aktarılacak bir şey yok.",
    none: "Henüz dışa aktarılacak talep yok.",
    tooMany:
      "{leads} uyuyor. Bir dışa aktarma en fazla {max} talep içerir; dışa aktarmak için filtreleri (örneğin tarihleri) daraltın.",
    filtered: "Bu filtrelere uyan {leads} dışa aktarılacak.",
    total: "Toplam {leads} dışa aktarılacak.",
  },

  // --- Birden çok talep ekranında kullanılan metinler -------------------------------------------
  common: {
    noAccess: "Taleplere erişiminiz yok",
    anonymised: "Anonimleştirilmiş talep",
    allLeads: "Tüm talepler",
    tryAgainLater: "Biraz sonra tekrar deneyin.",
    unassigned: "Atanmamış",
    assignedTo: "Atanan kişi:",
  },

  // --- Talep listesi -----------------------------------------------------------------------------
  list: {
    title: "Talepler",
    description:
      "Bir sitenin iletişim formuyla yazan veya talep formu gerektiren bir belge isteyen kişiler, en yeniler önce. Satış sürecinde ilerletin. Müşteri verisi: her görüntülemenin denetim kaydı tutulur.",
    notifications: "Bildirimler",
    shown: "{n} gösteriliyor",
    shownMore: "{n} gösteriliyor, devamı sonraki sayfada",
    noAccessText:
      "Talepler müşteri verisidir. Platform yöneticileri okuyabilir; diğer personelin talep erişimi olan bir role (tek bir site için Satış / CRM kullanıcısı veya müşteri verisi sorumlusu) ihtiyacı vardır. Bu rolü bir yönetici Personel ve erişim bölümünde verir. Her görüntülemenin denetim kaydı tutulur.",
    loadError: "Talepler yüklenemedi",
    filterLabel: "Talepleri filtrele",
    searchLabel: "Ad, şirket veya e-postaya göre ara",
    searchPlaceholder: "Ad, şirket veya e-posta ara",
    site: "Site",
    allSites: "Tüm sitelerim",
    status: "Durum",
    anyStatus: "Tüm durumlar",
    source: "Kaynak",
    anySource: "Tüm kaynaklar",
    anyone: "Herkes",
    assignedToMe: "Bana atananlar",
    apply: "Uygula",
    createdFrom: "Oluşturulma başlangıcı",
    createdTo: "Oluşturulma bitişi",
    clearFilters: "Filtreleri temizle",
    exportUnavailable: "Dışa aktarma kullanılamıyor: talep sayısı yüklenemedi (HTTP {status}).",
    noMatches: "Uyan talep yok",
    noMatchesText: "Başka bir arama, filtre veya tarih aralığı deneyin.",
    empty: "Henüz talep yok",
    emptyText:
      "Public sitelerden gelen iletişim formu mesajları ve belge talepleri burada görünür.",
    noLongerAccess: " (artık erişimi yok)",
    hold: "Saklanıyor",
    marketingOk: "Pazarlama izni var",
    freeMail: "Ücretsiz e-posta",
    documentRequests: {
      one: "{count} belge talebi",
      other: "{count} belge talebi",
    },
    firstPage: "İlk sayfa",
    nextPage: "Sonraki sayfa",
  },

  // --- Tek talep ---------------------------------------------------------------------------------
  detail: {
    title: "Talep",
    noAccessText: "Talepler müşteri verisidir ve müşteri verisi rolü gerektirir.",
    hold: {
      CUSTOMER: "müşteri",
      OPEN_OPPORTUNITY: "açık fırsat",
      LEGAL_HOLD: "yasal saklama",
    },
    source: "Kaynak: {source}",
    anonymisedAt: "Anonimleştirildi: {date}",
    retentionHold: "Saklama nedeni: {reason}",
    marketingConsentAt: "Pazarlama izni: {date}",
    noMarketingConsent: "Pazarlama izni yok",
    freeMail: "Ücretsiz e-posta adresi",
    pipeline: "Satış süreci",
    offPipeline:
      "Satış sürecinin dışında; İletişime geçildi veya Nitelikli olarak yeniden açılabilir.",
    workflow: {
      title: "Satış iş akışı",
      assignedTo: "Atanan kişi: {name}",
      assignedToInactive: "Atanan kişi: {name} (artık bu sitenin taleplerine erişimi yok)",
      notAssigned: "Henüz atanmadı.",
      heldCustomer:
        "Müşteri: bu durumda kaldığı sürece 24 aylık otomatik anonimleştirmenin dışında tutulur.",
      heldOpportunity:
        "Açık fırsat: bu durumda kaldığı sürece 24 aylık otomatik anonimleştirmenin dışında tutulur.",
      anonymised:
        "Bu talep anonimleştirildi; durumu ve geçmişi kayıt olarak saklanır ve değiştirilemez.",
      readOnly:
        "Bu talebi okuyabilirsiniz. Durumunu veya atamasını değiştirmek için bu sitede bir satış rolü gerekir.",
    },
    activity: {
      title: "Etkinlik",
      description: "Notlar, iletişimler, durum ve atama değişiklikleri: kim neyi ne zaman yaptı.",
      note: "Not",
      contact: "İletişim · {channel}",
      otherChannel: "diğer",
      status: "Durum {from} → {to}",
      assigned: "Atandı: {name}",
      unassignedWas: "Atama kaldırıldı (önceki: {name})",
      empty: "Henüz satış etkinliği yok.",
      by: "{name} tarafından",
      tookPlace: " · gerçekleşme: {date}",
      redacted: "Metin, talep anonimleştirilirken temizlendi.",
    },
    contact: {
      title: "İletişim bilgileri",
      email: "E-posta",
      company: "Şirket",
      country: "Ülke",
      requests: "Talepler",
      requestsValue: "{count} · ilk: {date}",
    },
    messages: {
      title: "İletişim formu mesajları",
      description:
        "Her mesaj, gönderildiği haliyle bilgileri ve formla birlikte gösterilen gizlilik bildirimini saklar (kanıt, hiçbir zaman düzenlenmez).",
      cleared: "Mesaj temizlendi",
      noSubject: "Konu yok",
      clearedText: "Talep anonimleştirilirken temizlendi.",
      clearedTextAt: "Talep anonimleştirilirken temizlendi ({date}).",
      submittedAs: "Gönderen bilgileri",
      submittedCleared: "temizlendi, {country}",
      staffEmail: "Personel e-postası",
      sent: {
        one: "{date} tarihinde {count} kişiye gönderildi",
        other: "{date} tarihinde {count} kişiye gönderildi",
      },
      retry: "Yeniden denenmeyi bekliyor ({attempt}. deneme başarısız: {reason})",
      waiting: "Gönderilmeyi bekliyor",
      notSent: "{status}: {reason}. Mesajın kendisi burada saklanır.",
      failed: {
        one: "{status}: {reason}, {count} denemeden sonra. Mesajın kendisi burada saklanır.",
        other: "{status}: {reason}, {count} denemeden sonra. Mesajın kendisi burada saklanır.",
      },
      unknownReason: "bilinmeyen neden",
      formLanguage: "Form dili",
      noticeShown: "Gösterilen gizlilik bildirimi",
      version: "sürüm {version} ({language})",
      empty: "İletişim formundan mesaj yok.",
    },
    requests: {
      title: "İndirilen belgeler ve talep geçmişi",
      description:
        "Her talep, gönderildiği haliyle bilgileri ve onayı saklar (kanıt, hiçbir zaman düzenlenmez).",
      empty: "Belge talebi yok.",
      revision: "{type} · revizyon {revision}",
      reference: "referans",
      cleared: "temizlendi",
      notice: "Gizlilik bildirimi",
      marketingConsent: "Pazarlama izni",
      consentGiven: "verildi (sürüm {version})",
      consentGivenIn: "verildi (sürüm {version}, {language})",
      consentNotGiven: "verilmedi",
      grant: "İndirme {count} / {max} · bağlantı geçerlilik sonu: {date}",
      stampedCopy: "damgalı kopya",
      hashCleared: "(hash temizlendi)",
      notDownloaded: "İndirilmedi.",
    },
  },

  // --- Satış iş akışı formları -------------------------------------------------------------------
  workflow: {
    label: "Durumu veya atamayı değiştir",
    moveTo: "Yeni durum",
    keepHint: "Yalnız atamayı değiştirmek için olduğu gibi bırakın.",
    keep: "{status} olarak kalsın",
    final: "{status} (kesin)",
    assigneeHint: "Yalnız bu sitenin talepleri üzerinde çalışan personel listelenir.",
    currentNoAccess: "Mevcut atanan kişi (artık erişimi yok)",
    me: " (ben)",
    meButton: "Bana ata",
    note: "Bu değişiklikle not (isteğe bağlı)",
    notePlaceholder: "Durum neden değişiyor, ne kararlaştırıldı…",
    save: "Değişikliği kaydet",
    saved: "Kaydedildi. Değişiklik etkinlik geçmişinde.",
    activity: {
      label: "Not ekleyin veya iletişim kaydedin",
      entryType: "Kayıt türü",
      note: "Not",
      contact: "İletişim",
      channel: "Kanal",
      when: "Ne zaman",
      summary: "Özet",
      hint: "Bu sitenin taleplerini okuyan personel görür. Talep anonimleştirilirken temizlenir.",
      notePlaceholder: "Ekibin bilmesi gerekenler…",
      contactPlaceholder: "Neler konuşuldu, sonraki adımlar…",
      addNote: "Not ekle",
      recordContact: "İletişimi kaydet",
      whenRequired: "İletişimin ne zaman gerçekleştiğini girin.",
      noteAdded: "Not eklendi.",
      contactRecorded: "İletişim kaydedildi.",
    },
  },

  // --- CSV dışa aktarma --------------------------------------------------------------------------
  export: {
    region: "Talepleri dışa aktar",
    separator: "Ayraç",
    separators: {
      semicolon: {
        label: "Noktalı virgül (;)",
        hint: "Felemenkçe veya Türkçe ayarlı Excel'de sütunlara ayrılarak açılır.",
      },
      comma: {
        label: "Virgül (,)",
        hint: "İngilizce ayarlı Excel, Google Sheets ve diğer araçlar için.",
      },
    },
    buttonTitle: "Filtrelenen talepleri CSV dosyası olarak indir",
    needsPermission: "Talep dışa aktarma yetkisi gerekir",
    busy: "Dışa aktarılıyor…",
    button: "CSV dışa aktar",
    noPermission:
      "Dışa aktarma, talep dışa aktarma yetkisi gerektirir (müşteri verisi sorumlusu veya platform yöneticisi). Her dışa aktarmanın denetim kaydı tutulur.",
    stepUpLabel: "Dışa aktarmayı onayla",
    code: "Doğrulama kodu",
    codeHint: "Müşteri verisini dışa aktarmak için yeni bir onay gerekir.",
    confirm: "Onayla ve dışa aktar",
    cancel: "İptal",
    done: "{file} indirildi ({leads}).",
    errors: {
      tooManyRows:
        "Tek bir dosya için çok fazla talep var (en fazla {max}). Filtreleri, örneğin tarihe göre, daraltın.",
      beforeFrom: "Bitiş tarihi başlangıç tarihinden önce.",
      unreachable: "Yönetim API'sine ulaşılamıyor. Bağlantıyı kontrol edip tekrar deneyin.",
      failedHttp: "Dışa aktarma başarısız oldu (HTTP {status}). Biraz sonra tekrar deneyin.",
      ref: " (HTTP {status}, {code}, istek {requestId})",
      separator: "Bir ayraç seçin: noktalı virgül (;) veya virgül (,).",
      forbidden:
        "Bu talepleri dışa aktaramazsınız. Dışa aktarma, seçilen her sitede talep dışa aktarma yetkisi gerektirir (müşteri verisi sorumlusu veya platform yöneticisi).",
      session: "Oturumunuz sona erdi. Yeniden oturum açın.",
      failed: "Dışa aktarma başarısız oldu.",
      interrupted: "İndirme, dosya tamamlanmadan kesildi. Hiçbir şey kaydedilmedi; tekrar deneyin.",
    },
  },

  // --- İletişim formu bildirimleri ---------------------------------------------------------------
  notifications: {
    title: "Talep bildirimleri",
    description:
      "Biri bir sitenin iletişim formuyla yazdığında satış ekibine e-posta gönderin. Her mesaj önce talep olarak saklanır; e-posta yalnızca ona bağlantı verir.",
    transport: {
      capture:
        "Bu ortam gerçek e-posta göndermez: bildirimler kaydedilir ve test için platform içinde tutulur.",
      off: "Bu ortamda e-posta gönderimi kapalı: bildirimler gönderilmedi olarak kaydedilir.",
    },
    forbiddenTitle: "Bildirimleri yalnız talep yöneticileri değiştirir",
    forbiddenText:
      "Bir sitenin talepleri üzerinde çalışan personel (orada Satış / CRM kullanıcısı) ve platform yöneticileri, yeni iletişim formu mesajları için kime e-posta gönderileceğini seçer.",
    loadError: "Ayarlar yüklenemedi",
    lastChanged: "Son değişiklik: {date}.",
    lastChangedBy: "Son değişiklik: {date}, {name}.",
    notSetUp: "Henüz ayarlanmadı: e-posta gönderilmiyor.",
    last30: "Son 30 gün",
    last30Label: "Son 30 günün bildirimleri",
    form: {
      label: "{site} bildirimleri",
      enable: "Yeni iletişim formu mesajlarında personele e-posta gönder",
      enableHint:
        "E-posta yalnızca bir mesaj geldiğini söyler ve buradaki talebe bağlantı verir. Adlar, e-posta adresleri ve mesaj CRM'de kalır.",
      who: "E-postayı kimler alır",
      whoCount: "({n} / en fazla {max})",
      nobody:
        "Henüz kimse bu sitenin taleplerini okuyamıyor. Önce Personel ve erişim bölümünde birine talep rolü verin.",
      noLeadAccess: "Talep erişimi yok",
      onlyReaders:
        "Yalnız bu sitenin taleplerini okuyabilen personel listelenir. Biri bu erişimi kaybederse e-postayı hemen almayı bırakır.",
      save: "Kaydet",
      undo: "Değişiklikleri geri al",
      chooseOne: "En az bir kişi seçin veya e-postayı kapatın.",
      saved: "Kaydedildi. Yeni mesajlar bu ayarlara göre işlenir.",
    },
  },
};
