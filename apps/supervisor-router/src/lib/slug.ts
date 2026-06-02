/**
 * Instance slug validation + reserved names.
 *
 * Keep in sync with apps/supervisor/src/lib/slug.ts; consolidation into one
 * shared package is tracked as a §m2 follow-up.
 *
 * The slug is the first path segment a request is routed by (`/<slug>/…`) and
 * also names the instance's namespace (`rdv-<slug>`) and in-namespace Service.
 *
 * Grammar (spec §6.4): `^[a-z][a-z0-9-]{0,14}$`
 *   - starts with a lowercase letter
 *   - lowercase alphanumerics + hyphen, max 15 chars total
 *   - kept short so `rdv-<slug>` stays a valid DNS-1123 label (≤63 chars)
 */

export const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,14}$/;

/**
 * Slugs that would collide with the root public paths an instance serves or
 * k8s/router internals (spec §15 m2), plus a defensive `supervisor` guard.
 * Disallowed as instance slugs.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "api",
  "ws",
  "_next",
  "login",
  "healthz",
  "readyz",
  "manifest.json",
  "sw.js",
  "favicon.svg",
  "favicon.ico",
  "icons",
  // The Supervisor dashboard is served at `/` (root) through the router, NOT at
  // `/supervisor` — but keep this reserved as a defensive collision guard so an
  // instance can never claim the slug `supervisor`.
  "supervisor",
]);

/** True if `slug` is reserved (case-insensitive). */
export function isReserved(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

export type SlugValidationError = "empty" | "format" | "reserved";

export interface SlugValidationResult {
  valid: boolean;
  error?: SlugValidationError;
  message?: string;
}

/**
 * Validate an instance slug. Returns a structured result rather than throwing
 * so callers can map it to the right response.
 */
export function validateSlug(input: unknown): SlugValidationResult {
  if (typeof input !== "string" || input.length === 0) {
    return { valid: false, error: "empty", message: "Slug is required." };
  }
  if (!SLUG_PATTERN.test(input)) {
    return {
      valid: false,
      error: "format",
      message:
        "Slug must be 1–15 chars, start with a lowercase letter, and contain only lowercase letters, digits, and hyphens.",
    };
  }
  if (isReserved(input)) {
    return {
      valid: false,
      error: "reserved",
      message: `"${input}" is a reserved slug and cannot be used.`,
    };
  }
  return { valid: true };
}

/** Convenience boolean form of {@link validateSlug}. */
export function isValidSlug(input: unknown): input is string {
  return validateSlug(input).valid;
}

/** The namespace an instance with this slug lives in (§15 B2). */
export function namespaceForSlug(slug: string): string {
  return `rdv-${slug}`;
}
