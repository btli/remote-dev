import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { ProjectTreeProvider, useProjectTree } from "@/contexts/ProjectTreeContext";

describe("ProjectTreeContext", () => {
  beforeEach(() => {
    const makeResponse = (body: unknown, ok = true, status = 200) =>
      Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);
    global.fetch = vi.fn((url: string | URL | Request) => {
      if (String(url).includes("/api/groups")) {
        return makeResponse({ groups: [{ id: "g1", name: "Root", parentGroupId: null }] });
      }
      if (String(url).includes("/api/projects")) {
        return makeResponse({ projects: [{ id: "p1", name: "App", groupId: "g1" }] });
      }
      return makeResponse({}, false, 404);
    }) as unknown as typeof fetch;
  });

  it("loads groups and projects and exposes a unified tree", async () => {
    const { result } = renderHook(() => useProjectTree(), {
      wrapper: ({ children }) => <ProjectTreeProvider>{children}</ProjectTreeProvider>,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.getGroup("g1")?.name).toBe("Root");
    expect(result.current.getProject("p1")?.groupId).toBe("g1");
  });
});
