/**
 * Shared normalizer for an instance's first-boot authorized emails (remote-dev-sb98).
 *
 * The same list is (a) validated at the API write (`POST /api/instances`), (b)
 * stored as a JSON array in `instance_seed`, (c) read back by the reconciler, (d)
 * comma-JOINED into the StatefulSet's `AUTHORIZED_USERS` env, and (e) re-SPLIT on
 * commas by the instance app at boot. Step (d)/(e) make a comma INSIDE an entry
 * dangerous: it would silently expand into multiple authorized users. This module
 * is the single chokepoint that enforces the entry rules at BOTH the API write and
 * the reconciler read so the round-trip can never smuggle in an extra authorization.
 *
 * Rules (applied identically in both modes):
 *   - trim each entry;
 *   - REJECT an entry containing a comma (the env delimiter) or any control char
 *     (incl. CR/LF — anti log/env injection);
 *   - drop empty entries;
 *   - dedupe EXACT-CASE (email comparison everywhere else — src/db/seed.ts,
 *     authorized_users — is exact-case; matching that here keeps one source of
 *     truth for "same user");
 *   - cap the list at {@link MAX_ENTRIES} and each entry at {@link MAX_EMAIL_LEN}.
 *
 * Two modes differ ONLY in how a violation is handled:
 *   - STRICT ({@link normalizeAuthorizedEmailsStrict}) → throws
 *     {@link AuthorizedEmailsError} so the API can answer 400 (a human is at the
 *     keyboard; reject loudly so the bad input is fixed, not silently mangled).
 *   - LENIENT ({@link normalizeAuthorizedEmailsLenient}) → drops the offending
 *     entry / truncates the list and returns the survivors, so a bad row already
 *     committed to `instance_seed` (e.g. from before this guard) can NEVER fail
 *     provisioning — the reconciler logs + proceeds with the valid remainder.
 *
 * NOTE: this validates the SHAPE of an entry for safe env round-tripping; it does
 * NOT assert RFC-5322 email validity (the app's auth layer owns that). The intent
 * is "one safe token per authorized user", not "is this a deliverable address".
 */

/** Max number of authorized emails per instance (defensive bound; far above real use). */
export const MAX_ENTRIES = 100;

/** Max length of a single email entry (320 = RFC-5321 max addr length). */
export const MAX_EMAIL_LEN = 320;

/**
 * True if `s` contains any control char (C0 `0x00–0x1F`, DEL `0x7F`, or C1
 * `0x80–0x9F`) — rejected so an entry can't carry CR/LF/NUL etc. into the env or
 * logs. Scanned by code point (not a regex) to avoid a control-char literal and a
 * `no-control-regex` lint suppression.
 */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

/** Thrown by the STRICT normalizer; carries an operator-facing reason for the API 400. */
export class AuthorizedEmailsError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "AuthorizedEmailsError";
  }
}

/** Why a single entry is unusable, or null when it is acceptable (after trimming). */
function rejectReason(trimmed: string): string | null {
  if (trimmed.length === 0) return "empty";
  if (trimmed.length > MAX_EMAIL_LEN) return `longer than ${MAX_EMAIL_LEN} chars`;
  if (trimmed.includes(",")) return "contains a comma";
  if (hasControlChar(trimmed)) return "contains a control character";
  return null;
}

/**
 * STRICT: validate + normalize for the API write. Every input MUST already be a
 * string (the route validated that). Throws {@link AuthorizedEmailsError} on the
 * first unusable entry or when the (deduped) list exceeds {@link MAX_ENTRIES}, so
 * the caller returns 400. Returns the trimmed, exact-case-deduped survivors (order
 * preserved). An all-empty/whitespace input normalizes to `[]` (the caller decides
 * what an empty list means — e.g. defaulting to the creator).
 */
export function normalizeAuthorizedEmailsStrict(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue; // silently drop blanks (not an error)
    const reason = rejectReason(trimmed);
    if (reason) {
      throw new AuthorizedEmailsError(`authorizedEmails entry is invalid (${reason})`);
    }
    if (seen.has(trimmed)) continue; // exact-case dedupe
    seen.add(trimmed);
    out.push(trimmed);
  }
  if (out.length > MAX_ENTRIES) {
    throw new AuthorizedEmailsError(
      `authorizedEmails has too many entries (max ${MAX_ENTRIES})`,
    );
  }
  return out;
}

/**
 * LENIENT: normalize a list read back from `instance_seed` (reconciler path).
 * NEVER throws — it DROPS unusable entries (logging each via `onDrop`) and CAPS the
 * survivors at {@link MAX_ENTRIES}, so a malformed/oversized stored row degrades to
 * its valid remainder instead of failing provisioning. Returns the trimmed,
 * exact-case-deduped survivors.
 */
export function normalizeAuthorizedEmailsLenient(
  input: unknown,
  onDrop?: (entry: unknown, reason: string) => void,
): string[] {
  if (!Array.isArray(input)) {
    onDrop?.(input, "not an array");
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") {
      onDrop?.(raw, "not a string");
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const reason = rejectReason(trimmed);
    if (reason) {
      onDrop?.(raw, reason);
      continue;
    }
    if (seen.has(trimmed)) continue;
    if (out.length >= MAX_ENTRIES) {
      onDrop?.(raw, `exceeds max ${MAX_ENTRIES} entries`);
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
