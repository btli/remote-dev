/**
 * HTTP Client for SDK API calls
 */

import type { HTTPClient, HTTPRequestOptions } from "../types";

/**
 * Create an HTTP client for API calls.
 */
export function createHttpClient(baseUrl: string): HTTPClient {
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: HTTPRequestOptions
  ): Promise<T> {
    const url = new URL(path, baseUrl);

    // Add query parameters
    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options?.headers,
    };

    // Create abort controller for timeout
    const timeoutController = new AbortController();
    const timeoutId = options?.timeoutMs
      ? setTimeout(() => timeoutController.abort(), options.timeoutMs)
      : null;

    // Combine external signal with timeout signal using AbortSignal.any()
    // This ensures the request aborts on whichever fires first
    const signals: AbortSignal[] = [timeoutController.signal];
    if (options?.signal) {
      signals.push(options.signal);
    }
    const combinedSignal = AbortSignal.any(signals);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: combinedSignal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `HTTP ${response.status}: ${response.statusText} - ${errorBody}`
        );
      }

      // Handle empty responses
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        return (await response.json()) as T;
      }

      return undefined as T;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  return {
    get<T>(path: string, options?: HTTPRequestOptions): Promise<T> {
      return request<T>("GET", path, undefined, options);
    },

    post<T>(
      path: string,
      body: unknown,
      options?: HTTPRequestOptions
    ): Promise<T> {
      return request<T>("POST", path, body, options);
    },

    put<T>(
      path: string,
      body: unknown,
      options?: HTTPRequestOptions
    ): Promise<T> {
      return request<T>("PUT", path, body, options);
    },

    patch<T>(
      path: string,
      body: unknown,
      options?: HTTPRequestOptions
    ): Promise<T> {
      return request<T>("PATCH", path, body, options);
    },

    delete<T>(path: string, options?: HTTPRequestOptions): Promise<T> {
      return request<T>("DELETE", path, undefined, options);
    },
  };
}
