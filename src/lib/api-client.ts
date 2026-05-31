/**
 * Client-side API utilities for auth error detection.
 *
 * Provides a centralized check for 401 responses that redirects
 * the user to the login page when their session has expired.
 */

import { prefixApiPath } from "@/lib/api-fetch";

/**
 * Check if an API response indicates an authentication failure.
 * If so, redirect to the login page.
 *
 * @returns true if auth error detected (caller should return early)
 */
export function checkAuthResponse(response: Response): boolean {
  if (response.status === 401) {
    if (typeof window !== "undefined") {
      // Under RDV_BASE_PATH=/alpha the bare /login is a 404 — prefix at
      // runtime so the redirect lands on the correct instance.
      window.location.href = prefixApiPath("/login");
    }
    return true;
  }
  return false;
}
