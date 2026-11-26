/**
 * ML-10 (DP-241; ADR-028 D12, DP-095): the legal and consent texts of the public forms per
 * language — lead privacy notice, marketing consent, contact notice and the privacy policy.
 *
 * - English is the source. Its texts are the constants of leads.ts and privacy.ts, unchanged
 *   (same words, same versions, same SHA-256); the English entry only points at them.
 * - Another language is a faithful translation of the English texts it names (`translates`), with
 *   its own versions (`<date>.<locale>`) and therefore its own SHA-256 (D12, D-T6).
 * - `review` is the legal review of a translation (DP-095). Only English (`source`) and a
 *   translation marked `approved` by that review are ever offered: shown on a public page, served
 *   by `/lead-form/texts`, or accepted by the API as the text a visitor saw. A translation that
 *   is `review_required` is a draft for the reviewers; it existing here makes nothing public.
 *   Marking a translation approved is a code change made only after the DP-095 approval.
 * - Publication in production keeps its own gate on top (`privacyPublication()`: the controller
 *   details and the `final` flags of DP-095 D-T3/D-T5). Approval of the wording is not
 *   publication.
 */
import {
  LEAD_CONTACT_NOTICE,
  LEAD_MARKETING_CONSENT,
  LEAD_PRIVACY_NOTICE,
  type LeadFormTexts,
} from "./leads.js";
import {
  PRIVACY_FILL_LABELS_EN,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_VERSION,
  type PrivacyFillLabels,
  type PrivacySection,
} from "./privacy.js";

export const LEGAL_TEXT_REVIEW_STATES = ["source", "review_required", "approved"] as const;
export type LegalTextReviewState = (typeof LEGAL_TEXT_REVIEW_STATES)[number];

export interface LegalText {
  readonly version: string;
  readonly text: string;
}

/** The legal texts of the public forms in one language. */
export interface LegalTextSet {
  readonly locale: string;
  readonly review: LegalTextReviewState;
  /** The English versions this translation renders; null for the English source itself. */
  readonly translates: {
    readonly privacyNotice: string;
    readonly marketingConsent: string;
    readonly contactNotice: string;
    readonly privacyPolicy: string;
  } | null;
  readonly privacyNotice: LegalText;
  readonly marketingConsent: LegalText;
  readonly contactNotice: LegalText;
  readonly privacyPolicy: {
    readonly version: string;
    readonly sections: readonly PrivacySection[];
    readonly labels: PrivacyFillLabels;
  };
}

/** English: the existing texts, by reference (never a copy, so nothing can drift). */
const EN: LegalTextSet = {
  locale: "en",
  review: "source",
  translates: null,
  privacyNotice: { version: LEAD_PRIVACY_NOTICE.version, text: LEAD_PRIVACY_NOTICE.text },
  marketingConsent: { version: LEAD_MARKETING_CONSENT.version, text: LEAD_MARKETING_CONSENT.text },
  contactNotice: { version: LEAD_CONTACT_NOTICE.version, text: LEAD_CONTACT_NOTICE.text },
  privacyPolicy: {
    version: PRIVACY_POLICY_VERSION,
    sections: PRIVACY_POLICY_SECTIONS,
    labels: PRIVACY_FILL_LABELS_EN,
  },
};

/**
 * Dutch: faithful translation of the English texts above (ADR-028 D12), prepared 2026-11-23.
 * REVIEW REQUIRED (DP-095): not approved, so not current, not public and never accepted as
 * consent. The points the reviewers should look at are listed in
 * docs/i18n/legal-texts-nl-review.md. A wording change after review is a new version.
 */
const NL: LegalTextSet = {
  locale: "nl",
  review: "review_required",
  translates: {
    privacyNotice: LEAD_PRIVACY_NOTICE.version,
    marketingConsent: LEAD_MARKETING_CONSENT.version,
    contactNotice: LEAD_CONTACT_NOTICE.version,
    privacyPolicy: PRIVACY_POLICY_VERSION,
  },
  privacyNotice: {
    version: "2026-11-23.nl",
    text:
      "Dream Petroleum B.V. gebruikt uw naam, bedrijf, zakelijk e-mailadres en land om u dit " +
      "document te sturen, om bij te houden welk document wij hebben verstrekt en om uw aanvraag " +
      "op te volgen. Wij doen dit op grond van ons gerechtvaardigd belang bij het beantwoorden van " +
      "zakelijke vragen. De pdf die u ontvangt, is voorzien van uw naam, uw bedrijf en een " +
      "aanvraagreferentie. Wij bewaren deze gegevens gedurende 24 maanden na uw laatste aanvraag " +
      "of uw laatste activiteit onder een marketingtoestemming en anonimiseren ze daarna. U kunt " +
      "vragen om ze in te zien, te corrigeren of te verwijderen, of bezwaar maken tegen dit " +
      "gebruik, zoals uitgelegd in ons privacybeleid.",
  },
  marketingConsent: {
    version: "2026-11-23.nl",
    text:
      "Ja, Dream Petroleum B.V. mag mij af en toe per e-mail nieuws sturen over haar producten en " +
      "technische updates. Ik kan dit op elk moment intrekken via de link in elke e-mail of zoals " +
      "uitgelegd in het privacybeleid.",
  },
  contactNotice: {
    version: "2026-11-23.nl",
    text:
      "Dream Petroleum B.V. gebruikt uw naam, bedrijf, e-mailadres, land, uw bericht en, als u " +
      "dat opgeeft, uw telefoonnummer om uw vraag te beantwoorden en om daarvan een registratie " +
      "bij te houden. Wij doen dit op grond van ons gerechtvaardigd belang bij het beantwoorden " +
      "van zakelijke vragen. Wij bewaren deze gegevens gedurende 24 maanden na uw laatste bericht " +
      "of aanvraag en anonimiseren ze daarna. U kunt vragen om ze in te zien, te corrigeren of te " +
      "verwijderen, of bezwaar maken tegen dit gebruik, zoals uitgelegd in ons privacybeleid.",
  },
  privacyPolicy: {
    version: "2026-11-23.nl",
    labels: {
      pending: "[nog vast te stellen: {label}]",
      dpoNotRequired: "niet vereist voor onze organisatie",
      fields: {
        legalName: "statutaire naam",
        registeredAddress: "geregistreerd adres",
        kvkNumber: "KvK-nummer",
        privacyEmail: "e-mailadres voor privacyvragen",
        dpo: "besluit over de functionaris voor gegevensbescherming",
        supervisoryAuthority: "toezichthoudende autoriteit",
      },
      openPoints: {
        processors: "lijst van hosting- en dienstverleners (verwerkers)",
        transfers: "doorgiften buiten de EER, indien van toepassing",
        cookies: "bevestigde lijst van cookies bij de lancering",
        customerRecords: "bewaarbeleid voor klanten en lopende verkoopkansen",
        evidenceRetention: "bewaartermijn van het niet-gekoppelde bewijs van toestemming",
        backups: "bewaartermijn van back-ups",
      },
    },
    sections: [
      {
        id: "controller",
        title: "Wie is verantwoordelijk",
        paragraphs: [
          "{legalName}, {registeredAddress}, ingeschreven bij de Nederlandse Kamer van Koophandel (KvK) onder nummer {kvkNumber}, is verantwoordelijk (de verwerkingsverantwoordelijke) voor de hier beschreven persoonsgegevens.",
          "Vragen en verzoeken over uw gegevens: {privacyEmail}. Functionaris voor gegevensbescherming: {dpo}.",
        ],
      },
      {
        id: "data",
        title: "Wat wij verzamelen wanneer u een document aanvraagt",
        paragraphs: [
          "Sommige technische documenten zijn beschikbaar na een kort formulier. Via dat formulier ontvangen wij:",
        ],
        list: [
          "uw naam, bedrijf, zakelijk e-mailadres en land;",
          "of u hebt ingestemd met marketing-e-mails, en de versie van de teksten die u te zien kreeg;",
          "welk document u hebt aangevraagd, wanneer, en wanneer het is gedownload;",
          "een met een sleutel berekende hash van het netwerkgedeelte van uw IP-adres (niet het adres zelf), alleen gebruikt om het formulier tegen misbruik te beschermen.",
        ],
      },
      {
        id: "purposes",
        title: "Waarom wij ze gebruiken, en op welke grondslag",
        paragraphs: [
          "Wij gebruiken deze gegevens om u het document te sturen, om bij te houden welk document wij hebben verstrekt en om uw aanvraag op te volgen. Onze rechtsgrondslag is ons gerechtvaardigd belang bij het beantwoorden van zakelijke vragen (AVG art. 6 lid 1 onder f). Wij hebben dat belang afgewogen tegen het uwe; u kunt ons om die afweging vragen.",
          "U kunt op elk moment bezwaar maken tegen dit gebruik (AVG art. 21). Wij stoppen dan, tenzij wij dwingende gerechtvaardigde gronden hebben of de gegevens nodig hebben voor een rechtsvordering.",
          "Marketing-e-mails worden alleen verstuurd als u het aparte, optionele vakje aanvinkt (toestemming, AVG art. 6 lid 1 onder a). Dit is nooit nodig voor een download, en u kunt de toestemming op elk moment intrekken. Wij versturen nog geen marketing-e-mails.",
        ],
      },
      {
        id: "watermark",
        title: "Uw naam op de pdf",
        paragraphs: [
          "De pdf die u ontvangt, is voorzien van uw naam, uw bedrijf en een aanvraagreferentie, zodat een kopie kan worden herleid tot de aanvraag. Kopieën die u bewaart of deelt, vallen buiten onze systemen; wij kunnen ze niet terughalen.",
        ],
      },
      {
        id: "retention",
        title: "Hoe lang wij ze bewaren",
        paragraphs: [
          "Wij bewaren uw gegevens gedurende 24 maanden na uw laatste documentaanvraag of uw laatste activiteit onder een geldige marketingtoestemming. Een marketingtoestemming alleen zorgt er niet voor dat uw gegevens onbeperkt worden bewaard. Na die periode anonimiseren wij ze: uw naam, bedrijf en e-mailadres worden verwijderd.",
          "De met een sleutel berekende hash van uw netwerkadres wordt na 90 dagen verwijderd.",
          "Een registratie van welke tekstversie is getoond en geaccepteerd, wordt zonder uw naam, bedrijf of e-mailadres bewaard, gedurende {evidenceRetention}.",
          "Als u klant bent of als wij met u in een lopend zakelijk gesprek zijn, geldt in plaats daarvan ons beleid voor klantgegevens: {customerRecords}.",
          "Back-ups: {backups}.",
        ],
      },
      {
        id: "recipients",
        title: "Wie ze kan zien",
        paragraphs: [
          "Alleen medewerkers die ze nodig hebben voor uw aanvraag, met toegang die per rol wordt verleend, in de tijd beperkt is en wordt vastgelegd. Dienstverleners die onze systemen namens ons hosten of beheren: {processors}. Wij verkopen uw gegevens niet.",
          "Doorgiften buiten de Europese Economische Ruimte: {transfers}.",
        ],
      },
      {
        id: "rights",
        title: "Uw rechten",
        paragraphs: [
          "U kunt vragen om uw gegevens in te zien, te corrigeren, te laten verwijderen of te laten beperken, om ze in een gangbaar formaat te ontvangen, en om bezwaar te maken tegen het gebruik ervan. Schrijf naar {privacyEmail}. Wij antwoorden binnen één maand. Ter bescherming van u bevestigen wij het verzoek door te antwoorden op het e-mailadres dat wij van u hebben, en wij kunnen gegevens bewaren waar de wet dat vereist.",
          "U kunt ook een klacht indienen bij de {supervisoryAuthority}.",
        ],
      },
      {
        id: "cookies",
        title: "Cookies",
        paragraphs: [
          "Wanneer u een document aanvraagt, plaatst deze site één strikt noodzakelijke cookie waarmee uw browser het document kan downloaden; deze verloopt na 15 minuten. Volledige lijst: {cookies}.",
        ],
      },
      {
        id: "changes",
        title: "Wijzigingen",
        paragraphs: [
          "Wanneer dit beleid of de formulierteksten wijzigen, krijgen ze een nieuwe versie; wij bewaren eerdere versies, zodat wij kunnen laten zien welke tekst u te zien kreeg.",
        ],
      },
    ],
  },
};

/** Every language's texts, approved or not. Keyed by locale tag. */
export type LegalTextRegistry = Readonly<Record<string, LegalTextSet>>;
export const LEGAL_TEXTS: LegalTextRegistry = { en: EN, nl: NL };

/** Whether a language's texts may be offered (shown publicly, served, accepted as consent). */
export function legalTextsOffered(set: LegalTextSet): boolean {
  return set.review === "source" || set.review === "approved";
}

/**
 * The texts of `locale` that may be offered, or null: no texts in that language, or a
 * translation still under review (fail closed). The caller still checks that the language is
 * public on the site and the production gate.
 */
export function legalTextsFor(
  locale: string,
  registry: LegalTextRegistry = LEGAL_TEXTS,
): LegalTextSet | null {
  const set = Object.hasOwn(registry, locale) ? registry[locale] : undefined;
  return set && set.locale === locale && legalTextsOffered(set) ? set : null;
}

/** The languages whose texts may be offered (English always). */
export function offeredLegalLocales(registry: LegalTextRegistry = LEGAL_TEXTS): string[] {
  return Object.keys(registry).filter((l) => legalTextsFor(l, registry) !== null);
}

/** The lead form's texts in `locale`, or null where they may not be offered. */
export function leadFormTextsFor(
  locale: string,
  registry: LegalTextRegistry = LEGAL_TEXTS,
): LeadFormTexts | null {
  const set = legalTextsFor(locale, registry);
  if (!set) return null;
  return {
    privacyNotice: { version: set.privacyNotice.version, text: set.privacyNotice.text },
    marketingConsent: { version: set.marketingConsent.version, text: set.marketingConsent.text },
  };
}

/**
 * The language a stored text version names (D-T6: `<date>.<locale>`). Versions from before the
 * language suffix (the 2026-11-11 archive) were English.
 */
export function legalTextVersionLocale(version: string): string {
  const m = /\.([a-z]{2,3})$/.exec(version);
  return m?.[1] ?? "en";
}

// --- DP-298 (ADR-031 D1): the registry built from the published versions ------------------------

/**
 * The placeholder labels of the policy per language (presentation, not legal wording; they name
 * the D-T2 values still missing). A language without labels falls back to English.
 */
export const PRIVACY_FILL_LABELS: Readonly<Record<string, PrivacyFillLabels>> = {
  en: PRIVACY_FILL_LABELS_EN,
  nl: NL.privacyPolicy.labels,
};

/**
 * The registry of the forms and the privacy page from the API's published versions
 * (`GET /api/v1/public/legal-texts`). Since DP-298 the constants above are the SEED of the
 * database (migration 20261222090000_dp_298_legal_texts_consents), not the runtime source: a
 * language is offered exactly when the API lists its four published texts. `review` then means
 * "published" (`source` for English, `approved` for a translation); the lawyer's review is the
 * separate production gate (`privacyBlockersFor`).
 */
export function legalTextRegistryFrom(
  sets: readonly {
    locale: string;
    privacyNotice: LegalText;
    marketingConsent: LegalText;
    contactNotice: LegalText;
    privacyPolicy: { version: string; sections: readonly PrivacySection[] };
    translates: LegalTextSet["translates"];
  }[],
): LegalTextRegistry {
  const out: Record<string, LegalTextSet> = {};
  for (const s of sets) {
    out[s.locale] = {
      locale: s.locale,
      review: s.locale === "en" ? "source" : "approved",
      translates: s.translates,
      privacyNotice: s.privacyNotice,
      marketingConsent: s.marketingConsent,
      contactNotice: s.contactNotice,
      privacyPolicy: {
        version: s.privacyPolicy.version,
        sections: s.privacyPolicy.sections,
        labels: PRIVACY_FILL_LABELS[s.locale] ?? PRIVACY_FILL_LABELS_EN,
      },
    };
  }
  return out;
}

/** The seed registry exactly as the constants define it (tests and the migration generator). */
export const SEED_LEGAL_TEXTS: LegalTextRegistry = LEGAL_TEXTS;
