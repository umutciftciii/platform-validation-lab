/**
 * ML-12e (DP-243): Owner alanının Türkçe metinleri. Anahtarlar İngilizce sözlükle birebir aynıdır
 * (eksik/fazla anahtar derleme hatası). Terimler docs/i18n/admin-glossary.md.
 */
import type { Messages } from "../../types";

export const owner: Messages["owner"] = {
  // Sistem sahibi konsolu.
  console: {
    title: "Sistem sahibi konsolu",
    description:
      "Sistem sahibinin God Mode alanı. İsteğe bağlı modülleri site başına açıp kapatın ve korumalı denetim kaydını inceleyin. Bu sayfayı yalnız siz görürsünüz; başkasına devredilemez.",
    auditLink: "Korumalı denetim kaydı",
    loadError: "Sistem sahibi konsolu yüklenemedi",
    loadErrorText: "Biraz sonra tekrar deneyin.",
    ownerPanel: "Sistem sahibi",
    account: "Hesap",
    designated: "Atanma tarihi",
    transfer: "Devir",
    notTransferable: "Devredilemez",
    modulesPanel: "İsteğe bağlı modüller",
    modulesDescription:
      "Kapalı bir modülün verileri korunur; işlevleri, siz dahil herkes için yeniden açılana kadar kapalı kalır. Her değişiklik için gerekçe gerekir.",
    moduleColumn: "Modül",
    lastReason: "Son gerekçe: {reason}",
    core: "Her zaman açık (çekirdek): {modules}.",
    platformPanel: "Platform modülleri",
    platformDescription:
      'Tüm platform için tek seferde ve yalnız sizin tarafınızdan açılıp kapatılır; başka kimse değiştiremez, bu yetki kimseye verilemez. Kapalı bir modül tüm menülerden gizlenir ve API\'si "bulunamadı" yanıtı verir; anahtarları, ayarları ve geçmişi korunur.',
    platformState: "Tüm platform",
    chainPanel: "Korumalı denetim zinciri",
    chainDescription:
      "Sizin işlemleriniz ve hesabınızı hedef alan her işlem SHA-256 ile zincirlenir ve personel ekranlarında hiçbir zaman gösterilmez.",
  },
  // Modül adları ve açıklamaları (modül anahtarına göre).
  modules: {
    rbac: {
      name: "Roller ve erişim",
      description: "RBAC, site kapsamı, kullanıcılar ve rol atamaları",
    },
    audit: { name: "Denetim kaydı", description: "Yalnız eklenebilen denetim olayları" },
    mfa: {
      name: "Çok faktörlü kimlik doğrulama",
      description: "MFA kaydı, ek doğrulama ve kurtarma",
    },
    platform: {
      name: "Platform yönetimi",
      description: "Siteler ve God Mode modül kataloğu",
    },
    cms: { name: "İçerik yönetimi", description: "Sayfalar, bölümler, medya ve yayınlama" },
    catalog: { name: "Ürün kataloğu", description: "Ürünler, teknik veriler ve belgeler" },
    leads: { name: "Talepler", description: "İletişim ve belge talebi kayıtları" },
    membership: {
      name: "Üyelik",
      description: "Üye hesapları ve yalnız üyelere açık teknik veriler",
    },
    crm: {
      name: "CRM 360°",
      description: "Firmalar, kişiler, müşteri sorumluları ve iletişim geçmişi",
    },
    automation: {
      name: "Otomasyon",
      description: "Kurala dayalı takipler ve bildirimler (isteğe bağlı)",
    },
    integrations: {
      name: "Entegrasyonlar",
      description: "Dışa giden entegrasyonlar ve webhook'lar (isteğe bağlı)",
    },
    customer_portal: {
      name: "Müşteri portalı",
      description: "Şirket düzeyinde belge ve talep geçmişi (isteğe bağlı)",
    },
    ai: {
      name: "Yapay Zekâ Merkezi",
      description:
        "Yapay zekâ sağlayıcıları, modeller, bütçeler ve kullanım (isteğe bağlı; sistem sahibi tarafından tüm platform için açılıp kapatılır)",
    },
  },
  // Ek doğrulama istemi.
  stepUp: {
    form: "Doğrulayıcınızla onaylayın",
    code: "Doğrulama kodu",
    hint: "Bu değişiklik, doğrulayıcı uygulamanızdan yeni bir onay gerektirir.",
    confirm: "Onayla",
    cancel: "İptal",
  },
  // Modül anahtarı.
  switch: {
    alwaysOn: "Her zaman açık",
    on: "Açık",
    off: "Kapalı",
    switchOn: "Aç",
    switchOff: "Kapat",
    switchOnLabel: "{module} modülünü {site} sitesinde aç",
    switchOffLabel: "{module} modülünü {site} sitesinde kapat",
    form: "{module} modülünü değiştir",
    reason: "Gerekçe",
    hintOff: "Kapatmak verileri silmez; modülün işlevleri herkes için durur.",
    hintOn: "Korumalı denetim kaydına yazılır.",
    platformOnLabel: "{module} modülünü tüm platformda aç",
    platformOffLabel: "{module} modülünü tüm platformda kapat",
    hintPlatformOff:
      "Modülü her yerde gizler ve yeni işleri hemen durdurur; hiçbir iş yeniden denenmez. Anahtarlar, ayarlar ve geçmiş korunur.",
    hintPlatformOn:
      "Modülü kullanma yetkisi olan personele görünür kılar. Korumalı denetim kaydına yazılır.",
    cancel: "İptal",
  },
  // Zincir doğrulama.
  chain: {
    state: "Durum",
    intact: "Sağlam",
    broken: "#{seq} numarada kırık",
    events: "Korumalı olaylar",
    checked: "Denetlendi",
    headHash: "Son hash (#{seq})",
    verify: "Şimdi doğrula",
  },
  // Korumalı denetim kaydı.
  audit: {
    title: "Korumalı denetim kaydı",
    description:
      "Personel ekranlarında hiçbir zaman gösterilmez ve silinmez. Her olay hash zincirindeki yerini taşır.",
    back: "Sistem sahibi konsolu",
    events: "Olaylar",
    empty: "Henüz korumalı olay yok.",
    load: "Korumalı olayları yükle",
    older: "Daha eski olaylar",
    outcome: { SUCCESS: "başarılı", DENIED: "reddedildi", FAILURE: "başarısız" },
    actor: { USER: "kullanıcı", SYSTEM: "sistem", BOOTSTRAP: "ilk kurulum" },
  },
  // Sistem sahibi atamasının onayı.
  confirm: {
    title: "Sistem sahibi atamasını onaylayın",
    description:
      "Sistem sahibi olarak belirlendiniz. Onaydan sonra hesabınız God Mode yetkisine sahip olur; bu yetki başka birine devredilemez.",
    panel: "Parolanız ve doğrulayıcınızla onaylayın",
    noLink:
      "Bu sayfa operatörden gelen onay bağlantısını gerektirir. Bağlantının tamamını yeniden açın.",
    success: "Artık sistem sahibisiniz. Sistem sahibi konsolu gezinme menüsündedir.",
    form: "Sistem sahibi atamasını onaylayın",
    password: "Mevcut parolanız",
    passwordHint: "Bu hesabın size ait olduğunu doğrular. Atama geri alınamaz ve devredilemez.",
    submit: "Atamayı onayla",
  },
  // Tarayıcı çağrıları.
  api: {
    unreachable: "Yönetim API'sine ulaşılamıyor.",
    failed: "İstek başarısız oldu. Biraz sonra tekrar deneyin.",
  },
};
