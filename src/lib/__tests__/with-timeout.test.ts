/**
 * Tests for `src/lib/with-timeout.ts`.
 *
 * `withTimeout` bounds the terminal server's async shutdown cleanup so the
 * process always reaches its explicit `releaseInstanceLock()` + `exit(0)`
 * before the deploy's 10s SIGKILL. These tests pin the three behaviours the
 * shutdown path depends on: fast resolution passes through, a hung promise
 * times out, and a rejection is swallowed (never re-thrown).
 */

import { describe, expect, it, vi } from "vitest";

import { withTimeout } from "../with-timeout";

describe("withTimeout", () => {
  it("resolves with the value when the promise settles before the timeout", async () => {
    const result = await withTimeout(Promise.resolve("done"), 1000);
    expect(result.timedOut).toBe(false);
    expect(result.value).toBe("done");
  });

  it("reports timedOut when the promise outlives the timeout", async () => {
    // A promise that never settles within the window.
    const never = new Promise<string>(() => {});
    const result = await withTimeout(never, 10);
    expect(result.timedOut).toBe(true);
    expect(result.value).toBeUndefined();
  });

  it("swallows a rejection into a non-timed-out result (never throws)", async () => {
    const rejecting = Promise.reject(new Error("cleanup blew up"));
    // Must not throw — shutdown callers only care that the work is no longer
    // pending, not why it failed.
    const result = await withTimeout(rejecting, 1000);
    expect(result.timedOut).toBe(false);
    expect(result.value).toBeUndefined();
  });

  it("clears the internal timer when the promise wins (no dangling timer)", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    try {
      await withTimeout(Promise.resolve(42), 5000);
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
  });

  it("settles only once even if both the timer and promise are eligible", async () => {
    // Promise resolves at ~5ms, timeout at 5ms — whichever wins, the result
    // must be a single, well-formed object (the internal `settled` guard).
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 5));
    const result = await withTimeout(slow, 5);
    expect(typeof result.timedOut).toBe("boolean");
    // Whichever branch won, the shape is valid.
    if (!result.timedOut) {
      expect(result.value).toBe("late");
    }
  });
});
