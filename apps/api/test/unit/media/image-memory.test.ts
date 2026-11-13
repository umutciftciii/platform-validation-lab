// PM-3: memory of image processing, measured on the largest accepted upload (25 MP) and a large
// JPEG, through the same gate the API uses. The figures are printed (see docs) and bounded so a
// regression (a second full decode, a cache, parallel decodes) fails here.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { inspectImage } from "../../../src/catalog/image-inspect.js";
import { ImageProcessingGate } from "../../../src/media/image-gate.js";

const MB = 1024 * 1024;

/** A gradient with fine texture: compresses under the 10 MB cap but must be fully decoded. */
async function textured(w: number, h: number, format: "png" | "jpeg"): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const t = format === "png" ? 0 : ((x * 7 + y * 13) ^ (x >> 3)) & 0x0f;
      raw[i] = ((x * 255) / w + t) & 0xff;
      raw[i + 1] = ((y * 255) / h + t) & 0xff;
      raw[i + 2] = (((x + y) * 255) / (w + h) + t) & 0xff;
    }
  }
  const img = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
  return (
    format === "png" ? img.png({ compressionLevel: 9 }) : img.jpeg({ quality: 85 })
  ).toBuffer();
}

describe("image processing memory", () => {
  for (const format of ["png", "jpeg"] as const) {
    it(`stays bounded for the largest accepted image (25 MP ${format})`, async () => {
      const gate = new ImageProcessingGate(1, 4);
      const big = await textured(5000, 5000, format); // 25 MP, the maximum
      expect(big.length).toBeLessThan(10 * MB + 1);
      const out = await gate.run(() => inspectImage(big, `image/${format}`));
      expect(out.width).toBe(5000);
      const m = gate.snapshot();
      console.log(
        `image memory: 25 MP ${format} ${(big.length / MB).toFixed(1)} MB -> peak RSS growth ` +
          `${(m.lastRssDeltaBytes / MB).toFixed(0)} MB, peak RSS ${(m.peakRssBytes / MB).toFixed(0)} MB, ` +
          `${m.lastDurationMs} ms`,
      );
      // Bound: about one decoded frame (75 MB of RGB) plus libvips buffers.
      expect(m.lastRssDeltaBytes).toBeLessThan(220 * MB);
    }, 60_000);
  }

  it("five parallel uploads still decode one at a time (no fivefold peak)", async () => {
    const gate = new ImageProcessingGate(1, 4);
    const img = await textured(4000, 3000, "png");
    let active = 0;
    let maxActive = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        gate.run(async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          try {
            return await inspectImage(img, "image/png");
          } finally {
            active--;
          }
        }),
      ),
    );
    expect(maxActive).toBe(1);
    const m = gate.snapshot();
    console.log(
      `image memory: 5 x 12 MP in parallel -> max RSS growth per run ${(m.maxRssDeltaBytes / MB).toFixed(0)} MB, ` +
        `peak RSS ${(m.peakRssBytes / MB).toFixed(0)} MB`,
    );
    expect(m.processed).toBe(5);
  }, 120_000);
});
