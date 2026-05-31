/**
 * Tests for the `ENABLE_LOCAL_CREDENTIALS` startup gate in `src/auth.ts`.
 *
 * The gate runs at module-evaluation time, so each test stubs `process.exit`,
 * sets env vars via `vi.stubEnv`, then `vi.resetModules()` + dynamic-import
 * `src/auth.ts`.
 *
 * We mock the heavy dependencies (DB, NextAuth, drizzle adapter) so the
 * import succeeds purely as a syntactic load — we only care about the
 * top-level credential-gate block.
 *
 * `vi.stubEnv` is preferred over direct `process.env.X =` assignment because
 * TypeScript treats `NODE_ENV` as readonly under newer `@types/node`, and
 * `stubEnv` properly restores on `vi.unstubAllEnvs()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, auth: () => null, signIn: vi.fn(), signOut: vi.fn() }),
}));
vi.mock("next-auth/providers/credentials", () => ({ default: () => ({}) }));
vi.mock("next-auth/providers/github", () => ({ default: () => ({}) }));
vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: () => ({}) }));
vi.mock("@/db", () => ({ db: { query: {} } }));
vi.mock("@/db/schema", () => ({
  users: {},
  accounts: {},
  sessions: {},
  verificationTokens: {},
  authorizedUsers: {},
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/encryption", () => ({ encrypt: (x: string) => x, decryptSafe: (x: string) => x }));
vi.mock("@/lib/github-scopes", () => ({ GITHUB_SCOPE_STRING: "" }));
vi.mock("@/lib/auth-cookies", () => ({ buildScopedCookies: () => undefined }));
vi.mock("@/lib/base-path", () => ({ BASE_PATH: "" }));

let exitSpy: MockInstance<(code?: number) => never>;
let warnSpy: MockInstance<(...args: unknown[]) => void>;
let errorSpy: MockInstance<(...args: unknown[]) => void>;

function joinCalls(spy: MockInstance<(...args: unknown[]) => void>): string {
  return spy.mock.calls.map((call: unknown[]) => call.map((c) => String(c)).join(" ")).join(" ");
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  // Clear any inherited values from the host environment.
  vi.stubEnv("ENABLE_LOCAL_CREDENTIALS", "");
  vi.stubEnv("AUTH_URL", "");
  vi.stubEnv("NEXTAUTH_URL", "");
  vi.stubEnv("NODE_ENV", "");

  // Spy on process.exit so production-refusal doesn't kill the test runner.
  // Throw inside the spy so module evaluation stops at the exit() call —
  // mirrors real `process.exit()` semantics for downstream code.
  exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit called with ${code}`);
  });

  // Spy on console.warn/error so we can assert log content without polluting
  // the test runner output. The logger writes through console in dev.
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  exitSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("ENABLE_LOCAL_CREDENTIALS startup gate", () => {
  it("refuses to start when set on a production remote deploy", async () => {
    vi.stubEnv("ENABLE_LOCAL_CREDENTIALS", "true");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_URL", "https://prod.example.com");

    await expect(import("@/auth")).rejects.toThrow(/process\.exit called with 1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(joinCalls(errorSpy)).toMatch(/FATAL: ENABLE_LOCAL_CREDENTIALS/);
  });

  it("refuses with the legacy NEXTAUTH_URL alias too", async () => {
    vi.stubEnv("ENABLE_LOCAL_CREDENTIALS", "true");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "https://prod.example.com/alpha");

    await expect(import("@/auth")).rejects.toThrow(/process\.exit called with 1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("allows ENABLE_LOCAL_CREDENTIALS=true in development", async () => {
    vi.stubEnv("ENABLE_LOCAL_CREDENTIALS", "true");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_URL", "http://localhost:6001");

    await expect(import("@/auth")).resolves.toBeDefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(joinCalls(warnSpy)).toMatch(/passwordless email sign-in is ENABLED/);
  });

  it("allows ENABLE_LOCAL_CREDENTIALS=true when AUTH_URL contains localhost (production-on-loopback)", async () => {
    // Edge case: NODE_ENV=production + localhost AUTH_URL. This is what a
    // local production-mode test run looks like; should not refuse.
    vi.stubEnv("ENABLE_LOCAL_CREDENTIALS", "true");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_URL", "http://localhost:6001");

    await expect(import("@/auth")).resolves.toBeDefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("allows ENABLE_LOCAL_CREDENTIALS=true when AUTH_URL contains 127.0.0.1", async () => {
    vi.stubEnv("ENABLE_LOCAL_CREDENTIALS", "true");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_URL", "http://127.0.0.1:6001");

    await expect(import("@/auth")).resolves.toBeDefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("is a no-op when ENABLE_LOCAL_CREDENTIALS is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_URL", "https://prod.example.com");

    await expect(import("@/auth")).resolves.toBeDefined();
    expect(exitSpy).not.toHaveBeenCalled();
    // No "passwordless" warning when unset.
    expect(joinCalls(warnSpy)).not.toMatch(/passwordless email sign-in/);
  });

  it("is a no-op when ENABLE_LOCAL_CREDENTIALS=false", async () => {
    vi.stubEnv("ENABLE_LOCAL_CREDENTIALS", "false");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_URL", "https://prod.example.com");

    await expect(import("@/auth")).resolves.toBeDefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
