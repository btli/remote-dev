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
  PushNotificationGateway,
  PushPayload,
  PushSendResult,
} from "./PushNotificationGateway";

export type {
  PushTokenRepository,
  PushTokenRecord,
} from "./PushTokenRepository";

// Claude usage-limit / profile-pool ports [remote-dev-3b3l]
export type {
  UsageLimitGateway,
  LimitDetectionResult,
} from "./UsageLimitGateway";

export type { UsageLimitStateRepository } from "./UsageLimitStateRepository";

export type {
  ProfilePoolRepository,
  PoolEntry,
  PoolSummary,
} from "./ProfilePoolRepository";

export type { ProfileSelectionPolicy } from "./ProfileSelectionPolicy";

export type {
  NotificationPort,
  UsageLimitNotification,
} from "./NotificationPort";

export type {
  SessionLauncherPort,
  LaunchReplacementInput,
  LaunchReplacementResult,
} from "./SessionLauncherPort";

export type { AutoRelaunchModePort } from "./AutoRelaunchModePort";
