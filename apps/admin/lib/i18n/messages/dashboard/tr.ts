/**
 * ML-12e (DP-243): Dashboard alanının Türkçe metinleri. Anahtarlar İngilizce sözlükle birebir aynıdır
 * (eksik/fazla anahtar derleme hatası). Terimler docs/i18n/admin-glossary.md.
 */
import type { Messages } from "../../types";

export const dashboard: Messages["dashboard"] = {
  /** Genel bakış sayfası. */
  overview: {
    title: "Genel bakış",
    greeting: "{greeting}, {name}",
    intro: "İki Dream Petroleum sitesinin sayfaları, ürün bilgi föyleri ve personel erişimi.",
    writePage: "Sayfa yaz",
    sampleLabel: "Örnek veri.",
    sampleText:
      "Bu genel bakıştaki rakamlar, etkinlikler ve site durumu örnektir, hiçbir sisteme bağlı değildir. İnceleme kuyruğu ve oturum bilgileriniz gerçektir.",
  },
  /** KPI şeridi. */
  kpi: {
    title: "Son 30 gün",
    trend: "12 haftalık eğilim",
    trendLabel: "{label}, 12 haftalık eğilim",
  },
  /** Son etkinlikler. */
  activity: {
    title: "Son etkinlikler",
    description: "İki sitedeki değişiklikler ve erişim olayları",
    emptyTitle: "Henüz etkinlik yok",
    emptyText: "Yayınlar, düzenlemeler ve erişim değişiklikleri gerçekleştikçe burada görünür.",
  },
  /** Hızlı işlemler. */
  quickActions: {
    title: "Hızlı işlemler",
    content: { label: "Sayfa yaz", detail: "Her iki site için taslak" },
    products: { label: "Bilgi föyü güncelle", detail: "Ürün teknik özellikleri" },
    staff: { label: "Çalışma arkadaşı davet et", detail: "Personel hesabı ve rolü" },
    audit: { label: "Denetim kaydını aç", detail: "Kim neyi ne zaman değiştirdi" },
  },
  /** İnceleme kuyruğu paneli (ML-12a/b terimleri). */
  review: {
    title: "İnceleme bekleyenler",
    description: "Ürün ana kayıtları, en eskisi önce",
    descriptionTotal: "Ürün ana kayıtları, en eskisi önce · İncelemede: {total}",
    open: "Kuyruğu aç",
    forbiddenTitle: "Ürün kataloğuna erişiminiz yok",
    forbiddenText:
      "Rolleriniz ürünleri okuma yetkisi içermiyor, bu nedenle sizin için inceleme kuyruğu yok.",
    errorTitle: "İnceleme kuyruğu yüklenemedi",
    errorText: "Birazdan tekrar deneyin.",
    emptyTitle: "İnceleme bekleyen kayıt yok",
    emptyText: "Bir ürün ana kaydı gönderildiğinde onay için burada görünür.",
    loading: "İnceleme kuyruğu yükleniyor",
  },
  /** Oturum kartı. */
  session: {
    title: "Oturumunuz",
    secondFactor: "İkinci faktör",
    authenticator: "Doğrulayıcı",
    recoveryCode: "Kurtarma kodu",
    idle: "Hareketsizlikte oturum kapanır",
    endsAt: "Oturumun bitişi",
    sensitive: "Hassas işlemler",
    confirmedUntil: "{time} saatine kadar doğrulandı",
    askForCode: "Kod istenir",
    recoveryNote:
      "Bir kurtarma koduyla oturum açtınız. Doğrulayıcınıza yeniden eriştiğinizde yeni kurtarma kodları oluşturun.",
  },
  /** Site durumu paneli. */
  sites: {
    title: "Siteler",
    state: { live: "Yayında", maintenance: "Bakımda", preparing: "Hazırlanıyor" },
    pages: "sayfa,",
    drafts: "taslak,",
    notPublished: "henüz yayınlanmadı",
    published: "{time} yayınlandı",
  },
  /** Tasarım prototipinin örnek verisi; adlar kurgusaldır ve çevrilmez. */
  demo: {
    kpis: {
      pages: { label: "Yayındaki sayfalar", hint: "İki sitede toplam" },
      products: { label: "Ürün bilgi föyleri", hint: "Güncel sürümler" },
      enquiries: { label: "Açık talepler", hint: "Yanıt bekliyor" },
      reviews: { label: "İnceleme bekleyenler", hint: "En eskisi 3 gün önce gönderildi" },
    },
    people: {
      sanne: "Sanne de Vries",
      jonas: "Jonas Peters",
      lotte: "Lotte Bakker",
      mehmet: "Mehmet Kaya",
    },
    activity: {
      ev1: { text: "yayınladı:", target: "İletişim ve ofisler" },
      ev2: { text: "incelemeye gönderdi:", target: "Kalite ve sertifikasyon" },
      ev3: { text: "editör rolü aldı:", target: "Kurumsal site" },
      ev4: { text: "güncelledi:", target: "Baz yağ SN 500 bilgi föyü" },
      ev5: { text: "yeni bir doğrulayıcı kurdu:", target: "kendi hesabı" },
      ev6: { text: "yayınladı:", target: "Denizcilik yakıtlarına genel bakış (taslak 3)" },
    },
    sites: { corporate: "Kurumsal site" },
  },
};
