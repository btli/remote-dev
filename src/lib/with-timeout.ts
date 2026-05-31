/**
 * Race a promise against a wall-clock timeout.
 *
 * Used by the terminal server's shutdown path (`src/server/index.ts`) to
 * bound async cleanup so the process always exits well within the deploy
 * stop window (`PROCESS_STOP_TIMEOUT_MS` in `scripts/deploy.ts`). If cleanup
 * exceeds the deadline the process would otherwise be SIGKILLed — which can't
 * be trapped, so `releaseInstanceLock()` never runs and the instance lock /
 * sockets are orphaned.
 *
 * Semantics:
 *   - Resolves `{ timedOut: false, value }` if `promise` settles first.
 *   - Resolves `{ timedOut: true }` if the timer fires first.
 *   - Never rejects: a rejection from `promise` is swallowed into
 *     `{ timedOut: false, value: undefined }` (callers in a shutdown path
 *     don't care *why* cleanup failed — only that they should stop waiting).
 *   - The internal timer is `unref()`-ed and always cleared, so it never
 *     keeps the event loop alive on its own.
 */
export interface TimeoutResult<T> {
  timedOut: boolean;
  value?: T;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<TimeoutResult<T>> {
  return new Promise<TimeoutResult<T>>((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timedOut: true });
    }, ms);
    // Don't let the pending timer hold the event loop open by itself.
    timer.unref?.();

    const finish = (result: TimeoutResult<T>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    promise.then(
      (value) => finish({ timedOut: false, value }),
      // Swallow the rejection reason — shutdown callers only need to know
      // the awaited work is no longer pending.
      () => finish({ timedOut: false, value: undefined }),
    );
  });
}
