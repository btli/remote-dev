import { describe, it, expect, vi, beforeEach, expectTypeOf } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import React from "react";
import {
  ProjectTreeProvider,
  useProjectTree,
  type ProjectTreeContextValue,
} from "@/contexts/ProjectTreeContext";

describe("ProjectTreeContext accepts sortOrder", () => {
  it("updateGroup signature accepts sortOrder", () => {
    expectTypeOf<ProjectTreeContextValue["updateGroup"]>()
      .parameter(0)
      .toHaveProperty("sortOrder");
  });

  it("updateProject signature accepts sortOrder", () => {
    expectTypeOf<ProjectTreeContextValue["updateProject"]>()
      .parameter(0)
      .toHaveProperty("sortOrder");
  });

  describe("runtime: sortOrder reaches the PATCH body", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          if (url === "/api/groups" && (!init || init.method === undefined)) {
            return new Response(JSON.stringify({ groups: [] }), { status: 200 });
          }
          if (url === "/api/projects" && (!init || init.method === undefined)) {
            return new Response(JSON.stringify({ projects: [] }), { status: 200 });
          }
          return new Response(JSON.stringify({}), { status: 200 });
        }),
      );
    });

    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(ProjectTreeProvider, null, children);

    it("PATCH /api/groups/:id body includes sortOrder", async () => {
      const { result } = renderHook(() => useProjectTree(), { wrapper });
      await act(async () => {
        await result.current.updateGroup({ id: "g1", sortOrder: 2 });
      });

      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const patchCall = calls.find(
        ([u, init]) => u === "/api/groups/g1" && (init as RequestInit)?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body.sortOrder).toBe(2);
    });

    it("PATCH /api/projects/:id body includes sortOrder", async () => {
      const { result } = renderHook(() => useProjectTree(), { wrapper });
      await act(async () => {
        await result.current.updateProject({ id: "p1", sortOrder: 3 });
      });

      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const patchCall = calls.find(
        ([u, init]) => u === "/api/projects/p1" && (init as RequestInit)?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body.sortOrder).toBe(3);
    });
  });
});
