/**
 * ML-12c (DP-243): the UI texts that @dream/contracts defines for the CMS — section types, field
 * labels and hints, the registry notes of the routes in code and the menu target problems. The
 * contracts stay English (API, web-bv, tests); the admin shows them through `cmsText()`
 * (lib/cms-text.ts), which finds a text by its English value. Every value here is the contract
 * text word for word (test/content-i18n.test.tsx checks that each contract text is here).
 * Page titles of the registry ("Home", "Navigation") are page names: data, not in here.
 */
export const contract = {
  /** Section types of the standard template and their fields (CMS_SECTION_TYPES). */
  section: {
    heroLabel: "Hero",
    heroDescription: "The page opening: eyebrow, heading, intro and an optional button.",
    heroEyebrowLabel: "Eyebrow",
    heroTitleLabel: "Heading",
    heroIntroLabel: "Intro",
    heroCtaLabel: "Button",
    textLabel: "Text",
    textDescription: "A heading and body text. A blank line starts a new paragraph.",
    textBodyLabel: "Body",
    textBodyHint: "Plain text. A blank line starts a new paragraph.",
    cardsLabel: "Cards",
    cardsDescription: "A heading and a list of cards (features, services, facts).",
    cardsItemsItemLabel: "Card",
    cardsItemsTitleLabel: "Title",
    cardsItemsDescriptionLabel: "Description",
    cardsItemsLinkLabel: "Link",
    ctaLabel: "Call to action",
    ctaDescription: "A closing message with one button.",
    splitLabel: "Image and text",
    splitDescription:
      "Heading and text next to a registered site image. As the first section it is the page heading.",
    splitImageLabel: "Image",
    splitImageAltLabel: "Alt text",
    splitImageNoteLabel: "Image note",
    splitImageNoteHint: "Shown under the image, e.g. that a render is illustrative.",
    specListLabel: "Specification list",
    specListDescription: "A heading and rows of a term with an optional detail, like a data sheet.",
    specListItemsLabel: "Rows",
    specListItemsItemLabel: "Row",
    specListItemsTermLabel: "Term",
    specListItemsDetailLabel: "Detail",
    quoteLabel: "Quote",
    quoteDescription: "A short statement set large.",
    quoteSourceLabel: "Source",
    contactLabel: "Contact details and form",
    contactDescription:
      "Phone, e-mail and address from the published footer, next to the contact form. The form does not send until it is connected (DP-151); the note says so.",
    contactIntroLabel: "Introduction",
    contactFormTitleLabel: "Form heading",
    contactFormNoteLabel: "Note on the form",
    contactFormNoteHint: "Shown above the form while it cannot send messages.",
  },
  /** News article fields (CMS_ARTICLE_FIELDS). */
  article: {
    excerptLabel: "Summary",
    excerptHint: "Shown on the news list and under the article title.",
    coverImageLabel: "Cover image",
    coverImageHint: "Optional. A registered site image; uploads arrive with the media library.",
    coverAltLabel: "Cover image alt text",
    coverAltHint: "Required when a cover image is chosen: what the image shows.",
    originalDateLabel: "Original date",
    originalDateHint:
      "Optional. The date the article was first published elsewhere (e.g. on the old site); the site shows and orders it by this date. Empty: the date of its first publication here.",
  },
  /** Fields of the BV designed page and fragments (CMS_DESIGN_TEMPLATES). */
  design: {
    bvHomeHeroLabel: "Hero (ICCSYN)",
    bvHomeHeroHint:
      "The animation and its scroll length stay in code. Every application needs a source document.",
    bvHomeHeroBrandLabel: "Wordmark",
    bvHomeHeroTaglineLabel: "Tagline",
    bvHomeHeroScrollCueLabel: "Scroll cue",
    bvHomeHeroCtaLabelLabel: "Label",
    bvHomeHeroCtaHrefHint: "Empty: the button is shown disabled with the note below.",
    bvHomeHeroCtaDisabledNoteLabel: "Note while disabled",
    bvHomeHeroSupplyLabel: "Supply line",
    bvHomeHeroLegalLabel: "Legal note",
    bvHomeHeroMediaAltLabel: "Alt text of the laboratory film",
    bvHomeHeroApplicationsLabel: "Application cards",
    bvHomeHeroApplicationsHint: "Exactly six: the scatter of the animation has six places.",
    bvHomeProductGroupsLabel: "Product groups",
    bvHomeProductGroupsLabelLabel: "Section label",
    bvHomeProductGroupsDisclosureLabel: "Disclosure (required)",
    bvHomeProductGroupsGroupsLabel: "Groups",
    bvHomeProductGroupsGroupsItemLabel: "Group",
    bvHomeProductGroupsGroupsAnchorLabel: "Anchor",
    bvHomeProductGroupsGroupsAnchorHint:
      "Lower-case id, e.g. group-1. Used for links to this item.",
    bvHomeProductGroupsGroupsNameWordLabel: "Name",
    bvHomeProductGroupsGroupsNameNumeralLabel: "Numeral (accent colour)",
    bvHomeProductGroupsGroupsNoteLabel: "Qualifier note",
    bvHomeProductGroupsGroupsSamplesLabel: "Sample grades",
    bvHomeProductGroupsGroupsAnimationLabel: "Animation",
    bvHomeProductGroupsGroupsPosterLabel: "Poster (first frame)",
    bvHomeServicesLabel: "Services",
    bvHomeServicesDisclosureLabel: "Image disclosure (required)",
    bvHomeServicesItemsItemLabel: "Service",
    bvHomeServicesItemsDescriptionLabel: "Description (desktop)",
    bvHomeServicesItemsShortDescriptionLabel: "Short description (phones)",
    bvHomeServicesItemsDesktopImageLabel: "Image, desktop (4:3)",
    bvHomeServicesItemsDesktopPositionLabel: "Focus, desktop",
    bvHomeServicesItemsDesktopPositionHint: "Focal point, e.g. 50% 30%.",
    bvHomeServicesItemsMobileImageLabel: "Image, phones (3:4)",
    bvHomeServicesItemsMobilePositionLabel: "Focus, phones",
    bvHomeCtlLabel: "CTL technology",
    bvHomeCtlHint: "No performance figures here: binding values are on each lot's TDS or CoA.",
    bvHomeCtlDocumentLabel: "Document link",
    bvHomeCtlStagesLabel: "Process stages",
    bvHomeCtlStagesHint: "Exactly three: the scroll animation hands over between three images.",
    bvHomeCtlStagesItemLabel: "Stage",
    bvHomeApplicationsLabel: "Application concepts",
    bvHomeApplicationsHint:
      "AI concepts only: no suitability, safety or certification claim. Status and disclosures must stay visible.",
    bvHomeApplicationsStatusLabel: "Status label (required)",
    bvHomeApplicationsValidationLabel: "Validation box",
    bvHomeApplicationsValidationRequirementsLabel: "Requirements",
    bvHomeApplicationsValidationRequirementsItemLabel: "Requirement",
    bvHomeApplicationsValidationNoteLabel: "Note",
    bvHomeApplicationsScenesLabel: "Concepts",
    bvHomeApplicationsScenesHint:
      "Exactly three: the scroll animation hands over between three scenes.",
    bvHomeApplicationsScenesItemLabel: "Concept",
    bvHomeApplicationsScenesImageLabel: "Image, desktop",
    bvHomeApplicationsScenesImageSmallLabel: "Image, phones",
    bvNewsIndexEmptyLabel: "When no article is published",
    bvSiteSeoSiteNameLabel: "Site name",
    bvSiteSeoSiteNameHint:
      "Shown as the site name of link previews and after the page name in browser titles.",
    bvSiteSeoDefaultTitleLabel: "Default SEO title",
    bvSiteSeoDefaultTitleHint:
      "For pages without a title of their own (e.g. the home page without an SEO title).",
    bvSiteSeoDefaultDescriptionLabel: "Default meta description",
    bvSiteSeoDefaultOgImageLabel: "Default Open Graph image",
    bvSiteSeoDefaultOgImageHint:
      "Shown in link previews of pages without an image of their own. About 1200×630 works best.",
    corporateHomeHeroHint:
      "The page heading. No distributorship claim or figure without the owner's confirmation.",
    corporateHomeHeroSecondaryLabel: "Second button",
    corporateHomeOverviewLabel: "Company overview",
    corporateHomeOverviewHighlightsLabel: "Highlights",
    corporateHomeOverviewHighlightsItemLabel: "Highlight",
    corporateHomeCardHrefHint:
      "A path of this site, e.g. /products#base-oils-group1. Empty: the card is not a link.",
    corporateHomeStrengthsLabel: "Strengths",
    corporateHomeStrengthsHint:
      "Qualitative statements only: no counters or percentages without a confirmed source.",
    corporateHomeStrengthsItemLabel: "Strength",
    corporateHomeCtaPointsLabel: "Points",
    corporateHomeCtaPointsItemLabel: "Point",
    corporateProductsIntroLabel: "Page heading",
    corporateProductsGroupsHint:
      "One section per group, in this order. The anchor is the address of the section (/products#anchor).",
    corporateProductsGroupsSubtitleLabel: "Subheading",
    corporateProductsGroupsItemsLabel: "Products",
    corporateProductsGroupsItemsItemLabel: "Product",
    corporateProductsGroupsItemsTypeLabel: "Type",
    corporateProductsGroupsApplicationsTitleLabel: "Applications heading",
    corporateProductsGroupsApplicationsLabel: "Applications",
    corporateProductsGroupsApplicationsItemLabel: "Application",
    corporateProductsTypicalValuesLabel: "Typical values",
    corporateProductsTypicalValuesHint:
      "Hidden until the source of the values is approved (DP-002): keep the rows empty until then. The table is shown only with at least one row.",
    corporateProductsTypicalValuesColumnALabel: "First value column",
    corporateProductsTypicalValuesColumnBLabel: "Second value column",
    corporateProductsTypicalValuesRowsPropertyLabel: "Property",
    corporateProductsTypicalValuesRowsUnitLabel: "Unit",
    corporateProductsTypicalValuesRowsValueALabel: "First value",
    corporateProductsTypicalValuesRowsValueBLabel: "Second value",
    corporateProductsCoaLabel: "Certificate of Analysis",
    corporateHeroImageLabel: "Background image",
    corporateImageHint:
      "A representative scene; never presented as the company's own site or fleet.",
    corporateHomeHeroSlidesLabel: "Activity areas",
    corporateHomeHeroSlidesItemLabel: "Activity area",
    corporateHomeHeroSlidesHint: "Shown as tabs over the picture. None: the heading above alone.",
    corporateHomeHeroSlidesTabLabel: "Tab label",
    corporateHomeNewsLabel: "Latest news",
    corporateHomeNewsHint: "The three newest published articles are listed under this heading.",
    corporateProductsCoaHint: "Requests for a COA go to the contact page.",
  },
  /** Notes of the routes not (yet) in the CMS (CMS_SITE_REGISTRY). */
  registry: {
    bvHome:
      "Hero, product groups, services, CTL technology and applications. Motion stays in code.",
    bvProductsIndex: "Heading, intro and SEO. The products themselves stay in the catalogue.",
    bvNewsIndex:
      "Heading, introduction and empty state of the news list (DP-153). The articles are under News.",
    bvSiteNav: "Menu items, submenus and contact button of every page (menu editor, DP-219).",
    bvSiteFooter:
      "Headline, contact details, link columns, social and legal links (menu editor, DP-219).",
    bvSiteSeo:
      "Site name, default title, description and Open Graph image (DP-209). Managed under SEO.",
    bvAboutUs:
      "From the live site (DP-135). Market images not used: stock photos unrelated to the markets.",
    bvEnergyTrading: "From the live site (DP-135); the unsourced +12% figure is left out.",
    bvLogistics: "From the live site (DP-135).",
    bvContact:
      "DP-150. Contact details come from the published footer; the form sends nothing until DP-151.",
    bvStrategicPartnership: "From the live site (DP-206).",
    bvOurTeam: "From the live site (DP-206). The live counters showing 0 are left out.",
    bvNewsOilPricesUsIran: "The live site's only blog post (DP-206); imported as a news article.",
    bvProductDetail: "Published product snapshots. Edit them under Products.",
    bvPrivacy: "Versioned legal text tied to consent records. Changed only through a new version.",
    corporateHome:
      "Hero, company overview, services, product groups, strengths and a call to action (COM-2b). No counters, distributorship claims or testimonials.",
    corporateProducts:
      "The product portfolio: anchored groups and the COA request (COM-2b). Typical values stay hidden until their source is approved.",
    corporateNewsIndex:
      "Heading, introduction and empty state of the corporate news list (COM-3). The articles are under News.",
    corporateSiteNav:
      "Menu items and submenus of every corporate page (menu editor, COM-1). Links to pages that do not exist yet stay as text.",
    corporateSiteFooter:
      "Company text, contact details, link columns, social and legal links of every corporate page (COM-1).",
    corporateSiteSeo:
      "Site name, default title and description of the corporate site (COM-1). Managed under SEO.",
    corporateContact:
      "Contact details from the published footer and the contact form; messages become CORPORATE leads in the CRM (COM-4).",
    corporateContentPage:
      "From the live site (COM-5). Figures and unconfirmed claims left out (DP-003).",
    corporateContentArticle: "A post of the live blog (COM-5), with its original date (DP-327).",
  },
  /** Menu target problems (MENU_TARGET_PROBLEMS). */
  problem: {
    pageMissing:
      "The page no longer exists. The site shows the label as text; choose another target.",
    pageUnpublished:
      "The page was taken off the site. The site shows the label as text until it is published again.",
    pageNotPublished:
      "The page is not published yet. The site shows the label as text until it is.",
    productMissing:
      "The product is not on this site (removed, or not visible to you). The site shows the label as text.",
    productNotLive:
      "The product is not live on this site (not published, hidden or archived). The site shows the label as text.",
    categoryMissing: "The category no longer exists. The site shows the label as text.",
    categoryEmpty: "No live product is in this category: the link opens an empty list.",
  },
} as const;
