/**
 * AppVersion - Value object representing a semantic version string.
 *
 * Supports comparison of major.minor.patch versions.
 * Pre-release suffixes (e.g., "-beta.1") are stripped for comparison purposes.
 */

import { InvalidValueError } from "../errors/DomainError";

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/;

export class AppVersion {
  private readonly major: number;
  private readonly minor: number;
  private readonly patch: number;
  private readonly prerelease: string | null;

  private constructor(major: number, minor: number, patch: number, prerelease: string | null) {
    this.major = major;
    this.minor = minor;
    this.patch = patch;
    this.prerelease = prerelease;
  }

  /**
   * Create an AppVersion from a version string.
   * Accepts formats: "1.2.3", "v1.2.3", "1.2.3-beta.1"
   * @throws InvalidValueError if the string is not a valid semver
   */
  static fromString(raw: string): AppVersion {
    const normalized = raw.startsWith("v") ? raw.slice(1) : raw;
    const match = SEMVER_REGEX.exec(normalized);

    if (!match) {
      throw new InvalidValueError(
        "AppVersion",
        raw,
        "Must be a valid semantic version (e.g., 1.2.3 or v1.2.3)"
      );
    }

    return new AppVersion(
      parseInt(match[1], 10),
      parseInt(match[2], 10),
      parseInt(match[3], 10),
      match[4] ?? null
    );
  }

  /**
   * Check if this version is newer than another version.
   * Pre-release versions are considered older than the same version without pre-release.
   */
  isNewerThan(other: AppVersion): boolean {
    if (this.major !== other.major) return this.major > other.major;
    if (this.minor !== other.minor) return this.minor > other.minor;
    if (this.patch !== other.patch) return this.patch > other.patch;

    // Same version numbers: release > pre-release
    if (this.prerelease === null && other.prerelease !== null) return true;

    return false;
  }

  /** Value equality */
  equals(other: AppVersion): boolean {
    return (
      this.major === other.major &&
      this.minor === other.minor &&
      this.patch === other.patch &&
      this.prerelease === other.prerelease
    );
  }

  /** Return the clean version string (without 'v' prefix) */
  toString(): string {
    const base = `${this.major}.${this.minor}.${this.patch}`;
    return this.prerelease ? `${base}-${this.prerelease}` : base;
  }

  /** Return the version string with 'v' prefix (for git tags) */
  toTagString(): string {
    return `v${this.toString()}`;
  }

  isPrerelease(): boolean {
    return this.prerelease !== null;
  }
}
