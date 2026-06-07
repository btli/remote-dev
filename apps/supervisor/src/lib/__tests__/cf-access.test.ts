/**
 * Tests for `validateAccessJWT` in the Supervisor's `src/lib/cf-access.ts`.
 *
 * Mirrors the root app's cloudflare-access tests (regression: remote-dev-2w1o):
 * a Cloudflare Access SERVICE token clears the edge and yields a verified-but-
 * NON-IDENTITY JWT (carries `common_name`, no `email`). It must never mint a user
 * session — `validateAccessJWT` resolves null so callers fall through to OIDC /
 * the local-dev admin path instead of resolving a user with an empty email.
 *
 * The module reads `SUPERVISOR_CF_ACCESS_AUD` / `SUPERVISOR_CF_ACCESS_TEAM` at
 * evaluation time and uses `jose.jwtVerify`, so each test stubs env via
 * `vi.stubEnv`, mocks `jose`, then `vi.resetModules()` + dynamic-imports fresh.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyState: { payload: Record<string, unknown> } = { payload: {} };

vi.mock("jose", () => ({
  jwtVerify: vi.fn(async () => ({ payload: verifyState.payload })),
  createRemoteJWKSet: vi.fn(() => ({}) as never),
}));

function makeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${enc({ alg: "RS256", typ: "JWT" })}.${enc(payload)}.sig`;
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  verifyState.payload = {};
  vi.stubEnv("SUPERVISOR_CF_ACCESS_AUD", "sup-aud-123");
  vi.stubEnv("SUPERVISOR_CF_ACCESS_TEAM", "supteam");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadModule() {
  return import("@/lib/cf-access");
}

describe("validateAccessJWT — verified path", () => {
  it("(a) resolves null for a verified non-identity (service) token with no email", async () => {
    verifyState.payload = { sub: "service-sub", common_name: "client-id-abc" };
    const { validateAccessJWT } = await loadModule();

    await expect(validateAccessJWT(makeJwt(verifyState.payload))).resolves.toBeNull();
  });

  it("(a) resolves null when email is present but an empty string", async () => {
    verifyState.payload = { sub: "service-sub", email: "" };
    const { validateAccessJWT } = await loadModule();

    await expect(validateAccessJWT(makeJwt(verifyState.payload))).resolves.toBeNull();
  });

  it("(b) resolves the user unchanged for a verified identity token with a real email", async () => {
    verifyState.payload = {
      sub: "user-sub",
      email: "alice@example.com",
      country: "US",
    };
    const { validateAccessJWT } = await loadModule();

    await expect(
      validateAccessJWT(makeJwt(verifyState.payload)),
    ).resolves.toEqual({
      email: "alice@example.com",
      sub: "user-sub",
      country: "US",
    });
  });

  it("resolves null when the token is absent", async () => {
    const { validateAccessJWT } = await loadModule();
    await expect(validateAccessJWT(null)).resolves.toBeNull();
  });
});

describe("validateAccessJWT — local dev (no AUD/TEAM configured)", () => {
  it("resolves null so callers use the local-dev admin path", async () => {
    vi.stubEnv("SUPERVISOR_CF_ACCESS_AUD", "");
    vi.stubEnv("SUPERVISOR_CF_ACCESS_TEAM", "");
    const { validateAccessJWT } = await loadModule();

    await expect(
      validateAccessJWT(makeJwt({ email: "anyone@example.com", sub: "s" })),
    ).resolves.toBeNull();
  });
});
