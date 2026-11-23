/** ML-12c (DP-243): see the file's sections. Every English value is the text of before ML-12c. */
export const editor = {
  /** components/cms/page-editor.tsx PageEditor: page details, sections, draft panel. */
  page: {
    saved: "Draft saved.",
    title: "Page",
    description: "On {site}, in {locale}.",
    articleTitle: "Article title",
    pageTitle: "Page title",
    address: "Address",
    addressFixedHint: "Fixed: the page is part of the site's design.",
    addressSiteWide: "Shown on every page (site-wide part)",
    addressSlugHint: "Changing it changes the page URL.",
    articleFields: {
      title: "Summary and cover",
      description: "Shown on the news list and at the top of the article.",
    },
    menu: {
      title: "Menu",
      invalid:
        "The draft of this menu does not match the menu fields. Restore a revision from the history to edit it.",
    },
    sections: {
      title: "Sections",
      articleTitle: "Article body",
      descriptionPage: "{count} of at most {max}. Shown on the page in this order.",
      descriptionArticle: "{count} of at most {max}. Shown on the article in this order.",
      emptyPage: "No sections yet. Add the first one below; a page usually opens with a hero.",
      emptyArticle:
        "No body yet. Add a Text section below; an article needs at least one section to be published.",
    },
    draft: {
      title: "Draft",
      version: "Version {version}",
      unsaved: "· unsaved changes",
      note: "Saving keeps the draft in the CMS; the site shows only what is published.",
      save: "Save draft",
      readOnly: "Read only for you on this site.",
    },
  },
  /** components/cms/page-editor.tsx SectionCard and AddSection. */
  section: {
    moveUp: "Move section {n} up",
    moveDown: "Move section {n} down",
    remove: "Remove section {n}",
    unknown: "Unknown section type. Remove it to save the page.",
    add: "Add a section",
  },
  /** components/cms/page-editor.tsx DesignFields: the top-level fields of a designed page. */
  designContent: "Content",
  /** components/cms/page-editor.tsx PageSeoPanel (the page editor's SEO panel). */
  seo: {
    title: "SEO",
    description:
      "Search results and link previews. Saved with the draft; the site shows it after publishing.",
    titleFallback: "“{title}”",
    fallbackSummary: "the page's summary",
    fallbackSiteDescription: "the site's default description",
    ogImageLabel: "Open Graph image",
    ogImageHint: "Empty: the page's own image, then the site's default image.",
  },
  /** components/cms/page-editor.tsx SiteSeoPreview (the bv.site-seo fragment). */
  siteSeoPreview: {
    title: "Preview",
    description:
      "A page without its own SEO values, with these defaults (as the home page would show them).",
    siteName: "Site name",
    defaultTitle: "Default title",
  },
  /** components/cms/field-form.tsx Fields: the generated form of the contract fields. */
  fields: {
    optional: "{label} (optional)",
    hrefHint: "Optional. /page, #section, https://…, mailto: or tel:",
    assetChosen: "{width} × {height} px · registered site asset",
    assetChoose: "Choose a registered site asset (uploads arrive with the media library).",
    noImage: "No image",
    choose: "Choose…",
    linkLabel: "Label",
    link: "Link",
    linkHint: "/page, #section, https://…, mailto: or tel:",
    listCountExact: "({n}, exactly {min})",
    listCountRange: "({n}, {min}–{max})",
    item: "{item} {n}",
    moveUp: "Move {item} {n} up",
    moveDown: "Move {item} {n} down",
    remove: "Remove {item} {n}",
    add: "Add {item}",
  },
  /** components/cms/publication-panel.tsx PublicationPanel and ConfirmBox. */
  publication: {
    title: "Publication",
    revision: "revision {n}",
    published: "Published {date} by {name}, from draft version {version}.",
    unpublished: "Unpublished {date} by {name}. Publish again to show the current draft.",
    unpublishedByFallback: "staff",
    notOnSite: "Not on the site yet. The site shows nothing for this page.",
    saveFirst: "Save the draft first: preview and publishing use the saved version.",
    preview: "Preview draft",
    previewUnavailable: "Preview shows pages of the BV site; this site has no pages yet.",
    previewOpened: {
      before: "Opened in a new tab. ",
      link: "Open the preview again",
      after: " (valid for 15 minutes).",
    },
    confirmPublish: "Publish draft version {version} to the live site?",
    publishNow: "Publish now",
    publishChanges: "Publish changes",
    publish: "Publish",
    needsPublisher: "Publishing needs a publisher of this site (content:publish).",
    confirmUnpublish:
      "Take this page off the site? Visitors see the page as unavailable until it is published again.",
    unpublish: "Unpublish",
    notice: {
      published: "Published as revision {n}.",
      unpublished: "Unpublished. The page is no longer shown on the site.",
    },
    cancel: "Cancel",
  },
  /** components/cms/history-panel.tsx HistoryPanel. */
  history: {
    title: "Publication history",
    description: "Every publication is kept as a revision.",
    loadFailed: "The history could not be loaded. Try again in a moment.",
    empty: "Not published yet. Each publication adds a revision here.",
    list: "Revisions, newest first",
    revision: "Revision {n}",
    live: "Live",
    meta: "{date} by {name} · draft version {version}",
    confirm:
      "Replace the current draft with revision {n}? The site does not change until you publish.",
    restore: "Restore into draft",
    saveFirst: "Save the draft before restoring a revision.",
    restored: "Revision {n} restored into the draft. Publish to show it.",
  },
  /** components/cms/translation-tabs.tsx TranslationTabs, TranslationSummary, MenuLinkWarnings. */
  translationTabs: {
    label: "Languages of this page",
    nav: "Page language",
    source: "Source",
    structure:
      "The structure differs from the source page ({list}). This is allowed; check the preview before publishing.",
    /** The API's structure warning codes (CMS_STRUCTURE_WARNINGS); English shows the code itself. */
    structureWarning: {
      sections: "sections",
      lists: "lists",
      images: "images",
      links: "links",
    },
    notPublic:
      "Not public on the site yet: {languages}. Published content in these languages is visible to staff only (preview), never to visitors.",
    summary: {
      sourceFallback: "the source language",
      notPublished: "The {source} page has not been published yet.",
      outdated:
        "{source} has revision {latest}; this translation was made from {from}. Update the texts, then mark it as up to date.",
      fromEarlierDraft: "an earlier draft",
      fromRevision: "revision {n}",
      upToDate: "Up to date with revision {latest} of {source}.",
    },
    menuWarnings: {
      label: "Links to check before publishing",
      heading: {
        one: "1 link will not be shown as a link in {language}",
        other: "{count} links will not be shown as links in {language}",
      },
      item: " — {text}",
      /** CMS_MENU_LINK_WARNINGS rules. */
      rule: {
        not_live: "its content is not live: shown as text with the note “not ready yet”",
        no_translation: "the page has no published version in this language: left out of the menu",
        not_in_language:
          "this address or catalogue item does not exist in this language yet: left out",
        unknown_target: "the linked page, product or category no longer exists",
      },
      footer:
        "Publishing is still possible. Check the preview; translate or publish the missing pages first where the link is needed.",
    },
  },
  /** components/cms/translation-actions.tsx TranslationActions. */
  translationActions: {
    markUpToDate: "Mark as up to date with revision {n}",
    create: "Create {language} translation",
    copyNote:
      "The new page copies the sections, images and links of this page with empty texts. It is created as a draft; nothing is published.",
    proposal:
      "Fill the texts with the prepared translation proposal (written by hand, not machine translated; texts without a proposal stay empty). The draft still needs a language review before it is published. Company name, address, telephone and e-mail stay as they are.",
    title: "Translated title",
    slug: "Address in this language",
    slugHint: "Lower case and hyphens. The same address as the source is allowed.",
    submit: "Create draft translation",
    cancel: "Cancel",
  },
} as const;
