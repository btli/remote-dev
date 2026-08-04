/**
 * GET /api/agent/sessions
 *
 * [hgwo] Multi-provider resumable-session discovery. Generalizes the
 * Claude-only `/api/agent/claude-sessions` route to every resume-capable
 * provider (claude, codex, gemini, opencode, cursor, kimi) by delegating to the
 * per-provider discovery (`session-id-discovery.ts`). Claude keeps its rich
 * `.jsonl` previews (first message + git branch); codex/gemini/opencode return
 * id + timestamp from flat-file disk discovery, Cursor filters its nested CLI
 * chat index by project path, and Kimi filters its top-level
 * session_index.jsonl by workDir (neither has a cheap preview). Antigravity
 * (no resume) is rejected as an invalid provider, the same as `none`.
 *
 * Response: `{ provider, sessions: ResumableSessionSummary[] }`.
 *
 * Query params:
 *   provider     - One of claude|codex|gemini|opencode|cursor|kimi (required)
 *   projectPath  - Absolute path of the project directory (required)
 *   projectId    - Project UUID for folder environment resolution (optional)
 *   profileId    - Agent profile ID for profile-isolated config (optional;
 *                  ignored for Claude, Cursor, and Kimi shared/indexed history)
 *   limit        - Max sessions to return (default: 20, max: 50)
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { validateProjectPath } from "@/lib/api-validation";
import { listResumableSessions } from "@/lib/agent-resume/session-id-discovery";
import { getResumeSpec } from "@/lib/agent-resume/agent-resume-registry";
import * as AgentProfileService from "@/services/agent-profile-service";
import { getEnvironmentForSession } from "@/services/preferences-service";
import type { AgentProviderType } from "@/types/session";

const VALID_PROVIDERS: AgentProviderType[] = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "kimi",
];

export const GET = withApiAuth(async (request, { userId }) => {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider") as AgentProviderType | null;
  const rawPath = searchParams.get("projectPath");
  const projectId = searchParams.get("projectId");
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
  //
  // Claude is excluded [remote-dev-n4x4.6]: its sessions run with
  // `CLAUDE_CONFIG_DIR` UNSET and therefore write their transcripts to the
  // user's real `~/.claude/projects`, which is what discovery falls back to
  // when the var is absent. Pointing it at `<profileDir>/.claude` would scan a
  // directory Claude never writes to and return an empty resume picker.
  // Cursor is also excluded: profile XDG/config isolation does not relocate
  // its chat index, which remains under ~/.cursor/chats unless the process was
  // launched with an explicit CURSOR_DATA_DIR (not emitted by profiles).
  // Kimi is excluded the same way: discovery reads the session_index.jsonl
  // under KIMI_CODE_HOME (default ~/.kimi-code), which profile configDir
  // injection would mispoint.
  const env: Record<string, string> =
    provider === "cursor" && process.env.CURSOR_DATA_DIR
      ? { CURSOR_DATA_DIR: process.env.CURSOR_DATA_DIR }
      : provider === "kimi" && process.env.KIMI_CODE_HOME
        ? { KIMI_CODE_HOME: process.env.KIMI_CODE_HOME }
        : {};
  if (provider === "cursor" && projectId) {
    const folderEnv = await getEnvironmentForSession(userId, projectId);
    if (folderEnv?.CURSOR_DATA_DIR) {
      // Folder environment has the same higher precedence it receives during
      // session creation, so picker discovery and launch use one data root.
      env.CURSOR_DATA_DIR = folderEnv.CURSOR_DATA_DIR;
    }
  }
  if (provider === "kimi" && projectId) {
    const folderEnv = await getEnvironmentForSession(userId, projectId);
    if (folderEnv?.KIMI_CODE_HOME) {
      // Same precedence rule as the Cursor data root above: picker discovery
      // must read the same Kimi home the launched session writes to.
      env.KIMI_CODE_HOME = folderEnv.KIMI_CODE_HOME;
    }
  }
  if (profileId && provider !== "claude" && provider !== "cursor" && provider !== "kimi") {
    const profile = await AgentProfileService.getProfile(profileId, userId);
    if (profile) {
      const spec = getResumeSpec(provider);
      if (spec.sessionIdSource.homeEnvVar && profile.configDir) {
        env[spec.sessionIdSource.homeEnvVar] = profile.configDir;
      }
    }
  }

  const sessions = await listResumableSessions(provider, projectPath, env, limit);
  return NextResponse.json({ provider, sessions });
});
