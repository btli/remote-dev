/**
 * GET /api/agent/claude-sessions
 *
 * Lists resumable Claude Code sessions for a given project path.
 * Scans .jsonl files from ~/.claude/projects/<encoded-path>/
 * or profile-isolated equivalent.
 *
 * Query params:
 *   projectPath  - Absolute path of the project directory (required)
 *   profileId    - Agent profile ID for profile-isolated config (optional)
 *   limit        - Max sessions to return (default: 20, max: 50)
 */

import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { validateProjectPath } from "@/lib/api-validation";
import * as ClaudeSessionService from "@/services/claude-session-service";
import * as AgentProfileService from "@/services/agent-profile-service";

export const GET = withAuth(async (request, { userId }) => {
  const { searchParams } = new URL(request.url);
  const rawPath = searchParams.get("projectPath");
  const profileId = searchParams.get("profileId");
  const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = Math.min(Math.max(1, rawLimit), 50);

  const projectPath = validateProjectPath(rawPath ?? undefined);
  if (!projectPath) {
    return errorResponse("Valid absolute projectPath is required", 400, "INVALID_PROJECT_PATH");
  }

  // Resolve profile config dir if a profileId is provided
  let profileConfigDir: string | undefined;
  if (profileId) {
    const profile = await AgentProfileService.getProfile(profileId, userId);
    if (profile) {
      profileConfigDir = profile.configDir;
    }
  }

  const sessions = await ClaudeSessionService.listSessions(projectPath, {
    limit,
    profileConfigDir,
  });

  return NextResponse.json({ sessions });
});
