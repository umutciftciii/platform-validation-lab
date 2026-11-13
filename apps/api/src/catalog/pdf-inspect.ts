/**
 * Content check of an uploaded PDF (PM-5, DP-035). The declared type is never trusted; the bytes
 * must be a complete, unencrypted PDF without active content. Rejected, never repaired:
 *
 *  - not a PDF: no `%PDF-1.x`/`%PDF-2.0` signature at byte 0, or no `%%EOF` near the end;
 *  - encrypted (`/Encrypt`): the API could not inspect it and the sites could not watermark it;
 *  - active or embedded content: JavaScript (`/JavaScript`, `/JS`), launch and remote actions
 *    (`/Launch`, `/GoToR`, `/GoToE`), form submission or import (`/SubmitForm`, `/ImportData`),
 *    automatic actions (`/AA`), embedded files (`/EmbeddedFile(s)`, `/FileAttachment`),
 *    `/RichMedia` and XFA forms (`/XFA`);
 *  - too complex to inspect: an object stream with a filter other than Flate, or more inflated
 *    data than the inspection budget allows (decompression bombs).
 *
 * How: PDF names are read as tokens and their `#xx` escapes decoded, so `/Java#53cript` is
 * `/JavaScript`. Dictionaries live outside stream bodies or inside object streams (`/ObjStm`,
 * PDF 1.5); both are scanned, object streams after inflating them under a byte budget. Other
 * stream bodies (page content, fonts, images) are binary data and skipped, so random bytes in an
 * image cannot look like a forbidden name. This is a structural filter, not an antivirus or a
 * full parser (ADR-014; content disarm and malware scanning: DP-014/R-20).
 */
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

export type PdfFailure = "empty" | "not_pdf" | "encrypted" | "active_content" | "too_complex";

export class PdfRejected extends Error {
  override name = "PdfRejected";
  constructor(
    readonly reason: PdfFailure,
    /** The forbidden name found (active_content), for the audit trail; never user text. */
    readonly detail?: string,
  ) {
    super(detail ? `${reason}:${detail}` : reason);
  }
}

export interface PdfInfo {
  sha256: string;
  byteSize: number;
  pdfVersion: string;
  /** Number of page objects found; null when none could be counted (still a valid PDF). */
  pageCount: number | null;
}

/** Names that make a PDF active or carry other files. Compared after `#xx` decoding. */
export const FORBIDDEN_NAMES: ReadonlySet<string> = new Set([
  "JavaScript",
  "JS",
  "Launch",
  "GoToR",
  "GoToE",
  "SubmitForm",
  "ImportData",
  "AA",
  "EmbeddedFile",
  "EmbeddedFiles",
  "FileAttachment",
  "RichMedia",
  "XFA",
]);

/** Inflated bytes of object streams inspected at most (sum over the file). */
export const INFLATE_BUDGET_BYTES = 64 * 1024 * 1024;
const MAX_OBJECT_STREAMS = 20_000;
const HEADER = /^%PDF-([12]\.[0-9])/;

/** Every PDF name token of a text, with `#xx` escapes decoded. */
export function pdfNames(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\/([^\s/[\]<>(){}%\0]+)/g)) {
    out.push(
      (m[1] as string).replace(/#([0-9a-fA-F]{2})/g, (_, h: string) =>
        String.fromCharCode(parseInt(h, 16)),
      ),
    );
  }
  return out;
}

interface StreamRange {
  /** Offset of the `stream` keyword. */
  keyword: number;
  /** First byte of the stream body. */
  start: number;
  /** Offset of `endstream` (exclusive end of the body). */
  end: number;
}

/** Stream bodies of the file, in order. A body without `endstream` runs to the end. */
function streamRanges(text: string): StreamRange[] {
  const ranges: StreamRange[] = [];
  const re = /(?<![a-z])stream(\r\n|\n|\r)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const endIdx = text.indexOf("endstream", start);
    const end = endIdx === -1 ? text.length : endIdx;
    ranges.push({ keyword: m.index, start, end });
    re.lastIndex = end;
  }
  return ranges;
}

/** The stream's dictionary: from the preceding `obj` keyword (at most 4 KB back). */
function dictionaryBefore(text: string, keyword: number): string {
  const from = Math.max(0, keyword - 4096);
  const window = text.slice(from, keyword);
  const obj = window.lastIndexOf("obj");
  return obj === -1 ? window : window.slice(obj);
}

function normalized(dict: string): string {
  return pdfNames(dict).join(" ");
}

function checkNames(text: string): void {
  for (const name of pdfNames(text)) {
    if (name === "Encrypt") throw new PdfRejected("encrypted");
    if (FORBIDDEN_NAMES.has(name)) throw new PdfRejected("active_content", name);
  }
}

function countPages(text: string): number {
  let n = 0;
  const names = pdfNames(text);
  for (let i = 0; i < names.length - 1; i++) {
    if (names[i] === "Type" && names[i + 1] === "Page") n++;
  }
  return n;
}

/**
 * Checks one uploaded PDF. Throws PdfRejected; returns the facts stored with the revision.
 * The input is at most DOCUMENT_MAX_BYTES (the controller streams it with that cap).
 */
export function inspectPdf(data: Buffer): PdfInfo {
  if (data.length === 0) throw new PdfRejected("empty");
  // latin1 maps every byte to one character, so offsets in the text are byte offsets.
  const text = data.toString("latin1");
  const header = HEADER.exec(text.slice(0, 16));
  if (!header) throw new PdfRejected("not_pdf");
  if (!text.slice(-1024).includes("%%EOF")) throw new PdfRejected("not_pdf");

  const ranges = streamRanges(text);
  if (ranges.length > MAX_OBJECT_STREAMS * 10) throw new PdfRejected("too_complex");

  // 1. Everything outside stream bodies: object dictionaries, trailers, the catalogue.
  const outside: string[] = [];
  let pos = 0;
  for (const r of ranges) {
    outside.push(text.slice(pos, r.start));
    pos = r.end;
  }
  outside.push(text.slice(pos));
  const syntax = outside.join("\n");
  checkNames(syntax);
  let pages = countPages(syntax);

  // 2. Object streams (PDF 1.5+): dictionaries compressed inside a stream.
  let budget = INFLATE_BUDGET_BYTES;
  let objectStreams = 0;
  for (const r of ranges) {
    const dict = normalized(dictionaryBefore(text, r.keyword));
    if (!/\bType ObjStm\b/.test(dict)) continue;
    if (++objectStreams > MAX_OBJECT_STREAMS) throw new PdfRejected("too_complex");
    const body = data.subarray(r.start, r.end);
    let content: string;
    if (!/\bFilter\b/.test(dict)) {
      content = body.toString("latin1");
    } else if (
      /\bFilter FlateDecode\b/.test(dict) &&
      !/\bFilter FlateDecode \w+Decode\b/.test(dict)
    ) {
      let inflated: Buffer;
      try {
        inflated = inflateSync(body, { maxOutputLength: Math.max(1, budget) });
      } catch {
        // Over the budget (ERR_BUFFER_TOO_LARGE) or damaged: not inspected, so not accepted.
        throw new PdfRejected("too_complex");
      }
      budget -= inflated.length;
      if (budget <= 0) throw new PdfRejected("too_complex");
      content = inflated.toString("latin1");
    } else {
      // Any other filter (LZW, ASCII85, chained filters): not inspected, so not accepted.
      throw new PdfRejected("too_complex");
    }
    checkNames(content);
    pages += countPages(content);
  }

  return {
    sha256: createHash("sha256").update(data).digest("hex"),
    byteSize: data.length,
    pdfVersion: header[1] as string,
    pageCount: pages > 0 ? pages : null,
  };
}

/** A PDF file name for display: sanitised elsewhere; this only enforces the `.pdf` suffix. */
export function pdfFilename(name: string): string {
  return /\.pdf$/i.test(name) ? name : `${name.slice(0, 251)}.pdf`;
}
