/**
 * ApplyUpdateUseCase - Downloads, verifies, installs, and restarts.
 *
 * Sequence:
 * 1. Download tarball to temp directory
 * 2. Verify checksum if available
 * 3. Extract and install via TarballInstaller
 * 4. Signal service restart via ServiceRestarter
 *
 * The operation is idempotent: if interrupted, the old release remains active
 * because the 'current' symlink is only updated after successful extraction.
 */

import type { Release } from "@/domain/entities/Release";
import type { ReleaseGateway } from "@/application/ports/ReleaseGateway";
import type { ReleaseRepository } from "@/application/ports/ReleaseRepository";
import type { TarballInstaller } from "@/application/ports/TarballInstaller";
import type { ServiceRestarter } from "@/application/ports/ServiceRestarter";
import {
  UpdateInProgressError,
  NoUpdateAvailableError,
  ChecksumMismatchError,
} from "@/domain/errors/UpdateError";
import { getUpdateDownloadDir } from "@/lib/paths";
import { GITHUB_OWNER, GITHUB_REPO } from "./constants";
import { join } from "node:path";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";

/** Remove a file, ignoring errors (e.g., file already deleted). */
function safeUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Non-critical cleanup failure
  }
}

export class ApplyUpdateUseCase {
  private applyInProgress = false;

  constructor(
    private readonly releaseGateway: ReleaseGateway,
    private readonly releaseRepository: ReleaseRepository,
    private readonly tarballInstaller: TarballInstaller,
    private readonly serviceRestarter: ServiceRestarter
  ) {}

  async execute(): Promise<{ version: string }> {
    if (this.applyInProgress) {
      throw new UpdateInProgressError();
    }
    this.applyInProgress = true;

    const downloadDir = getUpdateDownloadDir();

    try {
      const release = await this.releaseRepository.getCachedRelease();
      if (!release) {
        this.applyInProgress = false;
        throw new NoUpdateAvailableError();
      }

      const versionStr = release.version.toString();
      const tarballPath = join(downloadDir, `remote-dev-${versionStr}.tar.gz`);

      if (!existsSync(downloadDir)) {
        mkdirSync(downloadDir, { recursive: true });
      }

      // Download the tarball
      console.log(`[Update] Downloading v${versionStr} from ${release.downloadUrl}`);
      await this.releaseGateway.downloadRelease(
        release.downloadUrl,
        tarballPath,
        (downloaded, total) => {
          const pct = total > 0 ? ((downloaded / total) * 100).toFixed(1) : "?";
          console.log(`[Update] Download progress: ${pct}%`);
        }
      );

      // Verify checksum if available
      await this.verifyChecksum(release, tarballPath);

      // Extract and install
      console.log(`[Update] Installing v${versionStr}`);
      await this.tarballInstaller.install(tarballPath, versionStr);

      // Clear cached release (update has been applied)
      await this.releaseRepository.clearCachedRelease();

      // Clean up download
      safeUnlink(tarballPath);

      // Restart service (with delay to allow HTTP response to flush).
      // Keep applyInProgress=true after successful apply to prevent duplicate
      // requests before the restart takes effect.
      if (this.serviceRestarter.isRestartSupported()) {
        console.log("[Update] Scheduling service restart...");
        this.serviceRestarter.restart(500);
      } else {
        this.applyInProgress = false;
        console.log("[Update] Restart not supported in this environment. Please restart manually.");
      }

      return { version: versionStr };
    } catch (error) {
      this.applyInProgress = false;
      throw error;
    }
  }

  private async verifyChecksum(release: Release, tarballPath: string): Promise<void> {
    const checksum = release.checksum ??
      await this.releaseGateway.fetchChecksum(
        GITHUB_OWNER,
        GITHUB_REPO,
        release.version.toTagString(),
        release.platform
      );

    if (!checksum) {
      console.log("[Update] No checksum available, skipping verification");
      return;
    }

    console.log("[Update] Verifying checksum...");
    const valid = await this.tarballInstaller.verify(tarballPath, checksum);
    if (!valid) {
      safeUnlink(tarballPath);
      throw new ChecksumMismatchError(checksum, "(computed from download)");
    }
    console.log("[Update] Checksum verified");
  }
}
