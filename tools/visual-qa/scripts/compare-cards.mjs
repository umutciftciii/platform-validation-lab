// Before/after sheets for the card image update. Run from the project root.
import { createRequire } from "module";
const require = createRequire(process.cwd() + "/");
const sharp = require("sharp");
const D = "review/kart-gorselleri";
const row = async (names, w, out) => {
  const h = Math.round(w * names.h);
  const imgs = [];
  for (const [i, pair] of names.items.entries()) for (const [j, p] of ["once", "sonra"].entries()) {
    imgs.push({ input: await sharp(`${D}/${p}-${pair}.png`).resize(w, h).toBuffer(), left: j * (w + 12), top: i * (h + 12) });
  }
  await sharp({ create: { width: 2 * w + 12, height: names.items.length * (h + 12) - 12, channels: 3, background: "#222" } }).composite(imgs).jpeg({ quality: 82 }).toFile(`${D}/${out}`);
};
await row({ h: 900 / 1440, items: ["masaustu-1440"] }, 1000, "karsilastirma-masaustu.jpg");
await row({ h: 812 / 375, items: ["mobil-375-passenger", "mobil-375-hydraulic", "mobil-375-compressor"] }, 330, "karsilastirma-mobil.jpg");
