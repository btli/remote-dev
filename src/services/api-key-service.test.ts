/**
 * ApiKeyService Unit Tests
 *
 * Tests cover:
 * - createApiKey generation and storage
 * - validateApiKey with constant-time comparison
 * - touchApiKey last-used timestamp
 * - listApiKeys retrieval
 * - getApiKey with ownership check
 * - deleteApiKey with ownership check
 * - countApiKeys
 * - Key format validation (rdv_ prefix)
 * - Expiration handling
 */
import { describe, it, expect, vi, beforeEach } from "bun:test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = ReturnType<typeof vi.fn<any>>;

// Mock the database module
vi.mock("@/db", () => ({
  db: {
    query: {
      apiKeys: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
  },
}));

import { db } from "@/db";
import { createHash } from "crypto";
import {
  createApiKey,
  validateApiKey,
  touchApiKey,
  listApiKeys,
  getApiKey,
  deleteApiKey,
  countApiKeys,
  ApiKeyServiceError,
} from "./api-key-service";

describe("ApiKeyService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const KEY_PREFIX = "rdv_";

  // Helper to create a valid mock key hash
  function hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  const mockApiKeyRecord = {
    id: "key-123",
    userId: "user-456",
    name: "Test Key",
    keyPrefix: "rdv_abcdefgh",
    keyHash: hashKey("rdv_abcdefgh1234567890123456789012345678901234"),
    lastUsedAt: null,
    expiresAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // createApiKey Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("createApiKey", () => {
    it("creates API key with rdv_ prefix", async () => {
      const mockInsert = vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([mockApiKeyRecord]),
        })),
      }));
      (db.insert as AnyMock).mockImplementation(mockInsert);

      const result = await createApiKey("user-456", "Test Key");

      expect(result.name).toBe("Test Key");
      expect(result.key).toMatch(/^rdv_/);
      expect(result.keyPrefix).toMatch(/^rdv_/);
      expect(result.keyPrefix.length).toBe(12);
    });

    it("throws when name is empty", async () => {
      await expect(createApiKey("user-456", "")).rejects.toThrow(
        ApiKeyServiceError
      );
    });

    it("throws when name is whitespace only", async () => {
      await expect(createApiKey("user-456", "   ")).rejects.toThrow(
        "API key name is required"
      );
    });

    it("throws when name exceeds 100 characters", async () => {
      const longName = "a".repeat(101);
      await expect(createApiKey("user-456", longName)).rejects.toThrow(
        "API key name must be 100 characters or less"
      );
    });

    it("accepts optional expiration date", async () => {
      const mockInsert = vi.fn(() => ({
        values: vi.fn((values) => {
          expect(values.expiresAt).toEqual(new Date("2025-01-01"));
          return {
            returning: vi.fn().mockResolvedValue([mockApiKeyRecord]),
          };
        }),
      }));
      (db.insert as AnyMock).mockImplementation(mockInsert);

      await createApiKey("user-456", "Test Key", new Date("2025-01-01"));
    });

    it("stores hashed key not plain text", async () => {
      const mockInsert = vi.fn(() => ({
        values: vi.fn((values) => {
          // keyHash should be 64 chars (SHA-256 hex)
          expect(values.keyHash).toHaveLength(64);
          // Should not contain the raw key
          expect(values.keyHash).not.toContain("rdv_");
          return {
            returning: vi.fn().mockResolvedValue([mockApiKeyRecord]),
          };
        }),
      }));
      (db.insert as AnyMock).mockImplementation(mockInsert);

      await createApiKey("user-456", "Test Key");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // validateApiKey Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("validateApiKey", () => {
    it("validates correct API key", async () => {
      const testKey = "rdv_testkey12345678901234567890123456789012";
      const testHash = hashKey(testKey);

      (db.query.apiKeys.findMany as AnyMock).mockResolvedValue([
        {
          ...mockApiKeyRecord,
          keyPrefix: testKey.substring(0, 12),
          keyHash: testHash,
        },
      ]);

      const result = await validateApiKey(testKey);

      expect(result).not.toBeNull();
      expect(result?.userId).toBe("user-456");
      expect(result?.keyId).toBe("key-123");
    });

    it("returns null for invalid key format", async () => {
      const result = await validateApiKey("invalid-key");

      expect(result).toBeNull();
      expect(db.query.apiKeys.findMany).not.toHaveBeenCalled();
    });

    it("returns null for empty key", async () => {
      const result = await validateApiKey("");

      expect(result).toBeNull();
    });

    it("returns null when key not found", async () => {
      (db.query.apiKeys.findMany as AnyMock).mockResolvedValue([]);

      const result = await validateApiKey("rdv_nonexistent123456789012345678901234");

      expect(result).toBeNull();
    });

    it("returns null for expired key", async () => {
      const testKey = "rdv_testkey12345678901234567890123456789012";
      const testHash = hashKey(testKey);

      (db.query.apiKeys.findMany as AnyMock).mockResolvedValue([
        {
          ...mockApiKeyRecord,
          keyPrefix: testKey.substring(0, 12),
          keyHash: testHash,
          expiresAt: new Date("2020-01-01T00:00:00.000Z"), // Expired
        },
      ]);

      const result = await validateApiKey(testKey);

      expect(result).toBeNull();
    });

    it("accepts key with future expiration", async () => {
      const testKey = "rdv_testkey12345678901234567890123456789012";
      const testHash = hashKey(testKey);

      (db.query.apiKeys.findMany as AnyMock).mockResolvedValue([
        {
          ...mockApiKeyRecord,
          keyPrefix: testKey.substring(0, 12),
          keyHash: testHash,
          expiresAt: new Date("2099-01-01T00:00:00.000Z"), // Future
        },
      ]);

      const result = await validateApiKey(testKey);

      expect(result).not.toBeNull();
    });

    it("rejects wrong key with same prefix", async () => {
      const correctKey = "rdv_testkey12345678901234567890123456789012";
      const wrongKey = "rdv_testkey1WRONG78901234567890123456789012";

      (db.query.apiKeys.findMany as AnyMock).mockResolvedValue([
        {
          ...mockApiKeyRecord,
          keyPrefix: correctKey.substring(0, 12),
          keyHash: hashKey(correctKey),
        },
      ]);

      const result = await validateApiKey(wrongKey);

      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // touchApiKey Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("touchApiKey", () => {
    it("updates lastUsedAt timestamp", async () => {
      const mockUpdate = vi.fn(() => ({
        set: vi.fn((values) => {
          expect(values.lastUsedAt).toBeInstanceOf(Date);
          return {
            where: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
          };
        }),
      }));
      (db.update as AnyMock).mockImplementation(mockUpdate);

      await touchApiKey("key-123");

      expect(db.update).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // listApiKeys Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("listApiKeys", () => {
    it("returns all API keys for user without hash", async () => {
      (db.query.apiKeys.findMany as AnyMock).mockResolvedValue([
        mockApiKeyRecord,
        {
          ...mockApiKeyRecord,
          id: "key-456",
          name: "Second Key",
        },
      ]);

      const result = await listApiKeys("user-456");

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Test Key");
      expect(result[1].name).toBe("Second Key");
      // Should not include keyHash
      expect((result[0] as unknown as Record<string, unknown>).keyHash).toBeUndefined();
    });

    it("returns empty array when no keys", async () => {
      (db.query.apiKeys.findMany as AnyMock).mockResolvedValue([]);

      const result = await listApiKeys("user-456");

      expect(result).toEqual([]);
    });

    it("converts date strings to Date objects", async () => {
      (db.query.apiKeys.findMany as AnyMock).mockResolvedValue([mockApiKeyRecord]);

      const result = await listApiKeys("user-456");

      expect(result[0].createdAt).toBeInstanceOf(Date);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // getApiKey Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getApiKey", () => {
    it("returns API key with ownership check", async () => {
      (db.query.apiKeys.findFirst as AnyMock).mockResolvedValue(mockApiKeyRecord);

      const result = await getApiKey("key-123", "user-456");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("key-123");
      expect(result?.name).toBe("Test Key");
    });

    it("returns null when key not found", async () => {
      (db.query.apiKeys.findFirst as AnyMock).mockResolvedValue(null);

      const result = await getApiKey("nonexistent", "user-456");

      expect(result).toBeNull();
    });

    it("returns null when key belongs to different user", async () => {
      (db.query.apiKeys.findFirst as AnyMock).mockResolvedValue(null);

      const result = await getApiKey("key-123", "different-user");

      expect(result).toBeNull();
    });

    it("handles null lastUsedAt", async () => {
      (db.query.apiKeys.findFirst as AnyMock).mockResolvedValue({
        ...mockApiKeyRecord,
        lastUsedAt: null,
      });

      const result = await getApiKey("key-123", "user-456");

      expect(result?.lastUsedAt).toBeNull();
    });

    it("handles null expiresAt", async () => {
      (db.query.apiKeys.findFirst as AnyMock).mockResolvedValue({
        ...mockApiKeyRecord,
        expiresAt: null,
      });

      const result = await getApiKey("key-123", "user-456");

      expect(result?.expiresAt).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // deleteApiKey Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("deleteApiKey", () => {
    it("deletes API key with ownership check", async () => {
      const mockDelete = vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: "key-123" }]),
        })),
      }));
      (db.delete as AnyMock).mockImplementation(mockDelete);

      await deleteApiKey("key-123", "user-456");

      expect(db.delete).toHaveBeenCalled();
    });

    it("throws when key not found", async () => {
      const mockDelete = vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([]),
        })),
      }));
      (db.delete as AnyMock).mockImplementation(mockDelete);

      await expect(deleteApiKey("nonexistent", "user-456")).rejects.toThrow(
        ApiKeyServiceError
      );
    });

    it("throws when key belongs to different user", async () => {
      const mockDelete = vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([]),
        })),
      }));
      (db.delete as AnyMock).mockImplementation(mockDelete);

      await expect(deleteApiKey("key-123", "different-user")).rejects.toThrow(
        "API key not found"
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // countApiKeys Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("countApiKeys", () => {
    it("returns count of API keys", async () => {
      (db.query.apiKeys.findMany as AnyMock).mockResolvedValue([
        { id: "key-1" },
        { id: "key-2" },
        { id: "key-3" },
      ]);

      const result = await countApiKeys("user-456");

      expect(result).toBe(3);
    });

    it("returns 0 when no keys", async () => {
      (db.query.apiKeys.findMany as AnyMock).mockResolvedValue([]);

      const result = await countApiKeys("user-456");

      expect(result).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // ApiKeyServiceError Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("ApiKeyServiceError", () => {
    it("is exported for external use", () => {
      expect(ApiKeyServiceError).toBeDefined();
    });
  });
});
