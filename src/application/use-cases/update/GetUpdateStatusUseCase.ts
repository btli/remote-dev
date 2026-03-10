/**
 * GetUpdateStatusUseCase - Returns the current update status.
 *
 * Pure read operation. Assembles status from the cached release,
 * last check timestamp, and the running application version.
 */

import type { AppVersion } from "@/domain/value-objects/AppVersion";
import { UpdateState } from "@/domain/value-objects/UpdateState";
import type { Release } from "@/domain/entities/Release";
import type { ReleaseRepository } from "@/application/ports/ReleaseRepository";

export interface UpdateStatusOutput {
  currentVersion: string;
  latestVersion: string | null;
  state: UpdateState;
  lastChecked: Date | null;
  release: Release | null;
}

export class GetUpdateStatusUseCase {
  constructor(
    private readonly releaseRepository: ReleaseRepository,
    private readonly currentVersion: AppVersion
  ) {}

  async execute(): Promise<UpdateStatusOutput> {
    const [lastChecked, cachedRelease] = await Promise.all([
      this.releaseRepository.getLastChecked(),
      this.releaseRepository.getCachedRelease(),
    ]);

    let state: UpdateState;
    if (!cachedRelease) {
      state = lastChecked ? UpdateState.upToDate() : UpdateState.idle();
    } else if (cachedRelease.isNewerThan(this.currentVersion)) {
      state = UpdateState.available();
    } else {
      state = UpdateState.upToDate();
    }

    return {
      currentVersion: this.currentVersion.toString(),
      latestVersion: cachedRelease?.version.toString() ?? null,
      state,
      lastChecked,
      release: cachedRelease,
    };
  }
}
