// Builds the Services Showcase WebP files from the source renders.
// Run from apps/web-bv: pnpm --filter @dream/web-bv exec node scripts/build-services-media.mjs
// Desktop keeps the full 4:3 frame, because the card's aspect ratio changes with the
// viewport. Mobile is a 3:4 crop on the subject, since the left side of each render
// is empty dark space.
import sharp from "sharp";

const SOURCE = "../../assets/source/web-bv/services-showcase";
const OUTPUT = "public/media/services-showcase";
const MOBILE = { width: 815, height: 1086, top: 0 };

const IMAGES = [
  { name: "energy-trading-supply", mobileLeft: 600 },
  { name: "storage-distribution", mobileLeft: 520 },
  { name: "logistics", mobileLeft: 633 },
];

for (const { name, mobileLeft } of IMAGES) {
  const input = `${SOURCE}/${name}-source.png`;
  const desktop = await sharp(input)
    .webp({ quality: 84, smartSubsample: true, effort: 6 })
    .toFile(`${OUTPUT}/${name}-desktop.webp`);
  const mobile = await sharp(input)
    .extract({ ...MOBILE, left: mobileLeft })
    .webp({ quality: 84, smartSubsample: true, effort: 6 })
    .toFile(`${OUTPUT}/${name}-mobile.webp`);
  console.log(name, `desktop ${desktop.width}x${desktop.height} ${desktop.size}B`, `mobile ${mobile.width}x${mobile.height} ${mobile.size}B`);
}
