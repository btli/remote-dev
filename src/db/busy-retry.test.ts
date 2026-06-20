// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Logger writes to a side DB in prod; stub it so the unit stays pure.
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

import { withBusyRetry, isBusyError } from "./busy-retry";

describe("isBusyError", () => {
  it("matches the libsql busy/locked error shapes", () => {
    expect(isBusyError(new Error("SQLITE_BUSY: database is locked"))).toBe(true);
    expect(
      isBusyError(
        new Error(
          "SQLITE_BUSY: cannot commit transaction - SQL statements in progress"
        )
      )
    ).toBe(true);
    expect(isBusyError("database is locked")).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isBusyError(new Error("UNIQUE constraint failed"))).toBe(false);
    expect(isBusyError(new Error("no such table"))).toBe(false);
  });
});

describe("withBusyRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries on a SQLITE_BUSY-like error then succeeds", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("SQLITE_BUSY: database is locked"))
      .mockRejectedValueOnce(
        new Error("SQLITE_BUSY: cannot commit transaction - SQL statements in progress")
      )
      .mockResolvedValueOnce("ok");

    // Tiny base delay keeps the test fast.
    await expect(
      withBusyRetry(fn, { baseDelayMs: 1, label: "test" })
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rethrows the last busy error after exhausting retries", async () => {
    const busy = new Error("SQLITE_BUSY: database is locked");
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(busy);

    await expect(
      withBusyRetry(fn, { retries: 2, baseDelayMs: 1 })
    ).rejects.toBe(busy);
    // 1 initial attempt + 2 retries.
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a non-busy error", async () => {
    const boom = new Error("UNIQUE constraint failed");
    const fn = vi.fn<() => Promise<never>>().mockRejectedValue(boom);

    await expect(
      withBusyRetry(fn, { retries: 5, baseDelayMs: 1 })
    ).rejects.toBe(boom);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns immediately on first success without retrying", async () => {
    const fn = vi.fn<() => Promise<number>>().mockResolvedValue(42);
    await expect(withBusyRetry(fn)).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
