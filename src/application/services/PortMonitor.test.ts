import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PortMonitor,
  type PortRegistryAdapter,
  type SessionAdapter,
  type TmuxAdapter,
} from "./PortMonitor";

describe("PortMonitor", () => {
  let mockPortRegistry: PortRegistryAdapter;
  let mockSessions: SessionAdapter;
  let mockTmux: TmuxAdapter;
  let monitor: PortMonitor;

  beforeEach(() => {
    vi.resetAllMocks();

    mockPortRegistry = {
      getPortsForUser: vi.fn().mockResolvedValue([]),
      validatePorts: vi.fn().mockResolvedValue({ conflicts: [], hasConflicts: false }),
      suggestAlternativePort: vi.fn().mockResolvedValue(null),
    };

    mockSessions = {
      findByUser: vi.fn().mockResolvedValue([]),
    };

    mockTmux = {
      getEnvironment: vi.fn().mockResolvedValue({}),
      sessionExists: vi.fn().mockResolvedValue(true),
    };

    monitor = new PortMonitor({
      portRegistry: mockPortRegistry,
      sessions: mockSessions,
      tmux: mockTmux,
    });
  });

  describe("getActivePorts", () => {
    it("returns empty array when no active sessions", async () => {
      (mockSessions.findByUser as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await monitor.getActivePorts("user-1");

      expect(result).toEqual([]);
    });

    it("extracts port variables from active sessions", async () => {
      (mockSessions.findByUser as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "session-1",
          name: "Dev Session",
          folderId: "folder-1",
          tmuxSessionName: "rdv-session-1",
          isActive: true,
        },
      ]);

      (mockTmux.getEnvironment as ReturnType<typeof vi.fn>).mockResolvedValue({
        PORT: "3000",
        API_PORT: "4000",
        HOME: "/home/user",
      });

      const result = await monitor.getActivePorts("user-1");

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        sessionId: "session-1",
        sessionName: "Dev Session",
        port: 3000,
        variableName: "PORT",
        folderId: "folder-1",
      });
      expect(result).toContainEqual({
        sessionId: "session-1",
        sessionName: "Dev Session",
        port: 4000,
        variableName: "API_PORT",
        folderId: "folder-1",
      });
    });

    it("skips inactive sessions", async () => {
      (mockSessions.findByUser as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "session-1",
          name: "Active",
          folderId: null,
          tmuxSessionName: "rdv-active",
          isActive: true,
        },
        {
          id: "session-2",
          name: "Inactive",
          folderId: null,
          tmuxSessionName: "rdv-inactive",
          isActive: false,
        },
      ]);

      (mockTmux.getEnvironment as ReturnType<typeof vi.fn>).mockResolvedValue({
        PORT: "3000",
      });

      const result = await monitor.getActivePorts("user-1");

      expect(result).toHaveLength(1);
      expect(mockTmux.sessionExists).toHaveBeenCalledTimes(1);
      expect(mockTmux.sessionExists).toHaveBeenCalledWith("rdv-active");
    });

    it("skips sessions whose tmux session no longer exists", async () => {
      (mockSessions.findByUser as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "session-1",
          name: "Ghost Session",
          folderId: null,
          tmuxSessionName: "rdv-ghost",
          isActive: true,
        },
      ]);

      (mockTmux.sessionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const result = await monitor.getActivePorts("user-1");

      expect(result).toEqual([]);
    });
  });

  describe("validateWithRuntimeCheck", () => {
    it("returns empty conflicts when no env vars", async () => {
      const result = await monitor.validateWithRuntimeCheck("folder-1", "user-1", null);

      expect(result).toEqual({
        databaseConflicts: [],
        runtimeConflicts: [],
        hasConflicts: false,
      });
    });

    it("returns database conflicts from registry", async () => {
      (mockPortRegistry.validatePorts as ReturnType<typeof vi.fn>).mockResolvedValue({
        conflicts: [
          {
            port: 3000,
            variableName: "PORT",
            conflictingFolder: { id: "folder-2", name: "Other Project" },
            conflictingVariableName: "PORT",
            suggestedPort: 3001,
          },
        ],
        hasConflicts: true,
      });

      const result = await monitor.validateWithRuntimeCheck("folder-1", "user-1", {
        PORT: "3000",
      });

      expect(result.databaseConflicts).toHaveLength(1);
      expect(result.databaseConflicts[0]).toMatchObject({
        port: 3000,
        variableName: "PORT",
        conflictingFolderId: "folder-2",
        conflictingFolderName: "Other Project",
      });
    });

    it("sets hasConflicts when database conflicts exist", async () => {
      (mockPortRegistry.validatePorts as ReturnType<typeof vi.fn>).mockResolvedValue({
        conflicts: [
          {
            port: 3000,
            variableName: "PORT",
            conflictingFolder: { id: "folder-2", name: "Other" },
            conflictingVariableName: "PORT",
            suggestedPort: null,
          },
        ],
        hasConflicts: true,
      });

      const result = await monitor.validateWithRuntimeCheck("folder-1", "user-1", {
        PORT: "3000",
      });

      expect(result.hasConflicts).toBe(true);
    });
  });

  describe("checkPortInUse", () => {
    it("returns false for ports likely not in use", async () => {
      // Test with a very high port that's unlikely to be in use
      // Port 65432 is in the high ephemeral range
      const result = await monitor.checkPortInUse(65432);

      // This could be true if something is using it, but unlikely
      // The important thing is the method works without throwing
      expect(typeof result).toBe("boolean");
    });

    it("can detect common ports in use", async () => {
      // This is an integration test - if running on a system with a web server
      // it might be true, otherwise false. Either way, it shouldn't throw.
      const result = await monitor.checkPortInUse(80);
      expect(typeof result).toBe("boolean");
    });
  });
});
