/**
 * FolderService Unit Tests
 *
 * Tests cover:
 * - getFolders retrieval and mapping
 * - getSessionFolderMappings
 * - createFolder with parent validation
 * - updateFolder
 * - moveFolderToParent with circular reference detection
 * - deleteFolder
 * - reorderFolders transaction
 * - moveSessionToFolder with ownership validation
 * - getChildFolders
 * - getParentChain traversal
 * - getFolderById
 */
import { describe, it, expect, vi, beforeEach } from "bun:test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = ReturnType<typeof vi.fn<any>>;

// Mock the database module
vi.mock("@/db", () => ({
  db: {
    query: {
      sessionFolders: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      terminalSessions: {
        findMany: vi.fn(),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
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
    transaction: vi.fn(),
  },
}));

import { db } from "@/db";
import {
  getFolders,
  getSessionFolderMappings,
  createFolder,
  updateFolder,
  moveFolderToParent,
  deleteFolder,
  reorderFolders,
  moveSessionToFolder,
  getChildFolders,
  getParentChain,
  getFolderById,
} from "./folder-service";

describe("FolderService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockFolder = {
    id: "folder-123",
    userId: "user-456",
    parentId: null,
    name: "Test Folder",
    collapsed: false,
    sortOrder: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
  };

  const mockChildFolder = {
    id: "folder-child",
    userId: "user-456",
    parentId: "folder-123",
    name: "Child Folder",
    collapsed: false,
    sortOrder: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // getFolders Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getFolders", () => {
    it("returns mapped folders for user", async () => {
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([
        mockFolder,
        mockChildFolder,
      ]);

      const result = await getFolders("user-456");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "folder-123",
        userId: "user-456",
        parentId: null,
        name: "Test Folder",
        collapsed: false,
        sortOrder: 0,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
      expect(result[1].parentId).toBe("folder-123");
    });

    it("returns empty array when no folders exist", async () => {
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([]);

      const result = await getFolders("user-456");

      expect(result).toEqual([]);
    });

    it("handles null collapsed field", async () => {
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([
        { ...mockFolder, collapsed: null },
      ]);

      const result = await getFolders("user-456");

      expect(result[0].collapsed).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getSessionFolderMappings Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getSessionFolderMappings", () => {
    it("returns session to folder mappings", async () => {
      (db.query.terminalSessions.findMany as AnyMock).mockResolvedValue([
        { id: "session-1", folderId: "folder-123" },
        { id: "session-2", folderId: "folder-456" },
        { id: "session-3", folderId: null },
      ]);

      const result = await getSessionFolderMappings("user-456");

      expect(result).toEqual({
        "session-1": "folder-123",
        "session-2": "folder-456",
      });
    });

    it("returns empty object when no sessions have folders", async () => {
      (db.query.terminalSessions.findMany as AnyMock).mockResolvedValue([
        { id: "session-1", folderId: null },
      ]);

      const result = await getSessionFolderMappings("user-456");

      expect(result).toEqual({});
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // createFolder Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("createFolder", () => {
    it("creates folder at root level", async () => {
      const mockSelect = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ maxOrder: 2 }]),
        })),
      }));
      (db.select as AnyMock).mockImplementation(mockSelect);

      const mockInsert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([mockFolder]),
        })),
      }));
      (db.insert as AnyMock).mockImplementation(mockInsert);

      const result = await createFolder("user-456", "Test Folder");

      expect(result.name).toBe("Test Folder");
      expect(result.parentId).toBeNull();
      expect(db.insert).toHaveBeenCalled();
    });

    it("creates folder with parent", async () => {
      // Parent folder lookup
      (db.query.sessionFolders.findFirst as AnyMock).mockResolvedValue(mockFolder);

      const mockSelect = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ maxOrder: 0 }]),
        })),
      }));
      (db.select as AnyMock).mockImplementation(mockSelect);

      const mockInsert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([mockChildFolder]),
        })),
      }));
      (db.insert as AnyMock).mockImplementation(mockInsert);

      const result = await createFolder("user-456", "Child Folder", "folder-123");

      expect(result.parentId).toBe("folder-123");
    });

    it("throws when parent folder not found", async () => {
      (db.query.sessionFolders.findFirst as AnyMock).mockResolvedValue(null);

      await expect(
        createFolder("user-456", "Child Folder", "nonexistent-parent")
      ).rejects.toThrow("Parent folder not found or access denied");
    });

    it("handles null maxOrder result", async () => {
      const mockSelect = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ maxOrder: null }]),
        })),
      }));
      (db.select as AnyMock).mockImplementation(mockSelect);

      const mockInsert = vi.fn(() => ({
        values: vi.fn((values) => {
          // sortOrder should be 0 when maxOrder is null (-1 + 1)
          expect(values.sortOrder).toBe(0);
          return {
            returning: vi.fn().mockResolvedValue([mockFolder]),
          };
        }),
      }));
      (db.insert as AnyMock).mockImplementation(mockInsert);

      await createFolder("user-456", "Test Folder");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // updateFolder Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("updateFolder", () => {
    it("updates folder name", async () => {
      const mockUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi
              .fn()
              .mockResolvedValue([{ ...mockFolder, name: "Updated Name" }]),
          })),
        })),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      const result = await updateFolder("folder-123", "user-456", {
        name: "Updated Name",
      });

      expect(result?.name).toBe("Updated Name");
    });

    it("updates folder collapsed state", async () => {
      const mockUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi
              .fn()
              .mockResolvedValue([{ ...mockFolder, collapsed: true }]),
          })),
        })),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      const result = await updateFolder("folder-123", "user-456", {
        collapsed: true,
      });

      expect(result?.collapsed).toBe(true);
    });

    it("returns null when folder not found", async () => {
      const mockUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([]),
          })),
        })),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      const result = await updateFolder("nonexistent", "user-456", {
        name: "New Name",
      });

      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // moveFolderToParent Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("moveFolderToParent", () => {
    it("moves folder to new parent", async () => {
      // Setup: return folder and new parent
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([
        mockFolder,
        { ...mockChildFolder, id: "new-parent", parentId: null },
      ]);

      const mockUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi
              .fn()
              .mockResolvedValue([{ ...mockFolder, parentId: "new-parent" }]),
          })),
        })),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      const result = await moveFolderToParent(
        "folder-123",
        "user-456",
        "new-parent"
      );

      expect(result?.parentId).toBe("new-parent");
    });

    it("moves folder to root", async () => {
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([
        { ...mockFolder, parentId: "old-parent" },
      ]);

      const mockUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ ...mockFolder, parentId: null }]),
          })),
        })),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      const result = await moveFolderToParent("folder-123", "user-456", null);

      expect(result?.parentId).toBeNull();
    });

    it("returns null when folder not found", async () => {
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([]);

      const result = await moveFolderToParent(
        "nonexistent",
        "user-456",
        "folder-123"
      );

      expect(result).toBeNull();
    });

    it("throws when new parent not found", async () => {
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([mockFolder]);

      await expect(
        moveFolderToParent("folder-123", "user-456", "nonexistent")
      ).rejects.toThrow("Parent folder not found or access denied");
    });

    it("throws when move would create circular reference", async () => {
      // Setup: folder-123 -> folder-child -> folder-grandchild
      // Attempt to move folder-123 into folder-grandchild (its descendant)
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([
        mockFolder,
        mockChildFolder,
        {
          id: "folder-grandchild",
          userId: "user-456",
          parentId: "folder-child",
          name: "Grandchild",
          collapsed: false,
          sortOrder: 0,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-02T00:00:00.000Z",
        },
      ]);

      await expect(
        moveFolderToParent("folder-123", "user-456", "folder-grandchild")
      ).rejects.toThrow("Cannot move folder into its own descendant");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // deleteFolder Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("deleteFolder", () => {
    it("deletes folder and removes sessions from folder", async () => {
      const mockUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue({ rowsAffected: 2 }),
        })),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      const mockDelete = vi.fn(() => ({
        where: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
      }));
      (db.delete as AnyMock).mockImplementation(mockDelete);

      const result = await deleteFolder("folder-123", "user-456");

      expect(result).toBe(true);
      expect(db.update).toHaveBeenCalled();
      expect(db.delete).toHaveBeenCalled();
    });

    it("returns false when folder not found", async () => {
      const mockUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
        })),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      const mockDelete = vi.fn(() => ({
        where: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
      }));
      (db.delete as AnyMock).mockImplementation(mockDelete);

      const result = await deleteFolder("nonexistent", "user-456");

      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // reorderFolders Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("reorderFolders", () => {
    it("reorders folders in transaction", async () => {
      const txMock = {
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
          })),
        })),
      };

      (db.transaction as AnyMock).mockImplementation(async (callback: (tx: typeof txMock) => Promise<void>) => {
        await callback(txMock);
      });

      await reorderFolders("user-456", ["folder-1", "folder-2", "folder-3"]);

      expect(db.transaction).toHaveBeenCalled();
      expect(txMock.update).toHaveBeenCalledTimes(3);
    });

    it("handles empty folder list", async () => {
      const emptyTxMock = { update: vi.fn() };
      (db.transaction as AnyMock).mockImplementation(async (callback: (tx: typeof emptyTxMock) => Promise<void>) => {
        await callback(emptyTxMock);
      });

      await reorderFolders("user-456", []);

      expect(db.transaction).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // moveSessionToFolder Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("moveSessionToFolder", () => {
    it("moves session to folder after ownership validation", async () => {
      (db.query.sessionFolders.findFirst as AnyMock).mockResolvedValue(mockFolder);

      const mockUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
        })),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      const result = await moveSessionToFolder(
        "session-123",
        "user-456",
        "folder-123"
      );

      expect(result).toBe(true);
    });

    it("removes session from folder when folderId is null", async () => {
      const mockUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
        })),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      const result = await moveSessionToFolder("session-123", "user-456", null);

      expect(result).toBe(true);
      // Should not check folder ownership
      expect(db.query.sessionFolders.findFirst).not.toHaveBeenCalled();
    });

    it("returns false when folder not owned by user", async () => {
      (db.query.sessionFolders.findFirst as AnyMock).mockResolvedValue(null);

      const result = await moveSessionToFolder(
        "session-123",
        "user-456",
        "other-user-folder"
      );

      expect(result).toBe(false);
    });

    it("returns false when session not found", async () => {
      (db.query.sessionFolders.findFirst as AnyMock).mockResolvedValue(mockFolder);

      const mockUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
        })),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      const result = await moveSessionToFolder(
        "nonexistent",
        "user-456",
        "folder-123"
      );

      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getChildFolders Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getChildFolders", () => {
    it("returns child folders sorted by sortOrder", async () => {
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([
        mockChildFolder,
        { ...mockChildFolder, id: "folder-child-2", name: "Child 2", sortOrder: 1 },
      ]);

      const result = await getChildFolders("folder-123", "user-456");

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Child Folder");
    });

    it("returns empty array when no children", async () => {
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([]);

      const result = await getChildFolders("folder-123", "user-456");

      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getParentChain Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getParentChain", () => {
    it("returns parent chain from folder to root", async () => {
      const grandparent = {
        ...mockFolder,
        id: "grandparent",
        name: "Grandparent",
        parentId: null,
      };
      const parent = {
        ...mockFolder,
        id: "parent",
        name: "Parent",
        parentId: "grandparent",
      };
      const child = {
        ...mockFolder,
        id: "child",
        name: "Child",
        parentId: "parent",
      };

      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([
        grandparent,
        parent,
        child,
      ]);

      const result = await getParentChain("child", "user-456");

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Parent");
      expect(result[1].name).toBe("Grandparent");
    });

    it("returns empty array for root folder", async () => {
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([mockFolder]);

      const result = await getParentChain("folder-123", "user-456");

      expect(result).toEqual([]);
    });

    it("returns empty array when folder not found", async () => {
      (db.query.sessionFolders.findMany as AnyMock).mockResolvedValue([]);

      const result = await getParentChain("nonexistent", "user-456");

      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getFolderById Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getFolderById", () => {
    it("returns folder when found", async () => {
      (db.query.sessionFolders.findFirst as AnyMock).mockResolvedValue(mockFolder);

      const result = await getFolderById("folder-123", "user-456");

      expect(result).toEqual({
        id: "folder-123",
        userId: "user-456",
        parentId: null,
        name: "Test Folder",
        collapsed: false,
        sortOrder: 0,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it("returns null when folder not found", async () => {
      (db.query.sessionFolders.findFirst as AnyMock).mockResolvedValue(null);

      const result = await getFolderById("nonexistent", "user-456");

      expect(result).toBeNull();
    });

    it("returns null when folder belongs to different user", async () => {
      (db.query.sessionFolders.findFirst as AnyMock).mockResolvedValue(null);

      const result = await getFolderById("folder-123", "different-user");

      expect(result).toBeNull();
    });
  });
});
