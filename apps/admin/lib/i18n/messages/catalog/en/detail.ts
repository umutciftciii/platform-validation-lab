/**
 * ML-12a: English UI texts of the product detail page — app/(console)/products/[id]/page.tsx, the
 * tab shell (components/catalog/product-tabs.tsx), the master, listing and SEO forms, and the SEO
 * fields and preview shared with the SEO module (components/seo/). Moved verbatim.
 */
export const detail = {
  /** app/(console)/products/[id]/page.tsx */
  page: {
    metaTitle: "Product",
    title: "Product",
    back: "All products",
    tryAgain: "Try again in a moment.",
    noAccess: {
      title: "No access to the product catalogue",
      text: "Your roles do not include reading products on any site.",
    },
    loadError: {
      title: "This product could not be loaded",
      text: "You are not allowed to read products on this site.",
    },
    /** Header line under the product name. */
    sku: "SKU",
    versionChanged: "Version {version} · changed {date}",
    /** Alert on the Publication tab (read out with the tab label). */
    blocked: {
      one: "publishing blocked on {count} site",
      other: "publishing blocked on {count} sites",
    },
    /** Evidence option of a cross-reference verification (active document revision). */
    xrefSource: "{type} · {title} · revision {revision}",
    /** Content tab. */
    content: {
      chooseSite: "Choose the site whose product text you edit.",
      language: "Language of the product text",
      title: "Product text on {site}",
      description: "What the {site} product page shows. Version {version} · changed {date}",
      notListed: "This site does not list the product yet.",
      noCategories: {
        title: "No categories on this site",
        action: "Create categories",
        text: "A product is listed in one of the site's categories. Create the first category to list products here.",
      },
      /** "Saving never … on the <Publication> tab." */
      savingNote: {
        before:
          "Saving never publishes, unpublishes or changes the live site. Preview and publish on the",
        link: "Publication",
        after: "tab.",
      },
      shared: {
        title: "Shared product content",
        description:
          "Name, code, URL slug and a shared summary and description, the same for every site. Not published as such: a site shows its own text above.",
        note: "The shared summary and description appear on a site only where that site's own field is empty, and only after the site is published again. Editing them never changes a site's own text.",
      },
    },
    /** Another language's editors on the Content tab (ML-8b). */
    translation: {
      loadError: "The {language} texts could not be loaded",
      title: "{language} texts on {site}",
      description:
        "Everything a visitor reads about this product in {language}, next to its English source. Codes, values, units, standards and brands stay as they are in every language.",
      productText: "Product text",
      category: "Category",
      categoryDescription:
        "The name of this product's category on the site; shared by every product in it.",
      specNames: "Specification names",
      specNamesDescription:
        "The names of this product's technical values (the values themselves are the same in every language).",
      imageAlts: "Image alt texts",
      imageAltsDescription:
        "What a screen reader says for each image; the images themselves are shared.",
      seoLoadError: "The {language} SEO texts could not be loaded",
      seoTitle: "{language} SEO on {site}",
    },
    /** Technical tab. */
    specs: {
      title: "Technical specifications",
      description:
        "Platform-wide values of this product master; never copied per site. The validation report checks the values as you type.",
      filled: "{filled} of {total} filled",
      loadError: "The specifications could not be loaded",
    },
    xrefs: {
      title: "Cross-references",
      description:
        "Other brands' products related to this product master: similar, or verified against a source document.",
      active: "{n} active",
      loadError: "The cross-references could not be loaded",
    },
    research: {
      title: "Research notes",
      description:
        "What the research found for this product on this site: questions, missing documents, conflicts, claim risks, values held for verification and sources. Never published.",
      items: "{n} items",
      none: "There is no research proposal for this product on {site}.",
      loadError: "The research notes could not be loaded",
    },
    /** Media & Documents tab. */
    images: {
      title: "Product images",
      description:
        "One cover and a gallery. Originals stay private; live sites get metadata-free WebP copies of published images only.",
      loadError: "The images could not be loaded",
    },
    documents: {
      title: "Technical documents",
      description:
        "TDS, SDS, COA and other PDFs of this product master. Every upload is a new, unchangeable revision.",
      loadError: "The documents could not be loaded",
    },
    /** SEO tab. */
    seo: {
      chooseSite: "Choose the site whose SEO you edit.",
      language: "Language of the SEO texts",
      title: "SEO on {site}",
      descriptionBv:
        "Search result and link preview of the product page. Saved on the site listing; the site shows it after the next publication. A product that is not published or not shown is never indexed.",
      descriptionOther: "Only the BV site uses product SEO for now.",
      outdated: "Changes not published",
      listFirst: "List the product on this site first (Content tab).",
      /** Open Graph image option of the cover image. */
      coverOption: "Cover · {name}",
    },
    /** Publication tab. */
    publication: {
      title: "Publication",
      description:
        "Preview, publish and unpublish per site. A live site shows the published snapshot, never the current draft; every blocker says where it is fixed.",
      loadError: "The publication status could not be loaded",
    },
    review: {
      title: "Second-person review",
      description:
        "Optional when you can publish directly. Publishers without approval rights publish an approved master only.",
    },
    history: {
      title: "Review and publication history",
      description: "Every submission, decision and publication, newest first. It cannot be edited.",
      loadError: "The history could not be loaded",
    },
  },
  /** components/catalog/product-tabs.tsx */
  tabs: {
    leave: "You have unsaved changes on this product. Leave the page and discard them?",
    sections: "Product sections",
    unsaved: "Unsaved changes",
    unsavedSr: ", unsaved changes",
    unsavedIn:
      "Unsaved changes in {tabs}. They are kept while you switch tabs; save each form to keep them for good.",
  },
  /** components/catalog/product-master-form.tsx */
  master: {
    saved: "Shared product content saved.",
    name: {
      label: "Product name",
      hint: "Shared by every site; a site shows it when its own title is empty.",
    },
    code: {
      label: "Product code",
      hint: "Upper case, e.g. ICC-SYN-6. Unique.",
    },
    slug: {
      label: "URL slug",
      hintEdit:
        "Lower case and hyphens. Unique. A new slug reaches a site when the product is published there again; the BV site then redirects the old address (301).",
      hintNew: "Lower case and hyphens. Unique.",
    },
    summary: {
      label: "Shared summary",
      hint: "Optional. Used only on sites whose own summary is empty.",
    },
    description: {
      label: "Shared description",
      hint: "Optional. Used only on sites whose own description is empty. Plain text, English, up to {max} characters.",
    },
    archived: "This product is archived. Restore it to edit the master.",
    noPermission: "Product masters are edited by the platform product team (product_master:edit).",
    saving: "Saving…",
    save: "Save shared content",
    create: "Create product",
    archiveConfirm: "Archive this product? It can be restored later.",
    archive: "Archive",
    restore: "Restore",
  },
  /** components/catalog/listing-form.tsx */
  listing: {
    saved: "{site} text saved.",
    listed: "Listed on {site}.",
    legend: "Product text on {site}",
    title: "Title on this site",
    summary: "Summary on this site",
    description: "Description on this site",
    proposal: {
      heading: "Research proposal for {site}",
      reviewed: "· reviewed by the company",
      notReviewed: "· not reviewed by the company (optional)",
      copy: "Copy into summary and description",
      differs: "The saved {site} text differs from the research proposal.",
      copied:
        "Copied into the summary and description above. Edit it, then save; nothing is saved yet.",
      onlyText:
        "Only the customer text is copied. Technical values held for verification stay in Company Review and never enter the specifications.",
      claimNotes: {
        one: "{count} claim note: wording that needs a certificate",
        other: "{count} claim notes: wording that needs a certificate",
      },
      show: "Show the proposal text",
      summary: "Summary: ",
      description: "Description: ",
    },
    settings: "Listing settings on {site}",
    category: {
      label: "Category on this site",
      hintDefault: "Left empty, the site default “{name}” is used.",
      noDefault: "This site has no default category yet.",
      siteDefault: "Site default",
      defaultSuffix: " (default)",
    },
    sortOrder: "Sort order",
    discard: "Discard changes",
    saving: "Saving…",
    save: "Save {site} text",
    listOn: "List on {site}",
    readOnly: "Read only: editing this site's listings needs product:edit on the site.",
  },
  /** components/catalog/product-seo-form.tsx */
  seo: {
    saved: "{site} SEO saved. Publish the product to show it on the site.",
    fallbackSummary: "the product summary",
    fallbackSiteDescription: "the site's default description",
    ogImage: {
      label: "Open Graph image",
      hint: "One of the product's public images. Empty: the cover, then the site's default image.",
      cover: "Cover image (default)",
    },
    save: "Save SEO",
    discard: "Discard changes",
    unsaved: "Unsaved changes",
    version: "Listing version {version}",
    readOnly: "Read only for you on this site.",
  },
  /** components/seo/seo-fields.tsx (also on the SEO module's screens). */
  seoFields: {
    counter: "{length}/{max} · about {recommended} show.",
    title: {
      label: "SEO title",
      hint: "{counter} Empty: {fallback}.",
    },
    description: {
      label: "Meta description",
      hint: "{counter} Empty: {fallback}.",
    },
    canonical: {
      label: "Canonical path",
      hint: "Optional. A path of this site such as /about-us; empty: the page's own address.",
    },
    noindex: {
      label: "Hide from search engines (noindex)",
      hint: "Adds noindex and leaves the page out of the sitemap once published.",
    },
    og: {
      legend: "Link preview (Open Graph)",
      title: "Open Graph title",
      titleHint: "{counter} Empty: the SEO title.",
      description: "Open Graph description",
      descriptionHint: "{counter} Empty: the meta description.",
    },
  },
  /** components/seo/seo-preview.tsx (also on the SEO module's screens). */
  seoPreview: {
    searchAria: "Search result preview",
    search: "Search result",
    noDescription: "No description: the search engine picks text from the page.",
    noindex: "Hidden from search engines (noindex): this result is not shown.",
    link: "Link preview",
    imagePlaceholder: "Image shown on the site",
    canonicalAria: "Canonical address",
    canonical: "Canonical URL",
    noPublicAddress: "{path} (no public address configured here)",
    canonicalInvalid: "The canonical path is not valid; the page's own address is used.",
    canonicalOverride:
      "Points search engines to another address: this page stays out of the sitemap.",
    canonicalOwn: "The page's own address.",
    lengthNotes: "Length notes",
    fields: {
      title: "SEO title",
      description: "Meta description",
      ogTitle: "Open Graph title",
      ogDescription: "Open Graph description",
    },
  },
} as const;
