/**
 * anthropic-token-validity - remote validity probe for a Claude OAuth token.
 * [remote-dev-307w]
 *
 * `claude auth status --json` does NOT network-validate the token it is handed:
 * it reports `loggedIn: true` (email null) for a dead or truncated
 * `CLAUDE_CODE_OAUTH_TOKEN`, which is how clipped setup-token fragments were
 * stored as healthy "Signed in" accounts. This module is the missing network
 * check, and the ONLY place that knows how to perform it.
 *
 * The probe is an EMPTY-body `POST https://api.anthropic.com/v1/messages`
 * under the token (Bearer + `anthropic-beta: oauth-2025-04-20`). Anthropic
 * checks AUTHENTICATION before request validation, so the response status
 * cleanly separates the cases without ever running a model call:
 *
 *   - 401                  → the token is INVALID ("OAuth access token is
 *                            invalid"). Verified live 2026-08-03 against the
 *                            user's three truncated 79-char tokens.
 *   - 400 / 429 / anything → auth PASSED (the request then failed validation
 *                            or rate limiting) → the token is VALID.
 *   - network error /      → INDETERMINATE. Offline must never block a save,
 *     timeout                so callers fall back to the CLI probe's answer.
 *
 * No tokens or quota are consumed: the request is rejected before a model is
 * ever invoked (same trick the pre-n4x4.1 header probe relied on).
 *
 * House style mirrors {@link ../external/anthropic-usage-adapter}: injectable
 * `FetchLike` for tests, 10s abort timeout, best-effort never-throws, and the
 * token is used ONLY as the request credential — never logged or returned.
 */

import { createLogger } from "@/lib/logger";
import type { FetchLike } from "./anthropic-usage-adapter";

const log = createLogger("AnthropicTokenValidity");

/** The Messages endpoint used purely as an auth check (empty body, no send). */
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
/** Pinned anthropic-version (matches the rest of the codebase's Claude calls). */
const ANTHROPIC_VERSION = "2023-06-01";
/** OAuth-token requests need this beta header. */
const OAUTH_BETA = "oauth-2025-04-20";
/** Request timeout (ms): a validity probe must never hang a save. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The three-way outcome of a validity probe. `indeterminate` (offline, timeout,
 * fetch blew up) deliberately means "we learned nothing" — callers must treat
 * it as leaving their prior belief unchanged, never as invalid.
 */
export type TokenValidity = "valid" | "invalid" | "indeterminate";

/** The probe seam services depend on (injectable so tests never hit the net). */
export type TokenValidityProbe = (token: string) => Promise<TokenValidity>;

/**
 * Probe whether Anthropic accepts `token` as a live credential.
 *
 * Best-effort, never throws; see the module docblock for the status mapping.
 * The token is never logged — only the resulting status code is.
 */
export async function probeTokenValidity(
  token: string,
  fetchImpl: FetchLike = defaultFetch
): Promise<TokenValidity> {
  if (!token) return "indeterminate";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(MESSAGES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-beta": OAUTH_BETA,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      signal: controller.signal,
    });

    if (response.status === 401) {
      log.warn("Anthropic rejected the OAuth token as invalid", {
        status: response.status,
      });
      return "invalid";
    }

    // Auth ran before request validation, so ANY non-401 (400 invalid_request,
    // 429 rate-limited, even an unexpected 5xx) means the credential itself
    // was accepted. That includes 403: Anthropic's `permission_error` means
    // authenticated-but-forbidden — the CREDENTIAL is live, which is exactly
    // what this probe measures, so "valid" is the intended answer (not yet
    // live-verified for this endpoint, unlike the 401 case).
    log.debug("Anthropic accepted the OAuth token", {
      status: response.status,
    });
    return "valid";
  } catch (error) {
    // Offline / timeout: we learned nothing about the token.
    log.warn("Token validity probe failed", { error: String(error) });
    return "indeterminate";
  } finally {
    clearTimeout(timer);
  }
}

/** Default fetch wrapper that adapts the global fetch to {@link FetchLike}. */
const defaultFetch: FetchLike = (url, init) =>
  fetch(url, init).then((r) => ({
    status: r.status,
    headers: r.headers,
    text: () => r.text(),
  }));
