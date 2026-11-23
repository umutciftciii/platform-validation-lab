/** ML-12a: Turkish messages for the catalogue API's field issues (keys are API codes). */
import type { Messages } from "../../../types";

export const rules: Messages["catalog"]["rules"] = {
  "version:stale":
    "Bu kaydı başka biri değiştirdi. Onun sürümünü görmek için sayfayı yeniden yükleyin.",
  "code:unique": "Bu kodu başka bir ürün kullanıyor.",
  "slug:unique": "Bu slug zaten kullanılıyor.",
  "slug:live_elsewhere":
    "Bu sitede bu adreste başka bir ürün hâlâ yayında. Önce o ürünü yeniden yayınlayın veya yayından kaldırın.",
  "slug:old_address":
    "Bu adres daha önce bu sitedeki başka bir ürüne aitti ve şimdi ona yönlendiriliyor (301). Başka bir slug seçin.",
  "slug:redirect_loop":
    "Bu adres değişikliği eski adreslerin döngü hâlinde yönlenmesine yol açar. Başka bir slug seçin.",
  "listing:unique": "Bu ürün sitede zaten listeleniyor. Sayfayı yeniden yükleyin.",
  "parentId:too_deep": "Kategoriler en fazla üç düzey derinliğinde olabilir.",
  "parentId:cycle": "Bir kategori kendi altına taşınamaz.",
  "parentId:unknown_parent": "Üst kategori bu sitede mevcut değil.",
  "categoryId:required":
    "Bir kategori seçin veya önce bu site için varsayılan bir kategori belirleyin.",
  "categoryId:unknown": "Kategori bu sitede mevcut değil.",
  "visibility:product_archived": "Arşivlenmiş bir ürün sitede görünür olamaz.",
  "status:archived": "Arşivlenmiş ürünler düzenlenemez. Önce geri yükleyin.",
  "(root):has_children": "Önce alt kategorileri taşıyın veya silin.",
  "(root):has_listings": "Önce bu kategorideki ürünleri taşıyın.",
  "(root):own_change":
    "Bu revizyonu siz değiştirdiniz veya gönderdiniz; karar başka bir inceleyiciye ait (görevler ayrılığı).",
  "status:not_draft":
    "Yalnızca taslak gönderilebilir. Güncel durumu görmek için sayfayı yeniden yükleyin.",
  "status:not_in_review": "Ürün artık incelemede değil. Sayfayı yeniden yükleyin.",
  "status:published": "Arşivlemeden önce ürünü her sitede yayından kaldırın.",
  "status:not_published": "Ürün bu sitede yayında değil.",
  "status:transition": "Bu durum değişikliği mümkün değil. Sayfayı yeniden yükleyin.",
  "listingVersion:stale":
    "Site listesi bu arada değişti. Sayfayı yeniden yükleyip tekrar kontrol edin.",
  "canonicalPath:custom":
    "Bu sitenin bir yolunu kullanın, örneğin /products/base-oil-sn-150 (küçük harfli kelimeler ve kısa çizgi, alan adı olmadan).",
  "ogImageId:unknown":
    "Bu görsel artık ürünün herkese açık bir görseli değil. Başka bir görsel seçin.",
  "listing:missing": "Önce ürünü bu sitede listeleyin.",
  "product:not_approved": "Ürün ana kaydı güncel sürümünde onaylanmış olmalıdır.",
  "product:archived": "Arşivlenmiş ürünler yayınlanamaz.",
  "listing:listing_missing": "Önce ürünü bu sitede listeleyin.",
  "listing:listing_hidden":
    "Henüz bu sitede gösterilmiyor. Burada yayınlamak için bu sitenin listesinde düzenleme yetkisi de gerekir.",
  "status:not_approved": "Ürün ana kaydı güncel sürümünde onaylanmış olmalıdır.",
  "publication:already_published": "Bu sürüm sitede zaten yayında. Sayfayı yeniden yükleyin.",
  "publication:unique": "Ürün bu arada bu sitede yayınlandı. Sayfayı yeniden yükleyin.",
  "images:cover_missing": "Önce bir kapak görseli ekleyin.",
  "summary:summary_missing": "Önce bir özet ekleyin (ana kayıt veya site metni).",
  "(root):image_published":
    "Bu görsel yayındaki bir sitede gösteriliyor. Önce ürünü yayından kaldırın.",
  "isPublic:cover_cannot_be_hidden": "Kapak gizlenemez. Önce başka bir görseli kapak yapın.",
  "isPublic:hidden_image": "Kapak yapmadan önce bu görseli sitede gösterin.",
  "file:busy": "Görsel işleme meşgul. Biraz sonra tekrar deneyin.",
  "status:document_archived": "Bu belge arşivlenmiş. Önce geri yükleyin.",
  "(root):not_publishable":
    "Sitede yalnızca dosyası olan, etkin ve dahili olmayan bir belge gösterilebilir.",
  "(root):too_many_documents": "Bu ürünün belge sayısı zaten üst sınırda.",
  "(root):too_many_revisions": "Bu belgenin revizyon sayısı zaten üst sınırda.",
  "locale:not_enabled": "Bu dil sitede etkin değil.",
  "locales:default_locale": "Varsayılan dil her zaman yayınlanır; yalnızca diğer dilleri seçin.",
  "manualReview:not_chosen": "Elle kontrolü yalnızca yayınladığınız diller için onaylayın.",
  "name:required": "Ad, sitenin varsayılan dilinde zorunludur.",
};
