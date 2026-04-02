import { useRef, useEffect, useCallback } from "react";

/**
 * Returns a debounced save function that delays calling the callback
 * until `delay` ms after the last invocation. Cleans up on unmount.
 */
export function useDebouncedSave(
  callback: (update: Record<string, unknown>) => void,
  delay = 500
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const debouncedSave = useCallback(
    (key: string, value: unknown) => {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        callback({ [key]: value });
      }, delay);
    },
    [callback, delay]
  );

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  return debouncedSave;
}
