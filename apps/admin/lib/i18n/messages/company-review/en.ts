/**
 * ML-12b (DP-243): the Company Review area — the proposal list, the proposal page and its four
 * tabs, the decision form, the proposed-text editor, and the research notes the product page shows
 * on its Technical tab. Every English value is the text the screens showed before ML-12b, word for
 * word (recorded on 7b543f6, test/company-review-en.test.tsx and company-review-ui-literals.test.ts).
 *
 * Not in here, on purpose: data (product names and codes, research items, sources, comments,
 * proposed texts, people's names, site names), API enums (REVIEW_PENDING, DP002_HELD, …) and the
 * API's own messages, which the console translates by code (lib/catalog-client.ts).
 */
export const companyReview = {
  /** Page titles and the back link. */
  title: "Company review",
  allProposals: "All proposals",

  /** Proposal states (lib/proposals-view.ts STATUS_META); the API value stays the enum. */
  status: {
    REVIEW_PENDING: "Review pending",
    CHANGES_REQUESTED: "Changes requested",
    APPROVED: "Approved",
  },
  statusHint: {
    REVIEW_PENDING: "Waiting for the company's decision.",
    CHANGES_REQUESTED: "The company asked for changes; the editor revises the proposal.",
    APPROVED: "Approved by the company. Not published and not a technical approval.",
  },

  /** Why the signed-in user cannot decide (the API's `decisionBlocked`). */
  blocked: {
    no_permission: {
      title: "You can read this proposal but cannot decide on it",
      body: "Your role can read this proposal but cannot decide on it. Approving or requesting changes needs the proposal review permission for this site; ask a site administrator if you should review proposals.",
    },
    not_in_review: {
      title: "Nothing to decide right now",
      body: "There is nothing to decide right now: the proposal is not waiting for review. It returns to review when the editor revises it.",
    },
    own_change: {
      title: "Another reviewer must decide",
      body: "You wrote this revision, so another reviewer must decide (separation of duties). This rule applies to every role.",
    },
    unknown: {
      title: "You cannot decide on this proposal",
      body: "You cannot decide on this proposal.",
    },
  },

  /** Review item kinds (KIND_META); the API value stays the enum. */
  kind: {
    CONFIRM: "Question to confirm",
    INCONSISTENCY: "Inconsistency",
    DP002_HELD: "Held for verification (DP-002)",
    SITE_VALUE_WITHHELD: "Not imported from current site",
    CLASS_CONFLICT: "Classification conflict",
    CLAIM_RISK: "Claim risk",
    MISSING_DOCUMENT: "Missing document",
    PLACEHOLDER: "Placeholder product",
  },

  /** Review sections (REVIEW_SECTIONS), by section id. */
  section: {
    attention: {
      title: "Conflicts and placeholders",
      description:
        "Points where the current data, its class label or the product itself is in doubt.",
    },
    claims: {
      title: "Claim risks",
      description: "Wording that needs a certificate or other evidence before it can be published.",
    },
    questions: {
      title: "Questions to confirm",
      description: "Please confirm or correct these points in your comment.",
    },
    documents: {
      title: "Missing documents",
      description: "Original documents that do not exist in the catalogue yet.",
    },
  },

  /** Source levels of the research (SOURCE_LEVEL_TEXT); the level letter stays. */
  sourceLevel: {
    A: "A · manufacturer's own document",
    B: "B · standard or regulation",
    C: "C · other producer (plausibility only)",
    D: "D · site-generated summary (not original)",
    E: "E · trader or marketplace (not evidence)",
  },

  /** A current specification value (formatSpecValue): "3.8 to < 4.5 mm²/s", "Yes". */
  spec: {
    range: "{from} to {to}",
    yes: "Yes",
    no: "No",
  },

  /** Counts written into sentences and badges. */
  count: {
    conflicts: { one: "{count} conflict", other: "{count} conflicts" },
    questions: { one: "{count} question", other: "{count} questions" },
    heldValues: { one: "{count} held value", other: "{count} held values" },
    missingDocuments: { one: "{count} missing document", other: "{count} missing documents" },
    products: { one: "{count} product", other: "{count} products" },
    reviewItems: { one: "{count} review item", other: "{count} review items" },
    sources: { one: "{count} source", other: "{count} sources" },
    technicalValues: { one: "{count} technical value", other: "{count} technical values" },
  },

  /** The tabs of one proposal (lib/review-tabs.ts REVIEW_TABS) and the tab bar. */
  tabs: {
    content: "Content review",
    verification: "Missing & verification",
    sources: "Sources",
    history: "History",
    label: "Review sections",
    unsaved: "Unsaved changes",
    unsavedSr: ", unsaved changes",
    leave: "You have unsaved changes to the proposed text. Leave the page and discard them?",
  },

  /** The proposal list (app/(console)/company-review/page.tsx). */
  list: {
    noAccessTitle: "No access to the company review",
    noAccessText: "Your roles do not include reading products on any site.",
    description:
      "Proposed English texts for the {site} catalogue, prepared from research. Open a product to compare the current site data with the proposal, check the open points, then approve or request changes. An approval neither publishes the product nor approves its technical data.",
    site: "Site",
    loadErrorTitle: "The proposals could not be loaded",
    loadErrorText: "Reload the page. If it keeps failing, your role may not include this site.",
    products: "Products",
    counts: "{pending} pending · {changes} with changes requested · {approved} approved",
    filterLabel: "Filter proposals",
    searchLabel: "Search by product name or SKU",
    searchPlaceholder: "Search product name or SKU",
    category: "Category",
    allCategories: "All categories",
    search: "Search",
    clear: "Clear",
    statusFilter: "Filter by review status",
    all: "All",
    categoriesIncomplete:
      "Categories of the products could not be loaded; the category filter may be incomplete.",
    showing: {
      one: "Showing {count} product of {total}",
      other: "Showing {count} products of {total}",
    },
    noMatch: "No product matches this search. Change the search or clear the filters.",
    empty: "No proposals in this view.",
    noText: "No text proposed",
  },

  /** One proposal (app/(console)/company-review/[id]/page.tsx). */
  detail: {
    loadErrorTitle: "This proposal could not be loaded",
    loadErrorText: "Your role may not include this site. Reload the page to try again.",
    sku: "SKU",
    versionHint: "Version {version} · {hint}",
    seeWhy: "See why",
    decision: "Decision",
    previewTitle: "Catalogue preview",
    previewText:
      "This product in the BV catalogue design, with the current data and the proposal apart. Read-only; the link is short-lived.",
    nav: {
      conflicts: "Conflicts",
      questions: "Questions",
      held: "Held values",
      documents: "Missing documents",
      technical: "Current technical data",
    },
    nothingToVerify:
      "The research lists no conflicts, questions, held values or missing documents for this product.",
  },

  /** Provenance tags of every section (SourceTag). */
  tag: {
    site: "From current site",
    proposal: "Research proposal — not published",
    review: "Internal review — never published",
  },

  /** Texts used in several sections. */
  notProvided: "Not provided",
  notListed: "Not listed",
  currentSite: "Current site",
  researchProposal: "Research proposal",
  noText: "No text",
  fields: {
    summary: "Short description",
    description: "Description",
  },

  /** Content Review: the current site data and the comparison (components/catalog/proposal-review.tsx). */
  current: {
    title: "Current site data",
    description:
      "The product as it is in the catalogue today. Nothing here is changed by this review.",
    loadError: "The product data could not be loaded.",
    productName: "Product name",
    sku: "SKU",
    slug: "Slug",
    category: "Category",
  },
  comparison: {
    title: "Research proposal against the current text",
    description:
      "Proposed customer text. It is applied to the site only in a later, separate step after approval.",
    empty:
      "No text is proposed for this product: it is not defined well enough to describe. It awaits the company's confirmation (see Missing & verification).",
    noTextProposed: "No text proposed",
  },
  openPoints: "Open points in the research:",
  sources: "Sources:",

  /** Missing & Verification. */
  verification: {
    navLabel: "Verification groups",
    heldTitle: "Held for verification — not product data",
    heldExtra: {
      one: "{count} conflict, listed first",
      other: "{count} conflicts, listed first",
    },
    heldDescription:
      "Values shown on the current site that were not imported: DP-002 held values (unverified or conflicting) and rows without a test method or temperature. They are not verified specifications and are not part of the product.",
    unverified: "Unverified (DP-002)",
    notImported: "Not imported",
    conflict: "Conflict",
    no: "No",
    status: "Status",
    valueAsPrinted: "Value as printed on the source",
    finding: "Finding",
    noMissingDocuments: "The research lists no missing documents.",
    documentsOnFile: "Documents on file in the catalogue",
    siteSummary: "Site-generated summary",
    notOriginal: "— not an original TDS/COA",
    noDocuments: "No documents. No original TDS, SDS or COA is on file.",
    technicalTitle: "Technical data on the current site",
    technicalDescription:
      "Transcribed from documents supplied for the current site; not cross-checked against an original technical data sheet.",
    property: "Property",
    value: "Value",
    basis: "Basis",
    testMethod: "Test method",
    typical: "Typical",
    specification: "Specification",
    none: "None",
    noTechnical: "The current site shows no technical data for this product.",
  },

  /** Sources. */
  researchSources: {
    title: "Research sources",
    description:
      "The documents the research relied on. The level says how much weight a source carries; only level A is the manufacturer's own document.",
    family: "Research family:",
    none: "The research lists no sources for this product.",
    levelNotGiven: "Level not given",
    /** Appended to the level line, so it starts with the separator. */
    citedBy: { one: " · cited by {count} review item", other: " · cited by {count} review items" },
  },

  /** History (proposal events). */
  history: {
    title: "History",
    description: "Versions, decisions and comments, newest first.",
    currentVersion: "Current version",
    writtenBy: "Written by",
    lastDecision: "Last decision",
    noDecision: "No decision yet",
    none: "No history yet.",
    version: "version {version}",
    action: {
      CREATED: "Proposal created",
      REVISED: "Revised and sent for review",
      APPROVED: "Approved",
      CHANGES_REQUESTED: "Changes requested",
    },
    textUnrecorded: "Text of this version not recorded (saved before the history kept texts).",
    textUnchanged: "Text unchanged.",
    textOfVersion: "Text of version {version}",
  },

  /** The decision form (components/catalog/proposal-decision.tsx). */
  decision: {
    unavailable: "Approve and Request changes are not available to you for this version.",
    comment: "Comment",
    commentHint: "(required to request changes, optional to approve)",
    commentPlaceholder:
      "What has to change, or answers to the questions in Missing & verification…",
    approve: "Approve",
    requestChanges: "Request changes",
    approved: "Proposal approved.",
    changesRequested: "Changes requested.",
    note: "Approving accepts the proposed text for this product. It does not publish the product and is not a technical approval of its data.",
    explain: "Explain what has to change (at least 3 characters).",
    tooLong: "Keep the explanation under {max} characters.",
  },

  /** The proposed-text editor (components/catalog/proposal-editor.tsx, lib/proposal-edit.ts). */
  editor: {
    title: "Proposed text",
    description:
      "Edit the proposed customer text next to the current site text. The site itself changes only in a later, separate step.",
    placeholderNote:
      "The research proposes no text: this product is not defined well enough to describe. Write a text only from information the company has confirmed (see Missing & verification).",
    edited: "edited",
    noTextYet: "No text yet",
    emptySaved: "Empty: saved as no text.",
    unsaved: "Unsaved changes.",
    savingApproved: "Saving creates a new version; the company's approval covers the earlier one.",
    savingCreates: "Saving creates version {version}.",
    saved: "Version {version} saved. Every version is kept in History.",
    savedAs: "Saved as version {version}.",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    tooLong: "Keep it to {max} characters (now {now}).",
    reviewNotes:
      "Review notes ([CONFIRM …]) belong in Missing & verification, not in customer text.",
    stale:
      "Someone saved a newer version of this proposal meanwhile. It is loaded now and your edits are kept: Save adds them to the newer version, Cancel discards them.",
    tooLarge:
      "This text is too long to send in one request. Shorten the description and save again.",
    forbidden: "You are not allowed to edit proposals on this site.",
  },

  /** DP-180: the research notes on the product page's Technical tab (ResearchNotes). */
  notes: {
    intro:
      "{items} and {sources} from the research for this product. Read only; nothing here is published or used as product data.",
    open: "Open in Company Review",
    held: "{values} held for verification: not verified, not in the specifications above and never published.",
    questions: "Questions for the company",
    documents: "Missing documents",
    conflicts: "Technical conflicts",
    claims: "Claim risks",
  },
} as const;
