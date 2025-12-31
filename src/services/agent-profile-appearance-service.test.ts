import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("@/db", () => ({
  db: {
    query: {
      profileAppearanceSettings: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(),
    })),
  },
}));

import { db } from "@/db";
import {
  getProfileAppearance,
  getProfileAppearanceById,
  updateProfileAppearance,
  deleteProfileAppearance,
  getAllProfileAppearances,
} from "./agent-profile-appearance-service";

describe("AgentProfileAppearanceService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockAppearanceRecord = {
    id: "appearance-123",
    profileId: "profile-456",
    userId: "user-789",
    appearanceMode: "dark" as const,
    lightColorScheme: "ocean" as const,
    darkColorScheme: "midnight" as const,
    terminalOpacity: 100,
    terminalBlur: 0,
    terminalCursorStyle: "block" as const,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
  };

  describe("getProfileAppearance", () => {
    it("returns profile appearance settings when found", async () => {
      vi.mocked(db.query.profileAppearanceSettings.findFirst).mockResolvedValue(
        mockAppearanceRecord
      );

      const result = await getProfileAppearance("profile-456", "user-789");

      expect(result).toEqual({
        id: "appearance-123",
        profileId: "profile-456",
        userId: "user-789",
        appearanceMode: "dark",
        lightColorScheme: "ocean",
        darkColorScheme: "midnight",
        terminalOpacity: 100,
        terminalBlur: 0,
        terminalCursorStyle: "block",
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it("returns null when no settings found", async () => {
      vi.mocked(db.query.profileAppearanceSettings.findFirst).mockResolvedValue(
        undefined
      );

      const result = await getProfileAppearance("profile-456", "user-789");

      expect(result).toBeNull();
    });
  });

  describe("getProfileAppearanceById", () => {
    it("returns profile appearance by profile ID only", async () => {
      vi.mocked(db.query.profileAppearanceSettings.findFirst).mockResolvedValue(
        mockAppearanceRecord
      );

      const result = await getProfileAppearanceById("profile-456");

      expect(result).not.toBeNull();
      expect(result?.profileId).toBe("profile-456");
    });

    it("returns null when not found", async () => {
      vi.mocked(db.query.profileAppearanceSettings.findFirst).mockResolvedValue(
        undefined
      );

      const result = await getProfileAppearanceById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("updateProfileAppearance", () => {
    it("updates existing appearance settings", async () => {
      // First call returns existing record
      vi.mocked(db.query.profileAppearanceSettings.findFirst).mockResolvedValue(
        mockAppearanceRecord
      );

      const mockUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([
              { ...mockAppearanceRecord, appearanceMode: "light" as const },
            ]),
          })),
        })),
      }));
      vi.mocked(db.update).mockImplementation(mockUpdate as any);

      const result = await updateProfileAppearance("profile-456", "user-789", {
        appearanceMode: "light",
      });

      expect(result.appearanceMode).toBe("light");
      expect(db.update).toHaveBeenCalled();
    });

    it("creates new settings when none exist", async () => {
      // First call returns null (no existing settings)
      vi.mocked(db.query.profileAppearanceSettings.findFirst).mockResolvedValue(
        undefined
      );

      const mockInsert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([mockAppearanceRecord]),
        })),
      }));
      vi.mocked(db.insert).mockImplementation(mockInsert as any);

      const result = await updateProfileAppearance("profile-456", "user-789", {
        appearanceMode: "dark",
      });

      expect(result).toBeDefined();
      expect(db.insert).toHaveBeenCalled();
    });

    it("applies default values when creating new settings", async () => {
      vi.mocked(db.query.profileAppearanceSettings.findFirst).mockResolvedValue(
        undefined
      );

      const mockInsert = vi.fn(() => ({
        values: vi.fn((values) => {
          // Verify defaults are applied
          expect(values.appearanceMode).toBe("system");
          expect(values.lightColorScheme).toBe("ocean");
          expect(values.darkColorScheme).toBe("midnight");
          expect(values.terminalOpacity).toBe(100);
          expect(values.terminalBlur).toBe(0);
          expect(values.terminalCursorStyle).toBe("block");
          return {
            returning: vi.fn().mockResolvedValue([mockAppearanceRecord]),
          };
        }),
      }));
      vi.mocked(db.insert).mockImplementation(mockInsert as any);

      await updateProfileAppearance("profile-456", "user-789", {});

      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe("deleteProfileAppearance", () => {
    it("deletes profile appearance settings", async () => {
      const mockDelete = vi.fn(() => ({
        where: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
      }));
      vi.mocked(db.delete).mockImplementation(mockDelete as any);

      const result = await deleteProfileAppearance("profile-456", "user-789");

      expect(result).toBe(true);
      expect(db.delete).toHaveBeenCalled();
    });

    it("returns false when nothing to delete", async () => {
      const mockDelete = vi.fn(() => ({
        where: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
      }));
      vi.mocked(db.delete).mockImplementation(mockDelete as any);

      const result = await deleteProfileAppearance("nonexistent", "user-789");

      expect(result).toBe(false);
    });
  });

  describe("getAllProfileAppearances", () => {
    it("returns all profile appearances for a user", async () => {
      vi.mocked(db.query.profileAppearanceSettings.findMany).mockResolvedValue([
        mockAppearanceRecord,
        { ...mockAppearanceRecord, id: "appearance-456", profileId: "profile-789" },
      ]);

      const result = await getAllProfileAppearances("user-789");

      expect(result).toHaveLength(2);
      expect(result[0].profileId).toBe("profile-456");
      expect(result[1].profileId).toBe("profile-789");
    });

    it("returns empty array when no appearances found", async () => {
      vi.mocked(db.query.profileAppearanceSettings.findMany).mockResolvedValue(
        []
      );

      const result = await getAllProfileAppearances("user-789");

      expect(result).toEqual([]);
    });
  });
});
