/**
 * QR code of the authenticator setup URI, drawn in the browser (DP-114). The TOTP secret is never
 * sent to a QR service or any other server: `uqr` (MIT, no dependencies) only computes the module
 * matrix, and the page draws it as one SVG path.
 */
import { encode } from "uqr";

export interface QrPath {
  /** Modules per side, including the quiet zone. */
  size: number;
  /** SVG path with one 1×1 square per dark module. */
  d: string;
}

/** Error correction M; a quiet zone of four modules, as the QR standard asks for. */
export function qrPath(text: string): QrPath {
  const qr = encode(text, { ecc: "M", border: 4 });
  const parts: string[] = [];
  qr.data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      // Merge a run of dark modules into one rectangle: a much shorter path.
      let end = x;
      while (end < row.length && row[end]) end++;
      parts.push(`M${x} ${y}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  });
  return { size: qr.data.length, d: parts.join("") };
}
