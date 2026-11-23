/**
 * ML-12a: English UI texts of the Publication tab — review flow, review history and the per-site
 * publication cards (components/catalog/workflow.tsx) and the languages of one site's publication
 * (components/catalog/language-publication.tsx). Moved verbatim.
 */
export const workflow = {
  /** ReviewPanel: the master's review (submit, approve, request changes, withdraw). */
  review: {
    progressAria: "Review progress",
    masterVersion: "Master version {version}",
    directOnly: "You publish directly on every site you can open, so no review is needed.",
    submitted: "Submitted",
    submittedMeta: "{when} · version {version}",
    notYet: "Not yet",
    lastApproval: "Last approval",
    approvedMeta: "{when} · version {version}",
    approvedMetaStale: "{when} · version {version} (no longer current)",
    neverApproved: "Never approved",
    blocking: {
      one: "{count} blocking issue in the saved data: it cannot be submitted or approved.",
      other: "{count} blocking issues in the saved data: it cannot be submitted or approved.",
    },
    warnings: {
      one: "No blocking issue in the saved data; {count} warning for the reviewer.",
      other: "No blocking issue in the saved data; {count} warnings for the reviewer.",
    },
    clean: "The saved data has no blocking issue and no warning.",
    validationReport: "Validation report (Technical)",
    approvedNote:
      "Approved in version {version}. Any change to the master, its specifications or images returns it to draft; the live sites keep the approved snapshot.",
    /** Why the caller cannot decide (reviewBlockedReason). */
    blocked: {
      own_change:
        "You changed or submitted this revision, so another reviewer must decide (separation of duties).",
      no_permission: "Waiting for a reviewer with platform-wide product approval.",
      archived: "Archived products are not reviewed.",
      fallback: "You cannot decide on this review.",
    },
    noteLabel: "Note for the reviewer",
    commentLabel: "Review comment",
    optional: "(optional)",
    requiredForChanges: "(required to request changes)",
    notePlaceholder: "What changed, what to check…",
    commentPlaceholder: "Reason, or what has to change…",
    commentTooShort: "Say what has to change (at least 3 characters).",
    submit: "Submit for review",
    approve: "Approve",
    requestChanges: "Request changes",
    withdraw: "Withdraw from review",
    done: {
      submitted: "Submitted for review.",
      approved: "Product master approved.",
      changesRequested: "Changes requested.",
      withdrawn: "Review withdrawn.",
    },
  },
  /** ReviewHistory: one line per review or publication event. */
  history: {
    empty: "No review or publication yet.",
    /** The API's fixed history note of a direct publication (DIRECT_PUBLICATION_NOTE, DP-193). */
    directNote: "Direct publication: published without a second-person technical review (DP-193).",
    action: {
      SUBMITTED: "Submitted for review",
      WITHDRAWN: "Withdrawn from review",
      APPROVED: "Approved",
      CHANGES_REQUESTED: "Changes requested",
      REVIEW_RESET: "Returned to draft by a change",
      PUBLISHED: "Published",
      UNPUBLISHED: "Unpublished",
    },
    publishedDirectly: "Published directly",
    onSite: " on {site}",
    version: " · version {version}",
  },
  /** IssueList: the link to the tab where an issue is fixed. */
  issues: {
    goTo: "Go to {tab}",
  },
  /** SiteCard: one site's publication. */
  site: {
    noSites: "You cannot read any site of this product.",
    publishedBy: "Published {when} by {name}",
    unpublished: "Unpublished",
    unpublishedAt: "Unpublished {when}",
    unpublishedBy: "Unpublished by {name}",
    unpublishedAtBy: "Unpublished {when} by {name}",
    lastPublished: "Last published {when}",
    hidden: "Not shown on this site at the moment. Last published {when}.",
    notListed: "{site} does not list this product.",
    listFirst: "To publish it here, list it on {site} first. ",
    goToContent: "Go to Content",
    listNeedsRights: "Listing it here needs edit rights on this site.",
    never: "Never published on this site.",
    outdated:
      "Changes since publication are not live yet: the site shows the published version until it is republished.",
    nextAddress: {
      republish: "Address after republishing",
      publish: "Address after publishing",
    },
    alsoNeeded: "Publishing here would also need:",
    blocked: {
      republish: "Republishing is blocked:",
      publish: "Publishing is blocked:",
    },
    upToDate: "Live and up to date.",
    ready: {
      republish: "Ready to republish.",
      publish: "Ready to publish.",
    },
    attention: {
      upToDate: "Notes on the live version:",
      republish: "Check before republishing:",
      publish: "Check before publishing:",
    },
    moreNotes: {
      one: "{count} more note (not blocking)",
      other: "{count} more notes (not blocking)",
    },
    preview: "Preview",
    /** planPublication(...).publishLabel — the identifier stays English, the button text is this. */
    publishLabel: {
      Publish: "Publish",
      Republish: "Republish",
    },
    unpublish: "Unpublish",
    reasonSummary: "Reason for unpublishing (optional)",
    reasonAria: "Reason for unpublishing on {site}",
    done: {
      published: "Published on {site}.",
      republished: "Republished on {site}.",
      unpublished: "Unpublished on {site}.",
    },
    noPreview: {
      bv: "Preview needs publishing or content review rights on this site.",
      other: "Preview is available for the BV site only.",
    },
    rights: {
      direct:
        "You publish this version directly; no second review is needed. Unpublishing takes it off the site at once.",
      approved: "Publishes the approved version. Unpublishing takes it off the site at once.",
      needsApproval: "Publishing needs an approved master (second-person review).",
      noPublisher: "Publishing on this site needs the publisher role of the site.",
    },
  },
  /** LanguageChoices (language-publication.tsx): the languages of one site's publication. */
  languages: {
    title: "Languages",
    notPublic: "Not public yet",
    preview: "Preview {name}",
    closePreview: "Close {name} preview",
    defaultLanguage: "Always published from the current texts (the default language).",
    publishWith: "Publish the current {name} texts with this publication",
    chosen: "The {name} texts saved now are published.",
    keepLive: "Not chosen: the live {name} texts stay exactly as published.",
    noneLive: "Not chosen: no {name} texts are published.",
    needs: "{name} needs before publishing:",
    claims:
      "The {name} text mentions {claims}: publish it only with a certificate or source document.",
    manualCheck:
      "I checked the {name} text by hand for claims that need a certificate or source document (SAF, pharmaceutical, food contact, CTL, approvals, environmental claims). The automatic check knows English words only.",
  },
  /** LanguagePreview: one language as the next publication would carry it, next to the live one. */
  languagePreview: {
    aria: "{name} preview",
    title: "Preview · {name} ({short})",
    loading: "Loading…",
    notPublic: "{name} is not public: visitors cannot open these pages yet.",
    manual: "No reviewed {name} claim check exists yet: read the text for claims yourself.",
    found: "Found: {claims}.",
    next: "Next publication",
    notPublishable: "Not publishable in {name} yet:",
    live: "Live now",
    nothingLive: "Nothing live in {name}.",
  },
  /** SnapshotView: the fields of one language's snapshot. */
  snapshot: {
    name: "Name",
    summary: "Summary",
    description: "Description",
    category: "Category",
    specNames: "Specification names",
    imageAlts: "Image alt texts",
    seo: "SEO title / description",
  },
} as const;
