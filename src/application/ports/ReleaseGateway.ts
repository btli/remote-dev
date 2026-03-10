/**
 * ReleaseGateway - Port interface for fetching release information from external sources.
 */

import type { Release, ReleasePlatform } from "@/domain/entities/Release";

export interface ReleaseGateway {
  /**
   * Fetch the latest release for the given platform.
   * Returns null if no compatible release is found.
   */
  fetchLatestRelease(
    owner: string,
    repo: string,
    platform: ReleasePlatform
  ): Promise<Release | null>;

  /**
   * Download a release tarball to the specified path.
   * Calls onProgress with bytes downloaded and total bytes.
   */
  downloadRelease(
    url: string,
    destPath: string,
    onProgress?: (bytesDownloaded: number, totalBytes: number) => void
  ): Promise<void>;

  /**
   * Fetch the SHA-256 checksum for a release version.
   * Returns null if no checksum file is available.
   */
  fetchChecksum(
    owner: string,
    repo: string,
    tag: string,
    platform: ReleasePlatform
  ): Promise<string | null>;
}
