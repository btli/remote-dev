// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  allowRequest,
  cacheGet,
  cacheSet,
  cacheKey,
  __resetModelProxyCacheForTest,
} from "./model-proxy-cache";

describe("ModelProxyCache", () => {
  beforeEach(() => {
    __resetModelProxyCacheForTest();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("allowRequest (token bucket)", () => {
    it("allows up to BURST requests then rate-limits", () => {
      // Defaults: BURST=20.
      let allowed = 0;
      for (let i = 0; i < 25; i++) {
        if (allowRequest("tok-1")) allowed++;
      }
      expect(allowed).toBe(20);
      expect(allowRequest("tok-1")).toBe(false);
    });

    it("refills over time at RATE/sec", () => {
      for (let i = 0; i < 20; i++) allowRequest("tok-2");
      expect(allowRequest("tok-2")).toBe(false);
      // RATE default = 5/sec → after 1s, 5 tokens back.
      vi.advanceTimersByTime(1000);
      let allowed = 0;
      for (let i = 0; i < 10; i++) {
        if (allowRequest("tok-2")) allowed++;
      }
      expect(allowed).toBe(5);
    });

    it("keys buckets independently", () => {
      for (let i = 0; i < 20; i++) allowRequest("tok-a");
      expect(allowRequest("tok-a")).toBe(false);
      // A different key has a full fresh bucket.
      expect(allowRequest("tok-b")).toBe(true);
    });
  });

  describe("response cache (disabled by default)", () => {
    const SCOPE = { userId: "u1", instanceSlug: null };

    it("cacheGet returns null until a value is set (and TTL>0)", () => {
      const key = cacheKey(SCOPE, "anthropic", '{"x":1}');
      expect(cacheGet(key)).toBeNull();
      cacheSet(key, { body: "resp", status: 200 });
      // With default TTL=0 (disabled), nothing is cached.
      expect(cacheGet(key)).toBeNull();
    });

    it("caches within TTL and expires after it when enabled", () => {
      __resetModelProxyCacheForTest({ ttlMs: 5000 });
      const key = cacheKey(SCOPE, "anthropic", '{"y":2}');
      cacheSet(key, { body: "hello", status: 200 });
      expect(cacheGet(key)).toEqual({ body: "hello", status: 200 });
      vi.advanceTimersByTime(4000);
      expect(cacheGet(key)).toEqual({ body: "hello", status: 200 });
      vi.advanceTimersByTime(2000); // now 6s > 5s TTL
      expect(cacheGet(key)).toBeNull();
    });

    it("cacheKey is stable for identical inputs and distinct for different bodies", () => {
      expect(cacheKey(SCOPE, "anthropic", "a")).toBe(cacheKey(SCOPE, "anthropic", "a"));
      expect(cacheKey(SCOPE, "anthropic", "a")).not.toBe(cacheKey(SCOPE, "anthropic", "b"));
      expect(cacheKey(SCOPE, "anthropic", "a")).not.toBe(cacheKey(SCOPE, "openai", "a"));
    });

    it("cacheKey is tenant-scoped: same body differs across user + instance (no cross-tenant bleed)", () => {
      const body = '{"model":"m","temperature":0}';
      const userA = cacheKey({ userId: "uA", instanceSlug: null }, "anthropic", body);
      const userB = cacheKey({ userId: "uB", instanceSlug: null }, "anthropic", body);
      expect(userA).not.toBe(userB);

      const instX = cacheKey({ userId: "uA", instanceSlug: "x" }, "anthropic", body);
      const instY = cacheKey({ userId: "uA", instanceSlug: "y" }, "anthropic", body);
      expect(instX).not.toBe(instY);
      // null instance differs from a named one.
      expect(userA).not.toBe(instX);
    });

    it("evicts the oldest entries past the cap", () => {
      __resetModelProxyCacheForTest({ ttlMs: 60000, maxEntries: 3 });
      cacheSet("k1", { body: "1", status: 200 });
      cacheSet("k2", { body: "2", status: 200 });
      cacheSet("k3", { body: "3", status: 200 });
      cacheSet("k4", { body: "4", status: 200 }); // evicts k1
      expect(cacheGet("k1")).toBeNull();
      expect(cacheGet("k4")).toEqual({ body: "4", status: 200 });
    });
  });
});
