/**
 * useFirstRun tests — Phase 6 mobile redesign.
 *
 * Verifies the localStorage-backed first-run flag returns the correct
 * value across mount, mark-as-seen, and reset; and that storage failures
 * are handled gracefully without crashing the host.
 *
 * happy-dom in this project does not ship a `window.localStorage`
 * implementation, so we install a minimal in-memory Storage shim before
 * each test and restore the original (typically undefined) afterwards.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import {
  WELCOME_SEEN_STORAGE_KEY,
  useFirstRun,
} from "@/components/mobile/auth/useFirstRun";

interface MutableStorage extends Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  _store: Map<string, string>;
}

function makeMemoryStorage(): MutableStorage {
  const store = new Map<string, string>();
  return {
    _store: store,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
}

let originalDescriptor: PropertyDescriptor | undefined;
let installed: MutableStorage;

beforeEach(() => {
  originalDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  installed = makeMemoryStorage();
  Object.defineProperty(window, "localStorage", {
    value: installed,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  if (originalDescriptor) {
    Object.defineProperty(window, "localStorage", originalDescriptor);
  } else {
    // No prior descriptor — remove the property we added.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).localStorage;
  }
});

describe("useFirstRun", () => {
  it("reports first run when storage is empty", async () => {
    const { result } = renderHook(() => useFirstRun());
    await act(async () => {});
    expect(result.current.isFirstRun).toBe(true);
  });

  it("reports not-first-run when the seen flag is set", async () => {
    installed.setItem(WELCOME_SEEN_STORAGE_KEY, "1");
    const { result } = renderHook(() => useFirstRun());
    await act(async () => {});
    expect(result.current.isFirstRun).toBe(false);
  });

  it("markSeen flips state to false and persists to storage", async () => {
    const { result } = renderHook(() => useFirstRun());
    await act(async () => {});
    expect(result.current.isFirstRun).toBe(true);
    act(() => {
      result.current.markSeen();
    });
    expect(result.current.isFirstRun).toBe(false);
    expect(installed.getItem(WELCOME_SEEN_STORAGE_KEY)).toBe("1");
  });

  it("reset clears the flag and flips state back to true", async () => {
    installed.setItem(WELCOME_SEEN_STORAGE_KEY, "1");
    const { result } = renderHook(() => useFirstRun());
    await act(async () => {});
    expect(result.current.isFirstRun).toBe(false);
    act(() => {
      result.current.reset();
    });
    expect(result.current.isFirstRun).toBe(true);
    expect(installed.getItem(WELCOME_SEEN_STORAGE_KEY)).toBeNull();
  });

  it("does not throw when localStorage.setItem fails", async () => {
    const fake = vi.fn(() => {
      throw new Error("QuotaExceeded");
    });
    installed.setItem = fake as unknown as typeof installed.setItem;
    const { result } = renderHook(() => useFirstRun());
    await act(async () => {});
    act(() => {
      // Should not throw despite the underlying storage rejection.
      result.current.markSeen();
    });
    // State still flipped optimistically.
    expect(result.current.isFirstRun).toBe(false);
    expect(fake).toHaveBeenCalled();
  });
});
