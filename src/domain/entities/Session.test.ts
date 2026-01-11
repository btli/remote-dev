import { describe, it, expect } from "bun:test";
import { Session } from "./Session";
import { InvalidValueError, InvalidStateTransitionError } from "../errors/DomainError";

describe("Session Entity", () => {
  describe("creation", () => {
    it("creates a new active session with minimal props", () => {
      const session = Session.create({
        userId: "user-123",
        name: "Test Session",
      });

      expect(session.userId).toBe("user-123");
      expect(session.name).toBe("Test Session");
      expect(session.isActive()).toBe(true);
      expect(session.id).toBeDefined();
      expect(session.tmuxSessionName).toBeDefined();
    });

    it("creates session with custom id (valid UUID)", () => {
      const customId = "123e4567-e89b-12d3-a456-426614174000";
      const session = Session.create({
        id: customId,
        userId: "user-123",
        name: "Test Session",
      });

      expect(session.id).toBe(customId);
    });

    it("creates session with all optional props", () => {
      const session = Session.create({
        userId: "user-123",
        name: "Full Session",
        projectPath: "/home/user/project",
        githubRepoId: "repo-456",
        worktreeBranch: "feature/test",
        folderId: "folder-789",
        tabOrder: 5,
      });

      expect(session.projectPath).toBe("/home/user/project");
      expect(session.githubRepoId).toBe("repo-456");
      expect(session.worktreeBranch).toBe("feature/test");
      expect(session.folderId).toBe("folder-789");
      expect(session.tabOrder).toBe(5);
    });

    it("sets default values for optional props", () => {
      const session = Session.create({
        userId: "user-123",
        name: "Test Session",
      });

      expect(session.projectPath).toBeNull();
      expect(session.githubRepoId).toBeNull();
      expect(session.worktreeBranch).toBeNull();
      expect(session.folderId).toBeNull();
      expect(session.splitGroupId).toBeNull();
      expect(session.splitOrder).toBe(0);
      expect(session.splitSize).toBe(100);
      expect(session.tabOrder).toBe(0);
    });

    it("throws on empty userId", () => {
      expect(() =>
        Session.create({
          userId: "",
          name: "Test",
        })
      ).toThrow(InvalidValueError);
    });

    it("throws on empty name", () => {
      expect(() =>
        Session.create({
          userId: "user-123",
          name: "",
        })
      ).toThrow(InvalidValueError);
    });
  });

  describe("state transitions", () => {
    describe("suspend", () => {
      it("transitions active session to suspended", () => {
        const active = Session.create({ userId: "u1", name: "Test" });
        const suspended = active.suspend();

        expect(suspended.isSuspended()).toBe(true);
        expect(suspended.isActive()).toBe(false);
      });

      it("returns a new immutable instance", () => {
        const active = Session.create({ userId: "u1", name: "Test" });
        const suspended = active.suspend();

        expect(suspended).not.toBe(active);
        expect(active.isActive()).toBe(true); // Original unchanged
      });

      it("throws when suspending suspended session", () => {
        const suspended = Session.create({ userId: "u1", name: "Test" }).suspend();

        expect(() => suspended.suspend()).toThrow(InvalidStateTransitionError);
      });

      it("throws when suspending closed session", () => {
        const closed = Session.create({ userId: "u1", name: "Test" }).close();

        expect(() => closed.suspend()).toThrow(InvalidStateTransitionError);
      });
    });

    describe("resume", () => {
      it("transitions suspended session to active", () => {
        const suspended = Session.create({ userId: "u1", name: "Test" }).suspend();
        const resumed = suspended.resume();

        expect(resumed.isActive()).toBe(true);
        expect(resumed.isSuspended()).toBe(false);
      });

      it("updates lastActivityAt when resuming", () => {
        const suspended = Session.create({ userId: "u1", name: "Test" }).suspend();
        const originalActivity = suspended.lastActivityAt;

        // Small delay to ensure different timestamp
        const resumed = suspended.resume();

        expect(resumed.lastActivityAt.getTime()).toBeGreaterThanOrEqual(
          originalActivity.getTime()
        );
      });

      it("throws when resuming active session", () => {
        const active = Session.create({ userId: "u1", name: "Test" });

        expect(() => active.resume()).toThrow(InvalidStateTransitionError);
      });

      it("throws when resuming closed session", () => {
        const closed = Session.create({ userId: "u1", name: "Test" }).close();

        expect(() => closed.resume()).toThrow(InvalidStateTransitionError);
      });
    });

    describe("close", () => {
      it("transitions active session to closed", () => {
        const active = Session.create({ userId: "u1", name: "Test" });
        const closed = active.close();

        expect(closed.isClosed()).toBe(true);
      });

      it("transitions suspended session to closed", () => {
        const suspended = Session.create({ userId: "u1", name: "Test" }).suspend();
        const closed = suspended.close();

        expect(closed.isClosed()).toBe(true);
      });

      it("throws when closing already closed session", () => {
        const closed = Session.create({ userId: "u1", name: "Test" }).close();

        expect(() => closed.close()).toThrow(InvalidStateTransitionError);
      });
    });

    describe("trash", () => {
      it("transitions active session to trashed", () => {
        const active = Session.create({ userId: "u1", name: "Test" });
        const trashed = active.trash();

        expect(trashed.status.isTrashed()).toBe(true);
      });

      it("transitions closed session to trashed", () => {
        const closed = Session.create({ userId: "u1", name: "Test" }).close();
        const trashed = closed.trash();

        expect(trashed.status.isTrashed()).toBe(true);
      });

      it("throws when trashing already trashed session", () => {
        const trashed = Session.create({ userId: "u1", name: "Test" }).trash();

        expect(() => trashed.trash()).toThrow(InvalidStateTransitionError);
      });
    });
  });

  describe("business operations", () => {
    describe("rename", () => {
      it("updates session name", () => {
        const session = Session.create({ userId: "u1", name: "Original" });
        const renamed = session.rename("New Name");

        expect(renamed.name).toBe("New Name");
      });

      it("trims whitespace from name", () => {
        const session = Session.create({ userId: "u1", name: "Original" });
        const renamed = session.rename("  Trimmed Name  ");

        expect(renamed.name).toBe("Trimmed Name");
      });

      it("throws on empty name", () => {
        const session = Session.create({ userId: "u1", name: "Original" });

        expect(() => session.rename("")).toThrow(InvalidValueError);
      });

      it("throws on whitespace-only name", () => {
        const session = Session.create({ userId: "u1", name: "Original" });

        expect(() => session.rename("   ")).toThrow(InvalidValueError);
      });
    });

    describe("folder operations", () => {
      it("moves session to folder", () => {
        const session = Session.create({ userId: "u1", name: "Test" });
        const moved = session.moveToFolder("folder-123");

        expect(moved.folderId).toBe("folder-123");
      });

      it("removes session from folder", () => {
        const session = Session.create({
          userId: "u1",
          name: "Test",
          folderId: "folder-123",
        });
        const removed = session.removeFromFolder();

        expect(removed.folderId).toBeNull();
      });
    });

    describe("split operations", () => {
      it("adds session to split group", () => {
        const session = Session.create({ userId: "u1", name: "Test" });
        const inSplit = session.addToSplit("split-123", 1, 50);

        expect(inSplit.splitGroupId).toBe("split-123");
        expect(inSplit.splitOrder).toBe(1);
        expect(inSplit.splitSize).toBe(50);
        expect(inSplit.isInSplit()).toBe(true);
      });

      it("removes session from split group", () => {
        const inSplit = Session.create({ userId: "u1", name: "Test" }).addToSplit(
          "split-123",
          1,
          50
        );
        const removed = inSplit.removeFromSplit();

        expect(removed.splitGroupId).toBeNull();
        expect(removed.splitOrder).toBe(0);
        expect(removed.splitSize).toBe(100);
        expect(removed.isInSplit()).toBe(false);
      });

      it("updates split size", () => {
        const inSplit = Session.create({ userId: "u1", name: "Test" }).addToSplit(
          "split-123",
          1,
          50
        );
        const resized = inSplit.setSplitSize(75);

        expect(resized.splitSize).toBe(75);
      });
    });

    describe("recordActivity", () => {
      it("updates lastActivityAt timestamp", () => {
        const session = Session.create({ userId: "u1", name: "Test" });
        const originalTime = session.lastActivityAt;

        const updated = session.recordActivity();

        expect(updated.lastActivityAt.getTime()).toBeGreaterThanOrEqual(
          originalTime.getTime()
        );
      });
    });
  });

  describe("query methods", () => {
    it("hasWorktree returns true when worktreeBranch is set", () => {
      const withWorktree = Session.create({
        userId: "u1",
        name: "Test",
        worktreeBranch: "feature/test",
      });
      const withoutWorktree = Session.create({ userId: "u1", name: "Test" });

      expect(withWorktree.hasWorktree()).toBe(true);
      expect(withoutWorktree.hasWorktree()).toBe(false);
    });

    it("belongsTo checks user ownership", () => {
      const session = Session.create({ userId: "user-123", name: "Test" });

      expect(session.belongsTo("user-123")).toBe(true);
      expect(session.belongsTo("other-user")).toBe(false);
    });
  });

  describe("immutability", () => {
    it("all operations return new instances", () => {
      const original = Session.create({ userId: "u1", name: "Original" });

      const renamed = original.rename("New");
      const moved = original.moveToFolder("folder");
      const suspended = original.suspend();

      // All should be different instances
      expect(renamed).not.toBe(original);
      expect(moved).not.toBe(original);
      expect(suspended).not.toBe(original);

      // Original should be unchanged
      expect(original.name).toBe("Original");
      expect(original.folderId).toBeNull();
      expect(original.isActive()).toBe(true);
    });
  });

  describe("equality", () => {
    it("equals compares meaningful fields", () => {
      const sameId = "123e4567-e89b-12d3-a456-426614174000";
      const session1 = Session.create({
        id: sameId,
        userId: "u1",
        name: "Test",
      });
      const session2 = Session.create({
        id: sameId,
        userId: "u1",
        name: "Test",
      });

      expect(session1.equals(session2)).toBe(true);
    });

    it("equals returns false for different ids", () => {
      const session1 = Session.create({ userId: "u1", name: "Test" });
      const session2 = Session.create({ userId: "u1", name: "Test" });

      expect(session1.equals(session2)).toBe(false);
    });
  });

  describe("toPlainObject", () => {
    it("serializes session to plain object", () => {
      const sessionId = "123e4567-e89b-12d3-a456-426614174000";
      const session = Session.create({
        id: sessionId,
        userId: "user-123",
        name: "Test Session",
        projectPath: "/path/to/project",
      });

      const plain = session.toPlainObject();

      expect(plain.id).toBe(sessionId);
      expect(plain.userId).toBe("user-123");
      expect(plain.name).toBe("Test Session");
      expect(plain.status).toBe("active");
      expect(typeof plain.tmuxSessionName).toBe("string");
    });
  });
});
