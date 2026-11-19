// DP-227: CSV encoding of the lead export (RFC 4180, BOM, formula injection, Amsterdam dates).
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

  it("joins a line with commas and ends it with CRLF", () => {
    expect(csvLine(["a", 'b"c', "=d", null])).toBe(`"a","b""c","'=d",""\r\n`);
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
