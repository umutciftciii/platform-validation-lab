// Builds the CTL Technology WebP files from the source images.
// Run from apps/web-bv: pnpm --filter @dream/web-bv exec node scripts/build-ctl-media.mjs
// The sources are ~836x470 prototype crops with a bright line on some edges, so a few
// pixels are trimmed from every side. They are not upscaled: that adds no real detail.
import sharp from "sharp";

const SOURCE = "../../assets/source/web-bv/ctl-technology";
const OUTPUT = "public/media/ctl-technology";
const TRIM = 5;

for (const name of ["ctl-01-industrial-process", "ctl-02-molecular-visualization", "ctl-03-clear-base-oil"]) {
  const input = sharp(`${SOURCE}/${name}.jpg`);
  const { width, height } = await input.metadata();
  const file = await input
    .extract({ left: TRIM, top: TRIM, width: width - 2 * TRIM, height: height - 2 * TRIM })
    .webp({ quality: 88, smartSubsample: true, effort: 6 })
    .toFile(`${OUTPUT}/${name.replace(/^ctl-\d+-/, "")}.webp`);
  console.log(name, `${file.width}x${file.height} ${file.size}B`);
}
