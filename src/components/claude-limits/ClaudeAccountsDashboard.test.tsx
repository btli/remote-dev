import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeUsageAccount } from "@/types/claude-limits";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  refreshAccounts: vi.fn().mockResolvedValue(undefined),
  refreshPools: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));

vi.mock("@/contexts/ProfileContext", () => ({
  useProfileContext: () => ({
    getAccountLimitState: () => null,
    markAccountAvailable: vi.fn().mockResolvedValue(undefined),
    pools: [],
    refreshPools: mocks.refreshPools,
    refreshAccounts: mocks.refreshAccounts,
  }),
}));

vi.mock("./ClaudeAccountRow", () => ({
  ClaudeAccountRow: ({
    account,
    onEnableUsage,
  }: {
    account: ClaudeUsageAccount;
    onEnableUsage: (account: ClaudeUsageAccount) => void;
  }) => (
    <button type="button" onClick={() => onEnableUsage(account)}>
      Enable usage for {account.id}
    </button>
  ),
}));

vi.mock("./AddAccountDialog", () => ({
  AddAccountDialog: ({
    open,
    onEnableUsage,
  }: {
    open: boolean;
    onEnableUsage: (account: ClaudeUsageAccount) => void;
  }) =>
    open ? (
      <div data-testid="add-dialog">
        <button
          type="button"
          onClick={() => onEnableUsage({ ...account, id: "fresh-account" })}
        >
          Offer usage for fresh account
        </button>
      </div>
    ) : null,
}));

vi.mock("./UsageTrackingDialog", () => ({
  UsageTrackingDialog: ({
    account: selected,
    open,
    onCompleted,
    onOpenChange,
  }: {
    account: ClaudeUsageAccount;
    open: boolean;
    onCompleted: () => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="usage-dialog">
        <span>Usage target {selected.id}</span>
        <button
          type="button"
          onClick={() => {
            onCompleted();
            onOpenChange(false);
          }}
        >
          Complete usage setup
        </button>
      </div>
    ) : null,
}));

import { ClaudeAccountsDashboard } from "./ClaudeAccountsDashboard";

const account: ClaudeUsageAccount = {
  id: "account-1",
  alias: "Work",
  accountKind: "subscription",
  emailAddress: "work@example.com",
  organizationId: null,
  organizationName: null,
  rateLimitTier: null,
  authMethod: "oauth",
  authHealthy: true,
  lastVerifiedAt: null,
  hasToken: true,
  usageCredential: false,
  profileId: null,
  createdAt: 1,
  updatedAt: 1,
  limitState: {
    limitStatus: "unknown",
    window5hPct: null,
    window7dPct: null,
    resetAt5h: null,
    resetAt7d: null,
    effectiveResetAt: null,
  },
  pools: [],
};

function response() {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ accounts: [account] }),
  } as unknown as Response;
}

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.apiFetch.mockResolvedValue(response());
  mocks.refreshAccounts.mockReset();
  mocks.refreshAccounts.mockResolvedValue(undefined);
  mocks.refreshPools.mockReset();
  mocks.refreshPools.mockResolvedValue(undefined);
});

describe("ClaudeAccountsDashboard usage setup ownership", () => {
  it("opens the reusable flow from a row and reloads both account views on completion", async () => {
    render(<ClaudeAccountsDashboard />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Enable usage for account-1",
      })
    );

    expect(screen.getByText("Usage target account-1")).toBeInTheDocument();
    expect(screen.queryByTestId("add-dialog")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Complete usage setup" })
    );

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(2));
    expect(mocks.refreshAccounts).toHaveBeenCalled();
    expect(screen.queryByTestId("usage-dialog")).not.toBeInTheDocument();
  });

  it("closes Add Account before opening usage setup for the fresh account", async () => {
    render(<ClaudeAccountsDashboard />);
    await screen.findByRole("button", { name: "Enable usage for account-1" });

    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(screen.getByTestId("add-dialog")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Offer usage for fresh account" })
    );

    expect(screen.queryByTestId("add-dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Usage target fresh-account")).toBeInTheDocument();
  });
});
