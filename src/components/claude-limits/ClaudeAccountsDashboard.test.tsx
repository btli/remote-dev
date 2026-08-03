import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClaudeUsageAccount,
  LimitStateBlock,
} from "@/types/claude-limits";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  refreshAccounts: vi.fn().mockResolvedValue(undefined),
  refreshPools: vi.fn().mockResolvedValue(undefined),
  markAccountAvailable: vi.fn().mockResolvedValue(undefined),
  limitStates: new Map<string, LimitStateBlock>(),
}));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));

vi.mock("@/contexts/ProfileContext", () => ({
  useProfileContext: () => ({
    limitStates: mocks.limitStates,
    getAccountLimitState: (accountId: string) =>
      mocks.limitStates.get(accountId) ?? null,
    markAccountAvailable: mocks.markAccountAvailable,
    pools: [],
    refreshPools: mocks.refreshPools,
    refreshAccounts: mocks.refreshAccounts,
  }),
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

function response(returnedAccount = account) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ accounts: [returnedAccount] }),
  } as unknown as Response;
}

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.apiFetch.mockResolvedValue(response());
  mocks.refreshAccounts.mockReset();
  mocks.refreshAccounts.mockResolvedValue(undefined);
  mocks.refreshPools.mockReset();
  mocks.refreshPools.mockResolvedValue(undefined);
  mocks.markAccountAvailable.mockReset();
  mocks.markAccountAvailable.mockResolvedValue(undefined);
  mocks.limitStates = new Map();
});

describe("ClaudeAccountsDashboard usage setup ownership", () => {
  it("opens the reusable flow from a row and reloads both account views on completion", async () => {
    render(<ClaudeAccountsDashboard />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Enable usage tracking",
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
    await screen.findByRole("button", { name: "Enable usage tracking" });

    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(screen.getByTestId("add-dialog")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Offer usage for fresh account" })
    );

    expect(screen.queryByTestId("add-dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Usage target fresh-account")).toBeInTheDocument();
  });

  it("renders fresh usage bars after reload when the context cache is stale", async () => {
    const staleLimitState = account.limitState;
    const freshLimitState: LimitStateBlock = {
      limitStatus: "available",
      window5hPct: 42,
      window7dPct: 58,
      resetAt5h: null,
      resetAt7d: null,
      effectiveResetAt: null,
    };
    const visibleAccount = { ...account, usageCredential: true };
    mocks.limitStates = new Map([[account.id, staleLimitState]]);
    mocks.apiFetch
      .mockResolvedValueOnce(response(visibleAccount))
      .mockResolvedValueOnce(
        response({ ...visibleAccount, limitState: freshLimitState })
      );
    render(<ClaudeAccountsDashboard />);

    await screen.findAllByRole("progressbar");
    fireEvent.click(screen.getByRole("button", { name: "Reload usage" }));

    await waitFor(() => {
      expect(screen.getByText("42%")).toBeInTheDocument();
      expect(screen.getByText("58%")).toBeInTheDocument();
    });
  });

  it("preserves a newer context update that arrives during reload", async () => {
    let resolveReload: ((response: Response) => void) | null = null;
    const staleLimitState = account.limitState;
    const freshLimitState: LimitStateBlock = {
      limitStatus: "available",
      window5hPct: 42,
      window7dPct: 58,
      resetAt5h: null,
      resetAt7d: null,
      effectiveResetAt: null,
    };
    const concurrentLimitState: LimitStateBlock = {
      limitStatus: "limited",
      window5hPct: 91,
      window7dPct: 93,
      resetAt5h: 2_000_000_000_000,
      resetAt7d: 2_000_000_100_000,
      effectiveResetAt: 2_000_000_000_000,
    };
    const visibleAccount = { ...account, usageCredential: true };
    mocks.limitStates = new Map([[account.id, staleLimitState]]);
    mocks.apiFetch
      .mockResolvedValueOnce(response(visibleAccount))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveReload = resolve;
          })
      );
    const view = render(<ClaudeAccountsDashboard />);

    await screen.findAllByRole("progressbar");
    fireEvent.click(screen.getByRole("button", { name: "Reload usage" }));
    mocks.limitStates = new Map([[account.id, concurrentLimitState]]);
    view.rerender(<ClaudeAccountsDashboard />);
    await act(async () => {
      resolveReload?.(
        response({ ...visibleAccount, limitState: freshLimitState })
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("91%")).toBeInTheDocument();
      expect(screen.getByText("93%")).toBeInTheDocument();
    });
  });
});
