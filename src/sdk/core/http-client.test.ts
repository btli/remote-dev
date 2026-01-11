/**
 * HTTP Client Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHttpClient } from "./http-client";

// Type for our mock fetch function
type MockFetch = ReturnType<typeof vi.fn> & typeof fetch;

describe("HTTP Client", () => {
  const baseUrl = "http://localhost:6001";
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  // Helper to create a typed mock fetch
  function createMockFetch(): MockFetch {
    const mock = vi.fn() as MockFetch;
    // Add preconnect to satisfy TypeScript
    mock.preconnect = vi.fn();
    return mock;
  }

  describe("createHttpClient", () => {
    it("should create a client with all HTTP methods", () => {
      const client = createHttpClient(baseUrl);

      expect(client.get).toBeDefined();
      expect(client.post).toBeDefined();
      expect(client.put).toBeDefined();
      expect(client.patch).toBeDefined();
      expect(client.delete).toBeDefined();
    });
  });

  describe("GET requests", () => {
    it("should make a GET request to the correct URL", async () => {
      const mockFetch = createMockFetch();
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ data: "test" }),
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);
      await client.get("/api/test");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:6001/api/test");
      expect(options.method).toBe("GET");
    });

    it("should add query parameters to URL", async () => {
      const mockFetch = createMockFetch();
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ data: "test" }),
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);
      await client.get("/api/test", {
        params: { foo: "bar", baz: "qux" },
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("foo=bar");
      expect(url).toContain("baz=qux");
    });

    it("should parse JSON response", async () => {
      const responseData = { id: 1, name: "test" };
      const mockFetch = createMockFetch();
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve(responseData),
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);
      const result = await client.get("/api/test");

      expect(result).toEqual(responseData);
    });

    it("should return undefined for non-JSON responses", async () => {
      const mockFetch = createMockFetch();
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "text/plain" }),
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);
      const result = await client.get("/api/test");

      expect(result).toBeUndefined();
    });
  });

  describe("POST requests", () => {
    it("should make a POST request with JSON body", async () => {
      const requestBody = { name: "test", value: 123 };
      const mockFetch = createMockFetch();
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ success: true }),
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);
      await client.post("/api/test", requestBody);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe("POST");
      expect(options.body).toBe(JSON.stringify(requestBody));
      expect(options.headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("PUT requests", () => {
    it("should make a PUT request with JSON body", async () => {
      const requestBody = { id: 1, name: "updated" };
      const mockFetch = createMockFetch();
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ success: true }),
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);
      await client.put("/api/test/1", requestBody);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe("PUT");
      expect(options.body).toBe(JSON.stringify(requestBody));
    });
  });

  describe("PATCH requests", () => {
    it("should make a PATCH request with partial JSON body", async () => {
      const requestBody = { name: "patched" };
      const mockFetch = createMockFetch();
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ success: true }),
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);
      await client.patch("/api/test/1", requestBody);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe("PATCH");
      expect(options.body).toBe(JSON.stringify(requestBody));
    });
  });

  describe("DELETE requests", () => {
    it("should make a DELETE request without body", async () => {
      const mockFetch = createMockFetch();
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ deleted: true }),
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);
      await client.delete("/api/test/1");

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe("DELETE");
      expect(options.body).toBeUndefined();
    });
  });

  describe("Error handling", () => {
    it("should throw on non-OK response", async () => {
      const mockFetch = createMockFetch();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("Resource not found"),
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);

      await expect(client.get("/api/missing")).rejects.toThrow(
        "HTTP 404: Not Found - Resource not found"
      );
    });

    it("should throw on 500 server error", async () => {
      const mockFetch = createMockFetch();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("Something went wrong"),
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);

      await expect(client.post("/api/test", {})).rejects.toThrow(
        "HTTP 500: Internal Server Error"
      );
    });

    it("should throw on 401 unauthorized", async () => {
      const mockFetch = createMockFetch();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve("Invalid token"),
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);

      await expect(client.get("/api/protected")).rejects.toThrow(
        "HTTP 401: Unauthorized"
      );
    });
  });

  describe("Custom headers", () => {
    it("should merge custom headers with defaults", async () => {
      const mockFetch = createMockFetch();
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({}),
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);
      await client.get("/api/test", {
        headers: {
          Authorization: "Bearer token123",
          "X-Custom-Header": "custom-value",
        },
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.headers["Authorization"]).toBe("Bearer token123");
      expect(options.headers["X-Custom-Header"]).toBe("custom-value");
    });

    it("should allow overriding Content-Type", async () => {
      const mockFetch = createMockFetch();
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({}),
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);
      await client.post("/api/test", {}, {
        headers: {
          "Content-Type": "text/plain",
        },
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers["Content-Type"]).toBe("text/plain");
    });
  });

  describe("Timeout handling", () => {
    it("should support custom timeout via AbortController", async () => {
      vi.useRealTimers(); // Use real timers for this test

      // Create a promise that never resolves to simulate a hanging request
      const mockFetch = createMockFetch();
      mockFetch.mockImplementation(async (_url: string, options?: RequestInit) => {
        // Check if already aborted
        if (options?.signal?.aborted) {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          throw error;
        }
        // Return a promise that waits for abort
        return new Promise((_, reject) => {
          options?.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);
      const requestPromise = client.get("/api/slow", { timeoutMs: 50 });

      // Wait for the timeout to trigger
      await expect(requestPromise).rejects.toThrow();
    });

    it("should respect external AbortSignal", async () => {
      const controller = new AbortController();
      const mockFetch = createMockFetch();
      mockFetch.mockImplementation(async (_url: string, options?: RequestInit) => {
        if (options?.signal?.aborted) {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          throw error;
        }
        return new Promise((_, reject) => {
          options?.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);
      const requestPromise = client.get("/api/test", { signal: controller.signal });

      // Abort the request
      controller.abort();

      await expect(requestPromise).rejects.toThrow();
    });
  });

  describe("URL construction", () => {
    it("should handle trailing slash in base URL", async () => {
      const mockFetch = createMockFetch();
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({}),
      });
      global.fetch = mockFetch;

      const client = createHttpClient("http://localhost:6001/");
      await client.get("/api/test");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:6001/api/test");
    });

    it("should handle path without leading slash", async () => {
      const mockFetch = createMockFetch();
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({}),
      });
      global.fetch = mockFetch;

      const client = createHttpClient(baseUrl);
      await client.get("api/test");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:6001/api/test");
    });
  });
});
