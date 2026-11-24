/**
 * ML-12e (DP-243): English messages of the Dashboard area. Moved verbatim from the components, so the
 * English console renders exactly as before ML-12e (test/dashboard-en.test.tsx).
 */
export const dashboard = {
  /** The overview page (app/(console)/page.tsx). */
  overview: {
    title: "Overview",
    /** "Good morning, Sanne": the greeting comes from time.*, the name from the session. */
    greeting: "{greeting}, {name}",
    intro: "Pages, product data sheets and staff access for both Dream Petroleum sites.",
    writePage: "Write a page",
    sampleLabel: "Sample data.",
    sampleText:
      "Figures, activity and site status on this overview are illustrations, not connected to any system. The review queue and your session details are real.",
  },
  /** The KPI strip (components/dashboard/kpi-strip.tsx). */
  kpi: {
    title: "Last 30 days",
    trend: "Trend over 12 weeks",
    trendLabel: "{label}, 12-week trend",
  },
  /** Recent activity (components/dashboard/activity-feed.tsx). */
  activity: {
    title: "Recent activity",
    description: "Changes and access events across both sites",
    emptyTitle: "No activity yet",
    emptyText: "Publications, edits and access changes will appear here as they happen.",
  },
  /** Quick actions (components/dashboard/quick-actions.tsx), one per module. */
  quickActions: {
    title: "Quick actions",
    content: { label: "Write a page", detail: "Draft for either site" },
    products: { label: "Update a data sheet", detail: "Product specifications" },
    staff: { label: "Invite a colleague", detail: "Staff account and role" },
    audit: { label: "Open the audit log", detail: "Who changed what, when" },
  },
  /** The review queue panel (components/dashboard/product-review.tsx). */
  review: {
    title: "Waiting for review",
    description: "Product masters, oldest first",
    descriptionTotal: "Product masters, oldest first · {total} in review",
    open: "Open queue",
    forbiddenTitle: "No access to the product catalogue",
    forbiddenText:
      "Your roles do not include reading products, so there is no review queue for you.",
    errorTitle: "The review queue could not be loaded",
    errorText: "Try again in a moment.",
    emptyTitle: "Nothing waiting for review",
    emptyText: "When a product master is submitted, it appears here for approval.",
    loading: "Loading the review queue",
  },
  /** The session card (components/dashboard/session-card.tsx): the real staff session. */
  session: {
    title: "Your session",
    secondFactor: "Second factor",
    authenticator: "Authenticator",
    recoveryCode: "Recovery code",
    idle: "Signs out when idle",
    endsAt: "Session ends at",
    sensitive: "Sensitive actions",
    confirmedUntil: "Confirmed until {time}",
    askForCode: "Ask for a code",
    recoveryNote:
      "You signed in with a recovery code. Generate new recovery codes once you have your authenticator back.",
  },
  /** The site status panel (components/dashboard/site-status.tsx). */
  sites: {
    title: "Sites",
    state: { live: "Live", maintenance: "Maintenance", preparing: "In preparation" },
    /** "31 pages, 4 drafts, published 34 min ago": the numbers keep their own elements. */
    pages: "pages,",
    drafts: "drafts,",
    notPublished: "not published yet",
    published: "published {time}",
  },
  /**
   * Sample data of the design prototype (lib/demo-data.ts): illustrations, not real people or
   * figures. The names are fictitious and the same in every language.
   */
  demo: {
    kpis: {
      pages: { label: "Published pages", hint: "Across both sites" },
      products: { label: "Product data sheets", hint: "Current versions" },
      enquiries: { label: "Open enquiries", hint: "Waiting for a reply" },
      reviews: { label: "Awaiting review", hint: "Oldest submitted 3 days ago" },
    },
    people: {
      sanne: "Sanne de Vries",
      jonas: "Jonas Peters",
      lotte: "Lotte Bakker",
      mehmet: "Mehmet Kaya",
    },
    /** One event reads "<person> <text> <target>". */
    activity: {
      ev1: { text: "published", target: "Contact and offices" },
      ev2: { text: "submitted for review", target: "Quality and certification" },
      ev3: { text: "was given the editor role on", target: "Corporate site" },
      ev4: { text: "updated", target: "Base oil SN 500 data sheet" },
      ev5: { text: "set up a new authenticator", target: "own account" },
      ev6: { text: "published", target: "Marine fuels overview (draft 3)" },
    },
    sites: { corporate: "Corporate site" },
  },
} as const;
