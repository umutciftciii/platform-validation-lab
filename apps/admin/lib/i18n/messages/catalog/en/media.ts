/**
 * ML-12a: English UI texts of the product's Media & Documents tab — moved verbatim from
 * components/catalog/document-manager.tsx (PDF documents, revisions, site visibility) and
 * components/catalog/image-manager.tsx (product images, cover, alt text, gallery order).
 */
export const media = {
  /** Upload answers both managers share. */
  upload: {
    interrupted: "The upload was interrupted.",
    failed: "The upload failed. Try again.",
    empty: "The file is empty.",
  },
  /** components/catalog/document-manager.tsx */
  documents: {
    /** Access policy of a document (DocumentAccessPolicy). */
    policy: {
      PUBLIC: {
        label: "Public",
        help: "Anyone can download it on a site that shows it, while the product is published there.",
      },
      MEMBERS_ONLY: {
        label: "Members only",
        help: "Listed on the site, but not downloadable until member accounts exist (DP-039).",
      },
      LEAD_REQUIRED: {
        label: "Lead required",
        help: "Listed on the site; downloaded after the short request form, with a watermark naming the requester (DP-042, DP-043).",
      },
      INTERNAL: {
        label: "Internal",
        help: "Staff only. Never listed or served on a public site.",
      },
    },
    /** What a site does with the document (DocumentSiteState). */
    siteState: {
      served: "Downloadable",
      served_on_request: "Downloadable after request form",
      hidden: "Not shown",
      internal: "Internal only",
      archived: "Archived",
      no_file: "No file yet",
      product_not_live: "Waits for publication",
      awaiting_membership: "Listed, download closed",
      awaiting_lead_capture: "Listed, download closed",
      language_not_public: "Waits for its language to be public",
    },
    /** Document types (contracts DOCUMENT_TYPE_LABELS). */
    types: {
      TDS: "Technical data sheet",
      SDS: "Safety data sheet",
      COA: "Certificate of analysis",
      OTHER: "Other document",
    },
    /** Refusals of an upload, by the API's rule code ("empty": upload.empty). */
    uploadRules: {
      not_pdf: "Not a PDF file (the content was checked, not the name).",
      encrypted: "Password-protected or encrypted PDFs are not accepted. Save an unprotected copy.",
      active_content:
        "The PDF contains active content (JavaScript, embedded files, launch or form actions). Export or print it to a plain PDF and try again.",
      too_complex:
        "The PDF could not be inspected safely. Export or print it to a plain PDF again.",
      too_many_revisions: "This document already has the maximum number of revisions.",
      document_archived: "Archived documents cannot get new revisions. Restore it first.",
      archived: "Documents of an archived product cannot change.",
      busy: "File processing is busy. Try again in a moment.",
      too_long: "The change note is too long.",
    },
    tooLarge: "Too large: at most 20 MB per PDF.",
    /** The drop zone (FilePicker) and the upload progress bar. */
    picker: {
      dropHere: "Drag a PDF here, or",
      chooseAnother: "Choose another file",
      choose: "choose a file",
      rules: "PDF · up to 20 MB · no passwords, JavaScript or embedded files",
      inputLabel: "Choose a PDF file",
      uploading: "Uploading the PDF",
    },
    /** The details fields (DetailsFields) and the change note field. */
    fields: {
      type: "Type",
      typeOther: "Other (general PDF)",
      typeOption: "{code} · {label}",
      title: "Title",
      titlePlaceholder: "e.g. ICCSYN 6 technical data sheet (EN)",
      description: "Description (optional)",
      language: "Language of the file",
      languageLockedHint:
        "Shown on a site: hide it on every site first to change the language. A file in another language is a new document.",
      languageHint:
        "The language the PDF is written in. Files are not translated here: upload a Dutch file as its own document.",
      notPublic: " · not public on any site yet",
      access: "Access on public sites",
      noteLabel: "Change note (optional)",
    },
    /** The new document form (NewDocumentForm). */
    create: {
      heading: "New document",
      chooseFile: "Choose the PDF file.",
      fileRefused: "The document was created, but the file was refused: {message}",
      noteHint: "Stored with revision 1. Revisions can never be edited later.",
      notePlaceholder: "e.g. First issue, English",
      cancel: "Cancel",
      submit: "Create and upload",
    },
    /** One revision: meta line and file links (RevisionMeta, FileLinks). */
    revision: {
      meta: "Rev {number} · {size} · {date} · {by}",
      metaWithPages: "Rev {number} · {size} · {pages} · {date} · {by}",
      pages: { one: "{count} page", other: "{count} pages" },
      staff: "staff",
      preview: "Preview",
      previewSr: " revision {number} (opens in a new tab)",
      download: "Download",
      downloadSr: " revision {number}",
    },
    /** The document on one site (SiteRow). */
    site: {
      serves: "Serves revision {number}",
      awaits: "Revision {number} awaits the publisher",
      publish: "Publish revision {number} on {site}",
      blocked: "Only an active, non-internal document with a file can be shown on a site.",
      shownOn: "Shown on {site}",
      showOn: "Show on {site}",
      shownByPublisher: "Shown by the site publisher",
      notShown: "Not shown",
    },
    /** One document (DocumentCard). */
    card: {
      archived: "Archived",
      noFile: "No file uploaded yet",
      sites: "Sites",
      cancel: "Cancel",
      saveDetails: "Save details",
      uploadIntro:
        "The new file becomes revision {number} and the active revision. Earlier revisions stay unchanged and can be made active again.",
      notePlaceholder: "e.g. Section 8 updated",
      uploadRevision: "Upload revision",
      history: "Revision history",
      historyLabel: "Revisions of {title}",
      revision: "Revision {number}",
      active: "Active",
      makeActive: "Make active",
      immutable: "Revisions are immutable: they are never edited or deleted.",
      newRevision: "New revision",
      details: "Details",
      archive: "Archive",
      restore: "Restore",
      archiveConfirm:
        "Archive “{title}”? It disappears from every site at once. Its revisions are kept and it can be restored.",
    },
    /** Notices after an action. */
    notices: {
      detailsSaved: "Document details saved.",
      uploadedPending:
        "Revision {number} uploaded and active. Sites keep their published revision until their publisher confirms the new one.",
      uploaded: "Revision {number} uploaded and active.",
      hidden: "Hidden on {site}.",
      shown: "Shown on {site} with revision {number}.",
      repinned: "{site} now serves revision {number}.",
      archived: "Document archived.",
      restored: "Document restored.",
      activated: "Revision {number} is now the active revision.",
      created: "Document created with revision 1.",
      createdNoFile: "Document created without a file.",
    },
    /** The tab section (DocumentManager). The intro is split around its <em> and <strong>. */
    section: {
      introBefore: "A site serves a document only when its publisher shows it there ",
      introAnd: "and",
      introMiddle: " the product is published on that site. New documents are ",
      introInternal: "Internal",
      introAfter: " until you choose otherwise.",
      newDocument: "New document",
      emptyTitle: "No documents yet",
      emptyEditable:
        "Add the technical data sheet, safety data sheet or a certificate of analysis as PDF.",
      emptyReadOnly: "No technical document has been added to this product.",
      listLabel: "Documents",
      archivedTitle: "Archived documents",
      productArchived: "This product is archived. Restore it to change its documents.",
    },
  },
  /** components/catalog/image-manager.tsx */
  images: {
    /** Refusals of an upload, by the API's rule code ("too_small": tooSmall, "empty": upload.empty). */
    uploadRules: {
      unsupported_type: "Not a JPEG, PNG or WebP image.",
      type_mismatch: "The file's content does not match its type.",
      too_many_pixels: "Too large: at most 25 megapixels and 10 000 px per side.",
      corrupt: "The image is damaged or cannot be read.",
      too_many_images: "This product already has the maximum number of images.",
      archived: "Archived products cannot get new images.",
    },
    tooSmall: "Too small: at least {width}×{height} pixels.",
    tooLarge: "Too large: at most 10 MB per file.",
    /** Notices after an action. */
    notices: {
      uploaded: { one: "{count} image uploaded.", other: "{count} images uploaded." },
      coverChanged: "Cover image changed.",
      shownAgain: "Image shown on the sites again (after the next publication).",
      hidden: "Image hidden from the sites (after the next publication). It stays here.",
      removed: "Image removed.",
      orderSaved: "Gallery order saved.",
      altSaved: "Alt text saved.",
    },
    removeConfirm: "Remove “{name}”? The file is deleted.",
    cover: "Cover",
    /** The drop zone; "dropBefore" is followed by the "chooseFiles" button. */
    dropBefore: "Drag images here, or ",
    chooseFiles: "choose files",
    rules: "JPEG, PNG or WebP · up to 10 MB · at least {width}×{height} px",
    inputLabel: "Choose image files",
    uploadsLabel: "Uploads",
    uploadingLabel: "Uploading {name}",
    emptyTitle: "No images yet",
    emptyEditable: "The first image you upload becomes the cover.",
    emptyReadOnly: "No image has been uploaded for this product.",
    /** One image card of the gallery. */
    galleryLabel: "Gallery, in display order",
    hiddenFromSite: "Hidden from site",
    altLabel: "Alt text of image {number}",
    altPlaceholder: "Describe the image (alt text)",
    altPlaceholderReadOnly: "No alt text",
    save: "Save",
    saveSr: " alt text of image {number}",
    altMissing: "Alt text missing",
    makeCover: "Make cover",
    imageSr: " (image {number})",
    hide: "Hide from site",
    show: "Show on site",
    moveEarlier: "Move image {number} earlier",
    moveLater: "Move image {number} later",
    remove: "Remove image {number}",
    productArchived: "This product is archived. Restore it to change its images.",
  },
} as const;
