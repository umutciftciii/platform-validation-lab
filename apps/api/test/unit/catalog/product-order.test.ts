// DP-160: product names sort naturally, pack sizes by mass.
import { describe, expect, it } from "vitest";
import { compareProductNames, orderName } from "../../../src/catalog/product-order.js";

const sorted = (names: string[]) => [...names].sort(compareProductNames);

describe("product order (DP-160)", () => {
  it("compares numbers in names as numbers", () => {
    expect(sorted(["White Oil 100#", "White Oil 15#", "White Oil 10#", "White Oil 20#"])).toEqual([
      "White Oil 10#",
      "White Oil 15#",
      "White Oil 20#",
      "White Oil 100#",
    ]);
    expect(sorted(["White Oil W1-110", "White Oil W1-30", "White Oil W1-TB"])).toEqual([
      "White Oil W1-30",
      "White Oil W1-110",
      "White Oil W1-TB",
    ]);
  });

  it("compares g and kg pack sizes by mass", () => {
    const jelly = "Pharmaceutical Grade White Petroleum Jelly";
    expect(
      sorted([
        `${jelly} 165 kg`,
        `${jelly} 25 kg`,
        `${jelly} 50 g`,
        `${jelly} 500 g`,
        `${jelly} 16 kg`,
      ]),
    ).toEqual([
      `${jelly} 50 g`,
      `${jelly} 500 g`,
      `${jelly} 16 kg`,
      `${jelly} 25 kg`,
      `${jelly} 165 kg`,
    ]);
    expect(orderName("Jelly 2.5 kg")).toBe("Jelly 2500 g");
    expect(orderName("Jelly 25KG")).toBe("Jelly 25000 g");
  });

  it("leaves other units and numbers alone", () => {
    expect(orderName("Solvent Oil 120#")).toBe("Solvent Oil 120#");
    expect(orderName("Rubber Filled With Oil (Agent) 4106#")).toBe(
      "Rubber Filled With Oil (Agent) 4106#",
    );
    expect(orderName("Base Oil 6 cSt")).toBe("Base Oil 6 cSt");
  });
});
