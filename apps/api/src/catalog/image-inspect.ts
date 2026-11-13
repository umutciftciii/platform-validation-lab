/**
 * Upload checks of product images (PM-2), before anything is stored:
 *
 *  1. the real type from the first bytes (magic bytes): JPEG, PNG or WebP only. SVG, HTML,
 *     executables and everything else are refused, whatever the declared Content-Type says, and
 *     the declared type must match the detected one;
 *  2. the dimensions from the header only (no decode): at least 800×600, at most 10 000 px per
 *     side and 25 MP in total — a pixel bomb is refused before any pixel is decoded;
 *  3. a full decode while deriving the WebP variants (display ≤ 1600 px, thumb ≤ 480 px), with
 *     libvips' own pixel limit as a second line; a truncated or corrupt file fails here.
 *
 * The original bytes are kept unchanged and private; the variants are re-encoded WebP without any
 * metadata (libvips writes no EXIF, XMP, IPTC or ICC unless asked to; `keepMetadata` and
 * `withMetadata` are never called), so GPS positions, camera and author data of an upload never
 * reach a public page (PM-3; tested). Nothing from the file is ever executed or interpreted
 * beyond image decoding.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  IMAGE_MAX_PIXELS,
  IMAGE_MAX_SIDE,
  IMAGE_MIN_HEIGHT,
  IMAGE_MIN_WIDTH,
  type ImageMimeType,
} from "@dream/contracts";

sharp.cache(false);
sharp.concurrency(1);

export type InspectFailure =
  "unsupported_type" | "type_mismatch" | "too_small" | "too_many_pixels" | "corrupt";

export class ImageRejected extends Error {
  override name = "ImageRejected";
  constructor(readonly reason: InspectFailure) {
    super(reason);
  }
}

/** The real image type from the leading bytes, or null. */
export function detectImageType(buf: Buffer): ImageMimeType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Dimensions straight from a PNG's IHDR chunk (fixed position), without any decoder: an extreme
 * header is refused as a pixel bomb before libvips sees the file.
 */
export function pngHeaderSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const tooManyPixels = (w: number, h: number) =>
  w > IMAGE_MAX_SIDE || h > IMAGE_MAX_SIDE || w * h > IMAGE_MAX_PIXELS;

export interface Variant {
  data: Buffer;
  width: number;
  height: number;
}

export interface InspectedImage {
  mimeType: ImageMimeType;
  width: number;
  height: number;
  sha256: string;
  display: Variant;
  thumb: Variant;
}

const SHARP_OPTIONS = { limitInputPixels: IMAGE_MAX_PIXELS, failOn: "error" as const, pages: 1 };

async function derive(buf: Buffer, side: number, quality: number): Promise<Variant> {
  const { data, info } = await sharp(buf, SHARP_OPTIONS)
    .rotate()
    .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function inspectImage(buf: Buffer, declared: string): Promise<InspectedImage> {
  const mimeType = detectImageType(buf);
  if (!mimeType) throw new ImageRejected("unsupported_type");
  if (declared.split(";")[0]?.trim().toLowerCase() !== mimeType) {
    throw new ImageRejected("type_mismatch");
  }
  if (mimeType === "image/png") {
    const header = pngHeaderSize(buf);
    if (header && tooManyPixels(header.width, header.height)) {
      throw new ImageRejected("too_many_pixels");
    }
  }
  let width: number | undefined;
  let height: number | undefined;
  try {
    // Header only; libvips does not decode pixels for metadata().
    const meta = await sharp(buf, { ...SHARP_OPTIONS, limitInputPixels: false }).metadata();
    width = meta.autoOrient?.width ?? meta.width;
    height = meta.autoOrient?.height ?? meta.height;
  } catch {
    throw new ImageRejected("corrupt");
  }
  if (!width || !height) throw new ImageRejected("corrupt");
  if (tooManyPixels(width, height)) throw new ImageRejected("too_many_pixels");
  if (width < IMAGE_MIN_WIDTH || height < IMAGE_MIN_HEIGHT) throw new ImageRejected("too_small");
  let display: Variant;
  let thumb: Variant;
  try {
    display = await derive(buf, 1600, 82);
    // PM-3: the thumbnail comes from the (already oriented) display variant, so the full-size
    // original is decoded once per upload, not twice (memory and time; image-gate.ts).
    thumb = await derive(display.data, 480, 78);
  } catch {
    throw new ImageRejected("corrupt");
  }
  return {
    mimeType,
    width,
    height,
    sha256: createHash("sha256").update(buf).digest("hex"),
    display,
    thumb,
  };
}

/**
 * A safe display name for an uploaded file: the last path segment of the percent-decoded header,
 * Unicode-normalised, without control characters, slashes or backslashes, at most 255 characters.
 * It is shown to staff only and never used to build a path or key.
 */
export function sanitizeFilename(raw: string | undefined | null): string {
  let name = raw ?? "";
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep the raw value; it is sanitised below
  }
  name = name.normalize("NFKC");
  name = name.split(/[/\\]/).pop() ?? "";
  name = Array.from(name)
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c > 0x1f && (c < 0x7f || c > 0x9f); // no C0/C1 control characters
    })
    .join("")
    .replace(/^\.+/, "")
    .trim();
  if (name.length > 255) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
    name = name.slice(0, 255 - ext.length) + ext;
  }
  return name || "image";
}
