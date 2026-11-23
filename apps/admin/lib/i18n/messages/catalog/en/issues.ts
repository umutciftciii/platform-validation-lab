/**
 * ML-12a: the catalogue's validation and publication-readiness texts. The API sends each issue with
 * a code and an English `message` (packages/contracts: checkSpecValue, validateProductData,
 * checkPublication); the console shows the message for the code (lib/catalog-issues.ts). These
 * English texts are the contract's own, word for word, so the English console is unchanged.
 */
export const issues = {
  spec: {
    required_missing: "{name} is required.",
    invalid_type: "{name}: expected a {type} value.",
    invalid_unit: "{name}: unit must be one of {units}.",
    invalid_unit_none: "{name}: this specification has no unit.",
    invalid_range: "{name}: {problem}.",
    out_of_bounds: "{name}: allowed range is {min} to {max}.",
    too_precise: "{name}: at most {decimals} decimals.",
    too_long: "{name}: at most {max} characters.",
    test_method_missing: "{name}: no test method (recommended: {methods}).",
    unknown_definition: "Unknown specification.",
    specs_missing:
      "No technical data: the product page says that technical data is available on request.",
    alt_text_missing: "An image has no alt text.",
    /** The console's own checks of an input that is not a value yet (lib/spec-validation). */
    enter_value: "{name}: enter a value or remove it.",
    enter_number: "{name}: enter a number.",
  },
  /** A typical value's name in the console's own checks. */
  typical: "{name} (typical)",
  /** The data type in `invalid_type` (the contract writes it in lower case). */
  types: {
    number: "number",
    text: "text",
    boolean: "boolean",
    range: "range",
  },
  /** What is wrong with a range (`invalid_range`, contracts rangeProblem). */
  range: {
    empty_bounds: "enter a minimum, a maximum or both",
    open_min: "an open minimum needs a minimum",
    open_max: "an open maximum needs a maximum",
    min_above_max: "minimum is above maximum",
    empty: "the range is empty",
  },
  publication: {
    archived: "Archived products cannot be published.",
    not_reviewed: "No second person has reviewed this version (optional).",
    not_approved: "The product master must be approved in its current version.",
    listing_missing: "The site does not list this product.",
    listing_shown_on_publish: "The listing is hidden; publishing makes it visible on this site.",
    listing_hidden: "The listing is hidden on this site.",
    cover_missing: "A cover image is required.",
    summary_missing: "No summary (listing or master): the product card and page show none.",
    description_missing: "The product has no description.",
    sensitive_claim:
      "The public text mentions {claim}: publish it only with a certificate or source document.",
    company_review_pending:
      "The company has not reviewed this site's research proposal (optional).",
  },
  /** DP-198: the console's plain wording of the two listing codes (lib/publication-status.ts). */
  plain: {
    listing_shown_on_publish: "Not shown on this site yet: publishing shows it.",
    listing_hidden:
      "Not shown on this site yet. Publishing here also needs edit rights on this site's listing.",
  },
  /** DP-193 sensitive claim categories (contracts SENSITIVE_CLAIMS labels). */
  claims: {
    saf: "SAF / aviation fuel",
    pharmaceutical: "pharmaceutical or pharmacopoeia grade",
    cosmetic: "cosmetic grade",
    food: "food grade or food contact",
    medical: "medical use",
    ctl_gtl: "CTL / GTL origin",
    certification: "certification or OEM approval",
    environmental: "environmental claim",
  },
} as const;
