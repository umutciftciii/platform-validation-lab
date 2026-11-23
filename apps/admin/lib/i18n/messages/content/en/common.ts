/**
 * ML-12c (DP-243): words shared by the Content screens — page kinds, who manages a route, the
 * publication state, the translation state of a language and the site's language states. Every
 * value is the text the screens showed before ML-12c, word for word. API values stay codes
 * (`DESIGN`, `PUBLISHED`, `outdated`).
 */
export const common = {
  /** components/cms/parts.tsx CmsKindPill. */
  kind: {
    TEMPLATE: "Template page",
    DESIGN: "Designed page",
    FRAGMENT: "Site-wide part",
  },
  /** components/cms/parts.tsx RegistryPill: routes not (yet) in the CMS. */
  registry: {
    fragment: "Site-wide part",
    template: "Content page",
    design: "Designed page",
    readyToImport: " · ready to import",
    notBuiltYet: " · not built yet",
    stage: " · {stage}",
    contract: "Legal text, versioned",
    catalog: "Product catalogue",
  },
  /** components/cms/parts.tsx publicationState. */
  publication: {
    draft: "Draft, not published",
    unpublished: "Unpublished",
    changed: "Live, changes not published",
    live: "Live",
  },
  /** The state of a page in one language (lists, language tabs). */
  translationState: {
    missing: "Not translated",
    draft: "Draft",
    published: "Published",
    outdated: "Published, out of date",
    draftOutdated: "Draft, out of date",
  },
  /** A fragment has no address (lists and editor header). */
  siteWidePart: "Site-wide part",
  /** components/cms/site-languages.tsx: the site's languages, read only (ML-1). */
  siteLanguages: {
    title: "Site languages",
    description:
      "Read only. Content in an enabled language can be drafted, previewed and published; a language that is not public is never shown to visitors.",
    empty: "No languages recorded for this site",
    list: "Languages of {site}",
    default: "Default",
    public: "Public on the site",
    notPublic: "Not public",
    editingOff: "Editing off",
  },
} as const;
