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
