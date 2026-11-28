/**
 * COM-2a: what the corporate sections need besides the CMS content, as pure functions the
 * components use (components/template-sections.tsx) and `node --test` checks.
 *
 *  - Paragraphs: a CMS text is plain text; a blank line starts a new paragraph (no HTML, ever).
 *  - Images (DP-320): only a registered asset of THIS site is shown; anything else (a BV file, an
 *    unknown path, no image) is no image, and the section is laid out without one. The corporate
 *    site has no registered images until their rights are confirmed (COM-2 plan, owner input 1).
 *  - Map (owner decision 2026-11-27): a plain link to a map search for the published address,
 *    opened in a new tab; no embedded map (no third-party request, no cookies) until COM-6.
 *
 * Pure (no Next.js, no `@/` imports) so `node --test` runs it as is.
 */
import { cmsSiteAsset, type CmsStaticAsset } from "@dream/contracts";

/** The paragraphs of a plain CMS text (blank line = new paragraph; empty ones dropped). */
export function paragraphsOf(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** The corporate site's own registered image at `src`; null for anything else. */
export function corporateImage(src: string | null | undefined): CmsStaticAsset | null {
  if (!src) return null;
  const asset = cmsSiteAsset(src, "CORPORATE");
  return asset?.kind === "image" ? asset : null;
}

const MAPS_SEARCH = "https://www.openstreetmap.org/search";

/**
 * A link to a map search for the address (company name and address lines as published), or
 * null without an address. OpenStreetMap: no account, no tracking parameters.
 */
export function mapHref(company: string, addressLines: readonly { text: string }[]): string | null {
  const address = addressLines
    .map((l) => l.text.trim())
    .filter(Boolean)
    .join(", ");
  if (!address) return null;
  const query = [company.trim(), address].filter(Boolean).join(", ");
  return `${MAPS_SEARCH}?query=${encodeURIComponent(query)}`;
}

/**
 * COM-2b (DP-002): the typical values table of the portfolio is on the page only with at least
 * one row; the import leaves it empty until the source of the values is approved.
 */
export function showsTypicalValues(table: { rows: readonly unknown[] }): boolean {
  return table.rows.length > 0;
}

/** COM-2b: grade names alone are a compact list; with a type or description, cards. */
export function gradeLayout(
  items: readonly { type: string | null; description: string | null }[],
): "none" | "chips" | "cards" {
  if (!items.length) return "none";
  return items.every((i) => !i.type && !i.description) ? "chips" : "cards";
}

/**
 * COM-7: a CMS text of the live site whose list lines start with "• " (COM-5), as paragraphs and
 * list items, so a card shows a real list instead of bullet characters. Plain text only.
 */
export function textBlocks(text: string | null | undefined): TextBlock[] {
  const out: TextBlock[] = [];
  for (const para of paragraphsOf(text)) {
    const lines = para.split("\n").map((l) => l.trim());
    const bullets = lines.filter((l) => l.startsWith("•"));
    if (bullets.length && bullets.length === lines.length) {
      out.push({ kind: "list", items: bullets.map((l) => l.replace(/^•\s*/, "")) });
    } else {
      out.push({ kind: "p", text: para });
    }
  }
  return out;
}
export type TextBlock = { kind: "p"; text: string } | { kind: "list"; items: string[] };

/**
 * COM-7: whether a content page opens with a full-width picture (its first section is a hero
 * with a registered corporate image): the header then lies over it.
 */
export function opensWithPicture(
  sections: readonly { type: string; image?: string | null }[],
): boolean {
  const first = sections[0];
  return first?.type === "hero" && corporateImage(first.image) !== null;
}
