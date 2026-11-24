/** ML-12c: İçerik sayfaları ve listeleri, Türkçe (bkz. ../en/pages.ts). */
import type { Messages } from "../../../types";

export const pages: Messages["content"]["pages"] = {
  meta: {
    content: "İçerik",
    news: "Haberler",
    edit: "Sayfayı düzenle",
    newPage: "Yeni sayfa",
    newArticle: "Yeni makale",
  },
  tabs: {
    label: "İçerik türü",
    pages: "Sayfalar",
    news: "Haberler",
  },
  languageTabs: {
    label: "İçerik dili",
    notPublic: "{language} · herkese açık değil",
  },
  shared: {
    noAccessTitle: "Site içeriğine erişim yok",
    noAccessBody:
      "Rolleriniz hiçbir sitede içerik okumayı kapsamıyor. Bir site veya platform yöneticisinden içerik rolü isteyin.",
    readOnly: "Bu sitede salt okunur.",
    forbidden: "Bu sitedeki içeriği okuma yetkiniz yok.",
    tryAgain: "Biraz sonra tekrar deneyin.",
  },
  list: {
    title: "İçerik",
    description:
      "Herkese açık sitelerin sayfaları. Taslakları düzenleyin, önizleyin ve yayınlayın; siteler yalnızca yayınlananları gösterir.",
    newPage: "Yeni sayfa",
    canEdit: "Bu sitenin sayfalarını oluşturabilir ve düzenleyebilirsiniz ({locale}).",
    panelTitle: "CMS sayfaları",
    count: { one: "{count} sayfa", other: "{count} sayfa" },
    loadError: "Sayfa listesi yüklenemedi",
    emptyTitle: "Bu sitede henüz CMS sayfası yok",
    emptyEdit:
      "Standart şablondan bir sayfa oluşturun: açılış bölümü, metin, kartlar ve eylem çağrısı.",
    emptyRead: "Bu sitenin içerik editörleri sayfaları burada oluşturur.",
    listLabel: "{site} CMS sayfaları",
    sections: { one: "{count} bölüm", other: "{count} bölüm" },
    routesTitle: "Mevcut site sayfaları",
    routesDescription:
      "Henüz CMS'te yönetilmeyen ya da hiçbir zaman yönetilmeyecek sayfalar. İçerikleri değişmedi.",
    routesEmpty: "Bu sitenin tüm sayfaları CMS'te",
    routesLabel: "{site} mevcut sayfaları",
    openProducts: "Ürünleri aç",
  },
  news: {
    title: "Haberler",
    contentTitle: "İçerik",
    description:
      "Herkese açık sitelerin haber makaleleri. Taslak yazın, önizleyin ve yayınlayın; site yalnızca yayınlananları en yeniden başlayarak listeler.",
    newArticle: "Yeni makale",
    canEdit: "Bu sitenin makalelerini yazabilir ve düzenleyebilirsiniz ({locale}).",
    headingBefore: "Haber listesinin başlığı ve girişi: ",
    headingLink: "Haberler sayfasını düzenleyin",
    headingAfter: " ({state}).",
    missingBefore: "Haber listesinin başlığı henüz CMS'te değil: “News” sayfasını ",
    missingLink: "Sayfalar",
    missingAfter:
      " altından içe aktarın, ardından yayınlayın. O zamana kadar site listeyi kullanılamıyor olarak gösterir.",
    panelTitle: "Makaleler",
    count: { one: "{count} makale", other: "{count} makale" },
    loadError: "Makale listesi yüklenemedi",
    emptyTitle: "Bu sitede henüz makale yok",
    emptyEdit: "İlk makaleyi yazın: bir başlık, bir özet, isteğe bağlı bir kapak görseli ve gövde.",
    emptyRead: "Bu sitenin içerik editörleri makaleleri burada yazar.",
    listLabel: "{site} haber makaleleri",
  },
  editor: {
    title: "Sayfa",
    allPages: "Tüm sayfalar",
    loadError: "Sayfa yüklenemedi",
    allArticlesOf: "{site} tüm makaleleri",
    allPagesOf: "{site} tüm sayfaları",
    newsArticle: "Haber makalesi",
    lastSaved: "· son kayıt {date}, {name}",
    importedTitle: "İçe aktarıldıktan sonra düzenlenir",
    thisDesignedPage: "Bu tasarım sayfası",
    importNotice:
      "{note} Alanları, sayfa CMS'e içe aktarıldığında kendi formlarını alır; o zamana kadar site içeriği koddan gösterir.",
  },
  newPage: {
    title: "Yeni sayfa",
    back: "Tüm sayfalar",
    noEditTitle: "Bu sitede sayfa oluşturamazsınız",
    noEditBody:
      "Sayfa oluşturmak için sitede {permission} yetkisi gerekir (Content Editor veya Site Admin).",
    description:
      "{site} üzerinde standart şablondan oluşturulan yeni bir sayfa. Bölümlerini sonraki adımda eklersiniz.",
    panelTitle: "Sayfa",
  },
  newArticle: {
    title: "Yeni makale",
    back: "Tüm makaleler",
    noEditTitle: "Bu sitede makale yazamazsınız",
    noEditBody:
      "Makale yazmak için sitede {permission} yetkisi gerekir (Content Editor veya Site Admin).",
    description:
      "{site} üzerinde bir haber makalesi. Özetini, kapağını ve gövdesini sonraki adımda yazarsınız.",
    panelTitle: "Makale",
  },
  createForm: {
    articleTitle: "Makale başlığı",
    pageTitle: "Sayfa başlığı",
    articleTitleHint: "Makalenin sitede ve haber listesinde görünen başlığı.",
    pageTitleHint: "Sayfanın yönetim konsolundaki adı ve varsayılan başlığı.",
    address: "Adres",
    articleSlugHint: "Küçük harf ve kısa çizgi, örneğin why-oil-prices-fell.",
    pageSlugHint:
      "Küçük harf ve kısa çizgi. products, privacy, news ve iki harfli kodlar ayrılmıştır.",
    articleDraftNote:
      "Makale {site} üzerinde taslak olarak oluşturulur. Yayınlanana kadar sitede hiçbir şey gösterilmez.",
    pageDraftNote:
      "Sayfa {site} üzerinde taslak olarak oluşturulur. Yayınlanana kadar sitede hiçbir şey gösterilmez.",
    create: "Taslak oluştur",
  },
  importButton: {
    checkPassed:
      "Kontrol başarılı: {title}, {fields} ile taslak olarak içe aktarılabilir. Yayınlanana kadar site değişmez.",
    importDraft: "Taslak olarak içe aktar",
    cancel: "İptal",
    importIntoCms: "CMS'e içe aktar",
  },
};
