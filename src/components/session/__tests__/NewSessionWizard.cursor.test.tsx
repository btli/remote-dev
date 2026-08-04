import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NewSessionWizard } from "@/components/session/NewSessionWizard";

vi.mock("@/contexts/ProfileContext", () => ({
  useProfileContext: () => ({
    profiles: [],
    getRecommendedProfile: vi.fn().mockResolvedValue({
      profileId: null,
      wasAutoSelected: false,
    }),
  }),
}));

vi.mock("@/contexts/TemplateContext", () => ({
  useTemplateContext: () => ({
    templates: [],
    recordUsage: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/contexts/ProjectTreeContext", () => ({
  useProjectTree: () => ({
    activeNode: { id: "project-1", type: "project" },
    projects: [
      {
        id: "project-1",
        name: "remote-dev",
        groupId: null,
        isAutoCreated: false,
        sortOrder: 0,
        collapsed: false,
      },
    ],
  }),
}));

vi.mock("@/components/session/ProjectPickerCombobox", () => ({
  ProjectPickerCombobox: ({ value }: { value: string | null }) => (
    <div data-testid="project-picker">{value ?? "none"}</div>
  ),
}));

afterEach(() => cleanup());

describe("NewSessionWizard Cursor quick start", () => {
  it("shows Cursor and creates an agent session with the agent CLI provider", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <NewSessionWizard
        open
        onClose={vi.fn()}
        onCreate={onCreate}
        isGitHubConnected={false}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "New Terminal Session" }),
    ).toHaveClass("max-h-[calc(100dvh-2rem)]", "overflow-hidden");
    expect(screen.getByTestId("new-session-scroll")).toHaveClass(
      "overflow-y-auto",
    );

    await user.click(screen.getByRole("button", { name: /Cursor Agent/i }));

    expect(
      screen.getByText("Configure your Cursor agent session"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Cursor")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Session Name"), "cursor-mobile");
    await waitFor(() =>
      expect(screen.getByTestId("project-picker")).toHaveTextContent(
        "project-1",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Create Session" }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "cursor-mobile",
          projectId: "project-1",
          terminalType: "agent",
          agentProvider: "cursor",
          autoLaunchAgent: true,
        }),
      ),
    );
  });

  it("does not carry a hidden Open Folder path into a Cursor session", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <NewSessionWizard
        open
        onClose={vi.fn()}
        onCreate={onCreate}
        isGitHubConnected={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open Folder/i }));
    await user.type(
      screen.getByPlaceholderText("/path/to/project"),
      "/tmp/stale-project",
    );
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: /Cursor Agent/i }));
    await user.type(screen.getByLabelText("Session Name"), "cursor-clean-cwd");
    await user.click(screen.getByRole("button", { name: "Create Session" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      terminalType: "agent",
      agentProvider: "cursor",
      projectPath: undefined,
    });
  });

  it("does not carry Cursor into the Feature session agent selection", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <NewSessionWizard
        open
        onClose={vi.fn()}
        onCreate={onCreate}
        isGitHubConnected={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Cursor Agent/i }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: /Feature Session/i }));
    await user.type(
      screen.getByPlaceholderText("Add user authentication"),
      "Keep the default feature agent",
    );
    await user.click(screen.getByRole("button", { name: "Review" }));
    await user.click(screen.getByRole("button", { name: "Create Session" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      terminalType: "agent",
      agentProvider: "claude",
    });
  });
});
