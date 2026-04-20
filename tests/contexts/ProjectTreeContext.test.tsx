import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { ProjectTreeProvider, useProjectTree } from "@/contexts/ProjectTreeContext";

describe("ProjectTreeContext", () => {
  beforeEach(() => {
    global.fetch = vi.fn((url) => {
      if (String(url).includes("/api/groups")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ groups: [{ id: "g1", name: "Root", parentGroupId: null }] }),
        }) as any;
      }
      if (String(url).includes("/api/projects")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ projects: [{ id: "p1", name: "App", groupId: "g1" }] }),
        }) as any;
      }
      return Promise.resolve({ ok: false, status: 404 }) as any;
    });
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
