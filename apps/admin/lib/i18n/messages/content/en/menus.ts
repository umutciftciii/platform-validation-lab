/** ML-12c (DP-243): see the file's sections. Every English value is the text of before ML-12c. */
export const menus = {
  /** components/cms/menu-editor.tsx TARGET_LABEL: the kinds of target in the target picker. */
  target: {
    page: "CMS page",
    product: "Product",
    category: "Product category",
    path: "Site path or anchor",
    url: "External address",
    none: "Not ready yet (text)",
  },
  /** A content reference's kind inside a sentence (target status, reference conversion). */
  kind: {
    page: "page",
    product: "product",
    category: "category",
  },
  /** Shared by the header and footer editors. */
  shared: {
    pendingNote: "Note on links that are not ready yet",
    button: "Button",
    shownOnSite: "Shown on the site",
    heading: "Heading",
    label: "Label",
  },
  /** NavEditor: the header menu (bv.site-nav). */
  nav: {
    title: "Header menu",
    description: {
      one: "{count} of at most {max} items, in this order on the site. Each item may have a submenu.",
      other:
        "{count} of at most {max} items, in this order on the site. Each item may have a submenu.",
    },
    item: "Item {n}",
    submenuOf: "Submenu of “{label}”",
    submenuLink: "Submenu link {n}",
    noSubmenu: "No submenu: the item is a plain link.",
    addSubmenuLink: "Add submenu link",
    addItem: "Add menu item",
    contactTitle: "Contact button",
    contactDescription:
      "The button at the right of the header and at the bottom of the phone menu.",
    noScriptTitle: "Links without JavaScript",
    noScriptDescription:
      "Shown on phones and tablets only when JavaScript is off. Real destinations only: a link that is not ready is left out.",
    link: "Link",
    addLink: "Add link",
    textsTitle: "Texts",
  },
  /** FooterEditor: the footer (bv.site-footer). */
  footer: {
    callTitle: "Headline and button",
    headline: "Headline",
    intro: "Intro",
    contactTitle: "Contact details",
    contactDescription:
      "Keep address, phone and e-mail identical to the company's official details.",
    company: "Company",
    addressLines: "Address lines",
    addressLine: "Address line {n}",
    removeAddressLine: "Remove address line {n}",
    addAddressLine: "Add address line",
    phone: "Phone",
    email: "E-mail",
    shownAs: "Shown as",
    phoneHref: "Link (tel:)",
    emailHref: "Link (mailto:)",
    note: "Note",
    columnsTitle: "Link columns",
    columnsDescription: {
      one: "{count} of at most {max} columns, in this order on the site.",
      other: "{count} of at most {max} columns, in this order on the site.",
    },
    column: "Column {n}",
    moveColumnUp: "Move column {n} up",
    moveColumnDown: "Move column {n} down",
    removeColumn: "Remove column {n}",
    columnShown: "Column shown",
    link: "Link",
    addLink: "Add link",
    addColumn: "Add column",
    socialTitle: "Social media",
    socialDescription:
      "Shown under the contact details, as text links. None is shown while the list is empty.",
    network: "Network",
    /** The network `other`; the network names themselves are brand names and stay in the code. */
    networkOther: "Other",
    socialUrl: "Address (https://)",
    moveSocialUp: "Move social link {n} up",
    moveSocialDown: "Move social link {n} down",
    removeSocial: "Remove social link {n}",
    noSocial: "No social media links.",
    addSocial: "Add social link",
    legalTitle: "Copyright and legal links",
    copyright: "Copyright line",
    legalLink: "Legal link",
    addLegalLink: "Add legal link",
    privacyNote:
      "The Privacy Policy link is hidden automatically where the policy is not published.",
  },
  /** LinkList and LinkEditor: one link of a menu. */
  link: {
    noLinks: "No links.",
    hidden: "Hidden",
    /** `{title}` is the link's title in lower case ("item 2", "button"). */
    moveUp: "Move {title} up",
    moveDown: "Move {title} down",
    remove: "Remove {title}",
    newTab: "Open in a new tab",
  },
  /** TargetStatus: what a link opens now. */
  status: {
    none: "Shown as text with the note on links that are not ready yet.",
    reference: "Opens {href} now. Follows the {kind}'s address when it changes.",
    fixed: "Opens {href} (fixed address).",
  },
  /** TargetPicker. */
  picker: {
    legend: "Target",
    kind: "Kind of target",
    page: "Page",
    pageMissing: "Page no longer available",
    pageNotLive: "{title} — {path} (not live)",
    product: "Product",
    productMissing: "Product not available",
    productNotLive: "{name} (not live)",
    category: "Category",
    categoryMissing: "Category no longer available",
    categoryOption: "{prefix}{name} ({count} live)",
    path: "Site path or anchor",
    pathPlaceholder: "/products or #services",
    url: "External address",
    urlPlaceholder: "https://, mailto: or tel:",
    none: "No link yet: shown as text.",
  },
  /** StructurePreview and PreviewLink. */
  structure: {
    title: "Structure",
    description:
      "What the site shows with this draft: hidden links struck through, each link with the address it opens now. Use Preview for the real page.",
    problems: {
      one: "{count} link to check:",
      other: "{count} links to check:",
    },
    notReady: "text (not ready yet)",
    hidden: "hidden",
    newTab: "new tab",
    checkTarget: "check target",
    columnHidden: "{title} (hidden)",
  },
  /** ReferencePanel: the reference conversion. */
  references: {
    title: "Content references",
    description:
      "Links to pages, products and categories follow their address when a slug changes. This finds fixed site paths that can become such references; every address stays the same.",
    none: "Every link that can be a content reference already is one.",
    count: {
      one: "{count} fixed path can become content references:",
      other: "{count} fixed paths can become content references:",
    },
    change: "→ {kind} “{name}”",
    apply: "Use content references in the draft",
    note: "Changes the draft only. Save, preview and publish as usual; the live menu changes when you publish.",
  },
  /** Where a link is ("Header › Products › Base oils"): the words of @dream/contracts navLinks/footerLinks `place`. */
  place: {
    header: "Header",
    footer: "Footer",
    noScript: "Links without JavaScript",
    contactButton: "contact button",
    button: "button",
    legal: "legal",
  },
} as const;
