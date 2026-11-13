// PM-5 (DP-035): the PDF upload check — signature, structure, encryption, active content (also
// hidden behind name escapes or inside compressed object streams), decompression bombs, and no
// false alarm on binary stream content.
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_NAMES,
  INFLATE_BUDGET_BYTES,
  inspectPdf,
  PdfRejected,
  pdfFilename,
  pdfNames,
} from "../../../src/catalog/pdf-inspect.js";
import { makePdf } from "../../fixtures/pdf.js";

function rejection(data: Buffer): PdfRejected {
  try {
    inspectPdf(data);
  } catch (e) {
    if (e instanceof PdfRejected) return e;
    throw e;
  }
  throw new Error("expected the PDF to be rejected");
}

describe("inspectPdf: accepted files", () => {
  it("accepts a plain PDF and reports its facts", () => {
    const pdf = makePdf({ pages: 3 });
    const info = inspectPdf(pdf);
    expect(info.byteSize).toBe(pdf.length);
    expect(info.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(info.pdfVersion).toBe("1.7");
    expect(info.pageCount).toBe(3);
  });

  it("accepts PDF 2.0 and ordinary actions and links (URI, OpenAction to a page)", () => {
    const pdf = makePdf({
      version: "2.0",
      catalogExtra: "/OpenAction [3 0 R /Fit] /URI << /Base (https://example.com/) >>",
      extraObjects: ["<< /Type /Annot /Subtype /Link /A << /S /URI /URI (https://dp.test) >> >>"],
    });
    expect(inspectPdf(pdf).pdfVersion).toBe("2.0");
  });

  it("does not read binary stream bodies (random image bytes cannot look like /JS)", () => {
    // A body full of forbidden names would be refused if it were scanned as syntax.
    const noise = Buffer.concat([
      randomBytes(4096),
      Buffer.from(" /JS /JavaScript /Launch /AA ", "latin1"),
      randomBytes(4096),
    ]);
    expect(() => inspectPdf(makePdf({ binaryImage: noise }))).not.toThrow();
  });

  it("scans an object stream and counts its pages", () => {
    const pdf = makePdf({ objectStream: ["<< /Type /Page /Parent 2 0 R >>", "<< /Kind /Note >>"] });
    expect(inspectPdf(pdf).pageCount).toBe(2);
  });
});

describe("inspectPdf: refused files", () => {
  it("refuses empty and non-PDF data (signature at byte 0, %%EOF at the end)", () => {
    expect(rejection(Buffer.alloc(0)).reason).toBe("empty");
    expect(rejection(Buffer.from("<html>%PDF-1.7</html>")).reason).toBe("not_pdf");
    expect(rejection(Buffer.concat([Buffer.from(" "), makePdf()])).reason).toBe("not_pdf");
    const truncated = makePdf().subarray(0, 300);
    expect(rejection(truncated).reason).toBe("not_pdf");
    expect(rejection(Buffer.from("\x89PNG\r\n\x1a\n", "latin1")).reason).toBe("not_pdf");
  });

  it("refuses an encrypted PDF", () => {
    expect(rejection(makePdf({ encrypted: true })).reason).toBe("encrypted");
  });

  it.each([...FORBIDDEN_NAMES])("refuses /%s in the document syntax", (name) => {
    const e = rejection(makePdf({ extraObjects: [`<< /S /${name} /X (y) >>`] }));
    expect(e.reason).toBe("active_content");
    expect(e.detail).toBe(name);
  });

  it("refuses JavaScript hidden behind #xx name escapes", () => {
    const e = rejection(
      makePdf({ catalogExtra: "/OpenAction << /S /Java#53cript /J#53 (app.alert(1)) >>" }),
    );
    expect(e.reason).toBe("active_content");
    expect(e.detail).toBe("JavaScript");
  });

  it("refuses JavaScript inside a compressed object stream", () => {
    const e = rejection(
      makePdf({ objectStream: ["<< /Type /Action /S /JavaScript /JS (app.alert(1)) >>"] }),
    );
    expect(e.reason).toBe("active_content");
  });

  it("refuses embedded files and launch actions in object streams", () => {
    expect(rejection(makePdf({ objectStream: ["<< /EmbeddedFiles << >> >>"] })).reason).toBe(
      "active_content",
    );
    expect(rejection(makePdf({ objectStream: ["<< /S /Launch /F (cmd.exe) >>"] })).reason).toBe(
      "active_content",
    );
  });

  it("refuses object streams it cannot inspect (other or chained filters, damaged data)", () => {
    expect(
      rejection(makePdf({ objectStream: ["<< /A 1 >>"], objectStreamFilter: "/LZWDecode" })).reason,
    ).toBe("too_complex");
    expect(
      rejection(
        makePdf({
          objectStream: ["<< /A 1 >>"],
          objectStreamFilter: "[/ASCII85Decode /FlateDecode]",
        }),
      ).reason,
    ).toBe("too_complex");
    const damaged = makePdf({ objectStream: ["<< /A 1 >>"] });
    const at = damaged.indexOf("/Type /ObjStm");
    const body = damaged.indexOf("stream\n", at) + "stream\n".length;
    damaged.fill(0x41, body, body + 8); // break the zlib header
    expect(rejection(damaged).reason).toBe("too_complex");
  });

  it("refuses a decompression bomb (inflated object streams over the budget)", () => {
    const bomb = Buffer.alloc(INFLATE_BUDGET_BYTES + 1024, 0x20);
    const deflated = deflateSync(bomb, { level: 9 });
    expect(deflated.length).toBeLessThan(1024 * 1024);
    // Build by hand: an object stream whose body is the bomb.
    const head = makePdf()
      .toString("latin1")
      .replace(/xref[\s\S]*$/, "");
    const obj = Buffer.concat([
      Buffer.from(
        `90 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${deflated.length} >>\nstream\n`,
        "latin1",
      ),
      deflated,
      Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"),
    ]);
    expect(rejection(Buffer.concat([Buffer.from(head, "latin1"), obj])).reason).toBe("too_complex");
  });
});

describe("pdf names and file names", () => {
  it("decodes #xx escapes in name tokens", () => {
    expect(pdfNames("<< /Type /Ja#76a#53cript /A#41 >>")).toEqual(["Type", "JavaScript", "AA"]);
  });
  it("keeps a .pdf suffix", () => {
    expect(pdfFilename("TDS ICCSYN 6.pdf")).toBe("TDS ICCSYN 6.pdf");
    expect(pdfFilename("TDS ICCSYN 6.PDF")).toBe("TDS ICCSYN 6.PDF");
    expect(pdfFilename("sheet")).toBe("sheet.pdf");
    expect(pdfFilename("x".repeat(255)).length).toBe(255);
  });
});
