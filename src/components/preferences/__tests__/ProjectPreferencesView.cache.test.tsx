/**
 * ProjectPreferencesView ↔ PreferencesContext cache update (remote-dev-u84s).
 *
 * The prefs pane used to PUT /api/node-preferences/project/:id directly,
 * bypassing the shared nodePreferences cache. So saving a project's working
 * dir did not become visible to new sessions until a page reload. The fix
 * routes save/reset through the context's updateFolderPreferences /
 * deleteFolderPreferences, which optimistically merge the local cache.
 *
 * This test renders the real view inside the real PreferencesProvider (with a
 * mocked api-fetch) plus a sibling that reads the context, and asserts that a
 * Save makes the project's working dir resolvable from the context.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const apiFetchMock = vi.fn();
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  prefixApiPath: (input: string) => input,
}));

import {
  PreferencesProvider,
  usePreferencesContext,
} from "@/contexts/PreferencesContext";
import { ProfileProvider } from "@/contexts/ProfileContext";
import { ProjectPreferencesView } from "@/components/preferences/ProjectPreferencesView";

const PROJECT_ID = "proj-prefs";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : String(input);
  const method = (init?.method ?? "GET").toUpperCase();

  // PreferencesProvider mount fetch — start with no project prefs known.
  if (url.includes("/api/preferences") && method === "GET") {
    return Promise.resolve(
      jsonResponse({
        userSettings: { defaultWorkingDirectory: "/home/user", activeNodeId: null, pinnedNodeId: null },
        folderPreferences: [],
        folders: [{ id: PROJECT_ID, parentId: null, name: "Proj" }],
        activeFolder: null,
      })
    );
  }
  // The view's own GET load of the project's current prefs.
  if (url.includes(`/api/node-preferences/project/${PROJECT_ID}`) && method === "GET") {
    return Promise.resolve(
      jsonResponse({
        preferences: { defaultWorkingDirectory: "/projects/saved-here" },
      })
    );
  }
  // The PUT issued by updateFolderPreferences.
  if (url.includes(`/api/node-preferences/project/${PROJECT_ID}`) && method === "PUT") {
    return Promise.resolve(jsonResponse({ ok: true }));
  }
  // ProfileProvider mount fetches (the embedded PoolAssignmentPanel needs it).
  if (url.includes("/api/profiles") && method === "GET") {
    return Promise.resolve(jsonResponse({ profiles: [], folderLinks: [] }));
  }
  if (url.includes("/api/claude-pools") && method === "GET") {
    return Promise.resolve(jsonResponse({ pools: [] }));
  }
  return Promise.resolve(jsonResponse({ ok: true }));
}

// Sibling that surfaces the context's resolved working dir for the project so
// the test can assert the optimistic cache merge happened.
function ResolvedProbe() {
  const { resolvePreferencesForFolder } = usePreferencesContext();
  return (
    <div data-testid="resolved-cwd">
      {resolvePreferencesForFolder(PROJECT_ID).defaultWorkingDirectory}
    </div>
  );
}

describe("ProjectPreferencesView save updates the preferences cache (remote-dev-u84s)", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(routeFetch);
  });

  it("Save routes through the context so the project's working dir resolves without reload", async () => {
    render(
      <PreferencesProvider>
        <ProfileProvider>
          <ResolvedProbe />
          <ProjectPreferencesView projectId={PROJECT_ID} />
        </ProfileProvider>
      </PreferencesProvider>
    );

    // Wait for the view to finish loading (Save button enabled).
    const saveButton = await screen.findByRole("button", { name: /save/i });
    await waitFor(() => expect(saveButton).not.toBeDisabled());

    // Before save: the context has no prefs for this project → user fallback.
    expect(screen.getByTestId("resolved-cwd").textContent).toBe("/home/user");

    fireEvent.click(saveButton);

    // The PUT fired and the optimistic merge made the project's working dir
    // (loaded into the view's form state) resolvable from the context.
    await waitFor(() => {
      const putCalls = apiFetchMock.mock.calls.filter(([u, init]) => {
        const url = typeof u === "string" ? u : String(u);
        return url.includes(`/api/node-preferences/project/${PROJECT_ID}`) &&
          (init?.method ?? "GET").toUpperCase() === "PUT";
      });
      expect(putCalls.length).toBe(1);
    });

    await waitFor(() => {
      expect(screen.getByTestId("resolved-cwd").textContent).toBe("/projects/saved-here");
    });
  });
});
