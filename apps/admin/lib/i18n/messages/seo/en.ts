/**
 * ML-12d (DP-243): English texts of the SEO area — Admin > SEO (overview) and SEO > Redirects. Every
 * string was moved verbatim from the component or view helper that rendered it, so the English
 * console is unchanged (test/seo-en.test.tsx compares with private main fb6687d). Data is never
 * here: page and product names, addresses, slugs, notes, people, site names, HTTP status codes.
 * The SEO fields, preview and address summary of the editors are `catalog.detail.*` (ML-12a).
 */
export const seo = {
  /** The section's tabs (components/seo/seo-tabs.tsx). */
  tabs: {
    label: "SEO",
    overview: "Overview",
    redirects: "Redirects",
  },
  /** Shared by both pages. */
  common: {
    noAccessTitle: "No access to the BV site",
    noAccessText: "Your roles do not include reading content or products of Dream Petroleum BV.",
    forbidden: "You are not allowed to read the content or products of this site.",
    tryAgain: "Try again in a moment.",
  },
  /** Admin > SEO (app/(console)/seo/page.tsx, lib/seo-overview.ts). */
  overview: {
    metaTitle: "SEO",
    title: "SEO",
    description:
      "Search results and link previews of dreampetroleumbv.com: the site defaults and the SEO of every page, article and product. Changes reach the site when the page or product is published.",
    loadError: "The SEO overview could not be loaded",
    indexingNote:
      "Search engines may index the site only in production with indexing switched on. DEV and staging always answer noindex, whatever is set here. Unpublished or hidden products are never indexed.",
    defaults: {
      title: "Site defaults",
      description:
        "Used where a page has no value of its own: site name, default title, meta description and link-preview image.",
      draftNotPublished: "Draft, not published",
      changesNotPublished: "Changes not published",
      published: "Published",
      builtIn: "Built-in defaults",
      siteName: "Site name",
      defaultTitle: "Default title",
      defaultDescription: "Default description",
      defaultImage: "Default image",
      none: "None",
      edit: "Edit defaults",
      view: "View defaults",
      pageNote: "Draft, preview, publish and history work as for every page.",
      builtInText:
        "The site uses its built-in defaults. Create the defaults in the CMS to edit them; the site keeps the built-in values until they are published.",
      importTitle: "SEO defaults",
    },
    list: {
      title: "Pages, articles and products",
      description: "{count} addresses · {sitemap} in the sitemap. Each row opens its editor.",
      filterLabel: "Filter",
      empty: "Nothing to show for this filter.",
      noTitle: "No SEO title (the page name is used)",
      noindex: "Noindex",
      notLive: "Not live",
      changesNotPublished: "Changes not published",
      live: "Live",
      inSitemap: "In sitemap",
    },
    filters: {
      all: "All",
      attention: "Needs attention",
      noindex: "Noindex",
      pending: "Not published",
      products: "Products",
      pages: "Pages & articles",
    },
    kind: {
      home: "Home",
      page: "Page",
      article: "Article",
      product: "Product",
      products: "Product list",
      news: "News list",
    },
    notes: {
      noDescription: "No meta description (fallback used)",
      descriptionLong: "Description may be cut off",
      titleLong: "Title may be cut off",
      canonicalInvalid: "Canonical path not valid",
      canonical: "Canonical → {path}",
    },
  },
  /** Admin > SEO > Redirects (app/(console)/seo/redirects/page.tsx, components/seo/redirect-manager.tsx). */
  redirects: {
    metaTitle: "Redirects · SEO",
    title: "Redirects",
    description:
      "Old addresses of dreampetroleumbv.com and where they lead. Changes take effect on the site at once.",
    loadError: "The redirects could not be loaded",
    rulesNote:
      "Live content always wins: a redirect never starts at a published page or product, and it is switched off when content is published at its old address. Redirects never chain, never leave the site and never appear in the sitemap. Slug-change redirects keep moved content findable and cannot be deleted here.",
    find: {
      label: "Find redirects",
      search: "Search",
      searchPlaceholder: "Address or note",
      sortBy: "Sort by",
      order: "Order",
      descending: "Descending",
      ascending: "Ascending",
      apply: "Apply",
      byOrigin: "Filter by origin",
      byStatus: "Filter by status and state",
      all: "All ({n})",
      withCount: "{label} ({n})",
      anyStatus: "Any status",
      activeAndInactive: "Active and inactive",
      active: "Active",
      inactive: "Inactive ({n})",
    },
    sort: {
      updated: "Last changed",
      created: "Created",
      source: "Source address",
      target: "Target address",
    },
    origin: {
      MANUAL: "Manual",
      SLUG_CHANGE: "Slug change",
      IMPORT: "Import",
    },
    list: {
      label: "Redirects",
      count: { one: "{count} redirect", other: "{count} redirects" },
      page: " · page {page} of {pages}",
      pages: "Pages",
      previous: "Previous",
      next: "Next",
      empty: "No redirects match.",
    },
    manager: {
      newRedirect: "New redirect",
      importCsv: "Import CSV",
      sampleCsv: "Sample CSV",
      readOnly:
        "You can read the redirects. Creating, changing, deleting and importing them needs the right to publish content on this site.",
      dismiss: "Dismiss",
      created: "Redirect created. It is live on the site now.",
      saved: "Redirect saved.",
      deleted: "Redirect deleted. The old address answers 404 again.",
      imported: {
        one: "{count} redirect imported. They are live on the site now.",
        other: "{count} redirects imported. They are live on the site now.",
      },
    },
    row: {
      movedProduct: "Moved product:",
      movedPage: "Moved page:",
      notAvailable: "not available to you",
      liveAt: "· live at {path}",
      notLiveNow: "· not live now",
      changedBy: "Changed {date} by {person} · created {created}",
      changed: "Changed {date} · created {created}",
      permanent: "301 permanent",
      temporary: "302 temporary",
      active: "Active",
      inactive: "Inactive",
      protectedTitle: "Created when the content moved. Only its note can be changed.",
      protected: "Protected",
      editNote: "Edit note",
      edit: "Edit",
      hideHistory: "Hide history",
      history: "History",
      delete: "Delete",
      confirmDelete:
        "Delete the redirect from {source}? The old address answers 404 again (the change history is kept).",
      confirmAction: "Delete redirect",
      loadingHistory: "Loading the history…",
      noHistory: "No recorded changes.",
      historyLabel: "Changes, newest first",
      eventBy: "{action} by {person} — {summary}",
      event: "{action} — {summary}",
    },
    form: {
      edit: "Edit redirect",
      create: "New redirect",
      close: "Close",
      locked:
        "Created when the content moved: it keeps the old address for search engines and follows the content. Only the note can be changed here.",
      source: "Old address (source)",
      sourceHint:
        "/page, /news/article, /products/product or an old-site address such as /en/about-us, optionally with ?query",
      target: "New address (target)",
      targetHint: "A path of this site, never another domain",
      status: "Status",
      active: "Active",
      note: "Note (optional)",
      saving: "Saving…",
      save: "Save redirect",
      createAction: "Create redirect",
      cancel: "Cancel",
      atOnce: "Takes effect on the site at once; no publication step.",
    },
    import: {
      label: "Import redirects from CSV",
      intro:
        "Columns: source, target, status (301/302), active (true/false), note. Check the file first; nothing changes until you confirm. A file with errors is never imported, and importing the same file again creates no duplicates.",
      file: "CSV file (at most {rows} rows, {kb} KB)",
      lines: {
        one: "{file} · {count} line · first lines",
        other: "{file} · {count} lines · first lines",
      },
      check: "Check file (dry-run)",
      result: "Dry-run result",
      new: "{n} new",
      updated: "{n} updated",
      unchanged: "{n} unchanged",
      withErrors: "{n} with errors",
      onlyIssues: "Only rows with errors or warnings ({n} of {total})",
      line: "Line {line}",
      run: { one: "Import {count} redirect", other: "Import {count} redirects" },
      download: "Download report",
      fixErrors: "Fix the rows with errors and check the file again.",
      nothing: "Nothing to import: every row is already in place.",
      exact:
        "The import writes exactly this result; if the redirects changed meanwhile, check again.",
    },
    /** The dry-run row results (lib/redirects-view.ts IMPORT_ACTION_LABEL). */
    action: {
      create: "New",
      update: "Update",
      unchanged: "Unchanged",
      error: "Error",
    },
    /** Warnings of a saved redirect or an import row (API codes, lib/redirects-view.ts). */
    warnings: {
      targetNotLive:
        "The new address has no live content right now: visitors would land on a 404 until it is published.",
      sourceDraftContent:
        "A draft page or product uses the old address. When it is published there, this redirect is switched off.",
    },
    /** The change history (audit actions and the summary of what an event recorded). */
    history: {
      created: "Created",
      updated: "Changed",
      deleted: "Deleted",
      retargeted: "Target followed the content",
      retired: "Switched off (content live again)",
      viaImport: "{action} (import)",
      active: "active",
      inactive: "inactive",
      changed: "changed: {fields}",
      was: "(was {target})",
    },
    /** Messages for the API's `field:rule` codes (lib/redirects-view.ts ruleMessage). */
    rules: {
      sourceRequired: "Enter the old address.",
      sourceFormat:
        "Use an address of this site (/old-page, /news/old-article, /products/old-product) or of the old site (/en/about-us, /tr/products/x, /en/contact-us.html): letters, digits, hyphens, dots or underscores, at most 6 parts; a query such as ?id=5 is allowed.",
      sourceReserved:
        "This address belongs to the site itself (home, products, news, privacy, a language code other than the old site's /en and /tr, an app address or a site file).",
      sourceFragment: "Leave out the # part: browsers never send it to the site.",
      queryFormat: "The query cannot be stored. Use plain name=value pairs.",
      sourceTooLong: "The old address is too long.",
      sourceLiveContent:
        "A published page, article or product is live at this address. Unpublish or move it first: live content always wins.",
      sourceDuplicate: "A redirect for this address (and query) already exists. Edit that one.",
      sourceDuplicateInFile: "This address appears more than once in the file.",
      sourceChain:
        "Another redirect leads to this address. Point that one at the final target instead (no redirect chains).",
      targetRequired: "Enter the new address.",
      targetFormat:
        "Use a path of this site, such as /about-us or /products?category=base-oil (lower-case words and hyphens, up to three levels).",
      targetExternal: "Redirects stay on this site. Enter a path such as /about-us, not a URL.",
      targetReserved: "This address is internal to the site and cannot be a target.",
      targetFragment: "Leave out the # part.",
      targetTooLong: "The new address is too long.",
      targetSelf: "The old and the new address are the same: that would be a loop.",
      targetChain:
        "The new address redirects itself. Enter its final address instead (no redirect chains or loops).",
      statusFormat: "Status must be 301 or 302.",
      activeFormat: "Active must be true or false.",
      noteFormat: "The note is too long or contains control characters.",
      protected:
        "This redirect was created when the content moved (slug change). It keeps the old address for search engines; only its note can be changed.",
      versionStale: "Someone else changed this redirect meanwhile. Reload to see their version.",
      importHasErrors: "Fix the rows with errors and check the file again.",
      importChanged:
        "The redirects changed since the check. Check the file again and confirm the new result.",
      csvEmpty: "The file has no redirects.",
      csvHeader:
        "The first line must name the columns: source, target and optionally status, active, note.",
      csvQuote: "A quoted value is not closed.",
      csvTooLarge: "The file is too large (at most {kb} KB).",
      csvTooManyRows: "At most {rows} redirects per file.",
      csvColumns: "A line has more values than the header.",
      siteNoRedirects: "This site does not use redirects.",
      unknown: "Check {field} ({rule}).",
      unknownField: "the value",
      unknownRule: "invalid",
    },
    /** Messages of lib/redirects-client.ts. */
    api: {
      notSaved: "The change could not be saved. Try again in a moment.",
      unreachable: "The admin API cannot be reached.",
      forbidden: "Your roles do not allow this change.",
    },
  },
} as const;
