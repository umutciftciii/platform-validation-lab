/**
 * ML-12a: messages for the catalogue API's field issues (`path:rule`), moved verbatim from
 * lib/catalog-client.ts. The keys are the API's own path and rule codes and never change.
 */
export const rules = {
  "version:stale": "Someone else changed this record. Reload the page to see their version.",
  "code:unique": "Another product already uses this code.",
  "slug:unique": "This slug is already in use.",
  // DP-210: a product's address on a site.
  "slug:live_elsewhere":
    "Another product is still published on this site at this address. Republish or unpublish that product first.",
  "slug:old_address":
    "This address used to belong to another product on this site and now redirects (301) to it. Choose another slug.",
  "slug:redirect_loop":
    "This address change would make old addresses redirect in a circle. Choose another slug.",
  "listing:unique": "This product is already listed on the site. Reload the page.",
  "parentId:too_deep": "Categories can be at most three levels deep.",
  "parentId:cycle": "A category cannot be moved below itself.",
  "parentId:unknown_parent": "The parent category does not exist on this site.",
  "categoryId:required": "Choose a category, or set a default category for this site first.",
  "categoryId:unknown": "The category does not exist on this site.",
  "visibility:product_archived": "An archived product cannot be visible on a site.",
  "status:archived": "Archived products cannot be edited. Restore it first.",
  "(root):has_children": "Move or delete the sub-categories first.",
  "(root):has_listings": "Move the products in this category first.",
  // PM-3 review and publication.
  "(root):own_change":
    "You changed or submitted this revision, so another reviewer must decide (separation of duties).",
  "status:not_draft": "Only a draft can be submitted. Reload the page to see the current state.",
  "status:not_in_review": "The product is no longer in review. Reload the page.",
  "status:published": "Unpublish the product on every site before archiving it.",
  "status:not_published": "The product is not published on this site.",
  "status:transition": "This status change is not possible. Reload the page.",
  "listingVersion:stale": "The site listing changed meanwhile. Reload the page and check it again.",
  // DP-209: product SEO.
  "canonicalPath:custom":
    "Use a path of this site, such as /products/base-oil-sn-150 (lower-case words and hyphens, no domain).",
  "ogImageId:unknown": "This image is no longer a public image of the product. Choose another one.",
  "listing:missing": "List the product on this site first.",
  "product:not_approved": "The product master must be approved in its current version.",
  "product:archived": "Archived products cannot be published.",
  "listing:listing_missing": "List the product on this site first.",
  "listing:listing_hidden":
    "Not shown on this site yet. Publishing here also needs edit rights on this site's listing.",
  // DP-198: the database's refusal of an unapproved version, and repeated or concurrent publishing.
  "status:not_approved": "The product master must be approved in its current version.",
  "publication:already_published": "This version is already live on the site. Reload the page.",
  "publication:unique": "The product was published on this site meanwhile. Reload the page.",
  "images:cover_missing": "Add a cover image first.",
  "summary:summary_missing": "Add a summary (master or listing) first.",
  "(root):image_published": "This image is shown on a live site. Unpublish the product first.",
  // DP-166 image visibility.
  "isPublic:cover_cannot_be_hidden":
    "The cover cannot be hidden. Make another image the cover first.",
  "isPublic:hidden_image": "Show this image on the site before making it the cover.",
  "file:busy": "Image processing is busy. Try again in a moment.",
  // PM-5 technical documents.
  "status:document_archived": "This document is archived. Restore it first.",
  "(root):not_publishable":
    "Only an active, non-internal document with a file can be shown on a site.",
  "(root):too_many_documents": "This product already has the maximum number of documents.",
  "(root):too_many_revisions": "This document already has the maximum number of revisions.",
  // ML-8b: languages of a publication and translations.
  "locale:not_enabled": "This language is not enabled on the site.",
  "locales:default_locale":
    "The default language is always published; choose other languages only.",
  "manualReview:not_chosen": "Confirm the manual check only for languages you publish.",
  "name:required": "The name is required in the site's default language.",
} as const;
