import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

// --- Mocks -----------------------------------------------------------------
// Exercise the host-scope mobile-callback page without a cluster, a DB, or a
// real CF Access JWKS. We control the cookie, the CF validation result, the
// resolved supervisor_user, and capture the redirect target.

const cookieState: { cfToken: string | undefined } = { cfToken: undefined };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "CF_Authorization" && cookieState.cfToken !== undefined
        ? { value: cookieState.cfToken }
        : undefined,
  }),
}));

// redirect() in Next.js throws a NEXT_REDIRECT control-flow error. Model that:
// capture the target and throw a sentinel so the page function unwinds exactly
// as it would in production (nothing after redirect() runs).
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

// Import AFTER mocks are registered.
import MobileCallbackPage from "../page";

beforeEach(() => {
  cookieState.cfToken = undefined;
  redirectState.target = null;
  cfState.user = null;
  userState.row = { id: "sup-user-1", email: "host@example.com", role: "admin" };
  resolveSpy.mockClear();
});

/** Render a page result element to static HTML (error-UI assertions). */
function html(el: ReactElement): string {
  return renderToStaticMarkup(el);
}

describe("supervisor auth/mobile-callback — authenticated", () => {
  it("redirects to remotedev://auth/callback?scope=host with NO apiKey", async () => {
    cookieState.cfToken = "ey.cf.jwt";
    cfState.user = { email: "host@example.com", sub: "cf-sub-1" };

    await expect(MobileCallbackPage()).rejects.toThrow(); // redirect() unwinds

    const target = redirectState.target!;
    expect(target).not.toBeNull();
    const uri = new URL(target);
    expect(uri.protocol).toBe("remotedev:");
    expect(uri.host).toBe("auth");
    expect(uri.pathname).toBe("/callback");
    expect(uri.searchParams.get("scope")).toBe("host");
    // The contract: the host redirect carries NO apiKey.
    expect(uri.searchParams.get("apiKey")).toBeNull();
    expect(uri.searchParams.get("cfToken")).toBe("ey.cf.jwt");
    expect(uri.searchParams.get("email")).toBe("host@example.com");
    expect(uri.searchParams.get("userId")).toBe("sup-user-1");
    // Identity is resolved from the validated CF email.
    expect(resolveSpy).toHaveBeenCalledWith("host@example.com");
  });

  it("percent-encodes the CF token in the redirect", async () => {
    cookieState.cfToken = "a b/c+d=";
    cfState.user = { email: "host@example.com", sub: "cf-sub-1" };

    await expect(MobileCallbackPage()).rejects.toThrow();
    // URL-decoded round-trip must equal the original token.
    expect(new URL(redirectState.target!).searchParams.get("cfToken")).toBe(
      "a b/c+d=",
    );
  });
});

describe("supervisor auth/mobile-callback — unauthenticated (error UI)", () => {
  it("renders the error UI when no CF_Authorization cookie is present", async () => {
    cookieState.cfToken = undefined;

    const result = (await MobileCallbackPage()) as ReactElement;
    const markup = html(result);
    expect(markup).toContain("Authentication Error");
    expect(markup).toContain("No Cloudflare Access token found");
    expect(redirectState.target).toBeNull();
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("renders the error UI when the CF token is invalid/expired", async () => {
    cookieState.cfToken = "ey.bad.jwt";
    cfState.user = null; // validateAccessJWT rejects it

    const result = (await MobileCallbackPage()) as ReactElement;
    const markup = html(result);
    expect(markup).toContain("Authentication Error");
    expect(markup).toContain("invalid or expired");
    expect(redirectState.target).toBeNull();
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});
