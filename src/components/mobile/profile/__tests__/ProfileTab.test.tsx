/**
 * ProfileTab tests — Phase 6 mobile redesign.
 *
 * Renders the real ProfileTab and verifies:
 *
 *   - The signed-in-as identity line appears.
 *   - Each section row pushes its sub-screen onto the stack.
 *   - Back navigation pops the stack and restores the index.
 *   - "Sign out" opens an action sheet (NOT a modal dialog) and the
 *     destructive item invokes the supplied signOut callback.
 *
 * NextAuth's `signOut` is mocked at the import level so we don't trigger
 * a real navigation in jsdom/happy-dom.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProfileTab } from "@/components/mobile/profile/ProfileTab";

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

afterEach(() => cleanup());

describe("ProfileTab", () => {
  it("renders the signed-in-as line on the index", () => {
    render(
      <ProfileTab
        email="bryan@example.com"
        displayName="Bryan"
        isGitHubConnected={false}
      />
    );
    expect(screen.getByTestId("mobile-profile-tab")).toHaveAttribute(
      "data-screen",
      "index"
    );
    expect(screen.getByTestId("mobile-profile-signed-in-as")).toHaveTextContent(
      "bryan@example.com"
    );
  });

  it("shows GitHub status as Connected when isGitHubConnected is true", () => {
    render(
      <ProfileTab
        email="bryan@example.com"
        displayName="Bryan"
        isGitHubConnected={true}
      />
    );
    const githubRow = screen.getByRole("button", { name: /GitHub accounts/ });
    expect(githubRow).toHaveTextContent("Connected");
  });

  it("pushes the Account sub-screen when the row is tapped", async () => {
    const user = userEvent.setup();
    render(
      <ProfileTab
        email="bryan@example.com"
        displayName="Bryan"
        isGitHubConnected={false}
      />
    );
    await user.click(screen.getByRole("button", { name: /Account/ }));
    expect(screen.getByTestId("mobile-profile-tab")).toHaveAttribute(
      "data-screen",
      "account"
    );
    // The sub-screen header renders the title.
    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
  });

  it("pops back to the index when the back affordance is tapped", async () => {
    const user = userEvent.setup();
    render(
      <ProfileTab
        email="bryan@example.com"
        displayName={null}
        isGitHubConnected={false}
      />
    );
    await user.click(screen.getByRole("button", { name: /Settings/ }));
    expect(screen.getByTestId("mobile-profile-tab")).toHaveAttribute(
      "data-screen",
      "settings"
    );
    await user.click(screen.getByTestId("mobile-profile-back"));
    expect(screen.getByTestId("mobile-profile-tab")).toHaveAttribute(
      "data-screen",
      "index"
    );
  });

  it("opens an action sheet (not a dialog) for sign-out", async () => {
    const user = userEvent.setup();
    render(
      <ProfileTab
        email="bryan@example.com"
        displayName={null}
        isGitHubConnected={false}
      />
    );
    await user.click(screen.getByRole("button", { name: /Sign out/ }));
    // The sheet renders its items in a list keyed by data-testid. The
    // presence of the action-sheet items container distinguishes this
    // surface from a modal confirmation dialog (which would render under
    // role="dialog" with role="alertdialog" semantics).
    await waitFor(() => {
      expect(screen.getByTestId("mobile-action-sheet-items")).toBeInTheDocument();
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("invokes the supplied signOut callback when the sheet's Sign out item is tapped", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn().mockResolvedValue(undefined);
    render(
      <ProfileTab
        email="bryan@example.com"
        displayName={null}
        isGitHubConnected={false}
        signOut={onSignOut}
      />
    );
    await user.click(screen.getByRole("button", { name: /Sign out/ }));
    // Scope the second click to the action sheet's items list so we don't
    // accidentally re-click the row in the index. The index row is a
    // plain <button>, while the sheet's confirm renders role="menuitem";
    // we identify the sheet's confirm via its data-action-id.
    await waitFor(() => {
      const items = screen.getByTestId("mobile-action-sheet-items");
      expect(items.querySelector('[data-action-id="confirm-sign-out"]')).not.toBeNull();
    });
    const itemsList = screen.getByTestId("mobile-action-sheet-items");
    const confirm = itemsList.querySelector<HTMLElement>(
      '[data-action-id="confirm-sign-out"]'
    );
    if (!confirm) throw new Error("destructive sign-out confirm item missing");
    await user.click(confirm);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("invokes onConnectGitHub when the GitHub-accounts add button is pressed", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    render(
      <ProfileTab
        email="bryan@example.com"
        displayName={null}
        isGitHubConnected={false}
        onConnectGitHub={onConnect}
      />
    );
    await user.click(screen.getByRole("button", { name: /GitHub accounts/ }));
    await user.click(screen.getByTestId("mobile-profile-github-add"));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});
