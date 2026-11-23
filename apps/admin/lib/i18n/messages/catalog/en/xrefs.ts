/**
 * ML-12a: English UI texts of the cross-references (components/catalog/cross-reference-manager.tsx)
 * and the global brand catalogue (components/catalog/global-catalog.tsx,
 * app/(console)/products/brands/page.tsx), moved verbatim.
 */
export const xrefs = {
  /** Cross-reference status (contracts CROSS_REFERENCE_STATUS_LABELS). */
  status: {
    SIMILAR: "Similar",
    PENDING_VERIFICATION: "Awaiting verification",
    VERIFIED: "Verified",
    REMOVED: "Removed",
  },
  /** Why a verification is stale (contracts VERIFICATION_STALE_TEXT). */
  staleReason: {
    source_revision_replaced: "The source document has a newer active revision.",
    source_document_archived: "The source document was archived.",
    specs_changed: "Our product's specifications changed after the verification.",
    global_product_changed: "The global product changed after the verification.",
    global_product_archived: "The global product or its brand is archived.",
  },
  /** A cross-reference on one site (CrossReferenceSite state). */
  siteState: {
    shown: "Shown",
    hidden: "Not shown",
    not_publishable: "Cannot be shown",
    verification_stale: "Hidden: verification stale",
    product_not_live: "Product not live",
  },
  /** History entries (ProductCrossReference event action). */
  action: {
    CREATED: "Created",
    UPDATED: "Changed",
    VERIFICATION_REQUESTED: "Verification requested",
    VERIFIED: "Verified",
    VERIFICATION_REJECTED: "Verification rejected",
    MARKED_SIMILAR: "Marked similar",
    VERIFICATION_RESET: "Changed (verification reset)",
    REMOVED: "Removed",
    RESTORED: "Restored",
  },
  /** CrossReferenceManager: intro, list and notices. */
  manager: {
    introSimilar: "Similar",
    introSimilarText: " is a staff judgement.",
    introVerified: "Verified",
    introVerifiedText:
      " needs a technical comparison, a source document of this product and a second person who may approve. A site shows a cross-reference only when its publisher enables it; a stale verification is never shown.",
    globalBrands: "Global brands",
    add: "Add cross-reference",
    added: "Cross-reference to {brand} {product} added as similar.",
    empty: "No cross-references yet.",
    emptyHint: " Add one to relate this product to another brand's product.",
    removed: "Removed ({n})",
  },
  /** AddForm. */
  addForm: {
    title: "Add cross-reference",
    chooseFirst: "Choose the global product first.",
    globalProduct: "Global product",
    globalProductHint:
      "Search by brand, manufacturer, product or grade. Missing? Add it under Global brands.",
    placeholder: "e.g. Example Base 6",
    results: "Search results",
    searching: "Searching…",
    noMatch: "No match.",
    taken: " · already cross-referenced",
    submit: "Add as similar",
  },
  /** Fields shared by the add and edit forms. */
  fields: {
    explanation: "Explanation (internal)",
    comparison: "Technical comparison (internal)",
    comparisonHint:
      "Required before verification: properties, values and test methods you compared.",
  },
  /** Reason forms (reject, mark similar, remove). */
  reason: {
    label: "{title}: reason",
    reject: { title: "Reject the verification", button: "Reject", done: "Verification rejected." },
    "mark-similar": {
      title: "Mark as similar again",
      button: "Mark similar",
      done: "Marked as similar.",
    },
    remove: {
      title: "Remove the cross-reference",
      button: "Remove",
      done: "Cross-reference removed.",
    },
  },
  /** XrefCard: one cross-reference. */
  card: {
    staleVerification: "Verification stale",
    globalArchived: "Global product archived",
    comparison: "Technical comparison",
    source: "Source: {type} · {title} · revision {revision}",
    notActiveRevision: "(no longer the active revision)",
    preview: "Preview",
    previewSr: " the source document (opens in a new tab)",
    requestedBy: "Requested by {name} · {date}",
    verifiedBy: "Verified by {name} · {date}",
    ownChange: "You requested or changed this relation, so another approver must decide.",
    waitingApprover: "Waiting for a person who may approve product data.",
    sites: "Sites",
    saved: "Cross-reference saved.",
    savedSimilarAgain: "Saved; the relation is similar again.",
    editWarning: "Saving a change makes this relation similar again; it needs a new verification.",
    save: "Save",
    requested: "Verification requested.",
    noSources:
      "Upload a technical document for this product first (Documents section): the verification needs its active revision as evidence.",
    sourceDocument: "Source document",
    sourceDocumentHint:
      "The active revision is recorded; a newer revision later makes the verification stale.",
    note: "Note for the approver (optional)",
    requestVerification: "Request verification",
    comparisonFirst: "Add the technical comparison first (Edit).",
    verified: "Cross-reference verified.",
    verify: "Verify",
    reject: "Reject",
    verifyAgain: "Verify again",
    markSimilar: "Mark similar",
    edit: "Edit",
    remove: "Remove",
    restored: "Restored as similar.",
    restore: "Restore",
    cancel: "Cancel",
    history: "History ({n})",
  },
  /** SiteRow: a cross-reference on one site. */
  site: {
    shownAs: {
      VERIFIED: "as verified",
      SIMILAR: "as similar",
    },
    hidden: "Hidden on {site}.",
    hide: "Hide on {site}",
    show: "Show on {site}…",
    enabledByPublisher: "Enabled by the site publisher",
    notEnabled: "Not enabled",
    shownDone: "Shown on {site}; your confirmation is recorded.",
    responsibility: "Publishing responsibility",
    recorded:
      "Your name, the time and the statement version ({version}) are recorded in the audit trail.",
    confirm: "Confirm and show on {site}",
  },
  /** Global brands page (app/(console)/products/brands/page.tsx). */
  brandsPage: {
    title: "Global brands",
    noAccessTitle: "No access to the product catalogue",
    noAccessText: "Your roles do not include reading products on any site.",
    back: "All products",
    description:
      "Other manufacturers' brands and products (with grade) that our products are cross-referenced with. Shared by both sites; archived, never deleted.",
    panelTitle: "Brands",
    panelDescription: "Search, add and maintain brands; open a brand to manage its products.",
    loadError: "The global brands could not be loaded",
    tryAgain: "Try again in a moment.",
  },
  /** GlobalCatalogManager and its brand/product forms (components/catalog/global-catalog.tsx). */
  brands: {
    count: { one: "{count} brand", other: "{count} brands" },
    shown: " · {n} shown",
    filter: "Filter brands",
    filterPlaceholder: "Filter by brand or manufacturer",
    newBrand: "New brand",
    createBrand: "Create brand",
    created: "Brand {name} created.",
    empty: "No global brands yet.",
    noMatch: "No brand matches the filter.",
    brandName: "Brand name",
    manufacturer: "Manufacturer",
    country: "Country (ISO code)",
    countryHint: "Two letters, e.g. NL, GB, US.",
    notes: "Notes (internal)",
    cancel: "Cancel",
    archiveConfirm:
      "Archive {name}? Its products can no longer be cross-referenced or shown, and verified cross-references to them become stale.",
    archived: "Brand archived.",
    restored: "Brand restored.",
    archivedPill: "Archived",
    productCount: { one: " · {count} product", other: " · {count} products" },
    hideProducts: "Hide products",
    products: "Products",
    edit: "Edit",
    restore: "Restore",
    archive: "Archive",
    saveBrand: "Save brand",
    savedBrand: "Brand saved.",
    loading: "Loading…",
    noProducts: "No products of this brand yet.",
    addProduct: "Add product",
    productAdded: "{name} added.",
    productName: "Product name",
    grade: "Grade",
    gradeHint: "e.g. SAE 5W-30, ISO VG 46, Group III.",
    description: "Description (internal)",
    productArchived: "Product archived.",
    productRestored: "Product restored.",
    saveProduct: "Save product",
    productSaved: "Product saved. Verified cross-references to it need a new verification.",
  },
} as const;
