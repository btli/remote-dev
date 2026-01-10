/**
 * TrashService Unit Tests
 *
 * Tests cover:
 * - listTrashItems retrieval and filtering
 * - listTrashItemsWithMetadata with worktree metadata
 * - getTrashItem with metadata lookup
 * - countTrashItems
 * - trashResource delegation
 * - restoreResource delegation
 * - deleteTrashItem delegation
 * - cleanupExpiredItems batch processing
 * - isSessionTrashed status check
 */
import { describe, it, expect, vi, beforeEach } from "bun:test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = ReturnType<typeof vi.fn<any>>;

// Mock the database module
vi.mock("@/db", () => ({
  db: {
    query: {
      trashItems: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      worktreeTrashMetadata: {
        findFirst: vi.fn(),
      },
      terminalSessions: {
        findFirst: vi.fn(),
      },
    },
    delete: vi.fn(() => ({
      where: vi.fn(),
    })),
  },
}));

// Mock the worktree-trash-service
vi.mock("./worktree-trash-service", () => ({
  trashWorktreeSession: vi.fn(),
  restoreWorktreeFromTrash: vi.fn(),
  permanentlyDeleteWorktree: vi.fn(),
}));

import { db } from "@/db";
import * as WorktreeTrashService from "./worktree-trash-service";
import {
  listTrashItems,
  listTrashItemsWithMetadata,
  getTrashItem,
  countTrashItems,
  trashResource,
  restoreResource,
  deleteTrashItem,
  cleanupExpiredItems,
  isSessionTrashed,
  TrashServiceError,
} from "./trash-service";

describe("TrashService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockTrashItem = {
    id: "trash-123",
    userId: "user-456",
    resourceType: "worktree",
    resourceId: "session-789",
    resourceName: "feature-branch",
    trashedAt: new Date("2024-01-01T00:00:00.000Z"),
    expiresAt: new Date("2024-02-01T00:00:00.000Z"),
  };

  const mockWorktreeMetadata = {
    id: "metadata-123",
    trashItemId: "trash-123",
    githubRepoId: "repo-456",
    repoName: "my-repo",
    repoLocalPath: "/home/user/repos/my-repo",
    worktreeBranch: "feature-branch",
    worktreeOriginalPath: "/home/user/repos/my-repo/worktrees/feature-branch",
    worktreeTrashPath: "/home/user/.remote-dev/trash/feature-branch",
    originalFolderId: "folder-789",
    originalFolderName: "Development",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // listTrashItems Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("listTrashItems", () => {
    it("returns all trash items for user", async () => {
      (db.query.trashItems.findMany as AnyMock).mockResolvedValue([
        mockTrashItem,
        { ...mockTrashItem, id: "trash-456", resourceName: "other-branch" },
      ]);

      const result = await listTrashItems("user-456");

      expect(result).toHaveLength(2);
      expect(result[0].resourceName).toBe("feature-branch");
      expect(result[1].resourceName).toBe("other-branch");
    });

    it("filters by resource type when provided", async () => {
      (db.query.trashItems.findMany as AnyMock).mockResolvedValue([mockTrashItem]);

      const result = await listTrashItems("user-456", "worktree");

      expect(result).toHaveLength(1);
      expect(result[0].resourceType).toBe("worktree");
    });

    it("returns empty array when no trash items", async () => {
      (db.query.trashItems.findMany as AnyMock).mockResolvedValue([]);

      const result = await listTrashItems("user-456");

      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // listTrashItemsWithMetadata Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("listTrashItemsWithMetadata", () => {
    it("returns trash items with worktree metadata", async () => {
      (db.query.trashItems.findMany as AnyMock).mockResolvedValue([mockTrashItem]);
      (db.query.worktreeTrashMetadata.findFirst as AnyMock).mockResolvedValue(
        mockWorktreeMetadata
      );

      const result = await listTrashItemsWithMetadata("user-456");

      expect(result).toHaveLength(1);
      expect(result[0].resourceType).toBe("worktree");
      expect(result[0].metadata).toBeDefined();
      expect(result[0].metadata?.repoName).toBe("my-repo");
      expect(result[0].metadata?.worktreeBranch).toBe("feature-branch");
    });

    it("excludes items without metadata", async () => {
      (db.query.trashItems.findMany as AnyMock).mockResolvedValue([mockTrashItem]);
      (db.query.worktreeTrashMetadata.findFirst as AnyMock).mockResolvedValue(null);

      const result = await listTrashItemsWithMetadata("user-456");

      expect(result).toHaveLength(0);
    });

    it("filters by resource type", async () => {
      (db.query.trashItems.findMany as AnyMock).mockResolvedValue([mockTrashItem]);
      (db.query.worktreeTrashMetadata.findFirst as AnyMock).mockResolvedValue(
        mockWorktreeMetadata
      );

      const result = await listTrashItemsWithMetadata("user-456", "worktree");

      expect(result).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getTrashItem Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getTrashItem", () => {
    it("returns trash item with worktree metadata", async () => {
      (db.query.trashItems.findFirst as AnyMock).mockResolvedValue(mockTrashItem);
      (db.query.worktreeTrashMetadata.findFirst as AnyMock).mockResolvedValue(
        mockWorktreeMetadata
      );

      const result = await getTrashItem("trash-123", "user-456");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("trash-123");
      expect(result?.resourceType).toBe("worktree");
      expect(result?.metadata?.repoName).toBe("my-repo");
    });

    it("returns null when trash item not found", async () => {
      (db.query.trashItems.findFirst as AnyMock).mockResolvedValue(null);

      const result = await getTrashItem("nonexistent", "user-456");

      expect(result).toBeNull();
    });

    it("returns base item when metadata not found for worktree", async () => {
      (db.query.trashItems.findFirst as AnyMock).mockResolvedValue(mockTrashItem);
      (db.query.worktreeTrashMetadata.findFirst as AnyMock).mockResolvedValue(null);

      const result = await getTrashItem("trash-123", "user-456");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("trash-123");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // countTrashItems Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("countTrashItems", () => {
    it("returns count of trash items", async () => {
      (db.query.trashItems.findMany as AnyMock).mockResolvedValue([
        { id: "1" },
        { id: "2" },
        { id: "3" },
      ]);

      const result = await countTrashItems("user-456");

      expect(result).toBe(3);
    });

    it("returns 0 when no trash items", async () => {
      (db.query.trashItems.findMany as AnyMock).mockResolvedValue([]);

      const result = await countTrashItems("user-456");

      expect(result).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // trashResource Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("trashResource", () => {
    it("delegates worktree trashing to WorktreeTrashService", async () => {
      (WorktreeTrashService.trashWorktreeSession as AnyMock).mockResolvedValue(
        mockTrashItem
      );

      const result = await trashResource("user-456", "worktree", "session-789");

      expect(WorktreeTrashService.trashWorktreeSession).toHaveBeenCalledWith(
        "session-789",
        "user-456"
      );
      expect(result.id).toBe("trash-123");
    });

    it("throws for unknown resource type", async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        trashResource("user-456", "unknown" as any, "resource-123")
      ).rejects.toThrow(TrashServiceError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // restoreResource Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("restoreResource", () => {
    it("delegates worktree restoration to WorktreeTrashService", async () => {
      (db.query.trashItems.findFirst as AnyMock).mockResolvedValue(mockTrashItem);
      (WorktreeTrashService.restoreWorktreeFromTrash as AnyMock).mockResolvedValue(
        undefined
      );

      await restoreResource("trash-123", "user-456", {
        restorePath: "/custom/path",
        targetFolderId: "folder-123",
      });

      expect(WorktreeTrashService.restoreWorktreeFromTrash).toHaveBeenCalledWith(
        "trash-123",
        "user-456",
        "/custom/path",
        "folder-123"
      );
    });

    it("throws when trash item not found", async () => {
      (db.query.trashItems.findFirst as AnyMock).mockResolvedValue(null);

      await expect(restoreResource("nonexistent", "user-456")).rejects.toThrow(
        TrashServiceError
      );
    });

    it("throws for unknown resource type", async () => {
      (db.query.trashItems.findFirst as AnyMock).mockResolvedValue({
        ...mockTrashItem,
        resourceType: "unknown",
      });

      await expect(restoreResource("trash-123", "user-456")).rejects.toThrow(
        TrashServiceError
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // deleteTrashItem Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("deleteTrashItem", () => {
    it("delegates worktree deletion to WorktreeTrashService", async () => {
      (db.query.trashItems.findFirst as AnyMock).mockResolvedValue(mockTrashItem);
      (WorktreeTrashService.permanentlyDeleteWorktree as AnyMock).mockResolvedValue(
        undefined
      );

      await deleteTrashItem("trash-123", "user-456");

      expect(WorktreeTrashService.permanentlyDeleteWorktree).toHaveBeenCalledWith(
        "trash-123",
        "user-456"
      );
    });

    it("throws when trash item not found", async () => {
      (db.query.trashItems.findFirst as AnyMock).mockResolvedValue(null);

      await expect(deleteTrashItem("nonexistent", "user-456")).rejects.toThrow(
        TrashServiceError
      );
    });

    it("throws for unknown resource type", async () => {
      (db.query.trashItems.findFirst as AnyMock).mockResolvedValue({
        ...mockTrashItem,
        resourceType: "unknown",
      });

      await expect(deleteTrashItem("trash-123", "user-456")).rejects.toThrow(
        TrashServiceError
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // cleanupExpiredItems Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("cleanupExpiredItems", () => {
    it("cleans up expired worktree items", async () => {
      const expiredItem = {
        ...mockTrashItem,
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      };
      (db.query.trashItems.findMany as AnyMock).mockResolvedValue([expiredItem]);
      (WorktreeTrashService.permanentlyDeleteWorktree as AnyMock).mockResolvedValue(
        undefined
      );

      const result = await cleanupExpiredItems();

      expect(result.deletedCount).toBe(1);
      expect(result.deletedIds).toContain("trash-123");
      expect(WorktreeTrashService.permanentlyDeleteWorktree).toHaveBeenCalledWith(
        "trash-123",
        "user-456"
      );
    });

    it("returns empty result when no expired items", async () => {
      (db.query.trashItems.findMany as AnyMock).mockResolvedValue([]);

      const result = await cleanupExpiredItems();

      expect(result.deletedCount).toBe(0);
      expect(result.deletedIds).toEqual([]);
    });

    it("continues cleanup on individual item failure", async () => {
      const expiredItems = [
        { ...mockTrashItem, id: "trash-1" },
        { ...mockTrashItem, id: "trash-2" },
      ];
      (db.query.trashItems.findMany as AnyMock).mockResolvedValue(expiredItems);
      (WorktreeTrashService.permanentlyDeleteWorktree as AnyMock)
        .mockRejectedValueOnce(new Error("Failed"))
        .mockResolvedValueOnce(undefined);

      const result = await cleanupExpiredItems();

      expect(result.deletedCount).toBe(1);
      expect(result.deletedIds).toContain("trash-2");
    });

    it("deletes unknown resource types from database only", async () => {
      const unknownItem = {
        ...mockTrashItem,
        id: "trash-unknown",
        resourceType: "unknown",
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      };
      (db.query.trashItems.findMany as AnyMock).mockResolvedValue([unknownItem]);
      const mockDelete = vi.fn(() => ({
        where: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
      }));
      (db.delete as AnyMock).mockImplementation(mockDelete);

      const result = await cleanupExpiredItems();

      expect(result.deletedCount).toBe(1);
      expect(db.delete).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // isSessionTrashed Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("isSessionTrashed", () => {
    it("returns true when session status is trashed", async () => {
      (db.query.terminalSessions.findFirst as AnyMock).mockResolvedValue({
        status: "trashed",
      });

      const result = await isSessionTrashed("session-123");

      expect(result).toBe(true);
    });

    it("returns false when session status is not trashed", async () => {
      (db.query.terminalSessions.findFirst as AnyMock).mockResolvedValue({
        status: "active",
      });

      const result = await isSessionTrashed("session-123");

      expect(result).toBe(false);
    });

    it("returns false when session not found", async () => {
      (db.query.terminalSessions.findFirst as AnyMock).mockResolvedValue(null);

      const result = await isSessionTrashed("nonexistent");

      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TrashServiceError Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("TrashServiceError", () => {
    it("is exported for external use", () => {
      expect(TrashServiceError).toBeDefined();
    });
  });
});
