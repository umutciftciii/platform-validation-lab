/**
 * ML-6 (DP-138, ADR-028 D11): the English site UI dictionary of the BV site — the SOURCE of the
 * dictionary type. Every interface string of the public site's code lives here: navigation and
 * footer controls, breadcrumbs, catalogue and product labels, documents, forms, validation and
 * error messages, empty and unavailable states, the 404 page, accessibility labels and the fixed
 * metadata titles. Content managed in the CMS or the catalogue (texts, menus, product data) is NOT
 * here (ML-7, ML-8); neither are the versioned legal texts of @dream/contracts (ML-10, D12).
 *
 * Values are plain strings, so a part of the dictionary can be passed to a client component as a
 * prop (serialisable). `{name}` is a placeholder (`interpolate`, `Rich`); a `{ one, other }` pair
 * is a plural (`plural`). The English values are the texts the site rendered before ML-6, word for
 * word (`/en` output is unchanged; lib/i18n/i18n.test.mts holds them against a frozen snapshot).
 *
 * Pure module: no Next.js, no `@/` imports, no "use client" — server and client code import it.
 */
import { XREF_PUBLIC_LABELS, xrefPublicNotice } from "@dream/contracts";

export const en = {
  common: {
    home: "Home",
    products: "Products",
    contact: "Contact",
    tryAgain: "Please try again in a moment.",
    select: "Select…",
    sending: "Sending…",
    /** Honeypot field (hidden from people and assistive technology). */
    website: "Website",
    readPrivacyPolicy: "Read the Privacy Policy",
  },

  meta: {
    notFound: "Page not found | Dream Petroleum BV",
    articleRemoved: "{title} · Dream Petroleum BV",
    products: "Products | {site}",
    productsDescription: "Published products of {site}.",
    productFallback: "Product | Dream Petroleum BV",
    documentRequest: "Request a document | Dream Petroleum BV",
    privacy: "Privacy Policy | Dream Petroleum BV",
  },

  /** The frame of every page: navigation controls (the items come from the CMS). */
  nav: {
    openMenu: "Open menu",
    closeMenu: "Close menu",
    mainLabel: "Main",
    menuLabel: "Site menu",
    /** DP-219: the button that opens a submenu. */
    openSubmenu: "Show submenu of {label}",
    newTab: "(opens in a new tab)",
    languageLabel: "Language",
    /** ML-7: the language selector's button ("{language}": the current language's own name). */
    languageButton: "Language: {language}",
    /** ML-7: next to a language that is not open to visitors yet. */
    languageSoon: "Coming soon",
  },

  footer: {
    homeLabel: "back to top of page",
    navLabel: "Footer",
    legalLabel: "Legal",
    socialLabel: "Social media",
    newTab: "(opens in a new tab)",
  },

  /** The frame of the catalogue pages while the CMS cannot be read (PM-3), and the breadcrumb. */
  shell: {
    breadcrumb: "Breadcrumb",
    homeLink: "Dream Petroleum BV home",
    copyright: "© 2026 Dream Petroleum BV",
    privacyPolicy: "Privacy Policy",
  },

  home: {
    hero: {
      skip: "Skip the ICCSYN animation",
    },
    previewBanner:
      "Preview of a draft. Not published, not indexed; this link expires after 15 minutes.",
    unavailable: {
      notFoundTitle: "This page is not available",
      notFoundText: "It is not published at the moment.",
      errorTitle: "This page cannot be shown right now",
      errorText: "Please try again in a moment.",
    },
    productGroups: {
      previous: "Previous product group",
      next: "Next product group",
      pause: "Pause automatic rotation",
      play: "Start automatic rotation",
      slideRole: "slide",
      carouselRole: "carousel",
      slideOf: "{index} of {count}",
    },
    services: {
      listLabel: "Services",
      controlsLabel: "Scroll services",
      previous: "Previous services",
      next: "Next services",
      ctaAbout: "{label} about {title}",
    },
    ctl: {
      stagesLabel: "Process stages",
      stageNavLabel: "Go to a process stage",
      skip: "Skip the CTL animation",
    },
    applications: {
      skip: "Skip the application concepts animation",
      scenesLabel: "Application concepts",
      sceneNavLabel: "Go to an application concept",
    },
  },

  notFound: {
    title: "Page not found",
    text: "The page you are looking for does not exist or is no longer available. It may have moved to a new address.",
  },

  news: {
    eyebrow: "News",
    readMore: "Read article",
    back: "All news",
    articlesLabel: "Articles",
    notPublishedYet: "Not published yet",
    removedTitle: "This article is no longer available",
    removedText:
      "It has been taken off the site. You can find our current articles on the news page.",
  },

  catalogue: {
    eyebrow: "Dream Petroleum BV",
    title: "Products",
    lead: "Base oils, white oils, solvents and specialty products, with technical data and documents where available.",
    unavailableTitle: "The product catalogue is not available right now",
    emptyTitle: "No products published yet",
    emptyText: "Products appear here once they are approved and published for this site.",
    count: { one: "{count} product", other: "{count} products" },
    inCategory: " in {category}",
    matching: " matching “{q}”",
    noMatchTitle: "No products match",
    noMatchText: "Try another word or {clear}.",
    clearSearch: "clear the search",
    categoriesNav: "Product categories",
    categoriesHeading: "Categories",
    allProducts: "All products",
    categoryCard: "{name}, {count}",
    subcategories: "{name} sub-categories",
    allInCategory: "All {name}",
    searchLabel: "Search products",
    searchPlaceholder: "Search by name or code",
    searchButton: "Search",
    availableContent: "Available content",
    technicalData: "Technical data",
    documents: "Documents",
    viewProduct: "View product",
    pages: "Pages",
    previousPage: "Previous page",
    nextPage: "Next page",
  },

  product: {
    ask: "Ask about this product",
    technicalData: "Technical data",
    specification: "Specification",
    typicalValues: "Typical values",
    typicalNote: "Typical values are for information only; they are not specification limits.",
    onRequestTitle: "Technical data for this product is available on request.",
    onRequestText: "Our team will share the current specification and documents for your application.",
    testMethod: "Test method: {method}",
    moreIn: "More in {category}",
    viewAll: "View all",
    unavailableTitle: "This product is not available right now",
    unavailableText: "Please try again in a moment, or go back to {all}.",
    allProducts: "all products",
  },

  /** Specification values (DP-156): words only; numbers, units and signs stay as specified. */
  spec: {
    range: "{from} to {to}",
    yes: "Yes",
    no: "No",
  },

  documents: {
    heading: "Documents",
    type: {
      TDS: "Technical data sheet",
      SDS: "Safety data sheet",
      COA: "Certificate of analysis",
      OTHER: "Document",
    },
    pages: { one: "{count} page", other: "{count} pages" },
    revision: "revision {number}",
    download: "Download",
    requestDownload: "Request download",
    fileForScreenReaders: "{title} (PDF)",
    membersSoon: "Available to members soon",
    notAvailable: "Not available",
    /** ML-8c: the language of a document on a page in another language (documents are English). */
    inEnglish: "English",
  },

  /**
   * PM-6 (ADR-015, DP-091): the fixed public texts of cross-references. English is the approved
   * text of @dream/contracts itself (one source).
   */
  crossReferences: {
    heading: "Cross-references",
    verifiedBadge: "VERIFIED",
    similarBadge: "SIMILAR",
    verified: XREF_PUBLIC_LABELS.VERIFIED as string,
    similar: XREF_PUBLIC_LABELS.SIMILAR as string,
    verifiedOn: " on {date}",
    notice: xrefPublicNotice("{company}"),
  },

  documentRequest: {
    unavailableTitle: "This document is not available right now",
    closedTitle: "Document requests are not open yet",
    closedText: "This document will be available on request soon.",
    eyebrow: "Document request",
    about: "{type} · revision {revision} · for {product}",
    intro:
      "Tell us who you are and the PDF downloads right away. The copy you receive is marked with your name, your company and a request reference.",
    validity: "The download link stays valid for 15 minutes, for up to 3 downloads.",
    newsOptIn: "Product news by e-mail only if you tick the separate box.",
  },

  /** DP-042: the request form of a lead-gated document. */
  leadForm: {
    fullName: "Full name",
    company: "Company",
    email: "Work e-mail",
    country: "Country",
    privacyNotice: "Privacy notice",
    privacyLegend: "Privacy",
    privacyAccept: "I have read how my details are used (required).",
    optional: "(optional)",
    tooMany: {
      one: "Too many requests. Please try again in about {count} minute.",
      other: "Too many requests. Please try again in about {count} minutes.",
    },
    documentGone: "This document is no longer available on request.",
    checkFields: "Please check the highlighted fields.",
    failed: "Something went wrong. Please try again in a moment.",
    noConnection: "No connection. Please try again.",
    outdatedUpdated:
      "Our privacy information was updated after you opened this page. Please read the current text above and tick the box again. Your other details are kept.",
    outdatedReload:
      "Our privacy information was updated after you opened this page. {reload} to see the current version.",
    reload: "Reload the page",
    versions: "Notice version {notice} · consent version {consent}",
    submit: "Request and download",
    doneEyebrow: "Thank you",
    doneTitle: "Your download has started",
    doneReference: "{title}. Request reference {reference}.",
    doneFallback:
      "If it did not start, use the button below. It works until {time}, up to {max} downloads in total.",
    downloadPdf: "Download PDF",
  },

  /** DP-151: the contact form, and the contact section of a CMS page around it. */
  contactForm: {
    name: "Your name",
    email: "Your e-mail",
    company: "Company",
    country: "Country",
    phone: "Phone number",
    subject: "Subject",
    message: "Your message",
    tooMany: {
      one: "Too many messages. Please try again in about {count} minute.",
      other: "Too many messages. Please try again in about {count} minutes.",
    },
    checkFields: "Please check the highlighted fields.",
    unavailable: "The contact form is not available right now. Please call or e-mail us.",
    failed: "Something went wrong. Please try again in a moment, or call or e-mail us.",
    noConnection: "No connection. Please try again.",
    thankYou: "Thank you",
    received: "We have received your message and will reply by e-mail.",
    outdated:
      "Our privacy information was updated after you opened this page. {reload} to read the current version, then send your message again.",
    reload: "Reload the page",
    noticeTitle: "How we use your details",
    noticeVersion: "· notice version {version}",
    send: "Send message",
  },

  contactSection: {
    phone: "Phone",
    email: "E-mail",
    office: "Office",
    notAvailableYet: "Not available yet",
  },

  privacy: {
    draftTitle: "Draft — not for publication",
    draftText: "This text is not final and is not shown in production until the following are settled:",
    eyebrow: "Privacy",
    title: "Privacy Policy",
    version: "Version {version}",
    formTextsTitle: "The texts on our document request form",
    noticeVersion: "Notice, version {version}",
    consentVersion: "Marketing consent (optional), version {version}",
  },
};

/**
 * The shape every language's dictionary must have: the English keys, every value a string (or a
 * `{ one, other }` plural). A missing or extra key in another language is a compile error.
 */
export type Dictionary = typeof en;
