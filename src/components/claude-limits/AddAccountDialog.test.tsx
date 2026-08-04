import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeAccountSummary } from "@/types/claude-limits";
import { AddAccountDialog } from "./AddAccountDialog";

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const freshAccount: ClaudeAccountSummary = {
  id: "fresh-account",
  alias: "Work",
  accountKind: "subscription",
  emailAddress: "work@example.com",
  organizationId: null,
  organizationName: null,
  rateLimitTier: null,
  authMethod: "oauth",
  authHealthy: true,
  lastVerifiedAt: 1,
  hasToken: true,
  usageCredential: false,
  profileId: null,
  createdAt: 1,
  updatedAt: 1,
};

const setupSession = {
  sessionId: "setup-session",
  command: "claude setup-token",
  commandSent: true,
  instructions: ["Finish sign-in, then choose Finish."],
};

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function renderDialog() {
  const onOpenChange = vi.fn();
  const onAdded = vi.fn();
  const onEnableUsage = vi.fn();
  render(
    <AddAccountDialog
      open
      onOpenChange={onOpenChange}
      onAdded={onAdded}
      onEnableUsage={onEnableUsage}
    />
  );
  return { onOpenChange, onAdded, onEnableUsage };
}

function mockSuccessfulSave(path: "session" | "token", account = freshAccount) {
  apiFetch.mockImplementation((url: string) => {
    if (url === "/api/projects") {
      return Promise.resolve(
        jsonResponse({ projects: [{ id: "project-1", name: "Remote Dev" }] })
      );
    }
    if (url === "/api/claude-accounts/setup-session") {
      return Promise.resolve(jsonResponse(setupSession, true, 201));
    }
    if (
      (path === "session" && url === "/api/claude-accounts/capture") ||
      (path === "token" && url === "/api/claude-accounts")
    ) {
      return Promise.resolve(
        jsonResponse({ account, tokenValid: true }, true, 201)
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

async function choosePasteMode() {
  fireEvent.click(
    await screen.findByRole("button", { name: /Paste a token/i })
  );
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe("AddAccountDialog usage tracking offer", () => {
  it("offers usage tracking after a healthy setup-session capture and hands off the account id", async () => {
    mockSuccessfulSave("session");
    const { onOpenChange, onAdded, onEnableUsage } = renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Start sign-in" })
    );
    fireEvent.click(await screen.findByRole("button", { name: "Finish" }));

    expect(
      await screen.findByRole("heading", {
        name: "Enable usage tracking now?",
      })
    ).toBeInTheDocument();
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Enable now" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onEnableUsage).toHaveBeenCalledWith(freshAccount);
    expect(onEnableUsage.mock.calls[0]?.[0].id).toBe("fresh-account");
    expect(onOpenChange.mock.invocationCallOrder[0]).toBeLessThan(
      onEnableUsage.mock.invocationCallOrder[0]
    );
  });

  it("offers the same second step after a healthy pasted-token save", async () => {
    mockSuccessfulSave("token");
    const { onAdded } = renderDialog();
    await choosePasteMode();

    fireEvent.change(screen.getByLabelText("Token"), {
      target: { value: "redacted credential input" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));

    expect(
      await screen.findByRole("heading", {
        name: "Enable usage tracking now?",
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/5h and 7d usage bars/i)).toBeInTheDocument();
    expect(onAdded).toHaveBeenCalledTimes(1);
  });

  it("lets the user skip the optional second step", async () => {
    mockSuccessfulSave("token");
    const { onOpenChange, onEnableUsage } = renderDialog();
    await choosePasteMode();
    fireEvent.change(screen.getByLabelText("Token"), {
      target: { value: "redacted credential input" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    await screen.findByText("Enable usage tracking now?");

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onEnableUsage).not.toHaveBeenCalled();
  });

  it("keeps an unhealthy saved account in diagnosis and clears the transient input", async () => {
    const unhealthy = { ...freshAccount, authHealthy: false };
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/projects") {
        return Promise.resolve(jsonResponse({ projects: [] }));
      }
      if (url === "/api/claude-accounts") {
        return Promise.resolve(
          jsonResponse({
            account: unhealthy,
            tokenValid: false,
            tokenError: "Anthropic rejected that credential.",
          })
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { onAdded, onEnableUsage } = renderDialog();
    await screen.findByLabelText("Token");
    fireEvent.change(screen.getByLabelText("Token"), {
      target: { value: "redacted credential input" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));

    expect(
      await screen.findByText("Anthropic rejected that credential.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Enable usage tracking now?")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Token")).toHaveValue("");
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onEnableUsage).not.toHaveBeenCalled();
  });

  it("does not offer setup when usage tracking is already enabled", async () => {
    mockSuccessfulSave("token", { ...freshAccount, usageCredential: true });
    const { onOpenChange, onEnableUsage } = renderDialog();
    await choosePasteMode();
    fireEvent.change(screen.getByLabelText("Token"), {
      target: { value: "redacted credential input" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByText("Enable usage tracking now?")).not.toBeInTheDocument();
    expect(onEnableUsage).not.toHaveBeenCalled();
  });
});
