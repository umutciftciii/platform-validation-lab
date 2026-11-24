/**
 * ML-12e (DP-243): English messages of the Leads area. Moved verbatim from the components, so the
 * English console renders exactly as before ML-12e (test/leads-en.test.tsx).
 *
 * Data is never in here: names, companies, e-mail addresses, messages, subjects, document titles,
 * site names, consent versions and hashes, locale tags and API codes are shown as stored.
 */
export const leads = {
  // --- Labels shared by the screens (lib/leads-view.ts), keyed by the API's codes ---------------
  status: {
    NEW: "New",
    CONTACTED: "Contacted",
    QUALIFIED: "Qualified",
    UNQUALIFIED: "Unqualified",
    CONVERTED: "Converted",
  },
  /** What each status means for the sales team (shown as a hint). */
  statusHint: {
    NEW: "Not yet worked.",
    CONTACTED: "We reached out or spoke with them.",
    QUALIFIED: "A real opportunity. Kept out of automatic anonymisation.",
    UNQUALIFIED: "Not a fit. Can be reopened.",
    CONVERTED: "Became a customer. Final; kept out of automatic anonymisation.",
  },
  source: {
    DOCUMENT_REQUEST: "Document request",
    CONTACT_FORM: "Contact form",
  },
  /** The staff e-mail of a contact-form message. */
  notification: {
    PENDING: "E-mail pending",
    SENT: "Staff e-mailed",
    SKIPPED: "No e-mail",
    FAILED: "E-mail failed",
  },
  /** Reason codes of a skipped or failed notification (inside a sentence, lower case). */
  notificationReason: {
    disabled: "notifications are off for this site",
    no_recipients: "nobody on the list can read this site's leads",
    transport_off: "e-mail delivery is off in this environment",
    smtp_auth: "the mail server refused our login",
    smtp_rejected: "the mail server refused the e-mail",
    smtp_deferred: "the mail server asked us to try later",
    smtp_timeout: "the mail server did not answer in time",
    smtp_unavailable: "the mail server could not be reached",
    smtp_error: "the e-mail could not be sent",
  },
  channel: {
    EMAIL: "E-mail",
    PHONE: "Phone",
    MEETING: "Meeting",
    OTHER: "Other",
  },
  docType: {
    TDS: "Technical data sheet",
    SDS: "Safety data sheet",
    COA: "Certificate of analysis",
    OTHER: "Document",
  },
  /** ML-10: the language of a form or legal text (the stored tag itself never changes). */
  language: {
    en: "English",
    nl: "Dutch",
    notRecorded: "English (not recorded, before ML-10)",
  },
  /** "1 lead", "1,234 leads" (`n` is the formatted number). */
  count: { one: "{n} lead", other: "{n} leads" },
  /** DP-227: what the export would download, said before the click (`leads` = count above). */
  exportSummary: {
    noneFiltered: "No leads match these filters, so there is nothing to export.",
    none: "There are no leads to export yet.",
    tooMany:
      "{leads} match. One export holds at most {max}; narrow the filters (for example the dates) to export.",
    filtered: "{leads} match these filters and will be exported.",
    total: "{leads} in total and will be exported.",
  },

  // --- Texts used on several lead screens --------------------------------------------------------
  common: {
    noAccess: "No access to leads",
    anonymised: "Anonymised lead",
    allLeads: "All leads",
    tryAgainLater: "Try again in a moment.",
    unassigned: "Unassigned",
    assignedTo: "Assigned to",
  },

  // --- Leads list (app/(console)/leads/page.tsx) ---------------------------------------------------
  list: {
    title: "Leads",
    description:
      "People who wrote through a site's contact form or requested a lead-gated document, newest first. Work them through the sales pipeline. Customer data: every view is audited.",
    notifications: "Notifications",
    shown: "{n} shown",
    shownMore: "{n} shown, more on the next page",
    noAccessText:
      "Leads are customer data. Platform administrators read them; other staff need a role with lead access (Sales / CRM user for one site, or the customer-data officer), which an administrator gives under Staff and access. Every view is recorded in the audit log.",
    loadError: "The leads could not be loaded",
    filterLabel: "Filter leads",
    searchLabel: "Search by name, company or e-mail",
    searchPlaceholder: "Search name, company or e-mail",
    site: "Site",
    allSites: "All my sites",
    status: "Status",
    anyStatus: "Any status",
    source: "Source",
    anySource: "Any source",
    anyone: "Anyone",
    assignedToMe: "Assigned to me",
    apply: "Apply",
    createdFrom: "Created from",
    createdTo: "Created to",
    clearFilters: "Clear filters",
    exportUnavailable:
      "The export is unavailable: the lead count could not be loaded (HTTP {status}).",
    noMatches: "No matching leads",
    noMatchesText: "Try another search, filter or date range.",
    empty: "No leads yet",
    emptyText: "Contact-form messages and document requests from the public sites appear here.",
    noLongerAccess: " (no longer has access)",
    hold: "Hold",
    marketingOk: "Marketing OK",
    freeMail: "Free mail",
    documentRequests: {
      one: "{count} document request",
      other: "{count} document requests",
    },
    firstPage: "First page",
    nextPage: "Next page",
  },

  // --- One lead (app/(console)/leads/[id]/page.tsx) -------------------------------------------------
  detail: {
    title: "Lead",
    noAccessText: "Leads are customer data and need a customer-data role.",
    /** DP-096: why a lead is kept outside the 24-month retention rule. */
    hold: {
      CUSTOMER: "customer",
      OPEN_OPPORTUNITY: "open opportunity",
      LEGAL_HOLD: "legal hold",
    },
    source: "Source: {source}",
    anonymisedAt: "Anonymised {date}",
    retentionHold: "Retention hold: {reason}",
    marketingConsentAt: "Marketing consent {date}",
    noMarketingConsent: "No marketing consent",
    freeMail: "Free-mail address",
    pipeline: "Sales pipeline",
    offPipeline: "Off the pipeline; can be reopened as Contacted or Qualified.",
    workflow: {
      title: "Sales workflow",
      assignedTo: "Assigned to {name}",
      assignedToInactive: "Assigned to {name} (no longer has access to this site's leads)",
      notAssigned: "Not assigned yet.",
      heldCustomer:
        "A customer: kept out of the automatic 24-month anonymisation while in this status.",
      heldOpportunity:
        "An open opportunity: kept out of the automatic 24-month anonymisation while in this status.",
      anonymised:
        "This lead is anonymised; its status and history are kept as a record and cannot change.",
      readOnly:
        "You can read this lead. Changing its status or assignment needs a sales role for this site.",
    },
    /** The sales history (newest first). */
    activity: {
      title: "Activity",
      description: "Notes, contacts, status and assignment changes: who did what, and when.",
      note: "Note",
      contact: "Contact · {channel}",
      otherChannel: "other",
      status: "Status {from} → {to}",
      assigned: "Assigned to {name}",
      unassignedWas: "Unassigned (was {name})",
      empty: "No sales activity yet.",
      by: "by {name}",
      tookPlace: " · took place {date}",
      redacted: "Text cleared when the lead was anonymised.",
    },
    contact: {
      title: "Contact",
      email: "E-mail",
      company: "Company",
      country: "Country",
      requests: "Requests",
      requestsValue: "{count} · first {date}",
    },
    messages: {
      title: "Contact form messages",
      description:
        "Each message keeps the details as submitted and the privacy notice shown with the form (evidence, never edited).",
      cleared: "Message cleared",
      noSubject: "No subject",
      clearedText: "Cleared when the lead was anonymised.",
      clearedTextAt: "Cleared when the lead was anonymised ({date}).",
      submittedAs: "Submitted as",
      submittedCleared: "cleared, {country}",
      staffEmail: "Staff e-mail",
      sent: {
        one: "Sent to {count} person on {date}",
        other: "Sent to {count} people on {date}",
      },
      retry: "Waiting to retry (attempt {attempt} failed: {reason})",
      waiting: "Waiting to be sent",
      notSent: "{status}: {reason}. The message itself is stored here.",
      failed: {
        one: "{status}: {reason} after {count} attempt. The message itself is stored here.",
        other: "{status}: {reason} after {count} attempts. The message itself is stored here.",
      },
      unknownReason: "unknown reason",
      formLanguage: "Form language",
      noticeShown: "Privacy notice shown",
      /** The legal text's version and its language; the version itself is data. */
      version: "version {version} ({language})",
      empty: "No message from the contact form.",
    },
    requests: {
      title: "Downloaded documents and request history",
      description:
        "Each request keeps the details and consent as submitted (evidence, never edited).",
      empty: "No document requests.",
      revision: "{type} · revision {revision}",
      reference: "reference",
      cleared: "cleared",
      notice: "Privacy notice",
      marketingConsent: "Marketing consent",
      consentGiven: "given (version {version})",
      consentGivenIn: "given (version {version}, {language})",
      consentNotGiven: "not given",
      grant: "Downloads {count} of {max} · link valid until {date}",
      stampedCopy: "stamped copy",
      hashCleared: "(hash cleared)",
      notDownloaded: "Not downloaded.",
    },
  },

  // --- Sales workflow forms (components/leads/lead-workflow.tsx) ----------------------------------
  workflow: {
    label: "Change status or assignment",
    moveTo: "Move to",
    keepHint: "Leave as is to change only the assignment.",
    keep: "Keep {status}",
    final: "{status} (final)",
    assigneeHint: "Only staff who work leads of this site are listed.",
    currentNoAccess: "Current assignee (no longer has access)",
    me: " (me)",
    meButton: "Me",
    note: "Note with this change (optional)",
    notePlaceholder: "Why the status changes, what was agreed…",
    save: "Save change",
    saved: "Saved. The change is in the activity history.",
    activity: {
      label: "Add a note or record a contact",
      entryType: "Entry type",
      note: "Note",
      contact: "Contact",
      channel: "Channel",
      when: "When",
      summary: "Summary",
      hint: "Visible to staff who read this site's leads. Cleared when the lead is anonymised.",
      notePlaceholder: "What the team should know…",
      contactPlaceholder: "What was discussed, next steps…",
      addNote: "Add note",
      recordContact: "Record contact",
      whenRequired: "Enter when the contact took place.",
      noteAdded: "Note added.",
      contactRecorded: "Contact recorded.",
    },
  },

  // --- CSV export (components/leads/lead-export.tsx, lib/leads-client.ts) -------------------------
  export: {
    region: "Export leads",
    separator: "Separator",
    /** DP-229: the separator choices; the values `;` and `,` themselves never change. */
    separators: {
      semicolon: {
        label: "Semicolon (;)",
        hint: "Opens in columns in Excel with Dutch or Turkish settings.",
      },
      comma: {
        label: "Comma (,)",
        hint: "For Excel with English settings, Google Sheets and other tools.",
      },
    },
    buttonTitle: "Download the filtered leads as a CSV file",
    needsPermission: "Needs the lead export permission",
    busy: "Exporting…",
    button: "Export CSV",
    noPermission:
      "Exporting needs the lead export permission (customer-data officer or platform administrator). Every export is recorded in the audit log.",
    stepUpLabel: "Confirm the export",
    code: "Authenticator code",
    codeHint: "Exporting customer data needs a fresh confirmation.",
    confirm: "Confirm and export",
    cancel: "Cancel",
    done: "Downloaded {file} with {leads}.",
    errors: {
      tooManyRows:
        "Too many leads for one file (at most {max}). Narrow the filters, for example by date.",
      beforeFrom: "The end date is before the start date.",
      unreachable: "The admin API cannot be reached. Check the connection and try again.",
      failedHttp: "The export failed (HTTP {status}). Try again in a moment.",
      /** Appended to every API refusal: support finds the request by its id. */
      ref: " (HTTP {status}, {code}, request {requestId})",
      separator: "Choose a separator: semicolon (;) or comma (,).",
      forbidden:
        "You may not export these leads. Exporting needs the lead export permission (customer-data officer or platform administrator) on every selected site.",
      session: "Your session has ended. Sign in again.",
      failed: "The export failed.",
      interrupted:
        "The download was interrupted before the file was complete. Nothing was saved; try again.",
    },
  },

  // --- Contact-form notifications (leads/notifications/page.tsx, notification-settings.tsx) -------
  notifications: {
    title: "Lead notifications",
    description:
      "E-mail the sales team when someone writes through a site's contact form. Every message is stored as a lead first; the e-mail only points to it.",
    transport: {
      capture:
        "This environment does not send real e-mail: notifications are recorded and kept inside the platform for testing.",
      off: "E-mail delivery is off in this environment: notifications are recorded as not sent.",
    },
    forbiddenTitle: "Only lead managers change notifications",
    forbiddenText:
      "Staff who work a site's leads (Sales / CRM user there) and platform administrators choose who is e-mailed about new contact-form messages.",
    loadError: "The settings could not be loaded",
    lastChanged: "Last changed {date}.",
    lastChangedBy: "Last changed {date} by {name}.",
    notSetUp: "Not set up yet: no e-mail is sent.",
    last30: "Last 30 days",
    last30Label: "Notifications of the last 30 days",
    form: {
      label: "Notifications for {site}",
      enable: "E-mail staff about new contact-form messages",
      enableHint:
        "The e-mail says only that a message arrived and links to the lead here. Names, e-mail addresses and the message stay in the CRM.",
      who: "Who gets the e-mail",
      whoCount: "({n} of at most {max})",
      nobody:
        "Nobody can read this site's leads yet. Give someone a lead role under Staff and access first.",
      noLeadAccess: "No lead access",
      onlyReaders:
        "Only staff who can read this site's leads are listed. If someone loses that access, they stop getting the e-mail at once.",
      save: "Save",
      undo: "Undo changes",
      chooseOne: "Choose at least one person, or switch the e-mail off.",
      saved: "Saved. New messages follow these settings.",
    },
  },
} as const;
