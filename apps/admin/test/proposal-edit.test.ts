// DP-191: rules of the proposal text editor (pure functions; the API decides again).
import { describe, expect, it } from "vitest";
import {
  changedText,
  draftOf,
  hasTextChanges,
  normalizeText,
  rebaseDraft,
  reviseBody,
  saveErrorText,
  textProblem,
} from "../lib/proposal-edit";
import { createTranslator } from "../lib/i18n/translate";

const en = createTranslator("en");
const tr = createTranslator("tr");

const saved = { summary: "Group II base oil.", description: null };

describe("proposal text editor rules", () => {
  it("saves trimmed text and treats an empty field as no text", () => {
    expect(normalizeText("  Base oil.  ")).toBe("Base oil.");
    expect(normalizeText("   ")).toBeNull();
    expect(draftOf(saved)).toEqual({ summary: "Group II base oil.", description: "" });
  });

  it("sends only the changed fields and the version it started from", () => {
    const draft = { summary: "Group II base oil. ", description: "New description." };
    expect(changedText(saved, draft)).toEqual({ description: "New description." });
    expect(reviseBody(4, saved, draft)).toEqual({ version: 4, description: "New description." });
    // Clearing a text sends null; whitespace-only edits are no change.
    expect(changedText(saved, { summary: "", description: "" })).toEqual({ summary: null });
    expect(hasTextChanges(saved, { summary: " Group II base oil.", description: " " })).toBe(false);
  });

  it("after a newer version keeps only the fields the user edited", () => {
    const newer = { summary: "Saved elsewhere.", description: "Saved elsewhere too." };
    // Description edited here, summary untouched: the summary takes the newer text.
    const draft = { summary: "Group II base oil.", description: "Typed here." };
    const next = rebaseDraft(saved, draft, newer);
    expect(next).toEqual({ summary: "Saved elsewhere.", description: "Typed here." });
    // A save then sends only the edited field, so the other change is not reverted.
    expect(reviseBody(5, newer, next)).toEqual({ version: 5, description: "Typed here." });
    // A clean editor shows the newer text.
    expect(rebaseDraft(saved, draftOf(saved), newer)).toEqual(draftOf(newer));
  });

  it("explains a text that cannot be saved", () => {
    expect(textProblem("summary", "x".repeat(500), en, "en")).toBeNull();
    expect(textProblem("summary", "x".repeat(501), en, "en")).toMatch(/500 characters/);
    expect(textProblem("description", "x".repeat(8000), en, "en")).toBeNull();
    expect(textProblem("description", "x".repeat(8001), en, "en")).toMatch(/8,000 characters/);
    expect(textProblem("description", "Base oil [CONFIRM: grade]", en, "en")).toMatch(
      /Missing & Verification/,
    );
  });

  it("says plainly what a conflict, a size refusal and a missing permission mean", () => {
    expect(saveErrorText(409, [{ path: "version", rule: "stale" }], "x", en)).toMatch(
      /newer version.*your edits are kept/,
    );
    expect(saveErrorText(413, [], "x", en)).toMatch(/too long to send/);
    expect(saveErrorText(403, [], "x", en)).toMatch(/not allowed to edit/);
    expect(saveErrorText(400, [], "fallback", en)).toBe("fallback");
  });

  it("ML-12b: says the same in Turkish, numbers in Turkish format", () => {
    expect(textProblem("description", "x".repeat(8001), tr, "tr")).toBe(
      "En fazla 8.000 karakter yazın (şu an 8.001).",
    );
    expect(textProblem("summary", "[confirm] x", tr, "tr")).toMatch(/Eksikler ve doğrulama/);
    expect(saveErrorText(409, [{ path: "version", rule: "stale" }], "x", tr)).toMatch(
      /daha yeni bir sürümünü/,
    );
    expect(saveErrorText(403, [], "x", tr)).toBe("Bu sitede önerileri düzenleme yetkiniz yok.");
    // the catalogue client's message (already in the console language) is kept as it is
    expect(saveErrorText(400, [], "Değişiklik kaydedilemedi.", tr)).toBe(
      "Değişiklik kaydedilemedi.",
    );
  });
});
