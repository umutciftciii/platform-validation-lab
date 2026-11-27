/**
 * DP-298 (ADR-031): Turkish messages of the data-processing screens (see ./en.ts). Terms follow
 * docs/i18n/admin-glossary.md; "notice" is "bilgilendirme" (aydınlatma), "consent" is "rıza".
 * Version names, SHA-256 values, permission keys and the API's blocker lines stay unchanged.
 */
export const legal = {
  texts: {
    metaTitle: "Hukuki metinler",
    title: "Hukuki metinler",
    description:
      "Gizlilik politikası, form bilgilendirmeleri ve rıza metinleri, dil başına. Formlar ve gizlilik sayfası her zaman güncel yayınlanmış sürümü kullanır.",
    loadError: "Hukuki metinler yüklenemedi",
    loadErrorText: "Birazdan tekrar deneyin.",
    noAccessTitle: "Hukuki metinlere erişiminiz yok",
    noAccessText:
      "Hukuki metinleri okumak için legal_text:edit veya legal_text:publish izni gerekir. Erişim için sistem sahibine başvurun.",
    immutable:
      "Yayınlanmış sürümler kanıttır ve hiçbir zaman değişmez: her form, gösterdiği metnin sürümünü ve SHA-256 değerini saklar. Bir metni değiştirmek için güncel sürümden yeni bir taslak başlatın ve onu yeni bir sürüm olarak yayınlayın.",
    readOnly:
      "Hukuki metinleri okuyabilirsiniz. Taslaklar için legal_text:edit; yayınlamak ve hukuki incelemeyi kaydetmek için legal_text:publish izni gerekir.",
    markupHelp:
      "Gizlilik politikası biçimi: {heading} satırı yeni bir bölüm başlatır, boş satır yeni bir paragraf başlatır, {item} ile başlayan satır bir liste maddesidir.",
    blockers: {
      title: "Production yayın engelleri",
      description:
        "Gizlilik sayfasının ve formların production ortamında yayınlanmasını hâlâ engelleyenler. Yerel ve staging ortamları bunları taslak olarak gösterir.",
      none: "Production yayınını engelleyen bir şey yok.",
      pill: "Production yayınını engeller",
    },
    kinds: {
      POLICY: "Politika",
      NOTICE: "Bilgilendirme (rıza değildir)",
      CONSENT: "Rıza (isteğe bağlı, geri alınabilir)",
    },
    documents: {
      PRIVACY_POLICY: "Gizlilik Politikası",
      DOCUMENT_REQUEST_NOTICE: "PDF indirme kişisel veri bilgilendirmesi",
      CONTACT_NOTICE: "İletişim ve talep işleme bilgilendirmesi",
      MARKETING_CONSENT: "İsteğe bağlı pazarlama rızası",
      AI_PROCESSING_NOTICE: "Yapay zekâ destekli işleme bilgilendirmesi",
      AI_PROCESSING_CONSENT:
        "Yapay zekâ destekli işleme rızası (yalnızca hukuki inceleme rıza gerektirirse)",
      INTERNATIONAL_TRANSFER_NOTICE: "Yurt dışına aktarım bilgilendirmesi",
      INTERNATIONAL_TRANSFER_CONSENT: "Yurt dışına aktarım rızası (yalnızca istisna olarak)",
    },
    places: {
      PRIVACY_POLICY: "/privacy sayfasında kullanılır (BV ve kurumsal site)",
      DOCUMENT_REQUEST_NOTICE: "Belge talep formunda kullanılır (zorunlu onay)",
      CONTACT_NOTICE: "İletişim formunda kullanılır (gösterilir, onay kutusu yok)",
      MARKETING_CONSENT: "Belge talep formunda kullanılır (isteğe bağlı, işaretsiz)",
    },
    usedByOther: "Kullanıldığı yer:",
    futureUse: "İleride kullanım için hazırlandı — hiçbir yerde gösterilmiyor",
    languages: {
      en: "İngilizce",
      nl: "Felemenkçe",
      tr: "Türkçe",
      de: "Almanca",
      fr: "Fransızca",
    },
    languageLabel: "Dil",
    current: {
      title: "Güncel sürüm",
      none: "Yayınlanmadı",
      version: "Sürüm {version}",
      sha: "SHA-256 özeti",
      publishedBy: "{name} tarafından {date} tarihinde yayınlandı",
      publishedAt: "{date} tarihinde yayınlandı",
      reviewNote: "İnceleme notu",
      translates: "{version} sürümünün çevirisi",
      viewText: "Metni göster",
    },
    review: {
      REQUIRED: "Hukuki inceleme gerekli",
      APPROVED: "Hukuki inceleme onaylandı",
      approvedBy: "{name} tarafından {date} tarihinde onaylandı",
      approvedAt: "{date} tarihinde onaylandı",
      record: "Hukuki incelemeyi kaydet",
      recordLabel: "Hukuki incelemeyi kaydet: {document} ({language}) {version}",
      confirmTitle: "Hukuki inceleme kaydedilsin mi?",
      confirmText:
        "Bu işlem, bir hukuk incelemecisinin tam olarak bu metni onayladığını kaydeder ({version}, SHA-256 {hash}). Sonraki her değişiklik, kendi incelemesini gerektiren yeni bir sürümdür.",
      confirm: "Onayı kaydet",
      recorded: "Hukuki inceleme kaydedildi.",
    },
    draft: {
      title: "Taslak",
      none: "Taslak yok",
      unnamed: "Taslak (yayınlanınca adlandırılır)",
      edited: "Son düzenleme {date} · revizyon {revision}",
      createdBy: "Başlatan: {name}",
      newDraft: "Yeni taslak",
      newFromCurrent: "Güncel sürümden yeni taslak",
      newLabel: "Yeni taslak: {document} ({language})",
      edit: "Taslağı düzenle",
      editLabel: "Taslağı düzenle: {document} ({language})",
      newTitle: "Yeni taslak: {document} ({language})",
      editTitle: "Taslağı düzenle: {document} ({language})",
      text: "Metin",
      textHint: "En fazla {max} karakter. Satır sonları korunur.",
      chars: "{count} / {max} karakter",
      reviewNote: "İnceleyenler için not",
      placeholders: "Bu belgede kullanılabilecek yer tutucular:",
      noPlaceholders: "Bu belge yer tutucu kullanmaz.",
      reviewNoteHint: "Hukuk incelemecilerinin neye bakması gerektiği. Hiçbir zaman yayınlanmaz.",
      translates: "Bu metin, güncel İngilizce sürümün ({version}) çevirisidir",
      save: "Taslağı kaydet",
      create: "Taslak oluştur",
      saved: "Taslak kaydedildi.",
      created: "Taslak oluşturuldu.",
      stale:
        "Bu taslak bu arada başka biri tarafından değiştirildi. Son kaydedilen metin yüklendi; kontrol edip yeniden kaydedin.",
      loading: "Metin yükleniyor…",
      loadFailed: "Metin yüklenemedi.",
      delete: "Taslağı sil",
      deleteLabel: "Taslağı sil: {document} ({language})",
      deleteTitle: "Bu taslak silinsin mi?",
      deleteText: "Taslak kaldırılır. Yayınlanmış sürümler etkilenmez. Bu işlem geri alınamaz.",
      deleted: "Taslak silindi.",
      resetsReview: "Bir değişikliği kaydetmek taslağın hukuki incelemesini yeniden gerekli yapar.",
    },
    publish: {
      action: "Yayınla",
      label: "Yayınla: {document} ({language})",
      title: "{document} ({language}) yayınlansın mı?",
      text: "Yayınlamak aşağıdaki metni tam olarak bu haliyle yeni bir sürüm olarak dondurur. Sonradan hiçbir zaman düzenlenemez veya silinemez; formlar ve sayfalar bundan sonra bu sürümü kullanır.",
      hash: "Tam olarak bu metin yayınlanır: SHA-256 {hash}",
      confirm: "Sürümü yayınla",
      published: "{version} sürümü olarak yayınlandı.",
      reviewPending:
        "Hukuki incelemesi hâlâ gerekli: inceleme kaydedilene kadar production yayını engelli kalır.",
    },
    history: {
      title: "Geçmiş",
      show: "Geçmiş",
      showLabel: "Geçmiş: {document} ({language})",
      description:
        "{document} metninin {language} dilindeki tüm sürümleri, en yenisi önce. Yayınlanmış sürümler hiçbir zaman değişmez.",
      empty: "Henüz sürüm yok.",
      back: "Tüm hukuki metinler",
      loadError: "Geçmiş yüklenemedi.",
      status: {
        DRAFT: "Taslak",
        PUBLISHED: "Yayınlandı",
      },
    },
    rules: {
      stale:
        "Metin bu arada değişti (taslak başka biri tarafından kaydedildi). Sayfayı yenileyip son metni kontrol edin.",
      draft_exists: "Bu metin ve dil için zaten bir taslak var. Bunun yerine o taslağı düzenleyin.",
      published: "Bu sürüm zaten yayınlandı ve artık değiştirilemez.",
      already_approved: "Bu sürümün hukuki incelemesi zaten kaydedildi.",
      db_guard: "Veritabanı değişikliği reddetti. Sayfayı yenileyip tekrar deneyin.",
      required: "Metin boş.",
      too_long: "Metin bu belge için çok uzun.",
      text_before_section:
        "Satır {line}: ilk bölümden önce metin var. Politikaya {heading} satırıyla başlayın.",
      duplicate_id:
        "Satır {line}: bu bölüm kimliği iki kez kullanılıyor. Her bölüm kimliği benzersiz olmalıdır.",
      empty: "Politikada en az bir bölüm ({heading} satırı) olmalıdır.",
      published_source_of_same_document:
        "Bir çeviri, aynı belgenin başka bir dildeki yayınlanmış sürümünü göstermelidir.",
      unknown_placeholder:
        "{name} bu belgede kullanılabilecek bir yer tutucu değil. Kaldırın veya metnin üstünde listelenenlerden birini kullanın.",
      missing_value:
        "{name} için henüz değer yok; bu metin yayımlanamaz. Önce değerin sağlanması gerekir.",
    },
    preview: {
      title: "Önizleme (gösterileceği hâliyle)",
      hint: "Güncel şirket ve hukuki bilgilerle, web sitesiyle aynı kodla doldurulur.",
      missingTitle: "Eksik değerler",
      missingHint:
        "“[pending: …]” olarak gösterilir. Bir değer eksik olduğu sürece formlar ve gizlilik sayfası production ortamında yayınlanmaz.",
      none: "Eksik değer yok.",
      blocked: "Şu anda yayın reddedilir: {reason}",
    },
    api: {
      unreachable: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.",
      failed: "Değişiklik kaydedilemedi.",
      forbidden: "Bu işlem için izniniz yok.",
    },
    common: {
      cancel: "İptal",
      close: "Kapat",
    },
  },
  consents: {
    title: "Rızalar",
    description:
      "Bu kişinin isteğe bağlı, ayrı ve geri alınabilir rızaları; her verme veya geri alma ayrı bir kayıttır. Bilgilendirmeler rıza değildir; her talebin yanında listelenir.",
    purposes: {
      MARKETING_EMAIL: "Pazarlama e-postası",
      AI_PERSONAL_DATA: "Kişisel verilerin yapay zekâ ile işlenmesi",
      INTERNATIONAL_TRANSFER: "Yurt dışına aktarım",
    },
    state: {
      GRANTED: "Verildi",
      WITHDRAWN: "Geri alındı",
      none: "Hiç verilmedi",
    },
    since: "{date} tarihinden beri",
    currentLabel: "Amaç başına güncel durum",
    history: "Geçmiş",
    historyEmpty: "Henüz rıza kaydı yok.",
    granted: "Veriliş yolu: {source}",
    textVersion: "Rıza metni {version}",
    withdrawn: "Geri alındı · iletilme yolu: {channel}",
    by: "Kaydeden: {name}",
    sources: {
      DOCUMENT_REQUEST: "belge talep formu",
      CONTACT_FORM: "iletişim formu",
      STAFF: "personel",
      PUBLIC_LINK: "herkese açık bağlantı",
      MIGRATION: "veri aktarımı",
    },
    channels: {
      EMAIL: "E-posta",
      PHONE: "Telefon",
      WRITTEN: "Mektup veya yazılı form",
      IN_PERSON: "Yüz yüze",
      OTHER: "Diğer",
    },
    withdraw: "Rızayı geri al",
    withdrawLabel: "Rızayı geri al: {purpose}",
    withdrawTitle: "Rıza geri alınsın mı: {purpose}?",
    withdrawText:
      "Kişinin bu rızayı geri aldığını kaydeder. Bundan sonrası için geçerlidir; önceki veriliş kaydı kanıt olarak geçmişte kalır.",
    channel: "Geri alma talebi bize nasıl ulaştı?",
    confirm: "Geri almayı kaydet",
    withdrawnOk: "Geri alma kaydedildi.",
    loadError: "Rızalar yüklenemedi.",
    readOnly: "Geri alma kaydetmek için bu kişinin sitesinde lead:manage izni gerekir.",
    noticeAcknowledged: "Onaylanan bilgilendirme (bilgi amaçlıdır, rıza değildir)",
    rules: {
      not_granted: "Bu rıza şu anda verilmiş değil; geri alınacak bir şey yok.",
      anonymised: "Bu kişi anonimleştirildi; rızaları artık değiştirilemez.",
      db_guard: "Veritabanı değişikliği reddetti. Sayfayı yenileyip tekrar deneyin.",
    },
  },
  aiTerms: {
    title: "Kişisel veriler",
    none: "Kişisel veri: izin verilmiyor (kayıtlı koşul yok)",
    recorded: "Veri işleme koşulları kaydedildi",
    alone:
      "Koşullar tek başına hiçbir şeyi etkinleştirmez: kişisel veri işleyen bir görev ayrıca onaylanmış bir işleme amacı gerektirir.",
    loadError: "Veri işleme koşulları yüklenemedi.",
    fields: {
      dpaReference: "Veri işleme sözleşmesi (DPA) referansı",
      dpaSignedOn: "DPA imza tarihi",
      transferMechanism: "Aktarım mekanizması (GDPR, V. Bölüm)",
      kvkkTransferMechanism: "Aktarım mekanizması (KVKK md. 9)",
      dataRegion: "Veri bölgesi",
      retentionSetting: "Sağlayıcıdaki saklama ayarı",
      noTraining: "Sağlayıcı verileri model eğitiminde kullanmaz",
    },
    confirmed: "Onaylandı",
    hints: {
      dpaReference: "Veri işleme sözleşmesi (GDPR md. 28): adı, numarası veya bağlantısı.",
      dataRegion: "Sağlayıcının verileri işlediği yer, örneğin “AB”.",
      retentionSetting: "Örneğin “sıfır veri saklama” veya “30 gün”.",
      noTraining: "Zorunlu: bu olmadan koşullar kaydedilemez.",
    },
    gdpr: {
      EEA_ONLY: "Yalnızca AEA içinde işlenir",
      ADEQUACY: "Yeterlilik kararı",
      EU_US_DPF: "AB-ABD Veri Gizliliği Çerçevesi",
      SCC: "Standart sözleşme maddeleri",
    },
    kvkk: {
      NOT_APPLICABLE: "Uygulanmaz",
      ADEQUACY: "Yeterlilik kararı",
      STANDARD_CONTRACT_NOTIFIED: "Kurul'a bildirilen standart sözleşme",
      EXPLICIT_CONSENT: "Açık rıza (arızi istisna)",
    },
    recordedBy: "{name} tarafından {date} tarihinde kaydedildi",
    revokedAt: "{date} tarihinde iptal edildi",
    earlier: { one: "{count} önceki kayıt", other: "{count} önceki kayıt" },
    record: "Koşulları kaydet",
    replace: "Koşulları değiştir",
    formTitle: "Veri işleme koşulları: {provider}",
    formText:
      "Herhangi bir yapay zekâ görevi bu sağlayıcıya kişisel veri göndermeden önce sağlayıcıyla neyin kararlaştırıldığını kaydedin.",
    saved: "Koşullar kaydedildi.",
    revoke: "Koşulları iptal et",
    revokeLabel: "Koşulları iptal et: {provider}",
    revokeTitle: "Veri işleme koşulları iptal edilsin mi?",
    revokeText:
      "Hiçbir yapay zekâ görevi bu sağlayıcıya artık kişisel veri gönderemez. Kayıt geçmişte kalır.",
    revoked: "Koşullar iptal edildi.",
    rules: {
      no_terms: "Bu sağlayıcı için kayıtlı koşul yok.",
    },
  },
} as const;
