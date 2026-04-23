// @vitest-environment node
/**
 * F5 — Deep-link patch-after-reuse for the Settings singleton tab.
 *
 * When `openSettingsSession(section)` is called and the server reuses an
 * existing Settings tab (scope-key dedup), the seeded `typeMetadata.activeTab`
 * is ignored. `SessionManager` must therefore issue a follow-up
 * `updateSession({ typeMetadataPatch: { activeTab: section } })` when the
 * stored tab does NOT match the requested section.
 *
 * The decision logic is extracted into `shouldPatchSettingsTab` so it can be
 * exercised without rendering `SessionManager` (which depends on ~10
 * contexts). This test covers both the helper in isolation AND the
 * end-to-end flow against a mocked SessionContext surface.
 */
import { describe, it, expect, vi } from "vitest";
import { shouldPatchSettingsTab } from "../settings-deep-link";
import type { TerminalSession } from "@/types/session";

function makeSession(activeTab: string | null | undefined): TerminalSession {
  return {
    typeMetadata: activeTab === undefined ? null : { activeTab },
  } as unknown as TerminalSession;
}

describe("shouldPatchSettingsTab (F5 helper)", () => {
  it("returns false when no section requested (bare /settings open)", () => {
    expect(shouldPatchSettingsTab(makeSession("logs"), undefined)).toBe(false);
    expect(shouldPatchSettingsTab(makeSession(null), undefined)).toBe(false);
  });

  it("returns true when stored tab is missing and a section is requested", () => {
    // New session: typeMetadata.activeTab was not seeded (dedup reuse case
    // on an older row).
    expect(shouldPatchSettingsTab(makeSession(undefined), "logs")).toBe(true);
    expect(shouldPatchSettingsTab(makeSession(null), "logs")).toBe(true);
  });

  it("returns true when stored tab differs from requested section", () => {
    expect(shouldPatchSettingsTab(makeSession("general"), "logs")).toBe(true);
  });

  it("returns false when stored tab already matches — avoids redundant PATCH", () => {
    expect(shouldPatchSettingsTab(makeSession("logs"), "logs")).toBe(false);
  });
});

describe("openSettingsSession — patch-after-reuse integration (F5)", () => {
  /**
   * Mirrors the `SessionManager.openSettingsSession` body, driving the
   * helper against a mocked create/update pair. This locks in the
   * interaction sequence: create first (dedup may reuse), then patch iff
   * the helper says so.
   */
  async function openSettingsSession(deps: {
    section: string | undefined;
    createResult: Pick<TerminalSession, "id" | "typeMetadata">;
    createSession: (args: unknown) => Promise<typeof deps.createResult>;
    updateSession: (id: string, patch: unknown) => Promise<void>;
  }): Promise<void> {
    const { section, createSession, updateSession } = deps;
    const session = await createSession({
      name: "Settings",
      projectId: "p1",
      terminalType: "settings",
      scopeKey: "settings",
      typeMetadata: section ? { activeTab: section } : {},
    });
    if (shouldPatchSettingsTab(session as TerminalSession, section)) {
      await updateSession(session.id, {
        typeMetadataPatch: { activeTab: section },
      });
    }
  }

  it("patches activeTab when dedup reuses a session with a different stored tab", async () => {
    // Simulate server: dedup returned the existing Settings row with
    // typeMetadata.activeTab = "general" — caller asked for "logs".
    const createSession = vi.fn(async () => ({
      id: "reused-settings-id",
      typeMetadata: { activeTab: "general" },
    }));
    const updateSession = vi.fn(async () => undefined);

    await openSettingsSession({
      section: "logs",
      createResult: { id: "reused-settings-id", typeMetadata: { activeTab: "general" } },
      createSession,
      updateSession,
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(updateSession).toHaveBeenCalledTimes(1);
    expect(updateSession).toHaveBeenCalledWith("reused-settings-id", {
      typeMetadataPatch: { activeTab: "logs" },
    });
  });

  it("does NOT patch when the reused session already has the requested tab", async () => {
    const createSession = vi.fn(async () => ({
      id: "reused-settings-id",
      typeMetadata: { activeTab: "logs" },
    }));
    const updateSession = vi.fn(async () => undefined);

    await openSettingsSession({
      section: "logs",
      createResult: { id: "reused-settings-id", typeMetadata: { activeTab: "logs" } },
      createSession,
      updateSession,
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("does NOT patch when caller did not specify a section (plain gear-icon open)", async () => {
    const createSession = vi.fn(async () => ({
      id: "fresh-settings-id",
      typeMetadata: null,
    }));
    const updateSession = vi.fn(async () => undefined);

    await openSettingsSession({
      section: undefined,
      createResult: { id: "fresh-settings-id", typeMetadata: null },
      createSession,
      updateSession,
    });

    expect(updateSession).not.toHaveBeenCalled();
  });

  it("patches on fresh create too when stored tab is missing (safety net)", async () => {
    // Defensive: if the server returns a row without activeTab in
    // typeMetadata for any reason, we still patch so the view opens
    // to the requested section.
    const createSession = vi.fn(async () => ({
      id: "new-settings-id",
      typeMetadata: null,
    }));
    const updateSession = vi.fn(async () => undefined);

    await openSettingsSession({
      section: "logs",
      createResult: { id: "new-settings-id", typeMetadata: null },
      createSession,
      updateSession,
    });

    expect(updateSession).toHaveBeenCalledWith("new-settings-id", {
      typeMetadataPatch: { activeTab: "logs" },
    });
  });
});
