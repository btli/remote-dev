import { NextResponse } from "next/server";
import { z } from "zod";

import { GitIdentityGuard } from "@/domain/value-objects/GitIdentityGuard";
import { FolderGitIdentity } from "@/domain/value-objects/FolderGitIdentity";
import { errorResponse, parseJsonBody, withApiAuth } from "@/lib/api";
import { getFolderGitIdentity } from "@/services/preferences-service";
import { ProjectService } from "@/services/project-service";

const guardSchema = z.object({
  proposedAuthorName: z.string().max(512),
  proposedAuthorEmail: z.string().max(512),
  proposedCommitterName: z.string().max(512),
  proposedCommitterEmail: z.string().max(512),
  operation: z.enum(["commit", "push"]),
});

/** Evaluate git identity policy for an authenticated, owned project. */
export const POST = withApiAuth(async (request, { userId, params }) => {
  const projectId = params?.id;
  if (!projectId) return errorResponse("project id is required", 400);

  const project = await ProjectService.get(projectId);
  if (!project || project.userId !== userId) {
    return errorResponse("not found", 404);
  }

  const body = await parseJsonBody<unknown>(request);
  if ("error" in body) return body.error;
  const parsed = guardSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const resolved = await getFolderGitIdentity(userId, projectId);
  const identity = FolderGitIdentity.create({
    folderId: projectId,
    gitIdentityName: resolved.gitIdentityName,
    gitIdentityEmail: resolved.gitIdentityEmail,
    isSensitive: resolved.isSensitive,
    boundAccountLogin: null,
  });
  const evaluations = [
    {
      role: "author",
      result: GitIdentityGuard.evaluate(
        identity,
        parsed.data.proposedAuthorName,
        parsed.data.proposedAuthorEmail,
        parsed.data.operation,
      ),
    },
    {
      role: "committer",
      result: GitIdentityGuard.evaluate(
        identity,
        parsed.data.proposedCommitterName,
        parsed.data.proposedCommitterEmail,
        parsed.data.operation,
      ),
    },
  ] as const;
  const risk = evaluations.some(({ result }) => result.risk === "block")
    ? "block"
    : evaluations.some(({ result }) => result.risk === "warn")
      ? "warn"
      : "none";
  const reason = evaluations
    .filter(({ result }) => result.risk !== "none" && result.reason)
    .map(({ role, result }) => `${role}: ${result.reason}`)
    .join(" ") || null;
  return NextResponse.json({ risk, reason });
});
