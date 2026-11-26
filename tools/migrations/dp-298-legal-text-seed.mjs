#!/usr/bin/env node
// DP-298: prints the seed of migration 20261222090000_dp_298_legal_texts_consents (Part 6) from
// the texts that were constants in @dream/contracts, so the database starts with the same words,
// versions and SHA-256 as the evidence already stored. Run after building the contracts:
//   pnpm --filter @dream/contracts build && node tools/migrations/dp-298-legal-text-seed.mjs
// The integration test (legal-texts.int.test.ts) checks the seeded rows against the constants.
import { createHash } from "node:crypto";
import {
  LEAD_CONTACT_NOTICE,
  LEAD_MARKETING_CONSENT,
  LEAD_PRIVACY_NOTICE,
  LEAD_TEXT_ARCHIVE,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_VERSION,
  SEED_LEGAL_TEXTS,
  policyEvidenceText,
  policyToMarkup,
} from "../../packages/contracts/dist/index.js";

const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const q = (t, tag) => {
  if (t.includes(`$${tag}$`)) throw new Error(`text contains $${tag}$`);
  return `$${tag}$${t}$${tag}$`;
};

/** Fixed ids (the Dutch drafts point at the English rows). */
const ID = {
  enPolicy: "0193d2a0-0000-7000-8000-000000000001",
  enDocument: "0193d2a0-0000-7000-8000-000000000002",
  enContact: "0193d2a0-0000-7000-8000-000000000003",
  enMarketing: "0193d2a0-0000-7000-8000-000000000004",
  archDocument: "0193d2a0-0000-7000-8000-000000000005",
  archMarketing: "0193d2a0-0000-7000-8000-000000000006",
  nlPolicy: "0193d2a0-0000-7000-8000-000000000011",
  nlDocument: "0193d2a0-0000-7000-8000-000000000012",
  nlContact: "0193d2a0-0000-7000-8000-000000000013",
  nlMarketing: "0193d2a0-0000-7000-8000-000000000014",
};

const rows = [];
function plain(id, key, locale, version, text, publishedAt, approvedAt, translatesId, note) {
  rows.push({
    id,
    key,
    locale,
    version,
    text,
    sections: null,
    sha: sha(text),
    publishedAt,
    approvedAt,
    translatesId,
    note,
  });
}
function policy(id, locale, version, sections, publishedAt, approvedAt, translatesId, note) {
  rows.push({
    id,
    key: "PRIVACY_POLICY",
    locale,
    version,
    text: policyToMarkup(sections),
    sections: JSON.stringify(sections),
    sha: sha(policyEvidenceText(sections)),
    publishedAt,
    approvedAt,
    translatesId,
    note,
  });
}

const PENDING =
  "DP-095: wording approved, not final while the D-T2 controller details are missing (was final:false).";
// English archive (2026-11-11, before the language suffix): published, superseded.
plain(
  ID.archDocument,
  "DOCUMENT_REQUEST_NOTICE",
  "en",
  LEAD_TEXT_ARCHIVE.privacyNotice[0].version,
  LEAD_TEXT_ARCHIVE.privacyNotice[0].text,
  "2026-11-11T00:00:00Z",
  null,
  null,
  "Archive text (DP-095 D-T7).",
);
plain(
  ID.archMarketing,
  "MARKETING_CONSENT",
  "en",
  LEAD_TEXT_ARCHIVE.marketingConsent[0].version,
  LEAD_TEXT_ARCHIVE.marketingConsent[0].text,
  "2026-11-11T00:00:00Z",
  null,
  null,
  "Archive text (DP-095 D-T7).",
);
// English current texts.
plain(
  ID.enDocument,
  "DOCUMENT_REQUEST_NOTICE",
  "en",
  LEAD_PRIVACY_NOTICE.version,
  LEAD_PRIVACY_NOTICE.text,
  "2026-11-12T00:00:00Z",
  LEAD_PRIVACY_NOTICE.final ? "2026-11-12T00:00:00Z" : null,
  null,
  PENDING,
);
plain(
  ID.enMarketing,
  "MARKETING_CONSENT",
  "en",
  LEAD_MARKETING_CONSENT.version,
  LEAD_MARKETING_CONSENT.text,
  "2026-11-12T00:00:00Z",
  LEAD_MARKETING_CONSENT.final ? "2026-11-12T00:00:00Z" : null,
  null,
  "DP-095 D-T4: marked final 2026-11-12.",
);
plain(
  ID.enContact,
  "CONTACT_NOTICE",
  "en",
  LEAD_CONTACT_NOTICE.version,
  LEAD_CONTACT_NOTICE.text,
  "2026-11-13T00:00:00Z",
  LEAD_CONTACT_NOTICE.final ? "2026-11-13T00:00:00Z" : null,
  null,
  "DP-151: draft until Dream Petroleum (or its DPO) approves it.",
);
policy(
  ID.enPolicy,
  "en",
  PRIVACY_POLICY_VERSION,
  PRIVACY_POLICY_SECTIONS,
  "2026-11-12T00:00:00Z",
  null,
  null,
  "DP-095: open points and D-T2 values still render as [pending: …].",
);
// Dutch translations: drafts under review (ADR-028 D12), never offered until published.
const nl = SEED_LEGAL_TEXTS.nl;
const NL_NOTE = "REVIEW REQUIRED (DP-095): see docs/i18n/legal-texts-nl-review.md.";
plain(
  ID.nlDocument,
  "DOCUMENT_REQUEST_NOTICE",
  "nl",
  null,
  nl.privacyNotice.text,
  null,
  null,
  ID.enDocument,
  NL_NOTE,
);
plain(
  ID.nlMarketing,
  "MARKETING_CONSENT",
  "nl",
  null,
  nl.marketingConsent.text,
  null,
  null,
  ID.enMarketing,
  NL_NOTE,
);
plain(
  ID.nlContact,
  "CONTACT_NOTICE",
  "nl",
  null,
  nl.contactNotice.text,
  null,
  null,
  ID.enContact,
  NL_NOTE,
);
policy(ID.nlPolicy, "nl", null, nl.privacyPolicy.sections, null, null, ID.enPolicy, NL_NOTE);

const lit = (v) => (v === null ? "NULL" : `'${v}'`);
const out = [];
for (const r of rows) {
  out.push(
    `INSERT INTO "LegalTextVersion" ("id", "key", "locale", "version", "status", "legalReview", ` +
      `"reviewNote", "text", "sections", "sha256", "translatesId", "createdAt", "updatedAt", ` +
      `"publishedAt", "reviewApprovedAt") VALUES (\n  '${r.id}', '${r.key}', '${r.locale}', ` +
      `${lit(r.version)}, '${r.version ? "PUBLISHED" : "DRAFT"}', '${r.approvedAt ? "APPROVED" : "REQUIRED"}',\n  ` +
      `${q(r.note, "note")},\n  ${q(r.text, "txt")},\n  ` +
      `${r.sections === null ? "NULL" : `${q(r.sections, "json")}::jsonb`},\n  '${r.sha}', ` +
      `${lit(r.translatesId)}, ${r.publishedAt ? lit(r.publishedAt) : "CURRENT_TIMESTAMP"}, ` +
      `${r.publishedAt ? lit(r.publishedAt) : "CURRENT_TIMESTAMP"}, ${lit(r.publishedAt)}, ${lit(r.approvedAt)});`,
  );
}
process.stdout.write(out.join("\n\n") + "\n");
