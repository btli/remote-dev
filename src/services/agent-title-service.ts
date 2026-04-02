/**
 * AgentTitleService — Utilities for agent session titling.
 *
 * Agents set their own titles via `rdv session title <kebab-case-title>`.
 * This module provides the `deriveShortTitle` helper used by the /set endpoint
 * and exported for testing.
 */

const MAX_TITLE_WORDS = 5;

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "to", "for", "in", "of", "with",
  "and", "or", "but", "not", "it", "its", "this", "that",
]);

/**
 * Derive a short 3–5 word kebab-case title from a user message.
 * Strips command prefixes, slash commands, stop words, and punctuation.
 */
export function deriveShortTitle(message: string): string | null {
  // Take first line only
  let text = message.split("\n")[0].trim();
  if (!text) return null;

  // Strip leading slash-command patterns like "/feature-dev:feature-dev"
  text = text.replace(/^\/[\w:_-]+\s*/, "");

  // Strip markdown formatting
  text = text.replace(/[*_`#]/g, "");

  // Strip leading articles/filler words
  text = text.replace(/^(please|can you|could you|i want to|i need to|let's|lets)\s+/i, "");

  // Strip common stop words to make titles more meaningful
  const allWords = text.split(/\s+/).filter(Boolean);
  const meaningful = allWords.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  // Fall back to original words if all were stop words
  const wordPool = meaningful.length > 0 ? meaningful : allWords;

  // Take first N words, require at least 2 for a meaningful title
  const words = wordPool.slice(0, MAX_TITLE_WORDS);
  if (words.length < 2) return null;

  // Lowercase, strip non-alphanumeric chars, kebab-case
  const title = words
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .join("-");

  return title || null;
}
