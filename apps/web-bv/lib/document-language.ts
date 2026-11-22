/**
 * ML-9 (DP-240, ADR-028 D10): the language of a technical document on a public page.
 *
 * Files are not translated: every document has the language of its file (`PublicDocument.language`)
 * and its title and description are written in it. A page lists the documents in its own language
 * and, as the fallback, the site's default language (API). The page names a document's language
 * as the language names itself ("English", "Nederlands"; `lang` set to the document's language,
 * like the language selector), so a Dutch visitor sees that a file is English, and the label is
 * never the page's language by accident.
 *
 *  - On the default language's pages (English) nothing changes while a document is in English:
 *    no label, no `lang` (the pages of before ML-9, byte for byte).
 *  - On any other page every document is labelled, the Dutch ones too, so both can be told apart
 *    when a product has a Dutch and an English file of the same type.
 */
import { DEFAULT_LOCALE, ROUTE_LOCALES, languageName, type RouteLocale } from "./locale-routing.ts";

/** The language as it names itself; a tag the site has no route for falls back to Intl. */
export function documentLanguageName(tag: string): string {
  if ((ROUTE_LOCALES as readonly string[]).includes(tag)) return languageName(tag as RouteLocale);
  try {
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
    if (name && name !== tag) return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
  } catch {
    // not a tag Intl knows: the tag itself
  }
  return tag;
}

/** Whether the page names the document's language (see the module comment). */
export function showsDocumentLanguage(pageLocale: RouteLocale, documentLanguage: string): boolean {
  return pageLocale !== DEFAULT_LOCALE || documentLanguage !== pageLocale;
}

/** The `lang` of a document's title and description: only when it differs from the page's. */
export function documentLang(pageLocale: RouteLocale, documentLanguage: string): string | undefined {
  return documentLanguage === pageLocale ? undefined : documentLanguage;
}
