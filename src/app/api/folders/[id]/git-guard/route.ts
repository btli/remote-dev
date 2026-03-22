/**
 * POST /api/folders/[id]/git-guard
 *
 * Evaluate whether a proposed git operation (commit or push) is safe
 * from an identity perspective in the context of this folder.
 *
 * Used by the rdv CLI PreToolUse hook to warn or block when an agent
 * is about to commit/push with an identity that doesn't match the
 * folder's configured pseudonymous identity.
 *
 * Request body:
 *   - proposedName: string - The git user.name that would be used
 *   - proposedEmail: string - The git user.email that would be used
 *   - operation: "commit" | "push" (default: "commit")
 *
 * Response:
 *   - risk: "none" | "warn" | "block"
 *   - reason: string | null
 *   - isSensitive: boolean
 *   - configuredIdentity: { name, email } | null
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { getFolderGitIdentity } from "@/services/preferences-service";
import { githubAccountRepository, folderRepository } from "@/infrastructure/container";
import { FolderGitIdentity } from "@/domain/value-objects/FolderGitIdentity";
import { GitIdentityGuard } from "@/domain/value-objects/GitIdentityGuard";

export const POST = withApiAuth(async (request, { userId, params }) => {
  const folderId = params!.id;

  // Verify folder ownership
  const folder = await folderRepository.findById(folderId, userId);
  if (!folder) {
    return errorResponse("Folder not found", 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  const proposedName = (body.proposedName as string) || "";
  const proposedEmail = (body.proposedEmail as string) || "";
  const operation = (body.operation as "commit" | "push") || "commit";

  if (operation !== "commit" && operation !== "push") {
    return errorResponse("operation must be 'commit' or 'push'", 400);
  }

  // Resolve folder's git identity and sensitivity
  const gitIdentityResult = await getFolderGitIdentity(userId, folderId);

  // Resolve bound GitHub account for context
  let boundAccountLogin: string | null = null;
  try {
    const account = await githubAccountRepository.findByFolder(folderId, userId);
    boundAccountLogin = account?.login ?? null;
  } catch {
    // Non-critical — proceed without account context
  }

  const folderIdentity = FolderGitIdentity.create({
    folderId,
    ...gitIdentityResult,
    boundAccountLogin,
  });

  const result = GitIdentityGuard.evaluate(
    folderIdentity,
    proposedName,
    proposedEmail,
    operation
  );

  return NextResponse.json({
    ...result,
    isSensitive: gitIdentityResult.isSensitive,
    configuredIdentity: folderIdentity.hasIdentity()
      ? {
          name: gitIdentityResult.gitIdentityName,
          email: gitIdentityResult.gitIdentityEmail,
        }
      : null,
  });
});
