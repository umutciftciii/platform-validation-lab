/**
 * ML-12c (DP-243): the CMS client's messages (lib/cms-client.ts). The API answers with codes
 * (`VALIDATION_FAILED`, rule `slug:unique` on path `slug`); the console turns them into text in
 * the UI language. The API's own messages stay English (logs). Values are the texts of before
 * ML-12c, word for word.
 */
export const api = {
  /** By `<path>:<rule>` (see RULE_KEYS in lib/cms-client.ts). */
  rules: {
    versionStale: "Someone else saved this page meanwhile. Reload the page to see their version.",
    slugUnique: "Another page of this site already uses this address.",
    slugReserved:
      "This address is reserved for the site itself (for example products or privacy) or is a language code.",
    slugInvalidFormat: "Use lower-case letters, digits and single hyphens, for example about-us.",
    slugLiveElsewhere:
      "Another published page is live at this address. Move or unpublish that page first, then publish this one.",
    slugOldAddress:
      "This address used to belong to another page and now redirects (301) to where that page moved. Choose another address.",
    slugRedirectLoop:
      "This address change would make old addresses redirect in a circle. Choose another address.",
    kindNotEditableYet: "This page is managed in code until it is imported into the CMS.",
    articleIncomplete:
      "An article needs a summary and at least one body section before it can be published.",
    coverAlt: "Add the alt text of the cover image.",
    contentInvalid:
      "This content no longer matches the current fields. Save the draft again and check the highlighted fields.",
    revisionUnknown: "This revision does not exist. Reload the page.",
    localeExists: "This page already exists in that language. Open it from the language tabs.",
    localeNotEnabled: "This language is not enabled for editing on this site.",
    localeIsSource:
      "This page is the source language of its group; it has nothing to catch up with.",
    localeUnknown: "This language is not a language of the site.",
    slugFixedAddress: "Designed pages and site-wide parts keep their address in every language.",
    slugFormat: "Use lower-case letters, digits and single hyphens, for example over-ons.",
    canonicalPath:
      "Use a path of this site, such as /about-us (lower-case words and hyphens, no domain).",
    ogImage: "Choose one of the registered site images.",
  },
  unknownReference:
    "A menu link points at a page, product or category that no longer exists on this site. Choose another target for the highlighted links.",
  checkFields: "Check these fields: {fields}.",
  notSaved: "The change could not be saved. Try again in a moment.",
  unreachable: "The admin API cannot be reached.",
  /** describePath: a readable name for a field path; the API's field keys are the EN words. */
  path: {
    section: "section {n}",
    sectionField: "section {n} ({field})",
    seo: "SEO {field}",
    menu: "{group} {n}{rest}",
    /** Between the keys of a nested field ("button.href"). */
    separator: ".",
    summary: "summary",
    cover: "cover image",
  },
  /**
   * Words of a field path (`content.items.2.children.0.target`). English shows the API's keys as
   * they are; another language names them.
   */
  pathWords: {
    items: "items",
    columns: "columns",
    noScriptLinks: "noScriptLinks",
    legal: "legal",
    social: "social",
    children: "children",
    links: "links",
    label: "label",
    target: "target",
    url: "url",
    title: "title",
    href: "href",
    text: "text",
    button: "button",
    cta: "cta",
    image: "image",
    imageAlt: "imageAlt",
    body: "body",
    intro: "intro",
    eyebrow: "eyebrow",
    description: "description",
    canonicalPath: "canonicalPath",
    ogImage: "ogImage",
    noindex: "noindex",
  },
} as const;
