// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { PgWriteBuffer } from "./PgWriteBuffer";

/**
 * Unit tests for the generic async write buffer used by the Postgres sidecar
 * stores. These cover the FIX 3 drop accounting: every drop (queue-full enqueue
 * drop AND flush-error drop) reports a per-event count AND a monotonic
 * cumulative total, labelled by the buffer's `name`. No real Postgres is
 * touched — the flush sink is an injected fn.
 */
describe("PgWriteBuffer drop accounting", () => {
  const buffers: PgWriteBuffer<unknown>[] = [];

  function makeBuffer<T>(
    sink: (items: T[]) => Promise<void>,
    opts?: ConstructorParameters<typeof PgWriteBuffer<T>>[1]
  ): PgWriteBuffer<T> {
    const b = new PgWriteBuffer<T>(sink, {
      // A huge interval so the periodic timer never fires during the test; we
      // drive flush() explicitly.
      flushIntervalMs: 1_000_000,
      ...opts,
    });
    buffers.push(b as PgWriteBuffer<unknown>);
    return b;
  }

  afterEach(() => {
    for (const b of buffers) b.stop();
    buffers.length = 0;
    vi.restoreAllMocks();
  });

  it("reports per-event AND cumulative totals when the queue is full (no capacity)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Never auto-flush (huge batch size) and a small depth so we fill it.
    const buf = makeBuffer<number>(async () => {}, {
      maxQueueDepth: 2,
      maxBatchSize: 1000,
      name: "analytics",
    });

    buf.enqueue([1, 2]); // fills the queue exactly (no drop)
    buf.enqueue([3, 4, 5]); // capacity 0 → drop all 3
    buf.enqueue([6]); // capacity 0 → drop 1 more

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0]).toContain("[analytics]");
    expect(spy.mock.calls[0][0]).toContain("dropped 3 this event, 3 total");
    expect(spy.mock.calls[1][0]).toContain("dropped 1 this event, 4 total");
  });

  it("reports cumulative totals on a partial (over-capacity) enqueue drop", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const buf = makeBuffer<number>(async () => {}, {
      maxQueueDepth: 3,
      maxBatchSize: 1000,
      name: "logs",
    });

    buf.enqueue([1, 2]); // queue depth 2, no drop
    buf.enqueue([3, 4, 5]); // capacity 1 → keep 1, drop 2
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain("[logs]");
    expect(spy.mock.calls[0][0]).toContain("dropped 2 this event, 2 total");
  });

  it("reports per-event AND cumulative totals when a flush throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sink = vi.fn(async () => {
      throw new Error("pg down");
    });
    const buf = makeBuffer<number>(sink, {
      maxQueueDepth: 1000,
      maxBatchSize: 1000,
      name: "analytics",
    });

    buf.enqueue([1, 2, 3]);
    await buf.flush(); // drops the in-flight batch of 3
    buf.enqueue([4, 5]);
    await buf.flush(); // drops the in-flight batch of 2 → cumulative 5

    expect(sink).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0]).toContain("[analytics]");
    expect(spy.mock.calls[0][0]).toContain("dropped 3 this event, 3 total");
    expect(spy.mock.calls[1][0]).toContain("dropped 2 this event, 5 total");
  });

  it("does not log a drop when everything fits and flush succeeds", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const flushed: number[][] = [];
    const buf = makeBuffer<number>(async (items) => {
      flushed.push(items);
    });
    buf.enqueue([1, 2, 3]);
    await buf.flush();
    expect(spy).not.toHaveBeenCalled();
    expect(flushed).toEqual([[1, 2, 3]]);
  });

  it("defaults the label to PgWriteBuffer when no name is given", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const buf = makeBuffer<number>(async () => {}, {
      maxQueueDepth: 1,
      maxBatchSize: 1000,
    });
    buf.enqueue([1]);
    buf.enqueue([2]); // drop 1
    expect(spy.mock.calls[0][0]).toContain("[PgWriteBuffer]");
  });
});
