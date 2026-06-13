// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolvePreferences } from "./preferences";
import type {
  UserSettings,
  FolderPreferencesWithMeta,
} from "@/types/preferences";

/**
 * Focused coverage for the Claude usage-limit fields added to the preference
 * resolver (claudeProfilePoolId + claudeAutoRelaunchMode pass-through). The
 * rest of resolvePreferences is exercised indirectly elsewhere; this guards the
 * new inheritance behavior.
 */

function userSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    id: "us-1",
    userId: "u1",
    defaultWorkingDirectory: null,
    defaultShell: null,
    theme: null,
    fontSize: null,
    fontFamily: null,
    xtermScrollback: null,
    tmuxHistoryLimit: null,
    activeNodeId: null,
    activeNodeType: null,
    pinnedNodeId: null,
    pinnedNodeType: null,
    autoFollowActiveSession: true,
    notificationsEnabled: true,
    defaultAgentProvider: null,
    agentProviderSettings: null,
    claudeAutoRelaunchMode: "notify",
    beadsSidebarCollapsed: true,
    beadsSidebarWidth: 320,
    beadsClosedRetentionDays: 7,
    beadsSectionExpanded: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function folderPrefs(
  overrides: Partial<FolderPreferencesWithMeta> & { folderId: string; folderName: string }
): FolderPreferencesWithMeta {
  return {
    id: `fp-${overrides.folderId}`,
    userId: "u1",
    defaultWorkingDirectory: null,
    defaultShell: null,
    theme: null,
    fontSize: null,
    fontFamily: null,
    githubRepoId: null,
    localRepoPath: null,
    defaultAgentProvider: null,
    agentProviderSettings: null,
    claudeProfilePoolId: null,
    claudeAutoRelaunchMode: null,
    environmentVars: null,
    pinnedFiles: null,
    gitIdentityName: null,
    gitIdentityEmail: null,
    isSensitive: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("resolvePreferences — Claude usage-limit fields", () => {
  it("defaults to null pool and the user-level auto-relaunch mode", () => {
    const resolved = resolvePreferences(userSettings({ claudeAutoRelaunchMode: "auto" }), []);
    expect(resolved.claudeProfilePoolId).toBeNull();
    expect(resolved.claudeAutoRelaunchMode).toBe("auto");
    expect(resolved.source.claudeAutoRelaunchMode).toBe("user");
    expect(resolved.source.claudeProfilePoolId).toBe("default");
  });

  it("inherits the pool id from a folder in the chain", () => {
    const chain = [
      folderPrefs({ folderId: "grp", folderName: "Group", claudeProfilePoolId: "pool-A" }),
      folderPrefs({ folderId: "proj", folderName: "Project" }),
    ];
    const resolved = resolvePreferences(userSettings(), chain);
    expect(resolved.claudeProfilePoolId).toBe("pool-A");
    expect(resolved.source.claudeProfilePoolId).toEqual({
      type: "folder",
      folderId: "grp",
      folderName: "Group",
    });
  });

  it("child folder overrides parent for both fields", () => {
    const chain = [
      folderPrefs({
        folderId: "grp",
        folderName: "Group",
        claudeProfilePoolId: "pool-parent",
        claudeAutoRelaunchMode: "notify",
      }),
      folderPrefs({
        folderId: "proj",
        folderName: "Project",
        claudeProfilePoolId: "pool-child",
        claudeAutoRelaunchMode: "auto",
      }),
    ];
    const resolved = resolvePreferences(userSettings(), chain);
    expect(resolved.claudeProfilePoolId).toBe("pool-child");
    expect(resolved.claudeAutoRelaunchMode).toBe("auto");
  });

  it("a folder auto-relaunch override beats the user default", () => {
    const chain = [
      folderPrefs({ folderId: "proj", folderName: "Project", claudeAutoRelaunchMode: "disabled" }),
    ];
    const resolved = resolvePreferences(userSettings({ claudeAutoRelaunchMode: "auto" }), chain);
    expect(resolved.claudeAutoRelaunchMode).toBe("disabled");
  });
});
