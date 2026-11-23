/** ML-12a: the catalogue client's own messages (lib/catalog-client.ts), moved verbatim. */
export const api = {
  translationMissing:
    "Some texts are not translated yet ({languages}): see what is needed under Languages.",
  manualReview: "Confirm that you checked the {languages} text by hand before publishing it.",
  specBlocking: "Fix the blocking specification issues first (see the validation report).",
  checkFields: "Check these fields: {fields}.",
  notSaved: "The change could not be saved. Try again in a moment.",
  unreachable: "The admin API cannot be reached.",
} as const;
