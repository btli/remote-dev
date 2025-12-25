import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getAllFolderSecretsConfigsWithFolders } from "@/services/secrets-service";

/**
 * GET /api/secrets/configs
 * Returns all folder secrets configurations for the current user
 */
export const GET = withAuth(async (_request, { userId }) => {
  const configs = await getAllFolderSecretsConfigsWithFolders(userId);
  return NextResponse.json(configs);
});
