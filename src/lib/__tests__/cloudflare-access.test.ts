/**
 * Tests for `validateAccessJWT` in `src/lib/cloudflare-access.ts`.
 *
 * Focus: Cloudflare Access SERVICE tokens (CF-Access-Client-Id/Secret) clear the
 * CF edge and Cloudflare injects a verified `Cf-Access-Jwt-Assertion` toward the
 * origin, but that JWT is NON-IDENTITY — it carries `common_name` and no `email`.
 * Such a token must never mint a user session: `validateAccessJWT` must resolve
 * null so callers fall through to API key / NextAuth (regression: remote-dev-2w1o,
 * where an email-less user reached a drizzle lookup and 500'd every route).
 *
 * The module reads `CF_ACCESS_AUD` / `CF_ACCESS_TEAM` at evaluation time and uses
 * `jose.jwtVerify`, so each test stubs env via `vi.stubEnv`, mocks `jose`, then
 * `vi.resetModules()` + dynamic-imports the module fresh (mirrors the pattern in
 * `auth-credentials-gate.test.ts`).
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

// Controllable JWT payload returned by the mocked verifier. `jwtVerify` is the
// only `jose` surface this module uses on the verified path; `createRemoteJWKSet`
// is called for its return value only (the JWKS is handed straight back to the
// mocked `jwtVerify`, which ignores it).
const verifyState: { payload: Record<string, unknown> } = { payload: {} };

vi.mock("jose", () => ({
  jwtVerify: vi.fn(async () => ({ payload: verifyState.payload })),
  createRemoteJWKSet: vi.fn(() => ({}) as never),
}));

/** Base64url-encode a payload object into a 3-part JWT string (header.payload.sig). */
function makeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${enc({ alg: "RS256", typ: "JWT" })}.${enc(payload)}.sig`;
}

let warnSpy: MockInstance<(...args: unknown[]) => void>;
let errorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  verifyState.payload = {};
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

/** Import the module fresh so the top-level env-derived consts re-read stubs. */
async function loadModule() {
  return import("@/lib/cloudflare-access");
}

describe("validateAccessJWT — verified path (CF_ACCESS_AUD + TEAM set)", () => {
  beforeEach(() => {
    vi.stubEnv("CF_ACCESS_AUD", "aud-123");
    vi.stubEnv("CF_ACCESS_TEAM", "myteam");
  });

  it("(a) resolves null for a verified non-identity (service) token with no email", async () => {
    // Service token: signature verifies, but the payload carries common_name and
    // NO email. Must NOT mint a user session.
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

describe("validateAccessJWT — dev-decode path (CF_ACCESS_AUD unset)", () => {
  beforeEach(() => {
    // No AUD configured → module decodes WITHOUT signature verification.
    vi.stubEnv("CF_ACCESS_AUD", "");
    vi.stubEnv("CF_ACCESS_TEAM", "");
  });

  it("(a) resolves null for an email-less (service) token on the dev path", async () => {
    const { validateAccessJWT } = await loadModule();
    const token = makeJwt({ sub: "service-sub", common_name: "client-id-abc" });

    await expect(validateAccessJWT(token)).resolves.toBeNull();
  });

  it("(b) resolves the user for an identity token on the dev path", async () => {
    const { validateAccessJWT } = await loadModule();
    const token = makeJwt({ sub: "user-sub", email: "bob@example.com", country: "CA" });

    await expect(validateAccessJWT(token)).resolves.toEqual({
      email: "bob@example.com",
      sub: "user-sub",
      country: "CA",
    });
  });
});
