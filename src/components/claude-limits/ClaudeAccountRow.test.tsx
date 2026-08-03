import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClaudeUsageAccount,
  LimitStateBlock,
} from "@/types/claude-limits";
import { ClaudeAccountRow } from "./ClaudeAccountRow";

const limitState: LimitStateBlock = {
  limitStatus: "unknown",
  window5hPct: null,
  window7dPct: null,
  resetAt5h: null,
  resetAt7d: null,
  effectiveResetAt: null,
};

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
  limitState,
  pools: [],
};

const onEnableUsage = vi.fn();

function renderRow(overrides: Partial<ClaudeUsageAccount> = {}) {
  const selected = { ...account, ...overrides };
  render(
    <ClaudeAccountRow
      account={selected}
      limitState={limitState}
      now={1_000}
      pools={[]}
      onMarkAvailable={vi.fn().mockResolvedValue(undefined)}
      onChanged={vi.fn()}
      onEnableUsage={onEnableUsage}
    />
  );
  return selected;
}

beforeEach(() => {
  onEnableUsage.mockReset();
});

describe("ClaudeAccountRow usage credential states", () => {
  it("offers usage setup without rendering empty bars for a healthy account", () => {
    const selected = renderRow();

    expect(screen.getByText("Usage tracking off")).toBeInTheDocument();
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
    expect(screen.queryByText("Unknown")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Enable usage tracking" })
    );

    expect(onEnableUsage).toHaveBeenCalledWith(selected);
    expect(onEnableUsage.mock.calls[0]?.[0].id).toBe("account-1");
  });

  it("keeps both usage bars when a usage credential is present", () => {
    renderRow({ usageCredential: true });

    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
    expect(screen.queryByText("Usage tracking off")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Enable usage tracking" })
    ).not.toBeInTheDocument();
  });

  it("preserves the current usage display for an unhealthy account", () => {
    renderRow({ authHealthy: false, usageCredential: false });

    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
    expect(screen.queryByText("Usage tracking off")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Enable usage tracking" })
    ).not.toBeInTheDocument();
  });
});
