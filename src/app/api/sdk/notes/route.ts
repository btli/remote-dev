/**
 * SDK Notes API Routes
 *
 * Provides CRUD operations for the note-taking service.
 * Notes are captured observations, decisions, gotchas, and patterns during coding sessions.
 *
 * Proxies to rdv-server for all operations.
 */

import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * POST /api/sdk/notes - Create a new note
 *
 * Proxies to rdv-server.
 */
export const POST = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/sdk/notes",
  });
});

/**
 * GET /api/sdk/notes - Query notes with folder inheritance
 *
 * Notes are folder-scoped with inheritance from parent folders.
 * When querying a subfolder, notes from all ancestor folders are included.
 *
 * Query params:
 * - folderId: Filter by folder (includes inherited notes from ancestors)
 * - type: Filter by note type
 * - tag: Filter by tag (searches within tagsJson)
 * - search: Search in content
 * - pinned: Filter by pinned status (true/false)
 * - archived: Include archived notes (default: false)
 * - sortBy: Sort field (createdAt, updatedAt, priority) - default: createdAt
 * - sortOrder: asc or desc - default: desc
 * - limit: Max results - default: 50
 * - inherit: Enable folder inheritance (default: true)
 *
 * Proxies to rdv-server.
 */
export const GET = withAuth(async (request, { userId }) => {
  return proxyToRdvServer(request, userId, {
    path: "/sdk/notes",
  });
});
