/**
 * TarballInstaller - Port interface for extracting and installing release tarballs.
 */

export interface TarballInstaller {
  /**
   * Extract and install a tarball to the releases directory.
   * Creates a versioned directory and updates the 'current' symlink atomically.
   *
   * @param tarballPath - Path to the downloaded .tar.gz file
   * @param version - Version string for the release directory name
   */
  install(tarballPath: string, version: string): Promise<void>;

  /**
   * Verify a tarball's SHA-256 checksum.
   * @returns true if checksum matches, false otherwise
   */
  verify(tarballPath: string, expectedChecksum: string): Promise<boolean>;
}
