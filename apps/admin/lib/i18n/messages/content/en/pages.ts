/** ML-12c (DP-243): see the file's sections. Every English value is the text of before ML-12c. */
export const pages = {
  /** Browser tab titles (generateMetadata of the Content pages). */
  meta: {
    content: "Content",
    news: "News",
    edit: "Edit page",
    newPage: "New page",
    newArticle: "New article",
  },
  /** components/cms/content-tabs.tsx: Pages / News. */
  tabs: {
    label: "Content type",
    pages: "Pages",
    news: "News",
  },
  /** components/cms/language-tabs.tsx. */
  languageTabs: {
    label: "Content language",
    notPublic: "{language} · not public",
  },
  /** Shared by the page list and the news list (content/page.tsx, content/news/page.tsx). */
  shared: {
    noAccessTitle: "No access to site content",
    noAccessBody:
      "Your roles do not include reading content on any site. Ask a site or platform administrator for a content role.",
    readOnly: "Read only on this site.",
    forbidden: "You are not allowed to read content on this site.",
    tryAgain: "Try again in a moment.",
  },
  /** app/(console)/content/page.tsx: the pages of one site. */
  list: {
    title: "Content",
    description:
      "Pages of the public sites. Edit drafts, preview them and publish; the sites show only what is published.",
    newPage: "New page",
    canEdit: "You can create and edit pages of this site ({locale}).",
    panelTitle: "CMS pages",
    count: { one: "{count} page", other: "{count} pages" },
    loadError: "The page list could not be loaded",
    emptyTitle: "No CMS pages on this site yet",
    emptyEdit: "Create a page from the standard template: hero, text, cards and call to action.",
    emptyRead: "Content editors of this site create pages here.",
    listLabel: "CMS pages of {site}",
    sections: { one: "{count} section", other: "{count} sections" },
    routesTitle: "Existing site pages",
    routesDescription:
      "Pages that are not managed in the CMS yet, or never will be. Their content is unchanged.",
    routesEmpty: "Every page of this site is in the CMS",
    routesLabel: "Existing pages of {site}",
    openProducts: "Open Products",
  },
  /** app/(console)/content/news/page.tsx: the news articles of one site. */
  news: {
    title: "News",
    contentTitle: "Content",
    description:
      "News articles of the public sites. Write drafts, preview them and publish; the site lists only what is published, newest first.",
    newArticle: "New article",
    canEdit: "You can write and edit articles of this site ({locale}).",
    /** "Heading and introduction of the news list: <Link>edit the News page</Link> (state)." */
    headingBefore: "Heading and introduction of the news list: ",
    headingLink: "edit the News page",
    headingAfter: " ({state}).",
    /** "… import “News” under <Link>Pages</Link>, then publish it. …" */
    missingBefore: "The heading of the news list is not in the CMS yet: import “News” under ",
    missingLink: "Pages",
    missingAfter: ", then publish it. Until then the site shows the list as unavailable.",
    panelTitle: "Articles",
    count: { one: "{count} article", other: "{count} articles" },
    loadError: "The article list could not be loaded",
    emptyTitle: "No articles on this site yet",
    emptyEdit: "Write the first article: a title, a summary, an optional cover image and the body.",
    emptyRead: "Content editors of this site write articles here.",
    listLabel: "News articles of {site}",
  },
  /** app/(console)/content/[id]/page.tsx: the editor page around PageEditor. */
  editor: {
    title: "Page",
    allPages: "All pages",
    loadError: "The page could not be loaded",
    allArticlesOf: "All articles of {site}",
    allPagesOf: "All pages of {site}",
    newsArticle: "News article",
    lastSaved: "· last saved {date} by {name}",
    importedTitle: "Edited after the import",
    /** Fallback when the page has no registry note. */
    thisDesignedPage: "This designed page",
    importNotice:
      "{note} Its fields get their own form when the page is imported into the CMS; until then the site shows the content from code.",
  },
  /** app/(console)/content/new/page.tsx. */
  newPage: {
    title: "New page",
    back: "All pages",
    noEditTitle: "You cannot create pages on this site",
    noEditBody: "Creating pages needs {permission} on the site (Content Editor or Site Admin).",
    description:
      "A new page on {site}, built from the standard template. You add its sections next.",
    panelTitle: "Page",
  },
  /** app/(console)/content/news/new/page.tsx. */
  newArticle: {
    title: "New article",
    back: "All articles",
    noEditTitle: "You cannot write articles on this site",
    noEditBody: "Writing articles needs {permission} on the site (Content Editor or Site Admin).",
    description: "A news article on {site}. You write its summary, cover and body next.",
    panelTitle: "Article",
  },
  /** components/cms/page-create-form.tsx. */
  createForm: {
    articleTitle: "Article title",
    pageTitle: "Page title",
    articleTitleHint: "The headline of the article on the site and in the news list.",
    pageTitleHint: "The name of the page in the admin and its default heading.",
    address: "Address",
    articleSlugHint: "Lower case and hyphens, for example why-oil-prices-fell.",
    pageSlugHint:
      "Lower case and hyphens. Products, privacy, news and two-letter codes are reserved.",
    articleDraftNote:
      "The article is created as a draft on {site}. Nothing is shown on the site until it is published.",
    pageDraftNote:
      "The page is created as a draft on {site}. Nothing is shown on the site until it is published.",
    create: "Create draft",
  },
  /** components/cms/import-button.tsx: dry run, then import. */
  importButton: {
    checkPassed:
      "Check passed: {title} can be imported as a draft with {fields}. The site does not change until it is published.",
    importDraft: "Import as draft",
    cancel: "Cancel",
    importIntoCms: "Import into CMS",
  },
} as const;
