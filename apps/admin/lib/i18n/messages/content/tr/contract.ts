/** ML-12c: @dream/contracts CMS metinlerinin Türkçesi (bkz. ../en/contract.ts). */
import type { Messages } from "../../../types";

export const contract: Messages["content"]["contract"] = {
  /** Standart şablonun bölüm tipleri ve alanları (CMS_SECTION_TYPES). */
  section: {
    heroLabel: "Açılış bölümü",
    heroDescription: "Sayfanın açılışı: üst başlık, başlık, giriş metni ve isteğe bağlı bir düğme.",
    heroEyebrowLabel: "Üst başlık",
    heroTitleLabel: "Başlık",
    heroIntroLabel: "Giriş metni",
    heroCtaLabel: "Düğme",
    textLabel: "Metin",
    textDescription: "Bir başlık ve gövde metni. Boş bir satır yeni bir paragraf başlatır.",
    textBodyLabel: "Gövde",
    textBodyHint: "Düz metin. Boş bir satır yeni bir paragraf başlatır.",
    cardsLabel: "Kartlar",
    cardsDescription: "Bir başlık ve kart listesi (özellikler, hizmetler, bilgiler).",
    cardsItemsItemLabel: "Kart",
    cardsItemsTitleLabel: "Başlık",
    cardsItemsDescriptionLabel: "Açıklama",
    cardsItemsLinkLabel: "Bağlantı",
    ctaLabel: "Eylem çağrısı",
    ctaDescription: "Tek düğmeli bir kapanış mesajı.",
    splitLabel: "Görsel ve metin",
    splitDescription:
      "Kayıtlı bir site görselinin yanında başlık ve metin. İlk bölüm olarak kullanıldığında sayfa başlığı olur.",
    splitImageLabel: "Görsel",
    splitImageAltLabel: "Alternatif metin",
    splitImageNoteLabel: "Görsel notu",
    splitImageNoteHint:
      "Görselin altında gösterilir; ör. bir görselleştirmenin temsilî olduğunu belirtmek için.",
    specListLabel: "Özellik listesi",
    specListDescription:
      "Bir başlık ve bilgi föyündeki gibi, isteğe bağlı bir ayrıntıyla birlikte terim satırları.",
    specListItemsLabel: "Satırlar",
    specListItemsItemLabel: "Satır",
    specListItemsTermLabel: "Terim",
    specListItemsDetailLabel: "Ayrıntı",
    quoteLabel: "Alıntı",
    quoteDescription: "Büyük puntoyla gösterilen kısa bir ifade.",
    quoteSourceLabel: "Kaynak",
    contactLabel: "İletişim bilgileri ve form",
    contactDescription:
      "Yayındaki alt bilgiden alınan telefon, e-posta ve adres, iletişim formunun yanında gösterilir. Form bağlanana kadar (DP-151) gönderim yapmaz; not bunu belirtir.",
    contactIntroLabel: "Giriş",
    contactFormTitleLabel: "Form başlığı",
    contactFormNoteLabel: "Form notu",
    contactFormNoteHint: "Form mesaj gönderemediği sürece formun üstünde gösterilir.",
  },
  /** Haber makalesi alanları (CMS_ARTICLE_FIELDS). */
  article: {
    excerptLabel: "Özet",
    excerptHint: "Haber listesinde ve makale başlığının altında gösterilir.",
    coverImageLabel: "Kapak görseli",
    coverImageHint:
      "İsteğe bağlı. Kayıtlı bir site görseli; yükleme özelliği medya kütüphanesiyle gelecek.",
    coverAltLabel: "Kapak görseli alternatif metni",
    coverAltHint: "Kapak görseli seçildiğinde zorunludur: görselin neyi gösterdiğini yazın.",
  },
  /** BV tasarım sayfası ve site geneli bölümlerin alanları (CMS_DESIGN_TEMPLATES). */
  design: {
    bvHomeHeroLabel: "Açılış bölümü (ICCSYN)",
    bvHomeHeroHint:
      "Animasyon ve kaydırma uzunluğu kodda kalır. Her uygulama için bir kaynak belge gereklidir.",
    bvHomeHeroBrandLabel: "Yazı logosu",
    bvHomeHeroTaglineLabel: "Slogan",
    bvHomeHeroScrollCueLabel: "Kaydırma işareti",
    bvHomeHeroCtaLabelLabel: "Etiket",
    bvHomeHeroCtaHrefHint: "Boş bırakılırsa düğme, aşağıdaki notla birlikte devre dışı gösterilir.",
    bvHomeHeroCtaDisabledNoteLabel: "Devre dışıyken gösterilen not",
    bvHomeHeroSupplyLabel: "Tedarik satırı",
    bvHomeHeroLegalLabel: "Hukuki not",
    bvHomeHeroMediaAltLabel: "Laboratuvar filminin alternatif metni",
    bvHomeHeroApplicationsLabel: "Uygulama kartları",
    bvHomeHeroApplicationsHint: "Tam olarak altı adet: animasyondaki dağılımın altı yeri vardır.",
    bvHomeProductGroupsLabel: "Ürün grupları",
    bvHomeProductGroupsLabelLabel: "Bölüm etiketi",
    bvHomeProductGroupsDisclosureLabel: "Açıklama notu (zorunlu)",
    bvHomeProductGroupsGroupsLabel: "Gruplar",
    bvHomeProductGroupsGroupsItemLabel: "Grup",
    bvHomeProductGroupsGroupsAnchorLabel: "Çapa",
    bvHomeProductGroupsGroupsAnchorHint:
      "Küçük harfli kimlik, ör. group-1. Bu öğeye verilen bağlantılarda kullanılır.",
    bvHomeProductGroupsGroupsNameWordLabel: "Ad",
    bvHomeProductGroupsGroupsNameNumeralLabel: "Rakam (vurgu rengi)",
    bvHomeProductGroupsGroupsNoteLabel: "Niteleyici not",
    bvHomeProductGroupsGroupsSamplesLabel: "Örnek sınıflar",
    bvHomeProductGroupsGroupsAnimationLabel: "Animasyon",
    bvHomeProductGroupsGroupsPosterLabel: "Poster (ilk kare)",
    bvHomeServicesLabel: "Hizmetler",
    bvHomeServicesDisclosureLabel: "Görsel açıklama notu (zorunlu)",
    bvHomeServicesItemsItemLabel: "Hizmet",
    bvHomeServicesItemsDescriptionLabel: "Açıklama (masaüstü)",
    bvHomeServicesItemsShortDescriptionLabel: "Kısa açıklama (telefonlar)",
    bvHomeServicesItemsDesktopImageLabel: "Görsel, masaüstü (4:3)",
    bvHomeServicesItemsDesktopPositionLabel: "Odak, masaüstü",
    bvHomeServicesItemsDesktopPositionHint: "Odak noktası, ör. 50% 30%.",
    bvHomeServicesItemsMobileImageLabel: "Görsel, telefonlar (3:4)",
    bvHomeServicesItemsMobilePositionLabel: "Odak, telefonlar",
    bvHomeCtlLabel: "CTL teknolojisi",
    bvHomeCtlHint:
      "Burada performans değeri verilmez: bağlayıcı değerler her partinin TDS veya CoA belgesinde yer alır.",
    bvHomeCtlDocumentLabel: "Belge bağlantısı",
    bvHomeCtlStagesLabel: "Süreç aşamaları",
    bvHomeCtlStagesHint: "Tam olarak üç adet: kaydırma animasyonu üç görsel arasında geçiş yapar.",
    bvHomeCtlStagesItemLabel: "Aşama",
    bvHomeApplicationsLabel: "Uygulama kavramları",
    bvHomeApplicationsHint:
      "Yalnızca AI kavramlarıdır: uygunluk, güvenlik veya sertifikasyon iddiası yoktur. Durum ve açıklama notları görünür kalmalıdır.",
    bvHomeApplicationsStatusLabel: "Durum etiketi (zorunlu)",
    bvHomeApplicationsValidationLabel: "Doğrulama kutusu",
    bvHomeApplicationsValidationRequirementsLabel: "Gereksinimler",
    bvHomeApplicationsValidationRequirementsItemLabel: "Gereksinim",
    bvHomeApplicationsValidationNoteLabel: "Not",
    bvHomeApplicationsScenesLabel: "Kavramlar",
    bvHomeApplicationsScenesHint:
      "Tam olarak üç adet: kaydırma animasyonu üç sahne arasında geçiş yapar.",
    bvHomeApplicationsScenesItemLabel: "Kavram",
    bvHomeApplicationsScenesImageLabel: "Görsel, masaüstü",
    bvHomeApplicationsScenesImageSmallLabel: "Görsel, telefonlar",
    bvNewsIndexEmptyLabel: "Yayında makale olmadığında",
    bvSiteSeoSiteNameLabel: "Site adı",
    bvSiteSeoSiteNameHint:
      "Bağlantı önizlemelerinde site adı olarak ve tarayıcı başlıklarında sayfa adından sonra gösterilir.",
    bvSiteSeoDefaultTitleLabel: "Varsayılan SEO başlığı",
    bvSiteSeoDefaultTitleHint:
      "Kendi başlığı olmayan sayfalar için (ör. SEO başlığı olmayan ana sayfa).",
    bvSiteSeoDefaultDescriptionLabel: "Varsayılan meta açıklama",
    bvSiteSeoDefaultOgImageLabel: "Varsayılan Open Graph görseli",
    bvSiteSeoDefaultOgImageHint:
      "Kendi görseli olmayan sayfaların bağlantı önizlemelerinde gösterilir. En iyi sonuç için yaklaşık 1200×630 kullanın.",
    corporateHomeHeroHint:
      "Sayfanın başlığı. Owner teyidi olmadan distribütörlük iddiası veya rakam yazılmaz.",
    corporateHomeHeroSecondaryLabel: "İkinci buton",
    corporateHomeOverviewLabel: "Şirket tanıtımı",
    corporateHomeOverviewHighlightsLabel: "Öne çıkanlar",
    corporateHomeOverviewHighlightsItemLabel: "Öne çıkan",
    corporateHomeCardHrefHint:
      "Bu sitenin bir yolu, ör. /products#base-oils-group1. Boş: kart bağlantı olmaz.",
    corporateHomeStrengthsLabel: "Güçlü yönler",
    corporateHomeStrengthsHint:
      "Yalnız niteliksel ifadeler: teyitli kaynağı olmayan sayaç veya yüzde yazılmaz.",
    corporateHomeStrengthsItemLabel: "Güçlü yön",
    corporateHomeCtaPointsLabel: "Maddeler",
    corporateHomeCtaPointsItemLabel: "Madde",
    corporateProductsIntroLabel: "Sayfa başlığı",
    corporateProductsGroupsHint:
      "Her grup için bu sırayla bir bölüm. Çapa, bölümün adresidir (/products#çapa).",
    corporateProductsGroupsSubtitleLabel: "Alt başlık",
    corporateProductsGroupsItemsLabel: "Ürünler",
    corporateProductsGroupsItemsItemLabel: "Ürün",
    corporateProductsGroupsItemsTypeLabel: "Tür",
    corporateProductsGroupsApplicationsTitleLabel: "Uygulamalar başlığı",
    corporateProductsGroupsApplicationsLabel: "Uygulamalar",
    corporateProductsGroupsApplicationsItemLabel: "Uygulama",
    corporateProductsTypicalValuesLabel: "Tipik değerler",
    corporateProductsTypicalValuesHint:
      "Değerlerin kaynağı onaylanana kadar gizli (DP-002): o zamana kadar satırları boş bırakın. Tablo yalnız en az bir satır varken gösterilir.",
    corporateProductsTypicalValuesColumnALabel: "Birinci değer sütunu",
    corporateProductsTypicalValuesColumnBLabel: "İkinci değer sütunu",
    corporateProductsTypicalValuesRowsPropertyLabel: "Özellik",
    corporateProductsTypicalValuesRowsUnitLabel: "Birim",
    corporateProductsTypicalValuesRowsValueALabel: "Birinci değer",
    corporateProductsTypicalValuesRowsValueBLabel: "İkinci değer",
    corporateProductsCoaLabel: "Analiz Sertifikası (COA)",
    corporateProductsCoaHint: "COA talepleri iletişim sayfasına yönlendirilir.",
  },
  /** CMS'de (henüz) olmayan rotaların notları (CMS_SITE_REGISTRY). */
  registry: {
    bvHome:
      "Açılış bölümü, ürün grupları, hizmetler, CTL teknolojisi ve uygulamalar. Hareket kodda kalır.",
    bvProductsIndex: "Başlık, giriş metni ve SEO. Ürünlerin kendisi katalogda kalır.",
    bvNewsIndex:
      "Haber listesinin başlığı, girişi ve boş durumu (DP-153). Makaleler Haberler altındadır.",
    bvSiteNav:
      "Her sayfanın menü öğeleri, alt menüleri ve iletişim düğmesi (menü düzenleyici, DP-219).",
    bvSiteFooter:
      "Başlık, iletişim bilgileri, bağlantı sütunları, sosyal medya ve yasal bağlantılar (menü düzenleyici, DP-219).",
    bvSiteSeo:
      "Site adı, varsayılan başlık, açıklama ve Open Graph görseli (DP-209). SEO altında yönetilir.",
    bvAboutUs:
      "Yayındaki siteden (DP-135). Pazar görselleri kullanılmadı: pazarlarla ilgisi olmayan stok fotoğraflar.",
    bvEnergyTrading: "Yayındaki siteden (DP-135); kaynağı belirtilmemiş +%12 rakamı çıkarıldı.",
    bvLogistics: "Yayındaki siteden (DP-135).",
    bvContact:
      "DP-150. İletişim bilgileri yayındaki alt bilgiden gelir; form DP-151'e kadar hiçbir şey göndermez.",
    bvStrategicPartnership: "Yayındaki siteden (DP-206).",
    bvOurTeam: "Yayındaki siteden (DP-206). Yayındaki sitede 0 gösteren sayaçlar çıkarıldı.",
    bvNewsOilPricesUsIran:
      "Yayındaki sitenin tek blog yazısı (DP-206); haber makalesi olarak içe aktarıldı.",
    bvProductDetail: "Yayındaki ürün anlık görüntüleri. Ürünler altında düzenleyin.",
    bvPrivacy:
      "Onay kayıtlarına bağlı, sürümlü hukuki metin. Yalnızca yeni bir sürümle değiştirilebilir.",
    corporateHome:
      "Hero, şirket tanıtımı, hizmetler, ürün grupları, güçlü yönler ve harekete geçirici bölüm (COM-2b). Sayaç, distribütörlük iddiası veya müşteri yorumu yok.",
    corporateProducts:
      "Ürün portföyü: çapalı gruplar ve COA talebi (COM-2b). Tipik değerler kaynakları onaylanana kadar gizli kalır.",
    corporateNewsIndex:
      "Kurumsal haber listesinin başlığı, girişi ve boş durumu (COM-3). Makaleler Haberler altındadır.",
    corporateSiteNav:
      "Her kurumsal sayfanın menü öğeleri ve alt menüleri (menü düzenleyici, COM-1). Henüz var olmayan sayfaların bağlantıları metin olarak kalır.",
    corporateSiteFooter:
      "Her kurumsal sayfanın şirket metni, iletişim bilgileri, bağlantı sütunları, sosyal ve yasal bağlantıları (COM-1).",
    corporateSiteSeo:
      "Kurumsal sitenin site adı, varsayılan başlığı ve açıklaması (COM-1). SEO altında yönetilir.",
    corporateContact:
      "Yayınlı alt bilgideki iletişim bilgileri ve iletişim formu; mesajlar CRM'de CORPORATE lead olur (COM-4).",
  },
  /** Menü hedefi sorunları (MENU_TARGET_PROBLEMS). */
  problem: {
    pageMissing:
      "Sayfa artık mevcut değil. Site etiketi metin olarak gösterir; başka bir hedef seçin.",
    pageUnpublished:
      "Sayfa siteden kaldırıldı. Site, sayfa yeniden yayınlanana kadar etiketi metin olarak gösterir.",
    pageNotPublished:
      "Sayfa henüz yayınlanmadı. Site, sayfa yayınlanana kadar etiketi metin olarak gösterir.",
    productMissing:
      "Ürün bu sitede yok (kaldırılmış veya sizin için görünür değil). Site etiketi metin olarak gösterir.",
    productNotLive:
      "Ürün bu sitede yayında değil (yayınlanmamış, gizli veya arşivlenmiş). Site etiketi metin olarak gösterir.",
    categoryMissing: "Kategori artık mevcut değil. Site etiketi metin olarak gösterir.",
    categoryEmpty: "Bu kategoride yayında ürün yok: bağlantı boş bir liste açar.",
  },
};
