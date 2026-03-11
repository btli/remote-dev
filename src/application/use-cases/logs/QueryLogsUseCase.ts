/**
 * QueryLogsUseCase - Queries log entries with filtering and pagination.
 */

import type {
  LogRepository,
  LogQueryOptions,
  LogEntryRecord,
} from "@/application/ports/LogRepository";

export interface QueryLogsResult {
  entries: LogEntryRecord[];
  hasMore: boolean;
}

export class QueryLogsUseCase {
  constructor(private readonly logRepository: LogRepository) {}

  execute(options: LogQueryOptions = {}): QueryLogsResult {
    const limit = Math.min(Math.max(1, options.limit ?? 200), 500);

    // Fetch one extra to determine if there are more results
    const entries = this.logRepository.query({ ...options, limit: limit + 1 });
    const hasMore = entries.length > limit;

    return {
      entries: entries.slice(0, limit),
      hasMore,
    };
  }
}
