/**
 * ML-12a: English UI texts of the product list, the new-product page, the review queue and the
 * small shared catalogue parts (preview link, language links, save notices).
 */
export const list = {
  /** No catalogue access (products list, review queue and other catalogue pages). */
  noAccess: {
    title: "No access to the product catalogue",
    text: "Your roles do not include reading products on any site.",
    textAsk:
      "Your roles do not include reading products on any site. Ask a site or platform administrator for access.",
  },
  /** app/(console)/products/page.tsx */
  products: {
    title: "Products",
    description: "Platform-wide product masters, and how each site lists them.",
    actions: {
      categories: "Categories",
      specifications: "Specifications",
      brands: "Global brands",
      reviewQueue: "Review queue",
      newProduct: "New product",
    },
    siteCanEdit: "You can edit listings and categories of this site.",
    siteReadOnly: "Read only on this site.",
    panelTitle: "Catalogue",
    count: { one: "{count} product", other: "{count} products" },
    countFiltered: {
      one: "{count} product matches the filters",
      other: "{count} products match the filters",
    },
    filters: {
      label: "Filter products",
      search: "Search by name, code or slug",
      searchPlaceholder: "Search name, code or slug",
      category: "Category",
      allCategories: "All categories",
      listing: "Listing on this site",
      listingAll: "Listed or not",
      listingListed: "Listed here",
      listingUnlisted: "Not listed here",
      sort: "Sort",
      sortName: "Sort by name",
      sortCode: "Sort by code",
      sortUpdated: "Last changed",
      sortCreated: "Created",
      order: "Order",
      asc: "Ascending",
      desc: "Descending",
      apply: "Apply",
      masterStatus: "Master status",
      any: "Any",
      clear: "Clear filters",
    },
    error: {
      title: "The product list could not be loaded",
      forbidden: "You are not allowed to read products on this site.",
      retry: "Try again in a moment.",
    },
    empty: {
      filteredTitle: "No product matches these filters",
      title: "No products yet",
      filteredText: "Change or clear the filters to see more products.",
      canCreate: "Create the first product master with “New product”.",
      cannotCreate: "Product masters are created by the platform product team.",
    },
    table: {
      caption: "Products on {site}",
      product: "Product",
      category: "Category on this site",
      status: "Status",
      changed: "Last changed",
    },
    pagination: {
      label: "Pages",
      range: "{from}–{to} of {total}",
      previous: "Previous",
      next: "Next",
    },
  },
  /** app/(console)/products/new/page.tsx */
  newProduct: {
    title: "New product",
    back: "All products",
    noAccessTitle: "You cannot create product masters",
    noAccessText:
      "Product masters are platform-wide. Creating them needs the platform permission {permission} (Platform Product Manager or Platform Super Admin).",
    description:
      "Create the platform-wide master record. Each site lists it separately afterwards.",
    panelTitle: "Product master",
  },
  /** app/(console)/products/review/page.tsx and components/catalog/review-queue.tsx */
  review: {
    title: "Review queue",
    back: "All products",
    description:
      "Product masters submitted for approval, oldest first. A reviewer who changed or submitted a revision cannot decide on it.",
    panelTitle: "Waiting for a decision",
    inReview: "{n} in review",
    inReviewFollowOnly: "{n} in review · you can follow, not decide",
    error: {
      title: "The review queue could not be loaded",
      forbidden: "Your roles do not include reading products.",
      retry: "Try again in a moment.",
    },
    empty: {
      title: "Nothing waiting for review",
      text: "When a product master is submitted, it appears here for approval.",
    },
    table: {
      caption: "Product masters waiting for review",
      product: "Product",
      submitter: "Submitted by",
      waiting: "Waiting",
      decision: "Decision",
    },
    version: "{code} · version {version}",
    unknown: "Unknown",
    /** Phones: who submitted it and when. */
    when: { known: "{name}, {time}", unknown: "Unknown, {time}" },
    blocking: "{n} blocking",
    ready: "Ready for you",
    reason: {
      own_change: "Your change",
      no_permission: "Reviewer needed",
    },
    waiting: "Waiting",
    warnings: { one: "{count} warning", other: "{count} warnings" },
  },
  /** components/catalog/preview-link-button.tsx */
  preview: {
    open: "Open catalogue preview",
  },
  /** components/catalog/language-nav.tsx */
  language: {
    label: "Language",
    source: "source",
  },
  /** components/catalog/notices.tsx */
  notices: {
    dismiss: "Dismiss",
  },
} as const;
