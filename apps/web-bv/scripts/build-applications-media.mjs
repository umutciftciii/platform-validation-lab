// Builds the Applications concept WebP files from the source images.
// Run from apps/web-bv: pnpm --filter @dream/web-bv exec node scripts/build-applications-media.mjs
// The 1448 px files are the sources as delivered, copied without a second compression.
// The 828 px files are what phones download. Nothing is upscaled.
import { copyFile } from "node:fs/promises";
import sharp from "sharp";

const SOURCE = "../../assets/source/web-bv/applications";
const OUTPUT = "public/media/applications";
const FILES = [
  ["applications-01-transparent-polymers", "transparent-polymers"],
  ["applications-02-baby-care-concept", "baby-care-concept"],
  ["applications-03-personal-care-packaging", "personal-care-packaging"],
];

for (const [source, name] of FILES) {
  const input = `${SOURCE}/${source}.webp`;
  await copyFile(input, `${OUTPUT}/${name}-1448.webp`);
  const file = await sharp(input)
    .resize({ width: 828 })
    .webp({ quality: 80, smartSubsample: true, effort: 6 })
    .toFile(`${OUTPUT}/${name}-828.webp`);
  console.log(name, `${file.width}x${file.height} ${file.size}B`);
}
