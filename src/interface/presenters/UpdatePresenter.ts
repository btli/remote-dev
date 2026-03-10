/**
 * UpdatePresenter - Transforms domain objects into API response shapes.
 */

import type { UpdateStatusOutput } from "@/application/use-cases/update/GetUpdateStatusUseCase";
import type { CheckForUpdatesOutput } from "@/application/use-cases/update/CheckForUpdatesUseCase";
import type { Release } from "@/domain/entities/Release";
import type { UpdateState, UpdateStateTag } from "@/domain/value-objects/UpdateState";

export interface UpdateStatusResponse {
  currentVersion: string;
  latestVersion: string | null;
  state: UpdateStateTag;
  updateAvailable: boolean;
  lastChecked: string | null;
  releaseNotes: string | null;
  downloadUrl: string | null;
  publishedAt: string | null;
  errorMessage: string | null;
}

function buildResponse(
  currentVersion: string,
  latestVersion: string | null,
  state: UpdateState,
  lastChecked: string | null,
  release: Release | null,
): UpdateStatusResponse {
  return {
    currentVersion,
    latestVersion,
    state: state.tag,
    updateAvailable: state.isAvailable(),
    lastChecked,
    releaseNotes: release?.releaseNotes ?? null,
    downloadUrl: release?.downloadUrl ?? null,
    publishedAt: release?.publishedAt.toISOString() ?? null,
    errorMessage: state.errorMessage,
  };
}

export function toUpdateStatusResponse(output: UpdateStatusOutput): UpdateStatusResponse {
  return buildResponse(
    output.currentVersion,
    output.latestVersion,
    output.state,
    output.lastChecked?.toISOString() ?? null,
    output.release,
  );
}

export function toCheckResultResponse(output: CheckForUpdatesOutput): UpdateStatusResponse {
  return buildResponse(
    output.currentVersion,
    output.latestVersion,
    output.state,
    new Date().toISOString(),
    output.release,
  );
}
