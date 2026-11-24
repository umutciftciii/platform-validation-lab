/**
 * ML-12d (DP-243): SEO alanının Türkçe metinleri (Yönetim > SEO genel bakış ve SEO > Yönlendirmeler).
 * Anahtarlar İngilizce sözlükle birebir aynıdır (eksik/fazla anahtar derleme hatası). Terimler
 * docs/i18n/admin-glossary.md: redirect = yönlendirme, source/target address = kaynak/hedef adres,
 * active/inactive = etkin/devre dışı, canonical = kanonik, preview = önizleme, dry-run = deneme
 * kontrolü. SEO, URL, CSV, slug, noindex, sitemap, Open Graph ve HTTP kodları (301/302) aynen kalır.
 */
import type { Messages } from "../../types";

export const seo: Messages["seo"] = {
  tabs: {
    label: "SEO",
    overview: "Genel bakış",
    redirects: "Yönlendirmeler",
  },
  common: {
    noAccessTitle: "BV sitesine erişim yok",
    noAccessText:
      "Rolleriniz Dream Petroleum BV'nin içeriklerini veya ürünlerini okuma yetkisi içermiyor.",
    forbidden: "Bu sitenin içeriklerini veya ürünlerini okuma yetkiniz yok.",
    tryAgain: "Birazdan yeniden deneyin.",
  },
  overview: {
    metaTitle: "SEO",
    title: "SEO",
    description:
      "dreampetroleumbv.com'un arama sonuçları ve bağlantı önizlemeleri: site varsayılanları ile her sayfa, makale ve ürünün SEO'su. Değişiklikler sayfa veya ürün yayınlandığında siteye yansır.",
    loadError: "SEO genel bakışı yüklenemedi",
    indexingNote:
      "Arama motorları siteyi yalnızca dizine ekleme açıkken production ortamında dizine ekleyebilir. DEV ve staging, buradaki ayardan bağımsız olarak her zaman noindex yanıtı verir. Yayınlanmamış veya gizli ürünler hiçbir zaman dizine eklenmez.",
    defaults: {
      title: "Site varsayılanları",
      description:
        "Sayfanın kendi değeri olmadığında kullanılır: site adı, varsayılan başlık, meta açıklama ve bağlantı önizleme görseli.",
      draftNotPublished: "Taslak, yayınlanmadı",
      changesNotPublished: "Değişiklikler yayınlanmadı",
      published: "Yayında",
      builtIn: "Yerleşik varsayılanlar",
      siteName: "Site adı",
      defaultTitle: "Varsayılan başlık",
      defaultDescription: "Varsayılan açıklama",
      defaultImage: "Varsayılan görsel",
      none: "Yok",
      edit: "Varsayılanları düzenle",
      view: "Varsayılanları görüntüle",
      pageNote: "Taslak, önizleme, yayınlama ve geçmiş her sayfadaki gibi çalışır.",
      builtInText:
        "Site yerleşik varsayılanlarını kullanıyor. Düzenlemek için varsayılanları CMS'de oluşturun; site, varsayılanlar yayınlanana kadar yerleşik değerleri kullanmaya devam eder.",
      importTitle: "SEO varsayılanları",
    },
    list: {
      title: "Sayfalar, makaleler ve ürünler",
      description:
        "{count} adres · {sitemap} adres site haritasında. Her satır kendi düzenleyicisini açar.",
      filterLabel: "Filtre",
      empty: "Bu filtre için gösterilecek kayıt yok.",
      noTitle: "SEO başlığı yok (sayfa adı kullanılır)",
      noindex: "Noindex",
      notLive: "Yayında değil",
      changesNotPublished: "Değişiklikler yayınlanmadı",
      live: "Yayında",
      inSitemap: "Site haritasında",
    },
    filters: {
      all: "Tümü",
      attention: "İlgilenilmesi gerekenler",
      noindex: "Noindex",
      pending: "Yayınlanmamış",
      products: "Ürünler",
      pages: "Sayfalar ve makaleler",
    },
    kind: {
      home: "Ana sayfa",
      page: "Sayfa",
      article: "Makale",
      product: "Ürün",
      products: "Ürün listesi",
      news: "Haber listesi",
    },
    notes: {
      noDescription: "Meta açıklama yok (yedek metin kullanılıyor)",
      descriptionLong: "Açıklama kesilebilir",
      titleLong: "Başlık kesilebilir",
      canonicalInvalid: "Kanonik yol geçerli değil",
      canonical: "Kanonik → {path}",
    },
  },
  redirects: {
    metaTitle: "Yönlendirmeler · SEO",
    title: "Yönlendirmeler",
    description:
      "dreampetroleumbv.com'un eski adresleri ve yönlendirdikleri yerler. Değişiklikler sitede hemen geçerli olur.",
    loadError: "Yönlendirmeler yüklenemedi",
    rulesNote:
      "Yayındaki içerik her zaman önceliklidir: bir yönlendirme hiçbir zaman yayındaki bir sayfa veya üründen başlamaz ve eski adresinde içerik yayınlandığında devre dışı kalır. Yönlendirmeler zincir oluşturmaz, siteden dışarı çıkmaz ve site haritasında yer almaz. Slug değişikliği yönlendirmeleri taşınan içeriğin bulunabilmesini sağlar ve burada silinemez.",
    find: {
      label: "Yönlendirme bul",
      search: "Ara",
      searchPlaceholder: "Adres veya not",
      sortBy: "Sırala",
      order: "Sıra",
      descending: "Azalan",
      ascending: "Artan",
      apply: "Uygula",
      byOrigin: "Kaynağa göre filtrele",
      byStatus: "Durum koduna ve duruma göre filtrele",
      all: "Tümü ({n})",
      withCount: "{label} ({n})",
      anyStatus: "Tüm durum kodları",
      activeAndInactive: "Etkin ve devre dışı",
      active: "Etkin",
      inactive: "Devre dışı ({n})",
    },
    sort: {
      updated: "Son değişiklik",
      created: "Oluşturulma",
      source: "Kaynak adres",
      target: "Hedef adres",
    },
    origin: {
      MANUAL: "Elle",
      SLUG_CHANGE: "Slug değişikliği",
      IMPORT: "İçe aktarma",
    },
    list: {
      label: "Yönlendirmeler",
      count: { one: "{count} yönlendirme", other: "{count} yönlendirme" },
      page: " · sayfa {page}/{pages}",
      pages: "Sayfalar",
      previous: "Önceki",
      next: "Sonraki",
      empty: "Eşleşen yönlendirme yok.",
    },
    manager: {
      newRedirect: "Yeni yönlendirme",
      importCsv: "CSV içe aktar",
      sampleCsv: "Örnek CSV",
      readOnly:
        "Yönlendirmeleri görüntüleyebilirsiniz. Oluşturmak, değiştirmek, silmek ve içe aktarmak için bu sitede içerik yayınlama yetkisi gerekir.",
      dismiss: "Kapat",
      created: "Yönlendirme oluşturuldu. Şu anda sitede geçerli.",
      saved: "Yönlendirme kaydedildi.",
      deleted: "Yönlendirme silindi. Eski adres yeniden 404 yanıtı veriyor.",
      imported: {
        one: "{count} yönlendirme içe aktarıldı. Şu anda sitede geçerli.",
        other: "{count} yönlendirme içe aktarıldı. Şu anda sitede geçerli.",
      },
    },
    row: {
      movedProduct: "Taşınan ürün:",
      movedPage: "Taşınan sayfa:",
      notAvailable: "erişiminiz yok",
      liveAt: "· yayındaki adres: {path}",
      notLiveNow: "· şu anda yayında değil",
      changedBy: "{date} tarihinde {person} değiştirdi · oluşturulma: {created}",
      changed: "{date} tarihinde değiştirildi · oluşturulma: {created}",
      permanent: "301 kalıcı",
      temporary: "302 geçici",
      active: "Etkin",
      inactive: "Devre dışı",
      protectedTitle: "İçerik taşındığında oluşturuldu. Yalnızca notu değiştirilebilir.",
      protected: "Korumalı",
      editNote: "Notu düzenle",
      edit: "Düzenle",
      hideHistory: "Geçmişi gizle",
      history: "Geçmiş",
      delete: "Sil",
      confirmDelete:
        "{source} adresinden yapılan yönlendirme silinsin mi? Eski adres yeniden 404 yanıtı verir (değişiklik geçmişi korunur).",
      confirmAction: "Yönlendirmeyi sil",
      loadingHistory: "Geçmiş yükleniyor…",
      noHistory: "Kayıtlı değişiklik yok.",
      historyLabel: "Değişiklikler, en yeni önce",
      eventBy: "{action}, {person} — {summary}",
      event: "{action} — {summary}",
    },
    form: {
      edit: "Yönlendirmeyi düzenle",
      create: "Yeni yönlendirme",
      close: "Kapat",
      locked:
        "İçerik taşındığında oluşturuldu: eski adresi arama motorları için korur ve içeriği izler. Burada yalnızca not değiştirilebilir.",
      source: "Eski adres (kaynak)",
      sourceHint:
        "/page, /news/article, /products/product veya /en/about-us gibi eski site adresi; isteğe bağlı ?sorgu ile",
      target: "Yeni adres (hedef)",
      targetHint: "Bu sitenin bir yolu; hiçbir zaman başka bir alan adı değil",
      status: "Durum kodu",
      active: "Etkin",
      note: "Not (isteğe bağlı)",
      saving: "Kaydediliyor…",
      save: "Yönlendirmeyi kaydet",
      createAction: "Yönlendirme oluştur",
      cancel: "İptal",
      atOnce: "Sitede hemen geçerli olur; yayınlama adımı yoktur.",
    },
    import: {
      label: "CSV'den yönlendirme içe aktar",
      intro:
        "Sütunlar: source, target, status (301/302), active (true/false), note. Önce dosyayı kontrol edin; siz onaylayana kadar hiçbir şey değişmez. Hatalı bir dosya hiçbir zaman içe aktarılmaz ve aynı dosyayı yeniden içe aktarmak yinelenen kayıt oluşturmaz.",
      file: "CSV dosyası (en fazla {rows} satır, {kb} KB)",
      lines: {
        one: "{file} · {count} satır · ilk satırlar",
        other: "{file} · {count} satır · ilk satırlar",
      },
      check: "Dosyayı kontrol et (deneme)",
      result: "Deneme sonucu",
      new: "{n} yeni",
      updated: "{n} güncellenecek",
      unchanged: "{n} değişmeyecek",
      withErrors: "{n} hatalı",
      onlyIssues: "Yalnızca hata veya uyarı içeren satırlar ({n}/{total})",
      line: "Satır {line}",
      run: { one: "{count} yönlendirmeyi içe aktar", other: "{count} yönlendirmeyi içe aktar" },
      download: "Raporu indir",
      fixErrors: "Hatalı satırları düzeltin ve dosyayı yeniden kontrol edin.",
      nothing: "İçe aktarılacak kayıt yok: her satır zaten yerinde.",
      exact:
        "İçe aktarma tam olarak bu sonucu yazar; yönlendirmeler bu arada değiştiyse yeniden kontrol edin.",
    },
    action: {
      create: "Yeni",
      update: "Güncelleme",
      unchanged: "Değişmedi",
      error: "Hata",
    },
    warnings: {
      targetNotLive:
        "Yeni adreste şu anda yayında içerik yok: içerik yayınlanana kadar ziyaretçiler 404 sayfasına ulaşır.",
      sourceDraftContent:
        "Taslak bir sayfa veya ürün eski adresi kullanıyor. O adreste yayınlandığında bu yönlendirme devre dışı kalır.",
    },
    history: {
      created: "Oluşturuldu",
      updated: "Değiştirildi",
      deleted: "Silindi",
      retargeted: "Hedef içeriği izledi",
      retired: "Devre dışı bırakıldı (içerik yeniden yayında)",
      viaImport: "{action} (içe aktarma)",
      active: "etkin",
      inactive: "devre dışı",
      changed: "değişen: {fields}",
      was: "(önceki: {target})",
    },
    rules: {
      sourceRequired: "Eski adresi girin.",
      sourceFormat:
        "Bu sitenin (/old-page, /news/old-article, /products/old-product) veya eski sitenin (/en/about-us, /tr/products/x, /en/contact-us.html) bir adresini kullanın: harf, rakam, kısa çizgi, nokta veya alt çizgi, en fazla 6 bölüm; ?id=5 gibi bir sorguya izin verilir.",
      sourceReserved:
        "Bu adres sitenin kendisine ait (ana sayfa, ürünler, haberler, gizlilik, eski sitenin /en ve /tr kodları dışındaki bir dil kodu, bir uygulama adresi veya bir site dosyası).",
      sourceFragment: "# bölümünü çıkarın: tarayıcılar onu siteye hiçbir zaman göndermez.",
      queryFormat: "Sorgu kaydedilemiyor. Düz ad=değer çiftleri kullanın.",
      sourceTooLong: "Eski adres çok uzun.",
      sourceLiveContent:
        "Bu adreste yayında bir sayfa, makale veya ürün var. Önce yayından kaldırın veya taşıyın: yayındaki içerik her zaman önceliklidir.",
      sourceDuplicate: "Bu adres (ve sorgu) için zaten bir yönlendirme var. Onu düzenleyin.",
      sourceDuplicateInFile: "Bu adres dosyada birden fazla kez geçiyor.",
      sourceChain:
        "Başka bir yönlendirme bu adrese yönlendiriyor. Onu doğrudan son hedefe yönlendirin (yönlendirme zinciri olmaz).",
      targetRequired: "Yeni adresi girin.",
      targetFormat:
        "/about-us veya /products?category=base-oil gibi bu sitenin bir yolunu kullanın (küçük harfli sözcükler ve kısa çizgiler, en fazla üç düzey).",
      targetExternal: "Yönlendirmeler bu sitede kalır. URL değil, /about-us gibi bir yol girin.",
      targetReserved: "Bu adres sitenin iç adresidir ve hedef olamaz.",
      targetFragment: "# bölümünü çıkarın.",
      targetTooLong: "Yeni adres çok uzun.",
      targetSelf: "Eski ve yeni adres aynı: bu bir döngü oluşturur.",
      targetChain:
        "Yeni adres kendisi de yönlendiriliyor. Bunun yerine son adresini girin (yönlendirme zinciri veya döngüsü olmaz).",
      statusFormat: "Durum kodu 301 veya 302 olmalıdır.",
      activeFormat: "Etkin değeri true veya false olmalıdır.",
      noteFormat: "Not çok uzun veya kontrol karakterleri içeriyor.",
      protected:
        "Bu yönlendirme içerik taşındığında (slug değişikliği) oluşturuldu. Eski adresi arama motorları için korur; yalnızca notu değiştirilebilir.",
      versionStale:
        "Bu yönlendirmeyi bu arada başka biri değiştirdi. Onun sürümünü görmek için sayfayı yeniden yükleyin.",
      importHasErrors: "Hatalı satırları düzeltin ve dosyayı yeniden kontrol edin.",
      importChanged:
        "Yönlendirmeler kontrolden sonra değişti. Dosyayı yeniden kontrol edin ve yeni sonucu onaylayın.",
      csvEmpty: "Dosyada yönlendirme yok.",
      csvHeader:
        "İlk satır sütunları adlandırmalıdır: source, target ve isteğe bağlı olarak status, active, note.",
      csvQuote: "Tırnak içindeki bir değer kapatılmamış.",
      csvTooLarge: "Dosya çok büyük (en fazla {kb} KB).",
      csvTooManyRows: "Dosya başına en fazla {rows} yönlendirme.",
      csvColumns: "Bir satırda başlıktan daha fazla değer var.",
      siteNoRedirects: "Bu site yönlendirme kullanmıyor.",
      unknown: "{field} alanını kontrol edin ({rule}).",
      unknownField: "değer",
      unknownRule: "geçersiz",
    },
    api: {
      notSaved: "Değişiklik kaydedilemedi. Birazdan yeniden deneyin.",
      unreachable: "Yönetim API'sine ulaşılamıyor.",
      forbidden: "Rolleriniz bu değişikliğe izin vermiyor.",
    },
  },
};
