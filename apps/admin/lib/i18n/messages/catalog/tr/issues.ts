/** ML-12a: Turkish validation and publication-readiness texts (see ../en/issues.ts). */
import type { Messages } from "../../../types";

export const issues: Messages["catalog"]["issues"] = {
  spec: {
    required_missing: "{name} zorunludur.",
    invalid_type: "{name}: {type} türünde bir değer bekleniyor.",
    invalid_unit: "{name}: birim şunlardan biri olmalıdır: {units}.",
    invalid_unit_none: "{name}: bu teknik özelliğin birimi yoktur.",
    invalid_range: "{name}: {problem}.",
    out_of_bounds: "{name}: izin verilen aralık {min} ile {max} arasıdır.",
    too_precise: "{name}: en fazla {decimals} ondalık basamak.",
    too_long: "{name}: en fazla {max} karakter.",
    test_method_missing: "{name}: test yöntemi yok (önerilen: {methods}).",
    unknown_definition: "Bilinmeyen teknik özellik.",
    specs_missing:
      "Teknik veri yok: ürün sayfası teknik verilerin talep üzerine sunulduğunu belirtir.",
    alt_text_missing: "Bir görselin alternatif metni yok.",
    enter_value: "{name}: bir değer girin veya kaldırın.",
    enter_number: "{name}: bir sayı girin.",
  },
  typical: "{name} (tipik)",
  types: {
    number: "sayı",
    text: "metin",
    boolean: "evet/hayır",
    range: "aralık",
  },
  range: {
    empty_bounds: "bir alt değer, bir üst değer veya ikisini girin",
    open_min: "açık bir alt sınır için alt değer gerekir",
    open_max: "açık bir üst sınır için üst değer gerekir",
    min_above_max: "alt değer üst değerden büyük",
    empty: "aralık boş",
  },
  publication: {
    archived: "Arşivlenmiş ürünler yayınlanamaz.",
    not_reviewed: "Bu sürümü ikinci bir kişi incelemedi (isteğe bağlı).",
    not_approved: "Ürün ana kaydı güncel sürümünde onaylanmış olmalıdır.",
    listing_missing: "Site bu ürünü listelemiyor.",
    listing_shown_on_publish: "Liste gizli; yayınlamak ürünü bu sitede görünür yapar.",
    listing_hidden: "Liste bu sitede gizli.",
    cover_missing: "Bir kapak görseli zorunludur.",
    summary_missing: "Özet yok (site metni veya ana kayıt): ürün kartı ve sayfası özet göstermez.",
    description_missing: "Ürünün açıklaması yok.",
    sensitive_claim:
      "Herkese açık metin {claim} ifadesi içeriyor: yalnızca bir sertifika veya kaynak belgeyle yayınlayın.",
    company_review_pending: "Şirket bu sitenin araştırma önerisini incelemedi (isteğe bağlı).",
  },
  plain: {
    listing_shown_on_publish: "Henüz bu sitede gösterilmiyor: yayınlamak ürünü gösterir.",
    listing_hidden:
      "Henüz bu sitede gösterilmiyor. Burada yayınlamak için bu sitenin listesinde düzenleme yetkisi de gerekir.",
  },
  claims: {
    saf: "SAF / havacılık yakıtı",
    pharmaceutical: "farmasötik veya farmakope kalitesi",
    cosmetic: "kozmetik kalite",
    food: "gıda kalitesi veya gıdayla temas",
    medical: "tıbbi kullanım",
    ctl_gtl: "CTL / GTL kökeni",
    certification: "sertifika veya OEM onayı",
    environmental: "çevresel iddia",
  },
};
