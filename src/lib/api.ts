/**
 * API utilities and wrappers
 *
 * Provides common functionality for API routes including authentication checks
 * and error handling.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Route params type for dynamic routes
 */
export interface RouteContext {
  params?: Promise<Record<string, string>>;
}

/**
 * Wrap an API route handler with authentication
 *
 * Automatically checks for a valid session and extracts the user ID.
 * Returns 401 Unauthorized if no valid session exists.
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
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Await params if provided (for dynamic routes)
    const params = context?.params ? await context.params : undefined;

    return handler(request, { userId: session.user.id, params });
  };
}

/**
 * Standard error response helper
 */
export function errorResponse(
  message: string,
  status: number = 500,
  code?: string
): NextResponse<{ error: string; code?: string }> {
  return NextResponse.json(
    code ? { error: message, code } : { error: message },
    { status }
  );
}

/**
 * Standard success response helper
 */
export function successResponse<T>(data: T, status: number = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}
