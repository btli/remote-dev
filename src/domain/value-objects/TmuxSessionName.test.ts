/**
 * TmuxSessionName Value Object Tests
 *
 * Tests cover:
 * - fromString validation for all supported patterns
 * - generate creates valid names
 * - fromSessionId conversion
 * - getSessionId extraction
 * - Value equality
 * - Error handling for invalid inputs
 */
import { describe, it, expect } from "vitest";
import { TmuxSessionName } from "./TmuxSessionName";
import { InvalidValueError } from "../errors/DomainError";

describe("TmuxSessionName Value Object", () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // fromString Tests - Valid Patterns
  // ─────────────────────────────────────────────────────────────────────────────

  describe("fromString", () => {
    describe("valid patterns", () => {
      it("should accept rdv-{uuid} format", () => {
        const name = TmuxSessionName.fromString("rdv-123e4567-e89b-12d3-a456-426614174000");
        expect(name.toString()).toBe("rdv-123e4567-e89b-12d3-a456-426614174000");
      });

      it("should accept rdv-session-{uuid} format", () => {
        const name = TmuxSessionName.fromString("rdv-session-123e4567-e89b-12d3-a456-426614174000");
        expect(name.toString()).toBe("rdv-session-123e4567-e89b-12d3-a456-426614174000");
      });

      it("should accept rdv-task-{uuid} format", () => {
        const name = TmuxSessionName.fromString("rdv-task-123e4567-e89b-12d3-a456-426614174000");
        expect(name.toString()).toBe("rdv-task-123e4567-e89b-12d3-a456-426614174000");
      });

      it("should accept rdv-folder-{slug} format", () => {
        const name = TmuxSessionName.fromString("rdv-folder-my-project");
        expect(name.toString()).toBe("rdv-folder-my-project");
      });

      it("should accept rdv-folder-{uuid} format", () => {
        const name = TmuxSessionName.fromString("rdv-folder-123e4567-e89b-12d3-a456-426614174000");
        expect(name.toString()).toBe("rdv-folder-123e4567-e89b-12d3-a456-426614174000");
      });

      it("should accept rdv-master-control special name", () => {
        const name = TmuxSessionName.fromString("rdv-master-control");
        expect(name.toString()).toBe("rdv-master-control");
      });

      it("should accept uppercase UUIDs", () => {
        const name = TmuxSessionName.fromString("rdv-123E4567-E89B-12D3-A456-426614174000");
        expect(name.toString()).toBe("rdv-123E4567-E89B-12D3-A456-426614174000");
      });

      it("should accept folder names with underscores", () => {
        const name = TmuxSessionName.fromString("rdv-folder-my_project_name");
        expect(name.toString()).toBe("rdv-folder-my_project_name");
      });
    });

    describe("invalid inputs", () => {
      it("should reject empty string", () => {
        expect(() => TmuxSessionName.fromString("")).toThrow(InvalidValueError);
      });

      it("should reject null", () => {
        expect(() => TmuxSessionName.fromString(null as unknown as string)).toThrow(InvalidValueError);
      });

      it("should reject undefined", () => {
        expect(() => TmuxSessionName.fromString(undefined as unknown as string)).toThrow(InvalidValueError);
      });

      it("should reject names without rdv prefix", () => {
        expect(() => TmuxSessionName.fromString("my-session-123e4567-e89b-12d3-a456-426614174000")).toThrow(InvalidValueError);
      });

      it("should reject rdv- without valid suffix", () => {
        expect(() => TmuxSessionName.fromString("rdv-invalid")).toThrow(InvalidValueError);
      });

      it("should reject invalid UUID format after rdv-", () => {
        expect(() => TmuxSessionName.fromString("rdv-not-a-valid-uuid")).toThrow(InvalidValueError);
      });

      it("should reject partial UUIDs", () => {
        expect(() => TmuxSessionName.fromString("rdv-123e4567")).toThrow(InvalidValueError);
      });

      it("should reject names with colons", () => {
        expect(() => TmuxSessionName.fromString("rdv-session:123")).toThrow(InvalidValueError);
      });

      it("should reject names with periods", () => {
        expect(() => TmuxSessionName.fromString("rdv-session.123")).toThrow(InvalidValueError);
      });

      it("should reject arbitrary special names", () => {
        expect(() => TmuxSessionName.fromString("rdv-admin")).toThrow(InvalidValueError);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // generate Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("generate", () => {
    it("should generate a valid tmux session name", () => {
      const name = TmuxSessionName.generate();
      expect(name.toString()).toMatch(/^rdv-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it("should generate unique names", () => {
      const name1 = TmuxSessionName.generate();
      const name2 = TmuxSessionName.generate();
      expect(name1.toString()).not.toBe(name2.toString());
    });

    it("should generate names that can be parsed back", () => {
      const name = TmuxSessionName.generate();
      const parsed = TmuxSessionName.fromString(name.toString());
      expect(parsed.toString()).toBe(name.toString());
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // fromSessionId Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("fromSessionId", () => {
    it("should create name from valid UUID", () => {
      const sessionId = "123e4567-e89b-12d3-a456-426614174000";
      const name = TmuxSessionName.fromSessionId(sessionId);
      expect(name.toString()).toBe("rdv-123e4567-e89b-12d3-a456-426614174000");
    });

    it("should throw for invalid session ID", () => {
      expect(() => TmuxSessionName.fromSessionId("invalid-id")).toThrow(InvalidValueError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getSessionId Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getSessionId", () => {
    it("should extract UUID from rdv-{uuid} format", () => {
      const name = TmuxSessionName.fromString("rdv-123e4567-e89b-12d3-a456-426614174000");
      expect(name.getSessionId()).toBe("123e4567-e89b-12d3-a456-426614174000");
    });

    it("should extract UUID from rdv-session-{uuid} format", () => {
      const name = TmuxSessionName.fromString("rdv-session-123e4567-e89b-12d3-a456-426614174000");
      expect(name.getSessionId()).toBe("123e4567-e89b-12d3-a456-426614174000");
    });

    it("should extract UUID from rdv-task-{uuid} format", () => {
      const name = TmuxSessionName.fromString("rdv-task-123e4567-e89b-12d3-a456-426614174000");
      expect(name.getSessionId()).toBe("123e4567-e89b-12d3-a456-426614174000");
    });

    it("should extract slug from rdv-folder-{slug} format", () => {
      const name = TmuxSessionName.fromString("rdv-folder-my-project");
      expect(name.getSessionId()).toBe("my-project");
    });

    it("should extract identifier from rdv-master-control", () => {
      const name = TmuxSessionName.fromString("rdv-master-control");
      expect(name.getSessionId()).toBe("master-control");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // equals Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("equals", () => {
    it("should return true for identical values", () => {
      const name1 = TmuxSessionName.fromString("rdv-123e4567-e89b-12d3-a456-426614174000");
      const name2 = TmuxSessionName.fromString("rdv-123e4567-e89b-12d3-a456-426614174000");
      expect(name1.equals(name2)).toBe(true);
    });

    it("should return false for different values", () => {
      const name1 = TmuxSessionName.fromString("rdv-123e4567-e89b-12d3-a456-426614174000");
      const name2 = TmuxSessionName.fromString("rdv-987fcdeb-51a2-34b5-c678-901234567890");
      expect(name1.equals(name2)).toBe(false);
    });

    it("should return false for different prefixes with same UUID", () => {
      const name1 = TmuxSessionName.fromString("rdv-123e4567-e89b-12d3-a456-426614174000");
      const name2 = TmuxSessionName.fromString("rdv-session-123e4567-e89b-12d3-a456-426614174000");
      expect(name1.equals(name2)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // toString Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("toString", () => {
    it("should return the original string value", () => {
      const originalValue = "rdv-123e4567-e89b-12d3-a456-426614174000";
      const name = TmuxSessionName.fromString(originalValue);
      expect(name.toString()).toBe(originalValue);
    });

    it("should be usable in string interpolation", () => {
      const name = TmuxSessionName.fromString("rdv-123e4567-e89b-12d3-a456-426614174000");
      const command = `tmux attach -t ${name}`;
      expect(command).toBe("tmux attach -t rdv-123e4567-e89b-12d3-a456-426614174000");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Edge Cases
  // ─────────────────────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should handle all zeros UUID", () => {
      const name = TmuxSessionName.fromString("rdv-00000000-0000-0000-0000-000000000000");
      expect(name.toString()).toBe("rdv-00000000-0000-0000-0000-000000000000");
    });

    it("should handle all F's UUID", () => {
      const name = TmuxSessionName.fromString("rdv-ffffffff-ffff-ffff-ffff-ffffffffffff");
      expect(name.toString()).toBe("rdv-ffffffff-ffff-ffff-ffff-ffffffffffff");
    });

    it("should preserve case in folder slugs", () => {
      const name = TmuxSessionName.fromString("rdv-folder-MyProject");
      expect(name.toString()).toBe("rdv-folder-MyProject");
    });

    it("should handle single character folder names", () => {
      const name = TmuxSessionName.fromString("rdv-folder-a");
      expect(name.toString()).toBe("rdv-folder-a");
    });

    it("should handle numeric folder names", () => {
      const name = TmuxSessionName.fromString("rdv-folder-12345");
      expect(name.toString()).toBe("rdv-folder-12345");
    });
  });
});
