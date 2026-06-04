/**
 * Tests for the instance login client's OIDC button.
 *
 * The mobile deep-link bridge depends on the OIDC sign-in forwarding the
 * `?callbackUrl=` (resolved + sanitized server-side, passed down as a prop) to
 * `signIn`, so that after Authentik sign-in NextAuth returns the user to the
 * original destination (e.g. `/<slug>/auth/mobile-callback`) instead of "/".
 * When no callbackUrl prop is present, the button must fall back to the
 * instance root via `prefixPath("/")`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LoginClient from "../login-client";

// signIn is the only next-auth/react surface the button touches. SessionProvider
// is rendered by LoginClient, so stub it as a passthrough to avoid pulling in a
// real session fetch.
const signInMock = vi.fn();
vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// next/navigation's useRouter is used by the credentials path (not exercised
// here) — stub it so the component renders.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Pin prefixPath / runtimeBasePath to deterministic, unscoped values. The
// fallback assertion checks the button calls signIn with prefixPath("/").
vi.mock("@/lib/base-path", () => ({
  prefixPath: (input: string) => input,
}));
vi.mock("@/lib/api-fetch", () => ({
  runtimeBasePath: () => "",
}));

beforeEach(() => {
  signInMock.mockReset();
});

describe("LoginClient OIDC button — callbackUrl forwarding", () => {
  it("forwards the callbackUrl prop to signIn when present", () => {
    render(
      <LoginClient
        oidcEnabled
        oidcName="Authentik"
        callbackUrl="/dev/auth/mobile-callback?state=xyz"
      />,
    );

    fireEvent.click(screen.getByText("Sign in with Authentik"));

    expect(signInMock).toHaveBeenCalledTimes(1);
    expect(signInMock).toHaveBeenCalledWith("oidc", {
      callbackUrl: "/dev/auth/mobile-callback?state=xyz",
    });
  });

  it("falls back to prefixPath('/') when callbackUrl is absent", () => {
    render(<LoginClient oidcEnabled oidcName="Authentik" />);

    fireEvent.click(screen.getByText("Sign in with Authentik"));

    expect(signInMock).toHaveBeenCalledTimes(1);
    expect(signInMock).toHaveBeenCalledWith("oidc", { callbackUrl: "/" });
  });

  it("does not render the OIDC button when OIDC is disabled", () => {
    render(<LoginClient oidcEnabled={false} oidcName="Authentik" />);

    expect(screen.queryByText("Sign in with Authentik")).toBeNull();
  });
});
