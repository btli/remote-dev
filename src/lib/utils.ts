import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Safely parse a JSON string with a fallback value.
 * Returns fallback on null/undefined input or invalid JSON.
 * Logs a warning on parse failure for diagnostics.
 */
export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    console.warn("Failed to parse JSON:", value.substring(0, 100));
    return fallback;
  }
}
