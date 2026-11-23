/**
 * ML-12a: words shared by the Products/Catalog screens — statuses, languages, tabs and the fix
 * hints of publication issues — moved verbatim from components/catalog/parts.tsx,
 * lib/publication-status.ts, lib/translations.ts and lib/product-tabs.ts.
 */
export const common = {
  /** Product master status (ProductStatus). */
  productStatus: {
    DRAFT: "Draft",
    IN_REVIEW: "In review",
    APPROVED: "Approved",
    ARCHIVED: "Archived",
  },
  /** The product on one site (lib/publication-status SiteDisplayStatus). */
  siteStatus: {
    DRAFT: "Draft",
    PUBLISHED: "Published",
    UNPUBLISHED: "Unpublished",
    NOT_LISTED: "Not listed",
  },
  master: "Master",
  readOnly: "(read)",
  site: "Site",
  /** Content languages (a content label, not the console language). */
  languages: {
    en: "English",
    nl: "Dutch",
  },
  /** ML-8b translation state of a text (contracts TRANSLATION_STATE_LABELS). */
  translationState: {
    MISSING: "Missing",
    DRAFT: "Draft",
    PUBLISHED: "Published",
    OUTDATED: "Outdated",
  },
  translationStateHint: {
    MISSING: "No text in this language yet.",
    DRAFT: "Saved, not published in this language yet (or changed since).",
    PUBLISHED: "Exactly what the live site carries in this language.",
    OUTDATED: "The English source changed after this text was saved: check it and save again.",
  },
  /** A unit the API reports as missing in a language (lib/translations missingLabel). */
  missing: {
    listing: "Product text (title, summary or description)",
    categoryName: "Category name",
    categoryDescription: "Category description",
    title: "Title",
    summary: "Summary",
    description: "Description",
    seoTitle: "SEO title",
    seoDescription: "SEO description",
    ogTitle: "Link preview title",
    ogDescription: "Link preview description",
    specName: "Specification name: {name}",
    imageAlt: "Image alt text: {name}",
    image: "image",
  },
  /** The product page's tabs (DP-187). */
  tabs: {
    content: "Content",
    technical: "Technical",
    media: "Media & Documents",
    seo: "SEO",
    publication: "Publication",
  },
  /** Where and how a publication issue is fixed (lib/product-tabs fixForIssue). */
  fix: {
    not_approved:
      "Submit the product master for review; another reviewer approves it. An administrator with approval and publishing rights can publish directly.",
    not_reviewed: "Optional: ask a second person to review it first.",
    company_review_pending: "Optional: the company can review the proposal under Company Review.",
    sensitive_claim:
      "Keep this wording only with a certificate or source document; otherwise remove it from the site texts.",
    archived: "Restore the product with the button at the top of the page.",
    listing_missing: "List the product on this site (site listing).",
    cover_missing: "Upload an image and make it the cover.",
    alt_text_missing: "Add alt text to every image.",
    summary_missing: "Add a summary to this site's product text (or copy the research proposal).",
    description_missing:
      "Add a description to this site's product text (or copy the research proposal).",
    required_missing: "Fill in this required specification and save.",
    complete: "Complete the technical data.",
    correct: "Correct this value and save.",
  },
  /** DP-202: the hint under a site's own text field (lib/site-text.ts). */
  siteText: {
    own: {
      title: "Shown as the product name on {site}.",
      summary: "Shown on the {site} product card and product page.",
      description: "Shown on the {site} product page. English only for now.",
    },
    shared: {
      title: "Empty: {site} shows the shared name from “Shared product content” below.",
      summary: "Empty: {site} shows the shared summary from “Shared product content” below.",
      description:
        "Empty: {site} shows the shared description from “Shared product content” below.",
    },
    none: {
      title: "Empty: {site} shows the shared product name.",
      summary: "Empty: the {site} product card and page show no summary.",
      description: "Empty: the {site} product page shows no description.",
    },
  },
  /** DP-210: the addresses of a product or page (components/seo/address-summary.tsx). */
  address: {
    label: "Addresses",
    live: "Live address",
    notOnSite: "Not on the site",
    next: "Address after publishing",
    movesKeeps:
      "Publishing moves it to {next}. {live} keeps working: it redirects permanently (301) to the new address. Until then the site shows {live}.",
    movesStops:
      "Publishing moves it to {next}; {live} then stops working on this site. Until then the site shows {live}.",
    older: "Older addresses that redirect here (301)",
    olderLabel: "Older addresses",
  },
  /** ML-5 SEO length notes (contracts seoLengthWarning, the same English). */
  seoLength: {
    long: "{n} characters: about {recommended} are shown, the rest may be cut off.",
    short: "{n} characters: a description of {short}–{recommended} characters works best.",
  },
} as const;
