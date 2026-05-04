/**
 * MobileWelcomeScreen tests — Phase 6 mobile redesign.
 *
 * Verifies the welcome surface renders the signed-in-as line, exposes
 * the Connect-GitHub CTA only when GitHub is not yet connected, and
 * routes both primary actions to the correct callbacks.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MobileWelcomeScreen } from "@/components/mobile/auth/MobileWelcomeScreen";
import { MobileLockScreen } from "@/components/mobile/auth/MobileLockScreen";

afterEach(() => cleanup());

describe("MobileWelcomeScreen", () => {
  it("renders the signed-in-as line when an email is present", () => {
    render(
      <MobileWelcomeScreen
        email="bryan@example.com"
        isGitHubConnected={false}
        onConnectGitHub={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    expect(screen.getByTestId("mobile-welcome-signed-in-as")).toHaveTextContent(
      "bryan@example.com"
    );
  });

  it("shows Connect GitHub when not connected", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    render(
      <MobileWelcomeScreen
        email="bryan@example.com"
        isGitHubConnected={false}
        onConnectGitHub={onConnect}
        onSkip={vi.fn()}
      />
    );
    await user.click(screen.getByTestId("mobile-welcome-connect-github"));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("hides Connect GitHub when already connected", () => {
    render(
      <MobileWelcomeScreen
        email="bryan@example.com"
        isGitHubConnected={true}
        onConnectGitHub={vi.fn()}
        onSkip={vi.fn()}
      />
    );
    expect(screen.queryByTestId("mobile-welcome-connect-github")).toBeNull();
    expect(screen.getByTestId("mobile-welcome-github-connected")).toBeInTheDocument();
  });

  it("invokes onSkip when the Skip-for-now button is tapped", async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(
      <MobileWelcomeScreen
        email={null}
        isGitHubConnected={false}
        onConnectGitHub={vi.fn()}
        onSkip={onSkip}
      />
    );
    await user.click(screen.getByTestId("mobile-welcome-skip"));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

describe("MobileLockScreen", () => {
  it("renders the Cloudflare Access copy by default", () => {
    render(<MobileLockScreen />);
    expect(screen.getByTestId("mobile-lock-screen")).toHaveTextContent(
      "Authenticating via Cloudflare Access"
    );
  });

  it("respects custom message and detail props", () => {
    render(<MobileLockScreen message="Loading" detail="One moment." />);
    const lock = screen.getByTestId("mobile-lock-screen");
    expect(lock).toHaveTextContent("Loading");
    expect(lock).toHaveTextContent("One moment.");
  });
});
