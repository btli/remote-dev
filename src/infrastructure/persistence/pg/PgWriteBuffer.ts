/**
 * PgWriteBuffer - generic async write buffer for the Postgres sidecar stores.
 *
 * The sidecar stores (logs + analytics) must NEVER block a request path and
 * must survive Postgres hiccups by DROPPING work, never by blocking. This
 * buffer provides that contract:
 *
 *   - `enqueue(items)` is synchronous and returns immediately.
 *   - Items accumulate in an in-memory queue bounded by `maxQueueDepth`
 *     (default 5000). When the queue is full, new items are dropped and the
 *     drop is reported via `console.error` — NOT the structured logger, which
 *     itself routes through a PgWriteBuffer on the Postgres path and would
 *     cause unbounded recursion. Each drop reports both the per-event count and
 *     a monotonic cumulative total (`dropped N this event, M total`) so a
 *     sustained outage is obvious; the buffer's `name` (e.g. "logs" /
 *     "analytics") labels every line.
 *   - Flushing happens on two triggers:
 *       1. size-based: once the queue reaches `maxBatchSize` (default 500),
 *          a flush is kicked off immediately.
 *       2. interval-based: a `setInterval` (default 2000ms), `.unref()`d so it
 *          never keeps the process alive on its own.
 *   - `flush()` drains the queue (used on graceful shutdown). On flush error
 *     the in-flight batch is DROPPED and reported via `console.error`; the
 *     error is never rethrown.
 *
 * A single flush is in flight at a time (`flushing` guard); concurrent
 * triggers coalesce.
 *
 * NOTE: this module uses `console.error` (not the structured logger) on
 * purpose. On the Postgres path the structured logger itself routes through a
 * PgWriteBuffer, so logging buffer drops/errors through it would recurse.
 * `console.error` is the safe, non-recursive sink.
 */

export interface PgWriteBufferOptions {
  /** Maximum number of queued items before new items are dropped. */
  maxQueueDepth?: number;
  /** Queue length that triggers an immediate flush. */
  maxBatchSize?: number;
  /** Interval (ms) for the periodic background flush. */
  flushIntervalMs?: number;
  /** Human-readable name used in drop/error diagnostics. */
  name?: string;
}

export class PgWriteBuffer<T> {
  private queue: T[] = [];
  private flushing = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Monotonic count of items dropped over this buffer's lifetime (queue-full
   * enqueue drops + flush-error drops). Every drop logs the per-event count AND
   * this cumulative total so a sustained outage is visible at a glance —
   * analytics drops in particular are lost cost data.
   */
  private droppedTotal = 0;

  private readonly maxQueueDepth: number;
  private readonly maxBatchSize: number;
  private readonly flushIntervalMs: number;
  private readonly name: string;

  /**
   * @param flushBatch async sink that persists a drained batch. It MUST throw
   *   on failure so the buffer can drop + report; it must not retry internally.
   * @param options    tuning knobs (see PgWriteBufferOptions).
   */
  constructor(
    private readonly flushBatch: (items: T[]) => Promise<void>,
    options: PgWriteBufferOptions = {}
  ) {
    this.maxQueueDepth = options.maxQueueDepth ?? 5000;
    this.maxBatchSize = options.maxBatchSize ?? 500;
    this.flushIntervalMs = options.flushIntervalMs ?? 2000;
    this.name = options.name ?? "PgWriteBuffer";
    this.startTimer();
  }

  /**
   * Synchronously enqueue items. Drops (with a console.error) anything that
   * would exceed `maxQueueDepth`. Kicks off a flush once the queue reaches
   * `maxBatchSize`. Never blocks; never throws.
   */
  enqueue(items: T[]): void {
    if (items.length === 0) return;

    const capacity = this.maxQueueDepth - this.queue.length;
    if (capacity <= 0) {
      this.droppedTotal += items.length;
      console.error(
        `[${this.name}] write buffer full (depth=${this.maxQueueDepth}); dropped ${items.length} this event, ${this.droppedTotal} total`
      );
      return;
    }

    if (items.length > capacity) {
      this.queue.push(...items.slice(0, capacity));
      const dropped = items.length - capacity;
      this.droppedTotal += dropped;
      console.error(
        `[${this.name}] write buffer full (depth=${this.maxQueueDepth}); dropped ${dropped} this event, ${this.droppedTotal} total`
      );
    } else {
      this.queue.push(...items);
    }

    if (this.queue.length >= this.maxBatchSize) {
      // Fire-and-forget; `flush` guards against concurrent drains.
      void this.flush();
    }
  }

  /**
   * Drain the entire queue, flushing in batches of `maxBatchSize`. On error the
   * in-flight batch is dropped (with a console.error) and draining stops for
   * this invocation; the error is never rethrown.
   */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.maxBatchSize);
        try {
          await this.flushBatch(batch);
        } catch (err) {
          // Drop the in-flight batch and stop; do NOT rethrow, do NOT requeue
          // (requeuing under a persistent PG outage would grow unbounded).
          this.droppedTotal += batch.length;
          console.error(
            `[${this.name}] flush failed; dropped ${batch.length} this event, ${this.droppedTotal} total:`,
            String(err)
          );
          return;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Stop the background timer. Used during shutdown after a final `flush()`.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startTimer(): void {
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    // Never keep the event loop alive solely for the flush timer.
    this.timer.unref?.();
  }
}
