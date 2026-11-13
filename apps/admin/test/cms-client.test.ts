// CMS S1 (DP-015): readable messages of the CMS form calls.
import { describe, expect, it } from "vitest";
import { describePath, messageForIssues } from "../lib/cms-client";

describe("CMS client messages", () => {
  it("names section fields by position", () => {
    expect(describePath("content.sections.0.title")).toBe("section 1 (title)");
    expect(describePath("content.sections.2.items.0.link.href")).toBe(
      "section 3 (items 1 link.href)",
    );
    expect(describePath("seo.title")).toBe("SEO title");
    expect(describePath("slug")).toBe("slug");
  });

  it("prefers a known rule, then lists the fields", () => {
    expect(messageForIssues("CONFLICT_STATE", [{ path: "version", rule: "stale" }])).toMatch(
      /Reload/,
    );
    expect(messageForIssues("CONFLICT_STATE", [{ path: "slug", rule: "unique" }])).toMatch(
      /already uses/,
    );
    expect(messageForIssues("VALIDATION_FAILED", [{ path: "slug", rule: "custom" }])).toMatch(
      /reserved/,
    );
    expect(
      messageForIssues("VALIDATION_FAILED", [
        { path: "content.sections.1.body", rule: "custom" },
        { path: "title", rule: "too_small" },
      ]),
    ).toBe("Check these fields: section 2 (body), title.");
    expect(messageForIssues(null, [])).toMatch(/could not be saved/);
  });
});
