/**
 * CheckForUpdatesUseCase - Checks GitHub Releases for new versions.
 *
 * Polls the GitHub API, compares with the current version, and caches the result.
 * Short-circuits if a check was performed recently (unless force=true).
 */

import { AppVersion } from "@/domain/value-objects/AppVersion";
import { UpdateState } from "@/domain/value-objects/UpdateState";
import { Release } from "@/domain/entities/Release";
import type { ReleaseGateway } from "@/application/ports/ReleaseGateway";
import type { ReleaseRepository } from "@/application/ports/ReleaseRepository";
import { GITHUB_OWNER, GITHUB_REPO } from "./constants";
import { createLogger } from "@/lib/logger";

const log = createLogger("CheckForUpdates");

export interface CheckForUpdatesInput {
  force?: boolean;
}

export interface CheckForUpdatesOutput {
  state: UpdateState;
  release: Release | null;
  currentVersion: string;
  latestVersion: string | null;
}

export class CheckForUpdatesUseCase {
  constructor(
    private readonly releaseGateway: ReleaseGateway,
    private readonly releaseRepository: ReleaseRepository,
    private readonly currentVersion: AppVersion
  ) {}

  async execute(input: CheckForUpdatesInput = {}): Promise<CheckForUpdatesOutput> {
    // Short-circuit if checked recently (within 1 hour) unless forced
    if (!input.force) {
      const lastChecked = await this.releaseRepository.getLastChecked();
      if (lastChecked) {
        const hourAgo = Date.now() - 60 * 60 * 1000;
        if (lastChecked.getTime() > hourAgo) {
          const cached = await this.releaseRepository.getCachedRelease();
          const isNewer = cached?.isNewerThan(this.currentVersion) ?? false;
          return {
            state: isNewer ? UpdateState.available() : UpdateState.upToDate(),
            release: cached,
            currentVersion: this.currentVersion.toString(),
            latestVersion: cached?.version.toString() ?? null,
          };
        }
      }
    }

    try {
      const platform = Release.detectPlatform();
      const latestRelease = await this.releaseGateway.fetchLatestRelease(
        GITHUB_OWNER,
        GITHUB_REPO,
        platform
      );

      // Save check timestamp
      await this.releaseRepository.saveLastChecked(new Date());

      if (!latestRelease) {
        await this.releaseRepository.clearCachedRelease();
        return {
          state: UpdateState.upToDate(),
          release: null,
          currentVersion: this.currentVersion.toString(),
          latestVersion: null,
        };
      }

      // Cache the release
      await this.releaseRepository.saveCachedRelease(latestRelease);

      const isNewer = latestRelease.isNewerThan(this.currentVersion);
      return {
        state: isNewer ? UpdateState.available() : UpdateState.upToDate(),
        release: latestRelease,
        currentVersion: this.currentVersion.toString(),
        latestVersion: latestRelease.version.toString(),
      };
    } catch (error) {
      // Don't update lastChecked on failure so it retries next interval
      log.error("Failed to check for updates", { error: String(error) });
      return {
        state: UpdateState.error(
          error instanceof Error ? error.message : "Unknown error checking for updates"
        ),
        release: null,
        currentVersion: this.currentVersion.toString(),
        latestVersion: null,
      };
    }
  }
}
