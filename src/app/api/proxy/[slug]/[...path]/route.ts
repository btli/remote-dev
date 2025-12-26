import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import * as ProxyService from "@/services/proxy-service";

/**
 * Proxy handler that forwards requests to the dev server
 *
 * This handles all HTTP methods (GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD)
 * and proxies them to the appropriate localhost port based on the slug.
 *
 * URL pattern: /api/proxy/[slug]/[...path]
 * Example: /api/proxy/my-project/api/users -> http://localhost:3000/api/users
 *
 * Note: WebSocket connections for HMR should be handled separately via the terminal server.
 */
async function proxyHandler(
  request: Request,
  { userId, params }: { userId: string; params?: Record<string, string> }
): Promise<NextResponse> {
  // Handle both string and array for path (catch-all routes return array)
  const slug = params?.slug || "";
  const pathParam = params?.path;
  const pathStr = Array.isArray(pathParam) ? pathParam.join("/") : (pathParam || "");

  // Check for WebSocket upgrade request
  if (ProxyService.isWebSocketUpgrade(request)) {
    // WebSocket upgrades cannot be handled in Next.js route handlers
    // They need to go through the terminal server
    return errorResponse(
      "WebSocket connections should use the terminal server WebSocket endpoint",
      426,
      "UPGRADE_REQUIRED"
    );
  }

  try {
    // Resolve the proxy target
    const context = await ProxyService.resolveProxyTarget(slug, userId);

    // Build the proxy request
    const { url, init } = ProxyService.buildProxyRequest(context, pathStr, request);

    // Forward the request to the dev server
    const response = await fetch(url, init);

    // Create a new response with the proxied content
    const headers = new Headers();

    // Copy response headers, filtering hop-by-hop headers
    const hopByHopHeaders = new Set([
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
      "transfer-encoding",
    ]);

    response.headers.forEach((value, key) => {
      if (!hopByHopHeaders.has(key.toLowerCase())) {
        headers.set(key, value);
      }
    });

    // Return the proxied response
    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    if (error instanceof ProxyService.ProxyServiceError) {
      return errorResponse(error.message, error.statusCode, error.code);
    }

    // Handle fetch errors (connection refused, timeout, etc.)
    if (error instanceof TypeError && (error.message.includes("fetch") || error.message.includes("ECONNREFUSED"))) {
      return errorResponse(
        "Dev server is not responding. It may still be starting up.",
        503,
        "SERVER_UNAVAILABLE"
      );
    }

    console.error("[Proxy] Unexpected error:", error);
    return errorResponse("Proxy error", 502, "PROXY_ERROR");
  }
}

// Export handlers for all HTTP methods
export const GET = withAuth(proxyHandler);
export const POST = withAuth(proxyHandler);
export const PUT = withAuth(proxyHandler);
export const DELETE = withAuth(proxyHandler);
export const PATCH = withAuth(proxyHandler);
export const OPTIONS = withAuth(proxyHandler);
export const HEAD = withAuth(proxyHandler);
