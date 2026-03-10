/**
 * Release - Domain entity representing an available software release.
 *
 * Immutable. State changes return new instances.
 */

import { AppVersion } from "../value-objects/AppVersion";
import { InvalidValueError } from "../errors/DomainError";

export type ReleasePlatform = "linux-x64" | "linux-arm64" | "darwin-x64" | "darwin-arm64" | "win32-x64";

export interface ReleaseProps {
  version: AppVersion;
  publishedAt: Date;
  releaseNotes: string;
  downloadUrl: string;
  checksum: string | null;
  platform: ReleasePlatform;
}

export interface CreateReleaseProps {
  version: string;
  publishedAt: Date;
  releaseNotes: string;
  downloadUrl: string;
  checksum?: string | null;
  platform: ReleasePlatform;
}

export class Release {
  private constructor(private readonly props: ReleaseProps) {
    this.validateInvariants();
  }

  static create(input: CreateReleaseProps): Release {
    return new Release({
      version: AppVersion.fromString(input.version),
      publishedAt: input.publishedAt,
      releaseNotes: input.releaseNotes,
      downloadUrl: input.downloadUrl,
      checksum: input.checksum ?? null,
      platform: input.platform,
    });
  }

  /** Reconstitute from persisted data. */
  static reconstitute(props: ReleaseProps): Release {
    return new Release(props);
  }

  private validateInvariants(): void {
    if (!this.props.downloadUrl) {
      throw new InvalidValueError("Release.downloadUrl", this.props.downloadUrl, "Must be a non-empty string");
    }
  }

  get version(): AppVersion {
    return this.props.version;
  }

  get publishedAt(): Date {
    return this.props.publishedAt;
  }

  get releaseNotes(): string {
    return this.props.releaseNotes;
  }

  get downloadUrl(): string {
    return this.props.downloadUrl;
  }

  get checksum(): string | null {
    return this.props.checksum;
  }

  get platform(): ReleasePlatform {
    return this.props.platform;
  }

  /**
   * Check if this release is newer than the given version.
   */
  isNewerThan(currentVersion: AppVersion): boolean {
    return this.props.version.isNewerThan(currentVersion);
  }

  /**
   * Detect the current platform's release platform identifier.
   */
  static detectPlatform(): ReleasePlatform {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === "linux" && arch === "x64") return "linux-x64";
    if (platform === "linux" && arch === "arm64") return "linux-arm64";
    if (platform === "darwin" && arch === "x64") return "darwin-x64";
    if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
    if (platform === "win32" && arch === "x64") return "win32-x64";

    throw new InvalidValueError(
      "ReleasePlatform",
      `${platform}-${arch}`,
      "Unsupported platform/architecture combination"
    );
  }

  /**
   * Serialize to a plain object for persistence.
   */
  toPlainObject(): {
    version: string;
    publishedAt: number;
    releaseNotes: string;
    downloadUrl: string;
    checksum: string | null;
    platform: ReleasePlatform;
  } {
    return {
      version: this.props.version.toString(),
      publishedAt: this.props.publishedAt.getTime(),
      releaseNotes: this.props.releaseNotes,
      downloadUrl: this.props.downloadUrl,
      checksum: this.props.checksum,
      platform: this.props.platform,
    };
  }
}
