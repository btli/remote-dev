/**
 * [remote-dev-1aa5d] Tests for the client-side activity-status cache merge.
 *
 * - mergeActivityStatus: a WS push older than the cached entry is dropped;
 *   a push with no `at` always applies (back-compat).
 * - reseedActivityStatuses: a DB row only overwrites when newer-or-equal, so a
 *   refresh can't roll back a just-pushed status whose DB write hasn't landed.
 */
import { describe, it, expect } from "vitest";
import {
  mergeActivityStatus,
  reseedActivityStatuses,
  type ActivityStatusCache,
} from "../agent-activity-cache";

const VALID = new Set(["running", "idle", "waiting", "ended"]);
const isValid = (s: string) => VALID.has(s);

describe("mergeActivityStatus", () => {
  it("applies a push into an empty cache", () => {
    const next = mergeActivityStatus({}, "s1", "running", 1000);
    expect(next).toEqual({ s1: { status: "running", at: 1000 } });
  });

  it("applies a newer push", () => {
    const cache: ActivityStatusCache = { s1: { status: "running", at: 1000 } };
    const next = mergeActivityStatus(cache, "s1", "idle", 2000);
    expect(next.s1).toEqual({ status: "idle", at: 2000 });
  });

  it("DROPS an older out-of-order push and returns the same reference", () => {
    const cache: ActivityStatusCache = { s1: { status: "idle", at: 2000 } };
    const next = mergeActivityStatus(cache, "s1", "running", 1000);
    expect(next).toBe(cache); // unchanged reference → no re-render
    expect(next.s1.status).toBe("idle");
  });

  it("applies an equal-timestamp push when the status differs", () => {
    const cache: ActivityStatusCache = { s1: { status: "running", at: 1000 } };
    const next = mergeActivityStatus(cache, "s1", "idle", 1000);
    expect(next.s1).toEqual({ status: "idle", at: 1000 });
  });

  it("applies a push with no `at` (old servers) unconditionally", () => {
    const cache: ActivityStatusCache = { s1: { status: "idle", at: 5000 } };
    const next = mergeActivityStatus(cache, "s1", "running");
    expect(next.s1).toEqual({ status: "running", at: null });
  });

  it("is a no-op when status and ordering key are unchanged", () => {
    const cache: ActivityStatusCache = { s1: { status: "running", at: 1000 } };
    const next = mergeActivityStatus(cache, "s1", "running", 1000);
    expect(next).toBe(cache);
  });
});

describe("reseedActivityStatuses", () => {
  it("seeds from DB rows into an empty cache", () => {
    const next = reseedActivityStatuses(
      {},
      [{ id: "s1", status: "idle", at: 1000 }],
      isValid
    );
    expect(next.s1).toEqual({ status: "idle", at: 1000 });
  });

  it("overwrites the cache when the DB row is newer", () => {
    const cache: ActivityStatusCache = { s1: { status: "running", at: 1000 } };
    const next = reseedActivityStatuses(
      cache,
      [{ id: "s1", status: "idle", at: 2000 }],
      isValid
    );
    expect(next.s1).toEqual({ status: "idle", at: 2000 });
  });

  it("does NOT roll back a just-pushed status (cache newer than DB row)", () => {
    // A WS push set 'idle' at t=2000; the DB row still has the older 'running'
    // (t=1000) because the persist hasn't landed. The re-seed must not regress.
    const cache: ActivityStatusCache = { s1: { status: "idle", at: 2000 } };
    const next = reseedActivityStatuses(
      cache,
      [{ id: "s1", status: "running", at: 1000 }],
      isValid
    );
    expect(next).toBe(cache);
    expect(next.s1.status).toBe("idle");
  });

  it("applies a DB row when the cached entry has no ordering key", () => {
    const cache: ActivityStatusCache = { s1: { status: "running", at: null } };
    const next = reseedActivityStatuses(
      cache,
      [{ id: "s1", status: "idle", at: 1000 }],
      isValid
    );
    expect(next.s1).toEqual({ status: "idle", at: 1000 });
  });

  it("skips invalid statuses and null statuses", () => {
    const next = reseedActivityStatuses(
      {},
      [
        { id: "s1", status: "bogus", at: 1000 },
        { id: "s2", status: null, at: 1000 },
      ],
      isValid
    );
    expect(next).toEqual({});
  });

  it("returns the same reference when nothing changed", () => {
    const cache: ActivityStatusCache = { s1: { status: "idle", at: 1000 } };
    const next = reseedActivityStatuses(
      cache,
      [{ id: "s1", status: "idle", at: 1000 }],
      isValid
    );
    expect(next).toBe(cache);
  });
});
