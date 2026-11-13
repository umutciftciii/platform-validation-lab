# @dream/web-bv

dreampetroleumbv.com public site. F0-002'de `Dream Petroleumbv/iccsyn-hero-prototype` kaynaklarından
kopyalandı. Orijinal prototip yerinde duruyor ve 3107'de çalışmaya devam ediyor.

## Prototipten farklar

| Değişiklik | Neden |
|---|---|
| `app/api/health/route.ts` eklendi | Docker healthcheck ve smoke testi |
| `package.json` adı `@dream/web-bv`, sürümler lockfile'daki kesin sürümlere sabitlendi | Prototipteki davranış korunuyor (next 16.4.5, react 19.3.0, motion 14.9.1, tailwind 4.3.4) |
| `@types/node` 24 | Platform Node 24'te çalışıyor |
| `scripts/build-*-media.mjs` kaynak yolu `../../assets/source/web-bv/` | Kaynak görseller `assets/` altına taşındı |
| `sharp` açık devDependency | Medya script'leri doğrudan kullanıyor |

Bunların dışındaki dosyalar (`app/`, `components/`, `content/`, `public/`, `next.config.ts`,
`eslint.config.mjs`, `tsconfig.json`, `AGENTS.md`) prototiple byte düzeyinde aynıdır.

## Route'lar

| Route | |
|---|---|
| `/` | Geçici olarak `/demo/iccsyn-hero-products`'a yönlenir (307) |
| `/demo/iccsyn-hero-products` | Hero + Product Groups + Services + CTL + Applications + Footer |
| `/demo/iccsyn-hero`, `/demo/iccsyn-hero-compact`, `/demo/iccsyn-hero-nav` | Önceki karşılaştırma sürümleri |
| `/api/health` | Liveness |

Prototipin ayrıntılı notları: `README.prototype.md`. Yayın öncesi listesi: `docs/creative/YAYIN-ONCESI.prototype.md`.

## Medya script'leri

```bash
pnpm --filter @dream/web-bv exec node scripts/build-ctl-media.mjs
```

Kaynak: `assets/source/web-bv/`, çıktı: `public/media/`.
