// DP-196 regression (2026-11-16 DEV): saving a BV listing with Chrome's page translation on
// crashed the console with "NotFoundError: Failed to execute 'insertBefore' on 'Node'".
// Translation replaces every text node with <font> elements. React keeps pointing at the old
// text node, so it fails when it
//   (R1) inserts a node in front of a bare text sibling, e.g. `{busy ? <Spinner /> : <Icon />}`
//        followed by `Save`: the new spinner goes "before" a text node that is no longer there;
//   (R2) removes a text node that has siblings, e.g. `{active ? null : " (no access)"}`.
// The save itself had reached the API; only the page broke. The fix keeps text that sits next to
// a changing node inside its own element (<span>).
//
// DP-199 (found in DP-197, 2026-11-17): the publication card crashed with "removeChild" on
// Live -> Unpublished although R1/R2 passed. Both branches of `{live ? <>…</> : <>…</>}` were
// fragments, so the slot looked unchanged ("el:<>" either way). React does not replace an
// element whose type (and key) stays the same: it reuses it and reconciles the children by
// position, removing and inserting text nodes inside it. Hence
//   (R3) a conditional whose branches render the same element type with the same key, where the
//        children differ so that a text node is removed or a node is inserted before a text node.
// A distinct `key` per branch, or one string per line (a single text node, updated in place),
// avoids it. Element keys also count as identity in R1/R2: `{a ? <X key="1" /> : <X key="2" />}`
// remounts, which inserts a node.
//
// The rule is checked statically in every admin .tsx file, with the TypeScript parser.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["app", "components"];
const K = ts.SyntaxKind;

type Jsx = ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;
/**
 * What one child slot can render: "none", "text", "el:<identity>", or "opaque"; "ftext" marks a
 * fragment that puts bare text straight into the parent (its removal removes text nodes).
 */
type Kinds = Set<string>;

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

function isJsx(e: ts.Node | undefined): e is Jsx {
  return !!e && (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e));
}

/** Tag plus key: React reuses an element only when both stay the same. */
function identity(e: Jsx): string {
  if (ts.isJsxFragment(e)) return "<>";
  const opening = ts.isJsxElement(e) ? e.openingElement : e;
  const key = opening.attributes.properties.find(
    (p) => ts.isJsxAttribute(p) && p.name.getText() === "key",
  );
  const keyText = key && ts.isJsxAttribute(key) ? key.initializer?.getText() : undefined;
  return keyText ? `${opening.tagName.getText()}#${keyText}` : opening.tagName.getText();
}

/**
 * What a child expression can render. A call such as `.map(...)` or a render helper is "opaque"
 * (not judged). Identifiers count as text, the cautious reading.
 */
function kinds(expr: ts.Expression | undefined): Kinds {
  const e = strip(expr);
  if (!e) return new Set(["none"]);
  if (isJsx(e)) return jsxKinds(e);
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

/** The JSX elements an expression can evaluate to (through ?:, &&, ||, ??). */
function leaves(expr: ts.Expression | undefined): Jsx[] {
  const e = strip(expr);
  if (!e) return [];
  if (isJsx(e)) return [e];
  if (ts.isConditionalExpression(e)) return [...leaves(e.whenTrue), ...leaves(e.whenFalse)];
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === K.AmpersandAmpersandToken) return leaves(e.right);
    if (op === K.BarBarToken || op === K.QuestionQuestionToken)
      return [...leaves(e.left), ...leaves(e.right)];
  }
  return [];
}

/** The children React sees, one array entry each (lines of only whitespace are dropped by JSX). */
function children(n: ts.JsxElement | ts.JsxFragment): ts.JsxChild[] {
  return n.children.filter(
    (c) =>
      !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces) &&
      !(ts.isJsxExpression(c) && !c.expression),
  );
}

function childKinds(c: ts.JsxChild): Kinds {
  if (ts.isJsxText(c)) return new Set(["text"]);
  if (ts.isJsxExpression(c)) return kinds(c.expression);
  return isJsx(c) ? jsxKinds(c) : new Set(["opaque"]);
}

function jsxKinds(e: Jsx): Kinds {
  const k = new Set([`el:${identity(e)}`]);
  if (
    ts.isJsxFragment(e) &&
    children(e).some((c) => {
      const ck = childKinds(c);
      return ck.has("text") || ck.has("ftext");
    })
  )
    k.add("ftext");
  return k;
}

/** The slot can hold a bare text node in the parent (itself, or through a fragment). */
const bare = (k: Kinds | undefined) => !!k && (k.has("text") || k.has("ftext"));

function childLeaves(c: ts.JsxChild): Jsx[] {
  if (isJsx(c)) return [c];
  return ts.isJsxExpression(c) ? leaves(c.expression) : [];
}

const real = (k: Kinds) => [...k].filter((x) => x !== "none" && x !== "ftext");
/** The same React type may sit at this position before and after: the node is kept. */
const kept = (a: Kinds | undefined, b: Kinds | undefined) =>
  !!a && !!b && (a.has("opaque") || b.has("opaque") || real(a).some((x) => b.has(x)));

/**
 * R3 for one direction: the element `from` is reused to render `to`. Children are reconciled
 * by position: a text node whose position no longer holds text is removed; a node at a new or
 * changed position is inserted before the next kept node (or, for a fragment or component,
 * before what follows the element: `textAfter`).
 */
function reuseProblem(from: Jsx, to: Jsx, textAfter: boolean, depth = 0): string | null {
  if (depth > 8 || ts.isJsxSelfClosingElement(from) || ts.isJsxSelfClosingElement(to)) return null;
  const a = children(from);
  const b = children(to);
  const ka = a.map(childKinds);
  const kb = b.map(childKinds);
  const fragmentLike = ts.isJsxFragment(to) || /^[A-Z]/.test(identity(to));
  for (let i = 0; i < ka.length; i++) {
    const o = ka[i]!;
    const n = kb[i];
    if (
      (o.has("text") && !(n && (n.has("text") || n.has("opaque")))) ||
      (o.has("ftext") && !kept(o, n))
    )
      return "R3 text node removed from a reused element";
  }
  for (let i = 0; i < kb.length; i++) {
    const n = kb[i]!;
    if (!real(n).length || kept(ka[i], n)) continue;
    let refText = fragmentLike ? textAfter : false;
    for (let j = i + 1; j < kb.length; j++) {
      if (kept(ka[j], kb[j])) {
        refText = bare(kb[j]);
        break;
      }
    }
    if (refText) return "R3 node inserted before text in a reused element";
  }
  // The same element at the same position is reused in turn: look inside it.
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const after = kb[i + 1] ? bare(kb[i + 1]) : textAfter;
    for (const x of childLeaves(a[i]!))
      for (const y of childLeaves(b[i]!))
        if (identity(x) === identity(y)) {
          const p = reuseProblem(x, y, after, depth + 1);
          if (p) return p;
        }
  }
  return null;
}

/** Every R1/R2/R3 site in one source file, as "line: rule: code". */
function translateUnsafe(source: string, file = "x.tsx"): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Set<string>();
  const report = (node: ts.Node, rule: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    found.add(`${line}: ${rule}: ${node.getText().replace(/\s+/g, " ").slice(0, 80)}`);
  };
  // Whether the node that follows a conditional child can be a bare text node.
  const textAfter = new Map<ts.Node, boolean>();
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
      const kids = children(n);
      const kk = kids.map(childKinds);
      kids.forEach((c, i) => {
        const k = kk[i]!;
        if (ts.isJsxExpression(c) && c.expression)
          textAfter.set(strip(c.expression)!, bare(kk[i + 1]));
        // Only a slot whose output can change node kind inserts or removes DOM nodes.
        if (!ts.isJsxExpression(c) || k.has("opaque") || k.size - (k.has("ftext") ? 1 : 0) < 2)
          return;
        if (bare(kk[i + 1])) report(c, "R1 node inserted before bare text");
        else if (bare(k) && kids.length > 1) report(c, "R2 text node removed beside siblings");
      });
    }
    if (ts.isConditionalExpression(n)) {
      const after = textAfter.get(n) ?? false;
      for (const x of leaves(n.whenTrue))
        for (const y of leaves(n.whenFalse))
          if (identity(x) === identity(y)) {
            const p = reuseProblem(x, y, after) ?? reuseProblem(y, x, after);
            if (p) report(n, p);
          }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...found];
}

const wrap = (body: string) => `const A = () => <button>${body}</button>;`;
const rules = (src: string) => translateUnsafe(src).map((p) => p.split(": ")[1]!.slice(0, 2));

// The DP-197 publication card before the fix (bb09d20^, components/catalog/workflow.tsx):
// Live -> Unpublished crashed with removeChild on a translated page.
const DP197_BEFORE = `const C = () => (
  <p className="text-xs text-ink-3">
    {live ? (
      <>
        Live: master version {pub.productVersion}, listing version {pub.listingVersion}
        {pub.approvalMode === "DIRECT" ? " · published directly" : " · approved version"}
        <br />
        Published {when(pub.publishedAt)} by {pub.publishedBy.name}
      </>
    ) : (
      <>
        Unpublished {pub.unpublishedAt ? when(pub.unpublishedAt) : ""}
        {pub.unpublishedBy ? \` by \${pub.unpublishedBy.name}\` : ""}
        <br />
        Last live: master version {pub.productVersion}
      </>
    )}
  </p>
);`;

// The same card after the fix (bb09d20): keyed lines, one string each.
const DP197_AFTER = `const C = () => (
  <p className="text-xs text-ink-3">
    {live ? (
      <>
        <span key="live-1" className="block">
          {\`Live: master version \${pub.productVersion}, listing version \${pub.listingVersion}\`}
        </span>
        <span key="live-2" className="block">
          {\`Published \${when(pub.publishedAt)} by \${pub.publishedBy.name}\`}
        </span>
      </>
    ) : pub.status === "UNPUBLISHED" ? (
      <>
        <span key="off-1" className="block">
          {\`Unpublished\${pub.unpublishedAt ? \` \${when(pub.unpublishedAt)}\` : ""}\`}
        </span>
        <span key="off-2" className="block">
          {\`Last live: master version \${pub.productVersion}\`}
        </span>
      </>
    ) : (
      <span key="hidden-1" className="block">
        {\`Not shown on this site at the moment. Last published \${when(pub.publishedAt)}.\`}
      </span>
    )}
  </p>
);`;

describe("translate-safe JSX (DP-196, DP-199)", () => {
  it("R1/R2: finds both slot shapes and accepts the wrapped forms", () => {
    expect(rules(wrap(`{busy ? <Spinner /> : <Icon />}\nSave`))).toEqual(["R1"]);
    expect(rules(wrap(`{busy ? <Spinner /> : null}{busy ? "Saving…" : "Save"}`))).toEqual(["R1"]);
    expect(rules(wrap(`<b>x</b>{on ? null : " (off)"}<i />`))).toEqual(["R2"]);
    expect(translateUnsafe(wrap(`{busy ? <Spinner /> : <Icon />}<span>Save</span>`))).toEqual([]);
    expect(translateUnsafe(wrap(`<b>x</b>{on ? null : <span>{" (off)"}</span>}`))).toEqual([]);
    // Text that only changes its value is updated in place: safe.
    expect(translateUnsafe(wrap(`<Icon />{busy ? "Saving…" : "Save"}`))).toEqual([]);
    expect(translateUnsafe(wrap(`{name ?? "Unknown"} text`))).toEqual([]);
  });

  it("R1/R2: a fragment of bare text is removed or inserted text node by text node", () => {
    expect(rules(wrap(`<b>x</b>{on ? <>a {n}</> : null}<i />`))).toEqual(["R2"]);
    expect(rules(wrap(`<b>x</b>{on ? <>a</> : null}{" tail"}`))).toEqual(["R1"]);
    expect(translateUnsafe(wrap(`<b>x</b>{on ? <><i /></> : null}<i />`))).toEqual([]);
    expect(translateUnsafe(wrap(`<b>x</b>{on ? <span>a {n}</span> : null}<i />`))).toEqual([]);
  });

  it("R1: a key change remounts the element, which inserts a node", () => {
    expect(rules(wrap(`{on ? <S key="a" /> : <S key="b" />}\nSave`))).toEqual(["R1"]);
    expect(translateUnsafe(wrap(`{on ? <S key="a" /> : <S key="b" />}<span>Save</span>`))).toEqual(
      [],
    );
  });

  it("R3: the DP-197 publication card is caught before the fix and passes after it", () => {
    expect(rules(DP197_BEFORE)).toEqual(["R3"]);
    expect(translateUnsafe(DP197_BEFORE)[0]).toMatch(/^3: R3 text node removed/);
    expect(translateUnsafe(DP197_AFTER)).toEqual([]);
  });

  it("R3: removal and insertion inside a reused element of the same type", () => {
    // Text removed: the second branch has no text where the first had one.
    expect(rules(`const A = () => (on ? <p>Hi {name}<br />x</p> : <p>Bye<br /></p>);`)).toEqual([
      "R3",
    ]);
    // Inserted before text: <b> appears in front of a kept text node.
    expect(rules(`const A = () => (on ? <p><i />x</p> : <p><i /><b />x</p>);`)).toEqual(["R3"]);
    // Same through a nested reused element.
    expect(
      rules(`const A = () => (on ? <div><p>Hi {a}<br />x</p></div> : <div><p><br /></p></div>);`),
    ).toEqual(["R3"]);
    // A fragment that grows in front of the bare text that follows it.
    expect(rules(`const A = () => <p>{on ? <>a</> : <>a<b /></>}tail</p>;`)).toEqual(["R3"]);
  });

  it("R3: same shapes, distinct keys, text in place and element-only changes pass", () => {
    // Same positions, only the text values differ: updated in place.
    expect(
      translateUnsafe(`const A = () => (on ? <p>Live {a}<br />{b}</p> : <p>Off {c}<br />{d}</p>);`),
    ).toEqual([]);
    // Distinct keys: replaced, never reconciled child by child.
    expect(
      translateUnsafe(`const A = () => (on ? <p key="a">Hi {x}<br />y</p> : <p key="b">Bye</p>);`),
    ).toEqual([]);
    // Different element types: replaced.
    expect(
      translateUnsafe(`const A = () => (on ? <p>Hi {x}<br />y</p> : <div>Bye</div>);`),
    ).toEqual([]);
    // Elements only: React keeps element nodes, translation does not touch them.
    expect(
      translateUnsafe(
        `const A = () => (on ? <ul><li>a</li><li>b</li></ul> : <ul><li>a</li></ul>);`,
      ),
    ).toEqual([]);
    // Every line already one string in its own element.
    expect(
      translateUnsafe(
        "const A = () => (on ? <p><span>{`a ${x}`}</span><span>b</span></p> : <p><span>{`c`}</span></p>);",
      ),
    ).toEqual([]);
    // An element appended at the end of a host element: appendChild, no text reference.
    expect(translateUnsafe(`const A = () => (on ? <p>Hi</p> : <p>Hi<b /></p>);`)).toEqual([]);
  });

  it("no admin component inserts before, or removes, a bare text node", () => {
    const problems = DIRS.flatMap((d) => files(path.join(ROOT, d))).flatMap((f) =>
      translateUnsafe(readFileSync(f, "utf8"), f).map((p) => `${path.relative(ROOT, f)}:${p}`),
    );
    expect(problems).toEqual([]);
  });
});
