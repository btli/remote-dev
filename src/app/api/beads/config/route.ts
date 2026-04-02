import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { validateProjectPath } from "@/lib/beads-auth";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/beads/config");

/**
 * GET /api/beads/config?projectPath=...
 * Returns the raw .beads/config.yaml content for display in settings.
 */
export const GET = withApiAuth(async (request, { userId }) => {
  const url = new URL(request.url);
  const projectPath = url.searchParams.get("projectPath");

  if (!projectPath) {
    return errorResponse("projectPath is required", 400);
  }

  const resolved = await validateProjectPath(userId, projectPath);
  if (!resolved) {
    return errorResponse("Invalid or unauthorized project path", 403);
  }

  const configPath = resolve(resolved, ".beads/config.yaml");
  if (!existsSync(configPath)) {
    return NextResponse.json({ content: null });
  }

  try {
    const content = await readFile(configPath, "utf-8");
    return NextResponse.json(
      { content },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    log.error("Failed to read beads config", { error: String(err), configPath });
    return errorResponse("Failed to read configuration file", 500);
  }
});
