import { describe, it, expect, beforeEach, vi } from "vitest";
import { PortRegistryAdapterImpl } from "./PortRegistryAdapterImpl";

// Mock the underlying functional service. The adapter is pure mapping logic,
// so stubbing the service functions is sufficient to assert the impedance
// matching (null-projectId filtering, conflictingFolder→conflictingProject).
vi.mock("@/services/port-registry-service", () => ({
  getPortsForUser: vi.fn(),
  validatePorts: vi.fn(),
  suggestAlternativePort: vi.fn(),
}));

import * as PortRegistryService from "@/services/port-registry-service";

const mockGetPortsForUser = vi.mocked(PortRegistryService.getPortsForUser);
const mockValidatePorts = vi.mocked(PortRegistryService.validatePorts);
const mockSuggestAlternativePort = vi.mocked(
  PortRegistryService.suggestAlternativePort
);

describe("PortRegistryAdapterImpl", () => {
  let adapter: PortRegistryAdapterImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new PortRegistryAdapterImpl();
  });

  describe("getPortsForUser", () => {
    it("maps entries to { projectId, port, variableName }", async () => {
      mockGetPortsForUser.mockResolvedValue([
        {
          id: "e1",
          projectId: "proj-1",
          userId: "user-1",
          port: 3000,
          variableName: "PORT",
          createdAt: new Date(),
        },
      ]);

      const result = await adapter.getPortsForUser("user-1");

      expect(mockGetPortsForUser).toHaveBeenCalledWith("user-1");
      expect(result).toEqual([
        { projectId: "proj-1", port: 3000, variableName: "PORT" },
      ]);
    });

    it("drops entries whose projectId is null", async () => {
      mockGetPortsForUser.mockResolvedValue([
        {
          id: "e1",
          projectId: null,
          userId: "user-1",
          port: 4000,
          variableName: "API_PORT",
          createdAt: new Date(),
        },
        {
          id: "e2",
          projectId: "proj-2",
          userId: "user-1",
          port: 5000,
          variableName: "DB_PORT",
          createdAt: new Date(),
        },
      ]);

      const result = await adapter.getPortsForUser("user-1");

      expect(result).toEqual([
        { projectId: "proj-2", port: 5000, variableName: "DB_PORT" },
      ]);
    });

    it("returns an empty array when there are no entries", async () => {
      mockGetPortsForUser.mockResolvedValue([]);

      const result = await adapter.getPortsForUser("user-1");

      expect(result).toEqual([]);
    });
  });

  describe("validatePorts", () => {
    it("remaps conflictingFolder to conflictingProject", async () => {
      mockValidatePorts.mockResolvedValue({
        conflicts: [
          {
            port: 3000,
            variableName: "PORT",
            conflictingFolder: { id: "proj-other", name: "Other Project" },
            conflictingVariableName: "DEV_PORT",
            suggestedPort: 3001,
          },
        ],
        hasConflicts: true,
      });

      const envVars = { PORT: "3000" };
      const result = await adapter.validatePorts(
        "proj-current",
        "user-1",
        envVars
      );

      expect(mockValidatePorts).toHaveBeenCalledWith(
        "proj-current",
        "user-1",
        envVars
      );
      expect(result).toEqual({
        conflicts: [
          {
            port: 3000,
            variableName: "PORT",
            conflictingProject: { id: "proj-other", name: "Other Project" },
            conflictingVariableName: "DEV_PORT",
            suggestedPort: 3001,
          },
        ],
        hasConflicts: true,
      });
      // The remapped result must not leak the legacy field name.
      expect(result.conflicts[0]).not.toHaveProperty("conflictingFolder");
    });

    it("passes null envVars straight through and returns no conflicts", async () => {
      mockValidatePorts.mockResolvedValue({
        conflicts: [],
        hasConflicts: false,
      });

      const result = await adapter.validatePorts("proj-1", "user-1", null);

      expect(mockValidatePorts).toHaveBeenCalledWith("proj-1", "user-1", null);
      expect(result).toEqual({ conflicts: [], hasConflicts: false });
    });
  });

  describe("suggestAlternativePort", () => {
    it("delegates to the service", async () => {
      mockSuggestAlternativePort.mockResolvedValue(3001);

      const result = await adapter.suggestAlternativePort("user-1", 3000);

      expect(mockSuggestAlternativePort).toHaveBeenCalledWith("user-1", 3000);
      expect(result).toBe(3001);
    });

    it("propagates a null suggestion", async () => {
      mockSuggestAlternativePort.mockResolvedValue(null);

      const result = await adapter.suggestAlternativePort("user-1", 65535);

      expect(result).toBeNull();
    });
  });
});
