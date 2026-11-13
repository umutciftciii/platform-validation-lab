# ICCSYN scroll hero prototipi

Dream Petroleum B.V. ana sayfası için ayrı bir hero prototipi. Production'a bağlı değildir.

Geliştirme ortamı Docker Compose ile çalışır; host üzerinde ayrıca `next dev` veya `next start` başlatmayın.

```bash
docker compose up -d
```

Demo: <http://localhost:3107/demo/iccsyn-hero-products>. Diğer komutlar ve test sonuçları: `review/docker/RAPOR.md`.

Demo route'ları: <http://localhost:3107/demo/iccsyn-hero>

Daha kısa scroll karşılaştırması (masaüstü 220svh, mobil 360svh): <http://localhost:3107/demo/iccsyn-hero-compact>

Üst navigasyonlu sürüm (hero aynı, 240svh): <http://localhost:3107/demo/iccsyn-hero-nav>. Sonuçlar ve ekran görüntüleri: `review/top-navigasyon/RAPOR.md`.

Hero ve Product Groups birleşik sürüm: <http://localhost:3107/demo/iccsyn-hero-products>. Sonuçlar: `review/product-groups/RAPOR.md`.

Güncel test sonuçları ve önce/sonra görüntüleri: `review/GORSEL-KARTLAR-RAPORU.md`. Temizlik önerisi: `review/TEMIZLIK-RAPORU.md`. Önceki metin kartlı sürümün bulguları: `review/RAPOR.md`.

Applications scroll showcase (CTL sonrası, doğrulama bekleyen AI konsept görselleri): `review/applications-showcase/RAPOR.md`. İçerik: `content/applications-showcase.ts`.

Yayın öncesi yapılacaklar: `review/YAYIN-ONCESI.md`.

Bu projede ana sayfa yoktur, bu yüzden `/` adresi geçici olarak `/demo/iccsyn-hero-products` sayfasına yönlenir (`next.config.ts`). "Explore ICCSYN Products" butonu, ürün sayfası
olmadığı için devre dışıdır; hedefi `content/iccsyn-hero.ts` içindeki `ctaHref` ile verilir.

## Dosyalar

| Dosya | Görev |
|---|---|
| `app/demo/iccsyn-hero/page.tsx` | Demo route, arama motorlarına kapalı |
| `components/ui/spatial-depth-hero.tsx` | Kaynak bileşenden uyarlanan scroll, 3D ve kart mantığı |
| `components/ui/lab-vessel-media.tsx` | Cam ve sıvı medya katmanı: poster ve scroll'a bağlı kare dizisi |
| `content/iccsyn-hero.ts` | Tüm metinler; CMS bu yapıyı dolduracak |
| `app/demo/iccsyn-hero-nav/page.tsx` | Navigasyonlu demo route; navigasyon yalnızca burada görünür |
| `components/ui/site-nav.tsx` | Üst navigasyon ve mobil menü |
| `app/demo/iccsyn-hero-products/page.tsx` | Hero ve Product Groups birleşik demo route |
| `components/ui/product-groups-showcase.tsx` | Dört gruplu tam ekran slider |
| `content/product-groups.ts` | Grup metinleri ve medya; GIF yerine video buradan verilir |
| `public/media/iccsyn-groups/temp/` | Geçici, düşük çözünürlüklü GIF ve posterler |
| `Dockerfile.dev`, `compose.yaml`, `.dockerignore` | Tek container'lık geliştirme ortamı |
| `content/site-nav.ts` | Menü metinleri ve hedefleri; `href: null` henüz hazır olmayan sayfadır |
| `public/media/brand/dream-petroleum-logo.svg` | Logo PDF'inden koyu zemin için çıkarılan yatay logo |
| `app/globals.css` | Renk ve tipografi tokenları, kart ve CTA stilleri |
| `public/media/iccsyn-vessel/temp-sh04/` | Geçici cam kap medyası |
| `public/media/iccsyn-cards/` | Motor, hidrolik ve kompresör/türbin kartlarının görselleri |
| `public/media/iccsyn-cards/temp/` | Diğer üç kartın geçici görselleri ve kullanılmayan eski üç görsel; aynı adla değiştirilirse `.next/cache/images` silinmeli |

Gerçek Next.js reposuna taşırken `components/ui/` ve `content/` klasörlerini, demo route'u ve medya klasörünü
kopyalayın, `motion` paketini kurun, `globals.css` içindeki tokenları ve stilleri ekleyin. Archivo fontu
`app/layout.tsx` içinde tanımlıdır.

## Kaynak bileşenden korunanlar ve değişenler

**Korunanlar:** `useScroll`, `useSpring` ve `useTransform` zinciri, sticky perspektif sahnesi, `preserve-3d`,
elle yerleştirilmiş 3D koordinatlar, kartların içe dönük açısı, pointer parallax, odaklanılmayan kartların
soluklaşması.

**Değişenler:**

- Parallax aralığı ±7,5°'den ±4°'ye indi, böylece kart metni okunur kalıyor.
- Kartlar hover'da kameraya gerçekten dönüyor. Kaynakta iç `whileHover`, üst katmandaki dönüşü geri alamıyordu.
- Soluklaştırmadaki `blur` kaldırıldı. Her hover'da komşu kartları yeniden boyuyordu; artık yalnızca opacity değişiyor.
- Sahneye `pointer-events-none` eklendi. Kaynaktaki yapıda z<0 kartlar hover almıyordu.
- Harici görseller, demo metinleri ve `any` tipleri kaldırıldı.

## İçerik kaynağı

Altı kullanım alanı `iccsyn-ctl-technology-overview.pdf` 11. slayttan alındı. Özel akışkanlar kartı, aynı slayttaki
"test ile doğrulanmalı" uyarısını kartın içinde taşır. Storyboard'daki `Marine` ve `Logistics` bu PDF'te
geçmediği için kullanılmadı. Hero'da sayısal teknik değer yoktur.

## Gerçekçi sıvı için medya özellikleri

Sıvı kodla simüle edilmez. Hero, scroll konumuna göre gerçek görüntünün karelerini gösterir. Son medya geldiğinde
yalnızca `lab-vessel-media.tsx` içindeki `TEMP_VESSEL_MEDIA` nesnesi değişir.

**Çekim veya render**

| Özellik | Değer |
|---|---|
| Kaynak | Gerçek ICCSYN numunesiyle stüdyo çekimi veya numuneye göre onaylanmış CGI |
| Kadraj | 1:1 kompozisyon, 16:9 çekilecekse kap için en az 2160×2160 piksellik alan |
| Yerleşim | Kabın tamamı ve tabanı görünür; kap genişliği kadrajın en fazla %60'ı; akış için üstte boşluk |
| Kamera | Kilitli, zoom ve orbit yok |
| Süre | 4–6 sn temiz akış; loop gerekmez, çünkü scroll ile ileri geri oynatılır |
| Hareket | Laminer ve kesintisiz akış, görünür seviye yükselişi, sıçrama ve kabarcık yok |
| Renk | Sıvı gövdesi numuneyle eşleşir; amber yalnızca cam ve sıvı kenarındaki yansımadır |
| Arka plan | Tercihen alfa kanalı (ProRes 4444); yoksa düz koyu zemin, kenarlarda yaklaşık `#000407` |
| Master | 24 veya 48 fps, en az 10-bit, Rec.709, sessiz, marka ve etiket yok |

**Web çıktısı**

| Çıktı | Boyut | Kare | Hedef ağırlık |
|---|---|---|---|
| Masaüstü dizisi | 1200×1200 WebP veya AVIF | 72–96 | Toplam 5 MB altı |
| Mobil dizisi | 640×640 WebP veya AVIF | 48 | Toplam 1,5 MB altı |
| Poster | 1080×1080 | 1 | 100 KB altı |

Kareler `001.webp`, `002.webp` biçiminde adlandırılır.

**Onay:** gerçek numune fotoğrafı ve ürün sahibi onayı. Referans: `production/quality-checklist.md`.

## Mobil ve performans değerlendirmesi

**Masaüstü ölçümü:** production build, 1920×1080 ve DPR 2, Chromium, Mac. 5 sn boyunca tüm hero kaydırıldı.

| Metrik | Sonuç |
|---|---|
| Kare süresi | Median 16,7 ms, p95 17,2 ms, en yüksek 17,7 ms (301 kare, 33 ms üstü yok) |
| First Contentful Paint | 92 ms (localhost) |
| Medya, masaüstü | 72 kare, 3,3 MB |
| Medya, mobil | 48 kare, 1,06 MB |
| JS, font, poster | 58 KB, 88 KB, 58 KB |

Bu rakamlar güçlü bir Mac ve localhost içindir; telefondaki performansı göstermez.

**Mobil düzen:** Dar ekrana 3D dağılım sığmadığı için kartlar sırayla, sağdan ve soldan gelen bir desteye dönüşür.
Pointer parallax kapalıdır. Yalnızca mobil kare dizisi iner.

**Yavaş bağlantı:** `Save-Data` veya 2G tespit edilirse kare dizisi hiç inmez, poster gösterilir.

**Riskler ve sonraki adımlar:**

1. Gerçek telefon testi gerekir, özellikle orta seviye Android ve iOS Safari. `mask-image` ve `preserve-3d` birlikte en olası darboğazdır.
2. 1,06 MB kare dizisi sayfa açılışında iner. Gerçek ana sayfada indirme, hero görünür olunca başlatılabilir.
3. Hero masaüstünde 240svh, mobilde 420svh uzunluğundadır. Ayrıntı: `review/zamanlama/ZAMANLAMA-RAPORU.md`.

## Test edilenler

- Ekranlar: 1920×1080, 1440×900, 1280×620, 768×1024, 844×390, 375×812. Yatay taşma görülmedi.
- Klavye: atlama bağlantısı, kartlar ve CTA sırayla odak alıyor; sayfa içeriği görünür yere kayıyor.
- Hover: altı kartın altısı da hedef alınabiliyor.
- Reduced motion: `matchMedia` taklidiyle test edildi; canvas ve sticky yok, tüm içerik normal akışta.

**Test edilmeyenler:** gerçek telefonlar, Safari, Firefox, ekran okuyucu ve işletim sistemindeki gerçek
reduced-motion ayarı.

## Yayına çıkmadan önce

- Geçici medyanın yerine onaylı görüntü: `SH04 — PURE FLOW` gerçek numuneden gelmiyor, tabanı kadraj dışında ve rengi doğrulanmadı.
- Motor, hidrolik ve kompresör/türbin kartlarının yeni görselleri için kullanım ve lisans onayı.
- Sayfadaki "Temporary images and footage, not a product sample" ibaresini, gerçek medya gelince kaldırın.
- ICCSYN için resmî logo, font ve marka kullanım onayı. Archivo geçicidir.
- Kart metinleri ve "Purity in Motion." için ürün sahibi onayı.
- CTA hedefi olan ürün sayfası ve `ctaHref` değeri.
