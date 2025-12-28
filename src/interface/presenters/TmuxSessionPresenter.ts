/**
 * TmuxSessionPresenter - Transforms domain TmuxSystemSession entities to API responses.
 *
 * This presenter converts internal domain objects to the API contract,
 * ensuring dates are serialized as ISO strings.
 */

import type { EnrichedTmuxSession } from "@/domain/value-objects/TmuxSessionList";
import type { TmuxSessionResponse, ListTmuxSessionsResponse } from "@/types/tmux";

export class TmuxSessionPresenter {
  /**
   * Convert an EnrichedTmuxSession to the API response format.
   */
  static toResponse(enriched: EnrichedTmuxSession): TmuxSessionResponse {
    return {
      name: enriched.session.name,
      windowCount: enriched.session.windowCount,
      created: enriched.session.created.toISOString(),
      attached: enriched.session.attached,
      isOrphaned: enriched.isOrphaned,
      dbSessionId: enriched.dbSessionId,
      folderName: enriched.folderName,
    };
  }

  /**
   * Convert multiple sessions to API response format with counts.
   */
  static toListResponse(
    sessions: EnrichedTmuxSession[],
    counts: { total: number; orphaned: number; tracked: number }
  ): ListTmuxSessionsResponse {
    return {
      sessions: sessions.map(TmuxSessionPresenter.toResponse),
      totalCount: counts.total,
      orphanedCount: counts.orphaned,
      trackedCount: counts.tracked,
    };
  }
}
