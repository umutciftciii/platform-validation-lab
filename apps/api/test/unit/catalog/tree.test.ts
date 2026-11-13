// PM-1 (DP-033): category tree rules checked before a write (the database trigger is tested in
// catalog.int.test.ts).
import { describe, expect, it } from "vitest";
import { depthOf, parentProblem, subtreeHeight, subtreeIds } from "../../../src/catalog/tree.js";

const nodes = [
  { id: "a", parentId: null },
  { id: "b", parentId: "a" },
  { id: "c", parentId: "b" },
  { id: "d", parentId: null },
  { id: "e", parentId: "d" },
];

describe("category tree", () => {
  it("collects a subtree and measures depth and height", () => {
    expect(subtreeIds(nodes, "a").sort()).toEqual(["a", "b", "c"]);
    expect(subtreeIds(nodes, "c")).toEqual(["c"]);
    expect(depthOf(nodes, "a")).toBe(1);
    expect(depthOf(nodes, "c")).toBe(3);
    expect(depthOf(nodes, "missing")).toBe(Infinity);
    expect(subtreeHeight(nodes, "a")).toBe(3);
    expect(subtreeHeight(nodes, "d")).toBe(2);
    expect(subtreeHeight(nodes, "c")).toBe(1);
  });

  it("allows roots and moves within three levels", () => {
    expect(parentProblem(nodes, null, null)).toBeNull();
    expect(parentProblem(nodes, null, "b")).toBeNull(); // new leaf at level 3
    expect(parentProblem(nodes, "e", "a")).toBeNull(); // e (height 1) below a: level 2
    expect(parentProblem(nodes, "d", "a")).toBeNull(); // d (height 2) below a: levels 2-3
  });

  it("refuses unknown parents, cycles and a fourth level", () => {
    expect(parentProblem(nodes, null, "zz")).toBe("unknown_parent");
    expect(parentProblem(nodes, "a", "c")).toBe("cycle");
    expect(parentProblem(nodes, "a", "a")).toBe("cycle");
    expect(parentProblem(nodes, null, "c")).toBe("too_deep");
    expect(parentProblem(nodes, "d", "b")).toBe("too_deep");
  });

  it("survives a corrupted chain without looping", () => {
    const broken = [
      { id: "x", parentId: "y" },
      { id: "y", parentId: "x" },
    ];
    expect(depthOf(broken, "x")).toBe(Infinity);
    expect(subtreeIds(broken, "x").sort()).toEqual(["x", "y"]);
  });
});
