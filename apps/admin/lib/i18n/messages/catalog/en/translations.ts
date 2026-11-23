/**
 * ML-12a: English UI texts of the ML-8b language tabs and translation editors
 * (components/catalog/translation-editor.tsx). `{name}` is the content language as a console
 * word ("English", "Dutch": catalog.common.languages via localeLabel); the content itself and the
 * EN / NL tab labels are never translated.
 */
export const translations = {
  /** LanguageTabs: the marker on the default language's tab. */
  tabs: {
    source: "source",
  },
  /** SourceText: the source column next to every field. */
  source: {
    heading: "{name} source",
    headingShared: "{name} source · shared product text",
    none: "No text in the source language.",
  },
  /** TranslationField: the marker of a field with a source text but no translation. */
  field: {
    missing: "Missing",
  },
  /** LanguageSummary: the overview at the top of a language panel. */
  summary: {
    onSite: "{name} on this site",
    public: "Public",
    notPublic: "Not public yet",
    liveHas: "The live version has {name} texts.",
    liveHasNot: "The live version has no {name} texts yet.",
    notLive: "The product is not live on this site.",
    notPublicNote:
      "Visitors cannot open {name} pages yet. Saved and published {name} texts stay visible to staff only until the language is made public.",
    requiredHeading: "Needed before {name} can be published:",
    complete: "Complete enough to publish in {name}.",
    optional: {
      one: "{count} optional text not translated yet",
      other: "{count} optional texts not translated yet",
    },
    noAutomatic:
      "No text is translated or copied automatically: empty fields stay empty until you write them. Saving never publishes.",
  },
  /** SourceToggle. */
  toggle: {
    hide: "Hide {name} source",
    show: "Show {name} source",
  },
  /** FormButtons (every editor). */
  buttons: {
    confirm: "Still correct: mark as checked",
    discard: "Discard changes",
    saving: "Saving…",
  },
  /** Read-only line when the language is off. */
  notEnabled: "{name} is not enabled on this site.",
  notEnabledAnySite: "{name} is not enabled on any of your sites.",
  /** ListingTranslationForm (Content tab). */
  listing: {
    noListing: "List the product on this site first (English tab).",
    legend: "{name} product text",
    title: "Title ({name})",
    titleHint: "Left empty, the product name is used (names and codes are not translated).",
    summary: "Summary ({name})",
    description: "Description ({name})",
    saved: "{name} product text saved.",
    checked: "{name} product text marked as checked.",
    save: "Save {name} text",
    readOnly: "Read only: editing this site's listings needs product:edit on the site.",
  },
  /** ListingSeoTranslationForm (SEO tab). */
  seo: {
    noListing: "List the product on this site first (Content tab).",
    heading: "{name} SEO texts",
    note: "Canonical path, indexing and the link preview image are the same in every language (English tab). Empty fields fall back to the {name} product title and summary on the site.",
    fields: {
      title: "SEO title ({name})",
      description: "SEO description ({name})",
      ogTitle: "Link preview title ({name})",
      ogDescription: "Link preview description ({name})",
    },
    maxHint: "At most {max} characters.",
    saved: "{name} SEO texts saved.",
    checked: "{name} SEO texts marked as checked.",
    save: "Save {name} SEO",
    readOnly: "Read only: editing this site's SEO needs product:edit on the site.",
  },
  /** CategoryTranslationForm. */
  category: {
    legend: "{name} category",
    name: "Category name ({name})",
    description: "Category description ({name})",
    descriptionHint: "Needs a name; removing the name removes the translation.",
    savedName: "{name} category name saved.",
    removedName: "{name} category name removed.",
    checked: "{name} category marked as checked.",
    save: "Save {name} category",
    readOnly: "Read only: category texts need product:edit on the site.",
  },
  /** SpecNamesTranslationForm. */
  specs: {
    empty: "This product has no technical values yet.",
    legend: "{name} specification names",
    name: "Name ({name})",
    note: "Specification names are shared by every product and site. Units, values, test methods and standards are never translated.",
    saved: {
      one: "{count} {name} specification name saved.",
      other: "{count} {name} specification names saved.",
    },
    checked: {
      one: "{count} {name} name marked as checked.",
      other: "{count} {name} names marked as checked.",
    },
    save: "Save {name} names",
    readOnly: "Read only: specification names need product master edit rights.",
  },
  /** ImageAltTranslationForm. */
  images: {
    empty: "This product has no images.",
    legend: "{name} image alt texts",
    hidden: "hidden",
    alt: "Alt text ({name})",
    note: "Alt texts belong to the shared product: changing one resets an approval of the product master, as an English alt text does.",
    saved: {
      one: "{count} {name} alt text saved.",
      other: "{count} {name} alt texts saved.",
    },
    checked: {
      one: "{count} {name} alt text marked as checked.",
      other: "{count} {name} alt texts marked as checked.",
    },
    save: "Save {name} alt texts",
    readOnly: "Read only: alt texts need product master edit rights.",
  },
} as const;
