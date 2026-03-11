/**
 * DrizzleReleaseRepository - SQLite-backed implementation of ReleaseRepository.
 *
 * Uses a single-row pattern (id="singleton") for storing update check state.
 */

import { db } from "@/db";
import { systemUpdateCache } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Release } from "@/domain/entities/Release";
import { AppVersion } from "@/domain/value-objects/AppVersion";
import type { ReleaseRepository } from "@/application/ports/ReleaseRepository";
import type { ReleasePlatform } from "@/domain/entities/Release";
import { createLogger } from "@/lib/logger";

const log = createLogger("DrizzleReleaseRepository");

const SINGLETON_ID = "singleton";

interface CachedReleaseJson {
  version: string;
  publishedAt: number;
  releaseNotes: string;
  downloadUrl: string;
  checksum: string | null;
  platform: ReleasePlatform;
}

export class DrizzleReleaseRepository implements ReleaseRepository {
  async getLastChecked(): Promise<Date | null> {
    const row = await db.query.systemUpdateCache.findFirst({
      where: eq(systemUpdateCache.id, SINGLETON_ID),
    });

    return row?.lastChecked ?? null;
  }

  async saveLastChecked(at: Date): Promise<void> {
    await db
      .insert(systemUpdateCache)
      .values({
        id: SINGLETON_ID,
        lastChecked: at,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemUpdateCache.id,
        set: {
          lastChecked: at,
          updatedAt: new Date(),
        },
      });
  }

  async getCachedRelease(): Promise<Release | null> {
    const row = await db.query.systemUpdateCache.findFirst({
      where: eq(systemUpdateCache.id, SINGLETON_ID),
    });

    if (!row?.cachedReleaseJson) {
      return null;
    }

    try {
      const json = JSON.parse(row.cachedReleaseJson) as CachedReleaseJson;
      return Release.reconstitute({
        version: AppVersion.fromString(json.version),
        publishedAt: new Date(json.publishedAt),
        releaseNotes: json.releaseNotes,
        downloadUrl: json.downloadUrl,
        checksum: json.checksum,
        platform: json.platform,
      });
    } catch (error) {
      log.error("Failed to parse cached release", { error: String(error) });
      return null;
    }
  }

  async saveCachedRelease(release: Release): Promise<void> {
    const json = JSON.stringify(release.toPlainObject());

    await db
      .insert(systemUpdateCache)
      .values({
        id: SINGLETON_ID,
        cachedReleaseJson: json,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemUpdateCache.id,
        set: {
          cachedReleaseJson: json,
          updatedAt: new Date(),
        },
      });
  }

  async clearCachedRelease(): Promise<void> {
    await db
      .update(systemUpdateCache)
      .set({
        cachedReleaseJson: null,
        updatedAt: new Date(),
      })
      .where(eq(systemUpdateCache.id, SINGLETON_ID));
  }
}
