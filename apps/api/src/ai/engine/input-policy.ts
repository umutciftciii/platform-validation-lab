/**
 * DP-291 (ADR-030 D8; design §8.4): no personal data goes to an AI provider in AI-1. Before any
 * reservation the input is checked for e-mail addresses, phone numbers, IBANs and payment card
 * numbers; a match refuses the operation (`input_rejected_personal_data`) and nothing of the input
 * is stored, logged or audited (only the rule name). The AI module cannot read lead or member data
 * at all (ESLint boundary + row-level security); this check is the second line for text a staff
 * member types or pastes.
 */
export type PersonalDataRule = "email" | "phone" | "iban" | "payment_card";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i;
/** International (+31 6…, 0031 6…) or national with a trunk 0 (06-12345678, 020 123 4567). */
const PHONE =
  /(?:\+|\b00)[1-9]\d{0,2}[\s().-]*(?:\d[\s().-]*){6,}\d|\b0\d{1,3}[\s/-]?\d(?:[\s-]?\d){5,8}\b/;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/;
const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function ibanValid(raw: string): boolean {
  const s = raw.replace(/ /g, "").toUpperCase();
  const moved = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/** The first personal-data rule the text breaks, or null. */
export function personalDataIn(text: string): PersonalDataRule | null {
  if (EMAIL.test(text)) return "email";
  const iban = IBAN.exec(text);
  if (iban && ibanValid(iban[0])) return "iban";
  for (const m of text.matchAll(CARD)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && luhn(digits)) return "payment_card";
  }
  if (PHONE.test(text)) return "phone";
  return null;
}
