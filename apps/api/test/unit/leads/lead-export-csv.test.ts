// DP-227 / DP-229: CSV encoding of the lead export (RFC 4180 with ; or , separators, BOM,
// formula injection, Amsterdam dates).
import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  csvCell,
  csvDateTime,
  csvLine,
  dayEnd,
  dayStart,
  exportFilename,
  isCalendarDay,
  neutraliseFormula,
} from "../../../src/leads/lead-export-csv.js";
import { ApiError } from "../../../src/iam/http/api-error.js";
import { exportSeparator } from "../../../src/leads/lead-export.service.js";

describe("cells", () => {
  it("quotes every cell and doubles quotes inside", () => {
    expect(csvCell("plain")).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("line 1\nline 2\r\nline 3")).toBe('"line 1\nline 2\r\nline 3"');
    expect(csvCell("")).toBe('""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it("keeps Turkish and other non-ASCII characters as they are", () => {
    const text = "Şükrü Çağlar-İnce, Güneş Yağ Ltd. Şti. ığüşöç ĞÜŞİÖÇ é ß 中文";
    expect(csvCell(text)).toBe(`"${text}"`);
    expect(CSV_BOM).toBe("﻿");
    expect(Buffer.from(CSV_BOM, "utf8")).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it("neutralises formula starts (=, +, -, @, tab, CR), also after leading spaces", () => {
    for (const v of [
      "=1+1",
      '=HYPERLINK("http://evil","x")',
      "+31 6 1234",
      "-2+3",
      "@SUM(A1)",
      "\t=1",
      "\r=1",
      "  =cmd|' /C calc'!A0",
      "\u00A0=1",
    ]) {
      expect(neutraliseFormula(v)).toBe(`'${v}`);
    }
    for (const v of ["a=1", "Ltd. (=)", "info@firma.example", "1-2", "", "  text"]) {
      expect(neutraliseFormula(v)).toBe(v);
    }
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });

  it("joins a line with the chosen separator and ends it with CRLF (DP-229)", () => {
    expect(csvLine(["a", 'b"c', "=d", null], ",")).toBe(`"a","b""c","'=d",""\r\n`);
    expect(csvLine(["a", 'b"c', "=d", null], ";")).toBe(`"a";"b""c";"'=d";""\r\n`);
  });
});

/**
 * A strict RFC 4180 reader with a configurable separator, as Excel (Data > From Text/CSV, or a
 * double click with a `;` locale), LibreOffice and Python's csv module read a quoted file: a quoted
 * cell ends only at `"` followed by the separator, CRLF or the end. Any stray character after a
 * closing quote fails the test, so a cell can never spill into its neighbour unnoticed.
 */
function parseCsv(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  for (;;) {
    if (text[i] !== '"') throw new Error(`unquoted cell at ${i}`);
    i += 1;
    let cell = "";
    for (;;) {
      const quote = text.indexOf('"', i);
      if (quote < 0) throw new Error("unterminated cell");
      cell += text.slice(i, quote);
      if (text[quote + 1] === '"') {
        cell += '"';
        i = quote + 2;
        continue;
      }
      i = quote + 1;
      break;
    }
    row.push(cell);
    if (text[i] === separator) {
      i += 1;
      continue;
    }
    if (text.startsWith("\r\n", i)) {
      rows.push(row);
      row = [];
      i += 2;
      if (i === text.length) return rows;
      continue;
    }
    throw new Error(`stray character ${JSON.stringify(text[i])} at ${i}`);
  }
}

describe("separator (DP-229)", () => {
  const tricky = [
    "Lead; with semicolon",
    "Comma, Inc.",
    'He said "yes"; then, "no"',
    "line 1\nline 2\r\nline 3",
    ";",
    ",",
    '"',
    '";"',
    "=SUM(A1;A2)",
    "+31 6 1234 5678",
    "@cmd",
    "-1",
    "Şükrü Çağlar-İnce; Güneş Yağ Ltd. Şti., ığüşöç ĞÜŞİÖÇ",
    "IJsselmeer B.V.; Zoë van 't Hoff, Curaçao",
    "",
  ];

  for (const separator of [";", ","] as const) {
    it(`keeps every cell in its column with "${separator}"`, () => {
      const header = ["A", "B", "C"];
      const rows = tricky.map((v, n) => [String(n), v, `${v}|${separator}`]);
      const text = [header, ...rows].map((r) => csvLine(r, separator)).join("");
      // Excel / LibreOffice / csv reading with the same separator: same rows, same cells.
      const parsed = parseCsv(text, separator);
      expect(parsed).toHaveLength(rows.length + 1);
      for (const r of parsed) expect(r).toHaveLength(3);
      expect(parsed[0]).toEqual(header);
      rows.forEach((r, n) => {
        expect(parsed[n + 1]?.[0]).toBe(r[0]);
        expect(parsed[n + 1]?.[1]).toBe(neutraliseFormula(r[1] as string));
        expect(parsed[n + 1]?.[2]).toBe(neutraliseFormula(r[2] as string));
      });
      // The other separator never appears as a cell boundary: only inside quoted cells.
      const other = separator === ";" ? "," : ";";
      expect(() => parseCsv(text, other)).toThrow();
      // CRLF ends every record; bare LF and CR only inside a quoted cell.
      expect(text.endsWith("\r\n")).toBe(true);
    });
  }

  it("formula-injection protection is the same with both separators", () => {
    for (const separator of [";", ","] as const) {
      const line = csvLine(["=1+1", "+1", "-1", "@a", "\t=1", " =1"], separator);
      const cells = parseCsv(line, separator)[0] as string[];
      for (const c of cells) expect(c.startsWith("'")).toBe(true);
    }
  });

  it("accepts only ; and , (absent: ;)", () => {
    expect(exportSeparator(undefined)).toBe(";");
    expect(exportSeparator(";")).toBe(";");
    expect(exportSeparator(",")).toBe(",");
    for (const bad of [
      "",
      " ",
      "\t",
      "|",
      ";;",
      ", ",
      "%3B",
      "semicolon",
      [";"],
      [";", ","],
      0,
      null,
    ]) {
      let error: unknown = null;
      try {
        exportSeparator(bad);
      } catch (e) {
        error = e;
      }
      expect(error, JSON.stringify(bad)).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("VALIDATION_FAILED");
    }
  });
});

describe("dates", () => {
  it("writes Europe/Amsterdam local time, across summer and winter time", () => {
    expect(csvDateTime(new Date("2026-11-19T15:44:06Z"))).toBe("2026-11-19 16:44:06");
    expect(csvDateTime(new Date("2026-07-01T22:30:00Z"))).toBe("2026-07-02 00:30:00");
    expect(csvDateTime(null)).toBe("");
  });

  it("finds where an Amsterdam day starts and ends, DST days included", () => {
    expect(dayStart("2026-11-19").toISOString()).toBe("2026-11-18T23:00:00.000Z");
    expect(dayEnd("2026-11-19").toISOString()).toBe("2026-11-19T23:00:00.000Z");
    expect(dayStart("2026-07-01").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    // 29 March 2026: clocks go forward (23 h day); 25 October 2026: back (25 h day).
    expect(dayStart("2026-03-29").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(dayEnd("2026-03-29").toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(dayStart("2026-10-25").toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(dayEnd("2026-10-25").toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(dayEnd("2026-12-31").toISOString()).toBe("2026-12-31T23:00:00.000Z");
  });

  it("accepts only real calendar days", () => {
    expect(isCalendarDay("2026-11-19")).toBe(true);
    expect(isCalendarDay("2028-02-29")).toBe(true);
    for (const v of [
      "2026-02-29",
      "2026-13-01",
      "2026-11-31",
      "19-11-2026",
      "2026-1-1",
      "1999-12-31",
      "",
    ]) {
      expect(isCalendarDay(v)).toBe(false);
    }
  });

  it("names the file with the site and the Amsterdam date and time, ASCII only", () => {
    const at = new Date("2026-11-19T15:44:06Z");
    expect(exportFilename("BV", at)).toBe("leads-bv-2026-11-19-1644.csv");
    expect(exportFilename("all", at)).toBe("leads-all-2026-11-19-1644.csv");
    expect(exportFilename("CORPORATE", at)).toBe("leads-corporate-2026-11-19-1644.csv");
    expect(exportFilename('x"; evil', at)).toBe("leads-x-evil-2026-11-19-1644.csv");
  });
});
