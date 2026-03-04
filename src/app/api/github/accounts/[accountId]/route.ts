import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import {
  unlinkGitHubAccountUseCase,
  setDefaultGitHubAccountUseCase,
  bindFolderToGitHubAccountUseCase,
  unbindFolderFromGitHubAccountUseCase,
} from "@/infrastructure/container";
import { EntityNotFoundError } from "@/domain/errors/DomainError";

/**
 * PATCH /api/github/accounts/:accountId
 * Update account properties (e.g., set as default, bind/unbind folder)
 *
 * Body: { action: "set-default" | "bind-folder" | "unbind-folder", folderId?: string }
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  const accountId = params?.accountId;
  if (!accountId) {
    return errorResponse("Account ID required", 400);
  }

  try {
    const body = await request.json();

    if (body.action === "set-default") {
      await setDefaultGitHubAccountUseCase.execute({
        userId,
        providerAccountId: accountId,
      });
      return NextResponse.json({ success: true });
    }

    if (body.action === "bind-folder") {
      if (!body.folderId) {
        return errorResponse("folderId required", 400);
      }
      await bindFolderToGitHubAccountUseCase.execute({
        userId,
        folderId: body.folderId,
        providerAccountId: accountId,
      });
      return NextResponse.json({ success: true });
    }

    if (body.action === "unbind-folder") {
      if (!body.folderId) {
        return errorResponse("folderId required", 400);
      }
      await unbindFolderFromGitHubAccountUseCase.execute({
        folderId: body.folderId,
        userId,
      });
      return NextResponse.json({ success: true });
    }

    return errorResponse("Unknown action", 400);
  } catch (error) {
    if (error instanceof EntityNotFoundError) {
      return errorResponse(error.message, 404, error.code);
    }
    console.error("[api/github/accounts] PATCH error:", error);
    return errorResponse("Failed to update account", 500);
  }
});

/**
 * DELETE /api/github/accounts/:accountId
 * Unlink a specific GitHub account
 */
export const DELETE = withAuth(async (_request, { userId, params }) => {
  const accountId = params?.accountId;
  if (!accountId) {
    return errorResponse("Account ID required", 400);
  }

  try {
    await unlinkGitHubAccountUseCase.execute({
      userId,
      providerAccountId: accountId,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof EntityNotFoundError) {
      return errorResponse(error.message, 404, error.code);
    }
    console.error("[api/github/accounts] DELETE error:", error);
    return errorResponse("Failed to unlink account", 500);
  }
});
