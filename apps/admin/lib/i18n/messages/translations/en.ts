/**
 * ML-13b (DP-244): Admin > Translations — translation packages (ML-13a): export, dry run, import
 * as drafts. English is the source; Turkish in ./tr.ts. Status, filter and rule keys are the API's
 * codes (contracts `TRANSLATION_UNIT_STATUSES`, the unit rules of the ML-13a API); permission keys,
 * language tags, unit keys and file names stay as they are.
 */
export const translationPackages = {
  metaTitle: "Translations",
  title: "Translations",
  description:
    "Export a site's texts as a translation package, have it translated, and import the reviewed package. Imported translations are saved as drafts only.",
  rulesNote:
    "An import writes drafts only: nothing is published and the target language is not opened to visitors. Every package is checked first (a dry run that changes nothing); you then confirm the import of the valid translations.",
  loadError: "Translations could not be loaded",
  tryAgain: "The admin service did not answer as expected. Try again in a moment.",
  noAccessTitle: "No site to translate",
  noAccessText:
    "Your roles do not let you read content or products on any site. Ask a platform administrator for access.",
  limits:
    "A package may hold up to {units} texts and be at most {mb} MB. Larger sites: export CMS and catalogue separately.",
  types: {
    cms: "CMS",
    catalog: "Catalogue",
    cmsHint: "Pages, articles, menus and fragments with their titles, addresses and SEO texts.",
    catalogHint:
      "Listing texts and their SEO texts, categories, specification names and image alt texts.",
    noRead: "You cannot read this part on this site.",
  },
  export: {
    title: "Export a package",
    intro:
      "Choose the site, the target language and the parts. The package holds every text of the source language with the current translation, if any; translators fill in the target texts only.",
    site: "Site",
    source: "Source language",
    sourceHint: "Always the site's default language.",
    target: "Target language",
    targetHint: "Any enabled language other than the default.",
    notPublicOption: "{locale} (not public)",
    notPublicHint:
      "{locale} is not public: imported translations stay invisible to visitors until the language is opened separately.",
    noTargets: "This site has no other enabled language to translate into.",
    types: "Parts",
    pickType: "Choose at least one part.",
    run: "Export package",
    running: "Exporting…",
    done: "Package downloaded: {units} texts, {pages} CMS pages.",
  },
  import: {
    title: "Import a translated package",
    intro:
      "Pick a package file exported here and filled in by the translators. It is checked first; nothing is written until you confirm.",
    file: "Package file (JSON, at most {mb} MB)",
    reading: "Reading the file…",
    packageLabel: "Loaded package",
    fileName: "File",
    siteAndLanguages: "Site and languages",
    contents: "Contents",
    unitCount: { one: "{count} text", other: "{count} texts" },
    filledCount: { one: "{count} translated", other: "{count} translated" },
    exportedAt: "Exported",
    otherSite:
      "This package belongs to a site you cannot see here. The check will tell whether you may use it.",
    nothingFilled:
      "No text in this package has a translation yet: the check will report every text as empty.",
    assists: "Translation assistants",
    assistFailed: "The assistant could not propose translations. The package is unchanged.",
    check: "Check package (dry run)",
    checking: "Checking…",
    checkHint: "Read only: nothing is written.",
  },
  file: {
    empty: "The file is empty.",
    too_large: "The file is larger than {mb} MB. Export CMS and catalogue as separate packages.",
    not_json: "The file is not valid JSON.",
    not_package: "The file is not a translation package of this console.",
    version: "This package version is not supported. Export a new package.",
    schema: "The package does not match the expected format.",
    schemaAt:
      "The package does not match the expected format (at {paths}). Translators may only change the target texts.",
  },
  report: {
    checkTitle: "Check result",
    doneTitle: "Import result",
    checkSummary:
      "Can be imported as drafts: {writable} of {total} texts. To be skipped: {skipped}. Nothing has been written.",
    doneSummary: "Draft rows written: {written}. Texts skipped: {skipped}. Nothing was published.",
    writtenLabel: "Written drafts",
    missingPermissions:
      "You can check this package but not import it. Missing permissions: {permissions}.",
    filterLabel: "Filter by result",
    filterChip: "{label} ({n})",
    search: "Search texts and keys",
    noUnits: "The package holds no texts.",
    noMatch: "No text matches this filter.",
    pages: "Pages of the table",
    previous: "Previous",
    next: "Next",
    pageOf: "Page {page} of {pages} · {count} texts",
    import: {
      one: "Import {count} translation as draft…",
      other: "Import {count} translations as drafts…",
    },
    another: "Import another package",
    download: "Download report (JSON)",
    doneNote:
      "Review the drafts in Content and Products before publishing them there. Importing the same package again writes nothing twice.",
    cannotImport: "Ask for the missing permissions, or have someone who holds them import.",
    nothingToImport: "Nothing to import: no new or changed valid translation.",
    draftOnly: "Only valid translations are written, to drafts. You confirm in the next step.",
  },
  written: {
    cmsPagesCreated: "CMS pages created",
    cmsPagesUpdated: "CMS pages updated",
    listings: "Listings",
    categories: "Categories",
    specs: "Specifications",
    images: "Images",
  },
  table: {
    status: "Result",
    text: "Text",
    source: "Source text",
    translation: "Translation",
    reason: "Reason",
    current: "Current: {text}",
  },
  pages: {
    summary: { one: "{count} CMS page", other: "{count} CMS pages" },
    create: "New draft page",
    update: "Draft updated",
    unchanged: "Unchanged",
    skipped: "Skipped",
    fragment: "(fragment without address)",
  },
  confirm: {
    title: "Import translations as drafts?",
    text: {
      one: "{count} valid translation will be written to drafts in {locale}. Texts skipped: {skipped}.",
      other:
        "{count} valid translations will be written to drafts in {locale}. Texts skipped: {skipped}.",
    },
    drafts:
      "Only drafts change: missing CMS pages are created as draft pages, catalogue texts go to the language rows the next publication reads.",
    noPublish:
      "Nothing is published, and {locale} is not opened to visitors. Publishing stays a separate step.",
    skipped:
      "Outdated, conflicting, invalid and missing texts are left out; the report lists them.",
    recheck:
      "If something changed since the check, the whole import is refused and nothing is written.",
    ack: {
      one: "I want to write this {count} translation to drafts.",
      other: "I want to write these {count} translations to drafts.",
    },
    cancel: "Cancel",
    run: {
      one: "Import {count} translation",
      other: "Import {count} translations",
    },
    running: "Importing…",
  },
  status: {
    create: "New",
    update: "To update",
    unchanged: "Unchanged",
    empty: "Empty",
    outdated: "Outdated",
    conflict: "Conflict",
    invalid: "Invalid",
    not_found: "Not found",
  },
  filters: {
    all: "All",
    create: "New",
    update: "To update",
    unchanged: "Unchanged",
    outdated: "Outdated",
    conflict: "Conflicting",
    invalid: "Invalid",
    not_found: "Not found",
    empty: "Empty",
    skipped: "Skipped",
  },
  rules: {
    source_changed: "The source text changed after the export. Export a new package.",
    source_removed: "The source text no longer exists.",
    source_unpublished:
      "The source page is not live any more; only published pages are translated.",
    target_changed:
      "The translation was changed in the console after the export; it is not overwritten.",
    structure: "The translated page's sections no longer match the source page.",
    archived: "The product is archived.",
    too_long: "The translation is longer than the field allows.",
    control_characters: "The translation contains control characters.",
    format: "The address is not valid.",
    schema: "The translated content is not valid for this section.",
    title_required: "A new page needs a translated title.",
    name_required: "A name is required.",
    nothing_to_write: "Nothing to write for this page.",
    page_missing: "The source page no longer exists.",
    registry_taken: "This page already exists in the target language.",
    duplicate_slug: "The same address is used twice in the package.",
    slug_taken: "The address is already taken in the target language.",
    path_taken: "The page's address is already taken in the target language.",
    old_address: "The address is kept as the redirect of a moved page.",
  },
  api: {
    unreachable: "The admin service could not be reached or did not answer in time. Try again.",
    locked:
      "This content is locked by another operation right now. Nothing was written; try again in a moment.",
    databaseBusy:
      "The database did not answer in time. Nothing was written; try again in a moment.",
    importUnknown:
      "The import stopped with an unexpected error. Its outcome is unknown: run the check again before importing again (a repeated import writes nothing twice).",
    importNoAnswer:
      "The import did not answer in time. It may still have finished: run the check again before importing again (a repeated import writes nothing twice).",
    forbidden: "You are not allowed to read these parts of this site.",
    importForbidden: "You do not hold every permission this package needs. Nothing was written.",
    siteNotFound: "The site of this package was not found.",
    tooLarge: "The package is larger than 4 MB. Export CMS and catalogue as separate packages.",
    hashMismatch:
      "Source or current texts in the file were changed. Translators may only change the target texts; export a new package.",
    siteMismatch: "The package names another site.",
    isSource: "The target language is the site's default language.",
    notEnabled: "The target language is not enabled on this site.",
    sourceChanged: "The site's default language changed since the export. Export a new package.",
    conflict: "This is not possible in the current state.",
    importStale:
      "Texts changed while importing, so the whole import was refused and nothing was written. Run the check again.",
    invalid: "The package is not valid.",
    invalidAt: "The package is not valid (at {paths}).",
    failed: "The request failed. Try again.",
  },
} as const;
