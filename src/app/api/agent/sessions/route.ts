/**
 * GET /api/agent/sessions
 *
 * [hgwo] Multi-provider resumable-session discovery. Generalizes the
 * Claude-only `/api/agent/claude-sessions` route to every resume-capable
 * provider (claude, codex, gemini, opencode) by delegating to the per-provider
 * discovery (`session-id-discovery.ts`). Claude keeps its rich `.jsonl`
 * previews (first message + git branch); codex/gemini/opencode return id +
 * timestamp from disk discovery (no cheap preview). Antigravity (no resume) is
 * rejected as an invalid provider, the same as `none`.
 *
 * Response: `{ provider, sessions: ResumableSessionSummary[] }`.
 *
 * Query params:
 *   provider     - One of claude|codex|gemini|opencode (required)
 *   projectPath  - Absolute path of the project directory (required)
 *   profileId    - Agent profile ID for profile-isolated config (optional)
 *   limit        - Max sessions to return (default: 20, max: 50)
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { validateProjectPath } from "@/lib/api-validation";
import { listResumableSessions } from "@/lib/agent-resume/session-id-discovery";
import { getResumeSpec } from "@/lib/agent-resume/agent-resume-registry";
import * as AgentProfileService from "@/services/agent-profile-service";
import type { AgentProviderType } from "@/types/session";

const VALID_PROVIDERS: AgentProviderType[] = ["claude", "codex", "gemini", "opencode"];

export const GET = withApiAuth(async (request, { userId }) => {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider") as AgentProviderType | null;
  const rawPath = searchParams.get("projectPath");
  const profileId = searchParams.get("profileId");
  const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = Math.min(Math.max(1, rawLimit), 50);

  if (!provider || !VALID_PROVIDERS.includes(provider)) {
    return errorResponse(
      `provider must be one of: ${VALID_PROVIDERS.join(", ")}`,
      400,
      "INVALID_PROVIDER",
    );
  }

  const projectPath = validateProjectPath(rawPath ?? undefined);
  if (!projectPath) {
    return errorResponse("Valid absolute projectPath is required", 400, "INVALID_PROJECT_PATH");
  }

  // Resolve the profile-isolated env so discovery scans the right CLI home dir.
  const env: Record<string, string> = {};
  if (profileId) {
    const profile = await AgentProfileService.getProfile(profileId, userId);
    if (profile) {
      const spec = getResumeSpec(provider);
      if (spec.sessionIdSource.homeEnvVar && profile.configDir) {
        // claude joins ".claude" itself; pass the bare config dir for it, and
        // the provider home dir for the rest.
        env[spec.sessionIdSource.homeEnvVar] = profile.configDir;
      }
      if (provider === "claude") {
        env.CLAUDE_CONFIG_DIR = profile.configDir;
      }
    }
  }

  const sessions = await listResumableSessions(provider, projectPath, env, limit);
  return NextResponse.json({ provider, sessions });
});
