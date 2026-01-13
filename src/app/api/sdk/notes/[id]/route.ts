/**
 * SDK Note Entry API Routes
 *
 * Provides single note operations: get, update, delete.
 * Proxies to rdv-server for all operations.
 */

import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * GET /api/sdk/notes/:id - Get a single note
 *
 * Proxies to rdv-server.
 */
export const GET = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/sdk/notes/${params!.id}`,
  });
});

/**
 * PATCH /api/sdk/notes/:id - Update a note
 *
 * Updatable fields:
 * - type: Note type
 * - title: Short title
 * - content: Note content
 * - tags: Tags array
 * - context: Context object
 * - priority: Priority (0.0 to 1.0)
 * - pinned: Pinned status
 * - archived: Archived status
 *
 * Proxies to rdv-server.
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/sdk/notes/${params!.id}`,
  });
});

/**
 * DELETE /api/sdk/notes/:id - Delete a note
 *
 * Proxies to rdv-server.
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/sdk/notes/${params!.id}`,
  });
});
