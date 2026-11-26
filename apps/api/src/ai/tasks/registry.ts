/**
 * DP-291 (ADR-030 D8): the tasks the shared AI operation service can run. A task fixes its system
 * message, how long its input may be and how its answer is checked; the caller gives only the
 * input. AI-1 has one task, the connectivity check `DIAGNOSTIC_PING`; translation, SEO and content
 * tasks (AI-2, DP-255) are registered but not available until their own PR defines them.
 *
 * Every answer is a DRAFT: the service hands it back to the person who asked; nothing here (or
 * anywhere in src/ai) can write or publish content (ESLint boundary). A person applies a draft
 * through the existing editors and import/approval paths with their own permissions.
 */
import type { AiTask } from "../ledger-sql.js";

export interface AiTaskDefinition {
  task: AiTask;
  /** False until the task's own PR (AI-2) defines it. */
  available: boolean;
  system: string;
  /** Characters of input (after trimming). */
  maxInputChars: number;
  /** The checked draft text, or null when the answer is not usable. */
  checkOutput(text: string): string | null;
}

const unavailable = (task: AiTask): AiTaskDefinition => ({
  task,
  available: false,
  system: "",
  maxInputChars: 0,
  checkOutput: () => null,
});

export const AI_TASKS: Readonly<Record<AiTask, AiTaskDefinition>> = {
  DIAGNOSTIC_PING: {
    task: "DIAGNOSTIC_PING",
    available: true,
    system:
      "You are a connectivity check of a content platform. Reply with the single word: pong. " +
      "Do not add anything else.",
    maxInputChars: 500,
    checkOutput: (text) => {
      const t = text.trim();
      return t.length > 0 && t.length <= 200 ? t : null;
    },
  },
  TRANSLATION: unavailable("TRANSLATION"),
  SEO_META: unavailable("SEO_META"),
  CONTENT_DRAFT: unavailable("CONTENT_DRAFT"),
};
