/**
 * TarballInstallerImpl - Extracts and installs release tarballs.
 *
 * Installation layout:
 *   ~/.remote-dev/releases/
 *   ├── 0.2.1/          # Versioned release directories
 *   ├── 0.3.0/
 *   └── current -> 0.3.0  # Symlink to active release
 *
 * The 'current' symlink is updated atomically after successful extraction.
 * If extraction fails, the old release remains active.
 */

import type { TarballInstaller } from "@/application/ports/TarballInstaller";
import { ExtractionError } from "@/domain/errors/UpdateError";
import { getReleasesDir, getUpdateStagingDir } from "@/lib/paths";
import { join } from "path";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "fs";
import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export class TarballInstallerImpl implements TarballInstaller {
  async install(tarballPath: string, version: string): Promise<void> {
    const releasesDir = getReleasesDir();
    const stagingDir = getUpdateStagingDir();
    const versionDir = join(releasesDir, version);
    const currentLink = join(releasesDir, "current");

    // Clean up any leftover staging directory
    if (existsSync(stagingDir)) {
      rmSync(stagingDir, { recursive: true, force: true });
    }

    try {
      // Create staging directory
      mkdirSync(stagingDir, { recursive: true });

      // Extract tarball to staging directory
      await this.extractTarball(tarballPath, stagingDir);

      // Find the extracted directory (tarball may have a root directory)
      const extractedContents = this.findExtractedRoot(stagingDir);

      // Move extracted contents to versioned release directory
      if (existsSync(versionDir)) {
        rmSync(versionDir, { recursive: true, force: true });
      }
      mkdirSync(releasesDir, { recursive: true });
      renameSync(extractedContents, versionDir);

      // Atomically update the 'current' symlink
      const tempLink = `${currentLink}.tmp`;
      try {
        unlinkSync(tempLink);
      } catch {
        // Doesn't exist, fine
      }
      symlinkSync(version, tempLink);
      renameSync(tempLink, currentLink);

      console.log(`[TarballInstaller] Installed v${version} -> ${versionDir}`);
      console.log(`[TarballInstaller] Symlink: current -> ${version}`);

      // Clean up old releases (keep last 3)
      this.cleanupOldReleases(releasesDir, version);
    } catch (error) {
      if (error instanceof ExtractionError) throw error;
      throw new ExtractionError(
        error instanceof Error ? error.message : "Unknown extraction error"
      );
    } finally {
      // Always clean up staging directory
      if (existsSync(stagingDir)) {
        rmSync(stagingDir, { recursive: true, force: true });
      }
    }
  }

  async verify(tarballPath: string, expectedChecksum: string): Promise<boolean> {
    const actualChecksum = await this.computeSha256(tarballPath);
    return actualChecksum === expectedChecksum.toLowerCase();
  }

  private async extractTarball(tarballPath: string, destDir: string): Promise<void> {
    try {
      await execFileAsync("tar", ["-xzf", tarballPath, "-C", destDir]);
    } catch (error) {
      throw new ExtractionError(
        `tar extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  private findExtractedRoot(stagingDir: string): string {
    const entries = readdirSync(stagingDir);

    if (entries.length === 1) {
      // Single directory extracted - use it as root
      return join(stagingDir, entries[0]);
    }

    // Multiple files extracted - use staging dir itself
    return stagingDir;
  }

  private computeSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(filePath);

      stream.on("data", (data: Buffer) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  private cleanupOldReleases(releasesDir: string, currentVersion: string): void {
    try {
      const entries = readdirSync(releasesDir);

      // Filter out 'current' symlink and sort by semver (newest first)
      const versions = entries
        .filter((e) => e !== "current" && e !== "current.tmp" && e !== currentVersion)
        .sort((a, b) => {
          const pa = a.split(".").map(Number);
          const pb = b.split(".").map(Number);
          for (let i = 0; i < 3; i++) {
            if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
          }
          return 0;
        });

      // Keep last 2 old versions (3 total including current)
      const toRemove = versions.slice(2);
      for (const version of toRemove) {
        const dir = join(releasesDir, version);
        console.log(`[TarballInstaller] Removing old release: ${version}`);
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Non-critical cleanup failure
    }
  }
}
