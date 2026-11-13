/**
 * Privacy policy of the public sites and the publication gate of the privacy texts (DP-095,
 * approved 2026-11-12; ADR-003, ADR-016 D2). Shared by web-bv, web-corporate and the API.
 *
 * - The controller details (D-T2) are supplied by the owner. They are NOT guessed: a missing value
 *   is `null` and renders as a visible "[pending: …]" marker.
 * - While anything is missing (`privacyBlockers()`), the texts are drafts: they render with a draft
 *   banner outside production and are not published in production at all (D-T3, D-T5). The lead
 *   form follows the same gate, because its notice points to this policy.
 */
import { LEAD_MARKETING_CONSENT, LEAD_PRIVACY_NOTICE } from "./leads.js";

export type PrivacyDeployEnv = "local" | "staging" | "production";

/** D-T2: owner-supplied controller details. `null` = not supplied yet (never invent a value). */
export const PRIVACY_CONTROLLER = {
  legalName: "Dream Petroleum B.V.",
  registeredAddress: null as string | null,
  kvkNumber: null as string | null,
  privacyEmail: null as string | null,
  /** Whether a DPO is required (owner/legal) and, if so, how to reach them. */
  dpo: null as { required: false } | { required: true; contact: string } | null,
  supervisoryAuthority: "Autoriteit Persoonsgegevens",
} as const;

/**
 * Points of the policy that other backlog items still have to settle. They keep the policy a draft
 * as long as they are open; each renders as "[pending: …]" where it is used.
 */
export const PRIVACY_POLICY_OPEN_POINTS = {
  processors: { backlog: "DP-095", label: "list of hosting and service providers (processors)" },
  transfers: { backlog: "DP-095", label: "transfers outside the EEA, if any" },
  cookies: { backlog: "DP-095", label: "confirmed list of cookies at launch" },
  customerRecords: {
    backlog: "DP-122",
    label: "retention policy for customers and open sales opportunities",
  },
  evidenceRetention: {
    backlog: "DP-123",
    label: "retention period of the unlinked consent evidence",
  },
  backups: { backlog: "DP-121", label: "backup retention period" },
} as const;
export type PrivacyOpenPoint = keyof typeof PRIVACY_POLICY_OPEN_POINTS;

/** Values that fill the open points once decided. `null` = still open. */
export const PRIVACY_POLICY_VALUES: Readonly<Record<PrivacyOpenPoint, string | null>> = {
  processors: null,
  transfers: null,
  cookies: null,
  customerRecords: null,
  evidenceRetention: null,
  backups: null,
};

export const PRIVACY_POLICY_VERSION = "2026-11-12.en";

/** Everything that still stops publication in production, as readable labels. */
export function privacyBlockers(
  controller: typeof PRIVACY_CONTROLLER = PRIVACY_CONTROLLER,
  values: Readonly<Record<PrivacyOpenPoint, string | null>> = PRIVACY_POLICY_VALUES,
  noticeFinal: boolean = LEAD_PRIVACY_NOTICE.final,
): string[] {
  const out: string[] = [];
  if (!controller.registeredAddress) out.push("D-T2: registered address");
  if (!controller.kvkNumber) out.push("D-T2: Chamber of Commerce (KvK) number");
  if (!controller.privacyEmail) out.push("D-T2: privacy contact e-mail");
  if (!controller.dpo) out.push("D-T2: whether a DPO is required, and the contact if so");
  for (const [key, point] of Object.entries(PRIVACY_POLICY_OPEN_POINTS)) {
    if (!values[key as PrivacyOpenPoint]) out.push(`${point.backlog}: ${point.label}`);
  }
  if (!noticeFinal) out.push("D-T3: lead privacy notice not marked final");
  if (!LEAD_MARKETING_CONSENT.final) out.push("D-T4: marketing consent text not marked final");
  return out;
}

export interface PrivacyPublication {
  /** The page and the lead form may be shown in this environment. */
  publish: boolean;
  /** Shown as a draft (banner, "[pending: …]" markers). */
  draft: boolean;
  blockers: string[];
}

/** D-T5: drafts are visible locally and on staging, never in production. */
export function privacyPublication(
  deployEnv: PrivacyDeployEnv,
  blockers: string[] = privacyBlockers(),
): PrivacyPublication {
  const draft = blockers.length > 0;
  return { publish: deployEnv !== "production" || !draft, draft, blockers };
}

/** Reads DP_DEPLOY_ENV like the API does; anything unknown counts as production (fail closed). */
export function privacyDeployEnv(raw: string | undefined): PrivacyDeployEnv {
  const v = (raw ?? "local").trim() || "local";
  return v === "local" || v === "staging" ? v : "production";
}

// --- policy text --------------------------------------------------------------------------------

export interface PrivacySection {
  id: string;
  title: string;
  paragraphs: string[];
  list?: string[];
}

/**
 * Placeholders: {legalName} {registeredAddress} {kvkNumber} {privacyEmail} {dpo}
 * {supervisoryAuthority} and one per open point ({processors}, {transfers}, …).
 */
export const PRIVACY_POLICY_SECTIONS: readonly PrivacySection[] = [
  {
    id: "controller",
    title: "Who is responsible",
    paragraphs: [
      "{legalName}, {registeredAddress}, registered with the Netherlands Chamber of Commerce (KvK) under number {kvkNumber}, is responsible (the controller) for the personal data described here.",
      "Questions and requests about your data: {privacyEmail}. Data protection officer: {dpo}.",
    ],
  },
  {
    id: "data",
    title: "What we collect when you request a document",
    paragraphs: [
      "Some technical documents are available after a short form. With that form we receive:",
    ],
    list: [
      "your name, company, work e-mail and country;",
      "whether you agreed to marketing e-mails, and the version of the texts you were shown;",
      "which document you asked for, when, and when it was downloaded;",
      "a keyed hash of the network part of your IP address (not the address itself), used only to protect the form against abuse.",
    ],
  },
  {
    id: "purposes",
    title: "Why we use it, and on what basis",
    paragraphs: [
      "We use these details to send you the document, to keep a record of which document we provided, and to follow up on your request. Our legal basis is our legitimate interest in answering business enquiries (GDPR Art. 6(1)(f)). We have weighed that interest against yours; you can ask us for that assessment.",
      "You can object to this use at any time (GDPR Art. 21). We then stop, unless we have compelling legitimate grounds or need the data for a legal claim.",
      "Marketing e-mails are sent only if you tick the separate, optional box (consent, GDPR Art. 6(1)(a)). It is never needed for a download, and you can withdraw it at any time. We do not send marketing e-mails yet.",
    ],
  },
  {
    id: "watermark",
    title: "Your name on the PDF",
    paragraphs: [
      "The PDF you receive is marked with your name, your company and a request reference, so that a copy can be traced to its request. Copies you keep or share are outside our systems; we cannot recall them.",
    ],
  },
  {
    id: "retention",
    title: "How long we keep it",
    paragraphs: [
      "We keep your details for 24 months after your last document request or your last activity under a valid marketing consent. A marketing consent alone does not keep your details indefinitely. After that period we anonymise them: your name, company and e-mail are removed.",
      "The keyed hash of your network address is removed after 90 days.",
      "A record of which text version was shown and accepted is kept without your name, company or e-mail, for {evidenceRetention}.",
      "If you are a customer or we are in an open business discussion with you, our customer records policy applies instead: {customerRecords}.",
      "Backups: {backups}.",
    ],
  },
  {
    id: "recipients",
    title: "Who can see it",
    paragraphs: [
      "Only staff who need it for your request, with access that is granted per role, limited in time and logged. Service providers who host or run our systems on our behalf: {processors}. We do not sell your data.",
      "Transfers outside the European Economic Area: {transfers}.",
    ],
  },
  {
    id: "rights",
    title: "Your rights",
    paragraphs: [
      "You can ask to see your data, to correct it, to have it deleted or restricted, to receive it in a common format, and to object to its use. Write to {privacyEmail}. We answer within one month. To protect you, we confirm the request by replying to the e-mail address we hold, and we may keep data where the law requires it.",
      "You can also complain to the {supervisoryAuthority}.",
    ],
  },
  {
    id: "cookies",
    title: "Cookies",
    paragraphs: [
      "When you request a document, this site sets one strictly necessary cookie that lets your browser download it; it expires after 15 minutes. Full list: {cookies}.",
    ],
  },
  {
    id: "changes",
    title: "Changes",
    paragraphs: [
      "When this policy or the form texts change, they get a new version; we keep earlier versions so we can show which text you saw.",
    ],
  },
];

function dpoText(dpo: (typeof PRIVACY_CONTROLLER)["dpo"]): string | null {
  if (!dpo) return null;
  return dpo.required ? dpo.contact : "not required for our organisation";
}

/** Fills the placeholders; a missing value becomes a visible "[pending: …]" marker. */
export function fillPrivacyText(
  text: string,
  controller: typeof PRIVACY_CONTROLLER = PRIVACY_CONTROLLER,
  values: Readonly<Record<PrivacyOpenPoint, string | null>> = PRIVACY_POLICY_VALUES,
): string {
  const known: Record<string, [string | null, string]> = {
    legalName: [controller.legalName, "legal name"],
    registeredAddress: [controller.registeredAddress, "registered address"],
    kvkNumber: [controller.kvkNumber, "KvK number"],
    privacyEmail: [controller.privacyEmail, "privacy contact e-mail"],
    dpo: [dpoText(controller.dpo), "DPO decision"],
    supervisoryAuthority: [controller.supervisoryAuthority, "supervisory authority"],
  };
  for (const [key, point] of Object.entries(PRIVACY_POLICY_OPEN_POINTS)) {
    known[key] = [values[key as PrivacyOpenPoint], point.label];
  }
  return text.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => {
    const entry = known[key];
    if (!entry) return match;
    return entry[0] ?? `[pending: ${entry[1]}]`;
  });
}
