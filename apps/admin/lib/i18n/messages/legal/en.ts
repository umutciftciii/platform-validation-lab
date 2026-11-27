/**
 * DP-298 (ADR-031): English messages of the data-processing screens — Content > Legal texts
 * (app/(console)/legal-texts), the Consents panel of a lead and the AI providers' data-processing
 * terms (AI Center > Providers). Version names, SHA-256 values, permission keys and the API's
 * blocker lines are data and are shown unchanged.
 */
export const legal = {
  texts: {
    metaTitle: "Legal texts",
    title: "Legal texts",
    description:
      "The privacy policy, the form notices and the consent texts, per language. The forms and the privacy page always use the current published version.",
    loadError: "The legal texts could not be loaded",
    loadErrorText: "Try again in a moment.",
    noAccessTitle: "No access to the legal texts",
    noAccessText:
      "Reading the legal texts needs legal_text:edit or legal_text:publish. Ask the system owner for access.",
    immutable:
      "Published versions are evidence and never change: a form stores the version and SHA-256 of the exact words it showed. To change a text, start a new draft from the current version and publish it as a new version.",
    readOnly:
      "You can read the legal texts. Drafts need legal_text:edit; publishing and recording the legal review need legal_text:publish.",
    markupHelp:
      "Privacy policy markup: a line {heading} starts a section, a blank line starts a new paragraph, a line starting with {item} is a list item.",
    blockers: {
      title: "Production blockers",
      description:
        "What still blocks publication of the privacy page and the forms in production. Local and staging environments show them as drafts.",
      none: "Nothing blocks production publication.",
      pill: "Blocks production",
    },
    kinds: {
      POLICY: "Policy",
      NOTICE: "Notice (information, not consent)",
      CONSENT: "Consent (optional, withdrawable)",
    },
    documents: {
      PRIVACY_POLICY: "Privacy Policy",
      DOCUMENT_REQUEST_NOTICE: "PDF download data processing notice",
      CONTACT_NOTICE: "Contact & lead processing notice",
      MARKETING_CONSENT: "Optional marketing consent",
      AI_PROCESSING_NOTICE: "AI-assisted processing notice",
      AI_PROCESSING_CONSENT:
        "AI-assisted processing consent (only if the legal review requires consent)",
      INTERNATIONAL_TRANSFER_NOTICE: "International transfer notice",
      INTERNATIONAL_TRANSFER_CONSENT: "International transfer consent (exception only)",
    },
    places: {
      PRIVACY_POLICY: "Used on /privacy (BV and corporate site)",
      DOCUMENT_REQUEST_NOTICE: "Used on the document request form (required acknowledgement)",
      CONTACT_NOTICE: "Used on the contact form (shown, no checkbox)",
      MARKETING_CONSENT: "Used on the document request form (optional, unticked)",
    },
    usedByOther: "Used by:",
    futureUse: "Prepared for future use — shown nowhere",
    languages: {
      en: "English",
      nl: "Dutch",
      tr: "Turkish",
      de: "German",
      fr: "French",
    },
    languageLabel: "Language",
    current: {
      title: "Current version",
      none: "Not published",
      version: "Version {version}",
      sha: "SHA-256 fingerprint",
      publishedBy: "Published by {name} on {date}",
      publishedAt: "Published on {date}",
      reviewNote: "Review note",
      translates: "Translation of {version}",
      viewText: "View text",
    },
    review: {
      REQUIRED: "Legal review required",
      APPROVED: "Legal review approved",
      approvedBy: "Approved by {name} on {date}",
      approvedAt: "Approved on {date}",
      record: "Record legal review",
      recordLabel: "Record legal review: {document} ({language}) {version}",
      confirmTitle: "Record the legal review?",
      confirmText:
        "This records that a legal reviewer approved these exact words ({version}, SHA-256 {hash}). Any later change is a new version that needs its own review.",
      confirm: "Record approval",
      recorded: "Legal review recorded.",
    },
    draft: {
      title: "Draft",
      none: "No draft",
      unnamed: "Draft (named when published)",
      edited: "Last edited {date} · revision {revision}",
      createdBy: "Started by {name}",
      newDraft: "New draft",
      newFromCurrent: "New draft from current",
      newLabel: "New draft: {document} ({language})",
      edit: "Edit draft",
      editLabel: "Edit draft: {document} ({language})",
      newTitle: "New draft: {document} ({language})",
      editTitle: "Edit draft: {document} ({language})",
      text: "Text",
      textHint: "At most {max} characters. Line breaks are kept.",
      chars: "{count} of {max} characters",
      reviewNote: "Note for the reviewers",
      placeholders: "Placeholders this document may use:",
      noPlaceholders: "This document uses no placeholders.",
      reviewNoteHint: "What the legal reviewers should check. Never published.",
      translates: "This is a translation of the current English version ({version})",
      save: "Save draft",
      create: "Create draft",
      saved: "Draft saved.",
      created: "Draft created.",
      stale:
        "Someone changed this draft meanwhile. The latest saved text is loaded now; check it and save again.",
      loading: "Loading the text…",
      loadFailed: "The text could not be loaded.",
      delete: "Delete draft",
      deleteLabel: "Delete draft: {document} ({language})",
      deleteTitle: "Delete this draft?",
      deleteText:
        "The draft is removed. Published versions are not affected. This cannot be undone.",
      deleted: "Draft deleted.",
      resetsReview: "Saving a change resets the legal review of the draft to required.",
    },
    publish: {
      action: "Publish",
      label: "Publish: {document} ({language})",
      title: "Publish {document} ({language})?",
      text: "Publishing freezes exactly the words below as a new version. It can never be edited or deleted afterwards; the forms and pages use it from then on.",
      hash: "Exactly this text is published: SHA-256 {hash}",
      confirm: "Publish version",
      published: "Published as version {version}.",
      reviewPending:
        "Its legal review is still required: production publication stays blocked until it is recorded.",
    },
    history: {
      title: "History",
      show: "History",
      showLabel: "History: {document} ({language})",
      description:
        "Every version of {document} in {language}, newest first. Published versions never change.",
      empty: "No versions yet.",
      back: "All legal texts",
      loadError: "The history could not be loaded.",
      status: {
        DRAFT: "Draft",
        PUBLISHED: "Published",
      },
    },
    rules: {
      stale:
        "The text changed meanwhile (someone saved the draft). Reload the page and check the latest text.",
      draft_exists: "There is already a draft for this text and language. Edit that draft instead.",
      published: "This version is already published and can no longer be changed.",
      already_approved: "The legal review of this version is already recorded.",
      db_guard: "The database refused the change. Reload the page and try again.",
      required: "The text is empty.",
      too_long: "The text is too long for this document.",
      text_before_section:
        "Line {line}: text before the first section. Start the policy with a line {heading}.",
      duplicate_id: "Line {line}: this section id is used twice. Every section id must be unique.",
      empty: "The policy needs at least one section (a line {heading}).",
      published_source_of_same_document:
        "A translation must name the published version of the same document in another language.",
      unknown_placeholder:
        "{name} is not a placeholder this document may use. Remove it, or use one listed above the text.",
      missing_value:
        "{name} has no value yet, so this text cannot be published. The value must be supplied first.",
    },
    preview: {
      title: "Preview (as it will be shown)",
      hint: "Filled with the current company and legal details, by the same code as the website.",
      missingTitle: "Missing values",
      missingHint:
        "Shown as “[pending: …]”. While a value is missing, the forms and the privacy page stay unpublished in production.",
      none: "No value is missing.",
      blocked: "Publishing is refused now: {reason}",
    },
    api: {
      unreachable: "The server could not be reached. Check your connection and try again.",
      failed: "The change could not be saved.",
      forbidden: "You do not have permission for this action.",
    },
    common: {
      cancel: "Cancel",
      close: "Close",
    },
  },
  consents: {
    title: "Consents",
    description:
      "Optional, separate and withdrawable consents of this lead, one record per grant or withdrawal. Notices are information, not consent, and are listed with each request.",
    purposes: {
      MARKETING_EMAIL: "Marketing e-mail",
      AI_PERSONAL_DATA: "AI processing of personal data",
      INTERNATIONAL_TRANSFER: "International transfer",
    },
    state: {
      GRANTED: "Granted",
      WITHDRAWN: "Withdrawn",
      none: "Never given",
    },
    since: "Since {date}",
    currentLabel: "Current state per purpose",
    history: "History",
    historyEmpty: "No consent records yet.",
    granted: "Granted via {source}",
    textVersion: "Consent text {version}",
    withdrawn: "Withdrawn · received by {channel}",
    by: "Recorded by {name}",
    sources: {
      DOCUMENT_REQUEST: "document request form",
      CONTACT_FORM: "contact form",
      STAFF: "staff",
      PUBLIC_LINK: "public link",
      MIGRATION: "data migration",
    },
    channels: {
      EMAIL: "E-mail",
      PHONE: "Phone",
      WRITTEN: "Letter or written form",
      IN_PERSON: "In person",
      OTHER: "Other",
    },
    withdraw: "Withdraw consent",
    withdrawLabel: "Withdraw consent: {purpose}",
    withdrawTitle: "Withdraw consent: {purpose}?",
    withdrawText:
      "Records that the person withdrew this consent. It applies from now on; the earlier grant stays in the history as evidence.",
    channel: "How did the withdrawal reach us?",
    confirm: "Record withdrawal",
    withdrawnOk: "Withdrawal recorded.",
    loadError: "The consents could not be loaded.",
    readOnly: "Recording a withdrawal needs lead:manage on this lead's site.",
    noticeAcknowledged: "Notice acknowledged (information, not consent)",
    rules: {
      not_granted: "This consent is not granted at the moment, so there is nothing to withdraw.",
      anonymised: "This lead is anonymised; its consents can no longer be changed.",
      db_guard: "The database refused the change. Reload the page and try again.",
    },
  },
  aiTerms: {
    title: "Personal data",
    none: "Personal data: not allowed (no terms recorded)",
    recorded: "Data-processing terms recorded",
    alone:
      "Terms alone enable nothing: a task that handles personal data also needs an approved processing purpose.",
    loadError: "The data-processing terms could not be loaded.",
    fields: {
      dpaReference: "DPA reference",
      dpaSignedOn: "DPA signed on",
      transferMechanism: "Transfer mechanism (GDPR, Chapter V)",
      kvkkTransferMechanism: "Transfer mechanism (KVKK Art. 9)",
      dataRegion: "Data region",
      retentionSetting: "Retention setting at the provider",
      noTraining: "The provider does not use the data for training",
    },
    confirmed: "Confirmed",
    hints: {
      dpaReference: "The data processing agreement (GDPR Art. 28): its name, number or link.",
      dataRegion: "Where the provider processes the data, for example “EU”.",
      retentionSetting: "For example “zero data retention” or “30 days”.",
      noTraining: "Required: terms cannot be recorded without it.",
    },
    gdpr: {
      EEA_ONLY: "Processed in the EEA only",
      ADEQUACY: "Adequacy decision",
      EU_US_DPF: "EU-US Data Privacy Framework",
      SCC: "Standard contractual clauses",
    },
    kvkk: {
      NOT_APPLICABLE: "Not applicable",
      ADEQUACY: "Adequacy decision",
      STANDARD_CONTRACT_NOTIFIED: "Standard contract notified to the Authority",
      EXPLICIT_CONSENT: "Explicit consent (occasional exception)",
    },
    recordedBy: "Recorded by {name} on {date}",
    revokedAt: "Revoked on {date}",
    earlier: { one: "{count} earlier record", other: "{count} earlier records" },
    record: "Record terms",
    replace: "Replace terms",
    formTitle: "Data-processing terms: {provider}",
    formText:
      "Record what was agreed with the provider before any AI task may send it personal data.",
    saved: "Terms recorded.",
    revoke: "Revoke terms",
    revokeLabel: "Revoke terms: {provider}",
    revokeTitle: "Revoke the data-processing terms?",
    revokeText:
      "No AI task may send personal data to this provider any more. The record stays in the history.",
    revoked: "Terms revoked.",
    rules: {
      no_terms: "No terms are recorded for this provider.",
    },
  },
} as const;
