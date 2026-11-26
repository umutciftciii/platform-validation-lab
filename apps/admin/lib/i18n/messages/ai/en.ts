/**
 * DP-287 (ADR-030): English messages of the AI Center (app/(console)/ai). The area is shown only
 * while the system owner keeps AI on (Owner Console); the API answers 404 otherwise.
 */
export const ai = {
  metaTitle: "AI Center",
  title: "AI Center",
  description:
    "AI providers, models, budgets and usage. Only the system owner switches AI on or off, in the Owner Console. AI never publishes anything: its suggestions are saved as drafts by a person.",
  loadError: "The AI Center could not be loaded",
  loadErrorText: "Try again in a moment.",
  statePanel: "State",
  stateOn: "AI is on",
  stateOnText:
    "Switched on by the system owner. The AI Center is visible to staff who may read it.",
  callsPanel: "AI calls",
  callsImpossible: "No AI call is possible",
  callsImpossibleText:
    "A call needs every item below. Until then nothing is sent to an AI provider and nothing is spent.",
  blockerMissing: "Missing",
  blockers: {
    transport_off: "AI calls switched on in the server environment (DP_AI_TRANSPORT)",
    no_provider_key: "An active, tested API key of a provider (OpenAI, Claude or Gemini)",
    no_enabled_model: "An enabled model with a dated unit price",
    no_budget: "A daily and a monthly budget",
  },
} as const;
