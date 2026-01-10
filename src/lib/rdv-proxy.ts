/**
 * rdv-server Unix Socket Proxy
 *
 * Proxies API requests from Next.js to rdv-server via Unix socket.
 * This enables the architecture where Next.js is a thin proxy layer
 * and rdv-server (Rust) handles all backend business logic.
 *
 * Architecture:
 *   Browser → Next.js (Unix socket) → rdv-server (Unix socket) → SQLite/tmux
 *
 * Authentication flow:
 *   1. Next.js validates user session (NextAuth/CF Access)
 *   2. Reads service token from ~/.rdv/server/service-token
 *   3. Forwards request with X-RDV-Service-Token and X-RDV-User-ID headers
 *   4. rdv-server validates service token and processes request
 */

import { NextResponse } from "next/server";
import { Agent, request as undiciRequest } from "undici";
import { readFileSync, existsSync, statSync, watchFile, unwatchFile } from "fs";
import { homedir } from "os";
import { join } from "path";

// Default paths (can be overridden via environment variables)
// All sockets and runtime files are in ~/.remote-dev/run/
const REMOTE_DEV_DIR = process.env.REMOTE_DEV_DIR || join(homedir(), ".remote-dev");
const RDV_API_SOCKET = process.env.RDV_API_SOCKET || join(REMOTE_DEV_DIR, "run", "api.sock");
const RDV_SERVICE_TOKEN_FILE = process.env.RDV_SERVICE_TOKEN_FILE || join(REMOTE_DEV_DIR, "server", "service-token");

// Service token cache with file watcher for rotation
let cachedServiceToken: string | null = null;
let tokenFileWatcher: ReturnType<typeof watchFile> | null = null;
let tokenFileMtime: number = 0;

/**
 * Load service token from file with caching and file watching
 */
function loadServiceToken(): string | null {
  // Check if file exists
  if (!existsSync(RDV_SERVICE_TOKEN_FILE)) {
    console.warn(`[rdv-proxy] Service token file not found: ${RDV_SERVICE_TOKEN_FILE}`);
    return null;
  }

  // Check if file was modified
  const stats = statSync(RDV_SERVICE_TOKEN_FILE);
  const mtime = stats.mtimeMs;

  if (cachedServiceToken && mtime === tokenFileMtime) {
    return cachedServiceToken;
  }

  // Read and cache token
  try {
    cachedServiceToken = readFileSync(RDV_SERVICE_TOKEN_FILE, "utf-8").trim();
    tokenFileMtime = mtime;

    // Set up file watcher for token rotation (only once)
    if (!tokenFileWatcher) {
      tokenFileWatcher = watchFile(RDV_SERVICE_TOKEN_FILE, { interval: 5000 }, () => {
        // Invalidate cache on file change
        cachedServiceToken = null;
        tokenFileMtime = 0;
        console.log("[rdv-proxy] Service token file changed, will reload on next request");
      });
    }

    return cachedServiceToken;
  } catch (error) {
    console.error(`[rdv-proxy] Failed to read service token:`, error);
    return null;
  }
}

/**
 * Create undici Agent for Unix socket connections
 */
function createSocketAgent(): Agent {
  return new Agent({
    connect: {
      socketPath: RDV_API_SOCKET,
    },
  });
}

// Singleton agent for connection pooling
let socketAgent: Agent | null = null;

function getSocketAgent(): Agent {
  if (!socketAgent) {
    socketAgent = createSocketAgent();
  }
  return socketAgent;
}

/**
 * Check if rdv-server is available
 */
export async function isRdvServerAvailable(): Promise<boolean> {
  if (!existsSync(RDV_API_SOCKET)) {
    return false;
  }

  try {
    const response = await undiciRequest("http://localhost/health", {
      dispatcher: getSocketAgent(),
      method: "GET",
      headersTimeout: 1000,
      bodyTimeout: 1000,
    });
    return response.statusCode === 200;
  } catch {
    return false;
  }
}

/**
 * Proxy options for customizing request forwarding
 */
export interface ProxyOptions {
  /** Override the target path (default: use request path) */
  path?: string;
  /** Additional headers to include */
  headers?: Record<string, string>;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Proxy a request to rdv-server via Unix socket
 *
 * @param request - Original Next.js request
 * @param userId - Authenticated user ID from session
 * @param options - Optional proxy configuration
 * @returns Response from rdv-server or error response
 *
 * @example
 * ```ts
 * export const GET = withAuth(async (request, { userId }) => {
 *   return proxyToRdvServer(request, userId);
 * });
 * ```
 */
export async function proxyToRdvServer(
  request: Request,
  userId: string,
  options: ProxyOptions = {}
): Promise<NextResponse> {
  // Load service token
  const serviceToken = loadServiceToken();
  if (!serviceToken) {
    return NextResponse.json(
      { error: "rdv-server not configured", code: "RDV_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  // Check socket exists
  if (!existsSync(RDV_API_SOCKET)) {
    return NextResponse.json(
      { error: "rdv-server not running", code: "RDV_NOT_RUNNING" },
      { status: 503 }
    );
  }

  // Build target URL
  const url = new URL(request.url);
  const targetPath = options.path || url.pathname;
  const targetUrl = `http://localhost${targetPath}${url.search}`;

  // Build headers
  const headers: Record<string, string> = {
    "X-RDV-Service-Token": serviceToken,
    "X-RDV-User-ID": userId,
    "Content-Type": request.headers.get("Content-Type") || "application/json",
    ...options.headers,
  };

  // Forward relevant headers
  const forwardHeaders = ["Accept", "Accept-Language", "User-Agent"];
  for (const header of forwardHeaders) {
    const value = request.headers.get(header);
    if (value) headers[header] = value;
  }

  try {
    // Get request body if present
    let body: Buffer | undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const arrayBuffer = await request.arrayBuffer();
      if (arrayBuffer.byteLength > 0) {
        body = Buffer.from(arrayBuffer);
      }
    }

    // Make request to rdv-server
    const response = await undiciRequest(targetUrl, {
      dispatcher: getSocketAgent(),
      method: request.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      headers,
      body,
      headersTimeout: options.timeout || 30000,
      bodyTimeout: options.timeout || 30000,
    });

    // Read response body
    const responseBody = await response.body.text();

    // Build response headers
    const responseHeaders: Record<string, string> = {};
    const contentType = response.headers["content-type"];
    if (contentType) {
      responseHeaders["Content-Type"] = Array.isArray(contentType) ? contentType[0] : contentType;
    }

    // Return proxied response
    return new NextResponse(responseBody, {
      status: response.statusCode,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[rdv-proxy] Request failed:", error);

    // Handle connection errors
    if (error instanceof Error) {
      if (error.message.includes("ECONNREFUSED") || error.message.includes("ENOENT")) {
        return NextResponse.json(
          { error: "rdv-server not available", code: "RDV_UNAVAILABLE" },
          { status: 503 }
        );
      }
      if (error.message.includes("timeout")) {
        return NextResponse.json(
          { error: "rdv-server timeout", code: "RDV_TIMEOUT" },
          { status: 504 }
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to proxy request", code: "PROXY_ERROR" },
      { status: 502 }
    );
  }
}

/**
 * Wrap a handler to proxy to rdv-server with fallback support
 *
 * If rdv-server is available, proxies the request.
 * If not available and fallback is provided, uses the fallback handler.
 * If not available and no fallback, returns 503.
 *
 * @param options - Proxy options
 * @param fallback - Optional fallback handler when rdv-server is unavailable
 *
 * @example
 * ```ts
 * // Proxy with no fallback (503 if rdv-server down)
 * export const GET = withAuth(withProxy());
 *
 * // Proxy with fallback to existing implementation
 * export const GET = withAuth(withProxy({}, async (request, { userId }) => {
 *   // Existing implementation
 * }));
 * ```
 */
export function withProxy(
  options: ProxyOptions = {},
  fallback?: (
    request: Request,
    context: { userId: string; params?: Record<string, string> }
  ) => Promise<NextResponse>
) {
  return async (
    request: Request,
    context: { userId: string; params?: Record<string, string> }
  ): Promise<NextResponse> => {
    // Check if rdv-server is available
    const available = await isRdvServerAvailable();

    if (available) {
      return proxyToRdvServer(request, context.userId, options);
    }

    // Use fallback if provided
    if (fallback) {
      console.log("[rdv-proxy] rdv-server unavailable, using fallback");
      return fallback(request, context);
    }

    // No fallback, return error
    return NextResponse.json(
      { error: "rdv-server not available", code: "RDV_UNAVAILABLE" },
      { status: 503 }
    );
  };
}

/**
 * Cleanup function to be called on server shutdown
 */
export function cleanupProxy(): void {
  if (tokenFileWatcher) {
    unwatchFile(RDV_SERVICE_TOKEN_FILE);
    tokenFileWatcher = null;
  }
  if (socketAgent) {
    socketAgent.close();
    socketAgent = null;
  }
}
