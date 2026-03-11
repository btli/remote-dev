/**
 * PruneLogsUseCase - Deletes log entries older than a retention period.
 */

import type { LogRepository } from "@/application/ports/LogRepository";

const DEFAULT_RETENTION_DAYS = 7;

export class PruneLogsUseCase {
  constructor(private readonly logRepository: LogRepository) {}

  execute(retentionDays: number = DEFAULT_RETENTION_DAYS): number {
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    return this.logRepository.deleteOlderThan(cutoffMs);
  }
}
