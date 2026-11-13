/**
 * Placeholder for the typed CMS block registry (ADR-002, backlog DP-015).
 *
 * F0-002 deliberately defines no CMS, product or locale models. Sites and locales
 * will be managed as data (decision K-04), so nothing here hard-codes a locale list.
 */
export const CONTENT_SCHEMA_VERSION = "0.0.0";

/** Site keys of the two public apps. Domains and locales come from the database later. */
export type SiteKey = "bv" | "corporate";
