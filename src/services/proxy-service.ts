/**
 * ProxyService - Handles reverse proxy resolution and request forwarding
 *
 * This service resolves proxy slugs (folder names) to dev server targets
 * and provides utilities for the proxy API route.
 */
import { db } from "@/db";
import { terminalSessions, sessionFolders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { slugify } from "@/types/dev-server";
import type { ProxyContext } from "@/types/dev-server";

export class ProxyServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = "ProxyServiceError";
  }
}

/**
 * Resolve a proxy slug to the target dev server context
 *
 * @param slug - The URL slug (slugified folder name)
 * @param userId - The authenticated user ID
 * @returns ProxyContext with all needed information for proxying
 */
export async function resolveProxyTarget(
  slug: string,
  userId: string
): Promise<ProxyContext> {
  // Find the folder by matching slugified name
  const folders = await db.query.sessionFolders.findMany({
    where: eq(sessionFolders.userId, userId),
  });

  const folder = folders.find(f => slugify(f.name) === slug);

  if (!folder) {
    throw new ProxyServiceError(
      `No folder found matching slug: ${slug}`,
      "FOLDER_NOT_FOUND",
      404
    );
  }

  // Find the active dev server for this folder
  const session = await db.query.terminalSessions.findFirst({
    where: and(
      eq(terminalSessions.folderId, folder.id),
      eq(terminalSessions.userId, userId),
      eq(terminalSessions.sessionType, "dev-server"),
      eq(terminalSessions.status, "active")
    ),
  });

  if (!session) {
    throw new ProxyServiceError(
      `No dev server running for folder: ${folder.name}`,
      "NO_DEV_SERVER",
      503
    );
  }

  if (!session.devServerPort) {
    throw new ProxyServiceError(
      "Dev server has no port configured",
      "NO_PORT",
      500
    );
  }

  // Check if server is in a healthy state
  if (session.devServerStatus === "crashed") {
    throw new ProxyServiceError(
      "Dev server has crashed",
      "SERVER_CRASHED",
      503
    );
  }

  return {
    slug,
    path: "", // Will be set by the route handler
    folderId: folder.id,
    sessionId: session.id,
    port: session.devServerPort,
    userId,
  };
}

/**
 * Get the localhost URL for a dev server
 */
export function getLocalUrl(port: number, path: string = ""): string {
  // Remove leading slash from path if present
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `http://127.0.0.1:${port}/${cleanPath}`;
}

/**
 * Build the proxy request options
 */
export function buildProxyRequest(
  context: ProxyContext,
  path: string,
  originalRequest: Request
): { url: string; init: RequestInit } {
  const targetUrl = getLocalUrl(context.port, path);

  // Copy headers, removing hop-by-hop headers
  const headers = new Headers();
  const hopByHopHeaders = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]);

  originalRequest.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  // Set proper forwarding headers
  headers.set("X-Forwarded-For", originalRequest.headers.get("x-forwarded-for") ?? "");
  headers.set("X-Forwarded-Proto", "https");
  headers.set("X-Forwarded-Host", originalRequest.headers.get("host") ?? "");
  headers.set("X-Real-IP", originalRequest.headers.get("cf-connecting-ip") ?? "");

  // Fix Host header for localhost
  headers.set("Host", `127.0.0.1:${context.port}`);

  return {
    url: targetUrl,
    init: {
      method: originalRequest.method,
      headers,
      body: originalRequest.body,
      // @ts-expect-error - duplex is needed for streaming body but not in standard types
      duplex: "half",
    },
  };
}

/**
 * Check if a request is a WebSocket upgrade request
 */
export function isWebSocketUpgrade(request: Request): boolean {
  const upgrade = request.headers.get("upgrade");
  return upgrade?.toLowerCase() === "websocket";
}

/**
 * Get all active proxy targets for a user
 */
export async function getActiveProxyTargets(
  userId: string
): Promise<Array<{ slug: string; folderName: string; port: number; status: string }>> {
  const sessions = await db.query.terminalSessions.findMany({
    where: and(
      eq(terminalSessions.userId, userId),
      eq(terminalSessions.sessionType, "dev-server"),
      eq(terminalSessions.status, "active")
    ),
  });

  const targets: Array<{ slug: string; folderName: string; port: number; status: string }> = [];

  for (const session of sessions) {
    if (!session.folderId || !session.devServerPort) continue;

    const folder = await db.query.sessionFolders.findFirst({
      where: eq(sessionFolders.id, session.folderId),
    });

    if (folder) {
      targets.push({
        slug: slugify(folder.name),
        folderName: folder.name,
        port: session.devServerPort,
        status: session.devServerStatus ?? "unknown",
      });
    }
  }

  return targets;
}
