// DP-173: a held value with an empty site cell reads "no value shown", never "None"; real values
// stay exactly as recorded.
import { describe, expect, it } from "vitest";
import { heldRawForDisplay } from "../../../src/catalog/preview-display.js";

describe("held value display", () => {
  it("replaces the empty-cell token after the label", () => {
    expect(heldRawForDisplay("Appearance: None [no method]")).toBe(
      "Appearance: no value shown [no method]",
    );
    expect(heldRawForDisplay("Density at 20 °C: None g/cm³ [no method]")).toBe(
      "Density at 20 °C: no value shown g/cm³ [no method]",
    );
    expect(heldRawForDisplay("Water: None")).toBe("Water: no value shown");
  });

  it("leaves recorded values unchanged", () => {
    for (const raw of [
      "Saybolt color: ≥+30 [GB/T 3555]",
      "Kinematic viscosity at 100 °C: 6.0–6.5 cSt [GB/T 265]",
      "Grade: Nonené [x]",
      "Remark: see None below",
    ]) {
      expect(heldRawForDisplay(raw)).toBe(raw);
    }
  });
});
