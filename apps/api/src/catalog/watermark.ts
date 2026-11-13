/**
 * Server-side watermark of lead-gated documents (DP-043; ADR-016 D6), registered for
 * `LEAD_REQUIRED` in the ADR-014 D8 stamper seam.
 *
 * Every page gets one small footer line along the visible bottom edge (page rotation and crop box
 * respected) and the document metadata names the request reference:
 *
 *   Prepared for <name> (<company>) · <UTC date> · Ref <reference> · Dream Petroleum BV
 *
 * The e-mail address is not printed (data minimisation). The standard Helvetica font only encodes
 * WinAnsi characters: other letters lose their diacritics or become "?" (the reference still
 * identifies the request). The revision file itself is never changed; the delivered bytes are a
 * re-serialised copy. Any failure fails the download (no unstamped fallback).
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from "pdf-lib";
import type { DeliveryContext, DocumentStamper } from "./document-delivery.js";

const FONT_SIZE = 7;
const MIN_FONT_SIZE = 4.5;
const MARGIN = 14;
const PUBLISHER = "Dream Petroleum BV";

const FALLBACK: Readonly<Record<string, string>> = {
  ı: "i",
  İ: "I",
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  ø: "o",
  Ø: "O",
  ß: "ss",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
};

/** Text the font can encode: as is, without diacritics, a fallback letter, or "?". */
export function encodableText(text: string, font: Pick<PDFFont, "getCharacterSet">): string {
  const set = new Set(font.getCharacterSet());
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (set.has(cp)) {
      out += ch;
      continue;
    }
    const base = ch.normalize("NFKD").replace(/\p{M}/gu, "");
    if (base !== "" && [...base].every((c) => set.has(c.codePointAt(0) ?? 0))) {
      out += base;
    } else {
      const fb = FALLBACK[ch];
      out += fb ?? "?";
    }
  }
  return out;
}

/** The footer in two parts: the recipient (may be shortened) and the fixed rest. */
export function watermarkParts(ctx: DeliveryContext): { recipient: string; rest: string } {
  if (!ctx.grant) throw new Error("watermark: a lead download needs its grant");
  const date = ctx.deliveredAt.toISOString().slice(0, 10);
  return {
    recipient: ctx.grant.recipientLabel,
    rest: ` · ${date} UTC · Ref ${ctx.grant.reference} · ${PUBLISHER}`,
  };
}

export function watermarkLine(ctx: DeliveryContext): string {
  const { recipient, rest } = watermarkParts(ctx);
  return `Prepared for ${recipient}${rest}`;
}

type Measure = Pick<PDFFont, "widthOfTextAtSize">;

/** Smaller type first, then a shortened recipient; the date, reference and publisher stay. */
export function fitLine(
  recipient: string,
  rest: string,
  font: Measure,
  maxWidth: number,
): { text: string; size: number } {
  const line = (r: string) => `Prepared for ${r}${rest}`;
  let size = FONT_SIZE;
  while (size > MIN_FONT_SIZE && font.widthOfTextAtSize(line(recipient), size) > maxWidth) {
    size -= 0.5;
  }
  let r = recipient;
  while (r.length > 1 && font.widthOfTextAtSize(line(r), size) > maxWidth) {
    r = `${r.slice(0, -2).trimEnd()}…`;
  }
  return { text: line(r), size };
}

export const LEAD_WATERMARK_STAMPER: DocumentStamper = {
  name: "lead-watermark",
  async stamp(pdf: Buffer, ctx: DeliveryContext): Promise<Buffer> {
    const parts = watermarkParts(ctx);
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const recipient = encodableText(parts.recipient, font);
    const rest = encodableText(parts.rest, font);
    const color = rgb(0.38, 0.38, 0.4);
    for (const page of doc.getPages()) {
      const box = page.getCropBox();
      const angle = ((page.getRotation().angle % 360) + 360) % 360;
      const horizontal = angle === 0 || angle === 180;
      const width = horizontal ? box.width : box.height;
      const { text, size } = fitLine(recipient, rest, font, width - 2 * MARGIN);
      // Start of the line at the visible bottom-left corner, running along the visible bottom.
      const at =
        angle === 90
          ? { x: box.x + box.width - MARGIN, y: box.y + MARGIN }
          : angle === 180
            ? { x: box.x + box.width - MARGIN, y: box.y + box.height - MARGIN }
            : angle === 270
              ? { x: box.x + MARGIN, y: box.y + box.height - MARGIN }
              : { x: box.x + MARGIN, y: box.y + MARGIN };
      page.drawText(text, {
        ...at,
        size,
        font,
        color,
        opacity: 0.9,
        rotate: degrees(angle),
      });
    }
    const grant = ctx.grant as NonNullable<DeliveryContext["grant"]>;
    doc.setSubject(encodableText(`Prepared for ${grant.recipientLabel}`, font));
    doc.setKeywords([`ref:${grant.reference}`, `revision:${ctx.revisionNumber}`]);
    doc.setProducer(PUBLISHER);
    doc.setModificationDate(ctx.deliveredAt);
    return Buffer.from(await doc.save({ useObjectStreams: false }));
  },
};
