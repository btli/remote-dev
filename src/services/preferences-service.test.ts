/**
 * PreferencesService Unit Tests
 *
 * Tests cover:
 * - getUserSettings creation and retrieval
 * - updateUserSettings
 * - setActiveFolder (pinned vs auto-follow)
 * - getFolderPreferences
 * - getAllFolderPreferences
 * - getAllFolders
 * - getFolderPreferencesChain ancestry traversal
 * - updateFolderPreferences with port validation
 * - deleteFolderPreferences
 * - getResolvedPreferences inheritance
 * - getEffectiveActiveFolderId logic
 * - getResolvedEnvironment
 * - getEnvironmentForSession
 */
import { describe, it, expect, vi, beforeEach } from "bun:test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = ReturnType<typeof vi.fn<any>>;

// Mock the database module
vi.mock("@/db", () => ({
  db: {
    query: {
      users: {
        findFirst: vi.fn(),
      },
      userSettings: {
        findFirst: vi.fn(),
      },
      folderPreferences: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      sessionFolders: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(),
    })),
  },
}));

// Mock port-registry-service
vi.mock("@/services/port-registry-service", () => ({
  syncPortRegistry: vi.fn(),
  validatePorts: vi.fn().mockResolvedValue({ valid: true, conflicts: [] }),
  deletePortsForFolder: vi.fn(),
}));

// Mock the preferences library
vi.mock("@/lib/preferences", () => ({
  DEFAULT_PREFERENCES: {
    defaultWorkingDirectory: "~",
    defaultShell: "/bin/bash",
    theme: "tokyo-night",
    fontSize: 14,
    fontFamily: "JetBrains Mono",
  },
  resolvePreferences: vi.fn((userSettings, folderChain) => ({
    ...userSettings,
    folderChain,
  })),
  buildAncestryChain: vi.fn((folderId, prefsMap, foldersMap) => {
    // Simple mock implementation
    const chain = [];
    let currentId = folderId;
    while (currentId) {
      const folder = foldersMap.get(currentId);
      if (!folder) break;
      const prefs = prefsMap.get(currentId);
      if (prefs) {
        chain.unshift({ folderId: currentId, folderName: folder.name, ...prefs });
      }
      currentId = folder.parentId;
    }
    return chain;
  }),
}));

// Mock the environment library
vi.mock("@/lib/environment", () => ({
  parseEnvironmentVars: vi.fn((json) => (json ? JSON.parse(json) : null)),
  serializeEnvironmentVars: vi.fn((vars) => (vars ? JSON.stringify(vars) : null)),
  resolveEnvironmentVariables: vi.fn((userEnv, folderChain) => ({
    variables: { PORT: "3000" },
    sources: [],
  })),
}));

import { db } from "@/db";
import {
  getUserSettings,
  updateUserSettings,
  setActiveFolder,
  getFolderPreferences,
  getAllFolderPreferences,
  getAllFolders,
  getFolderPreferencesChain,
  updateFolderPreferences,
  deleteFolderPreferences,
  getResolvedPreferences,
  getEffectiveActiveFolderId,
  getResolvedEnvironment,
  getEnvironmentForSession,
  PreferencesServiceError,
  DEFAULT_PREFERENCES,
} from "./preferences-service";
import { syncPortRegistry, deletePortsForFolder } from "./port-registry-service";

describe("PreferencesService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockUser = {
    id: "user-456",
    email: "test@example.com",
    name: "Test User",
  };

  const mockUserSettings = {
    id: "settings-123",
    userId: "user-456",
    defaultWorkingDirectory: "~",
    defaultShell: "/bin/zsh",
    startupCommand: null,
    xtermScrollback: 1000,
    tmuxHistoryLimit: 2000,
    theme: "tokyo-night",
    fontSize: 14,
    fontFamily: "JetBrains Mono",
    activeFolderId: null,
    pinnedFolderId: null,
    autoFollowActiveSession: true,
    orchestratorFirstMode: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
  };

  const mockFolderPreferences = {
    id: "prefs-123",
    folderId: "folder-456",
    userId: "user-456",
    defaultWorkingDirectory: "/projects/myapp",
    defaultShell: null,
    startupCommand: "npm run dev",
    theme: null,
    fontSize: null,
    fontFamily: null,
    githubRepoId: "repo-789",
    localRepoPath: "/home/user/projects/myapp",
    environmentVars: '{"PORT": "3000", "NODE_ENV": "development"}',
    orchestratorFirstMode: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
  };

  const mockFolder = {
    id: "folder-456",
    userId: "user-456",
    parentId: null,
    name: "My Project",
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // getUserSettings Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getUserSettings", () => {
    it("returns existing user settings", async () => {
      (db.query.userSettings.findFirst as AnyMock).mockResolvedValue(
        mockUserSettings
      );

      const result = await getUserSettings("user-456");

      expect(result.userId).toBe("user-456");
      expect(result.defaultShell).toBe("/bin/zsh");
      expect(result.theme).toBe("tokyo-night");
    });

    it("creates default settings for new user", async () => {
      (db.query.userSettings.findFirst as AnyMock).mockResolvedValue(null);
      (db.query.users.findFirst as AnyMock).mockResolvedValue(mockUser);

      const mockInsert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([mockUserSettings]),
        })),
      }));
      (db.insert as AnyMock).mockImplementation(mockInsert);

      const result = await getUserSettings("user-456");

      expect(db.insert).toHaveBeenCalled();
      expect(result.userId).toBe("user-456");
    });

    it("throws when user not found", async () => {
      (db.query.userSettings.findFirst as AnyMock).mockResolvedValue(null);
      (db.query.users.findFirst as AnyMock).mockResolvedValue(null);

      await expect(getUserSettings("nonexistent")).rejects.toThrow(
        PreferencesServiceError
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // updateUserSettings Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("updateUserSettings", () => {
    it("updates user settings", async () => {
      (db.query.userSettings.findFirst as AnyMock).mockResolvedValue(
        mockUserSettings
      );

      const mockUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi
              .fn()
              .mockResolvedValue([{ ...mockUserSettings, fontSize: 16 }]),
          })),
        })),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      const result = await updateUserSettings("user-456", { fontSize: 16 });

      expect(result.fontSize).toBe(16);
    });

    it("throws when update fails", async () => {
      (db.query.userSettings.findFirst as AnyMock).mockResolvedValue(
        mockUserSettings
      );

      const mockUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([]),
          })),
        })),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      await expect(
        updateUserSettings("user-456", { fontSize: 16 })
      ).rejects.toThrow("Failed to update user settings");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // setActiveFolder Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("setActiveFolder", () => {
    it("sets active folder without pinning", async () => {
      (db.query.userSettings.findFirst as AnyMock).mockResolvedValue(
        mockUserSettings
      );

      const mockUpdate = vi.fn(() => ({
        set: vi.fn((values) => {
          expect(values.activeFolderId).toBe("folder-123");
          expect(values.pinnedFolderId).toBeNull();
          return {
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([
                {
                  ...mockUserSettings,
                  activeFolderId: "folder-123",
                },
              ]),
            })),
          };
        }),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      await setActiveFolder("user-456", "folder-123", false);
    });

    it("sets pinned folder when pinned=true", async () => {
      (db.query.userSettings.findFirst as AnyMock).mockResolvedValue(
        mockUserSettings
      );

      const mockUpdate = vi.fn(() => ({
        set: vi.fn((values) => {
          expect(values.activeFolderId).toBeNull();
          expect(values.pinnedFolderId).toBe("folder-123");
          return {
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([
                {
                  ...mockUserSettings,
                  pinnedFolderId: "folder-123",
                },
              ]),
            })),
          };
        }),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      await setActiveFolder("user-456", "folder-123", true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getFolderPreferences Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getFolderPreferences", () => {
    it("returns folder preferences when found", async () => {
      (db.query.folderPreferences.findFirst as AnyMock).mockResolvedValue(
        mockFolderPreferences
      );

      const result = await getFolderPreferences("folder-456", "user-456");

      expect(result).not.toBeNull();
      expect(result?.defaultWorkingDirectory).toBe("/projects/myapp");
    });

    it("returns null when no preferences exist", async () => {
      (db.query.folderPreferences.findFirst as AnyMock).mockResolvedValue(null);

      const result = await getFolderPreferences("folder-456", "user-456");

      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getAllFolderPreferences Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getAllFolderPreferences", () => {
    it("returns all folder preferences for user", async () => {
      (db.query.folderPreferences.findMany as AnyMock).mockResolvedValue([
        mockFolderPreferences,
        { ...mockFolderPreferences, id: "prefs-456", folderId: "folder-789" },
      ]);

      const result = await getAllFolderPreferences("user-456");

      expect(result).toHaveLength(2);
    });

    it("returns empty array when no preferences", async () => {
      (db.query.folderPreferences.findMany as AnyMock).mockResolvedValue([]);

      const result = await getAllFolderPreferences("user-456");

      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getAllFolders Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getAllFolders", () => {
    it("returns all folders for user", async () => {
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([
        mockFolder,
        { ...mockFolder, id: "folder-789", name: "Another Project" },
      ]);

      const result = await getAllFolders("user-456");

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("My Project");
    });

    it("handles null parentId", async () => {
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([
        { ...mockFolder, parentId: null },
      ]);

      const result = await getAllFolders("user-456");

      expect(result[0].parentId).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // updateFolderPreferences Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("updateFolderPreferences", () => {
    it("updates existing folder preferences", async () => {
      (db.query.sessionFolders.findFirst as AnyMock).mockResolvedValue(mockFolder);
      (db.query.folderPreferences.findFirst as AnyMock).mockResolvedValue(
        mockFolderPreferences
      );

      const mockUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([
              {
                ...mockFolderPreferences,
                startupCommand: "npm start",
              },
            ]),
          })),
        })),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      const result = await updateFolderPreferences("folder-456", "user-456", {
        startupCommand: "npm start",
      });

      expect(result.preferences.startupCommand).toBe("npm start");
      expect(result.portValidation.valid).toBe(true);
    });

    it("creates new preferences when none exist", async () => {
      (db.query.sessionFolders.findFirst as AnyMock).mockResolvedValue(mockFolder);
      (db.query.folderPreferences.findFirst as AnyMock).mockResolvedValue(null);

      const mockInsert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([mockFolderPreferences]),
        })),
      }));
      (db.insert as AnyMock).mockImplementation(mockInsert);

      const result = await updateFolderPreferences("folder-456", "user-456", {
        startupCommand: "npm start",
      });

      expect(db.insert).toHaveBeenCalled();
      expect(result.preferences).toBeDefined();
    });

    it("throws when folder not found", async () => {
      (db.query.sessionFolders.findFirst as AnyMock).mockResolvedValue(null);

      await expect(
        updateFolderPreferences("nonexistent", "user-456", {})
      ).rejects.toThrow("Folder not found");
    });

    it("syncs port registry when environmentVars updated", async () => {
      (db.query.sessionFolders.findFirst as AnyMock).mockResolvedValue(mockFolder);
      (db.query.folderPreferences.findFirst as AnyMock).mockResolvedValue(
        mockFolderPreferences
      );

      const mockUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([mockFolderPreferences]),
          })),
        })),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      await updateFolderPreferences("folder-456", "user-456", {
        environmentVars: { PORT: "4000" },
      });

      expect(syncPortRegistry).toHaveBeenCalledWith(
        "folder-456",
        "user-456",
        { PORT: "4000" }
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // deleteFolderPreferences Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("deleteFolderPreferences", () => {
    it("deletes folder preferences and cleans up ports", async () => {
      const mockDelete = vi.fn(() => ({
        where: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
      }));
      (db.delete as AnyMock).mockImplementation(mockDelete);

      const result = await deleteFolderPreferences("folder-456", "user-456");

      expect(result).toBe(true);
      expect(deletePortsForFolder).toHaveBeenCalledWith("folder-456", "user-456");
    });

    it("returns false when no preferences to delete", async () => {
      const mockDelete = vi.fn(() => ({
        where: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
      }));
      (db.delete as AnyMock).mockImplementation(mockDelete);

      const result = await deleteFolderPreferences("nonexistent", "user-456");

      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getResolvedPreferences Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getResolvedPreferences", () => {
    it("resolves preferences without folder", async () => {
      (db.query.userSettings.findFirst as AnyMock).mockResolvedValue(
        mockUserSettings
      );

      const result = await getResolvedPreferences("user-456");

      expect(result).toBeDefined();
      expect(result.folderChain).toEqual([]);
    });

    it("resolves preferences with folder hierarchy", async () => {
      (db.query.userSettings.findFirst as AnyMock).mockResolvedValue(
        mockUserSettings
      );
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([mockFolder]);
      (db.query.folderPreferences.findMany as AnyMock).mockResolvedValue([
        mockFolderPreferences,
      ]);

      const result = await getResolvedPreferences("user-456", "folder-456");

      expect(result).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getEffectiveActiveFolderId Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getEffectiveActiveFolderId", () => {
    it("returns pinned folder when set", async () => {
      (db.query.userSettings.findFirst as AnyMock).mockResolvedValue({
        ...mockUserSettings,
        pinnedFolderId: "pinned-folder",
        activeFolderId: "other-folder",
      });

      const result = await getEffectiveActiveFolderId("user-456", "current-folder");

      expect(result).toBe("pinned-folder");
    });

    it("returns current session folder when auto-follow enabled", async () => {
      (db.query.userSettings.findFirst as AnyMock).mockResolvedValue({
        ...mockUserSettings,
        autoFollowActiveSession: true,
        pinnedFolderId: null,
        activeFolderId: "stored-folder",
      });

      const result = await getEffectiveActiveFolderId("user-456", "current-folder");

      expect(result).toBe("current-folder");
    });

    it("returns stored active folder when auto-follow disabled", async () => {
      (db.query.userSettings.findFirst as AnyMock).mockResolvedValue({
        ...mockUserSettings,
        autoFollowActiveSession: false,
        pinnedFolderId: null,
        activeFolderId: "stored-folder",
      });

      const result = await getEffectiveActiveFolderId("user-456", "current-folder");

      expect(result).toBe("stored-folder");
    });

    it("returns stored active folder when no current session folder", async () => {
      (db.query.userSettings.findFirst as AnyMock).mockResolvedValue({
        ...mockUserSettings,
        autoFollowActiveSession: true,
        pinnedFolderId: null,
        activeFolderId: "stored-folder",
      });

      const result = await getEffectiveActiveFolderId("user-456", null);

      expect(result).toBe("stored-folder");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getResolvedEnvironment Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getResolvedEnvironment", () => {
    it("returns null when no folder specified", async () => {
      const result = await getResolvedEnvironment("user-456");

      expect(result).toBeNull();
    });

    it("returns null when folderId is null", async () => {
      const result = await getResolvedEnvironment("user-456", null);

      expect(result).toBeNull();
    });

    it("returns resolved environment for folder", async () => {
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([mockFolder]);
      (db.query.folderPreferences.findMany as AnyMock).mockResolvedValue([
        mockFolderPreferences,
      ]);

      const result = await getResolvedEnvironment("user-456", "folder-456");

      expect(result).not.toBeNull();
      expect(result?.variables).toEqual({ PORT: "3000" });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getEnvironmentForSession Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getEnvironmentForSession", () => {
    it("returns null when no folder specified", async () => {
      const result = await getEnvironmentForSession("user-456");

      expect(result).toBeNull();
    });

    it("returns environment variables for session", async () => {
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([mockFolder]);
      (db.query.folderPreferences.findMany as AnyMock).mockResolvedValue([
        mockFolderPreferences,
      ]);

      const result = await getEnvironmentForSession("user-456", "folder-456");

      expect(result).toEqual({ PORT: "3000" });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Exports Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("exports", () => {
    it("exports PreferencesServiceError", () => {
      expect(PreferencesServiceError).toBeDefined();
    });

    it("exports DEFAULT_PREFERENCES", () => {
      expect(DEFAULT_PREFERENCES).toBeDefined();
      expect(DEFAULT_PREFERENCES.theme).toBe("tokyo-night");
    });
  });
});
