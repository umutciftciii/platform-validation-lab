// COM-2a (DP-320): the asset field of a section offers only the page's own site's files; a split
// section's image may be left empty on the corporate site (its design works without images),
// never on BV. The API applies the same rules (contracts `cmsTemplateContentSchema(site)`).
import { CMS_SECTION_TYPES, CMS_STATIC_ASSETS } from "@dream/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Fields, toContent, toValues } from "../components/cms/field-form";

const SPLIT = CMS_SECTION_TYPES.find((s) => s.type === "split")!.fields;

function render(site: "BV" | "CORPORATE") {
  return renderToStaticMarkup(
    <Fields
      fields={SPLIT}
      values={toValues(SPLIT, {})}
      path="content.sections.0"
      idPrefix="s0"
      readOnly={false}
      invalid={() => undefined}
      onChange={() => undefined}
      site={site}
    />,
  );
}

const optionValues = (html: string) =>
  [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1] as string);

describe("site-scoped asset field (COM-2a)", () => {
  it("BV offers BV files only and no empty choice", () => {
    const values = optionValues(render("BV")).filter(Boolean);
    const bv = CMS_STATIC_ASSETS.filter((a) => a.site === "BV" && a.kind === "image");
    expect(values).toEqual(bv.map((a) => a.src));
    expect(render("BV")).not.toContain("No image");
  });

  it("the corporate site offers none of BV's files and lets the image stay empty", () => {
    const html = render("CORPORATE");
    const values = optionValues(html);
    for (const a of CMS_STATIC_ASSETS.filter((x) => x.site === "BV")) {
      expect(values).not.toContain(a.src);
    }
    expect(values).toContain("");
    expect(html).toContain("No image");
  });

  it("an empty image is sent as null on the corporate site and as a missing value on BV", () => {
    const values = toValues(SPLIT, { title: "T", body: "B" });
    expect(toContent(SPLIT, values, "CORPORATE")["image"]).toBeNull();
    expect(toContent(SPLIT, values, "BV")["image"]).toBe("");
  });
});
