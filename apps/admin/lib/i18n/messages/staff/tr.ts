/**
 * ML-12e (DP-243): Staff alanının Türkçe metinleri. Anahtarlar İngilizce sözlükle birebir aynıdır
 * (eksik/fazla anahtar derleme hatası). Terimler docs/i18n/admin-glossary.md.
 */
import type { Messages } from "../../types";

export const staff: Messages["staff"] = {
  /** lib/staff-client.ts (sahip konsolu ve lead iş akışı da kullanır): API yanıtlarının mesajları. */
  api: {
    unreachable: "Yönetim API'sine ulaşılamıyor.",
    forbidden:
      "Bu değişikliği yapamazsınız (sahip olmadığınız yetkiler veya başka bir site gerekiyor).",
    saveFailed: "Değişiklik kaydedilemedi. Biraz sonra tekrar deneyin.",
    rules: {
      already_assigned: "Bu kişi o sitede bu role zaten sahip.",
      self_grant: "Kendi rollerinizi değiştiremezsiniz.",
      reciprocal_grant: "Size rolünüzü veren kişiye rol veremezsiniz.",
      membership_inactive:
        "Bu kişinin o siteye erişimi askıya alınmış. Önce erişimi yeniden etkinleştirin.",
      scope_mismatch: "Site rolü için bir site seçin, platform rolü için seçmeyin.",
      expiry_in_past: "Bitiş tarihi gelecekte olmalıdır.",
      already_ended: "Bu rol zaten sona erdi. Sayfayı yeniden yükleyin.",
      assignee_inactive: "Bu hesap kapatılmış.",
      unknown_role: "Bilinmeyen rol.",
      db_guard: "Veritabanı bu değişikliği reddetti. Sayfayı yeniden yükleyip tekrar deneyin.",
      core_module: "Çekirdek modüller her zaman açıktır ve kapatılamaz.",
      reason_required: "Değişiklik için bir gerekçe girin.",
      already_designated: "Bir sistem sahibi zaten atanmış. Bu değiştirilemez.",
      not_eligible: "Bu hesap sistem sahibi olamaz (bir parola ve bir doğrulayıcı gerekir).",
      stale:
        "Bu talep bu arada başka biri tarafından değiştirildi. Sayfayı yeniden yükleyip tekrar deneyin.",
      transition: "Bu durum değişikliğine mevcut durumdan izin verilmiyor.",
      unchanged: "Değiştirilecek bir şey yok.",
      anonymised: "Bu talep anonimleştirilmiş ve değiştirilemez.",
      assignee_not_eligible: "Bu kişi bu sitenin talepleri üzerinde çalışamaz.",
      future: "İletişim tarihi gelecekte olamaz.",
    },
  },
  /** Rol adları ve açıklamaları (rol anahtarına göre; API metni değişmişse API metni gösterilir). */
  roles: {
    system_owner: {
      name: "Sistem sahibi",
      description:
        "Sistem sahibinin tam yetki modu (God Mode): tüm modüller, tüm siteler, tüm veriler ve yönetim, modül anahtarları ve korumalı denetim kaydı. Hiçbir zaman atanmaz; atanmış tek sistem sahibinde bulunur (DP-108).",
    },
    platform_super_admin: {
      name: "Platform süper yöneticisi",
      description:
        "Tüm sitelerde platform yönetimi: kullanıcılar, roller, talep ve CRM verileri; yayıncı rollerini yönetir. Yayın yapmaz.",
    },
    platform_customer_data_officer: {
      name: "Platform müşteri verisi sorumlusu",
      description: "Tüm sitelerin müşteri ve talep verilerini okur ve dışa aktarır.",
    },
    platform_product_manager: {
      name: "Platform ürün yöneticisi",
      description:
        "Platform genelindeki ürün ana kayıtlarını oluşturur ve düzenler, her sitenin kataloğunu okur; site listeleri, onay veya yayın yok.",
    },
    site_admin: {
      name: "Site yöneticisi",
      description:
        "Tek bir siteyi yönetir, içeriğini ve ürünlerini yayınlar; müşteri verisi yok, başka site yok.",
    },
    content_editor: {
      name: "İçerik editörü",
      description: "Tek bir sitenin içerik taslaklarını yazar ve medyasını yönetir; yayınlayamaz.",
    },
    content_publisher: {
      name: "İçerik yayıncısı",
      description:
        "Tek bir sitenin incelenmiş içeriğini yayınlar ve yayından kaldırır; taslakları düzenlemez.",
    },
    product_editor: {
      name: "Ürün editörü",
      description:
        "Tek bir sitenin ürün listelerini ve kategorilerini yönetir; ürün ana kayıtlarını değiştiremez, onaylayamaz veya yayınlayamaz.",
    },
    product_publisher: {
      name: "Ürün yayıncısı",
      description: "Tek bir sitenin onaylanmış ürünlerini yayınlar; ürün verilerini düzenlemez.",
    },
    technical_reviewer: {
      name: "Teknik inceleyici",
      description: "Tek bir sitenin teknik ürün verilerini onaylar.",
    },
    sales_crm_user: {
      name: "Satış / CRM kullanıcısı",
      description: "Tek bir sitenin talepleri ve CRM'i üzerinde çalışır.",
    },
    compliance_reviewer: {
      name: "Uyum inceleyicisi",
      description: "Tek bir sitenin içeriğini ve iddialarını inceler, denetim kaydını okur.",
    },
    company_content_reviewer: {
      name: "Şirket içerik inceleyicisi",
      description:
        "Tek bir sitenin ürünlerini okur, önerilen içeriği onaylar veya değişiklik ister; düzenleyemez, teknik verileri onaylayamaz, yayınlayamaz.",
    },
    read_only: {
      name: "Salt okunur",
      description: "Tek bir sitenin içeriğini ve ürünlerini okur; müşteri verisi yok.",
    },
    member: {
      name: "Üye",
      description: "Herkese açık bir sitenin kayıtlı müşterisi.",
    },
  },
  /** Hesap durumu rozetleri. */
  status: {
    ACTIVE: "Etkin",
    PENDING: "Davet edildi",
    SUSPENDED: "Askıya alındı",
    DEACTIVATED: "Kapatıldı",
  },
  /** "Siteler:" satırında etkin olmayan site üyeliği. */
  membership: {
    ACTIVE: "etkin",
    INVITED: "davet edildi",
    SUSPENDED: "askıya alındı",
    REVOKED: "geri alındı",
  },
  /** Personel ve erişim sayfası. */
  page: {
    title: "Personel ve erişim",
    description:
      "Birkaç adımda rol verin: kişi, rol, site. Roller hemen geçerli olur ve bir bitiş tarihi belirlemediğiniz sürece siz kaldırana kadar kalır. Her değişiklik denetim kaydına yazılır.",
    forbiddenTitle: "Rolünüz için kullanılamıyor",
    forbiddenBody: "Personel hesaplarını ve rollerini yalnız yöneticiler görür.",
    errorTitle: "Personel yüklenemedi",
    errorBody: "Biraz sonra tekrar deneyin.",
    assignTitle: "Rol verin",
    peopleTitle: "Kişiler ve rolleri",
    peopleCount: { one: "{count} personel hesabı", other: "{count} personel hesabı" },
    you: "Siz",
    sites: "Siteler: {list}",
    membershipNotActive: "{site} ({status})",
    allSites: "Tüm siteler",
    unknownSite: "Site",
    roleSite: "· {site}",
    roleUntil: " · {date} tarihine kadar",
    roleBy: " · veren: {name}",
    endsSoon: "Yakında bitiyor",
    removeLabel: "{name} kişisinden {role} rolü",
    noRoles: "Rol yok.",
    inviteTitle: "Personel davet edin",
    inviteDescription:
      "Hesabı ve tek seferlik bir hesap etkinleştirme bağlantısı (parola ve doğrulayıcı) oluşturur.",
  },
  /** Rol verme formu. */
  assign: {
    form: "Rol verin",
    noRoles: "Rolleriniz başkalarına rol vermenize izin vermiyor.",
    person: "Personel",
    choosePerson: "Bir kişi seçin…",
    role: "Rol",
    chooseRole: "Bir rol seçin…",
    leadData: " · talep verisi",
    site: "Site",
    end: "Bitiş tarihi (isteğe bağlı)",
    endHint: "Boş: bitiş tarihi yok.",
    submit: "Rol ver",
    success: "{name} artık {role} rolüne sahip.",
    someone: "Kişi",
  },
  /** Rol kaldırma onayı. */
  remove: {
    remove: "Kaldır",
    removeLabel: "Kaldır: {label}",
    /** DP-274: onay modalının kısa başlığı ve sorusu. */
    title: "Rolü kaldır",
    question: "{label} kaldırılsın mı?",
    confirmLabel: "Kaldırmayı onaylayın: {label}",
    keep: "Vazgeç",
  },
  /** Davet formu. */
  invite: {
    form: "Personel davet edin",
    email: "E-posta",
    name: "Ad",
    site: "Site",
    role: "Rol (isteğe bağlı)",
    noRole: "Henüz rol yok",
    code: "Doğrulama kodu",
    codeHint: "Birini davet etmek için yeni bir doğrulama gerekir.",
    created:
      "Davet oluşturuldu. Bu tek seferlik hesap etkinleştirme bağlantısını kişiye gönderin (yalnız bir kez gösterilir): ",
    submit: "Davet et",
    confirmSubmit: "Onayla ve davet et",
  },
};
