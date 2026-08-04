import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLIPBOARD_SYNC_STORAGE_KEY,
  getClipboardSyncPreference,
  setClipboardSyncPreference,
  useClipboardSyncPreference,
} from "./useClipboardSyncPreference";

describe("clipboard sync preference", () => {
  let values: Map<string, string>;
  let originalDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    values = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(window, "localStorage", originalDescriptor);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).localStorage;
    }
  });

  it("defaults off", () => {
    expect(getClipboardSyncPreference()).toBe(false);
    const { result } = renderHook(() => useClipboardSyncPreference());
    expect(result.current[0]).toBe(false);
  });

  it("persists locally and notifies same-tab subscribers", () => {
    const { result } = renderHook(() => useClipboardSyncPreference());

    act(() => result.current[1](true));

    expect(window.localStorage.getItem(CLIPBOARD_SYNC_STORAGE_KEY)).toBe("true");
    expect(result.current[0]).toBe(true);
  });

  it("reacts to cross-tab storage events and tolerates storage failures", () => {
    const { result } = renderHook(() => useClipboardSyncPreference());
    window.localStorage.setItem(CLIPBOARD_SYNC_STORAGE_KEY, "true");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: CLIPBOARD_SYNC_STORAGE_KEY }),
      );
    });
    expect(result.current[0]).toBe(true);

    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => setClipboardSyncPreference(false)).not.toThrow();
    setItem.mockRestore();
  });
});
