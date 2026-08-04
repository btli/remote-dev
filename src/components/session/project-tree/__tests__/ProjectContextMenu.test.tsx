// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectContextMenu } from "../ProjectContextMenu";

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ statuses: [] }),
  })),
}));

describe("ProjectContextMenu", () => {
  it("offers a visible Cursor launch action when the project is right-clicked", async () => {
    const onNewAgentWithProvider = vi.fn();

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
        onNewAgentWithProvider={onNewAgentWithProvider}
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
        <button type="button">Remote Dev</button>
      </ProjectContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Remote Dev" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "New Cursor Agent" }),
    );

    expect(onNewAgentWithProvider).toHaveBeenCalledOnce();
    expect(onNewAgentWithProvider).toHaveBeenCalledWith("cursor");
  });
});
