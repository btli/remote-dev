import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
// Exercise the host-scope mobile-callback page without a cluster, a DB, or a
// real CF Access JWKS. The page is now a thin wrapper around
// `resolveSupervisorMobileCallback()` (src/lib/mobile-callback.ts); we control
// the same underlying seams that the resolver uses so end-to-end page behavior
// is covered here, and deeper unit coverage lives in
// src/lib/__tests__/mobile-callback.test.ts.

// Cookie store state shared across paths.
type CookieEntry = { name: string; value: string };
const cookieJar: CookieEntry[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const found = cookieJar.find((c) => c.name === name);
      return found ? { value: found.value } : undefined;
    },
    getAll: () => cookieJar.map((c) => ({ name: c.name, value: c.value })),
  }),
  headers: async () => new Map(),
}));

// `redirect()` in Next.js throws a NEXT_REDIRECT control-flow error. Capture
// the target and re-throw a sentinel so the page unwinds exactly as in prod.
const redirectState: { target: string | null } = { target: null };
class RedirectError extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectState.target = url;
    throw new RedirectError(url);
  },
}));

// CF Access seam: validateAccessJWT(token) → user or null.
const cfState: { user: { email: string; sub: string } | null } = { user: null };
vi.mock("@/lib/cf-access", () => ({
  validateAccessJWT: async () => cfState.user,
}));

// Supervisor user resolution seam: resolveSupervisorUser(email) → row.
const userState: { row: { id: string; email: string; role: string } } = {
  row: { id: "sup-user-1", email: "host@example.com", role: "admin" },
};
const resolveSpy = vi.fn(async (_email: string) => userState.row);
vi.mock("@/lib/auth", () => ({
  resolveSupervisorUser: (email: string) => resolveSpy(email),
}));

// NextAuth seam — needed by the OIDC path in resolveSupervisorMobileCallback.
//   - `oidcState.email`   = the email a valid NextAuth session yields.
//   - `oidcState.allowed` = closed-allowlist re-check (isOidcSignInAllowed) result;
//     defaults true so existing OIDC tests pass.
const oidcState: { email: string | null; allowed: boolean } = {
  email: null,
  allowed: true,
};
vi.mock("@/auth", () => ({
  auth: async () =>
    oidcState.email ? { user: { email: oidcState.email } } : null,
  isOidcSignInAllowed: async () => oidcState.allowed,
}));

// Import AFTER mocks are registered.
import MobileCallbackPage from "../page";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setCookie(name: string, value: string) {
  cookieJar.push({ name, value });
}

beforeEach(() => {
  cookieJar.length = 0;
  redirectState.target = null;
  cfState.user = null;
  oidcState.email = null;
  oidcState.allowed = true;
  userState.row = { id: "sup-user-1", email: "host@example.com", role: "admin" };
  resolveSpy.mockClear();
});

/** Render a page result element to static HTML (error-UI assertions). */
function html(el: ReactElement): string {
  return renderToStaticMarkup(el);
}

// ---------------------------------------------------------------------------
// CF authenticated
// ---------------------------------------------------------------------------

describe("supervisor auth/mobile-callback — CF authenticated", () => {
  it("redirects to remotedev://auth/callback?scope=host with cfToken, authCookies, NO apiKey", async () => {
    setCookie("CF_Authorization", "ey.cf.jwt");
    cfState.user = { email: "host@example.com", sub: "cf-sub-1" };

    await expect(MobileCallbackPage()).rejects.toThrow(); // redirect() unwinds

    const target = redirectState.target!;
    expect(target).not.toBeNull();
    const uri = new URL(target);
    expect(uri.protocol).toBe("remotedev:");
    expect(uri.host).toBe("auth");
    expect(uri.pathname).toBe("/callback");
    expect(uri.searchParams.get("scope")).toBe("host");
    // Legacy cfToken is preserved on CF path.
    expect(uri.searchParams.get("cfToken")).toBe("ey.cf.jwt");
    expect(uri.searchParams.get("email")).toBe("host@example.com");
    expect(uri.searchParams.get("userId")).toBe("sup-user-1");
    // The contract: the host redirect carries NO apiKey.
    expect(uri.searchParams.get("apiKey")).toBeNull();
    // authCookies must encode the CF cookie.
    const authCookiesRaw = uri.searchParams.get("authCookies");
    expect(authCookiesRaw).not.toBeNull();
    const authCookies = JSON.parse(
      Buffer.from(authCookiesRaw!, "base64url").toString("utf8"),
    ) as Array<{ name: string; value: string; path: string }>;
    expect(authCookies).toEqual([
      { name: "CF_Authorization", value: "ey.cf.jwt", path: "/" },
    ]);
    // Identity is resolved from the validated CF email.
    expect(resolveSpy).toHaveBeenCalledWith("host@example.com");
  });

  it("percent-encodes the CF token in the redirect", async () => {
    setCookie("CF_Authorization", "a b/c+d=");
    cfState.user = { email: "host@example.com", sub: "cf-sub-1" };

    await expect(MobileCallbackPage()).rejects.toThrow();
    // URL-decoded round-trip must equal the original token.
    expect(new URL(redirectState.target!).searchParams.get("cfToken")).toBe(
      "a b/c+d=",
    );
  });
});

// ---------------------------------------------------------------------------
// OIDC authenticated
// ---------------------------------------------------------------------------

describe("supervisor auth/mobile-callback — OIDC authenticated", () => {
  it("redirects with scope=host, authCookies[session@/], NO cfToken, NO apiKey", async () => {
    setCookie("__Secure-authjs.session-token", "jwe-oidc-value");
    oidcState.email = "host@example.com";
    cfState.user = null;

    await expect(MobileCallbackPage()).rejects.toThrow();

    const uri = new URL(redirectState.target!);
    expect(uri.searchParams.get("scope")).toBe("host");
    expect(uri.searchParams.get("cfToken")).toBeNull();
    expect(uri.searchParams.get("apiKey")).toBeNull();
    expect(uri.searchParams.get("email")).toBe("host@example.com");
    expect(uri.searchParams.get("userId")).toBe("sup-user-1");

    const authCookies = JSON.parse(
      Buffer.from(uri.searchParams.get("authCookies")!, "base64url").toString(
        "utf8",
      ),
    ) as Array<{ name: string; value: string; path: string }>;
    expect(authCookies).toEqual([
      { name: "__Secure-authjs.session-token", value: "jwe-oidc-value", path: "/" },
    ]);
    expect(resolveSpy).toHaveBeenCalledWith("host@example.com");
  });

  it("collects chunked OIDC cookies in numeric order", async () => {
    setCookie("__Secure-authjs.session-token.1", "c1");
    setCookie("__Secure-authjs.session-token.0", "c0");
    oidcState.email = "host@example.com";

    await expect(MobileCallbackPage()).rejects.toThrow();

    const authCookies = JSON.parse(
      Buffer.from(
        new URL(redirectState.target!).searchParams.get("authCookies")!,
        "base64url",
      ).toString("utf8"),
    ) as Array<{ name: string; value: string; path: string }>;
    expect(authCookies[0].name).toBe("__Secure-authjs.session-token.0");
    expect(authCookies[1].name).toBe("__Secure-authjs.session-token.1");
  });
});

// ---------------------------------------------------------------------------
// OIDC user resolved but cookie absent — error page (not a login loop)
// ---------------------------------------------------------------------------

describe("supervisor auth/mobile-callback — OIDC user but cookie missing", () => {
  it("renders the error page (not a redirect loop) when session cookie is absent", async () => {
    // auth() resolves a user, but the matching cookie is not in the store.
    oidcState.email = "host@example.com";
    setCookie("other-cookie", "irrelevant");

    const result = (await MobileCallbackPage()) as ReactElement;
    const markup = html(result);
    expect(markup).toContain("Authentication Error");
    expect(markup).toContain("missing its authentication cookie");
    expect(redirectState.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unauthenticated — redirect to login
// ---------------------------------------------------------------------------

describe("supervisor auth/mobile-callback — unauthenticated", () => {
  it("redirects to /login when no CF cookie and no OIDC session", async () => {
    // No cookies, no OIDC session — should redirect to login.
    cfState.user = null;
    oidcState.email = null;

    await expect(MobileCallbackPage()).rejects.toThrow();

    expect(redirectState.target).toBe(
      "/login?callbackUrl=%2Fauth%2Fmobile-callback",
    );
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("redirects to /login when the CF token is invalid/expired and no OIDC session", async () => {
    setCookie("CF_Authorization", "ey.bad.jwt");
    cfState.user = null; // validateAccessJWT rejects it
    oidcState.email = null;

    await expect(MobileCallbackPage()).rejects.toThrow();

    expect(redirectState.target).toBe(
      "/login?callbackUrl=%2Fauth%2Fmobile-callback",
    );
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});
