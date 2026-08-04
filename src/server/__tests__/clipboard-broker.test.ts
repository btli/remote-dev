// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLIPBOARD_MAX_BYTES,
  CLIPBOARD_SESSION_ID_MAX_BYTES,
  CLIPBOARD_TTL_MS,
  ClipboardBroker,
  ClipboardValidationError,
} from "../clipboard-broker";

describe("ClipboardBroker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps exact text in memory per session and increments revisions", () => {
    let now = 1_000;
    const broker = new ClipboardBroker({ now: () => now });

    expect(broker.write("session-a", "first\n")).toEqual({ revision: 1 });
    expect(broker.write("session-b", "other")).toEqual({ revision: 2 });
    expect(broker.write("session-a", "second\0line")).toEqual({ revision: 3 });

    expect(broker.read("session-a")).toEqual({
      data: "second\0line",
      revision: 3,
    });
    expect(broker.read("session-b")).toEqual({ data: "other", revision: 2 });

    now += 1;
    expect(broker.read("session-a")?.data).toBe("second\0line");
  });

  it("expires content after ten minutes without resetting its revision sequence", () => {
    let now = 50;
    const broker = new ClipboardBroker({ now: () => now });

    expect(broker.write("session-a", "temporary").revision).toBe(1);
    now += CLIPBOARD_TTL_MS;
    expect(broker.read("session-a")).toBeNull();

    expect(broker.write("session-a", "replacement").revision).toBe(2);
  });

  it("actively removes expired text even when nobody reads the session", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T00:00:00Z"));
    const broker = new ClipboardBroker();
    broker.write("session-a", "must leave memory");

    vi.advanceTimersByTime(CLIPBOARD_TTL_MS);

    const state = broker as unknown as {
      entries: Map<string, unknown>;
      revision: number;
      revisions?: Map<string, number>;
    };
    expect(state.entries.size).toBe(0);
    expect(state.revisions).toBeUndefined();
    expect(state.revision).toBe(1);
  });

  it("does not let an old expiry timer delete a rewritten clipboard", () => {
    vi.useFakeTimers();
    const broker = new ClipboardBroker({ ttlMs: 100 });

    expect(broker.write("session-a", "first")).toEqual({ revision: 1 });
    vi.advanceTimersByTime(60);
    expect(broker.write("session-a", "second")).toEqual({ revision: 2 });
    vi.advanceTimersByTime(40);

    expect(broker.read("session-a")).toEqual({ data: "second", revision: 2 });
    vi.advanceTimersByTime(60);
    expect(broker.read("session-a")).toBeNull();
    expect(broker.write("session-a", "third")).toEqual({ revision: 3 });
  });

  it("enforces the one-MiB UTF-8 limit", () => {
    const broker = new ClipboardBroker();
    const exactLimit = "x".repeat(CLIPBOARD_MAX_BYTES);

    expect(broker.write("session-a", exactLimit).revision).toBe(1);
    expect(() => broker.write("session-a", exactLimit + "x")).toThrowError(
      expect.objectContaining<Partial<ClipboardValidationError>>({ code: "too_large" }),
    );

    const multibyteOverLimit = "😀".repeat(CLIPBOARD_MAX_BYTES / 4 + 1);
    expect(() => broker.write("session-b", multibyteOverLimit)).toThrowError(
      expect.objectContaining<Partial<ClipboardValidationError>>({ code: "too_large" }),
    );
  });

  it("rejects non-text values, empty session ids, and unpaired surrogates", () => {
    const broker = new ClipboardBroker();

    expect(() => broker.write("", "text")).toThrowError(
      expect.objectContaining<Partial<ClipboardValidationError>>({ code: "invalid_session" }),
    );
    expect(() => broker.write("session-a", 42 as unknown as string)).toThrowError(
      expect.objectContaining<Partial<ClipboardValidationError>>({ code: "invalid_text" }),
    );
    expect(() => broker.write("session-a", "\ud800")).toThrowError(
      expect.objectContaining<Partial<ClipboardValidationError>>({ code: "invalid_text" }),
    );
  });

  it("rejects oversized session ids before retaining broker state", () => {
    const broker = new ClipboardBroker();
    expect(CLIPBOARD_SESSION_ID_MAX_BYTES).toBe(128);
    const oversizedSessionId = "x".repeat(129);

    expect(() => broker.write(oversizedSessionId, "must not be retained")).toThrowError(
      expect.objectContaining<Partial<ClipboardValidationError>>({ code: "invalid_session" }),
    );
    expect(broker.write("session-a", "valid")).toEqual({ revision: 1 });

    const state = broker as unknown as {
      entries: Map<string, unknown>;
      revision: number;
    };
    expect(state.entries.has(oversizedSessionId)).toBe(false);
    expect(state.revision).toBe(1);
  });

  it("clears clipboard data without resetting the process-wide revision", () => {
    const broker = new ClipboardBroker();
    expect(broker.write("session-a", "secret")).toEqual({ revision: 1 });

    broker.clearSession("session-a");

    expect(broker.read("session-a")).toBeNull();
    expect(broker.write("session-a", "new lifecycle").revision).toBe(2);
  });

  it("fails closed instead of wrapping an exhausted revision counter", () => {
    const broker = new ClipboardBroker();
    (broker as unknown as { revision: number }).revision = Number.MAX_SAFE_INTEGER;

    expect(() => broker.write("session-a", "must not store")).toThrowError(
      "clipboard revision counter exhausted",
    );
    expect(broker.read("session-a")).toBeNull();
  });
});
