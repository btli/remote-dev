/**
 * UpdatePresenter - Transforms domain objects into API response shapes.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDeployDir } from "@/lib/paths";
import type { UpdateStatusOutput } from "@/application/use-cases/update/GetUpdateStatusUseCase";
import type { CheckForUpdatesOutput } from "@/application/use-cases/update/CheckForUpdatesUseCase";
import type { Release } from "@/domain/entities/Release";
import type { UpdateState, UpdateStateTag } from "@/domain/value-objects/UpdateState";

export interface DeployInfo {
  activeSlot: string;
  activeCommit: string;
  deployedAt: string;
}

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
  deploy: DeployInfo | null;
}

function readDeployInfo(): DeployInfo | null {
  try {
    const stateFile = join(getDeployDir(), "state.json");
    if (!existsSync(stateFile)) return null;
    const data = JSON.parse(readFileSync(stateFile, "utf-8"));
    return {
      activeSlot: data.activeSlot,
      activeCommit: data.activeCommit,
      deployedAt: data.deployedAt,
    };
  } catch {
    return null;
  }
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
    deploy: readDeployInfo(),
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
