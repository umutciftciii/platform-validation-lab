// PM-5: small, valid PDF files for the document tests (correct cross-reference table, so a
// browser renders them), with switches for the cases the upload check must refuse.
import { deflateSync } from "node:zlib";

export interface PdfOptions {
  /** Text shown on every page. */
  text?: string;
  pages?: number;
  /** Raw entries added to the document catalogue, e.g. "/OpenAction 9 0 R". */
  catalogExtra?: string;
  /** Extra indirect objects, numbered from 20 on, as "<< ... >>" bodies. */
  extraObjects?: string[];
  /** Objects packed into a Flate-compressed object stream (PDF 1.5), as "<< ... >>" bodies. */
  objectStream?: string[];
  /** Filter of the object stream (default FlateDecode, the only one that is inspected). */
  objectStreamFilter?: string;
  /** Adds an /Encrypt entry to the trailer (the dictionary itself is a stub). */
  encrypted?: boolean;
  /** Bytes appended inside an image XObject stream (binary content is never scanned). */
  binaryImage?: Buffer;
  version?: string;
}

/** A PDF as a Buffer. Offsets are bytes; the content is ASCII except the binary image. */
export function makePdf(o: PdfOptions = {}): Buffer {
  const pages = o.pages ?? 1;
  const text = (o.text ?? "Dream Petroleum test document").replace(/[()\\]/g, "");
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (b: Buffer | string) => {
    const buf = typeof b === "string" ? Buffer.from(b, "latin1") : b;
    parts.push(buf);
    size += buf.length;
  };
  const obj = (n: number, body: Buffer | string) => {
    offsets[n] = size;
    push(`${n} 0 obj\n`);
    push(body);
    push("\nendobj\n");
  };
  push(`%PDF-${o.version ?? "1.7"}\n%\xe2\xe3\xcf\xd3\n`);

  const pageIds = Array.from({ length: pages }, (_, i) => 3 + i * 2);
  obj(1, `<< /Type /Catalog /Pages 2 0 R ${o.catalogExtra ?? ""} >>`);
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(" ")}] /Count ${pages} >>`);
  const fontId = 3 + pages * 2;
  const imageId = fontId + 1;
  for (const [i, id] of pageIds.entries()) {
    const content = `BT /F1 18 Tf 72 720 Td (${text} - page ${i + 1}) Tj ET`;
    const xobj = o.binaryImage ? ` /XObject << /Im1 ${imageId} 0 R >>` : "";
    obj(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${id + 1} 0 R /Resources << /Font << /F1 ${fontId} 0 R >>${xobj} >> >>`,
    );
    obj(id + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  obj(fontId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let next = imageId;
  if (o.binaryImage) {
    obj(
      imageId,
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${o.binaryImage.length} >>\nstream\n`,
          "latin1",
        ),
        o.binaryImage,
        Buffer.from("\nendstream", "latin1"),
      ]),
    );
    next = imageId + 1;
  }
  for (const body of o.extraObjects ?? []) obj(next++, body);
  if (o.objectStream?.length) {
    const nums = o.objectStream.map((_, i) => 100 + i);
    let header = "";
    let bodies = "";
    for (const [i, body] of o.objectStream.entries()) {
      header += `${nums[i]} ${bodies.length} `;
      bodies += `${body}\n`;
    }
    const raw = Buffer.from(header + bodies, "latin1");
    const filter = o.objectStreamFilter ?? "/FlateDecode";
    const data = filter === "/FlateDecode" ? deflateSync(raw) : raw;
    obj(
      next++,
      Buffer.concat([
        Buffer.from(
          `<< /Type /ObjStm /N ${nums.length} /First ${header.length} /Filter ${filter} /Length ${data.length} >>\nstream\n`,
          "latin1",
        ),
        data,
        Buffer.from("\nendstream", "latin1"),
      ]),
    );
  }
  if (o.encrypted) obj(next++, "<< /Filter /Standard /V 2 /R 3 /O <00> /U <00> /P -4 >>");
  const count = offsets.length;
  const xref = size;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) {
    push(`${String(offsets[i] ?? 0).padStart(10, "0")} 00000 ${offsets[i] ? "n" : "f"} \n`);
  }
  const enc = o.encrypted ? ` /Encrypt ${count - 1} 0 R` : "";
  push(`trailer\n<< /Size ${count} /Root 1 0 R${enc} >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}
