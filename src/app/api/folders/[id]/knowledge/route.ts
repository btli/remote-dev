import { withAuth } from "@/lib/api";
import { proxyToRdvServer } from "@/lib/rdv-proxy";

/**
 * GET /api/folders/[id]/knowledge - Get project knowledge for a folder
 *
 * Query parameters:
 * - search?: Search query for semantic search through knowledge
 * - type?: Filter by type (convention, pattern, skill, tool)
 * - category?: Filter conventions by category
 *
 * Proxies to rdv-server /api/folders/:id/knowledge.
 */
export const GET = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/folders/${params!.id}/knowledge`,
  });
});

/**
 * PATCH /api/folders/[id]/knowledge - Update project knowledge
 *
 * Body options:
 * - action: "add_convention" | "add_pattern" | "add_skill" | "add_tool" | "update_tech_stack" | "update_metadata" | "scan"
 * - data: Data for the action
 *
 * Proxies to rdv-server /api/folders/:id/knowledge.
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/folders/${params!.id}/knowledge`,
  });
});

/**
 * DELETE /api/folders/[id]/knowledge - Delete project knowledge
 *
 * Proxies to rdv-server /api/folders/:id/knowledge.
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  return proxyToRdvServer(request, userId, {
    path: `/folders/${params!.id}/knowledge`,
  });
});
