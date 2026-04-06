import { useRef, useEffect, useCallback } from "react";

/**
 * Wraps an async refresh function with debouncing and automatic
 * visibility-change triggering.
 *
 * - Coalesces rapid calls (e.g. multiple WebSocket broadcasts) into a
 *   single invocation after `delay` ms of silence.
 * - Automatically re-fetches when the page becomes visible again
 *   (tab switch, wake from sleep, system switch).
 * - Cleans up the debounce timer on unmount.
 *
 * @returns A stable debounced callback that can be passed as a
 *          dependency to other hooks or event listeners.
 */
export function useDebouncedRefresh(
  refresh: () => Promise<void>,
  delay = 150,
): () => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedRefresh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      refresh();
    }, delay);
  }, [refresh, delay]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Refresh when page becomes visible (e.g. after sleep, tab switch)
  useEffect(() => {
    function handleVisibilityChange(): void {
      if (!document.hidden) {
        debouncedRefresh();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [debouncedRefresh]);

  return debouncedRefresh;
}
