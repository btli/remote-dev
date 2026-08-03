/**
 * AnthropicOAuthRefresh — the server-side refresh boundary for Claude usage
 * credentials carrying `user:profile` scope.
 *
 * Usage and session credentials are intentionally separate. This module reads
 * only the narrow usage credential projection from ClaudeAccountService and
 * never falls back to the long-lived setup-token used for session injection:
 * that credential class is categorically forbidden by the usage endpoint.
 *
 * Security and failure policy:
 *   - token material appears only in the HTTPS request and encrypted account
 *     accessors; it is never logged;
 *   - 400/401 means a rejected refresh token and quarantines only usage data;
 *   - network/timeout, 429, 5xx, malformed, and unexpected responses are
 *     transient/safe failures that leave the stored credential unchanged;
 *   - every account operation remains scoped by account id and user id.
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("AnthropicOAuthRefresh");

const TOKEN_ENDPOINT = "https://console.anthropic.com/v1/oauth/token";
const CLAUDE_CODE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const FRESHNESS_MARGIN_MS = 5 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface UsageCredentialForRefresh {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface RefreshedUsageCredentialWrite {
  accessToken: string;
  expiresAt: Date;
  refreshToken?: string;
}

/** Account-service seam; tests inject fakes and infrastructure never sees DB. */
export interface UsageCredentialAccountStore {
  read(
    accountId: string,
    userId: string
  ): Promise<UsageCredentialForRefresh | null>;
  store(
    accountId: string,
    userId: string,
    credential: RefreshedUsageCredentialWrite
  ): Promise<void>;
  quarantine(accountId: string, userId: string): Promise<void>;
}

/** Minimal fetch surface for the OAuth token endpoint. */
export type OAuthRefreshFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }
) => Promise<{
  status: number;
  headers: Headers;
  text: () => Promise<string>;
}>;

/**
 * Default store lazily imports the ownership-scoped account operations. This
 * follows UsageEndpointPoller's token-reader seam and avoids a static
 * infrastructure-to-service dependency while keeping Drizzle out of infra.
 */
const defaultAccountStore: UsageCredentialAccountStore = {
  async read(accountId, userId) {
    const { readOwnedUsageCredential } = await import(
      "@/services/claude-account-service"
    );
    return readOwnedUsageCredential(accountId, userId);
  },
  async store(accountId, userId, credential) {
    const { storeRefreshedUsageCredential } = await import(
      "@/services/claude-account-service"
    );
    await storeRefreshedUsageCredential(accountId, userId, credential);
  },
  async quarantine(accountId, userId) {
    const { quarantineUsageCredential } = await import(
      "@/services/claude-account-service"
    );
    await quarantineUsageCredential(accountId, userId);
  },
};

const defaultFetch: OAuthRefreshFetch = (url, init) =>
  fetch(url, init).then((response) => ({
    status: response.status,
    headers: response.headers,
    text: () => response.text(),
  }));

/** Resolve fresh usage access tokens and refresh expired/near-expiry tokens. */
export class AnthropicOAuthRefreshService {
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor(
    private readonly accounts: UsageCredentialAccountStore = defaultAccountStore,
    private readonly fetchImpl: OAuthRefreshFetch = defaultFetch,
    private readonly now: () => number = Date.now
  ) {}

  async getFreshUsageAccessToken(
    accountId: string,
    userId: string
  ): Promise<string | null> {
    const existing = this.inFlight.get(accountId);
    if (existing) return existing;

    const pending = this.readOrRefresh(accountId, userId).catch((error) => {
      log.warn("Usage OAuth credential operation failed", {
        accountId,
        error: safeErrorName(error),
      });
      return null;
    });
    this.inFlight.set(accountId, pending);
    try {
      return await pending;
    } finally {
      // Identity check prevents an older completion from clearing a newer
      // flight if the implementation later grows cancellation/replacement.
      if (this.inFlight.get(accountId) === pending) {
        this.inFlight.delete(accountId);
      }
    }
  }

  private async readOrRefresh(
    accountId: string,
    userId: string
  ): Promise<string | null> {
    const credential = await this.accounts.read(accountId, userId);
    if (!credential) return null;

    const now = this.now();
    if (credential.expiresAt.getTime() > now + FRESHNESS_MARGIN_MS) {
      return credential.accessToken;
    }

    return this.refresh(accountId, userId, credential.refreshToken, now);
  }

  private async refresh(
    accountId: string,
    userId: string,
    refreshToken: string,
    now: number
  ): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Awaited<ReturnType<OAuthRefreshFetch>>;
    try {
      response = await this.fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: CLAUDE_CODE_CLIENT_ID,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      log.warn("Usage OAuth refresh request failed transiently", {
        accountId,
        error: safeErrorName(error),
      });
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 400 || response.status === 401) {
      log.warn(
        "Usage refresh token rejected; usage tracking disabled until re-enabled",
        { accountId, status: response.status }
      );
      await this.accounts.quarantine(accountId, userId);
      return null;
    }

    if (response.status < 200 || response.status >= 300) {
      log.warn("Usage OAuth refresh returned a non-success response", {
        accountId,
        status: response.status,
      });
      return null;
    }

    const body = await parseJsonBody(response);
    const accessToken = isNonBlankString(body?.access_token)
      ? body.access_token
      : null;
    const expiresIn = body?.expires_in;
    const refreshTokenValue = body?.refresh_token;
    const expiresAtMs =
      typeof expiresIn === "number" ? now + expiresIn * 1_000 : Number.NaN;
    if (
      accessToken === null ||
      typeof expiresIn !== "number" ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0 ||
      !Number.isFinite(expiresAtMs) ||
      (refreshTokenValue !== undefined &&
        !isNonBlankString(refreshTokenValue))
    ) {
      log.warn("Usage OAuth refresh returned a malformed success response", {
        accountId,
        status: response.status,
      });
      return null;
    }

    const rotatedRefreshToken = isNonBlankString(refreshTokenValue)
      ? refreshTokenValue
      : undefined;
    await this.accounts.store(accountId, userId, {
      accessToken,
      expiresAt: new Date(expiresAtMs),
      ...(rotatedRefreshToken
        ? { refreshToken: rotatedRefreshToken }
        : {}),
    });
    return accessToken;
  }
}

async function parseJsonBody(
  response: Awaited<ReturnType<OAuthRefreshFetch>>
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await response.text());
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

const defaultService = new AnthropicOAuthRefreshService();

/** Return a fresh usage access token, or null when polling must be skipped. */
export function getFreshUsageAccessToken(
  accountId: string,
  userId: string
): Promise<string | null> {
  return defaultService.getFreshUsageAccessToken(accountId, userId);
}
