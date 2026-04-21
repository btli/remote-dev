import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useTreeDragDrop,
  type UseTreeDragDropInput,
} from "@/components/session/project-tree/useTreeDragDrop";

function setup(overrides: Partial<UseTreeDragDropInput> = {}) {
  const collectDescendantGroupIds =
    overrides.collectDescendantGroupIds ??
    vi.fn((rootId: string) => new Set<string>([rootId]));
  const input: UseTreeDragDropInput = {
    collectDescendantGroupIds,
  };
  const rendered = renderHook(() => useTreeDragDrop(input));
  return { ...rendered, collectDescendantGroupIds };
}

const RECT = { top: 0, height: 40 };

describe("useTreeDragDrop", () => {
  it("has null drag and indicator initially", () => {
    const { result } = setup();
    expect(result.current.drag).toBeNull();
    expect(result.current.indicator).toBeNull();
  });

  it("startDrag sets drag state and clears indicator", () => {
    const { result } = setup();
    act(() => {
      result.current.startDrag("session", "s1", "p1");
    });
    expect(result.current.drag).toEqual({
      type: "session",
      id: "s1",
      sourceParentId: "p1",
    });
    expect(result.current.indicator).toBeNull();
  });

  it("dragOver with no drag produces null indicator", () => {
    const { result } = setup();
    act(() => {
      result.current.dragOver("session", "s1", 10, RECT);
    });
    expect(result.current.indicator).toBeNull();
  });

  describe("session drag", () => {
    it("session over another session in same project -> before (top band)", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("session", "s1", "p1");
      });
      act(() => {
        result.current.dragOver("session", "s2", 5, RECT, {
          targetParentId: "p1",
          draggedPinned: false,
          targetPinned: false,
        });
      });
      expect(result.current.indicator).toEqual({
        position: "before",
        targetId: "s2",
        targetType: "session",
      });
    });

    it("session over another session in same project -> after (bottom band)", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("session", "s1", "p1");
      });
      act(() => {
        result.current.dragOver("session", "s2", 35, RECT, {
          targetParentId: "p1",
          draggedPinned: false,
          targetPinned: false,
        });
      });
      expect(result.current.indicator).toEqual({
        position: "after",
        targetId: "s2",
        targetType: "session",
      });
    });

    it("session over another session in same project -> after (middle band collapses to after)", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("session", "s1", "p1");
      });
      act(() => {
        result.current.dragOver("session", "s2", 20, RECT, {
          targetParentId: "p1",
          draggedPinned: false,
          targetPinned: false,
        });
      });
      expect(result.current.indicator).toEqual({
        position: "after",
        targetId: "s2",
        targetType: "session",
      });
    });

    it("session onto itself -> null indicator", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("session", "s1", "p1");
      });
      act(() => {
        result.current.dragOver("session", "s1", 5, RECT, {
          targetParentId: "p1",
          draggedPinned: false,
          targetPinned: false,
        });
      });
      expect(result.current.indicator).toBeNull();
    });

    it("session over session in different project -> null indicator", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("session", "s1", "p1");
      });
      act(() => {
        result.current.dragOver("session", "s2", 5, RECT, {
          targetParentId: "p2",
          draggedPinned: false,
          targetPinned: false,
        });
      });
      expect(result.current.indicator).toBeNull();
    });

    it("session across pin partition -> null indicator", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("session", "s1", "p1");
      });
      act(() => {
        result.current.dragOver("session", "s2", 5, RECT, {
          targetParentId: "p1",
          draggedPinned: true,
          targetPinned: false,
        });
      });
      expect(result.current.indicator).toBeNull();
    });

    it("session onto project row -> nest indicator on project", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("session", "s1", "p1");
      });
      act(() => {
        result.current.dragOver("project", "p2", 20, RECT);
      });
      expect(result.current.indicator).toEqual({
        position: "nest",
        targetId: "p2",
        targetType: "project",
      });
    });

    it("session onto group -> null indicator", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("session", "s1", "p1");
      });
      act(() => {
        result.current.dragOver("group", "g1", 20, RECT);
      });
      expect(result.current.indicator).toBeNull();
    });
  });

  describe("project drag", () => {
    it("project over project in same group -> before (top band)", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("project", "pA", "gX");
      });
      act(() => {
        result.current.dragOver("project", "pB", 5, RECT, {
          targetParentId: "gX",
        });
      });
      expect(result.current.indicator).toEqual({
        position: "before",
        targetId: "pB",
        targetType: "project",
      });
    });

    it("project over project in same group -> after (bottom band)", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("project", "pA", "gX");
      });
      act(() => {
        result.current.dragOver("project", "pB", 35, RECT, {
          targetParentId: "gX",
        });
      });
      expect(result.current.indicator).toEqual({
        position: "after",
        targetId: "pB",
        targetType: "project",
      });
    });

    it("project over project in same group -> middle band is null", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("project", "pA", "gX");
      });
      act(() => {
        result.current.dragOver("project", "pB", 20, RECT, {
          targetParentId: "gX",
        });
      });
      expect(result.current.indicator).toBeNull();
    });

    it("project onto itself -> null indicator", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("project", "pA", "gX");
      });
      act(() => {
        result.current.dragOver("project", "pA", 5, RECT, {
          targetParentId: "gX",
        });
      });
      expect(result.current.indicator).toBeNull();
    });

    it("project across groups -> null indicator on project row", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("project", "pA", "gX");
      });
      act(() => {
        result.current.dragOver("project", "pB", 5, RECT, {
          targetParentId: "gY",
        });
      });
      expect(result.current.indicator).toBeNull();
    });

    it("project onto group -> nest indicator on group", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("project", "pA", "gX");
      });
      act(() => {
        result.current.dragOver("group", "gY", 20, RECT);
      });
      expect(result.current.indicator).toEqual({
        position: "nest",
        targetId: "gY",
        targetType: "group",
      });
    });

    it("project onto session -> null indicator", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("project", "pA", "gX");
      });
      act(() => {
        result.current.dragOver("session", "s1", 20, RECT);
      });
      expect(result.current.indicator).toBeNull();
    });
  });

  describe("group drag", () => {
    it("group over sibling group -> before (top band)", () => {
      const { result, collectDescendantGroupIds } = setup({
        collectDescendantGroupIds: vi.fn(() => new Set<string>(["gA"])),
      });
      act(() => {
        result.current.startDrag("group", "gA", null);
      });
      act(() => {
        result.current.dragOver("group", "gB", 5, RECT, {
          targetParentId: null,
        });
      });
      expect(result.current.indicator).toEqual({
        position: "before",
        targetId: "gB",
        targetType: "group",
      });
      expect(collectDescendantGroupIds).toHaveBeenCalledWith("gA");
    });

    it("group over sibling group -> after (bottom band)", () => {
      const { result } = setup({
        collectDescendantGroupIds: vi.fn(() => new Set<string>(["gA"])),
      });
      act(() => {
        result.current.startDrag("group", "gA", null);
      });
      act(() => {
        result.current.dragOver("group", "gB", 35, RECT, {
          targetParentId: null,
        });
      });
      expect(result.current.indicator).toEqual({
        position: "after",
        targetId: "gB",
        targetType: "group",
      });
    });

    it("group over sibling group -> nest (middle band)", () => {
      const { result } = setup({
        collectDescendantGroupIds: vi.fn(() => new Set<string>(["gA"])),
      });
      act(() => {
        result.current.startDrag("group", "gA", null);
      });
      act(() => {
        result.current.dragOver("group", "gB", 20, RECT, {
          targetParentId: null,
        });
      });
      expect(result.current.indicator).toEqual({
        position: "nest",
        targetId: "gB",
        targetType: "group",
      });
    });

    it("group onto itself -> null indicator", () => {
      const { result } = setup({
        collectDescendantGroupIds: vi.fn(() => new Set<string>(["gA"])),
      });
      act(() => {
        result.current.startDrag("group", "gA", null);
      });
      act(() => {
        result.current.dragOver("group", "gA", 5, RECT, {
          targetParentId: null,
        });
      });
      expect(result.current.indicator).toBeNull();
    });

    it("group cycle is blocked when target is descendant", () => {
      const { result } = setup({
        collectDescendantGroupIds: vi.fn(
          () => new Set<string>(["gA", "gC", "gD"]),
        ),
      });
      act(() => {
        result.current.startDrag("group", "gA", null);
      });
      act(() => {
        result.current.dragOver("group", "gC", 20, RECT, {
          targetParentId: null,
        });
      });
      expect(result.current.indicator).toBeNull();
    });

    it("group into non-sibling group -> only nest (middle) valid", () => {
      const { result } = setup({
        collectDescendantGroupIds: vi.fn(() => new Set<string>(["gA"])),
      });
      act(() => {
        result.current.startDrag("group", "gA", null);
      });
      // top band
      act(() => {
        result.current.dragOver("group", "gB", 5, RECT, {
          targetParentId: "gX",
        });
      });
      expect(result.current.indicator).toBeNull();
      // bottom band
      act(() => {
        result.current.dragOver("group", "gB", 35, RECT, {
          targetParentId: "gX",
        });
      });
      expect(result.current.indicator).toBeNull();
      // middle band
      act(() => {
        result.current.dragOver("group", "gB", 20, RECT, {
          targetParentId: "gX",
        });
      });
      expect(result.current.indicator).toEqual({
        position: "nest",
        targetId: "gB",
        targetType: "group",
      });
    });

    it("group onto project or session -> null indicator", () => {
      const { result } = setup({
        collectDescendantGroupIds: vi.fn(() => new Set<string>(["gA"])),
      });
      act(() => {
        result.current.startDrag("group", "gA", null);
      });
      act(() => {
        result.current.dragOver("project", "pA", 20, RECT);
      });
      expect(result.current.indicator).toBeNull();
      act(() => {
        result.current.dragOver("session", "s1", 20, RECT);
      });
      expect(result.current.indicator).toBeNull();
    });
  });

  describe("drop / cancel / dragLeave", () => {
    it("drop returns snapshot of {drag, indicator} and clears state", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("session", "s1", "p1");
      });
      act(() => {
        result.current.dragOver("session", "s2", 5, RECT, {
          targetParentId: "p1",
          draggedPinned: false,
          targetPinned: false,
        });
      });

      let snap: ReturnType<typeof result.current.drop> = null;
      act(() => {
        snap = result.current.drop("session", "s2");
      });
      expect(snap).toEqual({
        drag: { type: "session", id: "s1", sourceParentId: "p1" },
        indicator: {
          position: "before",
          targetId: "s2",
          targetType: "session",
        },
      });
      expect(result.current.drag).toBeNull();
      expect(result.current.indicator).toBeNull();
    });

    it("drop returns null when no indicator and still clears state", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("session", "s1", "p1");
      });

      let snap: ReturnType<typeof result.current.drop> = null;
      act(() => {
        snap = result.current.drop("session", "s2");
      });
      expect(snap).toBeNull();
      expect(result.current.drag).toBeNull();
      expect(result.current.indicator).toBeNull();
    });

    it("drop returns null when no drag in progress", () => {
      const { result } = setup();
      let snap: ReturnType<typeof result.current.drop> = null;
      act(() => {
        snap = result.current.drop("session", "s2");
      });
      expect(snap).toBeNull();
    });

    it("dragLeave clears indicator but keeps drag state", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("session", "s1", "p1");
      });
      act(() => {
        result.current.dragOver("session", "s2", 5, RECT, {
          targetParentId: "p1",
          draggedPinned: false,
          targetPinned: false,
        });
      });
      expect(result.current.indicator).not.toBeNull();

      act(() => {
        result.current.dragLeave();
      });
      expect(result.current.indicator).toBeNull();
      expect(result.current.drag).not.toBeNull();
    });

    it("cancel clears both drag and indicator", () => {
      const { result } = setup();
      act(() => {
        result.current.startDrag("session", "s1", "p1");
      });
      act(() => {
        result.current.dragOver("session", "s2", 5, RECT, {
          targetParentId: "p1",
          draggedPinned: false,
          targetPinned: false,
        });
      });

      act(() => {
        result.current.cancel();
      });
      expect(result.current.drag).toBeNull();
      expect(result.current.indicator).toBeNull();
    });
  });
});
