/**
 * UUID utility for cross-platform UUID generation.
 * Works in Node.js 19+, all modern browsers, and React Native.
 */

/**
 * Generate a UUID v4 using the standard crypto API.
 */
export function generateUUID(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for older environments (shouldn't be needed with iOS 17+/Android 13+)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
