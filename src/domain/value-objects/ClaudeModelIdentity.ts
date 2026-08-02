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
 * requires a mapping both sides can be reduced to.
 *
 * ## Recognized-only, by design
 *
 * {@link resolveClaudeModelFamily} answers ONLY from the explicit registry
 * below. Anything it does not recognize returns `null`, and a null identity can
 * never match anything — so an unrecognized model is never compared against a
 * scoped window and therefore never blocks an account.
 *
 * This deliberately replaced an earlier "fall back to the normalized string"
 * design, which could fail CLOSED in three ways:
 *
 *   - a caller alias `cowork` would exact-match an upstream `"Cowork"` window
 *     and block an account for a family we have never validated;
 *   - `vendor-sonnet-proxy` (a third-party proxy, not Anthropic's Sonnet on
 *     this subscription) would be treated as Sonnet and blocked by Sonnet's
 *     window;
 *   - conversely a future `claude-cowork-6` would normalize to itself and NOT
 *     match `"Cowork"`, silently defeating rotation while looking like it
 *     worked.
 *
 * The cost is that a genuinely new family is invisible until it is added to
 * {@link KNOWN_FAMILIES}. That is the accepted trade: failing open (no
 * rotation, i.e. today's behaviour) beats failing closed (wrong rotation, or an
 * account pinned off a model). Unrecognized names are logged by the caller so
 * new families surface in practice rather than in theory.
 *
 * Pure and immutable: no DB / fs / network.
 */

/**
 * The explicit registry of Claude model families this codebase can reason
 * about. Families only — NOT versions: a per-model weekly window is scoped to a
 * family ("Fable"), and pinning point releases here would rot on every launch.
 *
 * Adding a family is a deliberate act. When Anthropic ships one, add it here —
 * the selection policy's `unrecognized requested model` debug log is the signal
 * that one has appeared in the wild.
 */
export const KNOWN_FAMILIES: readonly string[] = [
  "fable",
  "mythos",
  "opus",
  "sonnet",
  "haiku",
];

/**
 * CLI aliases that deliberately resolve to NOTHING.
 *
 * These are real Claude Code `--model` values, but neither names a single
 * family: `opusplan` plans on Opus and executes on Sonnet, and `default` means
 * "let the CLI decide". Mapping either to one family would narrow availability
 * on a guess — blocking an account for Opus when the actual work runs on
 * Sonnet, say. Listed explicitly so this reads as a decision, not an oversight.
 * [review G11]
 */
const NON_FAMILY_ALIASES: readonly string[] = ["opusplan", "default"];

/** Context-window / variant suffixes that carry no family information. */
const VARIANT_SUFFIX = /\[[^\]]*\]/g;

/**
 * Reduce a raw string to its comparable form: lowercased, variant suffixes
 * stripped, every separator run collapsed to a single `-`.
 *
 * Exported for tests only — callers wanting an identity must use
 * {@link resolveClaudeModelFamily}, which additionally requires recognition.
 */
export function normalizeModelToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const normalized = raw
    .toLowerCase()
    .replace(VARIANT_SUFFIX, "")
    // Any run of separators (whitespace, underscore, dot, slash, hyphen)
    // becomes a single hyphen so segmentation is uniform across id styles
    // ("claude-fable-5", "Claude Fable 5", "claude_fable_5").
    .replace(/[\s._/-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : null;
}

/**
 * Resolve a model id, CLI alias, or usage-endpoint display name to a KNOWN
 * family token, or null when it is not recognized.
 *
 * Two accepted shapes, and only two:
 *   1. The whole normalized string IS a family — `"Fable"`, `opus`, `sonnet`.
 *      This is the display-name and bare-alias case.
 *   2. The string is a `claude-`-prefixed model id containing a family segment
 *      — `claude-fable-5`, `claude-3-5-sonnet-20241022`, `claude-sonnet-5[1m]`.
 *
 * Requiring the `claude-` prefix for the segment scan is what keeps a
 * third-party `vendor-sonnet-proxy` from being mistaken for Anthropic's Sonnet.
 *
 * @param raw A model id, alias, or display name. Case- and whitespace-tolerant.
 * @returns A token from {@link KNOWN_FAMILIES}, or null when unrecognized.
 */
export function resolveClaudeModelFamily(raw: unknown): string | null {
  const normalized = normalizeModelToken(raw);
  if (normalized === null) return null;

  // Explicitly-declined aliases resolve to nothing (see NON_FAMILY_ALIASES).
  if (NON_FAMILY_ALIASES.includes(normalized)) return null;

  // Shape 1: the display name / bare alias.
  if (KNOWN_FAMILIES.includes(normalized)) return normalized;

  // Shape 2: a Claude model id. The prefix requirement is load-bearing.
  if (normalized.startsWith("claude-")) {
    for (const segment of normalized.split("-")) {
      if (KNOWN_FAMILIES.includes(segment)) return segment;
    }
  }

  return null;
}

/**
 * Whether a requested model and a usage-window scope name identify the same
 * model family.
 *
 * Returns false whenever either side is unrecognized — the caller must treat
 * that as "unknown", which by contract means AVAILABLE (fail open), never
 * "blocked".
 */
export function claudeModelIdentityMatches(
  requestedModel: unknown,
  scopeModelDisplayName: unknown
): boolean {
  const requested = resolveClaudeModelFamily(requestedModel);
  if (requested === null) return false;
  const scoped = resolveClaudeModelFamily(scopeModelDisplayName);
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
