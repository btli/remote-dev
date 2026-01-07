import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";

/**
 * POST /api/setup/install
 * Attempts to install a dependency (placeholder - actual install via system)
 *
 * In practice, dependencies should be installed manually or via Electron's
 * native module capabilities. This route primarily returns the install command.
 */
export const POST = withAuth(async (request) => {
  const result = await parseJsonBody<{ dependency: string }>(request);
  if ("error" in result) return result.error;
  const { dependency } = result.data;

  if (!dependency) {
    return errorResponse("Missing dependency name", 400, "MISSING_DEPENDENCY");
  }

  // For security reasons, we don't actually run installation commands
  // from the web API. Instead, we return an error with instructions.
  // The actual installation should happen through:
  // 1. Electron's IPC with proper sudo handling
  // 2. User running the command manually in their terminal

  return NextResponse.json({
    success: false,
    error: `Automatic installation is not supported via the web API for security reasons. Please install ${dependency} manually using the provided command, or use the desktop app for guided installation.`,
    requiresManualInstall: true,
  });
});
