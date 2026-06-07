/**
 * ProjectTreeContext ↔ PreferencesContext cache-coherence (remote-dev-u84s).
 *
 * Regression coverage for the bug where a project created AFTER page load was
 * invisible to preference resolution: PreferencesContext loads its folders +
 * node-preferences maps once on mount and never refetched them, so
 * `resolvePreferencesForFolder(newProjectId)` fell through to the user default
 * working dir. The fix has every ProjectTree mutation also call the
 * preferences context's `refreshPreferences()`.
 *
 * These tests exercise the REAL providers (neither is auto-mocked in
 * tests/setup.ts) with a mocked `@/lib/api-fetch`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const apiFetchMock = vi.fn();
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  prefixApiPath: (input: string) => input,
}));

// Imported after the mock above is registered.
import {
  PreferencesProvider,
  usePreferencesContext,
} from "@/contexts/PreferencesContext";
import {
  ProjectTreeProvider,
  useProjectTree,
} from "@/contexts/ProjectTreeContext";

const NEW_PROJECT_ID = "proj-new";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

// The `/api/preferences` payload. Before the project is created the folders +
// folderPreferences maps do NOT contain it; after creation they do. A counter
// flips the payload so we can prove the second fetch carries the new project.
let preferencesFetchCount = 0;

function preferencesPayload(includeNewProject: boolean) {
  return {
    userSettings: {
      defaultWorkingDirectory: "/home/user", // user-level fallback
      activeNodeId: null,
      pinnedNodeId: null,
    },
    // Serialized under `folderPreferences` for back-compat (keyed by folderId).
    folderPreferences: includeNewProject
      ? [
          {
            folderId: NEW_PROJECT_ID,
            defaultWorkingDirectory: "/projects/freshly-created",
          },
        ]
      : [],
    folders: includeNewProject
      ? [{ id: NEW_PROJECT_ID, parentId: null, name: "Freshly Created" }]
      : [],
    activeFolder: null,
  };
}

function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : String(input);
  const method = (init?.method ?? "GET").toUpperCase();

  if (url.includes("/api/preferences") && method === "GET") {
    preferencesFetchCount += 1;
    // First load (mount): project absent. Any later load: present.
    return Promise.resolve(
      jsonResponse(preferencesPayload(preferencesFetchCount > 1))
    );
  }
  if (url.includes("/api/groups") && method === "GET") {
    return Promise.resolve(jsonResponse({ groups: [] }));
  }
  if (url.includes("/api/projects") && method === "POST") {
    return Promise.resolve(
      jsonResponse({
        project: {
          id: NEW_PROJECT_ID,
          name: "Freshly Created",
          groupId: null,
          isAutoCreated: false,
          sortOrder: 0,
          collapsed: false,
        },
      })
    );
  }
  if (url.includes("/api/projects") && method === "GET") {
    return Promise.resolve(jsonResponse({ projects: [] }));
  }
  // active-node POST etc.
  return Promise.resolve(jsonResponse({ ok: true }));
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <PreferencesProvider>
      <ProjectTreeProvider>{children}</ProjectTreeProvider>
    </PreferencesProvider>
  );
}

function useBoth() {
  return {
    tree: useProjectTree(),
    prefs: usePreferencesContext(),
  };
}

function countPreferencesGets(): number {
  return apiFetchMock.mock.calls.filter(([u, init]) => {
    const url = typeof u === "string" ? u : String(u);
    const method = (init?.method ?? "GET").toUpperCase();
    return url.includes("/api/preferences") && method === "GET";
  }).length;
}

describe("ProjectTreeContext refreshes the preferences cache on mutation (remote-dev-u84s)", () => {
  beforeEach(() => {
    preferencesFetchCount = 0;
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(routeFetch);
  });

  it("createProject refetches /api/preferences so the new project resolves its working dir", async () => {
    const { result } = renderHook(useBoth, { wrapper });

    // Wait for the initial mount loads to settle.
    await waitFor(() => expect(result.current.prefs.loading).toBe(false));

    // Before creation: the project is unknown, so resolution falls back to the
    // user-level default working dir (this is the bug's symptom).
    expect(
      result.current.prefs.resolvePreferencesForFolder(NEW_PROJECT_ID)
        .defaultWorkingDirectory
    ).toBe("/home/user");

    const preferencesGetsBefore = countPreferencesGets();

    // Create the project — this should trigger a preferences refetch.
    await act(async () => {
      await result.current.tree.createProject({ groupId: null, name: "Freshly Created" });
    });

    // A second GET /api/preferences happened (the cache was refreshed).
    await waitFor(() => {
      expect(countPreferencesGets()).toBeGreaterThan(preferencesGetsBefore);
    });

    // And now resolution picks up the freshly-created project's working dir.
    await waitFor(() => {
      expect(
        result.current.prefs.resolvePreferencesForFolder(NEW_PROJECT_ID)
          .defaultWorkingDirectory
      ).toBe("/projects/freshly-created");
    });
  });
});
