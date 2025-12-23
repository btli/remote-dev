/**
 * API utilities and wrappers
 *
 * Provides common functionality for API routes including authentication checks
 * and error handling.
 */

import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import * as ApiKeyService from "@/services/api-key-service";

/**
 * Route context type for dynamic routes
 *
 * In Next.js 15, route params are wrapped in a Promise to support
 * streaming and async rendering. The withAuth wrapper awaits this
 * automatically before passing params to the handler.
 */
export interface RouteContext {
  params?: Promise<Record<string, string>>;
}

/**
 * Wrap an API route handler with authentication
 *
 * Automatically checks for a valid session and extracts the user ID.
 * Returns 401 Unauthorized if no valid session exists.
 * Catches any unhandled errors and returns a standardized 500 response.
 *
 * @param handler - The route handler function to wrap
 * @returns Wrapped handler that checks auth before calling the original handler
 *
 * @example
 * ```ts
 * export const GET = withAuth(async (request, { userId }) => {
 *   const data = await fetchUserData(userId);
 *   return NextResponse.json(data);
 * });
 * ```
 */
export function withAuth(
  handler: (
    request: Request,
    context: { userId: string; params?: Record<string, string> }
  ) => Promise<NextResponse>
): (request: Request, context?: RouteContext) => Promise<NextResponse> {
  return async (request: Request, context?: RouteContext) => {
    try {
      const session = await getAuthSession();

      if (!session?.user?.id) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 }
        );
      }

      // Await params if provided (for dynamic routes)
      const params = context?.params ? await context.params : undefined;

      return await handler(request, { userId: session.user.id, params });
    } catch (error) {
      console.error("Unhandled error in API route:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}

/**
 * Wrap an API route handler with authentication that supports both session and API key auth
 *
 * This wrapper first tries session-based authentication (NextAuth/Cloudflare Access),
 * then falls back to API key authentication via Bearer token.
 *
 * Use this for endpoints that agents need to access programmatically.
 *
 * @param handler - The route handler function to wrap
 * @returns Wrapped handler that checks auth before calling the original handler
 *
 * @example
 * ```ts
 * // Works with both browser sessions and API keys
 * export const POST = withApiAuth(async (request, { userId }) => {
 *   const data = await executeCommand(userId, request);
 *   return NextResponse.json(data);
 * });
 * ```
 */
export function withApiAuth(
  handler: (
    request: Request,
    context: { userId: string; params?: Record<string, string> }
  ) => Promise<NextResponse>
): (request: Request, context?: RouteContext) => Promise<NextResponse> {
  return async (request: Request, context?: RouteContext) => {
    try {
      let userId: string | null = null;

      // Try session auth first (for backward compatibility with browser sessions)
      const session = await getAuthSession();
      if (session?.user?.id) {
        userId = session.user.id;
      }

      // If no session, try API key auth
      if (!userId) {
        const authHeader = request.headers.get("authorization");
        if (authHeader?.startsWith("Bearer ")) {
          const apiKey = authHeader.substring(7);
          const validated = await ApiKeyService.validateApiKey(apiKey);

          if (validated) {
            userId = validated.userId;
            // Update last used timestamp asynchronously (don't block response)
            ApiKeyService.touchApiKey(validated.keyId).catch(() => {});
          }
        }
      }

      // No valid auth found
      if (!userId) {
        return NextResponse.json(
          { error: "Unauthorized", code: "UNAUTHORIZED" },
          { status: 401 }
        );
      }

      // Await params if provided (for dynamic routes)
      const params = context?.params ? await context.params : undefined;

      return await handler(request, { userId, params });
    } catch (error) {
      console.error("Unhandled error in API route:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}

/**
 * Standard error response helper
 *
 * Creates a consistent JSON error response with optional error code and details.
 * Automatically logs server errors (5xx) for debugging.
 *
 * @param message - Human-readable error message
 * @param status - HTTP status code (default: 500)
 * @param code - Optional machine-readable error code for client handling
 * @param details - Optional additional details (e.g., stderr output for debugging)
 * @returns NextResponse with error JSON body
 *
 * @example
 * ```ts
 * return errorResponse("Not found", 404);
 * return errorResponse("GitHub not connected", 400, "GITHUB_NOT_CONNECTED");
 * return errorResponse("Failed to create worktree", 400, "CREATE_FAILED", err.stderr);
 * ```
 */
export function errorResponse(
  message: string,
  status: number = 500,
  code?: string,
  details?: string
): NextResponse<{ error: string; code?: string; details?: string }> {
  // Log server errors for debugging
  if (status >= 500) {
    console.error(`API Error [${status}]:`, message, code ? `(${code})` : "", details || "");
  }

  const body: { error: string; code?: string; details?: string } = { error: message };
  if (code) body.code = code;
  if (details) body.details = details;

  return NextResponse.json(body, { status });
}

/**
 * Helper for safely parsing JSON request body
 *
 * Handles SyntaxError from malformed JSON and returns a proper 400 response.
 *
 * @param request - The incoming Request object
 * @returns Object with either parsed data or error response
 *
 * @example
 * ```ts
 * const result = await parseJsonBody<{ name: string }>(request);
 * if ('error' in result) return result.error;
 * const { name } = result.data;
 * ```
 */
export async function parseJsonBody<T>(
  request: Request
): Promise<{ data: T } | { error: NextResponse }> {
  try {
    const data = (await request.json()) as T;
    return { data };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { error: errorResponse("Invalid JSON in request body", 400, "INVALID_JSON") };
    }
    throw error;
  }
}
