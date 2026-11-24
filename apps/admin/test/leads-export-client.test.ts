// DP-227 / DP-229: the browser side of the lead CSV export: separator, file name and the real
// error for staff.
import { describe, expect, it } from "vitest";
import { createTranslator } from "../lib/i18n/translate";
import {
  exportErrorMessage,
  exportSeparatorOptions,
  exportFilenameOf,
  exportQueryWithSeparator,
} from "../lib/leads-client";

const body = (code: string, details: unknown[] = []) => ({
  error: { code, message: "x", requestId: "req-123", details },
});

describe("lead export download", () => {
  it("takes the API's file name, or a dated fallback", () => {
    expect(exportFilenameOf('attachment; filename="leads-bv-2026-11-19-1644.csv"')).toBe(
      "leads-bv-2026-11-19-1644.csv",
    );
    expect(exportFilenameOf(null, new Date("2026-11-19T10:00:00Z"))).toBe("leads-2026-11-19.csv");
    expect(
      exportFilenameOf(
        'attachment; filename="../../etc/x y.csv"',
        new Date("2026-11-19T10:00:00Z"),
      ),
    ).toBe("leads-2026-11-19.csv");
  });

  it("shows the real reason with the HTTP status, error code and request id", () => {
    expect(exportErrorMessage(403, body("FORBIDDEN"))).toBe(
      "You may not export these leads. Exporting needs the lead export permission (customer-data officer or platform administrator) on every selected site. (HTTP 403, FORBIDDEN, request req-123)",
    );
    expect(
      exportErrorMessage(
        400,
        body("VALIDATION_FAILED", [{ path: "filters", rule: "too_many_rows" }]),
      ),
    ).toBe(
      "Too many leads for one file (at most 20,000). Narrow the filters, for example by date. (HTTP 400, VALIDATION_FAILED, request req-123)",
    );
    expect(
      exportErrorMessage(400, body("VALIDATION_FAILED", [{ path: "to", rule: "before_from" }])),
    ).toMatch(/^The end date is before the start date\./);
    expect(exportErrorMessage(401, body("AUTH_SESSION_REQUIRED"))).toMatch(
      /^Your session has ended/,
    );
    expect(exportErrorMessage(500, body("INTERNAL_ERROR"))).toMatch(
      /\(HTTP 500, INTERNAL_ERROR, request req-123\)$/,
    );
    expect(exportErrorMessage(502, "<html>")).toBe(
      "The export failed (HTTP 502). Try again in a moment.",
    );
    expect(exportErrorMessage(0, null)).toMatch(/cannot be reached/);
  });

  it("DP-229: adds the chosen separator to the filters and keeps them", () => {
    expect(exportQueryWithSeparator("", ";")).toBe("?separator=%3B");
    expect(exportQueryWithSeparator("", ",")).toBe("?separator=%2C");
    expect(
      exportQueryWithSeparator(
        "?source=CONTACT_FORM&from=2026-11-01&q=G%C3%BCne%C5%9F+Ya%C4%9F",
        ",",
      ),
    ).toBe("?source=CONTACT_FORM&from=2026-11-01&q=G%C3%BCne%C5%9F+Ya%C4%9F&separator=%2C");
    // A separator already in the query never wins over the one chosen on screen.
    expect(exportQueryWithSeparator("?separator=%7C&siteId=bv", ";")).toBe(
      "?separator=%3B&siteId=bv",
    );
    const q = new URLSearchParams(exportQueryWithSeparator("?q=a%26b%3Bc", ";").slice(1));
    expect(q.get("q")).toBe("a&b;c");
    expect(q.getAll("separator")).toEqual([";"]);
  });

  it("DP-229: offers semicolon first (the default), then comma", () => {
    const EXPORT_SEPARATOR_OPTIONS = exportSeparatorOptions(createTranslator("en"));
    expect(EXPORT_SEPARATOR_OPTIONS.map((o) => o.value)).toEqual([";", ","]);
    expect(EXPORT_SEPARATOR_OPTIONS[0]?.label).toBe("Semicolon (;)");
  });

  it("DP-229: names a refused separator plainly", () => {
    expect(
      exportErrorMessage(400, body("VALIDATION_FAILED", [{ path: "separator", rule: "invalid" }])),
    ).toBe(
      "Choose a separator: semicolon (;) or comma (,). (HTTP 400, VALIDATION_FAILED, request req-123)",
    );
  });
});
