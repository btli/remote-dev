/**
 * GitHub Use Cases - Barrel export
 */

export {
  FetchIssuesForRepositoryUseCase,
  FetchIssuesError,
  ISSUE_CACHE_TTL_MS,
  type FetchIssuesInput,
  type FetchIssuesOutput,
} from "./FetchIssuesForRepositoryUseCase";

export {
  MarkIssuesSeenUseCase,
  type MarkIssuesSeenInput,
  type MarkIssuesSeenOutput,
} from "./MarkIssuesSeenUseCase";
