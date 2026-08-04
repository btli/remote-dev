import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeAccountSummary } from "@/types/claude-limits";

const apiFetch = vi.fn();
const refreshSessions = vi.fn().mockResolvedValue(undefined);
const setActiveSession = vi.fn();
let sessions: Array<{
  id: string;
  status: string;
  typeMetadata: Record<string, unknown> | null;
}> = [];

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => ({
    sessions,
    refreshSessions,
    setActiveSession,
  }),
}));

import { UsageTrackingDialog } from "./UsageTrackingDialog";

const account: ClaudeAccountSummary = {
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
};

const setup = {
  sessionId: "usage-session-1",
  command: "claude auth login",
  commandSent: true,
  instructions: [
    "Complete the Claude browser sign-in opened by the terminal.",
    "Return here after sign-in and choose Finish.",
  ],
};

function captureSuccess(
  overrides: Partial<{
    usageValidated: boolean;
    cleanupComplete: boolean;
    pollEnabled: boolean;
  }> = {}
) {
  return {
    account: { ...account, usageCredential: true },
    usageValidated: true,
    cleanupComplete: true,
    pollEnabled: true,
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 409) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function nonJsonResponse(ok = false, status = 500) {
  return {
    ok,
    status,
    json: vi.fn().mockRejectedValue(new SyntaxError("not JSON")),
  } as unknown as Response;
}

function mockProjects(projects = [{ id: "project-1", name: "Remote Dev" }]) {
  apiFetch.mockImplementation((url: string) => {
    if (url === "/api/projects") return Promise.resolve(jsonResponse({ projects }));
    throw new Error(`Unexpected request: ${url}`);
  });
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof UsageTrackingDialog>> = {}
) {
  const onOpenChange = vi.fn();
  const onCompleted = vi.fn();
  const view = render(
    <UsageTrackingDialog
      account={account}
      open
      onOpenChange={onOpenChange}
      onCompleted={onCompleted}
      {...props}
    />
  );
  return {
    onOpenChange,
    onCompleted,
    rerenderDialog: () =>
      view.rerender(
        <UsageTrackingDialog
          account={account}
          open
          onOpenChange={onOpenChange}
          onCompleted={onCompleted}
          {...props}
        />
      ),
  };
}

async function readyStartButton() {
  const startButton = await screen.findByRole("button", {
    name: "Start usage sign-in",
  });
  await waitFor(() => expect(startButton).toBeEnabled());
  return startButton;
}

async function startSession() {
  const startButton = await readyStartButton();
  fireEvent.click(startButton);
  await screen.findByText("claude auth login");
}

beforeEach(() => {
  apiFetch.mockReset();
  refreshSessions.mockReset();
  refreshSessions.mockImplementation(async () => {
    // Successful SessionContext refreshes dispatch a newly parsed array.
    sessions = [...sessions];
  });
  setActiveSession.mockReset();
  sessions = [];
});

describe("UsageTrackingDialog", () => {
  it("allows Start after a swallowed refresh failure yields no reconciliation", async () => {
    refreshSessions.mockResolvedValue(undefined);
    mockProjects();
    renderDialog();

    const startButton = await screen.findByRole("button", {
      name: "Start usage sign-in",
    });
    expect(startButton).toBeDisabled();
    await waitFor(() => expect(startButton).toBeEnabled());
  });

  it("does not recover a stale baseline session removed by refresh", async () => {
    let resolveRefresh: (() => void) | null = null;
    sessions = [
      {
        id: "stale-baseline-session",
        status: "active",
        typeMetadata: {
          rdvClaudeUsageSetupSession: true,
          accountId: "account-1",
        },
      },
    ];
    refreshSessions.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        })
    );
    mockProjects();
    const { rerenderDialog } = renderDialog();

    await act(async () => {
      sessions = [];
      resolveRefresh?.();
      rerenderDialog();
      await Promise.resolve();
    });

    const startButton = await screen.findByRole("button", {
      name: "Start usage sign-in",
    });
    await waitFor(() => expect(startButton).toBeEnabled());
    expect(
      screen.queryByText(/existing usage sign-in session/i)
    ).not.toBeInTheDocument();
  });

  it("keeps Start unavailable until delayed session reconciliation recovers an existing flow", async () => {
    let resolveRefresh: (() => void) | null = null;
    refreshSessions.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        })
    );
    mockProjects();
    const { rerenderDialog } = renderDialog();

    const startButton = await screen.findByRole("button", {
      name: "Start usage sign-in",
    });
    expect(startButton).toBeDisabled();

    await act(async () => {
      resolveRefresh?.();
      await Promise.resolve();
    });
    expect(startButton).toBeDisabled();

    sessions = [
      {
        id: "delayed-existing-session",
        status: "active",
        typeMetadata: {
          rdvClaudeUsageSetupSession: true,
          accountId: "account-1",
        },
      },
    ];
    rerenderDialog();

    expect(
      await screen.findByText(/existing usage sign-in session/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start usage sign-in" })
    ).not.toBeInTheDocument();
  });

  it("loads a project and starts setup with the selected account", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/projects") {
        return Promise.resolve(
          jsonResponse({ projects: [{ id: "project-1", name: "Remote Dev" }] })
        );
      }
      if (url === "/api/claude-accounts/usage-setup-session") {
        return Promise.resolve(jsonResponse(setup, true, 201));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderDialog();
    await startSession();

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/claude-accounts/usage-setup-session",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          projectId: "project-1",
          accountId: "account-1",
        }),
      })
    );
    expect(
      screen.getByText(/Complete the Claude browser sign-in/i)
    ).toBeInTheDocument();
  });

  it("accepts a server-recovered setup response with unknown command state", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/projects") {
        return Promise.resolve(
          jsonResponse({ projects: [{ id: "project-1", name: "Remote Dev" }] })
        );
      }
      if (url === "/api/claude-accounts/usage-setup-session") {
        return Promise.resolve(
          jsonResponse({
            sessionId: "existing-usage-session",
            command: null,
            commandSent: null,
            recovered: true,
            instructions: [
              "Complete the Claude sign-in in the terminal.",
              "Return here after sign-in and choose Finish.",
            ],
          })
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    renderDialog();

    fireEvent.click(await readyStartButton());

    expect(
      await screen.findByText(/existing usage sign-in session is ready/i)
    ).toBeInTheDocument();
    expect(screen.queryByText("claude auth login")).not.toBeInTheDocument();
  });

  it("activates the returned terminal session after refreshing sessions", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/projects") {
        return Promise.resolve(jsonResponse({ projects: [{ id: "project-1", name: "Remote Dev" }] }));
      }
      if (url === "/api/claude-accounts/usage-setup-session") {
        return Promise.resolve(jsonResponse(setup, true, 201));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { onOpenChange } = renderDialog();
    await startSession();

    fireEvent.click(
      screen.getByRole("button", { name: "Open terminal session" })
    );

    await waitFor(() => {
      expect(refreshSessions).toHaveBeenCalled();
      expect(setActiveSession).toHaveBeenCalledWith("usage-session-1");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/api/claude-accounts/usage-abort",
      expect.anything()
    );
  });

  it("best-effort aborts an active setup when Cancel closes the dialog", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/projects") {
        return Promise.resolve(
          jsonResponse({ projects: [{ id: "project-1", name: "Remote Dev" }] })
        );
      }
      if (url === "/api/claude-accounts/usage-setup-session") {
        return Promise.resolve(jsonResponse(setup, true, 201));
      }
      if (url === "/api/claude-accounts/usage-abort") {
        return Promise.resolve(jsonResponse({ cleanupComplete: true }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { onOpenChange } = renderDialog();
    await startSession();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/api/claude-accounts/usage-abort",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ sessionId: "usage-session-1" }),
        })
      );
    });
  });

  it("does not block closing when the best-effort abort request fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/projects") {
        return Promise.resolve(
          jsonResponse({ projects: [{ id: "project-1", name: "Remote Dev" }] })
        );
      }
      if (url === "/api/claude-accounts/usage-setup-session") {
        return Promise.resolve(jsonResponse(setup, true, 201));
      }
      if (url === "/api/claude-accounts/usage-abort") {
        return Promise.reject(new Error("abort unavailable"));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { onOpenChange } = renderDialog();
    await startSession();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "Failed to abort Claude usage setup",
        expect.any(Error)
      );
    });
    consoleError.mockRestore();
  });

  it("posts exactly the session id and keeps a not-ready session retryable", async () => {
    let captureCount = 0;
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/projects") {
        return Promise.resolve(jsonResponse({ projects: [{ id: "project-1", name: "Remote Dev" }] }));
      }
      if (url === "/api/claude-accounts/usage-setup-session") {
        return Promise.resolve(jsonResponse(setup, true, 201));
      }
      if (url === "/api/claude-accounts/usage-capture") {
        captureCount += 1;
        return Promise.resolve(
          captureCount === 1
            ? jsonResponse(
                {
                  code: "CREDENTIALS_NOT_READY",
                  error: "server detail",
                },
                false
              )
            : jsonResponse(captureSuccess())
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { onCompleted } = renderDialog();
    await startSession();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    expect(
      await screen.findByText(/finish the Claude sign-in.*try Finish again/i)
    ).toBeInTheDocument();
    expect(onCompleted).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenLastCalledWith(
      "/api/claude-accounts/usage-capture",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sessionId: "usage-session-1" }),
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1));
  });

  it.each([
    [
      "MISSING_SCOPE",
      /usage permission was not granted.*start a new Claude usage sign-in/i,
    ],
    [
      "ACCOUNT_MISMATCH",
      /different Claude account.*not attached/i,
    ],
  ])("maps %s to actionable account-safe text", async (code, message) => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/projects") {
        return Promise.resolve(jsonResponse({ projects: [{ id: "project-1", name: "Remote Dev" }] }));
      }
      if (url === "/api/claude-accounts/usage-setup-session") {
        return Promise.resolve(jsonResponse(setup, true, 201));
      }
      if (url === "/api/claude-accounts/usage-capture") {
        return Promise.resolve(
          jsonResponse({ code, error: "internal detail" }, false)
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    renderDialog();
    await startSession();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText("internal detail")).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Start usage sign-in" })
    ).toBeEnabled();
  });

  it("completes, refreshes, closes, and resets when capture is fully ready", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/projects") {
        return Promise.resolve(
          jsonResponse({ projects: [{ id: "project-1", name: "Remote Dev" }] })
        );
      }
      if (url === "/api/claude-accounts/usage-setup-session") {
        return Promise.resolve(jsonResponse(setup, true, 201));
      }
      if (url === "/api/claude-accounts/usage-capture") {
        return Promise.resolve(jsonResponse(captureSuccess()));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { onCompleted, onOpenChange } = renderDialog();
    await startSession();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => {
      expect(onCompleted).toHaveBeenCalledTimes(1);
      expect(refreshSessions).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(screen.queryByText("claude auth login")).not.toBeInTheDocument();
  });

  it.each([
    [
      "usage snapshot is unavailable",
      { usageValidated: false },
      /credentials were saved, but no usage reading is available yet/i,
    ],
    [
      "cleanup is incomplete",
      { cleanupComplete: false },
      /terminal or credential cleanup did not finish.*may remain.*restart/i,
    ],
    [
      "automatic polling is disabled",
      { pollEnabled: false },
      /automatic usage refresh is disabled.*RDV_CLAUDE_USAGE_POLL_ENABLED=true/i,
    ],
  ])(
    "keeps the completed result visible when %s",
    async (_caseName, overrides, message) => {
      apiFetch.mockImplementation((url: string) => {
        if (url === "/api/projects") {
          return Promise.resolve(
            jsonResponse({ projects: [{ id: "project-1", name: "Remote Dev" }] })
          );
        }
        if (url === "/api/claude-accounts/usage-setup-session") {
          return Promise.resolve(jsonResponse(setup, true, 201));
        }
        if (url === "/api/claude-accounts/usage-capture") {
          return Promise.resolve(jsonResponse(captureSuccess(overrides)));
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      const { onCompleted, onOpenChange } = renderDialog();
      await startSession();

      fireEvent.click(screen.getByRole("button", { name: "Finish" }));

      expect(await screen.findByRole("status")).toHaveTextContent(message);
      expect(onCompleted).toHaveBeenCalledTimes(1);
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(
        screen.queryByRole("button", { name: "Finish" })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Open terminal session" })
      ).not.toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Close" })[0]).toBeEnabled();
    }
  );

  it("shows every applicable completion warning without allowing duplicate capture", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/projects") {
        return Promise.resolve(
          jsonResponse({ projects: [{ id: "project-1", name: "Remote Dev" }] })
        );
      }
      if (url === "/api/claude-accounts/usage-setup-session") {
        return Promise.resolve(jsonResponse(setup, true, 201));
      }
      if (url === "/api/claude-accounts/usage-capture") {
        return Promise.resolve(
          jsonResponse(
            captureSuccess({
              usageValidated: false,
              cleanupComplete: false,
              pollEnabled: false,
            })
          )
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    renderDialog();
    await startSession();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/no usage reading is available yet/i);
    expect(status).toHaveTextContent(/cleanup did not finish/i);
    expect(status).toHaveTextContent(/automatic usage refresh is disabled/i);
    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(
      screen.queryByRole("button", { name: "Finish" })
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      "missing outcome fields",
      {
        account: { ...account, usageCredential: true },
        usageValidated: true,
      },
    ],
    [
      "invalid account projection",
      {
        account: {},
        usageValidated: true,
        cleanupComplete: true,
        pollEnabled: true,
      },
    ],
  ])(
    "treats a 200 with %s as completed without pretending status is known",
    async (_caseName, captureBody) => {
      apiFetch.mockImplementation((url: string) => {
        if (url === "/api/projects") {
          return Promise.resolve(
            jsonResponse({
              projects: [{ id: "project-1", name: "Remote Dev" }],
            })
          );
        }
        if (url === "/api/claude-accounts/usage-setup-session") {
          return Promise.resolve(jsonResponse(setup, true, 201));
        }
        if (url === "/api/claude-accounts/usage-capture") {
          return Promise.resolve(jsonResponse(captureBody));
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      const { onCompleted, onOpenChange } = renderDialog();
      await startSession();

      fireEvent.click(screen.getByRole("button", { name: "Finish" }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        /credentials were saved, but Remote Dev could not confirm validation, cleanup, or polling status/i
      );
      expect(onCompleted).toHaveBeenCalledTimes(1);
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(
        screen.queryByRole("button", { name: "Finish" })
      ).not.toBeInTheDocument();
    }
  );

  it("uses safe fallback copy for a non-JSON capture failure", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/projects") {
        return Promise.resolve(jsonResponse({ projects: [{ id: "project-1", name: "Remote Dev" }] }));
      }
      if (url === "/api/claude-accounts/usage-setup-session") {
        return Promise.resolve(jsonResponse(setup, true, 201));
      }
      if (url === "/api/claude-accounts/usage-capture") {
        return Promise.resolve(nonJsonResponse());
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    renderDialog();
    await startSession();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    expect(
      await screen.findByText("Could not finish usage tracking. Try again.")
    ).toBeInTheDocument();
  });

  it("surfaces a safe network failure while starting", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/projects") {
        return Promise.resolve(jsonResponse({ projects: [{ id: "project-1", name: "Remote Dev" }] }));
      }
      return Promise.reject(new Error("Network unavailable"));
    });
    renderDialog();

    fireEvent.click(await readyStartButton());

    expect(await screen.findByText("Network unavailable")).toBeInTheDocument();
  });

  it("explains the no-project state and does not offer setup", async () => {
    mockProjects([]);
    renderDialog();

    expect(
      await screen.findByText(/Create a project before starting usage sign-in/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start usage sign-in" })
    ).not.toBeInTheDocument();
  });

  it("recovers an open account-matched setup session instead of creating another", async () => {
    sessions = [
      {
        id: "existing-usage-session",
        status: "active",
        typeMetadata: {
          rdvClaudeUsageSetupSession: true,
          accountId: "account-1",
          scratchDir: "/server-only/scratch",
        },
      },
    ];
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/projects") {
        return Promise.resolve(jsonResponse({ projects: [{ id: "project-1", name: "Remote Dev" }] }));
      }
      if (url === "/api/claude-accounts/usage-capture") {
        return Promise.resolve(jsonResponse(captureSuccess()));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    renderDialog();

    expect(
      await screen.findByText(/existing usage sign-in session/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start usage sign-in" })
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("/server-only/scratch");

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/api/claude-accounts/usage-capture",
        expect.objectContaining({
          body: JSON.stringify({ sessionId: "existing-usage-session" }),
        })
      );
    });
    expect(apiFetch).not.toHaveBeenCalledWith(
      "/api/claude-accounts/usage-setup-session",
      expect.anything()
    );
  });
});
