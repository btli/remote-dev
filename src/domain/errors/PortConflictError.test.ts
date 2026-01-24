import { describe, it, expect } from "vitest";
import { PortConflictError, type PortConflict } from "./PortConflictError";

describe("PortConflictError", () => {
  const folderConflict: PortConflict = {
    port: 3000,
    variableName: "PORT",
    conflictSource: {
      type: "folder",
      folderId: "folder-123",
      folderName: "My Project",
      variableName: "API_PORT",
    },
    suggestedPort: 3001,
  };

  const runtimeConflict: PortConflict = {
    port: 8080,
    variableName: "API_PORT",
    conflictSource: {
      type: "runtime",
      processInfo: "node (pid 12345)",
    },
    suggestedPort: 8081,
  };

  describe("constructor", () => {
    it("should create error with conflicts", () => {
      const error = new PortConflictError([folderConflict]);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(PortConflictError);
      expect(error.code).toBe("PORT_CONFLICT");
    });

    it("should freeze conflicts array", () => {
      const conflicts = [folderConflict];
      const error = new PortConflictError(conflicts);

      // Original array modification should not affect error
      conflicts.push(runtimeConflict);
      expect(error.conflicts).toHaveLength(1);

      // Returned array should be frozen
      expect(Object.isFrozen(error.conflicts)).toBe(true);
    });
  });

  describe("message formatting", () => {
    it("should format single folder conflict", () => {
      const error = new PortConflictError([folderConflict]);

      expect(error.message).toContain("Port 3000");
      expect(error.message).toContain("PORT");
      expect(error.message).toContain("My Project");
      expect(error.message).toContain("3001");
    });

    it("should format single runtime conflict", () => {
      const error = new PortConflictError([runtimeConflict]);

      expect(error.message).toContain("Port 8080");
      expect(error.message).toContain("API_PORT");
      expect(error.message).toContain("another process");
      expect(error.message).toContain("node (pid 12345)");
    });

    it("should format multiple conflicts", () => {
      const error = new PortConflictError([folderConflict, runtimeConflict]);

      expect(error.message).toContain("2 port conflicts detected:");
      expect(error.message).toContain("Port 3000");
      expect(error.message).toContain("Port 8080");
    });

    it("should format empty conflicts", () => {
      const error = new PortConflictError([]);

      expect(error.message).toBe("No port conflicts");
    });

    it("should format conflict without suggested port", () => {
      const conflict: PortConflict = {
        port: 5000,
        variableName: "DB_PORT",
        conflictSource: {
          type: "runtime",
        },
      };
      const error = new PortConflictError([conflict]);

      expect(error.message).not.toContain("Suggested");
      expect(error.message).not.toContain("try");
    });

    it("should format runtime conflict without process info", () => {
      const conflict: PortConflict = {
        port: 5000,
        variableName: "DB_PORT",
        conflictSource: {
          type: "runtime",
        },
      };
      const error = new PortConflictError([conflict]);

      expect(error.message).toContain("in use by another process");
      expect(error.message).not.toContain("(undefined)");
    });
  });

  describe("hasConflicts", () => {
    it("should return true when conflicts exist", () => {
      const error = new PortConflictError([folderConflict]);
      expect(error.hasConflicts).toBe(true);
    });

    it("should return false when no conflicts", () => {
      const error = new PortConflictError([]);
      expect(error.hasConflicts).toBe(false);
    });
  });

  describe("databaseConflicts", () => {
    it("should filter to only folder conflicts", () => {
      const error = new PortConflictError([folderConflict, runtimeConflict]);

      expect(error.databaseConflicts).toHaveLength(1);
      expect(error.databaseConflicts[0].port).toBe(3000);
    });
  });

  describe("runtimeConflicts", () => {
    it("should filter to only runtime conflicts", () => {
      const error = new PortConflictError([folderConflict, runtimeConflict]);

      expect(error.runtimeConflicts).toHaveLength(1);
      expect(error.runtimeConflicts[0].port).toBe(8080);
    });
  });

  describe("ports", () => {
    it("should return all conflicting port numbers", () => {
      const error = new PortConflictError([folderConflict, runtimeConflict]);

      expect(error.ports).toEqual([3000, 8080]);
    });
  });

  describe("hasPortConflict", () => {
    it("should return true for conflicting port", () => {
      const error = new PortConflictError([folderConflict]);

      expect(error.hasPortConflict(3000)).toBe(true);
    });

    it("should return false for non-conflicting port", () => {
      const error = new PortConflictError([folderConflict]);

      expect(error.hasPortConflict(4000)).toBe(false);
    });
  });

  describe("getConflictForPort", () => {
    it("should return conflict for port", () => {
      const error = new PortConflictError([folderConflict, runtimeConflict]);

      const conflict = error.getConflictForPort(3000);
      expect(conflict).toBeDefined();
      expect(conflict?.variableName).toBe("PORT");
    });

    it("should return undefined for non-conflicting port", () => {
      const error = new PortConflictError([folderConflict]);

      expect(error.getConflictForPort(4000)).toBeUndefined();
    });
  });

  describe("factory methods", () => {
    describe("fromDatabaseConflict", () => {
      it("should create error for database conflict", () => {
        const error = PortConflictError.fromDatabaseConflict(
          3000,
          "PORT",
          "folder-123",
          "My Project",
          "API_PORT",
          3001
        );

        expect(error.conflicts).toHaveLength(1);
        expect(error.conflicts[0].port).toBe(3000);
        expect(error.conflicts[0].conflictSource.type).toBe("folder");
        expect(error.databaseConflicts).toHaveLength(1);
      });
    });

    describe("fromRuntimeConflict", () => {
      it("should create error for runtime conflict", () => {
        const error = PortConflictError.fromRuntimeConflict(
          8080,
          "API_PORT",
          "node (pid 12345)",
          8081
        );

        expect(error.conflicts).toHaveLength(1);
        expect(error.conflicts[0].port).toBe(8080);
        expect(error.conflicts[0].conflictSource.type).toBe("runtime");
        expect(error.runtimeConflicts).toHaveLength(1);
      });

      it("should work without process info", () => {
        const error = PortConflictError.fromRuntimeConflict(8080, "API_PORT");

        expect(error.conflicts).toHaveLength(1);
        expect(error.runtimeConflicts[0].conflictSource.type).toBe("runtime");
      });
    });
  });
});
