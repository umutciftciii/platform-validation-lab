// ML-12a (DP-243): finds the user-visible English text written directly in code — JSX text, and
// string or template literals that read like UI text — with the TypeScript parser. Used by
// test/catalog-ui-literals.test.ts: no hard-coded UI text may remain in the Products/Catalog area,
// and every text found there before ML-12a must still exist, unchanged, in the English dictionary.
//
// What is NOT UI text, and therefore never reported: imports, types, object keys, comparisons and
// `case` labels (enum values and API codes), the arguments of t(), cx() and other non-visible
// calls (fetch paths, URLs, query strings, regular expressions), attributes that are not read by
// people (className, href, id, type, name, role, …), CSS class lists, codes and keys
// (`product_master:edit`, `kv100`, `en`), and literals marked with an `i18n-ignore` comment on
// their line or the line above (a reason is required by convention: `// i18n-ignore: <reason>`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const K = ts.SyntaxKind;

/** JSX attributes whose value is never shown or read out to a person. */
const SILENT_ATTRS = new Set([
  "className",
  "href",
  "id",
  "key",
  "type",
  "name",
  "rel",
  "target",
  "method",
  "role",
  "htmlFor",
  "inputMode",
  "autoComplete",
  "encType",
  "accept",
  "form",
  "icon",
  "tone",
  "variant",
  "size",
  "as",
  "src",
  "lang",
  "dir",
  "pattern",
  "mode",
  "side",
  "align",
  "action",
  "formAction",
  "tab",
  "kind",
  "status",
  "state",
  "value",
  "defaultValue",
  "fieldName",
  "anchor",
  "hash",
  "sizes",
  "spellCheck",
  "aria-controls",
  "aria-describedby",
  "aria-labelledby",
  "aria-live",
  "aria-current",
  "aria-haspopup",
  "aria-orientation",
  "aria-sort",
  "aria-autocomplete",
  "aria-invalid",
  // ML-12a: a dictionary key (<Msg k="catalog.list.title" />), React keys and DOM id prefixes
  "k",
  "resetKey",
  "idPrefix",
  "style",
  "timeZone",
]);

/** Calls whose string arguments are never shown: paths, classes, keys, parsing, logging. */
const SILENT_CALLS = new Set([
  "t",
  "cx",
  "buttonStyles",
  "fetch",
  "callCatalog",
  "getCatalog",
  "serverRead",
  "push",
  "replace",
  "replaceAll",
  "startsWith",
  "endsWith",
  "includes",
  "split",
  "match",
  "test",
  "indexOf",
  "join",
  "get",
  "set",
  "has",
  "delete",
  "append",
  "getElementById",
  "querySelector",
  "querySelectorAll",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "setAttribute",
  "getAttribute",
  "scrollIntoView",
  "error",
  "warn",
  "log",
  "info",
  "debug",
  "RegExp",
  "URL",
  "URLSearchParams",
  "Headers",
  "Response",
  "Blob",
  "File",
  "Event",
  "CustomEvent",
  "parseLang",
  "localeCookie",
  "postJson",
  "uploadFile",
  "notFound",
  "redirect",
  "safeParse",
  "parse",
  "padStart",
  "padEnd",
  "toLocaleString",
  "DateTimeFormat",
  "NumberFormat",
  "createElement",
  "useId",
  "focusTab",
  "tabForHash",
]);

export interface Literal {
  file: string;
  line: number;
  text: string;
}

const LETTERS = /[A-Za-z]{2,}/;
/** A Tailwind class list: every token is a utility (`px-3`, `sm:hidden`, `text-ink-2`). */
const UTILITY_TOKEN =
  /^!?-?(?:[a-z0-9-]+:)*(?:[a-z0-9]+(?:-[a-z0-9./%[\]()#,_'"=:>*&]+)+|\[[^\]]+\]|flex|grid|block|inline|hidden|contents|relative|absolute|fixed|sticky|static|truncate|underline|italic|uppercase|lowercase|capitalize|grow|shrink|border|rounded|shadow|ring|outline|transition|transform|invisible|visible|isolate|group|peer|container|prose|antialiased|tabular-nums|sr-only|not-sr-only|resize|select-none|pointer-events-none|whitespace-nowrap|break-words|break-all|object-cover|object-contain|overflow-hidden|disabled|ordinal|table|table-row|table-cell|hyphens-auto)$/;
/** A code or key: no spaces, lower case or SCREAMING_CASE identifiers, paths, tags, units. */
const CODE_LIKE =
  /^(?:[a-z0-9_.:/#?=&%[\]{}()*+\-@]+|[A-Z0-9_]+|[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*|[a-z]{2}(?:-[A-Z]{2})?)$/;

function isClassList(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((tok) => UTILITY_TOKEN.test(tok));
}

/** Whether a literal's static text reads like words for a person. */
export function looksLikeUiText(text: string): boolean {
  const s = text.trim();
  if (!LETTERS.test(s)) return false;
  if (isClassList(s)) return false;
  if (!/\s/.test(s) && CODE_LIKE.test(s)) return false;
  if (/^(?:https?:|mailto:|\/|#|\.\/|\.\.\/)/.test(s)) return false;
  if (/^[a-z0-9_.:-]+(?:\s*[,;]\s*[a-z0-9_.:-]+)+$/.test(s)) return false; // "a, b" lists of keys
  return true;
}

function calleeName(call: ts.CallExpression | ts.NewExpression): string | null {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

function hasIgnoreComment(sf: ts.SourceFile, node: ts.Node): boolean {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const lines = sf.text.split("\n");
  const near = [lines[line] ?? "", lines[line - 1] ?? "", lines[line - 2] ?? ""];
  // the comment may sit above a multi-line JSX attribute or call as well
  return near.some((l) => l.includes("i18n-ignore"));
}

/** True when the literal sits where its text is a value of the program, not text for people. */
function isSilentPosition(node: ts.Node): boolean {
  let child: ts.Node = node;
  let parent: ts.Node | undefined = node.parent;
  // a literal inside a template, a parenthesis, `as`, `?:` or `||`/`??` is judged by its context
  while (
    parent &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isTemplateSpan(parent) ||
      ts.isTemplateExpression(parent) ||
      ts.isConditionalExpression(parent) ||
      (ts.isBinaryExpression(parent) &&
        [K.BarBarToken, K.QuestionQuestionToken, K.PlusToken].includes(
          parent.operatorToken.kind,
        )) ||
      ts.isArrayLiteralExpression(parent) ||
      ts.isSpreadElement(parent))
  ) {
    if (ts.isConditionalExpression(parent) && parent.condition === child) return true;
    child = parent;
    parent = parent.parent;
  }
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isExternalModuleReference(parent) || ts.isImportTypeNode(parent)) return true;
  if (ts.isLiteralTypeNode(parent)) return true;
  if (ts.isExpressionStatement(parent)) return true; // "use client"
  if (ts.isPropertyAssignment(parent) && parent.name === child) return true;
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    if (
      SILENT_ATTRS.has(parent.name.text) ||
      /^(?:href|path|key|code|id|slug|anchor|className)$/i.test(parent.name.text)
    )
      return true;
  }
  if (ts.isElementAccessExpression(parent)) return true;
  if (ts.isCaseClause(parent)) return true;
  if (
    ts.isBinaryExpression(parent) &&
    [
      K.EqualsEqualsEqualsToken,
      K.ExclamationEqualsEqualsToken,
      K.EqualsEqualsToken,
      K.ExclamationEqualsToken,
      K.InKeyword,
    ].includes(parent.operatorToken.kind)
  )
    return true;
  if (
    ts.isJsxAttribute(parent) ||
    (ts.isJsxExpression(parent) && parent.parent && ts.isJsxAttribute(parent.parent))
  ) {
    const attr = ts.isJsxAttribute(parent) ? parent : (parent.parent as ts.JsxAttribute);
    const name = attr.name.getText();
    return (
      SILENT_ATTRS.has(name) ||
      name.startsWith("data-") ||
      name.startsWith("on") ||
      name.endsWith("ClassName")
    );
  }
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression !== child) {
    const name = calleeName(parent);
    if (name && SILENT_CALLS.has(name)) return true;
  }
  if (ts.isTaggedTemplateExpression(parent)) return true;
  return false;
}

function templateText(node: ts.TemplateExpression): string {
  return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("{…}");
}

/** The UI-looking literals of one source file. */
export function scanSource(file: string, source: string): Literal[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Literal[] = [];
  const add = (node: ts.Node, text: string) => {
    if (hasIgnoreComment(sf, node)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push({ file, line: line + 1, text: text.replace(/\s+/g, " ").trim() });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      if (LETTERS.test(node.text) && node.text.trim()) add(node, node.text);
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (looksLikeUiText(node.text) && !isSilentPosition(node)) add(node, node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const text = templateText(node);
      if (looksLikeUiText(text.replaceAll("{…}", " ")) && !isSilentPosition(node)) add(node, text);
      node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function listFiles(root: string, entries: readonly string[]): string[] {
  const walk = (rel: string): string[] => {
    const full = path.join(root, rel);
    if (statSync(full).isDirectory())
      return readdirSync(full).flatMap((n) => walk(path.join(rel, n)));
    return /\.(tsx?|mts)$/.test(rel) ? [rel] : [];
  };
  return entries.flatMap(walk).sort();
}

export function scanFiles(root: string, files: readonly string[]): Literal[] {
  return files.flatMap((f) => scanSource(f, readFileSync(path.join(root, f), "utf8")));
}
