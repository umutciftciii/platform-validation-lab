/** ML-12a: Turkish UI texts of the product detail page (see ../en/detail.ts). */
import type { Messages } from "../../../types";

export const detail: Messages["catalog"]["detail"] = {
  page: {
    metaTitle: "Ürün",
    title: "Ürün",
    back: "Tüm ürünler",
    tryAgain: "Birazdan tekrar deneyin.",
    noAccess: {
      title: "Ürün kataloğuna erişiminiz yok",
      text: "Rolleriniz hiçbir sitede ürünleri okumayı kapsamıyor.",
    },
    loadError: {
      title: "Bu ürün yüklenemedi",
      text: "Bu sitede ürünleri okuma yetkiniz yok.",
    },
    sku: "Ürün kodu",
    versionChanged: "Sürüm {version} · son değişiklik {date}",
    blocked: {
      one: "{count} sitede yayın engelli",
      other: "{count} sitede yayın engelli",
    },
    xrefSource: "{type} · {title} · revizyon {revision}",
    content: {
      chooseSite: "Ürün metnini düzenleyeceğiniz siteyi seçin.",
      language: "Ürün metninin dili",
      title: "{site} sitesindeki ürün metni",
      description: "{site} ürün sayfasında görünen metin. Sürüm {version} · son değişiklik {date}",
      notListed: "Bu site ürünü henüz listelemiyor.",
      noCategories: {
        title: "Bu sitede kategori yok",
        action: "Kategori oluştur",
        text: "Bir ürün, sitenin kategorilerinden birinde listelenir. Ürünleri burada listelemek için ilk kategoriyi oluşturun.",
      },
      savingNote: {
        before:
          "Kaydetmek canlı siteyi hiçbir zaman yayınlamaz, yayından kaldırmaz veya değiştirmez. Önizleme ve yayın için",
        link: "Yayın",
        after: "sekmesini kullanın.",
      },
      shared: {
        title: "Ortak ürün içeriği",
        description:
          "Ad, kod, URL slug'ı ile ortak özet ve açıklama; her site için aynıdır. Bu haliyle yayınlanmaz: site, yukarıdaki kendi metnini gösterir.",
        note: "Ortak özet ve açıklama bir sitede yalnızca o sitenin kendi alanı boşsa ve site yeniden yayınlandıktan sonra görünür. Bunları düzenlemek bir sitenin kendi metnini hiçbir zaman değiştirmez.",
      },
    },
    translation: {
      loadError: "{language} metinler yüklenemedi",
      title: "{site} sitesindeki {language} metinler",
      description:
        "Ziyaretçinin bu ürün hakkında {language} okuduğu her şey, İngilizce kaynak metninin yanında. Kodlar, değerler, birimler, standartlar ve markalar her dilde aynı kalır.",
      productText: "Ürün metni",
      category: "Kategori",
      categoryDescription:
        "Bu ürünün sitedeki kategorisinin adı; o kategorideki tüm ürünler için ortaktır.",
      specNames: "Teknik özellik adları",
      specNamesDescription:
        "Bu ürünün teknik değerlerinin adları (değerlerin kendisi her dilde aynıdır).",
      imageAlts: "Görsel alternatif metinleri",
      imageAltsDescription:
        "Ekran okuyucunun her görsel için söylediği metin; görsellerin kendisi ortaktır.",
      seoLoadError: "{language} SEO metinleri yüklenemedi",
      seoTitle: "{site} sitesinde {language} SEO",
    },
    specs: {
      title: "Teknik özellikler",
      description:
        "Bu ürün ana kaydının platform genelindeki değerleri; siteye göre hiçbir zaman kopyalanmaz. Doğrulama raporu değerleri siz yazarken kontrol eder.",
      filled: "{total} alanın {filled} tanesi dolu",
      loadError: "Teknik özellikler yüklenemedi",
    },
    xrefs: {
      title: "Ürün karşılıkları",
      description:
        "Bu ürün ana kaydıyla ilişkili diğer markaların ürünleri: benzer ya da bir kaynak belgeye göre doğrulanmış.",
      active: "{n} etkin",
      loadError: "Ürün karşılıkları yüklenemedi",
    },
    research: {
      title: "Araştırma notları",
      description:
        "Araştırmanın bu sitede bu ürün için bulduğu her şey: sorular, eksik belgeler, çelişkiler, iddia riskleri, doğrulama için bekletilen değerler ve kaynaklar. Hiçbir zaman yayınlanmaz.",
      items: "{n} öğe",
      none: "{site} sitesinde bu ürün için araştırma önerisi yok.",
      loadError: "Araştırma notları yüklenemedi",
    },
    images: {
      title: "Ürün görselleri",
      description:
        "Bir kapak ve bir galeri. Orijinaller gizli kalır; canlı siteler yalnızca yayınlanmış görsellerin meta verisiz WebP kopyalarını alır.",
      loadError: "Görseller yüklenemedi",
    },
    documents: {
      title: "Teknik belgeler",
      description:
        "Bu ürün ana kaydının TDS, SDS, COA ve diğer PDF'leri. Her yükleme yeni ve değiştirilemez bir revizyondur.",
      loadError: "Belgeler yüklenemedi",
    },
    seo: {
      chooseSite: "SEO'sunu düzenleyeceğiniz siteyi seçin.",
      language: "SEO metinlerinin dili",
      title: "{site} sitesinde SEO",
      descriptionBv:
        "Ürün sayfasının arama sonucu ve bağlantı önizlemesi. Site listesine kaydedilir; site bunu bir sonraki yayından sonra gösterir. Yayınlanmamış veya gösterilmeyen bir ürün hiçbir zaman dizine eklenmez.",
      descriptionOther: "Şimdilik ürün SEO'sunu yalnızca BV sitesi kullanıyor.",
      outdated: "Değişiklikler yayınlanmadı",
      listFirst: "Önce ürünü bu sitede listeleyin (İçerik sekmesi).",
      coverOption: "Kapak · {name}",
    },
    publication: {
      title: "Yayın",
      description:
        "Site başına önizleyin, yayınlayın ve yayından kaldırın. Canlı site, güncel taslağı değil her zaman yayınlanmış anlık görüntüyü gösterir; her engel nerede giderileceğini söyler.",
      loadError: "Yayın durumu yüklenemedi",
    },
    review: {
      title: "İkinci kişi incelemesi",
      description:
        "Doğrudan yayınlayabiliyorsanız isteğe bağlıdır. Onay yetkisi olmayan yayıncılar yalnızca onaylanmış bir ana kaydı yayınlar.",
    },
    history: {
      title: "İnceleme ve yayın geçmişi",
      description: "Her gönderim, karar ve yayın; en yenisi önce. Düzenlenemez.",
      loadError: "Geçmiş yüklenemedi",
    },
  },
  tabs: {
    leave:
      "Bu üründe kaydedilmemiş değişiklikler var. Sayfadan çıkıp değişiklikleri silmek istiyor musunuz?",
    sections: "Ürün bölümleri",
    unsaved: "Kaydedilmemiş değişiklikler",
    unsavedSr: ", kaydedilmemiş değişiklikler",
    unsavedIn:
      "Kaydedilmemiş değişiklikler: {tabs}. Sekme değiştirirken korunur; kalıcı olmaları için her formu kaydedin.",
  },
  master: {
    saved: "Ortak ürün içeriği kaydedildi.",
    name: {
      label: "Ürün adı",
      hint: "Tüm sitelerde ortaktır; bir site kendi başlığı boşsa bunu gösterir.",
    },
    code: {
      label: "Ürün kodu",
      hint: "Büyük harf, ör. ICC-SYN-6. Benzersiz.",
    },
    slug: {
      label: "Slug (URL)",
      hintEdit:
        "Küçük harf ve tire. Benzersiz. Yeni slug, ürün o sitede yeniden yayınlandığında siteye ulaşır; ardından BV sitesi eski adresi yönlendirir (301).",
      hintNew: "Küçük harf ve tire. Benzersiz.",
    },
    summary: {
      label: "Ortak özet",
      hint: "İsteğe bağlı. Yalnızca kendi özeti boş olan sitelerde kullanılır.",
    },
    description: {
      label: "Ortak açıklama",
      hint: "İsteğe bağlı. Yalnızca kendi açıklaması boş olan sitelerde kullanılır. Düz metin, İngilizce, en fazla {max} karakter.",
    },
    archived: "Bu ürün arşivlendi. Ana kaydı düzenlemek için geri yükleyin.",
    noPermission: "Ürün ana kayıtlarını platform ürün ekibi düzenler (product_master:edit).",
    saving: "Kaydediliyor…",
    save: "Ortak içeriği kaydet",
    create: "Ürün oluştur",
    archiveConfirm: "Bu ürün arşivlensin mi? Daha sonra geri yüklenebilir.",
    archive: "Arşivle",
    restore: "Geri yükle",
  },
  listing: {
    saved: "{site} metni kaydedildi.",
    listed: "{site} sitesinde listelendi.",
    legend: "{site} sitesindeki ürün metni",
    title: "Bu sitedeki başlık",
    summary: "Bu sitedeki özet",
    description: "Bu sitedeki açıklama",
    proposal: {
      heading: "{site} için araştırma önerisi",
      reviewed: "· şirket tarafından incelendi",
      notReviewed: "· şirket tarafından incelenmedi (isteğe bağlı)",
      copy: "Özet ve açıklamaya kopyala",
      differs: "Kaydedilmiş {site} metni araştırma önerisinden farklı.",
      copied:
        "Yukarıdaki özet ve açıklamaya kopyalandı. Düzenleyip kaydedin; henüz hiçbir şey kaydedilmedi.",
      onlyText:
        "Yalnızca müşteri metni kopyalanır. Doğrulama için bekletilen teknik değerler Şirket İncelemesi'nde kalır ve teknik özelliklere hiçbir zaman girmez.",
      claimNotes: {
        one: "{count} iddia notu: sertifika gerektiren ifadeler",
        other: "{count} iddia notu: sertifika gerektiren ifadeler",
      },
      show: "Öneri metnini göster",
      summary: "Özet: ",
      description: "Açıklama: ",
    },
    settings: "{site} site listesi ayarları",
    category: {
      label: "Bu sitedeki kategori",
      hintDefault: "Boş bırakılırsa sitenin varsayılanı “{name}” kullanılır.",
      noDefault: "Bu sitenin henüz varsayılan kategorisi yok.",
      siteDefault: "Site varsayılanı",
      defaultSuffix: " (varsayılan)",
    },
    sortOrder: "Sıralama",
    discard: "Değişiklikleri at",
    saving: "Kaydediliyor…",
    save: "{site} metnini kaydet",
    listOn: "{site} sitesinde listele",
    readOnly:
      "Salt okunur: bu sitenin site listelerini düzenlemek için sitede product:edit yetkisi gerekir.",
  },
  seo: {
    saved: "{site} SEO'su kaydedildi. Sitede göstermek için ürünü yayınlayın.",
    fallbackSummary: "ürün özeti",
    fallbackSiteDescription: "sitenin varsayılan açıklaması",
    ogImage: {
      label: "Open Graph görseli",
      hint: "Ürünün herkese açık görsellerinden biri. Boşsa: önce kapak, sonra sitenin varsayılan görseli.",
      cover: "Kapak görseli (varsayılan)",
    },
    save: "SEO'yu kaydet",
    discard: "Değişiklikleri at",
    unsaved: "Kaydedilmemiş değişiklikler",
    version: "Site listesi sürümü {version}",
    readOnly: "Bu sitede sizin için salt okunur.",
  },
  seoFields: {
    counter: "{length}/{max} · yaklaşık {recommended} karakter görünür.",
    title: {
      label: "SEO başlığı",
      hint: "{counter} Boşsa: {fallback}.",
    },
    description: {
      label: "Meta açıklama",
      hint: "{counter} Boşsa: {fallback}.",
    },
    canonical: {
      label: "Kanonik yol",
      hint: "İsteğe bağlı. Bu sitenin /about-us gibi bir yolu; boşsa: sayfanın kendi adresi.",
    },
    noindex: {
      label: "Arama motorlarından gizle (noindex)",
      hint: "Yayınlandığında noindex ekler ve sayfayı site haritasının dışında bırakır.",
    },
    og: {
      legend: "Bağlantı önizlemesi (Open Graph)",
      title: "Open Graph başlığı",
      titleHint: "{counter} Boşsa: SEO başlığı.",
      description: "Open Graph açıklaması",
      descriptionHint: "{counter} Boşsa: meta açıklama.",
    },
  },
  seoPreview: {
    searchAria: "Arama sonucu önizlemesi",
    search: "Arama sonucu",
    noDescription: "Açıklama yok: arama motoru sayfadan metin seçer.",
    noindex: "Arama motorlarından gizli (noindex): bu sonuç gösterilmez.",
    link: "Bağlantı önizlemesi",
    imagePlaceholder: "Sitede gösterilen görsel",
    canonicalAria: "Kanonik adres",
    canonical: "Kanonik URL",
    noPublicAddress: "{path} (burada herkese açık adres yapılandırılmadı)",
    canonicalInvalid: "Kanonik yol geçerli değil; sayfanın kendi adresi kullanılır.",
    canonicalOverride:
      "Arama motorlarını başka bir adrese yönlendirir: bu sayfa site haritasının dışında kalır.",
    canonicalOwn: "Sayfanın kendi adresi.",
    lengthNotes: "Uzunluk notları",
    fields: {
      title: "SEO başlığı",
      description: "Meta açıklama",
      ogTitle: "Open Graph başlığı",
      ogDescription: "Open Graph açıklaması",
    },
  },
};
