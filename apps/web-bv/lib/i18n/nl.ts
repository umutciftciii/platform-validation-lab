/**
 * ML-6 (DP-138, ADR-028 D11/D13): the Dutch site UI dictionary of the BV site.
 *
 * DRAFT until human review: every value below is a draft translation (tool-assisted) and is not
 * approved. Nothing is published by this file: Dutch stays `public = false` (D14), the catalogue has
 * Dutch routes since ML-8c (closed while Dutch is not public), the privacy policy none yet (ML-10),
 * and the approval of these texts is
 * part of the "complete NL" acceptance (docs/i18n/multilingual-plan.md §5.1 item 6).
 *
 * Typed as `Dictionary`: a missing key (or one English does not have) is a compile error.
 * Brand names, product codes, units, standards and test methods are never translated. The Dutch
 * cross-reference texts must pass the DP-091 review of their English source before the Dutch
 * catalogue goes live (backlog DP-252).
 */
import type { Dictionary } from "./en.ts";

export const nl: Dictionary = {
  common: {
    home: "Startpagina",
    products: "Producten",
    contact: "Contact opnemen",
    tryAgain: "Probeer het over een moment opnieuw.",
    select: "Selecteer…",
    sending: "Bezig met verzenden…",
    website: "Website",
    readPrivacyPolicy: "Lees ons privacybeleid",
  },

  meta: {
    notFound: "Pagina niet gevonden | Dream Petroleum BV",
    articleRemoved: "{title} · Dream Petroleum BV",
    products: "Producten | {site}",
    productsDescription: "Gepubliceerde producten van {site}.",
    productFallback: "Product | Dream Petroleum BV",
    documentRequest: "Document aanvragen | Dream Petroleum BV",
    privacy: "Privacybeleid | Dream Petroleum BV",
  },

  nav: {
    openMenu: "Menu openen",
    closeMenu: "Menu sluiten",
    mainLabel: "Hoofdmenu",
    menuLabel: "Sitemenu",
    openSubmenu: "Submenu van {label} tonen",
    newTab: "(opent in een nieuw tabblad)",
    languageLabel: "Taal",
    languageButton: "Taal: {language}",
    languageSoon: "Binnenkort beschikbaar",
  },

  footer: {
    homeLabel: "terug naar boven",
    navLabel: "Voettekst",
    legalLabel: "Juridisch",
    socialLabel: "Sociale media",
    newTab: "(opent in een nieuw tabblad)",
  },

  shell: {
    breadcrumb: "Kruimelpad",
    homeLink: "Dream Petroleum BV, startpagina",
    copyright: "© 2026 Dream Petroleum BV",
    privacyPolicy: "Privacybeleid",
  },

  home: {
    hero: {
      skip: "ICCSYN-animatie overslaan",
    },
    previewBanner:
      "Voorbeeld van een concept. Niet gepubliceerd, niet geïndexeerd; deze link verloopt na 15 minuten.",
    unavailable: {
      notFoundTitle: "Deze pagina is niet beschikbaar",
      notFoundText: "Ze is op dit moment niet gepubliceerd.",
      errorTitle: "Deze pagina kan op dit moment niet worden weergegeven",
      errorText: "Probeer het over een moment opnieuw.",
    },
    productGroups: {
      previous: "Vorige productgroep",
      next: "Volgende productgroep",
      pause: "Automatisch wisselen pauzeren",
      play: "Automatisch wisselen starten",
      slideRole: "dia",
      carouselRole: "carrousel",
      slideOf: "{index} van {count}",
    },
    services: {
      listLabel: "Diensten",
      controlsLabel: "Door de diensten bladeren",
      previous: "Vorige diensten",
      next: "Volgende diensten",
      ctaAbout: "{label} over {title}",
    },
    ctl: {
      stagesLabel: "Processtappen",
      stageNavLabel: "Ga naar een processtap",
      skip: "CTL-animatie overslaan",
    },
    applications: {
      skip: "Animatie van de toepassingsconcepten overslaan",
      scenesLabel: "Toepassingsconcepten",
      sceneNavLabel: "Ga naar een toepassingsconcept",
    },
  },

  notFound: {
    title: "Pagina niet gevonden",
    text: "De pagina die u zoekt, bestaat niet of is niet meer beschikbaar. Mogelijk is ze naar een nieuw adres verplaatst.",
  },

  news: {
    eyebrow: "Nieuws",
    readMore: "Artikel lezen",
    back: "Al het nieuws",
    articlesLabel: "Artikelen",
    notPublishedYet: "Nog niet gepubliceerd",
    removedTitle: "Dit artikel is niet meer beschikbaar",
    removedText:
      "Het is van de website verwijderd. Onze actuele artikelen vindt u op de nieuwspagina.",
  },

  catalogue: {
    eyebrow: "Dream Petroleum BV",
    title: "Producten",
    lead: "Basisoliën, witte oliën, oplosmiddelen en specialiteiten, met technische gegevens en documenten waar beschikbaar.",
    unavailableTitle: "De productcatalogus is op dit moment niet beschikbaar",
    emptyTitle: "Nog geen producten gepubliceerd",
    emptyText:
      "Producten verschijnen hier zodra ze zijn goedgekeurd en voor deze website zijn gepubliceerd.",
    count: { one: "{count} product", other: "{count} producten" },
    inCategory: " in {category}",
    matching: " voor “{q}”",
    noMatchTitle: "Geen producten gevonden",
    noMatchText: "Probeer een ander zoekwoord of {clear}.",
    clearSearch: "wis de zoekopdracht",
    categoriesNav: "Productcategorieën",
    categoriesHeading: "Categorieën",
    allProducts: "Alle producten",
    categoryCard: "{name}, {count}",
    subcategories: "Subcategorieën van {name}",
    allInCategory: "Alle {name}",
    searchLabel: "Producten zoeken",
    searchPlaceholder: "Zoeken op naam of code",
    searchButton: "Zoeken",
    availableContent: "Beschikbare informatie",
    technicalData: "Technische gegevens",
    documents: "Documenten",
    viewProduct: "Product bekijken",
    pages: "Pagina's",
    previousPage: "Vorige pagina",
    nextPage: "Volgende pagina",
  },

  product: {
    ask: "Vraag naar dit product",
    technicalData: "Technische gegevens",
    specification: "Specificatie",
    typicalValues: "Typische waarden",
    typicalNote:
      "Typische waarden zijn uitsluitend ter informatie; het zijn geen specificatiegrenzen.",
    onRequestTitle: "Technische gegevens van dit product zijn op aanvraag beschikbaar.",
    onRequestText:
      "Ons team deelt graag de actuele specificatie en documenten voor uw toepassing.",
    testMethod: "Testmethode: {method}",
    moreIn: "Meer in {category}",
    viewAll: "Alles bekijken",
    unavailableTitle: "Dit product is op dit moment niet beschikbaar",
    unavailableText: "Probeer het over een moment opnieuw of ga terug naar {all}.",
    allProducts: "alle producten",
  },

  spec: {
    range: "{from} tot {to}",
    yes: "Ja",
    no: "Nee",
  },

  documents: {
    heading: "Documenten",
    type: {
      TDS: "Technisch informatieblad",
      SDS: "Veiligheidsinformatieblad",
      COA: "Analysecertificaat",
      OTHER: "Document",
    },
    pages: { one: "{count} pagina", other: "{count} pagina's" },
    revision: "revisie {number}",
    download: "Downloaden",
    requestDownload: "Download aanvragen",
    fileForScreenReaders: "{title} (pdf)",
    membersSoon: "Binnenkort beschikbaar voor leden",
    notAvailable: "Niet beschikbaar",
    /** ML-8c: written as the language names itself (`lang="en"`), like the language selector. */
    inEnglish: "English",
  },

  crossReferences: {
    heading: "Kruisverwijzingen",
    verifiedBadge: "GEVERIFIEERD",
    similarBadge: "VERGELIJKBAAR",
    verified: "Gecontroleerd aan de hand van technische documentatie",
    similar: "Vergelijkbaar product, geen geverifieerd equivalent",
    verifiedOn: " op {date}",
    notice:
      "Merk- en productnamen van derden zijn handelsmerken van hun respectieve eigenaren en worden " +
      "uitsluitend gebruikt om producten te identificeren en te vergelijken. {company} is niet " +
      "gelieerd aan, gesteund door of goedgekeurd door deze eigenaren of fabrikanten. " +
      "„Vergelijkbaar” betekent geschikt voor dezelfde toepassingen, geen geverifieerd equivalent. " +
      "„Geverifieerd” betekent dat {company} de relatie op de vermelde datum aan de hand van " +
      "technische documentatie heeft gecontroleerd; dit is geen goedkeuring van de fabrikant en er " +
      "wordt geen exacte gelijkwaardigheid of betere prestatie geclaimd. Raadpleeg het technisch " +
      "informatieblad en de eisen van de fabrikant van de apparatuur voordat u een product vervangt.",
  },

  documentRequest: {
    unavailableTitle: "Dit document is op dit moment niet beschikbaar",
    closedTitle: "Documentaanvragen zijn nog niet geopend",
    closedText: "Dit document is binnenkort op aanvraag beschikbaar.",
    eyebrow: "Documentaanvraag",
    about: "{type} · revisie {revision} · voor {product}",
    intro:
      "Laat ons weten wie u bent en de pdf wordt direct gedownload. Het exemplaar dat u ontvangt, is voorzien van uw naam, uw bedrijfsnaam en een aanvraagreferentie.",
    validity: "De downloadlink blijft 15 minuten geldig, voor maximaal 3 downloads.",
    newsOptIn: "Productnieuws per e-mail ontvangt u alleen als u het aparte vakje aanvinkt.",
  },

  leadForm: {
    fullName: "Volledige naam",
    company: "Bedrijf",
    email: "Zakelijk e-mailadres",
    country: "Land",
    privacyNotice: "Privacyverklaring",
    privacyLegend: "Privacy",
    privacyAccept: "Ik heb gelezen hoe mijn gegevens worden gebruikt (verplicht).",
    optional: "(optioneel)",
    tooMany: {
      one: "Te veel aanvragen. Probeer het over ongeveer {count} minuut opnieuw.",
      other: "Te veel aanvragen. Probeer het over ongeveer {count} minuten opnieuw.",
    },
    documentGone: "Dit document is niet meer op aanvraag beschikbaar.",
    checkFields: "Controleer de gemarkeerde velden.",
    failed: "Er is iets misgegaan. Probeer het over een moment opnieuw.",
    noConnection: "Geen verbinding. Probeer het opnieuw.",
    outdatedUpdated:
      "Onze privacyinformatie is bijgewerkt nadat u deze pagina hebt geopend. Lees de actuele tekst hierboven en vink het vakje opnieuw aan. Uw overige gegevens blijven bewaard.",
    outdatedReload:
      "Onze privacyinformatie is bijgewerkt nadat u deze pagina hebt geopend. {reload} om de actuele versie te zien.",
    reload: "Laad de pagina opnieuw",
    versions: "Versie privacyverklaring {notice} · versie toestemming {consent}",
    submit: "Aanvragen en downloaden",
    doneEyebrow: "Dank u",
    doneTitle: "Uw download is gestart",
    doneReference: "{title}. Aanvraagreferentie {reference}.",
    doneFallback:
      "Is de download niet gestart? Gebruik dan de knop hieronder. Deze werkt tot {time}, voor maximaal {max} downloads in totaal.",
    downloadPdf: "Pdf downloaden",
  },

  contactForm: {
    name: "Uw naam",
    email: "Uw e-mailadres",
    company: "Bedrijf",
    country: "Land",
    phone: "Telefoonnummer",
    subject: "Onderwerp",
    message: "Uw bericht",
    tooMany: {
      one: "Te veel berichten. Probeer het over ongeveer {count} minuut opnieuw.",
      other: "Te veel berichten. Probeer het over ongeveer {count} minuten opnieuw.",
    },
    checkFields: "Controleer de gemarkeerde velden.",
    unavailable: "Het contactformulier is op dit moment niet beschikbaar. Bel of e-mail ons.",
    failed: "Er is iets misgegaan. Probeer het over een moment opnieuw, of bel of e-mail ons.",
    noConnection: "Geen verbinding. Probeer het opnieuw.",
    thankYou: "Dank u",
    received: "We hebben uw bericht ontvangen en antwoorden u per e-mail.",
    outdated:
      "Onze privacyinformatie is bijgewerkt nadat u deze pagina hebt geopend. {reload} om de actuele versie te lezen en verstuur uw bericht daarna opnieuw.",
    reload: "Laad de pagina opnieuw",
    noticeTitle: "Hoe wij uw gegevens gebruiken",
    noticeVersion: "· versie privacyverklaring {version}",
    send: "Bericht versturen",
  },

  contactSection: {
    phone: "Telefoon",
    email: "E-mail",
    office: "Kantoor",
    notAvailableYet: "Nog niet beschikbaar",
  },

  privacy: {
    draftTitle: "Concept — niet voor publicatie",
    draftText:
      "Deze tekst is niet definitief en wordt pas in productie getoond wanneer het volgende is geregeld:",
    eyebrow: "Privacy",
    title: "Privacybeleid",
    version: "Versie {version}",
    formTextsTitle: "De teksten op ons documentaanvraagformulier",
    noticeVersion: "Privacyverklaring, versie {version}",
    consentVersion: "Marketingtoestemming (optioneel), versie {version}",
  },
};
