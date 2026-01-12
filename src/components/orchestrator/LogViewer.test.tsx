/**
 * Tests for LogViewer utility functions
 */

import { describe, expect, it } from "vitest";
import { createLogEntry } from "./LogViewer";

describe("LogViewer utilities", () => {
  describe("createLogEntry", () => {
    it("should create a log entry with required fields", () => {
      const entry = createLogEntry("info", "agent", "Test message");

      expect(entry.level).toBe("info");
      expect(entry.source).toBe("agent");
      expect(entry.message).toBe("Test message");
      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeInstanceOf(Date);
    });

    it("should create a log entry with optional fields", () => {
      const entry = createLogEntry("error", "system", "Error occurred", {
        sessionId: "session-123",
        command: "npm test",
        duration: 5000,
        metadata: { code: 1 },
      });

      expect(entry.level).toBe("error");
      expect(entry.source).toBe("system");
      expect(entry.sessionId).toBe("session-123");
      expect(entry.command).toBe("npm test");
      expect(entry.duration).toBe(5000);
      expect(entry.metadata).toEqual({ code: 1 });
    });

    it("should generate unique IDs for each entry", () => {
      const entry1 = createLogEntry("info", "agent", "Message 1");
      const entry2 = createLogEntry("info", "agent", "Message 2");

      expect(entry1.id).not.toBe(entry2.id);
    });

    it("should support all log levels", () => {
      const debugEntry = createLogEntry("debug", "agent", "Debug");
      const infoEntry = createLogEntry("info", "agent", "Info");
      const warnEntry = createLogEntry("warn", "agent", "Warn");
      const errorEntry = createLogEntry("error", "agent", "Error");

      expect(debugEntry.level).toBe("debug");
      expect(infoEntry.level).toBe("info");
      expect(warnEntry.level).toBe("warn");
      expect(errorEntry.level).toBe("error");
    });

    it("should support all log sources", () => {
      const agentEntry = createLogEntry("info", "agent", "Agent");
      const systemEntry = createLogEntry("info", "system", "System");
      const commandEntry = createLogEntry("info", "command", "Command");
      const outputEntry = createLogEntry("info", "output", "Output");
      const userEntry = createLogEntry("info", "user", "User");

      expect(agentEntry.source).toBe("agent");
      expect(systemEntry.source).toBe("system");
      expect(commandEntry.source).toBe("command");
      expect(outputEntry.source).toBe("output");
      expect(userEntry.source).toBe("user");
    });
  });
});
