import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  PreferencesProvider,
  usePreferencesContext,
} from "@/contexts/PreferencesContext";

/**
 * Verifies the node-keyed accessors on PreferencesContext correctly wrap the
 * underlying folder-keyed map (remote-dev-oqol.4.1 / remote-dev-w1ed Stage 1).
 * Since the backend `node_preferences` table keys by `(ownerId, ownerType)`
 * and `ownerId` for a project IS the project's UUID, the accessors take an
 * owner discriminator for API symmetry but otherwise behave as before.
 */

function mockPreferencesFetch(
  folderPreferences: Array<{ folderId: string } & Record<string, unknown>>,
  folders: Array<{ id: string; parentId: string | null; name: string }> = [],
) {
  global.fetch = vi.fn((url: string | URL | Request) => {
    if (String(url).includes("/api/preferences")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            userSettings: {
              userId: "u1",
              activeFolderId: null,
              pinnedFolderId: null,
              activeNodeId: null,
              activeNodeType: null,
              pinnedNodeId: null,
              pinnedNodeType: null,
            },
            folderPreferences,
            folders,
            activeFolder: null,
          }),
      } as Response);
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    } as Response);
  }) as unknown as typeof fetch;
}

describe("PreferencesContext node-keyed accessors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getNodePreferences returns the preferences for a project id", async () => {
    mockPreferencesFetch([
      { folderId: "proj-1", defaultWorkingDirectory: "/repos/app" },
    ]);

    const { result } = renderHook(() => usePreferencesContext(), {
      wrapper: ({ children }) => (
        <PreferencesProvider>{children}</PreferencesProvider>
      ),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const nodeView = result.current.getNodePreferences("project", "proj-1");
    expect(nodeView).not.toBeNull();
    expect(nodeView?.defaultWorkingDirectory).toBe("/repos/app");
  });

  it("hasNodePreferences reflects presence", async () => {
    mockPreferencesFetch([{ folderId: "proj-1" }]);

    const { result } = renderHook(() => usePreferencesContext(), {
      wrapper: ({ children }) => (
        <PreferencesProvider>{children}</PreferencesProvider>
      ),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasNodePreferences("project", "proj-1")).toBe(true);
    expect(result.current.hasNodePreferences("project", "proj-missing")).toBe(
      false,
    );
    expect(result.current.hasNodePreferences("group", "proj-1")).toBe(true); // ownerType ignored; id alone uniquely identifies
  });

  it("nodeHasRepo walks the ancestry chain", async () => {
    mockPreferencesFetch(
      [
        { folderId: "parent", githubRepoId: "repo-123" },
        { folderId: "child" },
      ],
      [
        { id: "parent", parentId: null, name: "Parent" },
        { id: "child", parentId: "parent", name: "Child" },
      ],
    );

    const { result } = renderHook(() => usePreferencesContext(), {
      wrapper: ({ children }) => (
        <PreferencesProvider>{children}</PreferencesProvider>
      ),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Child inherits from parent via ancestry chain
    expect(result.current.nodeHasRepo("project", "child")).toBe(true);
    expect(result.current.nodeHasRepo("project", "parent")).toBe(true);
    expect(result.current.nodeHasRepo("project", "orphan")).toBe(false);
  });
});
