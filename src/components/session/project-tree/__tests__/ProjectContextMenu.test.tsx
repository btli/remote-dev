// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import {
  ProjectContextMenu,
  ProjectContextMenuContent,
} from "../ProjectContextMenu";

describe("ProjectContextMenu", () => {
  it("exposes agent launch via the Pick Agent stand-in and Configure agents", () => {
    const onNewAgentWithProvider = vi.fn();
    const onOpenAgentSettings = vi.fn();

    render(
      <ProjectContextMenuContent
        project={{
          id: "project-1",
          name: "Remote Dev",
          groupId: null,
          isAutoCreated: false,
          sortOrder: 0,
          collapsed: false,
        }}
        hasCustomPrefs={false}
        hasActiveSecrets={false}
        hasLinkedRepo={false}
        hasWorkingDirectory
        onNewTerminal={vi.fn()}
        onNewAgent={vi.fn()}
        onNewAgentWithProvider={onNewAgentWithProvider}
        onOpenAgentSettings={onOpenAgentSettings}
        onNewSshSession={vi.fn()}
        onOpenSshSettings={vi.fn()}
        onResume={vi.fn()}
        onAdvanced={vi.fn()}
        onNewWorktree={vi.fn()}
        onOpenPreferences={vi.fn()}
        onOpenSecrets={vi.fn()}
        onOpenRepository={vi.fn()}
        onOpenFolderInOS={vi.fn()}
        onStartEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    // The dedicated "New Cursor Agent" shortcut is gone; agent launch goes
    // through the generic provider picker instead.
    expect(screen.queryByTestId("project-new-agent-cursor")).toBeNull();
    expect(screen.queryByText("New Cursor Agent")).toBeNull();

    fireEvent.click(screen.getByTestId("project-new-agent-claude"));
    expect(onNewAgentWithProvider).toHaveBeenCalledOnce();
    expect(onNewAgentWithProvider).toHaveBeenCalledWith("claude");

    fireEvent.click(screen.getByTestId("project-configure-agents"));
    expect(onOpenAgentSettings).toHaveBeenCalledOnce();
  });
});

describe("ProjectContextMenu (real radix component)", () => {
  it("drops the 'New Cursor Agent' shortcut and keeps the 'Pick Agent' submenu trigger", async () => {
    // Both submenus (Pick Agent, SSH) lazily fetch on first mount.
    apiFetch.mockImplementation(async (url: string) => {
      const body = url.includes("ssh-connections")
        ? { connections: [] }
        : { statuses: [] };
      return { ok: true, json: async () => body } as unknown as Response;
    });

    render(
      <ProjectContextMenu
        project={{
          id: "project-1",
          name: "Remote Dev",
          groupId: null,
          isAutoCreated: false,
          sortOrder: 0,
          collapsed: false,
        }}
        hasCustomPrefs={false}
        hasActiveSecrets={false}
        hasLinkedRepo={false}
        hasWorkingDirectory
        onNewTerminal={vi.fn()}
        onNewAgent={vi.fn()}
        onNewAgentWithProvider={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onNewSshSession={vi.fn()}
        onOpenSshSettings={vi.fn()}
        onResume={vi.fn()}
        onAdvanced={vi.fn()}
        onNewWorktree={vi.fn()}
        onOpenPreferences={vi.fn()}
        onOpenSecrets={vi.fn()}
        onOpenRepository={vi.fn()}
        onOpenFolderInOS={vi.fn()}
        onStartEdit={vi.fn()}
        onDelete={vi.fn()}
      >
        <button>project trigger</button>
      </ProjectContextMenu>,
    );

    // Open the real radix ContextMenu via a right-click on the trigger.
    fireEvent.contextMenu(screen.getByText("project trigger"));

    // The dedicated "New Cursor Agent" shortcut is gone from the real menu…
    expect(screen.queryByText("New Cursor Agent")).toBeNull();
    // …and agent launch goes through the "Pick Agent" submenu trigger.
    expect(await screen.findByText("Pick Agent")).toBeInTheDocument();
  });
});
