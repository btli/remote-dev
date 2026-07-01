/**
 * Tests for the `AUTH_URL` ⇄ `basePath` reconciliation in `src/auth.ts`
 * (remote-dev-y84c).
 *
 * Slugged multi-instance deployments set `AUTH_URL=https://host/<slug>` while
 * the app pins Auth.js' `basePath` to the full external path
 * `/<slug>/api/auth`. Per-request, `@auth/core`'s `createActionURL` compares
 * `AUTH_URL.pathname` (`/<slug>`) against `basePath` (`/<slug>/api/auth`) and,
 * because they differ, logs `env-url-basepath-mismatch`. The reconciliation
 * normalizes the AUTH_URL Auth.js sees down to origin-only so that comparison
 * lands on `pathname === "/"` and the warning's guard short-circuits — while
 * keeping the full slugged URL available to the direct-path consumers via
 * `NEXTAUTH_URL`.
 *
 * Two layers of coverage:
 *   1. Unit: `reconcileAuthUrlWithBasePath` returns the right split for the
 *      slugged case, the empty-base (single-server) case, and the edge cases.
 *   2. End-to-end against the real `@auth/core` `createActionURL`: the warning
 *      DOES fire with the raw slugged URL and does NOT fire after reconciling.
 *
 * `@/auth` runs a credentials-gate + env-reconciliation side effect at module
 * load, so we mock the heavy deps (mirroring `auth-credentials-gate.test.ts`)
 * and load it via a fresh module graph.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActionURL } from "@auth/core";
import type { AuthConfig } from "@auth/core";

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

/**
 * Import `reconcileAuthUrlWithBasePath` with a given BASE_PATH baked into the
 * mocked `@/lib/base-path` module. A fresh module graph is required because
 * `@/auth` captures `BASE_PATH` at import time.
 */
async function loadReconcile(
  basePath: string,
): Promise<typeof import("@/auth").reconcileAuthUrlWithBasePath> {
  vi.resetModules();
  vi.doMock("@/lib/base-path", () => ({ BASE_PATH: basePath }));
  const mod = await import("@/auth");
  return mod.reconcileAuthUrlWithBasePath;
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  // Neutralize the credentials gate / module-load side effect.
  vi.stubEnv("ENABLE_LOCAL_CREDENTIALS", "");
  vi.stubEnv("NODE_ENV", "");
  vi.stubEnv("AUTH_URL", "");
  vi.stubEnv("NEXTAUTH_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("@/lib/base-path");
});

describe("reconcileAuthUrlWithBasePath", () => {
  it("strips the redundant slug path from AUTH_URL and seeds NEXTAUTH_URL with the full slugged URL", async () => {
    const reconcile = await loadReconcile("/alpha");
    const out = reconcile({ AUTH_URL: "https://rdv.example.com/alpha" }, "/alpha");

    // Core sees origin-only so its pathname is "/" → no mismatch warning.
    expect(out.authUrl).toBe("https://rdv.example.com");
    // Direct-path consumers (github/link, signout) still get the slugged URL.
    expect(out.nextAuthUrl).toBe("https://rdv.example.com/alpha");
  });

  it("preserves an explicitly-set NEXTAUTH_URL rather than overwriting it", async () => {
    const reconcile = await loadReconcile("/alpha");
    const out = reconcile(
      {
        AUTH_URL: "https://rdv.example.com/alpha",
        NEXTAUTH_URL: "https://rdv.example.com/alpha",
      },
      "/alpha",
    );
    expect(out.authUrl).toBe("https://rdv.example.com");
    expect(out.nextAuthUrl).toBe("https://rdv.example.com/alpha");
  });

  it("falls back to NEXTAUTH_URL when AUTH_URL is unset", async () => {
    const reconcile = await loadReconcile("/alpha");
    const out = reconcile({ NEXTAUTH_URL: "https://rdv.example.com/alpha" }, "/alpha");
    expect(out.authUrl).toBe("https://rdv.example.com");
    expect(out.nextAuthUrl).toBe("https://rdv.example.com/alpha");
  });

  it("handles nested base paths (e.g. /team/alpha)", async () => {
    const reconcile = await loadReconcile("/team/alpha");
    const out = reconcile({ AUTH_URL: "https://host/team/alpha" }, "/team/alpha");
    expect(out.authUrl).toBe("https://host");
    expect(out.nextAuthUrl).toBe("https://host/team/alpha");
  });

  it("is a no-op when BASE_PATH is empty (single-server)", async () => {
    const reconcile = await loadReconcile("");
    const out = reconcile({ AUTH_URL: "https://app.example.com" }, "");
    expect(out.authUrl).toBe("https://app.example.com");
    expect(out.nextAuthUrl).toBeUndefined();
  });

  it("leaves an already-origin-only AUTH_URL untouched even with a base path", async () => {
    // Defensive: if AUTH_URL somehow has no path, there's nothing to strip and
    // core already agrees with the origin contract.
    const reconcile = await loadReconcile("/alpha");
    const out = reconcile({ AUTH_URL: "https://rdv.example.com" }, "/alpha");
    expect(out.authUrl).toBe("https://rdv.example.com");
  });

  it("leaves an unparseable AUTH_URL untouched (don't mask a config error)", async () => {
    const reconcile = await loadReconcile("/alpha");
    const out = reconcile({ AUTH_URL: "not a url" }, "/alpha");
    expect(out.authUrl).toBe("not a url");
  });

  it("returns undefined URLs when nothing is configured", async () => {
    const reconcile = await loadReconcile("/alpha");
    const out = reconcile({}, "/alpha");
    expect(out.authUrl).toBeUndefined();
    expect(out.nextAuthUrl).toBeUndefined();
  });
});

describe("createActionURL no longer warns after reconciliation (real @auth/core)", () => {
  const ACTION = "signin";

  /**
   * Drive the real `@auth/core` `createActionURL` with a captured warn-logger
   * and report (a) whether `env-url-basepath-mismatch` fired and (b) the URL
   * it produced. `createActionURL` reads the env URL off the `envObject` arg.
   */
  function runCreateActionURL(authUrl: string, basePath: string): {
    warned: boolean;
    url: string;
  } {
    const warnings: string[] = [];
    const config: Pick<AuthConfig, "basePath" | "logger"> = {
      basePath,
      logger: { warn: (code: string) => warnings.push(code) },
    };
    const url = createActionURL(
      ACTION,
      "https",
      new Headers(),
      // Mimic process.env: createActionURL reads AUTH_URL ?? NEXTAUTH_URL.
      // The upstream signature types this parameter as `any`.
      { AUTH_URL: authUrl },
      config,
    );
    return {
      warned: warnings.includes("env-url-basepath-mismatch"),
      url: url.toString(),
    };
  }

  it("the raw slugged AUTH_URL would trigger env-url-basepath-mismatch (proves the bug)", () => {
    const { warned } = runCreateActionURL(
      "https://rdv.example.com/alpha",
      "/alpha/api/auth",
    );
    expect(warned).toBe(true);
  });

  it("the reconciled (origin-only) AUTH_URL does NOT trigger the warning", async () => {
    const reconcile = await loadReconcile("/alpha");
    const { authUrl } = reconcile(
      { AUTH_URL: "https://rdv.example.com/alpha" },
      "/alpha",
    );
    const { warned, url } = runCreateActionURL(authUrl!, "/alpha/api/auth");
    expect(warned).toBe(false);
    // Outbound URL still carries the full external path: origin + basePath + action.
    expect(url).toBe("https://rdv.example.com/alpha/api/auth/signin");
  });

  it("single-server (empty base) AUTH_URL produces no warning and a clean action URL", () => {
    // basePath defaults to /api/auth for next-auth; AUTH_URL is origin-only.
    const { warned, url } = runCreateActionURL(
      "https://app.example.com",
      "/api/auth",
    );
    expect(warned).toBe(false);
    expect(url).toBe("https://app.example.com/api/auth/signin");
  });
});
