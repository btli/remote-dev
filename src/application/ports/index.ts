/**
 * Application Ports - Interfaces for infrastructure dependencies
 *
 * Ports define the contracts that infrastructure implementations must fulfill.
 * This enables dependency inversion: application layer depends on abstractions,
 * not concrete implementations.
 */

export type {
  SessionRepository,
  SessionFilters,
  SessionOrderBy,
} from "./SessionRepository";

export type {
  FolderRepository,
  FolderFilters,
  FolderOrderBy,
} from "./FolderRepository";

export type {
  TmuxGateway,
  TmuxSessionInfo,
  CreateTmuxSessionOptions,
} from "./TmuxGateway";

export type {
  WorktreeGateway,
  WorktreeInfo,
  CreateWorktreeOptions,
  CreateWorktreeResult,
} from "./WorktreeGateway";

export type {
  GitHubIssueRepository,
  IssueFilters,
  IssueOrderBy,
} from "./GitHubIssueRepository";

export type {
  GitHubIssueGateway,
  FetchIssuesParams,
  FetchIssueParams,
} from "./GitHubIssueGateway";

export type {
  IProjectMetadataRepository,
  ProjectMetadataFilters,
  ProjectMetadataOrderBy,
} from "./IProjectMetadataRepository";
