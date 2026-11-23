/**
 * Turkish messages of the admin console (ML-11). Typed as `Messages`: a key missing here, or one
 * English does not have, is a compile error. Terms follow docs/i18n/admin-glossary.md. Product
 * names, codes, e-mail examples, role keys and technical values are never translated.
 */
import type { Messages } from "../types";

export const tr: Messages = {
  common: {
    tryAgain: "Tekrar dene",
    loading: "Yükleniyor",
    backToOverview: "Genel bakışa dön",
    sampleData: "Örnek veri",
    sampleDataTitle: "Tasarım prototipi için örnek veri. Hiçbir sisteme bağlı değildir.",
  },
  language: {
    label: "Dil",
    english: "English",
    turkish: "Türkçe",
    switching: "Dil değiştiriliyor…",
  },
  theme: {
    label: "Renk teması",
    light: "Açık",
    dark: "Koyu",
    system: "Sistemle aynı",
  },
  shell: {
    skipToContent: "İçeriğe geç",
    navigation: "Gezinme",
    openNavigation: "Gezinmeyi aç",
    closeNavigation: "Gezinmeyi kapat",
    breadcrumb: "Konum",
    admin: "Yönetim",
    theme: "Tema",
    homeLink: "Dream Petroleum yönetim konsolu, genel bakış",
    adminConsole: "Yönetim konsolu",
    mainNavigation: "Ana menü",
    soon: "Yakında",
    environment: "Ortam: {name}",
    environments: {
      local: "Yerel geliştirme",
      staging: "Staging",
      production: "Production",
    },
  },
  nav: {
    groups: {
      workspace: "Çalışma alanı",
      administration: "Yönetim",
      owner: "Sistem sahibi",
    },
    items: {
      overview: { label: "Genel bakış", summary: "İki sitedeki etkinlik ve durum." },
      content: {
        label: "İçerik",
        summary: "İki sitenin sayfalarını yazın, inceleyin ve yayınlayın.",
      },
      products: {
        label: "Ürünler",
        summary: "Ürün bilgi föylerini ve teknik özellikleri güncel tutun.",
      },
      seo: {
        label: "SEO",
        summary: "BV sitesinin arama sonuçları ve bağlantı önizlemeleri.",
      },
      companyReview: {
        label: "Şirket incelemesi",
        summary: "Şirket onayına sunulan ürün metni önerileri.",
      },
      leads: {
        label: "Talepler",
        summary:
          "Public sitelerden gelen iletişim formu mesajları ve belge talepleri (müşteri verisi, denetim kaydı tutulur).",
      },
      sites: {
        label: "Siteler",
        summary: "Her sitenin alan adları, menüleri ve yayın ayarları.",
      },
      staff: {
        label: "Personel ve erişim",
        summary: "Personel davet edin, talep erişimi dahil rolleri verin veya geri alın.",
      },
      audit: {
        label: "Denetim kaydı",
        summary: "Her oturum açma, yetki değişikliği ve yayın, sırasıyla.",
      },
      settings: { label: "Ayarlar", summary: "Profiliniz, oturumlarınız ve doğrulayıcınız." },
      owner: {
        label: "Sistem sahibi konsolu",
        summary: "Modül anahtarları ve korumalı denetim kaydı (yalnız sistem sahibi).",
      },
    },
  },
  userMenu: {
    openMenu: "Hesap menüsü",
    menu: "Hesap",
    accountSettings: "Hesap ayarları",
    signingOut: "Oturum kapatılıyor…",
    signOut: "Oturumu kapat",
  },
  section: {
    notFound: "Bulunamadı",
    notAvailable: "{label} henüz kullanılamıyor",
    planned:
      "Bu modül yönetim konsolunun sonraki bir sürümü için planlandı. Burada henüz hiçbir şey değiştirilemez.",
  },
  notFound: {
    title: "Sayfa bulunamadı",
    text: "Bu adres yönetim konsolunda yok. Bağlantıyı kontrol edin veya genel bakışa dönün.",
  },
  errorPage: {
    title: "Bu sayfa yüklenemedi",
    text: "Yönetim hizmeti beklendiği gibi yanıt vermedi. Biraz sonra tekrar deneyin; sorun sürerse aşağıdaki referansı platform ekibine iletin.",
    reference: "Referans {digest}",
  },
  time: {
    justNow: "az önce",
    minutes: "{n} dk",
    hours: "{n} sa",
    days: { one: "{count} gün", other: "{count} gün" },
    future: "{text} sonra",
    past: "{text} önce",
    goodMorning: "Günaydın",
    goodAfternoon: "İyi günler",
    goodEvening: "İyi akşamlar",
  },
  errors: {
    VALIDATION_FAILED: "İstek geçersiz.",
    AUTH_TOKEN_INVALID: "Bu bağlantı geçersiz veya süresi dolmuş.",
    AUTH_INVALID_CREDENTIALS: "E-posta adresi veya parola yanlış.",
    AUTH_MFA_INVALID: "Doğrulama kodu yanlış.",
    AUTH_CHALLENGE_EXPIRED: "Oturum açma denemesinin süresi doldu. Lütfen yeniden oturum açın.",
    AUTH_SESSION_REQUIRED: "Lütfen oturum açın.",
    AUTH_STEP_UP_REQUIRED: "Lütfen doğrulama kodunuzla onaylayın.",
    AUTH_REAUTH_REQUIRED: "Lütfen parolanızı onaylayın.",
    AUTH_CSRF_REJECTED: "İstek reddedildi.",
    FORBIDDEN: "Bu işlem için yetkiniz yok.",
    NOT_FOUND: "Bulunamadı.",
    CONFLICT_LAST_ADMIN: "Son platform yöneticisi kaldırılamaz.",
    CONFLICT_STATE: "Bu işlem mevcut durumda yapılamaz.",
    PAYLOAD_TOO_LARGE: "İstek çok büyük.",
    UNSUPPORTED_MEDIA_TYPE: "İstek JSON olmalıdır.",
    AUTH_PASSWORD_POLICY: "Parola, parola politikasına uymuyor.",
    CONFIRMATION_MISMATCH: "Onay metni eşleşmiyor.",
    RATE_LIMITED: "Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.",
    INTERNAL_ERROR: "Bir sorun oluştu.",
    BAD_GATEWAY: "Hizmet şu anda kullanılamıyor.",
    STORAGE_UNAVAILABLE: "Dosya depolama şu anda kullanılamıyor. Daha sonra tekrar deneyin.",
  },
  auth: {
    railTitle: "İki site için tek konsol.",
    railText:
      "dreampetroleumbv.com ve kurumsal site için sayfalar, ürün bilgi föyleri ve personel erişimi.",
    adminConsole: "Yönetim konsolu",
    staffOnly: "Yalnız personel içindir. Her oturum açma kaydedilir.",
    logoAlt: "Dream Petroleum BV, Energy in Motion",
    tooManyAttempts: "Çok fazla deneme yapıldı. Tekrar denemeden önce birkaç dakika bekleyin.",
    unreachable: "Yönetim hizmetine ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.",
    cookiesBlocked:
      "Bu tarayıcı güvenli oturum çerezini saklamadı, bu yüzden oturum açma burada tamamlanamıyor. Yerel geliştirme adresinde (http://…localhost) Safari bu tür çerezleri reddeder: orada Chrome veya Firefox kullanın ya da konsolun https adresini açın.",
    authenticatorCode: "Doğrulama kodu",
    recoveryCode: "Kurtarma kodu",
    useRecoveryCode: "Bunun yerine kurtarma kodu kullan",
    useAuthenticator: "Bunun yerine doğrulayıcı uygulamayı kullan",
    checking: "Kontrol ediliyor…",
    verifying: "Doğrulanıyor…",
  },
  login: {
    metaTitle: "Oturum aç",
    title: "Oturum aç",
    intro: "Personel hesabınızı kullanın. Doğrulayıcı uygulamanız gerekecek.",
    lockedOut:
      "Hesabınız kilitlendi veya doğrulayıcınızı mı kaybettiniz? Bir platform yöneticisinden kurtarma bağlantısı isteyin.",
    workEmail: "İş e-postası",
    password: "Parola",
    continue: "Devam et",
    codeHelp: "Doğrulayıcı uygulamanızdaki 6 haneli kodu girin.",
    recoveryHelp:
      "Kaydettiğiniz kurtarma kodlarından birini girin, örneğin ABCDE-12345. Her kod yalnız bir kez geçerlidir.",
    signIn: "Oturum aç",
    startOver: "Baştan başla",
    csrfRejected:
      "Bu adresten oturum açılmasına izin verilmiyor. Yönetim konsolunu yapılandırılmış adresinden açıp tekrar deneyin.",
    unavailable: "Oturum açma şu anda kullanılamıyor. Biraz sonra tekrar deneyin.",
  },
  link: {
    progress: "İlerleme",
    stepDone: "Tamamlandı: ",
    stepCurrent: "Geçerli adım: ",
    stepNext: "Sonraki: ",
    ruleMet: "Karşılandı: ",
    ruleNotMet: "Henüz karşılanmadı: ",
    showPassword: "Göster: {field}",
    hidePassword: "Gizle: {field}",
    goToSignIn: "Oturum açmaya git",
    checkingLink: "Bağlantınız kontrol ediliyor…",
    passwordRules: "Parola kuralları",
    bothMatch: "İki giriş aynı",
    newPassword: "Yeni parola",
    repeatNewPassword: "Yeni parolayı tekrarlayın",
    invalidTitle: "Bu bağlantı kullanılamıyor",
    saving: "Kaydediliyor…",
    policy: {
      too_short: "En az 12 karakter kullanın.",
      too_long: "En fazla 128 karakter kullanın.",
      breached: "Bu parola bilinen veri ihlallerinde geçiyor. Başka bir parola seçin.",
      contains_identity: "Adınızı veya e-posta adresinizin parçalarını kullanmayın.",
      requires_change: "Burada daha önce kullanmadığınız bir parola seçin.",
    },
    failure: {
      link: "Bu bağlantı artık kullanılamaz. Süresi dolmuş, daha önce kullanılmış veya yeni bir bağlantıyla değiştirilmiş olabilir. Bir platform yöneticisinden yeni bağlantı isteyin.",
      policy: "Daha güçlü bir parola seçin.",
      credentials: "Bu, mevcut parolanız değil. Tekrarlanan hatalar bu bağlantıyı geçersiz kılar.",
      code: "Bu kod doğru değil. Tekrarlanan hatalar bu bağlantıyı geçersiz kılar.",
      state: "Bu adımın yeniden başlaması gerekiyor. Aşağıdaki yönergeleri izleyin.",
      other: "Bir sorun oluştu. Biraz sonra tekrar deneyin.",
    },
  },
  enrol: {
    metaTitle: "Hesap kurulumu",
    railTitle: "Erişiminiz, güvenle kuruldu.",
    railText:
      "Yalnız sizin bildiğiniz bir parola ve telefonunuzdaki doğrulayıcı, konsola her oturum açmayı korur.",
    accountSetup: "Hesap kurulumu",
    openLinkTitle: "Bağlantınızı açın",
    openLinkText:
      "Bu sayfa davetinizdeki veya operatörden gelen kişisel bağlantıyla çalışır. Tam bağlantıyı, size ulaştığı haliyle yeniden açın.",
    openLinkSafety:
      "Güvenliğiniz için bağlantı, sayfa açılır açılmaz adres çubuğundan kaldırılır; bu yüzden adresi buradan kopyalamak işe yaramaz.",
    invalidText:
      "Süresi dolmuş, daha önce kullanılmış, yeni bir bağlantıyla değiştirilmiş veya çok fazla hatalı denemeden sonra engellenmiş olabilir.",
    invalidAsk:
      "Bir platform yöneticisinden yeni bağlantı isteyin. Hesap kurulumunu zaten tamamladıysanız oturum açın.",
    accountReady: "Hesap hazır",
    doneTitle: "Her şey hazır",
    doneText: "Parolanız ve doğrulayıcınız kuruldu. Şimdi bunlarla oturum açın.",
    doneCodes:
      "Kurtarma kodları yalnız bir kez gösterildi ve bu tarayıcıda saklanmıyor. Kaydetmediyseniz bir platform yöneticisinden yardım isteyin.",
    unreachableTitle: "Yönetim hizmetine ulaşılamıyor",
    unreachableText: "Bağlantınız kullanılmadı. Bağlantınızı kontrol edip tekrar deneyin.",
    linkValidUntil: "Bağlantı geçerlilik sonu: {date}",
    steps: {
      confirmPassword: "Parolayı onayla",
      password: "Parola",
      authenticator: "Doğrulayıcı",
      recoveryCodes: "Kurtarma kodları",
    },
    setPassword: "Parola belirle",
    currentPassword: "Mevcut parola",
    currentPasswordHint:
      "Parolanız değişmedi. Onaylamanız, sıfırlamanın doğru kişiye ulaştığını gösterir.",
    lengthRule: "{min}–{max} karakter; birkaç kelimeden oluşan bir parola cümlesi iyi sonuç verir",
    breachedRule:
      "Bilinen bir ihlalde geçmeyen, adınızı veya e-posta adresinizi içermeyen bir parola.",
    confirmAndContinue: "Onayla ve devam et",
    savePasswordAndContinue: "Parolayı kaydet ve devam et",
    setupTimedOut: "Kurulumun süresi doldu. Eski kaydı uygulamanızdan silin ve yeni kodu tarayın.",
    preparingKey: "Doğrulayıcı anahtarınız hazırlanıyor…",
    scanStep: "1. Bu kodu doğrulayıcı uygulamanızla tarayın",
    appExamples: "Örneğin Microsoft Authenticator, Google Authenticator, 1Password veya Authy.",
    qrLabel: "Doğrulayıcı uygulamanız için QR kod",
    cannotScan: "Tarayamıyor musunuz? Bunun yerine bu anahtarı uygulamaya girin:",
    keyCopied: "Anahtar kopyalandı",
    copyKey: "Anahtarı kopyala",
    openInApp: "Doğrulayıcı uygulamada aç",
    confirmAuthenticator: "Doğrulayıcıyı onayla",
    enterCodeStep: "2. Uygulamanın gösterdiği 6 haneli kodu girin",
    phoneTime: "Telefonunuzun saatinin otomatik ayarlandığından emin olun.",
    verifyAndActivate: "Doğrula ve etkinleştir",
    reloadedNote:
      "Sayfayı yenilediniz mi? Yeni bir anahtar oluşturuldu; uygulamanızda yalnız en yeni kayıt çalışır.",
    accountActive: "Hesap etkin",
    codesTitle: "Kurtarma kodlarınızı kaydedin",
    codesText:
      "Telefonunuzu kaybederseniz her kod, doğrulayıcının yerine bir kez oturum açmanızı sağlar. Kodlar yalnız şimdi gösterilir ve tekrar görüntülenemez.",
    codesLabel: "Kurtarma kodları",
    downloadTxt: ".txt indir",
    copied: "Kopyalandı",
    copyAll: "Tümünü kopyala",
    codesStored: "Bu kodları telefonumdan ayrı, güvenli bir yerde sakladım.",
    continueToSignIn: "Oturum açmaya devam et",
    codesFile: {
      heading: "Dream Petroleum yönetim konsolu: kurtarma kodları",
      account: "Hesap: {email}",
      once: "Her kod, doğrulayıcınız yanınızda olmadığında oturum açmak için bir kez geçerlidir.",
      offline: "Bu dosyayı çevrimdışı ve paylaşılan klasörlerin dışında saklayın.",
    },
    kinds: {
      activation: {
        eyebrow: "Hesap etkinleştirme",
        title: "Hesabınızı etkinleştirin",
        intro:
          "Hesap kurulumunu tamamlamak için bir parola belirleyin ve doğrulayıcı uygulamanızı bağlayın.",
      },
      invitation: {
        eyebrow: "Davet",
        title: "Davetinizi kabul edin",
        intro:
          "Dream Petroleum yönetim konsoluna davet edildiniz. Bir parola belirleyin ve doğrulayıcı uygulamanızı bağlayın.",
      },
      recovery: {
        eyebrow: "Hesap kurtarma",
        title: "Hesabınızı kurtarın",
        intro:
          "Önceki parolanız, doğrulayıcınız ve kurtarma kodlarınız operatör tarafından silindi. Yeniden oturum açmak için yenilerini belirleyin.",
      },
      mfa_reenrolment: {
        eyebrow: "Doğrulayıcı sıfırlama",
        title: "Doğrulayıcınızı yeniden kurun",
        intro:
          "Bir yönetici doğrulayıcınızı sıfırladı. Mevcut parolanızı onaylayın, ardından doğrulayıcı uygulamanızı yeniden bağlayın.",
      },
    },
  },
  reset: {
    metaTitle: "Parola sıfırlama",
    eyebrow: "Parola sıfırlama",
    openLinkTitle: "Sıfırlama bağlantınızı açın",
    openLinkText:
      "Bu sayfa operatörden gelen kişisel sıfırlama bağlantısıyla çalışır. Tam bağlantıyı, size ulaştığı haliyle yeniden açın.",
    invalidText:
      "Süresi dolmuş, daha önce kullanılmış, yeni bir bağlantıyla değiştirilmiş veya çok fazla hatalı denemeden sonra engellenmiş olabilir. Bir platform yöneticisinden yenisini isteyin.",
    doneTitle: "Parolanız değiştirildi",
    doneText: "Hesabınızın önceki tüm oturumları kapatıldı. Yeni parolanızla oturum açın.",
    title: "Yeni bir parola seçin",
    intro:
      "Doğrulayıcınız aynı kalır. Onaylamak için doğrulayıcınız veya bir kurtarma kodu gerekir.",
    formLabel: "Parolayı sıfırla",
    lengthRule: "12–128 karakter",
    changePassword: "Parolayı değiştir",
  },
};
