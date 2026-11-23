/**
 * Admin UI language (ML-11, ADR-028 D15). Plain module, safe for server and client components.
 * Server components get the request's language from lib/i18n/server.ts; client components from
 * components/i18n/locale-provider.tsx.
 */
export * from "./config";
export * from "./format";
export { createTranslator, DICTIONARIES, interpolate, lookup, pluralCategory } from "./translate";
export type { MessageKey, Messages, PluralForms, Translate } from "./types";
