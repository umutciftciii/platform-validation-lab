/** ML-12c: İçerik ekranlarının ortak Türkçe sözcükleri (bkz. ../en/common.ts). */
import type { Messages } from "../../../types";

export const common: Messages["content"]["common"] = {
  kind: {
    TEMPLATE: "Şablon sayfası",
    DESIGN: "Tasarım sayfası",
    FRAGMENT: "Site geneli bölüm",
  },
  registry: {
    fragment: "Site geneli bölüm",
    template: "İçerik sayfası",
    design: "Tasarım sayfası",
    readyToImport: " · içe aktarılmaya hazır",
    notBuiltYet: " · henüz hazırlanmadı",
    stage: " · {stage}",
    contract: "Hukuki metin, sürümlü",
    catalog: "Ürün kataloğu",
  },
  publication: {
    draft: "Taslak, yayınlanmadı",
    unpublished: "Yayından kaldırıldı",
    changed: "Yayında, değişiklikler yayınlanmadı",
    live: "Yayında",
  },
  translationState: {
    missing: "Çevrilmedi",
    draft: "Taslak",
    published: "Yayında",
    outdated: "Yayında, güncel değil",
    draftOutdated: "Taslak, güncel değil",
  },
  siteWidePart: "Site geneli bölüm",
  siteLanguages: {
    title: "Site dilleri",
    description:
      "Salt okunur. Etkin bir dildeki içerik taslak olarak hazırlanabilir, önizlenebilir ve yayınlanabilir; herkese açık olmayan bir dil ziyaretçilere hiçbir zaman gösterilmez.",
    empty: "Bu site için kayıtlı dil yok",
    list: "{site} dilleri",
    default: "Varsayılan",
    public: "Sitede herkese açık",
    notPublic: "Herkese açık değil",
    editingOff: "Düzenleme kapalı",
  },
};
