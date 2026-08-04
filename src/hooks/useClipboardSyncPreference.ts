"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Device-local opt-in. Clipboard contents are never stored here. */
export const CLIPBOARD_SYNC_STORAGE_KEY = "rdv.clipboard-sync.enabled";

const CLIPBOARD_SYNC_CHANGE_EVENT = "rdv:clipboard-sync-preference-changed";

export function getClipboardSyncPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CLIPBOARD_SYNC_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setClipboardSyncPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLIPBOARD_SYNC_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage may be unavailable in private/restricted browsing modes.
    // The setting remains off on the next snapshot instead of breaking UI.
  }
  window.dispatchEvent(new Event(CLIPBOARD_SYNC_CHANGE_EVENT));
}

export function subscribeClipboardSyncPreference(
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === CLIPBOARD_SYNC_STORAGE_KEY) {
      onStoreChange();
    }
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(CLIPBOARD_SYNC_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CLIPBOARD_SYNC_CHANGE_EVENT, onStoreChange);
  };
}

/** SSR-safe device-local clipboard-sync preference. Defaults to off. */
export function useClipboardSyncPreference(): readonly [
  boolean,
  (enabled: boolean) => void,
] {
  const enabled = useSyncExternalStore(
    subscribeClipboardSyncPreference,
    getClipboardSyncPreference,
    () => false,
  );
  const setEnabled = useCallback((next: boolean) => {
    setClipboardSyncPreference(next);
  }, []);
  return [enabled, setEnabled] as const;
}
