/**
 * emptyAllTrash test
 *
 * Verifies that emptyAllTrash deletes ALL trash items for the user
 * regardless of whether their expiresAt timestamp has passed. This covers
 * the regression from remote-dev-nmw4 (codex Finding 1) where the footer
 * "Empty Permanently" action was routed through cleanupExpiredItems() and
 * therefore silently left unexpired items behind.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Track in-memory rows the fake db is backing.
type FakeTrashRow = {
  id: string;
  userId: string;
  resourceType: "worktree";
  resourceId: string;
  resourceName: string;
  trashedAt: Date;
  expiresAt: Date;
};

const rows: FakeTrashRow[] = [];

// Mock the db layer used by trash-service. Only the calls exercised by
// emptyAllTrash and its delegates are implemented.
vi.mock("@/db", () => {
  return {
    db: {
      query: {
        trashItems: {
          findMany: vi.fn(async (arg?: { where?: unknown }) => {
            void arg; // single-user test; we just return everything
            return rows.slice();
          }),
          findFirst: vi.fn(async (arg?: { where?: unknown }) => {
            // Best-effort: the service calls findFirst by id+userId;
            // we return the first row that matches by id if we can detect it.
            void arg;
            return rows[0];
          }),
        },
      },
      delete: vi.fn(() => ({
        where: vi.fn(async () => {
          // No-op; the wrapper below (permanentlyDeleteWorktree) is mocked.
        }),
      })),
    },
  };
});

// Mock the per-item permanent-delete path — we only care that it is called.
vi.mock("@/services/worktree-trash-service", () => ({
  permanentlyDeleteWorktree: vi.fn(async (id: string) => {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx >= 0) rows.splice(idx, 1);
  }),
}));

// Import AFTER mocks so the service wires against the fakes.
import * as TrashService from "@/services/trash-service";
import * as WorktreeTrashService from "@/services/worktree-trash-service";

const permanentlyDeleteWorktreeMock =
  WorktreeTrashService.permanentlyDeleteWorktree as unknown as ReturnType<
    typeof vi.fn
  >;

beforeEach(() => {
  rows.length = 0;
  permanentlyDeleteWorktreeMock.mockClear();
  permanentlyDeleteWorktreeMock.mockImplementation(async (id: string) => {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx >= 0) rows.splice(idx, 1);
  });
});

describe("emptyAllTrash", () => {
  it("deletes items whose expiresAt is still in the FUTURE", async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    rows.push({
      id: "t1",
      userId: "u1",
      resourceType: "worktree",
      resourceId: "s1",
      resourceName: "worktree-1",
      trashedAt: now,
      expiresAt: future,
    });

    const result = await TrashService.emptyAllTrash("u1");

    expect(permanentlyDeleteWorktreeMock).toHaveBeenCalledTimes(1);
    expect(permanentlyDeleteWorktreeMock).toHaveBeenCalledWith("t1", "u1");
    expect(result.deletedCount).toBe(1);
    expect(result.deletedIds).toEqual(["t1"]);
  });

  it("deletes a mix of expired and not-yet-expired items", async () => {
    const now = new Date();
    rows.push(
      {
        id: "t-past",
        userId: "u1",
        resourceType: "worktree",
        resourceId: "s-past",
        resourceName: "old",
        trashedAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
      },
      {
        id: "t-future",
        userId: "u1",
        resourceType: "worktree",
        resourceId: "s-future",
        resourceName: "new",
        trashedAt: now,
        expiresAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
      },
    );

    const result = await TrashService.emptyAllTrash("u1");

    expect(permanentlyDeleteWorktreeMock).toHaveBeenCalledTimes(2);
    expect(result.deletedCount).toBe(2);
    expect(result.deletedIds).toEqual(
      expect.arrayContaining(["t-past", "t-future"]),
    );
  });

  it("returns 0 when there are no trash items", async () => {
    const result = await TrashService.emptyAllTrash("u1");
    expect(permanentlyDeleteWorktreeMock).not.toHaveBeenCalled();
    expect(result.deletedCount).toBe(0);
    expect(result.deletedIds).toEqual([]);
  });

  it("continues through failures and reports only successful deletions", async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    rows.push(
      {
        id: "t-ok",
        userId: "u1",
        resourceType: "worktree",
        resourceId: "s1",
        resourceName: "ok",
        trashedAt: now,
        expiresAt: future,
      },
      {
        id: "t-bad",
        userId: "u1",
        resourceType: "worktree",
        resourceId: "s2",
        resourceName: "bad",
        trashedAt: now,
        expiresAt: future,
      },
    );

    permanentlyDeleteWorktreeMock.mockImplementationOnce(async () => {
      // first call succeeds
    });
    permanentlyDeleteWorktreeMock.mockImplementationOnce(async () => {
      throw new Error("fs failed");
    });

    const result = await TrashService.emptyAllTrash("u1");

    expect(permanentlyDeleteWorktreeMock).toHaveBeenCalledTimes(2);
    expect(result.deletedCount).toBe(1);
  });
});
