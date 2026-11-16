// DP-196 regression (2026-11-16 DEV): saving a BV listing with Chrome's page translation on
// crashed the console with "NotFoundError: Failed to execute 'insertBefore' on 'Node'".
// Translation replaces every text node with <font> elements. React keeps pointing at the old
// text node, so it fails when it
//   (R1) inserts a node in front of a bare text sibling, e.g. `{busy ? <Spinner /> : <Icon />}`
//        followed by `Save`: the new spinner goes "before" a text node that is no longer there;
//   (R2) removes a text node that has siblings, e.g. `{active ? null : " (no access)"}`.
// The save itself had reached the API; only the page broke. The fix keeps text that sits next to
// a changing node inside its own element (<span>). This test checks the rule statically in every
// admin .tsx file, with the TypeScript parser.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["app", "components"];
const K = ts.SyntaxKind;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}

function strip(e: ts.Expression | undefined): ts.Expression | undefined {
  while (
    e &&
    (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e))
  )
    e = e.expression;
  return e;
}

function tagOf(e: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment): string {
  if (ts.isJsxElement(e)) return e.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(e)) return e.tagName.getText();
  return "<>";
}

/**
 * What a child expression can render: "none", "text", "el:<Tag>", or "opaque" (a call such as
 * `.map(...)` or a render helper: not judged). Identifiers count as text, the cautious reading.
 */
function kinds(expr: ts.Expression | undefined): Set<string> {
  const e = strip(expr);
  if (!e) return new Set(["none"]);
  if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e))
    return new Set([`el:${tagOf(e)}`]);
  if (
    e.kind === K.NullKeyword ||
    e.kind === K.FalseKeyword ||
    (ts.isIdentifier(e) && e.text === "undefined")
  )
    return new Set(["none"]);
  if (ts.isConditionalExpression(e)) return new Set([...kinds(e.whenTrue), ...kinds(e.whenFalse)]);
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === K.AmpersandAmpersandToken) return new Set(["none", ...kinds(e.right)]);
    if (op === K.BarBarToken || op === K.QuestionQuestionToken)
      return new Set([...[...kinds(e.left)].filter((k) => k !== "none"), ...kinds(e.right)]);
    if (op === K.PlusToken) return new Set(["text"]);
  }
  if (ts.isCallExpression(e)) return new Set(["opaque"]);
  return new Set(["text"]);
}

/** Every R1/R2 site in one source file, as "line: rule: code". */
function translateUnsafe(source: string, file = "x.tsx"): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
      const kids = n.children.filter(
        (c) =>
          !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces) &&
          !(ts.isJsxExpression(c) && !c.expression),
      );
      const kk = kids.map((c) =>
        ts.isJsxText(c)
          ? new Set(["text"])
          : ts.isJsxExpression(c)
            ? kinds(c.expression)
            : new Set(["el"]),
      );
      kids.forEach((c, i) => {
        const k = kk[i]!;
        // Only a slot whose output can change node kind inserts or removes DOM nodes.
        if (!ts.isJsxExpression(c) || k.has("opaque") || k.size < 2) return;
        const line = sf.getLineAndCharacterOfPosition(c.getStart()).line + 1;
        const code = c.getText().replace(/\s+/g, " ").slice(0, 80);
        if (kk[i + 1]?.has("text"))
          found.push(`${line}: R1 node inserted before bare text: ${code}`);
        else if (k.has("text") && kids.length > 1)
          found.push(`${line}: R2 text node removed beside siblings: ${code}`);
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe("translate-safe JSX (DP-196)", () => {
  it("finds both unsafe shapes and accepts the wrapped forms", () => {
    const wrap = (body: string) => `const A = () => <button>${body}</button>;`;
    expect(translateUnsafe(wrap(`{busy ? <Spinner /> : <Icon />}\nSave`))).toHaveLength(1);
    expect(
      translateUnsafe(wrap(`{busy ? <Spinner /> : null}{busy ? "Saving…" : "Save"}`)),
    ).toHaveLength(1);
    expect(translateUnsafe(wrap(`<b>x</b>{on ? null : " (off)"}<i />`))).toHaveLength(1);
    expect(translateUnsafe(wrap(`{busy ? <Spinner /> : <Icon />}<span>Save</span>`))).toEqual([]);
    expect(translateUnsafe(wrap(`<b>x</b>{on ? null : <span>{" (off)"}</span>}`))).toEqual([]);
    // Text that only changes its value is updated in place: safe.
    expect(translateUnsafe(wrap(`<Icon />{busy ? "Saving…" : "Save"}`))).toEqual([]);
    expect(translateUnsafe(wrap(`{name ?? "Unknown"} text`))).toEqual([]);
  });

  it("no admin component inserts before, or removes, a bare text node", () => {
    const problems = DIRS.flatMap((d) => files(path.join(ROOT, d))).flatMap((f) =>
      translateUnsafe(readFileSync(f, "utf8"), f).map((p) => `${path.relative(ROOT, f)}:${p}`),
    );
    expect(problems).toEqual([]);
  });
});
