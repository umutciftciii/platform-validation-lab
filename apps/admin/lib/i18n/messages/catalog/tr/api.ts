/** ML-12a: Turkish messages of the catalogue client (see ../en/api.ts). */
import type { Messages } from "../../../types";

export const api: Messages["catalog"]["api"] = {
  translationMissing:
    "Bazı metinler henüz çevrilmedi ({languages}): gerekenleri Diller bölümünde görün.",
  manualReview: "{languages} metnini yayınlamadan önce elle kontrol ettiğinizi onaylayın.",
  specBlocking: "Önce engelleyen teknik özellik sorunlarını düzeltin (doğrulama raporuna bakın).",
  checkFields: "Şu alanları kontrol edin: {fields}.",
  notSaved: "Değişiklik kaydedilemedi. Biraz sonra tekrar deneyin.",
  unreachable: "Yönetim API'sine ulaşılamıyor.",
};
