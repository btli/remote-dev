/**
 * ClaudeModelIdentity - The ONE place that reconciles a Claude model *id* with
 * the model *display name* the usage endpoint reports. [remote-dev-n4x4.3]
 *
 * ## Why this exists
 *
 * `GET /api/oauth/usage` reports a per-model weekly window as
 * `scope: { model: { id: null, display_name: "Fable" } }` — `id` is null in
 * every observed response, so the DISPLAY NAME is the only usable per-model
 * identity. Callers, meanwhile, hold a model *id* (`claude-fable-5`) or a CLI
 * alias (`opus`, `sonnet[1m]`). Neither string equals the other, so matching
 * requires a normalization both sides can be reduced to.
 *
 * This is the part of the epic most likely to rot as model names change, so it
 * lives in exactly one pure function with tests, and it is deliberately
 * conservative: when it cannot confidently identify a family it returns the
 * whole normalized string rather than guessing, and a non-match FAILS OPEN
 * (the caller treats "no scoped row" as available — never as unavailable).
 *
 * ## How normalization works
 *
 * 1. Lowercase, trim, collapse separators (`_`, whitespace) to `-`, and strip
 *    context-window suffixes like `[1m]`.
 * 2. If any hyphen-delimited segment is a KNOWN family token, return that token.
 *    This is what maps `claude-fable-5` → `fable`, `"Fable"` → `fable`, and
 *    `claude-3-5-sonnet-20241022` → `sonnet` (family in the middle).
 * 3. Otherwise return the fully normalized string, so an unknown-but-identical
 *    display name (e.g. a future `"Cowork"` scope vs a `cowork` request) still
 *    matches exactly, while genuinely different strings do not.
 *
 * Pure and immutable: no DB / fs / network.
 */

/**
 * Known Claude model family tokens, matched as whole segments.
 *
 * Intentionally families only — NOT versions. A per-model weekly window is
 * scoped to a family ("Fable"), not to a point release, and pinning versions
 * here would make the mapping rot on every model launch. An unrecognized
 * family is not an error: it falls through to whole-string comparison.
 */
const KNOWN_FAMILIES: readonly string[] = [
  "fable",
  "mythos",
  "opus",
  "sonnet",
  "haiku",
];

/** Context-window / variant suffixes that carry no family information. */
const VARIANT_SUFFIX = /\[[^\]]*\]/g;

/**
 * Reduce a model id, CLI alias, or display name to a comparable identity.
 *
 * @param raw A model id (`claude-fable-5`), an alias (`opus`), or a usage
 *   endpoint display name (`"Fable"`). Case- and whitespace-tolerant.
 * @returns The canonical identity, or null when `raw` carries no identity
 *   (not a string, or empty/whitespace/punctuation only).
 */
export function normalizeClaudeModelIdentity(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const normalized = raw
    .toLowerCase()
    .replace(VARIANT_SUFFIX, "")
    // Any run of separators (whitespace, underscore, dot, slash, hyphen)
    // becomes a single hyphen so segmentation is uniform across the id styles
    // ("claude-fable-5", "Claude Fable 5", "claude_fable_5").
    .replace(/[\s._/-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length === 0) return null;

  for (const segment of normalized.split("-")) {
    if (KNOWN_FAMILIES.includes(segment)) return segment;
  }

  return normalized;
}

/**
 * Whether a requested model and a usage-window scope name identify the same
 * model.
 *
 * Returns false whenever either side has no identity — the caller must treat
 * that as "unknown", which by contract means AVAILABLE (fail open), never
 * "blocked".
 */
export function claudeModelIdentityMatches(
  requestedModel: unknown,
  scopeModelDisplayName: unknown
): boolean {
  const requested = normalizeClaudeModelIdentity(requestedModel);
  if (requested === null) return false;
  const scoped = normalizeClaudeModelIdentity(scopeModelDisplayName);
  if (scoped === null) return false;
  return requested === scoped;
}

/**
 * Extract the model a session is requesting from its agent CLI flags.
 *
 * Claude Code takes `--model <id>` (or `--model=<id>`); there is no dedicated
 * model field on session creation, so the flags ARE the request. Returns the
 * LAST occurrence (matching how CLIs resolve repeated flags) or null when no
 * model flag is present — and null must never narrow availability.
 */
export function requestedModelFromAgentFlags(
  flags: readonly string[] | null | undefined
): string | null {
  if (!Array.isArray(flags)) return null;

  let found: string | null = null;
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i];
    if (typeof flag !== "string") continue;

    const inline = /^--model=(.*)$/.exec(flag.trim());
    if (inline) {
      const value = inline[1].trim();
      if (value.length > 0) found = value;
      continue;
    }

    if (flag.trim() === "--model") {
      const next = flags[i + 1];
      if (typeof next === "string" && next.trim().length > 0) {
        found = next.trim();
      }
    }
  }
  return found;
}
