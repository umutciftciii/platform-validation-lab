import type { Messages } from "../../../types";

export const editor: Messages["content"]["editor"] = {
  /** components/cms/page-editor.tsx PageEditor: sayfa bilgileri, bölümler, taslak paneli. */
  page: {
    saved: "Taslak kaydedildi.",
    title: "Sayfa",
    description: "{site} üzerinde, içerik dili: {locale}.",
    articleTitle: "Makale başlığı",
    pageTitle: "Sayfa başlığı",
    address: "Adres",
    addressFixedHint: "Sabit: sayfa, sitenin tasarımının bir parçasıdır.",
    addressSiteWide: "Her sayfada gösterilir (site geneli bölüm)",
    addressSlugHint: "Değiştirilirse sayfanın URL'si değişir.",
    articleFields: {
      title: "Özet ve kapak",
      description: "Haber listesinde ve makalenin en üstünde gösterilir.",
    },
    menu: {
      title: "Menü",
      invalid:
        "Bu menünün taslağı menü alanlarıyla uyuşmuyor. Düzenlemek için geçmişten bir revizyonu geri yükleyin.",
    },
    sections: {
      title: "Bölümler",
      articleTitle: "Makale gövdesi",
      descriptionPage: "{count} bölüm (en fazla {max}). Sayfada bu sırayla gösterilir.",
      descriptionArticle: "{count} bölüm (en fazla {max}). Makalede bu sırayla gösterilir.",
      emptyPage:
        "Henüz bölüm yok. İlk bölümü aşağıdan ekleyin; bir sayfa genellikle bir açılış bölümüyle başlar.",
      emptyArticle:
        "Henüz gövde yok. Aşağıdan bir Metin bölümü ekleyin; bir makalenin yayınlanabilmesi için en az bir bölüm gerekir.",
    },
    draft: {
      title: "Taslak",
      version: "Sürüm {version}",
      unsaved: "· kaydedilmemiş değişiklikler",
      note: "Kaydetmek taslağı CMS'te saklar; site yalnızca yayınlananı gösterir.",
      save: "Taslağı kaydet",
      readOnly: "Bu sitede sizin için salt okunur.",
    },
  },
  /** components/cms/page-editor.tsx SectionCard ve AddSection. */
  section: {
    moveUp: "{n}. bölümü yukarı taşı",
    moveDown: "{n}. bölümü aşağı taşı",
    remove: "{n}. bölümü kaldır",
    unknown: "Bilinmeyen bölüm tipi. Sayfayı kaydetmek için bu bölümü kaldırın.",
    add: "Bölüm ekle",
  },
  /** components/cms/page-editor.tsx DesignFields: tasarım sayfasının üst düzey alanları. */
  designContent: "İçerik",
  /** components/cms/page-editor.tsx PageSeoPanel (sayfa editörünün SEO paneli). */
  seo: {
    title: "SEO",
    description:
      "Arama sonuçları ve bağlantı önizlemeleri. Taslakla birlikte kaydedilir; site bunları yayından sonra gösterir.",
    titleFallback: "“{title}”",
    fallbackSummary: "sayfanın özeti",
    fallbackSiteDescription: "sitenin varsayılan açıklaması",
    ogImageLabel: "Open Graph görseli",
    ogImageHint: "Boşsa: önce sayfanın kendi görseli, sonra sitenin varsayılan görseli.",
  },
  /** components/cms/page-editor.tsx SiteSeoPreview (bv.site-seo bölümü). */
  siteSeoPreview: {
    title: "Önizleme",
    description:
      "Kendi SEO değerleri olmayan bir sayfa, bu varsayılanlarla (ana sayfanın göstereceği gibi).",
    siteName: "Site adı",
    defaultTitle: "Varsayılan başlık",
  },
  /** components/cms/field-form.tsx Fields: kontrat alanlarından üretilen form. */
  fields: {
    optional: "{label} (isteğe bağlı)",
    hrefHint: "İsteğe bağlı. /page, #section, https://…, mailto: veya tel:",
    assetChosen: "{width} × {height} px · kayıtlı site dosyası",
    assetChoose: "Kayıtlı bir site dosyası seçin (yükleme, medya kitaplığıyla gelecek).",
    noImage: "Görsel yok",
    choose: "Seçin…",
    linkLabel: "Etiket",
    link: "Bağlantı",
    linkHint: "/page, #section, https://…, mailto: veya tel:",
    listCountExact: "({n}, tam olarak {min})",
    listCountRange: "({n}, {min}–{max})",
    item: "{item} {n}",
    moveUp: "{item} {n} öğesini yukarı taşı",
    moveDown: "{item} {n} öğesini aşağı taşı",
    remove: "{item} {n} öğesini kaldır",
    add: "{item} ekle",
  },
  /** components/cms/publication-panel.tsx PublicationPanel ve ConfirmBox. */
  publication: {
    title: "Yayın",
    revision: "revizyon {n}",
    published: "{date} tarihinde {name} tarafından, taslak sürüm {version} üzerinden yayınlandı.",
    unpublished:
      "{date} tarihinde {name} tarafından yayından kaldırıldı. Mevcut taslağı göstermek için yeniden yayınlayın.",
    unpublishedByFallback: "personel",
    notOnSite: "Henüz sitede değil. Site bu sayfa için hiçbir şey göstermiyor.",
    saveFirst: "Önce taslağı kaydedin: önizleme ve yayın kaydedilmiş sürümü kullanır.",
    preview: "Taslağı önizle",
    previewUnavailable: "Önizleme BV sitesinin sayfalarını gösterir; bu sitenin henüz sayfası yok.",
    previewOpened: {
      before: "Yeni sekmede açıldı. ",
      link: "Önizlemeyi yeniden açın",
      after: " (15 dakika geçerlidir).",
    },
    confirmPublish: "Taslak sürüm {version} canlı sitede yayınlansın mı?",
    publishNow: "Şimdi yayınla",
    publishChanges: "Değişiklikleri yayınla",
    publish: "Yayınla",
    needsPublisher: "Yayın için bu sitenin yayıncısı olmanız gerekir (content:publish).",
    confirmUnpublish:
      "Bu sayfa siteden kaldırılsın mı? Yeniden yayınlanana kadar ziyaretçiler sayfayı kullanılamaz olarak görür.",
    unpublish: "Yayından kaldır",
    notice: {
      published: "Revizyon {n} olarak yayınlandı.",
      unpublished: "Yayından kaldırıldı. Sayfa artık sitede gösterilmiyor.",
    },
    cancel: "İptal",
  },
  /** components/cms/history-panel.tsx HistoryPanel. */
  history: {
    title: "Yayın geçmişi",
    description: "Her yayın bir revizyon olarak saklanır.",
    loadFailed: "Geçmiş yüklenemedi. Biraz sonra tekrar deneyin.",
    empty: "Henüz yayınlanmadı. Her yayın buraya bir revizyon ekler.",
    list: "Revizyonlar, en yenisi önce",
    revision: "Revizyon {n}",
    live: "Yayında",
    meta: "{date}, {name} · taslak sürüm {version}",
    confirm:
      "Mevcut taslak revizyon {n} ile değiştirilsin mi? Siz yayınlayana kadar site değişmez.",
    restore: "Taslağa geri yükle",
    saveFirst: "Bir revizyonu geri yüklemeden önce taslağı kaydedin.",
    restored: "Revizyon {n} taslağa geri yüklendi. Göstermek için yayınlayın.",
  },
  /** components/cms/translation-tabs.tsx TranslationTabs, TranslationSummary, MenuLinkWarnings. */
  translationTabs: {
    label: "Bu sayfanın dilleri",
    nav: "Sayfa dili",
    source: "Kaynak",
    structure:
      "Yapı kaynak sayfadan farklı ({list}). Buna izin verilir; yayınlamadan önce önizlemeyi kontrol edin.",
    /** API'nin yapı uyarısı kodları (CMS_STRUCTURE_WARNINGS). */
    structureWarning: {
      sections: "bölümler",
      lists: "listeler",
      images: "görseller",
      links: "bağlantılar",
    },
    notPublic:
      "Henüz sitede herkese açık değil: {languages}. Bu dillerde yayınlanan içerik yalnızca personele (önizleme) görünür, ziyaretçilere asla görünmez.",
    summary: {
      sourceFallback: "kaynak dildeki",
      notPublished: "{source} sayfa henüz yayınlanmadı.",
      outdated:
        "{source} sayfa revizyon {latest} durumunda; bu çeviri {from} temel alınarak yapıldı. Metinleri güncelleyin, ardından çeviriyi güncel olarak işaretleyin.",
      fromEarlierDraft: "daha önceki bir taslak",
      fromRevision: "revizyon {n}",
      upToDate: "Güncel: {source} sayfa, revizyon {latest}.",
    },
    menuWarnings: {
      label: "Yayınlamadan önce kontrol edilecek bağlantılar",
      heading: {
        one: "1 bağlantı {language} dilinde bağlantı olarak gösterilmeyecek",
        other: "{count} bağlantı {language} dilinde bağlantı olarak gösterilmeyecek",
      },
      item: " — {text}",
      /** CMS_MENU_LINK_WARNINGS kuralları. */
      rule: {
        not_live: "içeriği yayında değil: “henüz hazır değil” notuyla metin olarak gösterilir",
        no_translation: "sayfanın bu dilde yayınlanmış sürümü yok: menüye alınmaz",
        not_in_language: "bu adres veya katalog öğesi bu dilde henüz yok: dışarıda bırakılır",
        unknown_target: "bağlantı verilen sayfa, ürün veya kategori artık yok",
      },
      footer:
        "Yayınlamak yine de mümkün. Önizlemeyi kontrol edin; bağlantının gerektiği yerlerde eksik sayfaları önce çevirin veya yayınlayın.",
    },
  },
  /** components/cms/translation-actions.tsx TranslationActions. */
  translationActions: {
    markUpToDate: "Revizyon {n} ile güncel olarak işaretle",
    create: "{language} çeviri oluştur",
    copyNote:
      "Yeni sayfa, bu sayfanın bölümlerini, görsellerini ve bağlantılarını boş metinlerle kopyalar. Taslak olarak oluşturulur; hiçbir şey yayınlanmaz.",
    proposal:
      "Metinleri hazırlanmış çeviri önerisiyle doldurun (elle yazılmıştır, makine çevirisi değildir; önerisi olmayan metinler boş kalır). Taslağın yayınlanmadan önce yine de dil incelemesinden geçmesi gerekir. Şirket adı, adres, telefon ve e-posta olduğu gibi kalır.",
    title: "Çevrilmiş başlık",
    slug: "Bu dildeki adres",
    slugHint: "Küçük harf ve kısa çizgi. Kaynakla aynı adrese izin verilir.",
    submit: "Taslak çeviri oluştur",
    cancel: "İptal",
  },
};
