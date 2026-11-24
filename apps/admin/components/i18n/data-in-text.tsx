/**
 * DP-272: a translated sentence with one piece of data in it, the data marked with the language
 * it is written in. With a Turkish UI the page is `lang="tr"`, and CSS `text-transform: uppercase`
 * follows the Turkish rule (i → İ): an English menu label "Services" inside an uppercase heading
 * became "SERVİCES". The data piece gets its own `lang` (the content language), so the browser
 * capitalises it by that language's rule ("SERVICES") and a screen reader reads it in that
 * language; the UI words around it keep the Turkish rule ("ALT MENÜSÜ"). Nothing in the data or
 * the message changes, only how it is shown.
 *
 * Usage: `<DataInText text={t(key, { label: DATA_SLOT })} data={item.label} lang={contentLocale} />`.
 * The message keeps its `{label}` placeholder and its word order in every language.
 *
 * Translate-safe (DP-196/DP-199): the three spans are always rendered, so a change only updates
 * their text nodes in place; nothing is inserted before or removed next to a text node.
 */

/** Placeholder value put into the message where the data goes (a private-use character). */
export const DATA_SLOT = "";

export function DataInText({ text, data, lang }: { text: string; data: string; lang: string }) {
  const at = text.indexOf(DATA_SLOT);
  const before = at < 0 ? text : text.slice(0, at);
  const after = at < 0 ? "" : text.slice(at + DATA_SLOT.length);
  return (
    <>
      <span>{before}</span>
      <span lang={lang}>{at < 0 ? "" : data}</span>
      <span>{after}</span>
    </>
  );
}
