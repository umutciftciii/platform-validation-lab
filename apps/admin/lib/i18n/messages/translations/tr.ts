/**
 * ML-13b (DP-244): Yönetim > Çeviri yönetimi — Türkçe metinler (kaynak: ./en.ts). Terimler
 * docs/i18n/admin-glossary.md: taslak, yayında, güncel değil, kaynak/hedef, deneme. İzin anahtarları,
 * dil etiketleri, birim anahtarları ve dosya adları çevrilmez.
 */
import type { Messages } from "../../types";

export const translationPackages: Messages["translationPackages"] = {
  metaTitle: "Çeviri yönetimi",
  title: "Çeviri yönetimi",
  description:
    "Bir sitenin metinlerini çeviri paketi olarak dışa aktarın, çevirtin ve gözden geçirilmiş paketi içe aktarın. İçe aktarılan çeviriler yalnız taslak olarak kaydedilir.",
  rulesNote:
    "İçe aktarma yalnız taslakları yazar: hiçbir şey yayınlanmaz ve hedef dil ziyaretçilere açılmaz. Her paket önce kontrol edilir (hiçbir şeyi değiştirmeyen bir deneme); ardından geçerli çevirilerin içe aktarılmasını siz onaylarsınız.",
  loadError: "Çeviri yönetimi yüklenemedi",
  tryAgain: "Yönetim servisi beklendiği gibi yanıt vermedi. Birazdan tekrar deneyin.",
  noAccessTitle: "Çevrilecek site yok",
  noAccessText:
    "Rolleriniz hiçbir sitede içerik veya ürün okumanıza izin vermiyor. Bir platform yöneticisinden erişim isteyin.",
  limits:
    "Bir paket en fazla {units} metin içerebilir ve en fazla {mb} MB olabilir. Büyük sitelerde CMS ve katalogu ayrı dışa aktarın.",
  types: {
    cms: "CMS",
    catalog: "Katalog",
    cmsHint: "Sayfalar, makaleler, menüler ve parçalar; başlıkları, adresleri ve SEO metinleriyle.",
    catalogHint:
      "Ürün sayfası metinleri ve SEO metinleri, kategoriler, özellik adları ve görsel alternatif metinleri.",
    noRead: "Bu sitede bu bölümü okuma yetkiniz yok.",
  },
  export: {
    title: "Paket dışa aktar",
    intro:
      "Siteyi, hedef dili ve bölümleri seçin. Paket, kaynak dildeki her metni varsa mevcut çevirisiyle birlikte içerir; çevirmenler yalnız hedef metinleri doldurur.",
    site: "Site",
    source: "Kaynak dil",
    sourceHint: "Her zaman sitenin varsayılan dili.",
    target: "Hedef dil",
    targetHint: "Varsayılan dışındaki etkin dillerden biri.",
    notPublicOption: "{locale} (herkese açık değil)",
    notPublicHint:
      "{locale} herkese açık değil: içe aktarılan çeviriler, dil ayrıca açılana kadar ziyaretçilere görünmez.",
    noTargets: "Bu sitede çeviri yapılabilecek başka etkin dil yok.",
    types: "Bölümler",
    pickType: "En az bir bölüm seçin.",
    run: "Paketi dışa aktar",
    running: "Dışa aktarılıyor…",
    done: "Paket indirildi: {units} metin, {pages} CMS sayfası.",
  },
  import: {
    title: "Çevrilmiş paketi içe aktar",
    intro:
      "Burada dışa aktarılıp çevirmenlerce doldurulmuş bir paket dosyası seçin. Önce kontrol edilir; siz onaylamadan hiçbir şey yazılmaz.",
    file: "Paket dosyası (JSON, en fazla {mb} MB)",
    reading: "Dosya okunuyor…",
    packageLabel: "Yüklenen paket",
    fileName: "Dosya",
    siteAndLanguages: "Site ve diller",
    contents: "İçerik",
    unitCount: { one: "{count} metin", other: "{count} metin" },
    filledCount: { one: "{count} çevrilmiş", other: "{count} çevrilmiş" },
    exportedAt: "Dışa aktarılma",
    otherSite:
      "Bu paket burada göremediğiniz bir siteye ait. Kontrol, paketi kullanıp kullanamayacağınızı söyler.",
    nothingFilled:
      "Bu paketteki hiçbir metnin henüz çevirisi yok: kontrol her metni boş olarak raporlar.",
    assists: "Çeviri yardımcıları",
    assistFailed: "Yardımcı çeviri öneremedi. Paket değişmedi.",
    check: "Paketi kontrol et (deneme)",
    checking: "Kontrol ediliyor…",
    checkHint: "Yalnız okur: hiçbir şey yazılmaz.",
  },
  file: {
    empty: "Dosya boş.",
    too_large: "Dosya {mb} MB'tan büyük. CMS ve katalogu ayrı paketler olarak dışa aktarın.",
    not_json: "Dosya geçerli bir JSON değil.",
    not_package: "Dosya bu konsolun bir çeviri paketi değil.",
    version: "Bu paket sürümü desteklenmiyor. Yeni bir paket dışa aktarın.",
    schema: "Paket beklenen biçime uymuyor.",
    schemaAt:
      "Paket beklenen biçime uymuyor ({paths}). Çevirmenler yalnız hedef metinleri değiştirebilir.",
  },
  report: {
    checkTitle: "Kontrol sonucu",
    doneTitle: "İçe aktarma sonucu",
    checkSummary:
      "{total} metinden {writable} tanesi taslak olarak içe aktarılabilir; {skipped} tanesi atlanır. Hiçbir şey yazılmadı.",
    doneSummary:
      "{written} taslak kaydı yazıldı; {skipped} metin atlandı. Hiçbir şey yayınlanmadı.",
    writtenLabel: "Yazılan taslaklar",
    missingPermissions:
      "Bu paketi kontrol edebilirsiniz ama içe aktaramazsınız. Eksik izinler: {permissions}.",
    filterLabel: "Sonuca göre filtrele",
    filterChip: "{label} ({n})",
    search: "Metin ve anahtarlarda ara",
    noUnits: "Pakette metin yok.",
    noMatch: "Bu filtreye uyan metin yok.",
    pages: "Tablo sayfaları",
    previous: "Önceki",
    next: "Sonraki",
    pageOf: "Sayfa {page} / {pages} · {count} metin",
    import: {
      one: "{count} çeviriyi taslak olarak içe aktar…",
      other: "{count} çeviriyi taslak olarak içe aktar…",
    },
    another: "Başka bir paket içe aktar",
    download: "Raporu indir (JSON)",
    doneNote:
      "Taslakları yayınlamadan önce İçerik ve Ürünler'de gözden geçirin. Aynı paketi yeniden içe aktarmak hiçbir şeyi iki kez yazmaz.",
    cannotImport:
      "Eksik izinleri isteyin ya da bu izinlere sahip birinin içe aktarmasını sağlayın.",
    nothingToImport: "İçe aktarılacak bir şey yok: yeni veya değişmiş geçerli çeviri yok.",
    draftOnly: "Yalnız geçerli çeviriler taslağa yazılır. Bir sonraki adımda onaylarsınız.",
  },
  written: {
    cmsPagesCreated: "Oluşturulan CMS sayfaları",
    cmsPagesUpdated: "Güncellenen CMS sayfaları",
    listings: "Ürün sayfaları",
    categories: "Kategoriler",
    specs: "Özellikler",
    images: "Görseller",
  },
  table: {
    status: "Sonuç",
    text: "Metin",
    source: "Kaynak metin",
    translation: "Çeviri",
    reason: "Neden",
    current: "Mevcut: {text}",
  },
  pages: {
    summary: { one: "{count} CMS sayfası", other: "{count} CMS sayfası" },
    create: "Yeni taslak sayfa",
    update: "Taslak güncellendi",
    unchanged: "Değişmedi",
    skipped: "Atlandı",
    fragment: "(adressiz parça)",
  },
  confirm: {
    title: "Çeviriler taslak olarak içe aktarılsın mı?",
    text: {
      one: "{count} geçerli çeviri {locale} taslaklarına yazılacak; {skipped} metin atlanacak.",
      other: "{count} geçerli çeviri {locale} taslaklarına yazılacak; {skipped} metin atlanacak.",
    },
    drafts:
      "Yalnız taslaklar değişir: eksik CMS sayfaları taslak sayfa olarak oluşturulur, katalog metinleri bir sonraki yayının okuduğu dil kayıtlarına yazılır.",
    noPublish:
      "Hiçbir şey yayınlanmaz ve {locale} ziyaretçilere açılmaz. Yayınlama ayrı bir adım olarak kalır.",
    skipped:
      "Güncel olmayan, çakışan, hatalı ve bulunamayan metinler dışarıda kalır; rapor bunları listeler.",
    recheck:
      "Kontrolden bu yana bir şey değiştiyse içe aktarmanın tamamı reddedilir ve hiçbir şey yazılmaz.",
    ack: {
      one: "Bu {count} çevirinin taslaklara yazılmasını istiyorum.",
      other: "Bu {count} çevirinin taslaklara yazılmasını istiyorum.",
    },
    cancel: "Vazgeç",
    run: {
      one: "{count} çeviriyi içe aktar",
      other: "{count} çeviriyi içe aktar",
    },
    running: "İçe aktarılıyor…",
  },
  status: {
    create: "Yeni",
    update: "Güncellenecek",
    unchanged: "Değişmemiş",
    empty: "Boş",
    outdated: "Güncel değil",
    conflict: "Çakışma",
    invalid: "Hatalı",
    not_found: "Bulunamadı",
  },
  filters: {
    all: "Tümü",
    create: "Yeni",
    update: "Güncellenecek",
    unchanged: "Değişmemiş",
    outdated: "Güncel değil",
    conflict: "Çakışan",
    invalid: "Hatalı",
    not_found: "Bulunamadı",
    empty: "Boş",
    skipped: "Atlanan",
  },
  rules: {
    source_changed: "Kaynak metin dışa aktarmadan sonra değişti. Yeni bir paket dışa aktarın.",
    source_removed: "Kaynak metin artık yok.",
    source_unpublished: "Kaynak sayfa artık yayında değil; yalnız yayındaki sayfalar çevrilir.",
    target_changed: "Çeviri dışa aktarmadan sonra konsolda değiştirildi; üzerine yazılmaz.",
    structure: "Çeviri sayfasının bölümleri artık kaynak sayfayla eşleşmiyor.",
    archived: "Ürün arşivlenmiş.",
    too_long: "Çeviri alanın izin verdiğinden uzun.",
    control_characters: "Çeviri kontrol karakterleri içeriyor.",
    format: "Adres geçerli değil.",
    schema: "Çevrilmiş içerik bu bölüm için geçerli değil.",
    title_required: "Yeni bir sayfa için çevrilmiş başlık gerekir.",
    name_required: "Ad zorunludur.",
    nothing_to_write: "Bu sayfa için yazılacak bir şey yok.",
    page_missing: "Kaynak sayfa artık yok.",
    registry_taken: "Bu sayfa hedef dilde zaten var.",
    duplicate_slug: "Aynı adres pakette iki kez kullanılmış.",
    slug_taken: "Adres hedef dilde zaten kullanılıyor.",
    path_taken: "Sayfanın adresi hedef dilde zaten kullanılıyor.",
    old_address: "Adres, taşınmış bir sayfanın yönlendirmesi olarak korunuyor.",
  },
  api: {
    unreachable: "Yönetim servisine ulaşılamadı veya zamanında yanıt vermedi. Tekrar deneyin.",
    locked:
      "Bu içerik şu anda başka bir işlem tarafından kilitli. Hiçbir şey yazılmadı; biraz sonra tekrar deneyin.",
    databaseBusy:
      "Veritabanı zamanında yanıt vermedi. Hiçbir şey yazılmadı; biraz sonra tekrar deneyin.",
    importUnknown:
      "İçe aktarma beklenmeyen bir hatayla durdu. Sonucu belirsiz: yeniden içe aktarmadan önce kontrolü tekrar çalıştırın (tekrarlanan içe aktarma hiçbir şeyi iki kez yazmaz).",
    importNoAnswer:
      "İçe aktarma zamanında yanıt vermedi. Yine de tamamlanmış olabilir: yeniden içe aktarmadan önce kontrolü tekrar çalıştırın (tekrarlanan içe aktarma hiçbir şeyi iki kez yazmaz).",
    forbidden: "Bu sitenin bu bölümlerini okuma yetkiniz yok.",
    importForbidden:
      "Bu paketin gerektirdiği izinlerin hepsine sahip değilsiniz. Hiçbir şey yazılmadı.",
    siteNotFound: "Bu paketin sitesi bulunamadı.",
    tooLarge: "Paket 4 MB'tan büyük. CMS ve katalogu ayrı paketler olarak dışa aktarın.",
    hashMismatch:
      "Dosyadaki kaynak veya mevcut metinler değiştirilmiş. Çevirmenler yalnız hedef metinleri değiştirebilir; yeni bir paket dışa aktarın.",
    siteMismatch: "Paket başka bir siteyi gösteriyor.",
    isSource: "Hedef dil, sitenin varsayılan dili.",
    notEnabled: "Hedef dil bu sitede etkin değil.",
    sourceChanged:
      "Sitenin varsayılan dili dışa aktarmadan sonra değişti. Yeni bir paket dışa aktarın.",
    conflict: "Bu işlem mevcut durumda yapılamaz.",
    importStale:
      "İçe aktarma sırasında metinler değişti; içe aktarmanın tamamı reddedildi ve hiçbir şey yazılmadı. Kontrolü tekrar çalıştırın.",
    invalid: "Paket geçerli değil.",
    invalidAt: "Paket geçerli değil ({paths}).",
    failed: "İstek başarısız oldu. Tekrar deneyin.",
  },
};
