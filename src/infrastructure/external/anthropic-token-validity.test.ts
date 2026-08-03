// @vitest-environment node
/**
 * Tests for the OAuth token validity probe [remote-dev-307w].
 *
 * The contract under test is the status → validity mapping: Anthropic checks
 * AUTH before request validation on `POST /v1/messages`, so 401 is the only
 * "invalid" answer; 400/403/anything else prove the credential was accepted;
 * 429 is "indeterminate" (rate limiting has only ever been observed for
 * INVALID credentials [remote-dev-u7df] and may fire before credential
 * evaluation, so it must not confirm health); a network failure or timeout is
 * "indeterminate" too (never "invalid" — offline must not poison a save). No
 * live network calls anywhere here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeTokenValidity } from "./anthropic-token-validity";
import type { FetchLike } from "./anthropic-usage-adapter";

const TOKEN = `sk-ant-oat01-${"A".repeat(95)}`;

/** Build a FetchLike returning `status`, recording the request it received. */
function fakeFetch(status: number): {
  fetch: FetchLike;
  calls: Array<Parameters<FetchLike>>;
} {
  const calls: Array<Parameters<FetchLike>> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push([url, init]);
    return { status, headers: new Headers(), text: async () => "" };
  };
  return { fetch, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("probeTokenValidity", () => {
  it("maps a 401 to invalid — auth is checked before request validation", async () => {
    const { fetch } = fakeFetch(401);
    expect(await probeTokenValidity(TOKEN, fetch)).toBe("invalid");
  });

  it.each([
    ["400 (request validation, auth already passed)", 400],
    ["403 (permission_error: authenticated-but-forbidden, credential live)", 403],
    ["200 (unreachable in practice, still authed)", 200],
    ["529 (overloaded)", 529],
  ])("maps %s to valid", async (_label, status) => {
    const { fetch } = fakeFetch(status);
    expect(await probeTokenValidity(TOKEN, fetch)).toBe("valid");
  });

  it("maps a 429 to indeterminate — rate limiting must not confirm health", async () => {
    // Live 429s were only ever observed for INVALID (truncated) credentials
    // [remote-dev-u7df]; the anti-brute-force layer may fire before credential
    // evaluation, so the caller falls back to the CLI signal instead.
    const { fetch } = fakeFetch(429);
    expect(await probeTokenValidity(TOKEN, fetch)).toBe("indeterminate");
  });

  it("maps a network failure to indeterminate, never invalid", async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await probeTokenValidity(TOKEN, fetch)).toBe("indeterminate");
  });

  it("aborts after the 10s timeout and reports indeterminate", async () => {
    vi.useFakeTimers();
    // A fetch that never resolves on its own — only the abort signal ends it.
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new Error("aborted"))
        );
      });
    const pending = probeTokenValidity(TOKEN, fetch);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe("indeterminate");
  });

  it("returns indeterminate for an empty token without calling fetch", async () => {
    const { fetch, calls } = fakeFetch(200);
    expect(await probeTokenValidity("", fetch)).toBe("indeterminate");
    expect(calls).toHaveLength(0);
  });

  it("sends the OAuth credential headers and keeps the token out of the URL", async () => {
    const { fetch, calls } = fakeFetch(400);
    await probeTokenValidity(TOKEN, fetch);

    const [url, init] = calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(init.headers["content-type"]).toBe("application/json");
  });
});
