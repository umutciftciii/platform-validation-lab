/**
 * ML-12c (DP-243): the CMS texts that @dream/contracts defines (section types, field labels and
 * hints, registry notes, menu target problems) in the UI language. The contracts stay English;
 * a text is found by its English value in `content.contract` (lib/i18n/messages/content/en/
 * contract.ts) and shown in the UI language. A text that is not in the dictionary (a newer
 * contract) is shown as it is, so a screen never loses a label. Plain module: server and client.
 */
import { en } from "./i18n/messages/en";
import type { MessageKey, Translate } from "./i18n/types";

const KEY_OF = new Map<string, MessageKey>();
for (const [group, items] of Object.entries(en.content.contract))
  for (const [name, value] of Object.entries(items as Record<string, string>))
    if (!KEY_OF.has(value)) KEY_OF.set(value, `content.contract.${group}.${name}` as MessageKey);

/** Whether a contract text has a dictionary entry (tests: every contract text must). */
export function hasCmsText(text: string): boolean {
  return KEY_OF.has(text);
}

/** A contract text in the UI language (English: the text itself). */
export function cmsText(text: string, t: Translate): string;
export function cmsText(text: string | undefined, t: Translate): string | undefined;
export function cmsText(text: string | undefined, t: Translate): string | undefined {
  if (text === undefined) return undefined;
  const key = KEY_OF.get(text);
  return key ? (t as (k: MessageKey) => string)(key) : text;
}
