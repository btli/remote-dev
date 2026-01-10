/**
 * Folder Domain Entity Tests
 *
 * Tests cover:
 * - Entity creation and reconstitution
 * - Invariant validation
 * - Domain methods (rename, toggle, move)
 * - Cycle detection in folder hierarchy
 * - Query methods
 */
import { describe, it, expect } from "vitest";
import { Folder } from "./Folder";
import { InvalidValueError, BusinessRuleViolationError } from "../errors/DomainError";

describe("Folder Domain Entity", () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // Creation Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("should create a folder with required properties", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "My Folder",
      });

      expect(folder.userId).toBe("user-123");
      expect(folder.name).toBe("My Folder");
      expect(folder.parentId).toBeNull();
      expect(folder.collapsed).toBe(false);
      expect(folder.sortOrder).toBe(0);
      expect(folder.id).toBeDefined();
      expect(folder.createdAt).toBeInstanceOf(Date);
      expect(folder.updatedAt).toBeInstanceOf(Date);
    });

    it("should create a folder with custom id", () => {
      const folder = Folder.create({
        id: "custom-id-123",
        userId: "user-123",
        name: "Test Folder",
      });

      expect(folder.id).toBe("custom-id-123");
    });

    it("should create a folder with parent", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Child Folder",
        parentId: "parent-123",
      });

      expect(folder.parentId).toBe("parent-123");
    });

    it("should create a folder with custom sortOrder", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Ordered Folder",
        sortOrder: 5,
      });

      expect(folder.sortOrder).toBe(5);
    });

    it("should trim folder name", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "  Trimmed Name  ",
      });

      expect(folder.name).toBe("Trimmed Name");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Reconstitute Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("reconstitute", () => {
    it("should reconstitute a folder from props", () => {
      const now = new Date();
      const folder = Folder.reconstitute({
        id: "folder-123",
        userId: "user-123",
        parentId: "parent-456",
        name: "Reconstituted Folder",
        collapsed: true,
        sortOrder: 3,
        createdAt: now,
        updatedAt: now,
      });

      expect(folder.id).toBe("folder-123");
      expect(folder.userId).toBe("user-123");
      expect(folder.parentId).toBe("parent-456");
      expect(folder.name).toBe("Reconstituted Folder");
      expect(folder.collapsed).toBe(true);
      expect(folder.sortOrder).toBe(3);
      expect(folder.createdAt).toBe(now);
      expect(folder.updatedAt).toBe(now);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Invariant Validation Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("invariant validation", () => {
    it("should throw InvalidValueError for empty id", () => {
      expect(() =>
        Folder.reconstitute({
          id: "",
          userId: "user-123",
          parentId: null,
          name: "Test",
          collapsed: false,
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ).toThrow(InvalidValueError);
    });

    it("should throw InvalidValueError for empty userId", () => {
      expect(() =>
        Folder.reconstitute({
          id: "folder-123",
          userId: "",
          parentId: null,
          name: "Test",
          collapsed: false,
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ).toThrow(InvalidValueError);
    });

    it("should throw InvalidValueError for empty name", () => {
      expect(() =>
        Folder.create({
          userId: "user-123",
          name: "",
        })
      ).toThrow(InvalidValueError);
    });

    it("should throw InvalidValueError for whitespace-only name", () => {
      expect(() =>
        Folder.create({
          userId: "user-123",
          name: "   ",
        })
      ).toThrow(InvalidValueError);
    });

    it("should throw BusinessRuleViolationError for self-reference", () => {
      expect(() =>
        Folder.reconstitute({
          id: "folder-123",
          userId: "user-123",
          parentId: "folder-123", // Self-reference
          name: "Self-Referencing Folder",
          collapsed: false,
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ).toThrow(BusinessRuleViolationError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Domain Method Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("rename", () => {
    it("should rename folder and update updatedAt", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Original Name",
      });

      const renamed = folder.rename("New Name");

      expect(renamed.name).toBe("New Name");
      expect(renamed.id).toBe(folder.id);
      expect(renamed.updatedAt.getTime()).toBeGreaterThanOrEqual(folder.updatedAt.getTime());
    });

    it("should trim new name", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Original",
      });

      const renamed = folder.rename("  Trimmed New Name  ");

      expect(renamed.name).toBe("Trimmed New Name");
    });

    it("should throw InvalidValueError for empty name", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Original",
      });

      expect(() => folder.rename("")).toThrow(InvalidValueError);
    });

    it("should throw InvalidValueError for whitespace-only name", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Original",
      });

      expect(() => folder.rename("   ")).toThrow(InvalidValueError);
    });
  });

  describe("toggleCollapsed", () => {
    it("should toggle collapsed from false to true", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Test Folder",
      });

      expect(folder.collapsed).toBe(false);
      const toggled = folder.toggleCollapsed();
      expect(toggled.collapsed).toBe(true);
    });

    it("should toggle collapsed from true to false", () => {
      const folder = Folder.reconstitute({
        id: "folder-123",
        userId: "user-123",
        parentId: null,
        name: "Test",
        collapsed: true,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const toggled = folder.toggleCollapsed();
      expect(toggled.collapsed).toBe(false);
    });
  });

  describe("setCollapsed", () => {
    it("should set collapsed to true", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Test",
      });

      const updated = folder.setCollapsed(true);
      expect(updated.collapsed).toBe(true);
    });

    it("should set collapsed to false", () => {
      const folder = Folder.reconstitute({
        id: "folder-123",
        userId: "user-123",
        parentId: null,
        name: "Test",
        collapsed: true,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const updated = folder.setCollapsed(false);
      expect(updated.collapsed).toBe(false);
    });
  });

  describe("setSortOrder", () => {
    it("should update sortOrder", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Test",
      });

      const updated = folder.setSortOrder(10);
      expect(updated.sortOrder).toBe(10);
    });

    it("should handle negative sortOrder", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Test",
      });

      const updated = folder.setSortOrder(-5);
      expect(updated.sortOrder).toBe(-5);
    });
  });

  describe("moveTo", () => {
    it("should move folder to new parent", () => {
      const folder = Folder.create({
        id: "child-folder",
        userId: "user-123",
        name: "Child",
      });

      const allFolders = [folder];
      const moved = folder.moveTo("new-parent-id", allFolders);

      expect(moved.parentId).toBe("new-parent-id");
    });

    it("should move folder to root (null parent)", () => {
      const folder = Folder.create({
        id: "nested-folder",
        userId: "user-123",
        name: "Nested",
        parentId: "parent-123",
      });

      const allFolders = [folder];
      const moved = folder.moveTo(null, allFolders);

      expect(moved.parentId).toBeNull();
    });

    it("should throw BusinessRuleViolationError for self-move", () => {
      const folder = Folder.create({
        id: "folder-123",
        userId: "user-123",
        name: "Test",
      });

      expect(() => folder.moveTo("folder-123", [folder])).toThrow(BusinessRuleViolationError);
    });

    it("should throw BusinessRuleViolationError for circular reference", () => {
      // Create a folder hierarchy: grandparent -> parent -> child
      const grandparent = Folder.create({
        id: "grandparent",
        userId: "user-123",
        name: "Grandparent",
        parentId: null,
      });

      const parent = Folder.create({
        id: "parent",
        userId: "user-123",
        name: "Parent",
        parentId: "grandparent",
      });

      const child = Folder.create({
        id: "child",
        userId: "user-123",
        name: "Child",
        parentId: "parent",
      });

      const allFolders = [grandparent, parent, child];

      // Attempting to move grandparent under child would create a cycle
      expect(() => grandparent.moveTo("child", allFolders)).toThrow(BusinessRuleViolationError);
    });

    it("should detect deep circular references", () => {
      // Create a deep hierarchy: A -> B -> C -> D
      const folderA = Folder.create({
        id: "a",
        userId: "user-123",
        name: "A",
        parentId: null,
      });

      const folderB = Folder.create({
        id: "b",
        userId: "user-123",
        name: "B",
        parentId: "a",
      });

      const folderC = Folder.create({
        id: "c",
        userId: "user-123",
        name: "C",
        parentId: "b",
      });

      const folderD = Folder.create({
        id: "d",
        userId: "user-123",
        name: "D",
        parentId: "c",
      });

      const allFolders = [folderA, folderB, folderC, folderD];

      // Moving A under D would create: D -> A -> B -> C -> D (cycle)
      expect(() => folderA.moveTo("d", allFolders)).toThrow(BusinessRuleViolationError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Method Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("isRoot", () => {
    it("should return true for root folder", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Root Folder",
      });

      expect(folder.isRoot()).toBe(true);
    });

    it("should return false for nested folder", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Nested Folder",
        parentId: "parent-123",
      });

      expect(folder.isRoot()).toBe(false);
    });
  });

  describe("belongsTo", () => {
    it("should return true for matching userId", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Test",
      });

      expect(folder.belongsTo("user-123")).toBe(true);
    });

    it("should return false for different userId", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Test",
      });

      expect(folder.belongsTo("user-456")).toBe(false);
    });
  });

  describe("isChildOf", () => {
    it("should return true when parent matches", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Child",
        parentId: "parent-123",
      });

      expect(folder.isChildOf("parent-123")).toBe(true);
    });

    it("should return false when parent does not match", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Child",
        parentId: "parent-123",
      });

      expect(folder.isChildOf("other-parent")).toBe(false);
    });

    it("should return false for root folder", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Root",
      });

      expect(folder.isChildOf("any-id")).toBe(false);
    });
  });

  describe("getAncestorIds", () => {
    it("should return empty array for root folder", () => {
      const root = Folder.create({
        id: "root",
        userId: "user-123",
        name: "Root",
      });

      expect(root.getAncestorIds([root])).toEqual([]);
    });

    it("should return parent id for direct child", () => {
      const root = Folder.create({
        id: "root",
        userId: "user-123",
        name: "Root",
      });

      const child = Folder.create({
        id: "child",
        userId: "user-123",
        name: "Child",
        parentId: "root",
      });

      expect(child.getAncestorIds([root, child])).toEqual(["root"]);
    });

    it("should return all ancestor ids in order", () => {
      const root = Folder.create({
        id: "root",
        userId: "user-123",
        name: "Root",
      });

      const parent = Folder.create({
        id: "parent",
        userId: "user-123",
        name: "Parent",
        parentId: "root",
      });

      const child = Folder.create({
        id: "child",
        userId: "user-123",
        name: "Child",
        parentId: "parent",
      });

      const grandchild = Folder.create({
        id: "grandchild",
        userId: "user-123",
        name: "Grandchild",
        parentId: "child",
      });

      const allFolders = [root, parent, child, grandchild];

      expect(grandchild.getAncestorIds(allFolders)).toEqual(["child", "parent", "root"]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Serialization Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("toPlainObject", () => {
    it("should return all properties as plain object", () => {
      const now = new Date();
      const folder = Folder.reconstitute({
        id: "folder-123",
        userId: "user-123",
        parentId: "parent-456",
        name: "Test Folder",
        collapsed: true,
        sortOrder: 5,
        createdAt: now,
        updatedAt: now,
      });

      const plain = folder.toPlainObject();

      expect(plain).toEqual({
        id: "folder-123",
        userId: "user-123",
        parentId: "parent-456",
        name: "Test Folder",
        collapsed: true,
        sortOrder: 5,
        createdAt: now,
        updatedAt: now,
      });
    });

    it("should return a copy (not the original object)", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Test",
      });

      const plain1 = folder.toPlainObject();
      const plain2 = folder.toPlainObject();

      expect(plain1).not.toBe(plain2);
      expect(plain1).toEqual(plain2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Immutability Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("immutability", () => {
    it("should return new instance on rename", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Original",
      });

      const renamed = folder.rename("New Name");

      expect(renamed).not.toBe(folder);
      expect(folder.name).toBe("Original");
      expect(renamed.name).toBe("New Name");
    });

    it("should return new instance on toggleCollapsed", () => {
      const folder = Folder.create({
        userId: "user-123",
        name: "Test",
      });

      const toggled = folder.toggleCollapsed();

      expect(toggled).not.toBe(folder);
      expect(folder.collapsed).toBe(false);
      expect(toggled.collapsed).toBe(true);
    });

    it("should return new instance on moveTo", () => {
      const folder = Folder.create({
        id: "folder-123",
        userId: "user-123",
        name: "Test",
      });

      const moved = folder.moveTo("new-parent", [folder]);

      expect(moved).not.toBe(folder);
      expect(folder.parentId).toBeNull();
      expect(moved.parentId).toBe("new-parent");
    });
  });
});
