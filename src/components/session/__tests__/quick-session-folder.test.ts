/**
 * Tests for the quick-session folder resolver (remote-dev-bxcn) — the pure
 * decision behind `SessionManager`'s `resolveQuickSessionFolderId`, which makes
 * one-click "Quick Terminal" / "New Agent" work on a brand-new instance where
 * the user has logged in but not yet selected a project.
 */
import { describe, it, expect } from "vitest";
import { resolveQuickSessionFolder } from "@/components/session/quick-session-folder";

describe("resolveQuickSessionFolder", () => {
  it("uses the active project unchanged when one is active (no selection change)", () => {
    const result = resolveQuickSessionFolder({
      activeFolderId: "proj-active",
      projects: [{ id: "proj-first" }, { id: "proj-active" }],
    });
    expect(result.folderId).toBe("proj-active");
    // A project is already active — selection must NOT change.
    expect(result.selectFolderId).toBeNull();
  });

  it("falls back to AND selects the first project when none is active", () => {
    // The first-run trap: zero active project but projects exist.
    const result = resolveQuickSessionFolder({
      activeFolderId: null,
      projects: [{ id: "proj-first" }, { id: "proj-second" }],
    });
    expect(result.folderId).toBe("proj-first");
    // The caller should select the fallback so prefs/highlight follow.
    expect(result.selectFolderId).toBe("proj-first");
  });

  it("treats undefined active id the same as null (falls back to first)", () => {
    const result = resolveQuickSessionFolder({
      activeFolderId: undefined,
      projects: [{ id: "only-project" }],
    });
    expect(result.folderId).toBe("only-project");
    expect(result.selectFolderId).toBe("only-project");
  });

  it("resolves to nothing (no crash, no invented project) when there are zero projects", () => {
    const result = resolveQuickSessionFolder({
      activeFolderId: null,
      projects: [],
    });
    // Downstream guard handles the empty case; we never fabricate an id.
    expect(result.folderId).toBeUndefined();
    expect(result.selectFolderId).toBeNull();
  });

  it("does not fall back when a project is active even if it's not in the list", () => {
    // An active id that isn't in `projects` (e.g. mid-refresh) is still honored;
    // we never override an explicit active selection.
    const result = resolveQuickSessionFolder({
      activeFolderId: "proj-active",
      projects: [{ id: "proj-other" }],
    });
    expect(result.folderId).toBe("proj-active");
    expect(result.selectFolderId).toBeNull();
  });
});
