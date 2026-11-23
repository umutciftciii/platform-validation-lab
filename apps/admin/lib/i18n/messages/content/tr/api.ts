/** ML-12c: CMS istemcisinin Türkçe mesajları (bkz. ../en/api.ts). API kodları değişmez. */
import type { Messages } from "../../../types";

export const api: Messages["content"]["api"] = {
  rules: {
    versionStale:
      "Bu sayfayı bu arada başka biri kaydetti. Onun sürümünü görmek için sayfayı yeniden yükleyin.",
    slugUnique: "Bu sitenin başka bir sayfası bu adresi zaten kullanıyor.",
    slugReserved:
      "Bu adres sitenin kendisine ayrılmıştır (örneğin products veya privacy) ya da bir dil kodudur.",
    slugInvalidFormat: "Küçük harf, rakam ve tek kısa çizgi kullanın; örneğin about-us.",
    slugLiveElsewhere:
      "Bu adreste yayında olan başka bir sayfa var. Önce o sayfayı taşıyın ya da yayından kaldırın, sonra bunu yayınlayın.",
    slugOldAddress:
      "Bu adres daha önce başka bir sayfaya aitti ve artık o sayfanın taşındığı yere yönlendiriyor (301). Başka bir adres seçin.",
    slugRedirectLoop:
      "Bu adres değişikliği eski adreslerin döngü hâlinde yönlendirmesine yol açar. Başka bir adres seçin.",
    kindNotEditableYet: "Bu sayfa CMS'e aktarılana kadar kodda yönetilir.",
    articleIncomplete:
      "Bir makalenin yayınlanabilmesi için bir özeti ve en az bir gövde bölümü olmalıdır.",
    coverAlt: "Kapak görselinin alternatif metnini ekleyin.",
    contentInvalid:
      "Bu içerik artık güncel alanlarla eşleşmiyor. Taslağı yeniden kaydedin ve vurgulanan alanları kontrol edin.",
    revisionUnknown: "Bu revizyon yok. Sayfayı yeniden yükleyin.",
    localeExists: "Bu sayfa o dilde zaten var. Dil sekmelerinden açın.",
    localeNotEnabled: "Bu dil bu sitede düzenlemeye açık değil.",
    localeIsSource: "Bu sayfa, grubunun kaynak dilidir; güncellenmesi gereken bir şey yok.",
    localeUnknown: "Bu dil sitenin dillerinden biri değil.",
    slugFixedAddress: "Tasarım sayfaları ve site geneli bölümler her dilde aynı adresi korur.",
    slugFormat: "Küçük harf, rakam ve tek kısa çizgi kullanın; örneğin over-ons.",
    canonicalPath:
      "Bu sitenin bir yolunu kullanın; örneğin /about-us (küçük harfli kelimeler ve kısa çizgiler, alan adı yok).",
    ogImage: "Kayıtlı site görsellerinden birini seçin.",
  },
  unknownReference:
    "Bir menü bağlantısı bu sitede artık olmayan bir sayfayı, ürünü veya kategoriyi gösteriyor. Vurgulanan bağlantılar için başka bir hedef seçin.",
  checkFields: "Şu alanları kontrol edin: {fields}.",
  notSaved: "Değişiklik kaydedilemedi. Biraz sonra tekrar deneyin.",
  unreachable: "Yönetim API'sine ulaşılamıyor.",
  path: {
    section: "{n}. bölüm",
    sectionField: "{n}. bölüm ({field})",
    seo: "SEO {field}",
    menu: "{group} {n}{rest}",
    separator: " › ",
    summary: "özet",
    cover: "kapak görseli",
  },
  pathWords: {
    items: "öğe",
    columns: "sütun",
    noScriptLinks: "JavaScript olmadan bağlantı",
    legal: "yasal bağlantı",
    social: "sosyal medya bağlantısı",
    children: "alt menü bağlantısı",
    links: "bağlantı",
    label: "etiket",
    target: "hedef",
    url: "adres",
    title: "başlık",
    href: "bağlantı",
    text: "metin",
    button: "düğme",
    cta: "düğme",
    image: "görsel",
    imageAlt: "görsel alternatif metni",
    body: "gövde",
    intro: "giriş",
    eyebrow: "üst başlık",
    description: "açıklama",
    canonicalPath: "kanonik yol",
    ogImage: "Open Graph görseli",
    noindex: "noindex",
  },
};
