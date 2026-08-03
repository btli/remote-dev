// @vitest-environment node
/**
 * Server-side usage OAuth refresh tests. Fetch and account persistence are
 * always injected; no test can reach Anthropic or a real database credential.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({ createLogger: () => logger }));

import {
  AnthropicOAuthRefreshService,
  type UsageCredentialAccountStore,
  type OAuthRefreshFetch,
} from "./anthropic-oauth-refresh";

const ACCOUNT_ID = "acct-refresh-test";
const USER_ID = "user-refresh-test";
const NOW = 2_000_000;

function credential(expiresAt = new Date(NOW)): {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
} {
  return {
    accessToken: "test-usage-access-before",
    refreshToken: "test-usage-refresh-before",
    expiresAt,
  };
}

function accountStore(
  stored: ReturnType<typeof credential> | null = credential()
): UsageCredentialAccountStore & {
  read: ReturnType<typeof vi.fn>;
  store: ReturnType<typeof vi.fn>;
  quarantine: ReturnType<typeof vi.fn>;
} {
  return {
    read: vi.fn(async () => stored),
    store: vi.fn(async () => undefined),
    quarantine: vi.fn(async () => undefined),
  };
}

function response(status: number, body: unknown): Awaited<ReturnType<OAuthRefreshFetch>> {
  return {
    status,
    headers: new Headers(),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AnthropicOAuthRefreshService", () => {
  it("returns a fresh stored access token without a network call", async () => {
    const accounts = accountStore(credential(new Date(NOW + 300_001)));
    const fetchImpl = vi.fn<OAuthRefreshFetch>();
    const service = new AnthropicOAuthRefreshService(
      accounts,
      fetchImpl,
      () => NOW
    );

    await expect(
      service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID)
    ).resolves.toBe("test-usage-access-before");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(accounts.store).not.toHaveBeenCalled();
  });

  it("refreshes at exactly the five-minute safety threshold", async () => {
    const accounts = accountStore(credential(new Date(NOW + 300_000)));
    const fetchImpl = vi.fn<OAuthRefreshFetch>(async () =>
      response(200, {
        access_token: "test-threshold-access-after",
        expires_in: 60,
      })
    );
    const service = new AnthropicOAuthRefreshService(
      accounts,
      fetchImpl,
      () => NOW
    );

    await expect(
      service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID)
    ).resolves.toBe("test-threshold-access-after");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns null without network activity when no usage credential exists", async () => {
    const accounts = accountStore(null);
    const fetchImpl = vi.fn<OAuthRefreshFetch>();
    const service = new AnthropicOAuthRefreshService(
      accounts,
      fetchImpl,
      () => NOW
    );

    await expect(
      service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID)
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the exact refresh request and stores expiry plus token rotation", async () => {
    const accounts = accountStore();
    const fetchImpl = vi.fn<OAuthRefreshFetch>(async () =>
      response(200, {
        access_token: "test-usage-access-after",
        refresh_token: "test-usage-refresh-after",
        expires_in: 3_600,
        scope: "user:profile future:scope",
      })
    );
    const service = new AnthropicOAuthRefreshService(
      accounts,
      fetchImpl,
      () => NOW
    );

    await expect(
      service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID)
    ).resolves.toBe("test-usage-access-after");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://console.anthropic.com/v1/oauth/token");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "test-usage-refresh-before",
      client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    });
    expect(accounts.store).toHaveBeenCalledWith(ACCOUNT_ID, USER_ID, {
      accessToken: "test-usage-access-after",
      refreshToken: "test-usage-refresh-after",
      expiresAt: new Date(NOW + 3_600_000),
    });
  });

  it("preserves the current refresh token when the response omits rotation", async () => {
    const accounts = accountStore();
    const fetchImpl: OAuthRefreshFetch = async () =>
      response(200, {
        access_token: "test-usage-access-after",
        expires_in: 60,
      });
    const service = new AnthropicOAuthRefreshService(
      accounts,
      fetchImpl,
      () => NOW
    );

    await service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID);

    expect(accounts.store).toHaveBeenCalledWith(ACCOUNT_ID, USER_ID, {
      accessToken: "test-usage-access-after",
      expiresAt: new Date(NOW + 60_000),
    });
  });

  it.each([400, 401])(
    "quarantines a rejected refresh on HTTP %i without touching session health",
    async (status) => {
      const accounts = accountStore();
      const fetchImpl: OAuthRefreshFetch = async () =>
        response(status, { error: "rejected" });
      const service = new AnthropicOAuthRefreshService(
        accounts,
        fetchImpl,
        () => NOW
      );

      await expect(
        service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID)
      ).resolves.toBeNull();
      expect(accounts.quarantine).toHaveBeenCalledWith(ACCOUNT_ID, USER_ID);
      expect(accounts.store).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        "Usage refresh token rejected; usage tracking disabled until re-enabled",
        { accountId: ACCOUNT_ID, status }
      );
    }
  );

  it.each([429, 500, 503, 418])(
    "leaves credentials unchanged for non-quarantining HTTP %i",
    async (status) => {
      const accounts = accountStore();
      const fetchImpl: OAuthRefreshFetch = async () => response(status, {});
      const service = new AnthropicOAuthRefreshService(
        accounts,
        fetchImpl,
        () => NOW
      );

      await expect(
        service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID)
      ).resolves.toBeNull();
      expect(accounts.store).not.toHaveBeenCalled();
      expect(accounts.quarantine).not.toHaveBeenCalled();
    }
  );

  it("treats a network failure as transient and changes nothing", async () => {
    const accounts = accountStore();
    const fetchImpl: OAuthRefreshFetch = async () => {
      throw new TypeError("fetch failed");
    };
    const service = new AnthropicOAuthRefreshService(
      accounts,
      fetchImpl,
      () => NOW
    );

    await expect(
      service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID)
    ).resolves.toBeNull();
    expect(accounts.store).not.toHaveBeenCalled();
    expect(accounts.quarantine).not.toHaveBeenCalled();
  });

  it("aborts after ten seconds and leaves credentials unchanged", async () => {
    vi.useFakeTimers();
    const accounts = accountStore();
    const fetchImpl: OAuthRefreshFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new Error("aborted"))
        );
      });
    const service = new AnthropicOAuthRefreshService(
      accounts,
      fetchImpl,
      () => NOW
    );

    const pending = service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toBeNull();
    expect(accounts.store).not.toHaveBeenCalled();
    expect(accounts.quarantine).not.toHaveBeenCalled();
  });

  it.each([
    ["non-JSON", "not-json"],
    ["missing access token", { expires_in: 60 }],
    ["blank access token", { access_token: " ", expires_in: 60 }],
    ["non-positive expiry", { access_token: "test-access", expires_in: 0 }],
    ["non-numeric expiry", { access_token: "test-access", expires_in: "60" }],
    [
      "invalid optional refresh token",
      { access_token: "test-access", expires_in: 60, refresh_token: 42 },
    ],
  ])("leaves credentials unchanged for malformed 2xx success: %s", async (_label, body) => {
    const accounts = accountStore();
    const fetchImpl: OAuthRefreshFetch = async () => response(200, body);
    const service = new AnthropicOAuthRefreshService(
      accounts,
      fetchImpl,
      () => NOW
    );

    await expect(
      service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID)
    ).resolves.toBeNull();
    expect(accounts.store).not.toHaveBeenCalled();
    expect(accounts.quarantine).not.toHaveBeenCalled();
  });

  it("shares one fetch and one write across concurrent refreshes", async () => {
    const accounts = accountStore();
    let resolveFetch!: (
      value: Awaited<ReturnType<OAuthRefreshFetch>>
    ) => void;
    const pendingFetch = new Promise<
      Awaited<ReturnType<OAuthRefreshFetch>>
    >((resolve) => {
      resolveFetch = resolve;
    });
    const fetchImpl = vi.fn<OAuthRefreshFetch>(() => pendingFetch);
    const service = new AnthropicOAuthRefreshService(
      accounts,
      fetchImpl,
      () => NOW
    );

    const first = service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID);
    const second = service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    resolveFetch(
      response(200, {
        access_token: "test-shared-access-after",
        expires_in: 60,
      })
    );

    await expect(Promise.all([first, second])).resolves.toEqual([
      "test-shared-access-after",
      "test-shared-access-after",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(accounts.store).toHaveBeenCalledTimes(1);
  });

  it("clears a failed flight so a later call can try again", async () => {
    const accounts = accountStore();
    accounts.read
      .mockRejectedValueOnce(new Error("temporary database failure"))
      .mockResolvedValueOnce(credential(new Date(NOW + 300_001)));
    const fetchImpl = vi.fn<OAuthRefreshFetch>();
    const service = new AnthropicOAuthRefreshService(
      accounts,
      fetchImpl,
      () => NOW
    );

    await expect(
      service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID)
    ).resolves.toBeNull();
    await expect(
      service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID)
    ).resolves.toBe("test-usage-access-before");
    expect(accounts.read).toHaveBeenCalledTimes(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
