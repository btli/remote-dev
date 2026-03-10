/**
 * GitHubReleaseGateway - Fetches release information from GitHub Releases API.
 *
 * Uses the public GitHub API (no authentication required for public repos).
 * Rate limit: 60 requests/hour for unauthenticated requests.
 */

import { Release } from "@/domain/entities/Release";
import type { ReleasePlatform } from "@/domain/entities/Release";
import type { ReleaseGateway } from "@/application/ports/ReleaseGateway";
import { NetworkError } from "@/domain/errors/UpdateError";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

const GITHUB_API_HEADERS = {
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "remote-dev-updater",
} as const;

const DOWNLOAD_HEADERS = {
  "User-Agent": "remote-dev-updater",
} as const;

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubReleaseResponse {
  tag_name: string;
  published_at: string;
  body: string;
  assets: GitHubReleaseAsset[];
}

export class GitHubReleaseGatewayImpl implements ReleaseGateway {
  async fetchLatestRelease(
    owner: string,
    repo: string,
    platform: ReleasePlatform
  ): Promise<Release | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

    const response = await fetch(url, { headers: GITHUB_API_HEADERS });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new NetworkError(url, response.status);
    }

    const data = (await response.json()) as GitHubReleaseResponse;
    const assetSuffix = `${platform}.tar.gz`;
    const asset = data.assets.find((a) => a.name.endsWith(assetSuffix));

    if (!asset) {
      console.log(`[GitHubReleaseGateway] No asset found for platform ${platform} in release ${data.tag_name}`);
      return null;
    }

    return Release.create({
      version: data.tag_name,
      publishedAt: new Date(data.published_at),
      releaseNotes: data.body || "",
      downloadUrl: asset.browser_download_url,
      platform,
    });
  }

  async downloadRelease(
    url: string,
    destPath: string,
    onProgress?: (bytesDownloaded: number, totalBytes: number) => void
  ): Promise<void> {
    if (!url.startsWith("https://github.com/") && !url.startsWith("https://objects.githubusercontent.com/")) {
      throw new NetworkError(url);
    }

    const response = await fetch(url, { headers: DOWNLOAD_HEADERS });

    if (!response.ok) {
      throw new NetworkError(url, response.status);
    }

    if (!response.body) {
      throw new NetworkError(url);
    }

    const totalBytes = parseInt(response.headers.get("content-length") || "0");
    let bytesDownloaded = 0;

    const writeStream = createWriteStream(destPath);

    // Create a transform that tracks progress
    const reader = response.body.getReader();
    const nodeStream = new Readable({
      async read() {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }
        bytesDownloaded += value.byteLength;
        onProgress?.(bytesDownloaded, totalBytes);
        this.push(Buffer.from(value));
      },
    });

    await pipeline(nodeStream, writeStream);
  }

  async fetchChecksum(
    owner: string,
    repo: string,
    tag: string,
    platform: ReleasePlatform
  ): Promise<string | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`;

    try {
      const response = await fetch(url, { headers: GITHUB_API_HEADERS });
      if (!response.ok) return null;

      const data = (await response.json()) as GitHubReleaseResponse;
      const checksumAsset = data.assets.find((a) => a.name === "checksums.txt");
      if (!checksumAsset) return null;

      const checksumResponse = await fetch(checksumAsset.browser_download_url, {
        headers: DOWNLOAD_HEADERS,
      });
      if (!checksumResponse.ok) return null;

      // Format: "sha256hash  filename\n"
      const checksumText = await checksumResponse.text();
      const targetFilename = `remote-dev-${platform}.tar.gz`;
      const line = checksumText
        .split("\n")
        .find((l) => l.includes(targetFilename));

      return line?.split(/\s+/)[0] ?? null;
    } catch {
      return null;
    }
  }
}
