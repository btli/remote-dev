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
const REVISION_ONE = {
  accessCiphertext: "test-access-ciphertext-v1",
  refreshCiphertext: "test-refresh-ciphertext-v1",
};

function credential(
  expiresAt = new Date(NOW),
  revision = REVISION_ONE
): {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  revision: typeof REVISION_ONE;
} {
  return {
    accessToken: "test-usage-access-before",
    refreshToken: "test-usage-refresh-before",
    expiresAt,
    revision,
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
    store: vi.fn(async () => true),
    quarantine: vi.fn(async () => true),
  };
}

interface TestCredentialWrite {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

/**
 * Stateful fake for cross-process refresh races. Unlike the service's
 * in-instance singleflight, two service instances may refresh the same DB row
 * concurrently, so this fake applies writes only against the exact revision
 * returned by their earlier reads.
 */
function casAccountStore() {
  let current = credential();
  let revisionNumber = 1;
  const sameRevision = (candidate: typeof REVISION_ONE | undefined): boolean =>
    candidate?.accessCiphertext === current.revision.accessCiphertext &&
    candidate.refreshCiphertext === current.revision.refreshCiphertext;
  const read = vi.fn(async () => ({ ...current, revision: { ...current.revision } }));
  const store = vi.fn(
    async (
      _accountId: string,
      _userId: string,
      write: TestCredentialWrite,
      expectedRevision: typeof REVISION_ONE | undefined
    ): Promise<boolean> => {
      if (!sameRevision(expectedRevision)) return false;
      revisionNumber += 1;
      current = {
        accessToken: write.accessToken,
        refreshToken: write.refreshToken ?? current.refreshToken,
        expiresAt: write.expiresAt,
        revision: {
          accessCiphertext: `test-access-ciphertext-v${revisionNumber}`,
          refreshCiphertext: write.refreshToken
            ? `test-refresh-ciphertext-v${revisionNumber}`
            : current.revision.refreshCiphertext,
        },
      };
      return true;
    }
  );
  const quarantine = vi.fn(
    async (
      _accountId: string,
      _userId: string,
      expectedRevision: typeof REVISION_ONE | undefined
    ): Promise<boolean> => sameRevision(expectedRevision)
  );
  const accounts = { read, store, quarantine } as unknown as
    UsageCredentialAccountStore & {
      read: typeof read;
      store: typeof store;
      quarantine: typeof quarantine;
    };
  return { accounts, current: () => current };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
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
    expect(accounts.store).toHaveBeenCalledWith(
      ACCOUNT_ID,
      USER_ID,
      {
        accessToken: "test-usage-access-after",
        refreshToken: "test-usage-refresh-after",
        expiresAt: new Date(NOW + 3_600_000),
      },
      REVISION_ONE
    );
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

    expect(accounts.store).toHaveBeenCalledWith(
      ACCOUNT_ID,
      USER_ID,
      {
        accessToken: "test-usage-access-after",
        expiresAt: new Date(NOW + 60_000),
      },
      REVISION_ONE
    );
  });

  it.each([
    [400, "invalid_grant"],
    [401, "invalid_grant"],
    [401, "invalid_client"],
  ])(
    "quarantines a dead grant on HTTP %i with OAuth error %s",
    async (status, oauthError) => {
      const accounts = accountStore();
      const fetchImpl: OAuthRefreshFetch = async () =>
        response(status, { error: oauthError });
      const service = new AnthropicOAuthRefreshService(
        accounts,
        fetchImpl,
        () => NOW
      );

      await expect(
        service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID)
      ).resolves.toBeNull();
      expect(accounts.quarantine).toHaveBeenCalledWith(
        ACCOUNT_ID,
        USER_ID,
        REVISION_ONE
      );
      expect(accounts.store).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        "Usage refresh token rejected; usage tracking disabled until re-enabled",
        { accountId: ACCOUNT_ID, status, oauthError }
      );
    }
  );

  it.each(["invalid_request", "invalid_client"])(
    "leaves the credential unchanged for HTTP 400 %s",
    async (oauthError) => {
      const accounts = accountStore();
      const fetchImpl: OAuthRefreshFetch = async () =>
        response(400, { error: oauthError });
      const service = new AnthropicOAuthRefreshService(
        accounts,
        fetchImpl,
        () => NOW
      );

      await expect(
        service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID)
      ).resolves.toBeNull();
      expect(accounts.quarantine).not.toHaveBeenCalled();
      expect(accounts.store).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        "Usage OAuth refresh rejection was transient",
        { accountId: ACCOUNT_ID, status: 400, oauthError }
      );
    }
  );

  it("logs the OAuth rejection context when quarantine persistence throws", async () => {
    const accounts = accountStore();
    accounts.quarantine.mockRejectedValueOnce(new Error("database unavailable"));
    const service = new AnthropicOAuthRefreshService(
      accounts,
      async () => response(401, { error: "invalid_client" }),
      () => NOW
    );

    await expect(
      service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID)
    ).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to quarantine rejected usage OAuth credential",
      {
        accountId: ACCOUNT_ID,
        status: 401,
        oauthError: "invalid_client",
        error: "Error: database unavailable",
      }
    );
  });

  it("does not quarantine a newer credential after another instance refreshes it", async () => {
    const { accounts, current } = casAccountStore();
    const success = deferred<Awaited<ReturnType<OAuthRefreshFetch>>>();
    const rejection = deferred<Awaited<ReturnType<OAuthRefreshFetch>>>();
    const firstService = new AnthropicOAuthRefreshService(
      accounts,
      () => success.promise,
      () => NOW
    );
    const secondService = new AnthropicOAuthRefreshService(
      accounts,
      () => rejection.promise,
      () => NOW
    );

    const first = firstService.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID);
    const second = secondService.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID);
    await vi.waitFor(() => expect(accounts.read).toHaveBeenCalledTimes(2));

    success.resolve(
      response(200, {
        access_token: "test-first-instance-access",
        refresh_token: "test-first-instance-refresh",
        expires_in: 60,
      })
    );
    await expect(first).resolves.toBe("test-first-instance-access");

    rejection.resolve(response(400, { error: "invalid_grant" }));
    await expect(second).resolves.toBeNull();

    expect(current()).toMatchObject({
      accessToken: "test-first-instance-access",
      refreshToken: "test-first-instance-refresh",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Stale usage OAuth rejection ignored",
      { accountId: ACCOUNT_ID, status: 400, oauthError: "invalid_grant" }
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      "Usage refresh token rejected; usage tracking disabled until re-enabled",
      expect.anything()
    );
  });

  it("lets only the first same-refresh-token response update the credential", async () => {
    const { accounts, current } = casAccountStore();
    const firstResponse = deferred<Awaited<ReturnType<OAuthRefreshFetch>>>();
    const secondResponse = deferred<Awaited<ReturnType<OAuthRefreshFetch>>>();
    const firstService = new AnthropicOAuthRefreshService(
      accounts,
      () => firstResponse.promise,
      () => NOW
    );
    const secondService = new AnthropicOAuthRefreshService(
      accounts,
      () => secondResponse.promise,
      () => NOW
    );

    const first = firstService.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID);
    const second = secondService.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID);
    await vi.waitFor(() => expect(accounts.read).toHaveBeenCalledTimes(2));

    firstResponse.resolve(
      response(200, {
        access_token: "test-first-concurrent-access",
        expires_in: 60,
      })
    );
    await expect(first).resolves.toBe("test-first-concurrent-access");

    secondResponse.resolve(
      response(200, {
        access_token: "test-stale-concurrent-access",
        expires_in: 60,
      })
    );
    await expect(second).resolves.toBeNull();

    expect(current()).toMatchObject({
      accessToken: "test-first-concurrent-access",
      refreshToken: "test-usage-refresh-before",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "Stale usage OAuth refresh response ignored",
      { accountId: ACCOUNT_ID }
    );
  });

  it("leaves the credential unchanged for an HTML HTTP 401 proxy response", async () => {
    const accounts = accountStore();
    const fetchImpl: OAuthRefreshFetch = async () =>
      response(401, "<html>sign in to the proxy</html>");
    const service = new AnthropicOAuthRefreshService(
      accounts,
      fetchImpl,
      () => NOW
    );

    await expect(
      service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID)
    ).resolves.toBeNull();
    expect(accounts.quarantine).not.toHaveBeenCalled();
    expect(accounts.store).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Usage OAuth refresh rejection was transient",
      { accountId: ACCOUNT_ID, status: 401, oauthError: null }
    );
  });

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

  it("logs a rotated credential store failure with its concrete error", async () => {
    const accounts = accountStore();
    accounts.store.mockRejectedValueOnce(
      new Error("rotated credential write failed")
    );
    const fetchImpl: OAuthRefreshFetch = async () =>
      response(200, {
        access_token: "test-usage-access-after",
        refresh_token: "test-usage-refresh-after",
        expires_in: 60,
      });
    const service = new AnthropicOAuthRefreshService(
      accounts,
      fetchImpl,
      () => NOW
    );

    await expect(
      service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID)
    ).resolves.toBeNull();
    expect(accounts.quarantine).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to store refreshed usage OAuth credential",
      {
        accountId: ACCOUNT_ID,
        error: "Error: rotated credential write failed",
      }
    );
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

  it("keeps the ten-second timeout active while consuming the response body", async () => {
    vi.useFakeTimers();
    const accounts = accountStore();
    let responseSignal!: AbortSignal;
    let resolveBody!: (body: string) => void;
    let markBodyStarted!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    const fetchImpl: OAuthRefreshFetch = async (_url, init) => ({
      status: 200,
      headers: new Headers(),
      text: () => {
        responseSignal = init.signal;
        markBodyStarted();
        return new Promise<string>((resolve, reject) => {
          resolveBody = resolve;
          init.signal.addEventListener("abort", () =>
            reject(new Error("body aborted"))
          );
        });
      },
    });
    const service = new AnthropicOAuthRefreshService(
      accounts,
      fetchImpl,
      () => NOW
    );

    const pending = service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID);
    await bodyStarted;
    await vi.advanceTimersByTimeAsync(10_000);
    const bodyWasAborted = responseSignal.aborted;
    if (!bodyWasAborted) {
      // Let the pre-fix implementation settle instead of leaking a pending
      // promise after the expected red assertion.
      resolveBody(
        JSON.stringify({ access_token: "test-body-access", expires_in: 60 })
      );
      await pending;
    }

    expect(bodyWasAborted).toBe(true);
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

  it("never shares an owner's in-flight plaintext token with a foreign user", async () => {
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

    const owner = service.getFreshUsageAccessToken(ACCOUNT_ID, USER_ID);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const foreign = service.getFreshUsageAccessToken(
      ACCOUNT_ID,
      "foreign-user"
    );
    resolveFetch(
      response(200, {
        access_token: "test-owner-only-access-after",
        expires_in: 60,
      })
    );

    await expect(owner).resolves.toBe("test-owner-only-access-after");
    await expect(foreign).resolves.toBeNull();
    expect(accounts.read).toHaveBeenCalledTimes(1);
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
