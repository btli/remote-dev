/**
 * System Update API
 *
 * GET  /api/system/update  - Get current update status
 * POST /api/system/update  - Perform update action (check or apply)
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import {
  getUpdateStatusUseCase,
  checkForUpdatesUseCase,
  applyUpdateUseCase,
} from "@/infrastructure/container";
import {
  toUpdateStatusResponse,
  toCheckResultResponse,
} from "@/interface/presenters/UpdatePresenter";
import {
  UpdateInProgressError,
  NoUpdateAvailableError,
} from "@/domain/errors/UpdateError";

/**
 * GET /api/system/update
 *
 * Returns the current update status including version info and available updates.
 */
export const GET = withApiAuth(async () => {
  const status = await getUpdateStatusUseCase.execute();
  return NextResponse.json(toUpdateStatusResponse(status));
});

/**
 * POST /api/system/update
 *
 * Body: { action: "check" | "apply" }
 *
 * - "check": Force-check GitHub for new releases
 * - "apply": Download, install, and restart with the cached release
 */
export const POST = withApiAuth(async (request) => {
  const result = await parseJsonBody<{ action: string }>(request);
  if ("error" in result) return result.error;
  const { action } = result.data;

  if (action === "check") {
    const checkResult = await checkForUpdatesUseCase.execute({ force: true });
    return NextResponse.json(toCheckResultResponse(checkResult));
  }

  if (action === "apply") {
    try {
      const applyResult = await applyUpdateUseCase.execute();
      // Return 202 Accepted - the service will restart shortly
      return NextResponse.json(
        {
          status: "restarting",
          version: applyResult.version,
          message: "Update applied. Service will restart shortly.",
        },
        { status: 202 }
      );
    } catch (error) {
      if (error instanceof UpdateInProgressError) {
        return errorResponse(error.message, 409, error.code);
      }
      if (error instanceof NoUpdateAvailableError) {
        return errorResponse(error.message, 404, error.code);
      }
      throw error;
    }
  }

  return errorResponse(
    "Invalid action. Must be 'check' or 'apply'.",
    400,
    "INVALID_ACTION"
  );
});
