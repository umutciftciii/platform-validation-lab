// PM-2: upload checks — magic bytes, declared type, dimensions, pixel bombs, corrupt files,
// variants and file name sanitisation.
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  detectImageType,
  ImageRejected,
  inspectImage,
  sanitizeFilename,
} from "../../../src/catalog/image-inspect.js";

function make(w: number, h: number, format: "jpeg" | "png" | "webp"): Promise<Buffer> {
  const img = sharp({
    create: { width: w, height: h, channels: 3, background: { r: 11, g: 93, b: 107 } },
  });
  return (format === "jpeg" ? img.jpeg() : format === "png" ? img.png() : img.webp()).toBuffer();
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A valid PNG header claiming w×h pixels with almost no data: a pixel bomb. */
function pngBomb(w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(1024))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const reason = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof ImageRejected ? e.reason : `other: ${String(e)}`;
  }
  return "accepted";
};

describe("image inspection", () => {
  it("detects JPEG, PNG and WebP by their bytes only", async () => {
    expect(detectImageType(await make(10, 10, "jpeg"))).toBe("image/jpeg");
    expect(detectImageType(await make(10, 10, "png"))).toBe("image/png");
    expect(detectImageType(await make(10, 10, "webp"))).toBe("image/webp");
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageType(Buffer.from("MZ\x90\x00executable"))).toBeNull();
    expect(detectImageType(Buffer.from("GIF89a"))).toBeNull();
  });

  it("accepts a valid image and derives smaller WebP variants", async () => {
    for (const f of ["jpeg", "png", "webp"] as const) {
      const out = await inspectImage(await make(2400, 1800, f), `image/${f}`);
      expect(out).toMatchObject({ mimeType: `image/${f}`, width: 2400, height: 1800 });
      expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(out.display).toMatchObject({ width: 1600, height: 1200 });
      expect(out.thumb).toMatchObject({ width: 480, height: 360 });
      expect(detectImageType(out.display.data)).toBe("image/webp");
    }
  });

  it("refuses SVG, executables and a declared type that lies", async () => {
    expect(await reason(inspectImage(Buffer.from("<svg onload=alert(1)>"), "image/svg+xml"))).toBe(
      "unsupported_type",
    );
    expect(await reason(inspectImage(Buffer.from("<svg/>"), "image/png"))).toBe("unsupported_type");
    expect(await reason(inspectImage(Buffer.from("MZ\x90\x00"), "image/jpeg"))).toBe(
      "unsupported_type",
    );
    expect(await reason(inspectImage(await make(900, 700, "png"), "image/jpeg"))).toBe(
      "type_mismatch",
    );
  });

  it("refuses images below 800×600 and pixel bombs before decoding", async () => {
    expect(await reason(inspectImage(await make(799, 600, "jpeg"), "image/jpeg"))).toBe(
      "too_small",
    );
    expect(await reason(inspectImage(await make(800, 599, "png"), "image/png"))).toBe("too_small");
    expect(await reason(inspectImage(await make(800, 600, "png"), "image/png"))).toBe("accepted");
    expect(await reason(inspectImage(pngBomb(30_000, 30_000), "image/png"))).toBe(
      "too_many_pixels",
    );
    expect(await reason(inspectImage(pngBomb(6000, 6000), "image/png"))).toBe("too_many_pixels");
    expect(await reason(inspectImage(pngBomb(12_000, 800), "image/png"))).toBe("too_many_pixels");
  });

  it("refuses truncated and corrupt files", async () => {
    const jpeg = await make(1200, 900, "jpeg");
    expect(await reason(inspectImage(jpeg.subarray(0, 200), "image/jpeg"))).toBe("corrupt");
    const png = await make(1200, 900, "png");
    const broken = Buffer.from(png);
    broken.fill(0xab, 60, broken.length - 20);
    expect(await reason(inspectImage(broken, "image/png"))).toBe("corrupt");
    expect(await reason(inspectImage(pngBomb(1000, 800), "image/png"))).toBe("corrupt");
  });
});

describe("file name sanitisation", () => {
  it("keeps a safe display name only", () => {
    expect(sanitizeFilename("ICCSYN%206%20drum.jpg")).toBe("ICCSYN 6 drum.jpg");
    expect(sanitizeFilename("..%2F..%2Fetc%2Fpasswd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\x\\photo.png")).toBe("photo.png");
    expect(sanitizeFilename("bad\u0000name\u0007.webp")).toBe("badname.webp");
    expect(sanitizeFilename(".hidden")).toBe("hidden");
    expect(sanitizeFilename("%E0%A4%A")).toBe("%E0%A4%A");
    expect(sanitizeFilename(undefined)).toBe("image");
    expect(sanitizeFilename("x".repeat(400) + ".jpeg")).toHaveLength(255);
    expect(sanitizeFilename("x".repeat(400) + ".jpeg").endsWith(".jpeg")).toBe(true);
  });
});

// PM-3: public images are the derived variants; they must carry no metadata of the upload.
describe("variants carry no metadata (PM-3 image safety)", () => {
  it("drops EXIF (GPS, camera, author), XMP and ICC from both variants", async () => {
    const withMeta = await sharp({
      create: { width: 1200, height: 900, channels: 3, background: { r: 200, g: 120, b: 40 } },
    })
      .jpeg()
      .withExif({
        IFD0: { Artist: "Jane Photographer", Copyright: "Secret Studio", Make: "Cam", Model: "X1" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "52/1 22/1 0/1" },
      })
      .withXmp(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="Jane"/></rdf:RDF></x:xmpmeta>',
      )
      .withIccProfile("p3")
      .toBuffer();
    const source = await sharp(withMeta).metadata();
    expect(source.exif?.length ?? 0).toBeGreaterThan(0);
    expect(source.xmp?.length ?? 0).toBeGreaterThan(0);
    const out = await inspectImage(withMeta, "image/jpeg");
    for (const v of [out.display, out.thumb]) {
      const m = await sharp(v.data).metadata();
      expect(m.format).toBe("webp");
      expect(m.exif).toBeUndefined();
      expect(m.xmp).toBeUndefined();
      expect(m.iptc).toBeUndefined();
      expect(m.icc).toBeUndefined();
      expect(v.data.includes(Buffer.from("Jane"))).toBe(false);
      expect(v.data.includes(Buffer.from("Secret Studio"))).toBe(false);
    }
    expect(out.thumb.width).toBeLessThanOrEqual(480);
  });
});
